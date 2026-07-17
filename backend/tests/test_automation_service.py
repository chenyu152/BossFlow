import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.schemas.automation import AutomationScheduleInput
from backend.services.automation_service import AutomationService


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
        self.payload = patch.object(self.service, "_crawl_payload", side_effect=lambda project: project)
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

    def test_enabled_schedule_requires_saved_login(self):
        self.service.login_state_reader = lambda _project: {"canSchedule": False}
        with self.assertRaisesRegex(Exception, "no usable BOSS login Cookie"):
            self.service.create_schedule(self.schedule("agent"))


if __name__ == "__main__":
    unittest.main()
