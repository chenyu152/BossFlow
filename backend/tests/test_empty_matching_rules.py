import unittest
import json
import tempfile
from pathlib import Path

from crawler.boss import BossCrawler
from crawler.pipeline import classify, process_one


class EmptyMatchingRulesTest(unittest.TestCase):
    def setUp(self):
        self.game_job = {
            "title": "游戏系统策划",
            "company": "示例游戏公司",
            "city": "深圳",
            "salary": "20-30K",
            "desc": "负责游戏系统设计与数值平衡。",
        }

    def test_empty_category_mapping_does_not_use_legacy_rules(self):
        categories, keywords = classify(self.game_job["title"], {})
        self.assertEqual(categories, [])
        self.assertEqual(keywords, [])

    def test_empty_rules_keep_a_valid_collected_job(self):
        job = process_one(
            self.game_job,
            cat_rules={},
            relevance_keywords=[],
            blacklist_keywords=[],
            min_salary=17,
        )
        self.assertIsNotNone(job)
        self.assertEqual(job["cats"], ["通用"])

    def test_configured_rules_still_filter_unmatched_jobs(self):
        job = process_one(
            self.game_job,
            cat_rules={"嵌入式": ["STM32"]},
            relevance_keywords=[],
            blacklist_keywords=[],
            min_salary=0,
        )
        self.assertIsNone(job)

    def test_live_crawler_keeps_jobs_before_matching_rules_exist(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(json.dumps({
                "cat_rules": {},
                "relevance_keywords": [],
                "blacklist_keywords": [],
                "min_salary": 17,
            }), encoding="utf-8")
            crawler = BossCrawler.__new__(BossCrawler)
            crawler.config_file = str(config_path)
            self.assertTrue(crawler.is_relevant_job(self.game_job["title"]))


if __name__ == "__main__":
    unittest.main()
