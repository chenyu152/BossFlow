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
        self.assertEqual(requirements[0]["requiredProficiency"], "familiar")
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

    def test_recovers_fenced_json_without_markers_and_trailing_comma(self):
        payload = """[
          {
            "canonicalKey": "vector-database",
            "label": "具备向量数据库经验",
            "category": "skill",
            "coverageStatus": "not_found",
            "candidateEvidenceRefs": [],
          },
        ]"""

        requirements = _parse_requirement_assessment(f"模型补充如下：\n```json\n{payload}\n```")

        self.assertEqual(len(requirements), 1)
        self.assertEqual(requirements[0]["canonicalKey"], "vector-database")

    def test_recovers_complete_items_from_truncated_requirement_array(self):
        payload = [{
            "canonicalKey": "langgraph",
            "label": "LangGraph 开发经验",
            "category": "skill",
            "importance": "required",
            "candidateEvidenceRefs": [],
            "coverageStatus": "not_found",
        }]
        truncated = json.dumps(payload, ensure_ascii=False)[:-1]

        requirements = _parse_requirement_assessment(
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n" + truncated
        )

        self.assertEqual(len(requirements), 1)
        self.assertEqual(requirements[0]["canonicalKey"], "langgraph")

    def test_splits_compound_requirement_into_atomic_capabilities(self):
        payload = [{
            "canonicalKey": "rag-prompt-tool-calling",
            "capabilityName": "RAG/Prompt Engineering/Tool Calling",
            "label": "熟练掌握 RAG、Prompt Engineering 与 Tool Calling",
            "category": "skill",
            "importance": "required",
            "requiredProficiency": "proficient",
            "jdQuote": "熟练掌握 RAG、Prompt Engineering 与 Tool Calling",
            "candidateEvidenceRefs": [],
            "coverageStatus": "not_found",
            "confidence": 0.9,
        }]
        text = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps(payload, ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )

        requirements = _parse_requirement_assessment(text)

        self.assertEqual(
            {item["canonicalKey"] for item in requirements},
            {"rag-systems", "prompt-engineering", "tool-calling"},
        )
        self.assertTrue(all(item["requiredProficiency"] == "proficient" for item in requirements))

    def test_preserves_any_of_group_across_atomic_capabilities(self):
        payload = [
            {
                "canonicalKey": key,
                "capabilityName": label,
                "label": "熟练掌握 Python、Java 或 C++ 中至少一门",
                "category": "skill",
                "importance": "required",
                "requiredProficiency": "proficient",
                "proficiencyApplicable": True,
                "requirementGroupId": "programming-language-choice",
                "requirementGroupMode": "any_of",
                "requirementGroupLabel": "Python、Java 或 C++ 中至少一门",
                "minimumSatisfied": 1,
                "candidateEvidenceRefs": [],
                "coverageStatus": "not_found",
                "confidence": 0.9,
            }
            for key, label in (
                ("python-programming", "Python"),
                ("java-programming", "Java"),
                ("cpp-programming", "C++"),
            )
        ]
        text = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps(payload, ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )

        requirements = _parse_requirement_assessment(text)

        self.assertEqual(len(requirements), 3)
        self.assertTrue(all(item["requirementGroupMode"] == "any_of" for item in requirements))
        self.assertEqual(
            {item["requirementGroupId"] for item in requirements},
            {"programming-language-choice"},
        )
        self.assertTrue(all(item["proficiencyApplicable"] for item in requirements))

    def test_maps_catalog_alias_to_known_capability(self):
        payload = [{
            "canonicalKey": "rag-system-development",
            "capabilityName": "RAG 系统开发经验",
            "label": "熟练掌握 RAG 系统开发",
            "category": "skill",
            "importance": "required",
            "requiredProficiency": "proficient",
            "jdQuote": "熟练掌握 RAG 系统开发",
            "candidateEvidenceRefs": [],
            "coverageStatus": "not_found",
            "confidence": 0.9,
        }]
        text = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps(payload, ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )

        requirements = _parse_requirement_assessment(text)

        self.assertEqual(requirements[0]["canonicalKey"], "rag-systems")
        self.assertEqual(requirements[0]["capabilityName"], "RAG")


