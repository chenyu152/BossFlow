import json
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import matching_suggestion_service


class MatchingSuggestionServiceTest(unittest.TestCase):
    def test_blank_rules_only_use_target_keywords_and_keep_blacklist_empty(self):
        captured_messages = []
        llm_response = json.dumps({
            "categoryRules": {"Agent开发": ["Agent", "LangGraph"]},
            "relevanceKeywords": ["大模型应用"],
            "blacklistKeywords": ["游戏策划"],
            "rationale": "基于目标关键词生成。",
            "warnings": [],
        }, ensure_ascii=False)

        def fake_call(messages):
            captured_messages.extend(messages)
            return llm_response

        with (
            patch.object(matching_suggestion_service, "resolve_project", return_value=Path("agent")),
            patch.object(matching_suggestion_service, "_call_llm", side_effect=fake_call),
        ):
            result = matching_suggestion_service.suggest_matching_rules("agent", {
                "keywordsText": "AI Agent 开发\n大模型应用",
                "catRulesText": "{}",
                "relevanceText": "",
                "blacklistText": "",
            })

        request_payload = json.loads(captured_messages[1]["content"])
        self.assertEqual(result["basedOn"], ["目标岗位关键词"])
        self.assertEqual(result["blacklistKeywords"], [])
        self.assertTrue(any("仅基于目标岗位关键词" in warning for warning in result["warnings"]))
        self.assertNotIn("citiesText", request_payload)
        self.assertNotIn("baseResume", request_payload)

    def test_existing_rules_are_the_only_optional_context(self):
        llm_response = json.dumps({
            "categoryRules": {"AI工程": ["RAG"]},
            "relevanceKeywords": ["LLM"],
            "blacklistKeywords": ["销售"],
            "rationale": "沿用已有规则。",
            "warnings": [],
        }, ensure_ascii=False)

        with (
            patch.object(matching_suggestion_service, "resolve_project", return_value=Path("agent")),
            patch.object(matching_suggestion_service, "_call_llm", return_value=llm_response),
        ):
            result = matching_suggestion_service.suggest_matching_rules("agent", {
                "keywordsText": "AI Agent 开发",
                "catRulesText": json.dumps({"AI工程": ["LLM"]}, ensure_ascii=False),
                "relevanceText": "RAG",
                "blacklistText": "",
            })

        self.assertEqual(result["basedOn"], ["目标岗位关键词", "已有入库规则"])
        self.assertEqual(result["blacklistKeywords"], ["销售"])


if __name__ == "__main__":
    unittest.main()
