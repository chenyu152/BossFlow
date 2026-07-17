import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services.job_service import query_jobs
from crawler.db import upsert_jobs


class JobFilterTest(unittest.TestCase):
    def test_structured_filters_and_score_sort(self):
        with tempfile.TemporaryDirectory() as temp:
            project = Path(temp) / "agent"
            project.mkdir()
            db_path = project / "jobs_data.db"
            upsert_jobs(
                [
                    {"_key": "a", "title": "Agent Engineer", "company": "A", "city": "深圳", "salary": "30-50K", "avg": 40, "tier": "A", "cats": ["Agent"], "desc": "RAG", "_date": "2026-07-17"},
                    {"_key": "b", "title": "Backend Engineer", "company": "B", "city": "上海", "salary": "40-60K", "avg": 50, "tier": "B", "cats": ["Backend"], "desc": "Python", "_date": "2026-07-16"},
                ],
                db_path,
            )

            def scores(_project, items):
                for item in items:
                    item["score"] = 92 if item["title"] == "Agent Engineer" else 70
                    item["fitLevel"] = "high" if item["score"] > 90 else "medium"
                return items

            with patch("backend.services.job_service.apply_scores_to_jobs", side_effect=scores):
                result = query_jobs(
                    project,
                    cities=["深圳"],
                    categories=["Agent"],
                    min_score=85,
                    fit_levels=["high"],
                    sort_by="score_desc",
                )

            self.assertEqual(result["total"], 1)
            self.assertEqual(result["items"][0]["title"], "Agent Engineer")


if __name__ == "__main__":
    unittest.main()