class LlmEvaluationIntegrationTest(unittest.TestCase):
    def test_retries_with_focused_repair_when_initial_assessment_is_invalid(self):
        initial_report = (
            "# 岗位精评估\n"
            "---BOSSSPIDER_LLM_SUMMARY---\n"
            "SCORE: 4.0\nFIT_LEVEL: Worth Reviewing\nRECOMMENDATION: 继续评估\nGREETING_READY: no\n"
            "---END_SUMMARY---\n"
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n["
        )
        repaired_requirement = {
            "canonicalKey": "vector-database",
            "label": "具备向量数据库经验",
            "category": "skill",
            "importance": "required",
            "candidateEvidenceRefs": [],
            "coverageStatus": "not_found",
        }
        repaired_response = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps([repaired_requirement], ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )
        evidence_summary = {
            "requirementCount": 1,
            "supportedRequirementCount": 0,
            "potentialEvidenceRequirementCount": 0,
            "unresolvedRequirementCount": 1,
            "blockingGapCount": 1,
            "requirementAssessedAt": "2026-07-17T10:00:00+08:00",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(llm_evaluation_service, "REPORTS_DIR", Path(temp_dir)),
                patch.object(
                    llm_evaluation_service,
                    "_load_pipeline_job",
                    return_value=({"score": 4}, {"company": "测试公司", "title": "AI 工程师"}),
                ),
                patch.object(
                    llm_evaluation_service,
                    "_call_llm",
                    side_effect=[initial_report, repaired_response],
                ) as call_llm,
                patch.object(llm_evaluation_service, "_next_report_id", return_value="001"),
                patch.object(
                    llm_evaluation_service,
                    "sync_requirement_assessment",
                    return_value={"summary": evidence_summary, "coverages": []},
                ),
                patch.object(llm_evaluation_service, "update_pipeline_item_metadata"),
                patch.object(llm_evaluation_service, "sync_greeting_draft_from_report"),
                patch.object(llm_evaluation_service, "read_pipeline", return_value={"pending": [], "processed": []}),
            ):
                result = llm_evaluation_service.llm_evaluate_pipeline_item("agent:1")

        self.assertEqual(call_llm.call_count, 2)
        self.assertEqual(result["requirementAssessment"][0]["canonicalKey"], "vector-database")
        self.assertEqual(result["summary"]["score"], 4.0)

    def test_uses_dedicated_structured_extraction_after_repair_is_truncated(self):
        initial_report = (
            "# 岗位精评估\n"
            "---BOSSSPIDER_LLM_SUMMARY---\n"
            "SCORE: 4.0\nFIT_LEVEL: Worth Reviewing\nRECOMMENDATION: 继续评估\nGREETING_READY: no\n"
            "---END_SUMMARY---\n"
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n["
        )
        repaired_response = "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n["
        fallback_requirement = {
            "canonicalKey": "langgraph",
            "label": "LangGraph 开发经验",
            "category": "skill",
            "importance": "required",
            "candidateEvidenceRefs": [],
            "coverageStatus": "not_found",
        }
        fallback_response = (
            "---BOSSFLOW_REQUIREMENT_ASSESSMENT---\n"
            f"{json.dumps([fallback_requirement], ensure_ascii=False)}\n"
            "---END_REQUIREMENT_ASSESSMENT---"
        )
        evidence_summary = {
            "requirementCount": 1,
            "supportedRequirementCount": 0,
            "potentialEvidenceRequirementCount": 0,
            "unresolvedRequirementCount": 1,
            "blockingGapCount": 1,
            "requirementAssessedAt": "2026-07-17T10:00:00+08:00",
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(llm_evaluation_service, "REPORTS_DIR", Path(temp_dir)),
                patch.object(
                    llm_evaluation_service,
                    "_load_pipeline_job",
                    return_value=({"score": 4}, {"company": "测试公司", "title": "AI 工程师"}),
                ),
                patch.object(
                    llm_evaluation_service,
                    "_call_llm",
                    side_effect=[initial_report, repaired_response, fallback_response],
                ) as call_llm,
                patch.object(llm_evaluation_service, "_next_report_id", return_value="001"),
                patch.object(
                    llm_evaluation_service,
                    "sync_requirement_assessment",
                    return_value={"summary": evidence_summary, "coverages": []},
                ),
                patch.object(llm_evaluation_service, "update_pipeline_item_metadata"),
                patch.object(llm_evaluation_service, "sync_greeting_draft_from_report"),
                patch.object(llm_evaluation_service, "read_pipeline", return_value={"pending": [], "processed": []}),
            ):
                result = llm_evaluation_service.llm_evaluate_pipeline_item("agent:1")

        self.assertEqual(call_llm.call_count, 3)
        self.assertEqual(result["requirementAssessment"][0]["canonicalKey"], "langgraph")

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
