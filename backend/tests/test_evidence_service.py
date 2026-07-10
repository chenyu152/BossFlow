import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import evidence_service


class EvidenceServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)
        self.paths_patch = patch.multiple(
            evidence_service,
            DATA_DIR=data_dir,
            EVIDENCE_STORE_PATH=data_dir / "evidence-store.json",
            EVIDENCE_LOCK_PATH=data_dir / ".evidence-store.lock",
        )
        self.paths_patch.start()

    def tearDown(self):
        self.paths_patch.stop()
        self.temp_dir.cleanup()

    def test_creates_versioned_empty_store(self):
        overview = evidence_service.read_evidence_overview()

        self.assertEqual(overview["schemaVersion"], 1)
        self.assertEqual(overview["counts"]["requirements"], 0)
        self.assertTrue(Path(overview["path"]).exists())

    def test_requirement_evidence_coverage_and_task_flow(self):
        overview = evidence_service.upsert_requirements([
            {
                "requirementId": "req-go",
                "canonicalKey": "go-concurrency",
                "label": "Go 并发开发",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:1",
                "jdQuote": "熟悉 Go 并发开发",
                "extractionConfidence": 0.92,
            }
        ])
        self.assertEqual(overview["counts"]["requirements"], 1)

        created = evidence_service.create_evidence_item({
            "title": "并发任务调度项目",
            "evidenceType": "project",
            "summary": "实现过并发任务调度。",
            "userRole": "核心开发",
            "actions": ["设计 worker pool"],
            "results": [],
            "sourceRefs": [{"type": "project", "ref": "demo", "quote": ""}],
            "tags": ["go"],
            "status": "draft",
        })
        evidence_id = created["item"]["evidenceId"]

        classified = evidence_service.classify_coverage({
            "requirementId": "req-go",
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过，等待证据确认。",
            "confidence": 1,
        })
        self.assertEqual(classified["coverage"]["coverageStatus"], "partial")

        confirmed = evidence_service.confirm_evidence_item(evidence_id)
        self.assertEqual(confirmed["item"]["status"], "confirmed")
        self.assertEqual(confirmed["overview"]["coverages"][0]["coverageStatus"], "supported")
        self.assertEqual(confirmed["affectedSourceKeys"], ["agent:1"])

        created_task = evidence_service.create_evidence_task({
            "requirementId": "req-go",
            "taskType": "strengthen",
            "affectedSourceKeys": ["agent:1"],
            "recommendedAction": "补充结果说明",
            "estimatedEffortBand": "under_1_hour",
            "timeBudget": "under_1_hour",
            "userWillingness": "willing",
            "priorityBand": "high",
            "status": "pending",
            "completionEvidenceIds": [],
        })
        task_id = created_task["task"]["taskId"]
        completed = evidence_service.update_evidence_task({
            "taskId": task_id,
            "status": "completed",
            "completionEvidenceIds": [evidence_id],
        })
        self.assertEqual(completed["task"]["status"], "completed")
        self.assertEqual(completed["overview"]["counts"]["pendingTasks"], 0)

    def test_confirmation_cannot_be_bypassed_by_create_or_update(self):
        created = evidence_service.create_evidence_item({
            "title": "待确认事实",
            "evidenceType": "fact",
            "summary": "",
            "userRole": "",
            "actions": [],
            "results": [],
            "sourceRefs": [],
            "tags": [],
            "status": "confirmed",
        })
        self.assertEqual(created["item"]["status"], "draft")

        with self.assertRaises(HTTPException) as raised:
            evidence_service.update_evidence_item({**created["item"], "status": "confirmed"})

        self.assertEqual(raised.exception.status_code, 400)

    def test_assessment_sync_uses_stable_ids_and_preserves_user_decisions(self):
        assessment = [
            {
                "canonicalKey": "go-concurrency",
                "label": "Go 并发开发",
                "category": "skill",
                "importance": "required",
                "jdQuote": "熟悉 Go 并发开发",
                "candidateEvidenceRefs": [{"sourceType": "cv", "quote": "并发任务项目", "locator": "项目经历"}],
                "coverageStatus": "supported",
                "rationale": "当前简历中找到候选证据。",
                "confidence": 0.9,
            },
            {
                "canonicalKey": "kubernetes-production",
                "label": "Kubernetes 生产经验",
                "category": "experience",
                "importance": "required",
                "jdQuote": "具备 Kubernetes 生产经验",
                "candidateEvidenceRefs": [],
                "coverageStatus": "not_found",
                "rationale": "当前材料中未找到相关证据。",
                "confidence": 0.95,
            },
        ]

        first = evidence_service.sync_requirement_assessment("agent:7", assessment)
        requirement_id = first["requirements"][0]["requirementId"]
        self.assertEqual(first["coverages"][0]["coverageStatus"], "partial")
        self.assertEqual(first["summary"]["potentialEvidenceRequirementCount"], 1)
        self.assertEqual(first["summary"]["blockingGapCount"], 1)

        created = evidence_service.create_evidence_item({
            "title": "并发任务项目",
            "evidenceType": "project",
            "summary": "",
            "userRole": "开发",
            "actions": ["实现并发调度"],
            "results": [],
            "sourceRefs": [],
            "tags": ["go"],
            "status": "draft",
        })
        evidence_id = created["item"]["evidenceId"]
        evidence_service.classify_coverage({
            "requirementId": requirement_id,
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过。",
            "confidence": 1,
        })
        evidence_service.confirm_evidence_item(evidence_id)

        changed_assessment = [{**assessment[0], "coverageStatus": "not_found", "candidateEvidenceRefs": []}]
        second = evidence_service.sync_requirement_assessment("agent:7", changed_assessment)
        coverage = second["coverages"][0]
        self.assertEqual(second["requirements"][0]["requirementId"], requirement_id)
        self.assertEqual(coverage["assessmentStatus"], "not_found")
        self.assertEqual(coverage["coverageStatus"], "supported")
        self.assertEqual(coverage["userClassification"], "done")
        self.assertEqual(coverage["rationale"], "用户确认做过。")
        listed = evidence_service.list_requirements("agent:7")
        self.assertEqual(len(listed["requirements"]), 1)
        self.assertEqual(second["summary"]["potentialEvidenceRequirementCount"], 0)
        self.assertEqual(second["overview"]["counts"]["unresolvedCoverages"], 0)

    def test_migrates_missing_collections_without_losing_requirements(self):
        evidence_service.EVIDENCE_STORE_PATH.write_text(
            json.dumps({
                "requirements": [{"requirementId": "req-existing", "label": "Existing"}],
                "evidenceItems": None,
            }),
            encoding="utf-8",
        )

        overview = evidence_service.read_evidence_overview()

        self.assertEqual(overview["schemaVersion"], 1)
        self.assertEqual(overview["requirements"][0]["requirementId"], "req-existing")
        self.assertEqual(overview["evidenceItems"], [])
        self.assertEqual(overview["coverages"], [])
        self.assertEqual(overview["tasks"], [])

    def test_rejects_newer_store_version(self):
        evidence_service.EVIDENCE_STORE_PATH.write_text(
            json.dumps({"schemaVersion": 99}),
            encoding="utf-8",
        )

        with self.assertRaises(HTTPException) as raised:
            evidence_service.read_evidence_overview()

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
