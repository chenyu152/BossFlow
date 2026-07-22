import contextlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.schemas.greeting import GreetingPrepareRequest
from backend.services import greeting_prepare_service, greeting_service
from backend.services.task_service import TaskManager


PIPELINE_ITEM = {
    "sourceKey": "agent:7",
    "project": "agent",
    "jobId": 7,
    "company": "示例公司",
    "title": "Agent 开发工程师",
    "url": "https://www.zhipin.com/job_detail/example-token.html",
}
MESSAGE = "您好，我对这个岗位很感兴趣，相关项目经历与岗位方向较匹配，希望进一步沟通。"


class GreetingValidationTests(unittest.TestCase):
    def test_preflight_returns_exact_target_and_requires_idle_task(self):
        with patch.object(greeting_service, "find_pipeline_item", return_value=PIPELINE_ITEM):
            result = greeting_service.preflight_greeting(
                "agent:7",
                MESSAGE,
                {"running": False},
            )
            busy = greeting_service.preflight_greeting(
                "agent:7",
                MESSAGE,
                {"running": True},
            )

        self.assertTrue(result["canProceed"])
        self.assertEqual(result["preview"]["jobId"], 7)
        self.assertTrue(result["preview"]["finalSendByUser"])
        self.assertFalse(busy["canProceed"])
        self.assertIn("其他浏览器任务", busy["errors"][0])

    def test_validation_blocks_empty_long_and_model_error_content(self):
        self.assertTrue(greeting_service.validate_greeting_message("太短"))
        self.assertTrue(greeting_service.validate_greeting_message("好" * 801))
        self.assertTrue(greeting_service.validate_greeting_message("Traceback: model error response"))
        self.assertEqual(greeting_service.validate_greeting_message(MESSAGE), [])


class GreetingPrepareTaskTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project_dir = Path(self.temp_dir.name) / "agent"
        self.project_dir.mkdir()
        (self.project_dir / "config.json").write_text("{}", encoding="utf-8")
        self.paths = {
            "profilePath": str(self.project_dir / ".chrome_profile"),
            "configPath": str(self.project_dir / "config.json"),
            "partialPath": str(self.project_dir / "crawl_partial.json"),
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_prepare_requires_explicit_confirmation(self):
        payload = GreetingPrepareRequest(sourceKey="agent:7", message=MESSAGE, confirmed=False)
        with (
            patch.object(greeting_prepare_service, "resolve_project", return_value=self.project_dir),
            patch.object(greeting_prepare_service, "project_workspace", side_effect=lambda _: contextlib.nullcontext()),
            patch.object(greeting_prepare_service, "preflight_greeting", return_value={"canProceed": True, "errors": [], "preview": {}}),
            patch.object(greeting_prepare_service, "find_pipeline_item", return_value=PIPELINE_ITEM),
        ):
            with self.assertRaises(HTTPException) as caught:
                greeting_prepare_service.start_greeting_prepare_task(payload, TaskManager())
        self.assertIn("确认窗口", str(caught.exception.detail))

    def test_prepare_records_prepared_without_sending(self):
        updates = []
        saved = []
        runner_calls = []
        payload = GreetingPrepareRequest(sourceKey="agent:7", message=MESSAGE, confirmed=True)

        def runner(item, message, paths, task_manager):
            runner_calls.append((item, message, paths))

        def update(source_key, message, status, **kwargs):
            updates.append((source_key, status, kwargs.get("error", "")))
            return {"ok": True}

        def save(source_key, message, status):
            saved.append(status)
            return {"draft": {"sourceKey": source_key, "status": status, "editedText": message}}

        manager = TaskManager()
        with (
            patch.object(greeting_prepare_service, "resolve_project", return_value=self.project_dir),
            patch.object(greeting_prepare_service, "paths_for_project", return_value=self.paths),
            patch.object(greeting_prepare_service, "project_workspace", side_effect=lambda _: contextlib.nullcontext()),
            patch.object(greeting_prepare_service, "preflight_greeting", return_value={"canProceed": True, "errors": [], "preview": {"sourceKey": "agent:7"}}),
            patch.object(greeting_prepare_service, "find_pipeline_item", return_value=PIPELINE_ITEM),
            patch.object(greeting_prepare_service, "update_greeting_prepare_result", side_effect=update),
            patch.object(greeting_prepare_service, "save_greeting_draft", side_effect=save),
        ):
            result = greeting_prepare_service.start_greeting_prepare_task(
                payload,
                manager,
                browser_runner=runner,
            )
            manager.worker.join(timeout=2)

        self.assertEqual(result["status"], "preparing")
        self.assertEqual(saved, ["preparing"])
        self.assertEqual(updates, [("agent:7", "prepared", "")])
        self.assertEqual(len(runner_calls), 1)
        self.assertFalse(manager.snapshot()["running"])

    def test_prepare_failure_is_not_recorded_as_sent_or_prepared(self):
        updates = []
        payload = GreetingPrepareRequest(sourceKey="agent:7", message=MESSAGE, confirmed=True)

        def runner(*_args):
            raise RuntimeError("target mismatch")

        def update(source_key, message, status, **kwargs):
            updates.append((status, kwargs.get("error", "")))
            return {"ok": True}

        manager = TaskManager()
        with (
            patch.object(greeting_prepare_service, "resolve_project", return_value=self.project_dir),
            patch.object(greeting_prepare_service, "paths_for_project", return_value=self.paths),
            patch.object(greeting_prepare_service, "project_workspace", side_effect=lambda _: contextlib.nullcontext()),
            patch.object(greeting_prepare_service, "preflight_greeting", return_value={"canProceed": True, "errors": [], "preview": {}}),
            patch.object(greeting_prepare_service, "find_pipeline_item", return_value=PIPELINE_ITEM),
            patch.object(greeting_prepare_service, "update_greeting_prepare_result", side_effect=update),
            patch.object(greeting_prepare_service, "save_greeting_draft", return_value={"draft": {"status": "preparing"}}),
        ):
            greeting_prepare_service.start_greeting_prepare_task(payload, manager, browser_runner=runner)
            manager.worker.join(timeout=2)

        self.assertEqual(updates, [("prepare_failed", "target mismatch")])
        self.assertEqual(manager.snapshot()["status"], "failed")


class BrowserPreparationTests(unittest.TestCase):
    def _run_browser_flow(self, entry_label):
        scripts = []
        observed = {}

        class FakeStates:
            is_displayed = True

        class FakeElement:
            def __init__(self, text=""):
                self.text = text
                self.states = FakeStates()
                self.click_count = 0
                self.inputs = []
                self.value = ""

            def click(self, timeout=0):
                self.click_count += 1
                self.click_timeout = timeout
                return self

            def input(self, value, clear=False):
                self.inputs.append((value, clear))
                self.value = value
                return self

        entry = FakeElement(entry_label)
        chat_input = FakeElement()

        class FakePage:
            url = PIPELINE_ITEM["url"]

            def get(self, _url):
                return None

            def eles(self, locator, timeout=None):
                observed["entry_locator"] = locator
                observed["entry_timeout"] = timeout
                return [entry]

            def ele(self, locator, timeout=None):
                observed["input_locator"] = locator
                observed["input_timeout"] = timeout
                return chat_input if locator == "#chat-input" else None

            def run_js(self, script):
                scripts.append(script)
                if "document.body?.innerText" in script:
                    return f"{PIPELINE_ITEM['company']} {PIPELINE_ITEM['title']}"
                if "#chat-input" in script:
                    return chat_input.value
                return None

        class FakeCrawler:
            def __init__(self, **_kwargs):
                self.page = FakePage()

            def start_browser(self, headless=False):
                self.headless = headless

        manager = TaskManager()
        with (
            patch.object(greeting_prepare_service, "BossCrawler", FakeCrawler),
            patch.object(greeting_prepare_service, "find_free_port", return_value=9222),
            patch.object(greeting_prepare_service.time, "sleep", return_value=None),
            patch("crawler.platform_utils.activate_chrome"),
        ):
            greeting_prepare_service._prepare_greeting_in_browser(
                PIPELINE_ITEM,
                MESSAGE,
                self.paths if hasattr(self, "paths") else {
                    "profilePath": "profile", "configPath": "config", "partialPath": "partial"
                },
                manager,
            )

        joined = "\n".join(scripts)
        self.assertIn("#chat-input", joined)
        self.assertIn("立即沟通", observed["entry_locator"])
        self.assertIn("继续沟通", observed["entry_locator"])
        self.assertEqual(entry.click_count, 1)
        self.assertEqual(chat_input.inputs, [(MESSAGE, True)])
        self.assertNotIn("KeyboardEvent", joined)
        self.assertNotIn("Enter", joined)
        return entry, chat_input

    def test_first_contact_clicks_start_chat_then_fills_without_sending(self):
        self._run_browser_flow("立即沟通")

    def test_existing_contact_clicks_continue_chat_then_fills_without_sending(self):
        self._run_browser_flow("继续沟通")


if __name__ == "__main__":
    unittest.main()
