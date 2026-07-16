import asyncio
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from backend.mcp_server import create_bossflow_mcp


class FakeTaskManager:
    def snapshot(self):
        return {"running": False, "status": "idle", "logs": ["one", "two"]}


class McpServerTest(unittest.TestCase):
    def setUp(self):
        self.server = create_bossflow_mcp(FakeTaskManager())

    def call(self, name, arguments):
        _, structured = asyncio.run(self.server.call_tool(name, arguments))
        return structured

    def test_exposes_v1_tools_with_safety_annotations(self):
        tools = {tool.name: tool for tool in asyncio.run(self.server.list_tools())}

        self.assertIn("search_jobs", tools)
        self.assertIn("add_candidate_jobs", tools)
        self.assertTrue(tools["search_jobs"].annotations.readOnlyHint)
        self.assertFalse(tools["add_candidate_jobs"].annotations.readOnlyHint)

    def test_lists_projects_as_structured_output(self):
        with (
            patch("backend.mcp_server.project_names", return_value=["agent"]),
            patch("backend.mcp_server.default_project_name", return_value="agent"),
        ):
            result = self.call("list_projects", {})

        self.assertEqual(result, {"projects": ["agent"], "defaultProject": "agent"})

    def test_candidate_write_requires_preview_then_confirmation(self):
        project_dir = Path("projects/agent")
        jobs = [{"id": 7, "company": "Example", "title": "Agent Engineer"}]
        pipeline = {"pending": [], "processed": [], "counts": {"pending": 0, "processed": 0}}
        with (
            patch("backend.mcp_server.resolve_project", return_value=project_dir),
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.get_jobs_by_ids", return_value=jobs),
            patch("backend.mcp_server.read_pipeline", return_value=pipeline),
            patch("backend.mcp_server.add_jobs_to_pipeline") as add,
        ):
            preview = self.call("add_candidate_jobs", {"project": "agent", "job_ids": [7]})

        self.assertTrue(preview["requiresConfirmation"])
        self.assertEqual(preview["details"]["jobs"][0]["sourceKey"], "agent:7")
        add.assert_not_called()

    def test_task_status_limits_log_tail(self):
        result = self.call("get_task_status", {})
        self.assertEqual(result["status"], "idle")
        self.assertEqual(result["logs"], ["one", "two"])

    def test_imported_story_drafts_remain_preview_only_without_confirmation(self):
        with (
            patch("backend.mcp_server.resolve_project", return_value=Path("projects/agent")),
            patch("backend.mcp_server.save_story_drafts") as save,
        ):
            result = self.call(
                "save_imported_story_drafts",
                {
                    "project": "agent",
                    "drafts": [{"title": "Recovered a failing integration", "source": "tests/test_api.py:42"}],
                },
            )

        self.assertTrue(result["requiresConfirmation"])
        self.assertTrue(result["details"]["drafts"][0]["draftId"].startswith("draft-"))
        save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
