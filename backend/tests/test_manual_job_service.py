import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend.services.job_service import create_job, get_job_by_id


class ManualJobServiceTest(unittest.TestCase):
    def test_create_job_returns_database_id_and_reuses_it_on_update(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            payload = SimpleNamespace(
                project="manual-test",
                title="AI 应用开发工程师",
                company="示例公司",
                city="深圳",
                salary="20-30K",
                exp="3-5年",
                edu="本科",
                desc="负责 Agent 应用开发",
                url="https://example.com/job/1",
                security_id="",
            )
            config = {
                "cat_rules": {},
                "relevance_keywords": [],
                "blacklist_keywords": [],
                "min_salary": 17,
            }

            with (
                patch("backend.services.project_service.resolve_project", return_value=project_dir),
                patch("crawler.boss.load_config", return_value=config),
            ):
                created = create_job(payload)
                updated = create_job(payload)

            self.assertGreater(created["jobId"], 0)
            self.assertEqual(updated["jobId"], created["jobId"])
            saved = get_job_by_id(project_dir, created["jobId"])
            self.assertEqual(saved["title"], payload.title)
            self.assertEqual(saved["company"], payload.company)


if __name__ == "__main__":
    unittest.main()
