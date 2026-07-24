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

    def test_stop_requests_graceful_shutdown_and_marks_task_stopped(self):
        manager = TaskManager()
        started = threading.Event()
        stopped = threading.Event()
        completed = threading.Event()
        callback_result = []

        class FakeCrawler:
            def request_stop(self):
                stopped.set()

        crawler = FakeCrawler()

        def target():
            manager.current_crawler = crawler
            started.set()
            self.assertTrue(stopped.wait(1))

        def on_complete(success, error):
            callback_result.append((success, error))
            completed.set()

        manager.start("crawling", target, on_complete=on_complete)
        self.assertTrue(started.wait(1))
        manager.stop()

        self.assertTrue(completed.wait(1))
        self.assertEqual(manager.snapshot()["status"], "stopped")
        self.assertFalse(manager.snapshot()["running"])
        self.assertEqual(callback_result, [(False, "stopped")])


if __name__ == "__main__":
    unittest.main()
