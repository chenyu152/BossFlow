from __future__ import annotations

import datetime as dt
import json
import math
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional

from fastapi import HTTPException

from backend.schemas.automation import AutomationScheduleInput
from backend.schemas.config import CrawlRequest
from backend.services.project_service import config_payload, resolve_project, text_to_cities
from backend.services.login_state_service import login_state
from backend.services.task_service import TaskManager
from backend.storage.paths import BASE_DIR


CrawlStarter = Callable[..., dict]
LoginStateReader = Callable[[str], dict]
MAX_AUTOMATION_SCHEDULES = 10
RECOMMENDED_DAILY_AUTOMATION_MINUTES = 5 * 60


def _now() -> dt.datetime:
    return dt.datetime.now().astimezone().replace(microsecond=0)


def _iso(value: dt.datetime) -> str:
    return value.astimezone().replace(microsecond=0).isoformat()


def _next_occurrence(
    cadence: str,
    time_of_day: str,
    days_of_week: list[int],
    after: dt.datetime,
) -> dt.datetime:
    hour, minute = (int(part) for part in time_of_day.split(":", 1))
    allowed_days = set(days_of_week)
    if cadence == "weekdays":
        allowed_days = set(range(5))
    elif cadence == "weekly" and not allowed_days:
        allowed_days = {after.weekday()}

    for offset in range(0, 15):
        day = after.date() + dt.timedelta(days=offset)
        candidate = dt.datetime.combine(day, dt.time(hour, minute), tzinfo=after.tzinfo)
        if candidate <= after:
            continue
        if cadence == "daily" or candidate.weekday() in allowed_days:
            return candidate
    raise ValueError("Unable to calculate the next scheduled run")


def _schedule_days(cadence: str, days_of_week: list[int]) -> set[int]:
    if cadence == "daily":
        return set(range(7))
    if cadence == "weekdays":
        return set(range(5))
    return set(days_of_week)


def _schedule_signature(
    project: str,
    cadence: str,
    time_of_day: str,
    days_of_week: list[int],
    keywords_text: str,
    cities_text: str,
    new_job_target: int,
    max_jobs: int,
) -> tuple[str, str, tuple[int, ...], tuple[str, ...], tuple[str, ...], int, int]:
    normalized_days = tuple(sorted(_schedule_days(cadence, days_of_week)))
    normalized_keywords = tuple(
        sorted({line.strip().casefold() for line in keywords_text.splitlines() if line.strip()})
    )
    normalized_cities = tuple(
        sorted({line.strip().casefold() for line in cities_text.splitlines() if line.strip()})
    )
    return (
        project,
        time_of_day,
        normalized_days,
        normalized_keywords,
        normalized_cities,
        int(new_job_target),
        int(max_jobs),
    )


