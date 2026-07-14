import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import backend.app as app_module


class ProjectRouteTest(unittest.TestCase):
    def test_lists_no_default_direction_when_none_exist(self):
        client = TestClient(app_module.app)
        with (
            patch.object(app_module, "project_names", return_value=[]),
            patch.object(app_module, "default_project_name") as default_name,
        ):
            response = client.get("/api/projects")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"projects": [], "defaultProject": ""})
        default_name.assert_not_called()

    def test_creates_direction_through_api(self):
        client = TestClient(app_module.app)
        payload = {"project": "AI Agent 开发", "keywordsText": "", "citiesText": ""}
        with (
            patch.object(app_module, "create_project", return_value=Path("AI Agent 开发")) as create_project,
            patch.object(app_module, "config_payload", return_value=payload),
        ):
            response = client.post("/api/projects", json={"name": "AI Agent 开发"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)
        create_project.assert_called_once_with("AI Agent 开发")


if __name__ == "__main__":
    unittest.main()
