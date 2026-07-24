import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from crawler.boss import BossCrawler, has_complete_job_detail


class _FakePage:
    title = "BOSS"

    def quit(self):
        return None


class CrawlerGracefulStopTest(unittest.TestCase):
    def test_legacy_partial_requires_a_substantial_description(self):
        self.assertFalse(has_complete_job_detail({"desc": "Python RAG Agent"}))
        self.assertTrue(has_complete_job_detail({"desc": "完整岗位描述" * 30}))
        self.assertFalse(has_complete_job_detail({
            "desc": "完整岗位描述" * 30,
            "_detail_complete": False,
        }))

    def test_multi_keyword_stop_skips_keyword_rest_and_returns_only_complete_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            partial = Path(tmp) / "crawl_partial.json"
            crawler = BossCrawler(partial_file=partial)
            crawler.page = _FakePage()
            crawler.start_browser = lambda headless=False: None
            crawler.ensure_login = lambda city: True

            calls = []

            def run_keyword(keyword, cities, **kwargs):
                calls.append(keyword)
                crawler._stopped = True
                return [
                    {
                        "title": "完整岗位",
                        "company": "示例公司",
                        "city": "深圳",
                        "desc": "完整岗位详情",
                        "_detail_complete": True,
                    },
                    {
                        "title": "待续采岗位",
                        "company": "示例公司",
                        "city": "广州",
                        "desc": "技能标签",
                        "_detail_complete": False,
                    },
                ]

            crawler.run_keyword = run_keyword

            with patch("crawler.boss.random.shuffle", lambda values: None), patch(
                "crawler.boss.simulate_human",
                side_effect=AssertionError("停止后不应再执行关键词切换的人机模拟"),
            ):
                result = crawler.run(
                    keywords=["关键词一", "关键词二"],
                    cities={"深圳": "101280600"},
                )

            self.assertEqual(calls, ["关键词一"])
            self.assertEqual([item["title"] for item in result], ["完整岗位"])
            self.assertTrue(partial.exists())
            self.assertIn("待续采岗位", partial.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
