import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import greeting_service
from backend.services.greeting_service import extract_greeting_options, extract_greeting_text


class GreetingDraftExtractionTests(unittest.TestCase):
    def test_extracts_two_labeled_greeting_options(self):
        report = """
## F. Boss 打招呼草稿
### 话术 1（突出 Agent 项目经验）

> 您好，我有完整的 LangGraph Agent 开发经验，希望进一步沟通。

### 话术 2（突出技术栈匹配）

> 您好，我的 RAG 与 Tool Calling 经历和岗位较匹配，期待交流。

## G. 下一步动作
先收藏。
"""

        options = extract_greeting_options(report)

        self.assertEqual(2, len(options))
        self.assertEqual("您好，我有完整的 LangGraph Agent 开发经验，希望进一步沟通。", options[0])
        self.assertEqual("您好，我的 RAG 与 Tool Calling 经历和岗位较匹配，期待交流。", options[1])
        self.assertEqual(options[0], extract_greeting_text(report))

    def test_ignores_legacy_numbered_options(self):
        report = """
## F. Boss 打招呼草稿
1. 您好，我参与过 Agent 项目研发，希望进一步沟通。
2. 您好，我熟悉 RAG 与向量数据库，期待了解岗位详情。
---BOSSSPIDER_LLM_SUMMARY---
"""

        self.assertEqual([], extract_greeting_options(report))

    def test_requires_exact_latest_headings(self):
        valid_report = """
## F. Boss 打招呼草稿
### 话术 1（突出 Agent 项目经验）
你好，我有完整的 LangGraph Agent 开发经验，希望进一步沟通。
### 话术 2（突出技术栈匹配）
你好，我的 RAG 与 Tool Calling 经历和岗位比较匹配，期待交流。
"""
        self.assertEqual(2, len(extract_greeting_options(valid_report)))

        for heading_pair in (
            ("话术 1：", "话术 2："),
            ("## 话术 1（经验）", "## 话术 2（匹配）"),
            ("#### 话术 1（经验）", "#### 话术 2（匹配）"),
            ("### 话术 1(经验)", "### 话术 2(匹配)"),
            ("### 话术 1（经验）", "### 话术 1（匹配）"),
        ):
            report = f"""
## F. Boss 打招呼草稿
{heading_pair[0]}
你好，我有完整的 Agent 项目经验，希望进一步沟通。
{heading_pair[1]}
你好，我熟悉岗位需要的技术栈，期待进一步交流。
"""
            self.assertEqual([], extract_greeting_options(report), heading_pair)


class GreetingDraftSyncTests(unittest.TestCase):
    def _item(self, report_id: str, report_path: str) -> dict[str, str]:
        return {
            "sourceKey": "job-1",
            "project": "demo",
            "jobId": "job-1",
            "company": "示例公司",
            "title": "Agent 开发",
            "reportId": report_id,
            "reportPath": report_path,
        }

    def test_report_change_resets_draft_to_latest_options(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            drafts_path = root / "greeting-drafts.json"
            lock_path = root / "greeting.lock"
            events_path = root / "greeting-events.jsonl"
            reports = {
                "r1": "## F. Boss \\u6253\\u62db\\u547c\\u8349\\u7a3f\n### 话术 1（项目经验）\n旧版本问候语内容足够长。\n### 话术 2（技术匹配）\n旧版本第二条问候语内容足够长。",
                "r2": "## F. Boss \\u6253\\u62db\\u547c\\u8349\\u7a3f\n### 话术 1（最新项目）\n最新版本第一条问候语内容足够长。\n### 话术 2（最新匹配）\n最新版本第二条问候语内容足够长。",
            }
            current_item = self._item("r1", "report-r1.md")

            def report_text(path: str) -> str:
                return reports[current_item["reportId"]]

            with patch.object(greeting_service, "GREETINGS_DIR", root), \
                 patch.object(greeting_service, "GREETING_DRAFTS_PATH", drafts_path), \
                 patch.object(greeting_service, "GREETING_LOCK_PATH", lock_path), \
                 patch.object(greeting_service, "GREETING_EVENTS_PATH", events_path), \
                 patch.object(greeting_service, "find_pipeline_item", side_effect=lambda _: current_item), \
                 patch.object(greeting_service, "_safe_report_text", side_effect=report_text):
                first = greeting_service.sync_greeting_draft_from_report("job-1")
                self.assertEqual("r1", first["sourceReportId"])
                self.assertEqual("旧版本问候语内容足够长。", first["draftText"])

                first["editedText"] = "用户手动编辑过的内容"
                first["status"] = "edited"
                drafts_path.write_text(json.dumps({"version": 1, "drafts": [first]}, ensure_ascii=False), encoding="utf-8")

                current_item = self._item("r2", "report-r2.md")
                refreshed = greeting_service.sync_greeting_draft_from_report("job-1")

            self.assertEqual("r2", refreshed["sourceReportId"])
            self.assertEqual(
                ["最新版本第一条问候语内容足够长。", "最新版本第二条问候语内容足够长。"],
                refreshed["draftOptions"],
            )
            self.assertEqual(refreshed["draftOptions"][0], refreshed["draftText"])
            self.assertEqual("draft", refreshed["status"])
            self.assertEqual("", refreshed["editedText"])

    def test_legacy_draft_without_options_is_migrated(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            drafts_path = root / "greeting-drafts.json"
            lock_path = root / "greeting.lock"
            item = self._item("r1", "report-r1.md")
            existing = self._item("r1", "report-r1.md") | {
                "channel": "boss",
                "draftText": "旧格式草稿",
                "editedText": "",
                "status": "draft",
                "sourceReportPath": "report-r1.md",
                "sourceReportId": "r1",
                "draftOptions": [],
            }
            drafts_path.write_text(json.dumps({"version": 1, "drafts": [existing]}, ensure_ascii=False), encoding="utf-8")

            with patch.object(greeting_service, "GREETINGS_DIR", root), \
                 patch.object(greeting_service, "GREETING_DRAFTS_PATH", drafts_path), \
                 patch.object(greeting_service, "GREETING_LOCK_PATH", lock_path), \
                 patch.object(greeting_service, "find_pipeline_item", return_value=item), \
                 patch.object(greeting_service, "_safe_report_text", return_value="""
## F. Boss 打招呼草稿
### 话术 1（项目经验）
迁移后的第一条问候语内容足够长。
### 话术 2（技术匹配）
迁移后的第二条问候语内容足够长。
"""):
                refreshed = greeting_service.sync_greeting_draft_from_report("job-1")

            self.assertEqual(
                ["迁移后的第一条问候语内容足够长。", "迁移后的第二条问候语内容足够长。"],
                refreshed["draftOptions"],
            )
            self.assertEqual("draft", refreshed["status"])


if __name__ == "__main__":
    unittest.main()