def _collection_estimate(
    keywords_text: str,
    cities_text: str,
    new_job_target: int,
    max_jobs: int,
    existing_job_count: int = 0,
) -> dict:
    keyword_count = len({line.strip().casefold() for line in keywords_text.splitlines() if line.strip()})
    city_count = len({line.strip().casefold() for line in cities_text.splitlines() if line.strip()})
    combinations = keyword_count * city_count
    if not combinations:
        return {
            "keywordCount": keyword_count,
            "cityCount": city_count,
            "combinationCount": combinations,
            "estimatedListedJobs": 0,
            "estimatedDetailJobs": 0,
            "estimatedReusedJobs": 0,
            "estimatedStopCondition": "new_job_target",
            "estimatedMinutes": 0,
            "estimatedRangeMinutes": [0, 0],
        }

    new_target = max(1, int(new_job_target))
    total_limit = max(1, int(max_jobs))
    new_job_ratio = 1.0 if existing_job_count <= 0 else 0.27
    listed_to_reach_new_target = math.ceil(new_target / new_job_ratio)
    estimated_listed_per_search = min(total_limit, listed_to_reach_new_target)
    estimated_scroll_rounds = max(1, math.ceil(estimated_listed_per_search / 20))
    # The captured run found 13 database-new rows among 48 observed rows. Reuse
    # that 27% discovery rate once the project already has collection history.
    estimated_listed_jobs = estimated_listed_per_search * combinations
    estimated_detail_per_search = min(
        estimated_listed_per_search,
        math.ceil(estimated_listed_per_search * new_job_ratio),
    )
    estimated_detail_jobs = estimated_detail_per_search * combinations
    estimated_reused_jobs = max(0, estimated_listed_jobs - estimated_detail_jobs)
    # The same run took about 33 seconds for two list searches and averaged
    # about 8.7 seconds per detail page that could not be reused.
    seconds = (
        12
        + combinations * (10 + estimated_scroll_rounds * 4)
        + estimated_detail_jobs * 8.7
        + keyword_count * 2
        + city_count * 3
    )
    estimated = max(1, math.ceil(seconds / 60))
    return {
        "keywordCount": keyword_count,
        "cityCount": city_count,
        "combinationCount": combinations,
        "estimatedListedJobs": estimated_listed_jobs,
        "estimatedDetailJobs": estimated_detail_jobs,
        "estimatedReusedJobs": estimated_reused_jobs,
        "estimatedStopCondition": (
            "new_job_target"
            if listed_to_reach_new_target <= total_limit
            else "max_jobs"
        ),
        "estimatedMinutes": estimated,
        "estimatedRangeMinutes": [
            max(1, math.floor(estimated * 0.9)),
            max(1, math.ceil(estimated * 1.15)),
        ],
    }


