import asyncio
import copy
import tempfile
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
        self.assertIn("get_capability", tools)
        self.assertIn("get_base_resume", tools)
        self.assertIn("list_tailored_resumes", tools)
        self.assertIn("get_tailored_resume", tools)
        self.assertIn("update_base_resume", tools)
        self.assertIn("update_tailored_resume", tools)
        self.assertIn("add_candidate_jobs", tools)
        self.assertTrue(tools["search_jobs"].annotations.readOnlyHint)
        self.assertTrue(tools["get_base_resume"].annotations.readOnlyHint)
        self.assertFalse(tools["update_base_resume"].annotations.readOnlyHint)
        self.assertFalse(tools["add_candidate_jobs"].annotations.readOnlyHint)
        self.assertIn("已采集岗位", tools["search_jobs"].description)

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
        self.assertTrue(preview["confirmationId"])
        self.assertEqual(preview["details"]["jobs"][0]["sourceKey"], "agent:7")
        add.assert_not_called()

    def test_confirmation_is_bound_to_parameters_and_one_use(self):
        project_dir = Path("projects/agent")
        jobs = [{"id": 7, "company": "Example", "title": "Agent Engineer"}]
        pipeline = {"pending": [], "processed": [], "counts": {"pending": 0, "processed": 0}}
        with (
            patch("backend.mcp_server.resolve_project", return_value=project_dir),
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.get_jobs_by_ids", return_value=jobs),
            patch("backend.mcp_server.read_pipeline", return_value=pipeline),
            patch("backend.mcp_server.add_jobs_to_pipeline", return_value={"ok": True}) as add,
        ):
            preview = self.call("add_candidate_jobs", {"project": "agent", "job_ids": [7]})
            with self.assertRaises(Exception):
                self.call("add_candidate_jobs", {"project": "agent", "job_ids": [8], "confirmation_id": preview["confirmationId"]})
            second_preview = self.call("add_candidate_jobs", {"project": "agent", "job_ids": [7]})
            result = self.call("add_candidate_jobs", {"project": "agent", "job_ids": [7], "confirmation_id": second_preview["confirmationId"]})
            self.assertTrue(result["ok"])
            with self.assertRaises(Exception):
                self.call("add_candidate_jobs", {"project": "agent", "job_ids": [7], "confirmation_id": second_preview["confirmationId"]})
        add.assert_called_once()

    def test_task_status_limits_log_tail(self):
        result = self.call("get_task_status", {})
        self.assertEqual(result["status"], "idle")
        self.assertEqual(result["logs"], ["one", "two"])

    def test_job_search_is_compact_by_default_and_full_on_request(self):
        project_dir = Path("projects/agent")
        payload = {
            "items": [{
                "id": 7,
                "title": "Agent Engineer",
                "company": "Example",
                "city": "深圳",
                "salary": "30-50K",
                "desc": "long jd",
                "score": 4.2,
            }],
            "total": 3,
            "offset": 0,
            "limit": 1,
        }
        with (
            patch("backend.mcp_server.resolve_project", return_value=project_dir),
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.query_jobs", side_effect=lambda *args, **kwargs: copy.deepcopy(payload)),
        ):
            summary = self.call("search_jobs", {"project": "agent", "limit": 1})
            full = self.call("search_jobs", {"project": "agent", "limit": 1, "detail_level": "full"})

        self.assertNotIn("desc", summary["items"][0])
        self.assertEqual(summary["nextOffset"], 1)
        self.assertTrue(summary["hasMore"])
        self.assertEqual(full["items"][0]["desc"], "long jd")

    def test_pipeline_uses_summary_projection_and_pagination(self):
        project_dir = Path("projects/agent")
        pipeline = {
            "path": "pipeline.md",
            "schemaVersion": 2,
            "pending": [
                {"sourceKey": "agent:1", "title": "One", "raw": "large raw one"},
                {"sourceKey": "agent:2", "title": "Two", "raw": "large raw two"},
            ],
            "processed": [],
            "counts": {"pending": 2, "processed": 0},
        }
        with (
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.read_pipeline", return_value=pipeline),
        ):
            result = self.call("get_pipeline", {"project": "agent", "limit": 1})

        self.assertEqual(result["pending"][0]["sourceKey"], "agent:1")
        self.assertNotIn("raw", result["pending"][0])
        self.assertTrue(result["pagination"]["pending"]["hasMore"])
        self.assertEqual(result["pagination"]["pending"]["nextOffset"], 1)

    def test_capability_list_is_compact_and_detail_is_available(self):
        project_dir = Path("projects/agent")
        capability = {
            "capabilityId": "cap-python",
            "canonicalKey": "python",
            "label": "Python",
            "status": "mastered",
            "jobCount": 8,
            "requirements": [{"requirementId": "req-1", "jdQuote": "long quote"}],
        }
        payload = {"ok": True, "capabilities": [capability], "returned": 1, "total": 1}
        with (
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.list_capabilities", return_value=payload),
        ):
            listing = self.call("get_capabilities", {"project": "agent"})
            detail = self.call("get_capability", {"project": "agent", "capability_id": "cap-python"})

        self.assertNotIn("requirements", listing["capabilities"][0])
        self.assertEqual(detail["capability"]["requirements"][0]["requirementId"], "req-1")

    def test_evidence_defaults_to_summary(self):
        project_dir = Path("projects/agent")
        overview = {
            "ok": True,
            "schemaVersion": 4,
            "updatedAt": "now",
            "counts": {"requirements": 1},
            "capabilityCounts": {"capabilities": 1},
            "requirements": [{"requirementId": "req-1", "jdQuote": "long quote"}],
            "coverages": [{"requirementId": "req-1"}],
            "capabilities": [{"capabilityId": "cap-1", "label": "Python", "requirements": [{"jdQuote": "long"}]}],
            "evidenceItems": [],
            "tasks": [],
            "constraints": [],
        }
        with (
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.read_evidence_overview", return_value=overview),
        ):
            summary = self.call("get_evidence", {"project": "agent"})
            full = self.call("get_evidence", {"project": "agent", "detail_level": "full"})

        self.assertNotIn("requirements", summary)
        self.assertNotIn("requirements", summary["capabilities"][0])
        self.assertEqual(full["requirements"][0]["requirementId"], "req-1")

    def test_application_context_only_includes_target_evidence(self):
        project_dir = Path("projects/agent")
        pipeline = {
            "pending": [{"sourceKey": "agent:7", "jobId": 7, "title": "Agent Engineer", "raw": "large"}],
            "processed": [],
        }
        overview = {
            "requirements": [
                {"requirementId": "req-target", "sourceKey": "agent:7", "label": "Python"},
                {"requirementId": "req-other", "sourceKey": "agent:8", "label": "Java"},
            ],
            "coverages": [
                {"requirementId": "req-target", "coverageStatus": "supported"},
                {"requirementId": "req-other", "coverageStatus": "gap"},
            ],
            "capabilities": [
                {"capabilityId": "cap-target", "label": "Python", "sourceKeys": ["agent:7"], "requirementIds": ["req-target"]},
                {"capabilityId": "cap-other", "label": "Java", "sourceKeys": ["agent:8"], "requirementIds": ["req-other"]},
            ],
            "evidenceItems": [],
            "tasks": [],
        }
        with (
            patch("backend.mcp_server.project_from_source_key", return_value="agent"),
            patch("backend.mcp_server.resolve_project", return_value=project_dir),
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.read_pipeline", return_value=pipeline),
            patch("backend.mcp_server.read_pipeline_report", return_value={"reportId": "report-1", "content": "large report"}),
            patch("backend.mcp_server.get_job_by_id", return_value={"id": 7, "desc": "JD"}),
            patch("backend.mcp_server.read_cv_document", return_value={"path": "cv.md", "content": "full cv"}),
            patch("backend.mcp_server.read_evidence_overview", return_value=overview),
            patch("backend.mcp_server.read_story_bank", return_value={"stories": []}),
            patch("backend.mcp_server.read_story_drafts", return_value={"drafts": []}),
            patch("backend.mcp_server.read_resume_suggestion", return_value={"suggestionId": "s1", "content": "large"}),
            patch("backend.mcp_server.read_resume_draft", return_value={"resumeDraftId": "d1", "content": "large"}),
            patch("backend.mcp_server.read_interview_prep", return_value={"interviewPrepId": "i1", "content": "large"}),
        ):
            summary = self.call("get_application_context", {"source_key": "agent:7"})
            full = self.call("get_application_context", {"source_key": "agent:7", "detail_level": "full"})

        self.assertNotIn("content", summary["cv"])
        self.assertNotIn("raw", summary["pipelineItem"])
        self.assertEqual([item["requirementId"] for item in full["evidence"]["requirements"]], ["req-target"])
        self.assertEqual([item["capabilityId"] for item in full["evidence"]["capabilities"]], ["cap-target"])

    def test_base_resume_defaults_to_path_and_can_return_full_content(self):
        project_dir = Path("projects/agent")
        with tempfile.TemporaryDirectory() as temp_dir:
            resume_path = Path(temp_dir) / "cv.md"
            resume_path.write_text("# Resume\n", encoding="utf-8")
            document = {
                "ok": True,
                "exists": True,
                "path": str(resume_path),
                "content": "# Resume\n",
                "readyForScoring": True,
                "readyForMaterials": True,
            }
            with (
                patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
                patch("backend.mcp_server.read_cv_document", return_value=document),
            ):
                location = self.call("get_base_resume", {"project": "agent"})
                full = self.call("get_base_resume", {"project": "agent", "content_mode": "full"})

        self.assertNotIn("content", location)
        self.assertEqual(location["path"], str(resume_path))
        self.assertTrue(location["revision"])
        self.assertEqual(full["content"], "# Resume\n")

    def test_tailored_resume_listing_and_detail_are_path_first(self):
        project_dir = Path("projects/agent")
        with tempfile.TemporaryDirectory() as temp_dir:
            suggestion_path = Path(temp_dir) / "suggestion.md"
            draft_path = Path(temp_dir) / "draft.md"
            suggestion_path.write_text("suggestion", encoding="utf-8")
            draft_path.write_text("draft", encoding="utf-8")
            items = {
                "ok": True,
                "items": [{
                    "sourceKey": "agent:7",
                    "company": "Example",
                    "title": "Agent Engineer",
                    "resumeSuggestionPath": str(suggestion_path),
                    "resumeDraftPath": str(draft_path),
                }],
            }
            suggestion = {
                "sourceKey": "agent:7",
                "resumeSuggestionId": "s1",
                "suggestionPath": str(suggestion_path),
                "jsonPath": str(suggestion_path.with_suffix(".json")),
                "content": "suggestion",
                "evidenceMap": [{"claimId": "c1"}],
            }
            draft = {
                "sourceKey": "agent:7",
                "resumeDraftId": "d1",
                "draftPath": str(draft_path),
                "jsonPath": str(draft_path.with_suffix(".json")),
                "content": "draft",
                "evidenceMap": [],
            }
            with (
                patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
                patch("backend.mcp_server.project_from_source_key", return_value="agent"),
                patch("backend.mcp_server.list_resume_items", return_value=items),
                patch("backend.mcp_server.read_resume_suggestion", return_value=suggestion),
                patch("backend.mcp_server.read_resume_draft", return_value=draft),
            ):
                listing = self.call("list_tailored_resumes", {"project": "agent"})
                location = self.call("get_tailored_resume", {"source_key": "agent:7"})
                full = self.call("get_tailored_resume", {"source_key": "agent:7", "content_mode": "full"})

        self.assertEqual(listing["items"][0]["draft"]["path"], str(draft_path))
        self.assertNotIn("content", location["draft"])
        self.assertEqual(location["suggestion"]["evidenceClaimCount"], 1)
        self.assertEqual(full["draft"]["content"], "draft")

    def test_base_resume_update_requires_confirmation_and_revision(self):
        project_dir = Path("projects/agent")
        current = {"ok": True, "path": "cv.md", "content": "# Old\n"}
        saved = {"ok": True, "path": "cv.md", "content": "# New\n"}
        with (
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.read_cv_document", return_value=current),
            patch("backend.mcp_server.save_cv_document", return_value=saved) as save,
        ):
            preview = self.call("update_base_resume", {"project": "agent", "content": "# New"})
            result = self.call(
                "update_base_resume",
                {
                    "project": "agent",
                    "content": "# New",
                    "confirmation_id": preview["confirmationId"],
                },
            )

        self.assertTrue(preview["requiresConfirmation"])
        self.assertIn("-# Old", preview["details"]["diff"])
        self.assertNotIn("content", result)
        self.assertEqual(result["characterCount"], len("# New\n"))
        save.assert_called_once_with("# New\n")

    def test_base_resume_update_rejects_stale_revision(self):
        project_dir = Path("projects/agent")
        with (
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.read_cv_document", return_value={"path": "cv.md", "content": "# Current\n"}),
            patch("backend.mcp_server.save_cv_document") as save,
        ):
            with self.assertRaises(Exception):
                self.call(
                    "update_base_resume",
                    {"project": "agent", "content": "# New", "expected_revision": "stale"},
                )
        save.assert_not_called()

    def test_tailored_resume_update_uses_managed_save(self):
        project_dir = Path("projects/agent")
        current = {
            "sourceKey": "agent:7",
            "resumeDraftId": "d1",
            "draftPath": "draft.md",
            "content": "# Old\n",
        }
        saved = {
            "ok": True,
            "sourceKey": "agent:7",
            "resumeDraftId": "d1",
            "draftPath": "draft.md",
            "content": "# New\n",
            "editedAt": "now",
        }
        with (
            patch("backend.mcp_server.project_from_source_key", return_value="agent"),
            patch("backend.mcp_server.project_workspace", return_value=nullcontext(project_dir)),
            patch("backend.mcp_server.read_resume_draft", return_value=current),
            patch("backend.mcp_server.save_resume_draft", return_value=saved) as save,
        ):
            preview = self.call("update_tailored_resume", {"source_key": "agent:7", "content": "# New"})
            result = self.call(
                "update_tailored_resume",
                {
                    "source_key": "agent:7",
                    "content": "# New",
                    "confirmation_id": preview["confirmationId"],
                },
            )

        self.assertTrue(preview["requiresConfirmation"])
        self.assertNotIn("content", result)
        save.assert_called_once_with("agent:7", "# New\n")

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
