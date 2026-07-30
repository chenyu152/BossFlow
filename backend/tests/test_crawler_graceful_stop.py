import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from crawler.boss import BossAuthenticationError, BossCrawler, has_complete_job_detail, verify_boss_authenticated_session


class _FakePage:
    title = "BOSS"

    def quit(self):
        return None


class _FakeAuthTab:
    def __init__(self, markup):
        self.html = markup
        self.closed = False

    def close(self):
        self.closed = True


class _FakeAuthPage:
    def __init__(self, markup, public_jobs=True):
        self.markup = markup
        self.public_jobs = public_jobs
        self.tabs = []

    def get(self, _url):
        return None

    def new_tab(self, _url):
        tab = _FakeAuthTab(self.markup)
        self.tabs.append(tab)
        return tab

    def run_js(self, script):
        if 'job-card' in script:
            return self.public_jobs
        return False

    def quit(self):
        return None


class CrawlerGracefulStopTest(unittest.TestCase):
    def test_public_job_cards_do_not_prove_login_when_auth_api_fails(self):
        crawler = BossCrawler()
        crawler.page = _FakeAuthPage('{"code": 401, "zpData": {}}', public_jobs=True)
        with patch('crawler.boss.time.sleep', lambda *_args: None), patch('crawler.platform_utils.activate_chrome'), patch('crawler.platform_utils.notify'), patch('crawler.platform_utils.show_login_dialog', return_value=False):
            self.assertFalse(crawler.ensure_login())
        self.assertTrue(crawler.page.tabs)
        self.assertTrue(all(tab.closed for tab in crawler.page.tabs))

    def test_code_zero_activity_response_proves_authenticated_session(self):
        crawler = BossCrawler()
        crawler.page = _FakeAuthPage('<pre>{"code": 0, "zpData": {"cardList": []}}</pre>', public_jobs=False)
        with patch('crawler.boss.time.sleep', lambda *_args: None):
            self.assertTrue(crawler.ensure_login())
        self.assertTrue(crawler.page.tabs[0].closed)

    def test_auth_check_handles_non_json_and_closes_temporary_tab(self):
        page = _FakeAuthPage('<html>login</html>')
        self.assertFalse(verify_boss_authenticated_session(page))
        self.assertEqual(len(page.tabs), 1)
        self.assertTrue(page.tabs[0].closed)

    def test_auth_failure_does_not_start_crawl_callback(self):
        with tempfile.TemporaryDirectory() as tmp:
            crawler = BossCrawler(partial_file=Path(tmp) / 'crawl_partial.json')
            crawler.page = _FakeAuthPage('{"code": 500, "zpData": {}}', public_jobs=True)
            crawler.start_browser = lambda headless=False: None
            callbacks = []
            auth_failures = []
            crawler.set_crawl_started_callback(lambda: callbacks.append('started'))
            crawler.set_auth_failed_callback(lambda: auth_failures.append('failed'))
            with patch('crawler.boss.time.sleep', lambda *_args: None), patch('crawler.platform_utils.activate_chrome'), patch('crawler.platform_utils.notify'), patch('crawler.platform_utils.show_login_dialog', return_value=False):
                with self.assertRaises(BossAuthenticationError):
                    crawler.run(keywords=['关键词'], cities={'深圳': '101280600'})
            self.assertEqual(callbacks, [])
            self.assertTrue(auth_failures)

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
