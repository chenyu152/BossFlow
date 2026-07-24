import unittest
import json
import sqlite3
import tempfile
from pathlib import Path

from crawler.boss import BossCrawler
from crawler.pipeline import admission_decision, process_one
from backend.services.evaluation_service import _extract_terms, _score
from backend.services.account_activity_service import _match_job


class FilterAndScoringV2Test(unittest.TestCase):
    def raw(self, title="AI Agent 工程师", salary="20-30K", exp="", edu=""):
        return {
            "title": title,
            "company": "示例公司",
            "city": "深圳",
            "salary": salary,
            "exp": exp,
            "edu": edu,
            "desc": "使用 LangGraph 和 RAG 构建智能应用。",
        }

    def test_category_rules_alone_never_control_admission(self):
        job = process_one(self.raw(), cat_rules={"嵌入式": ["STM32"]}, min_salary=100)
        self.assertIsNotNone(job)

    def test_collection_keywords_are_fallback_target_terms(self):
        self.assertTrue(admission_decision(self.raw("数据分析师"), target_keywords=["数据"])['accepted'])
        self.assertFalse(admission_decision(self.raw("财务会计"), target_keywords=["数据"])['accepted'])

    def test_blacklist_has_priority(self):
        decision = admission_decision(self.raw("AI Agent 外包工程师"), relevance_keywords=["Agent"], blacklist_keywords=["外包"])
        self.assertFalse(decision["accepted"])
        self.assertEqual(decision["reasonCode"], "blacklist_hit")

    def test_salary_never_blocks_admission(self):
        self.assertIsNotNone(process_one(self.raw(salary="面议"), relevance_keywords=["Agent"], min_salary=100))
        self.assertIsNotNone(process_one(self.raw(salary="5-8K"), relevance_keywords=["Agent"], min_salary=100))

    def test_empty_rules_keep_jobs(self):
        self.assertTrue(admission_decision(self.raw(), relevance_keywords=[], blacklist_keywords=[])['accepted'])

    def test_boss_crawler_uses_same_admission_policy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(json.dumps({"keywords": []}), encoding="utf-8")
            crawler = BossCrawler.__new__(BossCrawler)
            crawler.config_file = str(config_path)
            self.assertTrue(crawler.is_relevant_job("任意岗位"))

    def test_boss_activity_uses_the_same_title_admission_policy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            project_dir = Path(temp_dir)
            (project_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"], "cities": {"深圳": "1"}}), encoding="utf-8")
            connection = sqlite3.connect(":memory:")
            connection.row_factory = sqlite3.Row
            connection.execute("CREATE TABLE jobs (title TEXT, company TEXT, city TEXT, salary TEXT, detail_url TEXT, raw_summary_json TEXT)")
            connection.execute("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?)", ("财务会计", "示例公司", "深圳", "20-30K", "", "{}"))
            row = connection.execute("SELECT * FROM jobs").fetchone()
            activity_match = _match_job(row, project_dir)
            crawler_match = admission_decision({"title": row["title"]}, target_keywords=["Agent"])
            self.assertEqual(activity_match["relevance"], "mismatched" if not crawler_match["accepted"] else "matched")
            connection.close()

    def test_unknown_dimensions_do_not_get_positive_credit_and_long_jd_only_changes_confidence(self):
        config = {"keywordHints": []}
        short = self.raw(title="岗位", salary="面议")
        short["desc"] = "岗位描述"
        long = dict(short)
        long["desc"] = "岗位描述" + (" 详细职责" * 100)
        short_score = _score(short, "没有学历和经验信息", [], config, min_salary=30)
        long_score = _score(long, "没有学历和经验信息", [], config, min_salary=30)
        self.assertEqual(short_score["scoringVersion"], 2)
        self.assertEqual(short_score["score"], long_score["score"])
        self.assertNotEqual(short_score["confidence"], long_score["confidence"])
        self.assertIsNone(short_score["salaryMatch"])
        self.assertEqual(short_score["experienceRisk"], "unknown")
        self.assertEqual(short_score["educationRisk"], "unknown")

    def test_keyword_candidates_are_explicit_only(self):
        job = self.raw()
        self.assertEqual(_extract_terms(job, {"keywordHints": []}), [])
        self.assertEqual(_extract_terms(job, {"keywordHints": ["LangGraph"]}), ["LangGraph"])

    def test_scoring_returns_conclusion_and_reasons(self):
        result = _score(self.raw(exp="3年以上", edu="本科"), "本科\n1年工作经验\nLangGraph", ["LangGraph"], {"keywordHints": []}, min_salary=30)
        self.assertEqual(result["scoringVersion"], 2)
        self.assertIn(result["fitLevel"], {"优先查看", "可以看看", "存在明显门槛", "低相关"})
        self.assertTrue(result["reasons"])


if __name__ == "__main__":
    unittest.main()
