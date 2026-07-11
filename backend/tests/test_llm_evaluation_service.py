import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import llm_evaluation_service
from backend.services.llm_evaluation_service import _parse_requirement_assessment


class RequirementAssessmentParserTest(unittest.TestCase):
    def test_parses_and_normalizes_requirement_assessment(self):
        payload = [
            {
                "canonicalKey": "Go Concurrency",
                "label": "Go 并发开发",
                "category": "skill",
                "importance": "required",
                "jdQuote": "熟悉 Go 并发开发",
                "candidateEvidenceRefs": [
                    {"sourceType": "cv", "quote": "实现并发任务调度", "locator": "项目经历"}
                ],
                "coverageStatus": "supported",
                "rationale": "当前简历中存在直接证据。",
                "confidence": 1.4,
            },
            {
                "canonicalKey": "Go Concurrency",
                "label": "重复要求",
                "coverageStatus": "partial",
            },
            {
                "canonicalKey": "k8s-production",
                "label": "Kubernetes 生产经验",
                "category": "unexpected",
                "importance": "required",
                "candidateEvidenceRefs": [
                    {"sourceType": "cv", "quote": "不应保留", "locator": ""}
                ],
                "coverageStatus": "not_found",
                "rationale": "当前材料中未找到相关证据。",
                "confidence": "0.8",
            },
            {
                "canonicalKey": "user-decision",
                "label": "非法用户结论",
                "coverageStatus": "user_confirmed_absent",
            },
        ]
        text = (
            "# 岗位精评估\n"
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"```json\n{json.dumps(payload, ensure_ascii=False)}\n```\n"
            "---END_REQUIREMENT_ASSESSMENT---\n"
        )

        requirements = _parse_requirement_assessment(text)

        self.assertEqual(len(requirements), 3)
        self.assertEqual(requirements[0]["canonicalKey"], "go-concurrency")
        self.assertEqual(requirements[0]["verificationMode"], "experience_fact")
        self.assertEqual(requirements[0]["confidence"], 1.0)
        self.assertEqual(requirements[1]["category"], "other")
        self.assertEqual(requirements[1]["candidateEvidenceRefs"], [])
        self.assertEqual(requirements[2]["coverageStatus"], "unknown")

    def test_infers_document_fact_verification_for_education(self):
        payload = [{
            "canonicalKey": "bachelor-computer-science",
            "label": "本科及以上学历，计算机相关专业",
            "category": "education",
            "candidateEvidenceRefs": [{
                "sourceType": "cv",
                "quote": "本科｜计算机科学与技术",
                "locator": "教育背景",
            }],
            "coverageStatus": "supported",
            "confidence": 1,
        }]
        text = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps(payload, ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )

        requirement = _parse_requirement_assessment(text)[0]

        self.assertEqual(requirement["verificationMode"], "document_fact")

    def test_supported_without_a_source_is_downgraded_to_not_found(self):
        payload = [{
            "canonicalKey": "go-concurrency",
            "label": "Go 并发开发",
            "category": "skill",
            "importance": "required",
            "candidateEvidenceRefs": [],
            "coverageStatus": "supported",
            "confidence": 0.9,
        }]
        text = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps(payload, ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )

        requirements = _parse_requirement_assessment(text)

        self.assertEqual(requirements[0]["coverageStatus"], "not_found")

    def test_returns_empty_for_missing_or_invalid_block(self):
        self.assertEqual(_parse_requirement_assessment("# no block"), [])
        self.assertEqual(
            _parse_requirement_assessment(
                "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\nnot json\n---END_REQUIREMENT_ASSESSMENT---"
            ),
            [],
        )


class LlmEvaluationIntegrationTest(unittest.TestCase):
    def test_writes_assessment_and_evidence_summary_to_report_and_pipeline(self):
        requirement = {
            "canonicalKey": "go-concurrency",
            "label": "Go 并发开发",
            "category": "skill",
            "importance": "required",
            "jdQuote": "熟悉 Go 并发开发",
            "candidateEvidenceRefs": [],
            "coverageStatus": "not_found",
            "rationale": "当前材料中未找到相关证据。",
            "confidence": 0.9,
        }
        report_text = (
            "# 岗位精评估\n"
            "---BOSSSPIDER_LLM_SUMMARY---\n"
            "SCORE: 4.2\nFIT_LEVEL: High Fit\nRECOMMENDATION: 继续评估\nGREETING_READY: yes\n"
            "---END_SUMMARY---\n"
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps([requirement], ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---\n"
        )
        evidence_summary = {
            "requirementCount": 1,
            "supportedRequirementCount": 0,
            "potentialEvidenceRequirementCount": 0,
            "unresolvedRequirementCount": 1,
            "blockingGapCount": 1,
            "requirementAssessedAt": "2026-07-10T10:00:00+08:00",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            reports_dir = Path(temp_dir)
            with (
                patch.object(llm_evaluation_service, "REPORTS_DIR", reports_dir),
                patch.object(llm_evaluation_service, "_load_pipeline_job", return_value=({"score": 4}, {"company": "测试公司", "title": "Go 工程师"})),
                patch.object(llm_evaluation_service, "_call_llm", return_value=report_text),
                patch.object(llm_evaluation_service, "_next_report_id", return_value="001"),
                patch.object(
                    llm_evaluation_service,
                    "sync_requirement_assessment",
                    return_value={"summary": evidence_summary, "coverages": [{"requirementId": "req-1"}]},
                ),
                patch.object(llm_evaluation_service, "update_pipeline_item_metadata") as update_metadata,
                patch.object(llm_evaluation_service, "sync_greeting_draft_from_report"),
                patch.object(llm_evaluation_service, "read_pipeline", return_value={"pending": [], "processed": []}),
            ):
                result = llm_evaluation_service.llm_evaluate_pipeline_item("agent:1")

            report_json = json.loads(Path(result["jsonPath"]).read_text(encoding="utf-8"))
            visible_report = Path(result["reportPath"]).read_text(encoding="utf-8")
            self.assertEqual(report_json["schemaVersion"], 2)
            self.assertEqual(report_json["requirementAssessment"][0]["canonicalKey"], "go-concurrency")
            self.assertEqual(report_json["evidenceSummary"], evidence_summary)
            self.assertEqual(result["evidenceSummary"], evidence_summary)
            self.assertNotIn("BOSSFLOW_REQUIREMENT_ASSESSMENT", visible_report)
            metadata_patch = update_metadata.call_args.args[1]
            self.assertEqual(metadata_patch["requirementCount"], 1)
            self.assertEqual(metadata_patch["blockingGapCount"], 1)


if __name__ == "__main__":
    unittest.main()
