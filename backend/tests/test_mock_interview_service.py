import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import interview_service, mock_interview_service


class MockInterviewServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.sessions = self.root / "sessions"
        self.sessions_patch = patch.object(
            mock_interview_service,
            "MOCK_INTERVIEW_SESSIONS_DIR",
            self.sessions,
        )
        self.sessions_patch.start()

    def tearDown(self):
        self.sessions_patch.stop()
        self.temp_dir.cleanup()

    def _create_session(self):
        questions = [
            {
                "category": "project",
                "question": "介绍一个相关项目。",
                "rationale": "项目深挖",
                "linkedRequirementIds": ["req-1"],
            },
            {
                "category": "behavioral",
                "question": "如何处理需求变化？",
                "rationale": "行为能力",
                "linkedRequirementIds": [],
            },
        ]
        with patch.object(
            mock_interview_service,
            "_generate_questions",
            return_value=(
                {"project": "agent", "jobId": 1},
                {"title": "Agent 工程师", "company": "示例公司", "city": "深圳", "salary": "30-50K"},
                questions,
                "验证项目深度。",
            ),
        ):
            return mock_interview_service.create_mock_interview_session(
                "agent:1",
                "comprehensive",
                "auto",
                20,
            )["session"]

    def test_answer_adds_follow_up_after_current_turn(self):
        session = self._create_session()
        first_turn = session["turns"][0]
        with patch.object(
            mock_interview_service,
            "_follow_up_question",
            return_value="其中哪一部分是你个人完成的？",
        ):
            result = mock_interview_service.submit_mock_interview_answer(
                session["sessionId"],
                first_turn["turnId"],
                "我负责核心流程设计和实现，并完成了回归验证。",
            )

        saved = result["session"]
        self.assertTrue(result["followUpAdded"])
        self.assertEqual(saved["turns"][1]["parentTurnId"], first_turn["turnId"])
        self.assertEqual(saved["currentTurnId"], saved["turns"][1]["turnId"])
        self.assertEqual(saved["turns"][0]["status"], "answered")

    def test_stream_answer_persists_answer_and_emits_follow_up_deltas(self):
        session = self._create_session()
        first_turn = session["turns"][0]
        with patch.object(
            mock_interview_service,
            "_stream_follow_up_question",
            return_value=iter(["其中哪一部分", "是你个人完成的？"]),
        ):
            events = list(
                mock_interview_service.stream_mock_interview_answer(
                    session["sessionId"],
                    first_turn["turnId"],
                    "我负责核心流程设计和实现，并完成了回归验证。",
                )
            )

        self.assertIn("event: status", events[0])
        self.assertTrue(any("event: delta" in event and "其中哪一部分" in event for event in events))
        self.assertIn("event: done", events[-1])
        saved = mock_interview_service.get_mock_interview_session(session["sessionId"])["session"]
        self.assertEqual(saved["turns"][0]["status"], "answered")
        self.assertEqual(saved["turns"][1]["question"], "其中哪一部分是你个人完成的？")
        self.assertEqual(saved["currentTurnId"], saved["turns"][1]["turnId"])

    def test_stream_skip_finishes_without_generating_follow_up(self):
        session = self._create_session()
        first_turn = session["turns"][0]
        with patch.object(mock_interview_service, "_stream_follow_up_question") as stream_follow_up:
            events = list(
                mock_interview_service.stream_mock_interview_answer(
                    session["sessionId"],
                    first_turn["turnId"],
                    "",
                    skipped=True,
                )
            )

        stream_follow_up.assert_not_called()
        self.assertIn("event: status", events[0])
        self.assertIn("event: done", events[-1])
        saved = mock_interview_service.get_mock_interview_session(session["sessionId"])["session"]
        self.assertEqual(saved["turns"][0]["status"], "skipped")
        self.assertEqual(saved["currentTurnId"], saved["turns"][1]["turnId"])

    def test_story_candidates_are_staged_as_unconfirmed_drafts(self):
        session = self._create_session()
        session["evaluation"] = {
            "storyCandidates": [
                {
                    "candidateId": "candidate-1",
                    "title": "排查 Agent 调用故障",
                    "theme": "debugging",
                    "tags": ["problem-solving"],
                    "rawNote": "回答中提到定位并修复调用问题。",
                    "format": "star",
                    "structureStatus": "needs_structuring",
                    "situation": "调用异常",
                    "task": "",
                    "action": "定位调用链",
                    "result": "",
                    "reflection": "",
                    "questionIds": ["question-1"],
                    "rawAnswerSnapshot": [],
                    "assisted": False,
                    "missingFields": ["task", "result"],
                    "contradictionFlags": [],
                    "extractionConfidence": 0.7,
                }
            ]
        }
        mock_interview_service._write_session(session)

        with (
            patch.object(mock_interview_service, "read_story_drafts", return_value={"ok": True, "path": "", "drafts": []}),
            patch.object(mock_interview_service, "save_story_drafts", side_effect=lambda drafts: {"ok": True, "path": "", "drafts": drafts}),
        ):
            result = mock_interview_service.stage_mock_interview_story_drafts(
                session["sessionId"],
                ["candidate-1"],
            )

        self.assertEqual(result["added"], 1)
        draft = result["drafts"][0]
        self.assertEqual(draft["status"], "needs_confirmation")
        self.assertEqual(draft["sourceType"], "mock_interview")
        self.assertEqual(draft["sessionId"], session["sessionId"])
        self.assertEqual(draft["linkedRequirementIds"], ["req-1"])

    def test_story_draft_metadata_survives_existing_store(self):
        drafts_path = self.root / "story-drafts.json"
        with patch.object(interview_service, "STORY_DRAFTS_PATH", drafts_path):
            saved = interview_service.save_story_drafts(
                [
                    {
                        "title": "模拟面试案例",
                        "draftId": "draft-1",
                        "sourceType": "mock_interview",
                        "sessionId": "session-1",
                        "questionIds": ["question-1"],
                        "rawAnswerSnapshot": [{"question": "Q", "answer": "A"}],
                        "assisted": True,
                        "missingFields": ["result"],
                        "contradictionFlags": ["metric_needs_confirmation"],
                        "linkedRequirementIds": ["req-1"],
                        "extractionConfidence": 0.8,
                    }
                ]
            )

        draft = saved["drafts"][0]
        self.assertEqual(draft["sourceType"], "mock_interview")
        self.assertEqual(draft["sessionId"], "session-1")
        self.assertTrue(draft["assisted"])
        self.assertEqual(draft["missingFields"], ["result"])
        self.assertEqual(draft["extractionConfidence"], 0.8)


if __name__ == "__main__":
    unittest.main()
