import tempfile
import unittest
import sqlite3
from pathlib import Path
from unittest.mock import patch

from backend.schemas.automation import AutomationScheduleInput
from backend.services.automation_service import AutomationService, _collection_estimate


class FakeTaskManager:
    def __init__(self):
        self.running = False

    def snapshot(self):
        return {"running": self.running}


class AutomationServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.manager = FakeTaskManager()
        self.callbacks = []
        self.started_projects = []

        def start_crawl(payload, manager, on_complete=None):
            manager.running = True
            self.started_projects.append(payload)
            self.callbacks.append(on_complete)
            return {"ok": True}

        self.service = AutomationService(
            self.manager,
            db_path=Path(self.temp_dir.name) / "automation.db",
            crawl_starter=start_crawl,
            login_state_reader=lambda _project: {"canSchedule": True},
            poll_seconds=0.01,
        )
        self.resolve_project = patch(
            "backend.services.automation_service.resolve_project",
            side_effect=lambda project: project,
        )
        self.resolve_project.start()
        self.addCleanup(self.resolve_project.stop)
        self.addCleanup(self.temp_dir.cleanup)
        self.payload = patch.object(
            self.service,
            "_crawl_payload",
            side_effect=lambda schedule: schedule["project"],
        )
        self.payload.start()
        self.addCleanup(self.payload.stop)

    @staticmethod
    def schedule(project):
        return AutomationScheduleInput(
            project=project,
            enabled=True,
            cadence="daily",
            timeOfDay="09:00",
            daysOfWeek=[],
            misfirePolicy="run_once",
            maxDelayMinutes=360,
            keywordsText="Agent 开发",
            citiesText="深圳=101280600",
            newJobTarget=20,
            maxJobs=100,
        )

    def test_simultaneous_manual_runs_are_dispatched_serially(self):
        first = self.service.create_schedule(self.schedule("agent"))
        second = self.service.create_schedule(self.schedule("embedded"))

        self.service.run_now(first["id"])
        self.service.run_now(second["id"])

        self.assertEqual(self.started_projects, ["agent"])
        self.assertEqual(self.service.snapshot()["queue"], {
            "queued": 1,
            "running": 1,
            "serial": True,
            "schedulerRunning": False,
            "lastError": "",
        })

        self.manager.running = False
        self.callbacks[0](True, "")
        self.service.tick()
        self.assertEqual(self.started_projects, ["agent", "embedded"])

        self.manager.running = False
        self.callbacks[1](True, "")
        runs = self.service.list_runs()
        self.assertEqual([run["status"] for run in runs], ["succeeded", "succeeded"])

    def test_duplicate_run_now_reuses_active_run(self):
        schedule = self.service.create_schedule(self.schedule("agent"))

        first = self.service.run_now(schedule["id"])
        second = self.service.run_now(schedule["id"])

        self.assertEqual(first["id"], second["id"])
        self.assertEqual(len(self.service.list_runs()), 1)
        self.assertEqual(self.started_projects, ["agent"])

    def test_user_stopped_run_is_recorded_as_interrupted(self):
        schedule = self.service.create_schedule(self.schedule("agent"))
        self.service.run_now(schedule["id"])

        self.manager.running = False
        self.callbacks[0](False, "stopped")

        run = self.service.list_runs()[0]
        self.assertEqual(run["status"], "interrupted")
        self.assertEqual(run["error"], "")

    def test_enabled_schedule_requires_saved_login(self):
        self.service.login_state_reader = lambda _project: {"canSchedule": False}
        with self.assertRaisesRegex(Exception, "no usable BOSS login Cookie"):
            self.service.create_schedule(self.schedule("agent"))

    def test_identical_schedule_is_rejected_but_different_scope_is_allowed(self):
        self.service.create_schedule(self.schedule("agent"))
        with self.assertRaisesRegex(Exception, "identical automation schedule"):
            self.service.create_schedule(self.schedule("agent"))
        same_actual_days = self.schedule("agent").model_copy(
            update={"cadence": "weekly", "daysOfWeek": list(range(7))}
        )
        with self.assertRaisesRegex(Exception, "identical automation schedule"):
            self.service.create_schedule(same_actual_days)

        different = self.schedule("agent").model_copy(update={"keywordsText": "RAG 开发"})
        created = self.service.create_schedule(different)
        self.assertEqual(created["keywordsText"], "RAG 开发")

    def test_schedule_exposes_collection_estimate(self):
        created = self.service.create_schedule(self.schedule("agent"))
        self.assertEqual(created["combinationCount"], 1)
        self.assertGreater(created["estimatedListedJobs"], 0)
        self.assertGreaterEqual(created["estimatedDetailJobs"], 0)
        self.assertGreaterEqual(created["estimatedReusedJobs"], 0)
        self.assertEqual(created["estimatedStopCondition"], "new_job_target")
        self.assertGreater(created["estimatedMinutes"], 0)
        self.assertEqual(len(created["estimatedRangeMinutes"]), 2)
        self.assertLessEqual(
            created["estimatedRangeMinutes"][1],
            max(2, created["estimatedMinutes"] * 1.2 + 1),
        )

    def test_estimate_honors_whichever_collection_limit_is_reached_first(self):
        estimate = _collection_estimate(
            "Agent 开发",
            "深圳=101280600",
            new_job_target=50,
            max_jobs=30,
            existing_job_count=100,
        )
        self.assertEqual(estimate["estimatedListedJobs"], 30)
        self.assertEqual(estimate["estimatedStopCondition"], "max_jobs")

    def test_legacy_scroll_target_migrates_to_dual_limits(self):
        legacy_db = Path(self.temp_dir.name) / "legacy-automation.db"
        connection = sqlite3.connect(legacy_db)
        try:
            connection.execute(
                """
                CREATE TABLE automation_schedules (
                    id TEXT PRIMARY KEY, project TEXT NOT NULL, enabled INTEGER NOT NULL,
                    cadence TEXT NOT NULL, time_of_day TEXT NOT NULL,
                    days_of_week TEXT NOT NULL, misfire_policy TEXT NOT NULL,
                    max_delay_minutes INTEGER NOT NULL, keywords_text TEXT NOT NULL,
                    cities_text TEXT NOT NULL, scroll_target INTEGER NOT NULL,
                    next_run_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                INSERT INTO automation_schedules VALUES (
                    'legacy', 'agent', 0, 'daily', '09:00', '[]', 'run_once',
                    360, 'Agent 开发', '深圳=101280600', 160,
                    '2026-07-20T09:00:00+08:00', 'now', 'now'
                )
                """
            )
            connection.commit()
        finally:
            connection.close()
        migrated = AutomationService(
            self.manager,
            db_path=legacy_db,
            crawl_starter=lambda *_args, **_kwargs: {"ok": True},
            login_state_reader=lambda _project: {"canSchedule": True},
        )
        schedule = migrated.list_schedules()[0]
        self.assertEqual(schedule["newJobTarget"], 20)
        self.assertEqual(schedule["maxJobs"], 100)
        connection = sqlite3.connect(legacy_db)
        try:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            connection.execute("PRAGMA journal_mode=DELETE")
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
