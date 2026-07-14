import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import backend.app as app_module


class JobRouteWorkspaceTest(unittest.TestCase):
    def test_job_list_reads_scores_from_requested_project_workspace(self):
        client = TestClient(app_module.app)
        project_dir = Path("projects") / "cehua"
        expected = {"items": [], "total": 0}

        with (
            patch.object(app_module, "_workspace_project", return_value="cehua") as workspace_project,
            patch.object(app_module, "project_workspace", return_value=nullcontext(project_dir)) as workspace,
            patch.object(app_module, "resolve_project", return_value=project_dir),
            patch.object(app_module, "query_jobs", return_value=expected),
        ):
            response = client.get("/api/jobs?project=cehua")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        workspace_project.assert_called_once_with("cehua")
        workspace.assert_called_once_with("cehua")


if __name__ == "__main__":
    unittest.main()
