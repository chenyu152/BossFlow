import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import project_service


class ProjectServiceTest(unittest.TestCase):
    def test_creates_an_empty_isolated_job_search_direction(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            projects_dir = Path(temp_dir) / "projects"
            with patch.object(project_service, "PROJECTS_DIR", projects_dir):
                created = project_service.create_project("AI Agent 开发")
                config = json.loads((created / "config.json").read_text(encoding="utf-8"))

                self.assertEqual(created, projects_dir / "AI Agent 开发")
                self.assertEqual(config["keywords"], ["AI Agent 开发"])
                self.assertEqual(config["cities"], {})
                self.assertEqual(config["cat_rules"], {})
                self.assertEqual(config["relevance_keywords"], [])
                self.assertEqual(config["blacklist_keywords"], [])
                self.assertEqual(config["scoring"]["keywordHints"], [])
                self.assertEqual(config["direction_setup_version"], 2)
                self.assertFalse((created / "workspace" / "cv.md").exists())

                with self.assertRaises(HTTPException) as error:
                    project_service.create_project("AI Agent 开发")
                self.assertEqual(error.exception.status_code, 409)

    def test_rejects_unsafe_direction_names(self):
        with self.assertRaises(HTTPException) as error:
            project_service.create_project("../other")
        self.assertEqual(error.exception.status_code, 400)

    def test_clears_legacy_default_scoring_library_once(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            projects_dir = Path(temp_dir) / "projects"
            legacy_dir = projects_dir / "legacy"
            legacy_dir.mkdir(parents=True)
            legacy_config = {
                "keywords": ["嵌入式软件工程师"],
                "cities": {"深圳": "101280600"},
                "scoring": project_service.normalize_scoring_config(project_service.DEFAULT_SCORING_CONFIG),
            }
            (legacy_dir / "config.json").write_text(json.dumps(legacy_config, ensure_ascii=False), encoding="utf-8")

            with patch.object(project_service, "PROJECTS_DIR", projects_dir):
                payload = project_service.config_payload(legacy_dir)

            self.assertEqual(json.loads(payload["scoringRulesText"])["keywordHints"], [])
            saved = json.loads((legacy_dir / "config.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["direction_setup_version"], 2)


if __name__ == "__main__":
    unittest.main()
