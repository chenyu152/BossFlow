import unittest
from unittest.mock import patch

from backend.services import interview_service


class InterviewServiceTest(unittest.TestCase):
    def test_evidence_context_uses_confirmed_reusable_evidence_only(self):
        overview = {
            "requirements": [
                {"requirementId": "req-1", "sourceKey": "job-a", "label": "Agent experience", "importance": "required", "active": True},
                {"requirementId": "req-2", "sourceKey": "job-a", "label": "Bachelor degree", "importance": "required", "active": True},
                {"requirementId": "req-3", "sourceKey": "job-a", "label": "Shanghai location", "importance": "preferred", "active": True},
                {"requirementId": "req-other", "sourceKey": "job-b", "label": "Other job", "importance": "required", "active": True},
            ],
            "coverages": [
                {"requirementId": "req-1", "coverageStatus": "supported", "evidenceIds": ["ev-confirmed", "ev-draft"]},
                {
                    "requirementId": "req-2",
                    "coverageStatus": "supported",
                    "verificationStatus": "source_verified",
                    "candidateEvidenceRefs": [{"quote": "Computer Science bachelor"}],
                },
                {"requirementId": "req-3", "coverageStatus": "partial", "rationale": "Need relocation confirmation"},
                {"requirementId": "req-other", "coverageStatus": "supported", "evidenceIds": ["ev-confirmed"]},
            ],
            "evidenceItems": [
                {"evidenceId": "ev-confirmed", "status": "confirmed", "title": "Reusable Agent project", "summary": "Built an agent", "sourceRefs": []},
                {"evidenceId": "ev-draft", "status": "draft", "title": "Unconfirmed", "summary": "", "sourceRefs": []},
            ],
        }

        with patch("backend.services.interview_service.read_evidence_overview", return_value=overview):
            context = interview_service._interview_evidence_context("job-a")

        self.assertEqual([item["evidenceId"] for item in context["confirmedEvidence"]], ["ev-confirmed"])
        self.assertEqual([item["label"] for item in context["sourceVerifiedRequirements"]], ["Bachelor degree"])
        self.assertEqual([item["label"] for item in context["pendingRequirements"]], ["Shanghai location"])
        self.assertEqual(context["pendingRequirements"][0]["coverageStatus"], "partial")

    def test_prompt_keeps_pending_requirements_out_of_completed_experience(self):
        prompts = interview_service._prompt(
            {},
            {},
            "",
            "",
            "",
            {
                "confirmedEvidence": [{"evidenceId": "ev-1", "title": "Confirmed", "sourceRefs": []}],
                "sourceVerifiedRequirements": [],
                "pendingRequirements": [{"requirementId": "req-1", "label": "Missing proof"}],
            },
            "",
        )

        self.assertIn("Confirmed professional evidence", prompts[1]["content"])
        self.assertIn("Missing proof", prompts[1]["content"])
        self.assertIn("Pending requirements may only appear", prompts[0]["content"])


if __name__ == "__main__":
    unittest.main()
