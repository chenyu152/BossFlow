import threading
import unittest

from backend.services.task_service import TaskManager


class TaskServiceTest(unittest.TestCase):
    def test_marks_crawl_authenticated_for_frontend_onboarding(self):
        manager = TaskManager()

        self.assertFalse(manager.snapshot()["crawlAuthenticated"])
        manager.mark_crawl_authenticated()

        snapshot = manager.snapshot()
        self.assertTrue(snapshot["crawlAuthenticated"])
        self.assertIn("Cookie 已生效", snapshot["logs"][-1])

    def test_invokes_completion_callback_after_task_state_is_released(self):
        manager = TaskManager()
        completed = threading.Event()
        result = []

        def on_complete(success, error):
            result.append((success, error, manager.snapshot()["running"]))
            completed.set()

        manager.start("crawling", lambda: None, on_complete=on_complete)

        self.assertTrue(completed.wait(1))
        self.assertEqual(result, [(True, "", False)])


if __name__ == "__main__":
    unittest.main()