class AutomationService:
    def __init__(
        self,
        task_manager: TaskManager,
        db_path: Optional[Path] = None,
        crawl_starter: Optional[CrawlStarter] = None,
        login_state_reader: Optional[LoginStateReader] = None,
        poll_seconds: float = 2.0,
    ):
        self.task_manager = task_manager
        self.db_path = db_path or (BASE_DIR / "automation.db")
        self.crawl_starter = crawl_starter
        self.login_state_reader = login_state_reader or login_state
        self.poll_seconds = poll_seconds
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.last_error = ""
        self._initialize()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.lock, self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS automation_schedules (
                    id TEXT PRIMARY KEY,
                    project TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    cadence TEXT NOT NULL,
                    time_of_day TEXT NOT NULL,
                    days_of_week TEXT NOT NULL DEFAULT '[]',
                    misfire_policy TEXT NOT NULL DEFAULT 'run_once',
                    max_delay_minutes INTEGER NOT NULL DEFAULT 360,
                    keywords_text TEXT NOT NULL DEFAULT '',
                    cities_text TEXT NOT NULL DEFAULT '',
                    new_job_target INTEGER NOT NULL DEFAULT 20,
                    max_jobs INTEGER NOT NULL DEFAULT 100,
                    next_run_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS automation_runs (
                    id TEXT PRIMARY KEY,
                    schedule_id TEXT NOT NULL,
                    project TEXT NOT NULL,
                    trigger TEXT NOT NULL,
                    scheduled_for TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    started_at TEXT NOT NULL DEFAULT '',
                    finished_at TEXT NOT NULL DEFAULT '',
                    error TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS automation_runs_queue_idx
                    ON automation_runs(status, scheduled_for, created_at);
                CREATE INDEX IF NOT EXISTS automation_runs_schedule_idx
                    ON automation_runs(schedule_id, created_at DESC);
                """
            )
            columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(automation_schedules)").fetchall()
            }
            migrations = {
                "keywords_text": "ALTER TABLE automation_schedules ADD COLUMN keywords_text TEXT NOT NULL DEFAULT ''",
                "cities_text": "ALTER TABLE automation_schedules ADD COLUMN cities_text TEXT NOT NULL DEFAULT ''",
                "new_job_target": "ALTER TABLE automation_schedules ADD COLUMN new_job_target INTEGER NOT NULL DEFAULT 20",
                "max_jobs": "ALTER TABLE automation_schedules ADD COLUMN max_jobs INTEGER NOT NULL DEFAULT 100",
            }
            added_collection_limits = (
                "new_job_target" not in columns or "max_jobs" not in columns
            )
            for column, statement in migrations.items():
                if column not in columns:
                    connection.execute(statement)
            if added_collection_limits and "scroll_target" in columns:
                connection.execute(
                    """
                    UPDATE automation_schedules
                    SET new_job_target = 20,
                        max_jobs = 100
                    """
                )

            legacy_rows = connection.execute(
                """
                SELECT id, project FROM automation_schedules
                WHERE keywords_text = '' OR cities_text = ''
                """
            ).fetchall()
            for row in legacy_rows:
                try:
                    payload = config_payload(resolve_project(str(row["project"])))
                except Exception:
                    continue
                connection.execute(
                    """
                    UPDATE automation_schedules
                    SET keywords_text = ?, cities_text = ?,
                        new_job_target = ?, max_jobs = ?
                    WHERE id = ?
                    """,
                    (
                        str(payload.get("keywordsText") or ""),
                        str(payload.get("citiesText") or ""),
                        int(payload.get("newJobTarget") or 20),
                        int(payload.get("maxJobs") or 100),
                        row["id"],
                    ),
                )

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        with self.lock, self._connect() as connection:
            timestamp = _iso(_now())
            connection.execute(
                """
                UPDATE automation_runs
                SET status = 'interrupted', finished_at = ?,
                    error = CASE WHEN error = '' THEN 'BossFlow exited before the task completed.' ELSE error END
                WHERE status = 'running'
                """,
                (timestamp,),
            )
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run_loop, name="bossflow-automation", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=max(1.0, self.poll_seconds * 2))

    def _run_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.tick()
                self.last_error = ""
            except Exception as error:  # scheduler failures must not stop the desktop backend
                self.last_error = str(error)
            self.stop_event.wait(self.poll_seconds)

    def tick(self, now: Optional[dt.datetime] = None) -> None:
        current = (now or _now()).astimezone().replace(microsecond=0)
        self._enqueue_due(current)
        self._dispatch_next()

    def _schedule_dict(self, row: sqlite3.Row, last_run: Optional[sqlite3.Row] = None) -> dict:
        existing_job_count = 0
        try:
            project_db = Path(resolve_project(str(row["project"]))) / "jobs_data.db"
            if project_db.exists():
                with sqlite3.connect(project_db) as project_connection:
                    result = project_connection.execute("SELECT COUNT(*) FROM jobs").fetchone()
                    existing_job_count = int(result[0] or 0) if result else 0
        except sqlite3.Error:
            existing_job_count = 0
        estimate = _collection_estimate(
            str(row["keywords_text"] or ""),
            str(row["cities_text"] or ""),
            int(row["new_job_target"] or 20),
            int(row["max_jobs"] or 100),
            existing_job_count,
        )
        return {
            "id": row["id"],
            "project": row["project"],
            "enabled": bool(row["enabled"]),
            "cadence": row["cadence"],
            "timeOfDay": row["time_of_day"],
            "daysOfWeek": json.loads(row["days_of_week"] or "[]"),
            "misfirePolicy": row["misfire_policy"],
            "maxDelayMinutes": int(row["max_delay_minutes"]),
            "keywordsText": row["keywords_text"],
            "citiesText": row["cities_text"],
            "newJobTarget": int(row["new_job_target"]),
            "maxJobs": int(row["max_jobs"]),
            **estimate,
            "nextRunAt": row["next_run_at"],
            "lastRunStatus": last_run["status"] if last_run else "",
            "lastRunAt": (last_run["finished_at"] or last_run["started_at"] or last_run["created_at"]) if last_run else "",
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _run_dict(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"],
            "scheduleId": row["schedule_id"],
            "project": row["project"],
            "trigger": row["trigger"],
            "scheduledFor": row["scheduled_for"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "finishedAt": row["finished_at"],
            "error": row["error"],
        }

    def list_schedules(self) -> list[dict]:
        with self.lock, self._connect() as connection:
            schedules = connection.execute(
                "SELECT * FROM automation_schedules ORDER BY created_at, id"
            ).fetchall()
            result = []
            for schedule in schedules:
                last_run = connection.execute(
                    "SELECT * FROM automation_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1",
                    (schedule["id"],),
                ).fetchone()
                result.append(self._schedule_dict(schedule, last_run))
            return result

    def list_runs(self, limit: int = 30) -> list[dict]:
        with self.lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?",
                (max(1, min(int(limit), 200)),),
            ).fetchall()
            return [self._run_dict(row) for row in rows]

    def snapshot(self) -> dict:
        with self.lock, self._connect() as connection:
            counts = {
                row["status"]: int(row["count"])
                for row in connection.execute(
                    "SELECT status, COUNT(*) AS count FROM automation_runs GROUP BY status"
                ).fetchall()
            }
        return {
            "ok": True,
            "schedules": self.list_schedules(),
            "runs": self.list_runs(),
            "queue": {
                "queued": counts.get("queued", 0),
                "running": counts.get("running", 0),
                "serial": True,
                "schedulerRunning": bool(self.thread and self.thread.is_alive()),
                "lastError": self.last_error,
            },
            "limits": {
                "maxSchedules": MAX_AUTOMATION_SCHEDULES,
                "recommendedDailyMinutes": RECOMMENDED_DAILY_AUTOMATION_MINUTES,
            },
        }

    def create_schedule(self, payload: AutomationScheduleInput) -> dict:
        resolve_project(payload.project)
        payload = self._materialize_collection_config(payload)
        if payload.enabled:
            self._require_login(payload.project)
        current = _now()
        schedule_id = uuid.uuid4().hex
        timestamp = _iso(current)
        next_run_at = _iso(
            _next_occurrence(payload.cadence, payload.timeOfDay, payload.daysOfWeek, current)
        )
        with self.lock, self._connect() as connection:
            self._validate_schedule(connection, payload)
            connection.execute(
                """
                INSERT INTO automation_schedules (
                    id, project, enabled, cadence, time_of_day, days_of_week,
                    misfire_policy, max_delay_minutes, keywords_text, cities_text,
                    new_job_target, max_jobs, next_run_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    schedule_id,
                    payload.project,
                    int(payload.enabled),
                    payload.cadence,
                    payload.timeOfDay,
                    json.dumps(payload.daysOfWeek),
                    payload.misfirePolicy,
                    payload.maxDelayMinutes,
                    payload.keywordsText,
                    payload.citiesText,
                    payload.newJobTarget,
                    payload.maxJobs,
                    next_run_at,
                    timestamp,
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM automation_schedules WHERE id = ?", (schedule_id,)
            ).fetchone()
            return self._schedule_dict(row)

    def update_schedule(self, schedule_id: str, payload: AutomationScheduleInput) -> dict:
        resolve_project(payload.project)
        payload = self._materialize_collection_config(payload)
        if payload.enabled:
            self._require_login(payload.project)
        current = _now()
        timestamp = _iso(current)
        next_run_at = _iso(
            _next_occurrence(payload.cadence, payload.timeOfDay, payload.daysOfWeek, current)
        )
        with self.lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT id FROM automation_schedules WHERE id = ?", (schedule_id,)
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail="Automation schedule not found")
            self._validate_schedule(connection, payload, exclude_schedule_id=schedule_id)
            connection.execute(
                """
                UPDATE automation_schedules
                SET project = ?, enabled = ?, cadence = ?, time_of_day = ?, days_of_week = ?,
                    misfire_policy = ?, max_delay_minutes = ?, keywords_text = ?,
                    cities_text = ?, new_job_target = ?, max_jobs = ?,
                    next_run_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.project,
                    int(payload.enabled),
                    payload.cadence,
                    payload.timeOfDay,
                    json.dumps(payload.daysOfWeek),
                    payload.misfirePolicy,
                    payload.maxDelayMinutes,
                    payload.keywordsText,
                    payload.citiesText,
                    payload.newJobTarget,
                    payload.maxJobs,
                    next_run_at,
                    timestamp,
                    schedule_id,
                ),
            )
            row = connection.execute(
                "SELECT * FROM automation_schedules WHERE id = ?", (schedule_id,)
            ).fetchone()
            last_run = connection.execute(
                "SELECT * FROM automation_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 1",
                (schedule_id,),
            ).fetchone()
            return self._schedule_dict(row, last_run)

    @staticmethod
    def _materialize_collection_config(payload: AutomationScheduleInput) -> AutomationScheduleInput:
        has_keywords = bool(payload.keywordsText.strip())
        has_cities = bool(payload.citiesText.strip())
        if has_keywords and has_cities:
            try:
                cities = text_to_cities(payload.citiesText)
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            if not cities:
                raise HTTPException(status_code=400, detail="Scheduled collection requires at least one city.")
            return payload
        if has_keywords != has_cities:
            raise HTTPException(
                status_code=400,
                detail="Scheduled collection requires both keywords and cities.",
            )
        current = config_payload(resolve_project(payload.project))
        return payload.model_copy(
            update={
                "keywordsText": str(current.get("keywordsText") or ""),
                "citiesText": str(current.get("citiesText") or ""),
                "newJobTarget": int(current.get("newJobTarget") or payload.newJobTarget),
                "maxJobs": int(current.get("maxJobs") or payload.maxJobs),
            }
        )

    def _validate_schedule(
        self,
        connection: sqlite3.Connection,
        payload: AutomationScheduleInput,
        exclude_schedule_id: str = "",
    ) -> None:
        rows = connection.execute(
            "SELECT * FROM automation_schedules WHERE id != ? ORDER BY created_at, id",
            (exclude_schedule_id,),
        ).fetchall()
        if not exclude_schedule_id and len(rows) >= MAX_AUTOMATION_SCHEDULES:
            raise HTTPException(
                status_code=409,
                detail=f"At most {MAX_AUTOMATION_SCHEDULES} automation schedules can be created.",
            )

        payload_signature = _schedule_signature(
            payload.project,
            payload.cadence,
            payload.timeOfDay,
            payload.daysOfWeek,
            payload.keywordsText,
            payload.citiesText,
            payload.newJobTarget,
            payload.maxJobs,
        )
        for row in rows:
            row_days = json.loads(row["days_of_week"] or "[]")
            if payload_signature == _schedule_signature(
                str(row["project"]),
                str(row["cadence"]),
                str(row["time_of_day"]),
                row_days,
                str(row["keywords_text"] or ""),
                str(row["cities_text"] or ""),
                int(row["new_job_target"] or 20),
                int(row["max_jobs"] or 100),
            ):
                raise HTTPException(
                    status_code=409,
                    detail="An identical automation schedule already exists. Edit or re-enable the existing schedule instead.",
                )

    def delete_schedule(self, schedule_id: str) -> dict:
        with self.lock, self._connect() as connection:
            active = connection.execute(
                "SELECT 1 FROM automation_runs WHERE schedule_id = ? AND status IN ('queued', 'running') LIMIT 1",
                (schedule_id,),
            ).fetchone()
            if active:
                raise HTTPException(status_code=409, detail="Cannot delete a schedule with a queued or running task")
            cursor = connection.execute(
                "DELETE FROM automation_schedules WHERE id = ?", (schedule_id,)
            )
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Automation schedule not found")
        return {"ok": True, "scheduleId": schedule_id}

    def run_now(self, schedule_id: str) -> dict:
        with self.lock, self._connect() as connection:
            schedule = connection.execute(
                "SELECT * FROM automation_schedules WHERE id = ?", (schedule_id,)
            ).fetchone()
            if not schedule:
                raise HTTPException(status_code=404, detail="Automation schedule not found")
            self._require_login(str(schedule["project"]))
            active = connection.execute(
                "SELECT * FROM automation_runs WHERE schedule_id = ? AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1",
                (schedule_id,),
            ).fetchone()
            if active:
                return self._run_dict(active)
            run = self._insert_run(connection, schedule, _now(), "manual", "queued")
        self._dispatch_next()
        return run

    def _insert_run(
        self,
        connection: sqlite3.Connection,
        schedule: sqlite3.Row,
        scheduled_for: dt.datetime,
        trigger: str,
        status: str,
        error: str = "",
    ) -> dict:
        run_id = uuid.uuid4().hex
        created_at = _iso(_now())
        finished_at = created_at if status == "missed" else ""
        connection.execute(
            """
            INSERT INTO automation_runs (
                id, schedule_id, project, trigger, scheduled_for, status,
                created_at, started_at, finished_at, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
            """,
            (
                run_id,
                schedule["id"],
                schedule["project"],
                trigger,
                _iso(scheduled_for),
                status,
                created_at,
                finished_at,
                error,
            ),
        )
        row = connection.execute("SELECT * FROM automation_runs WHERE id = ?", (run_id,)).fetchone()
        return self._run_dict(row)

    def _enqueue_due(self, current: dt.datetime) -> None:
        with self.lock, self._connect() as connection:
            schedules = connection.execute(
                "SELECT * FROM automation_schedules WHERE enabled = 1 ORDER BY next_run_at, created_at, id"
            ).fetchall()
            for schedule in schedules:
                due_at = dt.datetime.fromisoformat(schedule["next_run_at"]).astimezone()
                if due_at > current:
                    continue
                active = connection.execute(
                    "SELECT 1 FROM automation_runs WHERE schedule_id = ? AND status IN ('queued', 'running') LIMIT 1",
                    (schedule["id"],),
                ).fetchone()
                lateness_minutes = max(0, int((current - due_at).total_seconds() // 60))
                should_skip = schedule["misfire_policy"] == "skip" or lateness_minutes > int(schedule["max_delay_minutes"])
                if not active:
                    duplicate_rows = connection.execute(
                        """
                        SELECT candidate.*
                        FROM automation_runs AS run
                        JOIN automation_schedules AS candidate ON candidate.id = run.schedule_id
                        WHERE run.status IN ('queued', 'running') AND run.scheduled_for = ?
                        """,
                        (_iso(due_at),),
                    ).fetchall()
                    signature = _schedule_signature(
                        str(schedule["project"]),
                        str(schedule["cadence"]),
                        str(schedule["time_of_day"]),
                        json.loads(schedule["days_of_week"] or "[]"),
                        str(schedule["keywords_text"] or ""),
                        str(schedule["cities_text"] or ""),
                        int(schedule["new_job_target"] or 20),
                        int(schedule["max_jobs"] or 100),
                    )
                    is_legacy_duplicate = any(
                        candidate["id"] != schedule["id"]
                        and signature == _schedule_signature(
                            str(candidate["project"]),
                            str(candidate["cadence"]),
                            str(candidate["time_of_day"]),
                            json.loads(candidate["days_of_week"] or "[]"),
                            str(candidate["keywords_text"] or ""),
                            str(candidate["cities_text"] or ""),
                            int(candidate["new_job_target"] or 20),
                            int(candidate["max_jobs"] or 100),
                        )
                        for candidate in duplicate_rows
                    )
                    if is_legacy_duplicate:
                        self._insert_run(
                            connection,
                            schedule,
                            due_at,
                            "schedule",
                            "missed",
                            "An identical legacy schedule was already queued; duplicate run suppressed.",
                        )
                    elif should_skip:
                        self._insert_run(
                            connection,
                            schedule,
                            due_at,
                            "schedule",
                            "missed",
                            "Scheduled run was outside the configured catch-up window.",
                        )
                    else:
                        self._insert_run(connection, schedule, due_at, "schedule", "queued")
                next_run = _next_occurrence(
                    schedule["cadence"],
                    schedule["time_of_day"],
                    json.loads(schedule["days_of_week"] or "[]"),
                    current,
                )
                connection.execute(
                    "UPDATE automation_schedules SET next_run_at = ?, updated_at = ? WHERE id = ?",
                    (_iso(next_run), _iso(current), schedule["id"]),
                )

    def _crawl_payload(self, schedule: sqlite3.Row) -> CrawlRequest:
        project = str(schedule["project"])
        payload = config_payload(resolve_project(project))
        return CrawlRequest(
            project=project,
            keywordsText=str(schedule["keywords_text"]),
            citiesText=str(schedule["cities_text"]),
            newJobTarget=int(schedule["new_job_target"]),
            maxJobs=int(schedule["max_jobs"]),
            minSalary=payload["minSalary"],
            headlessMode=payload["headlessMode"],
            autoSqlite=payload["autoSqlite"],
            catRulesText=payload["catRulesText"],
            scoringRulesText=payload["scoringRulesText"],
            relevanceText=payload["relevanceText"],
            blacklistText=payload["blacklistText"],
            persistConfig=False,
        )

    def _dispatch_next(self) -> None:
        if self.task_manager.snapshot()["running"]:
            return
        with self.lock, self._connect() as connection:
            run = connection.execute(
                """
                SELECT * FROM automation_runs
                WHERE status = 'queued'
                ORDER BY scheduled_for, created_at, id
                LIMIT 1
                """
            ).fetchone()
            if not run:
                return
            started_at = _iso(_now())
            connection.execute(
                "UPDATE automation_runs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'",
                (started_at, run["id"]),
            )
            run_id = run["id"]
            project = run["project"]
            schedule = connection.execute(
                "SELECT * FROM automation_schedules WHERE id = ?",
                (run["schedule_id"],),
            ).fetchone()
            if not schedule:
                connection.execute(
                    """
                    UPDATE automation_runs
                    SET status = 'failed', finished_at = ?, error = ?
                    WHERE id = ?
                    """,
                    (_iso(_now()), "Automation schedule no longer exists.", run_id),
                )
                return

        try:
            self._require_login(project)
        except HTTPException as error:
            self._finish_run(run_id, False, str(error.detail))
            return

        def on_complete(success: bool, error: str) -> None:
            self._finish_run(run_id, success, error)

        try:
            starter = self.crawl_starter
            if starter is None:
                from backend.services.crawler_service import start_crawl_task

                starter = start_crawl_task
            starter(self._crawl_payload(schedule), self.task_manager, on_complete=on_complete)
        except HTTPException as error:
            if error.status_code == 409:
                with self.lock, self._connect() as connection:
                    connection.execute(
                        "UPDATE automation_runs SET status = 'queued', started_at = '' WHERE id = ?",
                        (run_id,),
                    )
                return
            self._finish_run(run_id, False, str(error.detail))
        except Exception as error:
            self._finish_run(run_id, False, str(error))

    def _finish_run(self, run_id: str, success: bool, error: str = "") -> None:
        stopped = str(error or "").strip().lower() == "stopped"
        with self.lock, self._connect() as connection:
            connection.execute(
                """
                UPDATE automation_runs
                SET status = ?, finished_at = ?, error = ?
                WHERE id = ?
                """,
                (
                    "succeeded" if success else "interrupted" if stopped else "failed",
                    _iso(_now()),
                    "" if stopped else str(error or "")[:4000],
                    run_id,
                ),
            )

    def _require_login(self, project: str) -> dict:
        state = self.login_state_reader(project)
        if not state.get("canSchedule"):
            raise HTTPException(
                status_code=409,
                detail=f"{project}: no usable BOSS login Cookie. Open System Settings, choose Login / Save Cookie, then retry.",
            )
        return state
