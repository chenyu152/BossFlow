import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from crawler.db import (
    init_db,
    load_existing_job_index,
    touch_existing_jobs,
    upsert_jobs,
)
from crawler.boss import BossCrawler
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

    def test_known_job_can_skip_detail_and_refresh_seen_time(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            job = process_one(
                {
                    "title": "Agent 开发工程师",
                    "company": "示例公司",
                    "city": "深圳",
                    "salary": "20-30K",
                    "desc": "旧详情内容",
                    "url": "https://www.zhipin.com/job_detail/encrypt-123.html",
                    "security_id": "security-123",
                },
                min_salary=0,
            )
            upsert_jobs([job], db_path)

            index = load_existing_job_index(db_path)
            crawler = BossCrawler(profile_dir=Path(temp_dir) / "profile")
            crawler.set_existing_job_index(index)
            listed_job = {
                "job_name": "Agent 开发工程师",
                "company": "示例公司",
                "city": "深圳",
                "encrypt_job_id": "encrypt-123",
                "security_id": "security-123",
            }
            row_id = crawler._existing_db_id(listed_job)
            self.assertIsNotNone(row_id)
            crawler.page = SimpleNamespace(title="ready")
            crawler.all_jobs = {"id:encrypt-123": listed_job}
            self.assertEqual(crawler.run_keyword("Agent", {}), [])
            self.assertEqual(crawler.seen_existing_job_ids, {row_id})

            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    "UPDATE jobs SET last_seen = '2020-01-01', crawled_at = '2020-01-01 00:00' WHERE id = ?",
                    (row_id,),
                )
                conn.commit()
            finally:
                conn.close()

            self.assertEqual(touch_existing_jobs([row_id], db_path), 1)
            conn = sqlite3.connect(db_path)
            try:
                last_seen, crawled_at, description = conn.execute(
                    "SELECT last_seen, crawled_at, desc FROM jobs WHERE id = ?",
                    (row_id,),
                ).fetchone()
            finally:
                conn.close()
            self.assertNotEqual(last_seen, "2020-01-01")
            self.assertEqual(crawled_at, "2020-01-01 00:00")
            self.assertEqual(description, "旧详情内容")

    def test_list_rows_count_database_new_jobs_and_respect_total_limit(self):
        crawler = BossCrawler(profile_dir=Path("unused-profile"))
        crawler.is_relevant_job = lambda *_args: True
        crawler.set_existing_job_index({"by_encrypt_id": {"known": 7}})
        rows = [
            {"job_name": "已采集岗位", "company": "A", "city": "深圳", "encrypt_job_id": "known"},
            {"job_name": "新岗位一", "company": "B", "city": "深圳", "encrypt_job_id": "new-1"},
            {"job_name": "新岗位二", "company": "C", "city": "深圳", "encrypt_job_id": "new-2"},
        ]

        _, _, _, database_new, observed = crawler._add_jobs(
            rows,
            combo_seen_keys=set(),
            remaining_limit=2,
        )

        self.assertEqual(observed, 2)
        self.assertEqual(database_new, 1)
        self.assertEqual(crawler.seen_existing_job_ids, {7})


if __name__ == "__main__":
    unittest.main()
