import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import system_settings_service


class SystemSettingsServiceTest(unittest.TestCase):
    def test_saves_llm_settings_without_exposing_api_key(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(system_settings_service, "ENV_PATH", Path(temp_dir) / ".env"), patch.dict(
            os.environ,
            {"BOSSSPIDER_LLM_API_KEY": "", "DEEPSEEK_API_KEY": "", "OPENAI_API_KEY": ""},
            clear=False,
        ):
            response = system_settings_service.save_llm_settings(
                "test-secret", "https://api.example.com/v1", "example-model"
            )
            content = system_settings_service.ENV_PATH.read_text(encoding="utf-8")

        self.assertTrue(response["configured"])
        self.assertEqual(response["apiBase"], "https://api.example.com/v1")
        self.assertEqual(response["model"], "example-model")
        self.assertIn("BOSSSPIDER_LLM_API_KEY=test-secret", content)
        self.assertNotIn("test-secret", response.values())

    def test_rejects_invalid_api_base(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(system_settings_service, "ENV_PATH", Path(temp_dir) / ".env"):
            with self.assertRaises(ValueError):
                system_settings_service.save_llm_settings("key", "api.example.com", "example-model")

    def test_tests_current_input_without_saving(self):
        class Response:
            ok = True
            status_code = 200
            text = ""

        with patch.object(system_settings_service.requests, "post", return_value=Response()) as post:
            result = system_settings_service.test_llm_connection(
                "temporary-key", "https://api.example.com/v1", "example-model"
            )

        self.assertEqual(result, {"ok": "true", "model": "example-model"})
        self.assertEqual(post.call_args.kwargs["json"]["model"], "example-model")


if __name__ == "__main__":
    unittest.main()
