import sqlite3
import tempfile
import unittest
from pathlib import Path

from crawler.db import init_db, upsert_jobs
from crawler.pipeline import process_one


class CrawlerSecurityIdTest(unittest.TestCase):
    def test_pipeline_and_database_preserve_security_id(self):
        job = process_one(
            {
                "title": "Agent 开发工程师",
                "company": "示例公司",
                "city": "深圳市",
                "salary": "20-30K",
                "desc": "负责 Agent 平台开发",
                "security_id": "security-123",
            },
            cat_rules={"Agent": ["Agent"]},
            min_salary=0,
        )
        self.assertIsNotNone(job)
        self.assertEqual(job["security_id"], "security-123")

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            upsert_jobs([job], db_path)
            conn = sqlite3.connect(db_path)
            try:
                saved = conn.execute("SELECT security_id FROM jobs").fetchone()[0]
            finally:
                conn.close()
            self.assertEqual(saved, "security-123")

    def test_existing_database_is_migrated_with_security_id_column(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "legacy.db"
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    CREATE TABLE jobs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        job_key TEXT NOT NULL UNIQUE,
                        title TEXT NOT NULL,
                        company TEXT NOT NULL,
                        city TEXT,
                        salary TEXT,
                        avg REAL DEFAULT 0,
                        tier TEXT,
                        exp TEXT,
                        edu TEXT,
                        cats_json TEXT,
                        kw_json TEXT,
                        desc TEXT,
                        url TEXT,
                        source TEXT DEFAULT 'boss',
                        first_seen TEXT,
                        last_seen TEXT,
                        crawled_at TEXT,
                        is_new INTEGER DEFAULT 0,
                        raw_json TEXT
                    )
                    """
                )
                init_db(conn)
                columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
            finally:
                conn.close()
            self.assertIn("security_id", columns)


if __name__ == "__main__":
    unittest.main()
