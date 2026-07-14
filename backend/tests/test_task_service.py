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


if __name__ == "__main__":
    unittest.main()
