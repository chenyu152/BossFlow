import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import resume_service


class ResumeServiceTest(unittest.TestCase):
    def test_rejects_tailored_resume_without_resume_suggestions(self):
        with (
            patch.object(
                resume_service,
                "_load_pipeline_job",
                return_value=(
                    {"sourceKey": "agent:1", "resumeSuggestionPath": ""},
                    {"company": "测试公司", "title": "AI 工程师"},
                ),
            ),
            patch.object(resume_service, "_call_llm") as call_llm,
        ):
            with self.assertRaises(HTTPException) as raised:
                resume_service.generate_resume_draft("agent:1", [], "")

        self.assertEqual(raised.exception.status_code, 404)
        self.assertIn("resume suggestions", raised.exception.detail)
        call_llm.assert_not_called()

    def test_binds_only_confirmed_evidence_ids(self):
        context = {
            "confirmedEvidence": [{"evidenceId": "ev-confirmed", "title": "已确认项目"}],
            "sourceVerifiedRequirements": [{"requirementId": "req-education"}],
        }
        bound = resume_service._bind_evidence_map([
            {
                "claimId": "S1",
                "claim": "使用已确认项目",
                "risk": "safe",
                "evidenceIds": ["ev-confirmed", "ev-draft"],
                "sourceVerified": False,
            },
            {
                "claimId": "S2",
                "claim": "简历学历事实",
                "risk": "safe",
                "evidenceIds": [],
                "sourceVerified": True,
            },
        ], context)

        self.assertEqual(bound[0]["evidenceIds"], ["ev-confirmed"])
        self.assertFalse(bound[0]["sourceVerified"])
        self.assertEqual(bound[1]["evidenceIds"], [])
        self.assertTrue(bound[1]["sourceVerified"])

    def test_draft_selection_preserves_user_choices_but_separates_confirmed_facts(self):
        evidence_map = [
            {
                "claimId": "S1",
                "claim": "已确认职业证据",
                "risk": "safe",
                "evidenceIds": ["ev-confirmed"],
                "sourceVerified": False,
            },
            {
                "claimId": "S2",
                "claim": "未绑定证据",
                "risk": "safe",
                "evidenceIds": [],
                "sourceVerified": False,
            },
            {
                "claimId": "S3",
                "claim": "待确认内容",
                "risk": "needs_confirmation",
                "evidenceIds": ["ev-confirmed"],
                "sourceVerified": False,
            },
        ]

        decisioned = resume_service._decisioned_evidence_map(
            evidence_map,
            ["S1", "S2", "S3"],
        )

        self.assertEqual([item["userDecision"] for item in decisioned], ["approved", "approved", "approved"])
        confirmed = [
            item for item in decisioned
            if resume_service._claim_is_confirmed_for_draft(item, require_evidence_binding=True)
        ]
        self.assertEqual([item["claimId"] for item in confirmed], ["S1"])


if __name__ == "__main__":
    unittest.main()
