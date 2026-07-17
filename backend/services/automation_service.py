from __future__ import annotations

import datetime as dt
import json
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional

from fastapi import HTTPException

from backend.schemas.automation import AutomationScheduleInput
from backend.schemas.config import CrawlRequest
from backend.services.project_service import config_payload, resolve_project
from backend.services.login_state_service import login_state
from backend.services.task_service import TaskManager
from backend.storage.paths import BASE_DIR


CrawlStarter = Callable[..., dict]
LoginStateReader = Callable[[str], dict]


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
        return {
            "id": row["id"],
            "project": row["project"],
            "enabled": bool(row["enabled"]),
            "cadence": row["cadence"],
            "timeOfDay": row["time_of_day"],
            "daysOfWeek": json.loads(row["days_of_week"] or "[]"),
            "misfirePolicy": row["misfire_policy"],
            "maxDelayMinutes": int(row["max_delay_minutes"]),
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
        }

    def create_schedule(self, payload: AutomationScheduleInput) -> dict:
        resolve_project(payload.project)
        if payload.enabled:
            self._require_login(payload.project)
        current = _now()
        schedule_id = uuid.uuid4().hex
        timestamp = _iso(current)
        next_run_at = _iso(
            _next_occurrence(payload.cadence, payload.timeOfDay, payload.daysOfWeek, current)
        )
        with self.lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO automation_schedules (
                    id, project, enabled, cadence, time_of_day, days_of_week,
                    misfire_policy, max_delay_minutes, next_run_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            connection.execute(
                """
                UPDATE automation_schedules
                SET project = ?, enabled = ?, cadence = ?, time_of_day = ?, days_of_week = ?,
                    misfire_policy = ?, max_delay_minutes = ?, next_run_at = ?, updated_at = ?
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
                    if should_skip:
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

    def _crawl_payload(self, project: str) -> CrawlRequest:
        payload = config_payload(resolve_project(project))
        return CrawlRequest(
            project=project,
            keywordsText=payload["keywordsText"],
            citiesText=payload["citiesText"],
            scrollTarget=payload["scrollTarget"],
            scrollMax=payload["scrollMax"],
            minSalary=payload["minSalary"],
            headlessMode=payload["headlessMode"],
            autoSqlite=payload["autoSqlite"],
            catRulesText=payload["catRulesText"],
            scoringRulesText=payload["scoringRulesText"],
            relevanceText=payload["relevanceText"],
            blacklistText=payload["blacklistText"],
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
            starter(self._crawl_payload(project), self.task_manager, on_complete=on_complete)
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
        with self.lock, self._connect() as connection:
            connection.execute(
                """
                UPDATE automation_runs
                SET status = ?, finished_at = ?, error = ?
                WHERE id = ?
                """,
                (
                    "succeeded" if success else "failed",
                    _iso(_now()),
                    str(error or "")[:4000],
                    run_id,
                ),
            )

    def _require_login(self, project: str) -> dict:
        state = self.login_state_reader(project)
        if not state.get("canSchedule"):
            raise HTTPException(
                status_code=409,
                detail=f"{project}: no usable BOSS login Cookie. Open Discover Jobs, choose Login / Save Cookie, then retry.",
            )
        return state
