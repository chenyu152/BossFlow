import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import account_activity_service as service
from crawler.db import upsert_jobs


class AccountActivityServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "account_activity.db"

    def tearDown(self):
        self.temp.cleanup()

    def _sync(self, pages, **kwargs):
        return service.sync_activity_pages("account-1", pages, db_path=self.db, **kwargs)

    def test_page_termination_guards_empty_duplicate_and_disabled_next(self):
        item = {"encryptJobId": "one", "title": "A", "company": "C", "city": "上海"}
        seen = set()
        self.assertEqual(service.should_continue_page([item], False, seen), (False, "next_disabled"))
        self.assertEqual(service.should_continue_page([item], True, seen), (False, "duplicate_page"))
        self.assertEqual(service.should_continue_page([], True, seen), (False, "empty_page"))

    def test_first_complete_run_is_baseline_and_second_run_marks_new(self):
        item = {"encryptJobId": "one", "title": "Agent", "company": "C", "city": "上海"}
        first = self._sync({"communicated": [{"items": [item], "hasNext": False}]}, tabs=["communicated"])
        self.assertTrue(first["ok"])
        self.assertEqual((first["newJobs"], first["newEvents"]), (0, 0))
        second = self._sync({"communicated": [{"items": [item, {**item, "encryptJobId": "two", "title": "Agent 2"}], "hasNext": False}]}, tabs=["communicated"])
        self.assertEqual((second["newJobs"], second["newEvents"]), (1, 1))

    def test_incomplete_sync_does_not_mark_absent_job_closed(self):
        item = {"encryptJobId": "one", "title": "Agent", "company": "C", "city": "上海", "closedStatus": "open"}
        self._sync({"communicated": [{"items": [item], "hasNext": False}]}, tabs=["communicated"])
        result = self._sync({"communicated": []}, tabs=["communicated"], complete=False, error="browser stopped")
        self.assertFalse(result["ok"])
        conn = sqlite3.connect(self.db)
        try:
            self.assertEqual(conn.execute("SELECT closed_status FROM account_jobs").fetchone()[0], "open")
        finally:
            conn.close()

    def test_incomplete_sync_does_not_create_new_badge(self):
        baseline = {"encryptJobId": "baseline", "title": "Agent", "company": "C", "city": "上海"}
        self._sync({"communicated": [{"items": [baseline], "hasNext": False}]}, tabs=["communicated"])
        partial = {"encryptJobId": "partial", "title": "Agent 2", "company": "C", "city": "上海"}
        result = self._sync({"communicated": [{"items": [partial], "hasNext": False}]}, tabs=["communicated"], complete=False, error="stopped")
        self.assertEqual((result["newJobs"], result["newEvents"]), (0, 0))

    def test_same_job_can_have_multiple_activity_events(self):
        item = {"encryptJobId": "one", "title": "Agent", "company": "C", "city": "上海"}
        self._sync({"communicated": [{"items": [item], "hasNext": False}], "applied": [{"items": [item], "hasNext": False}]}, tabs=["communicated", "applied"])
        conn = sqlite3.connect(self.db)
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM account_jobs").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM account_job_events").fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT DISTINCT initiator FROM account_job_events").fetchone()[0], "unknown")
        finally:
            conn.close()

    def test_identity_prefers_encrypt_id_then_url_then_weak_key(self):
        self.assertEqual(service.normalize_activity_item({"encryptJobId": "x", "url": "https://example/job_detail/y.html"}, "applied")["identity_confidence"], "high")
        self.assertEqual(service.normalize_activity_item({"url": "https://example/job_detail/y.html"}, "applied")["identity_confidence"], "high")
        self.assertEqual(service.normalize_activity_item({"title": "A", "company": "C", "city": "上海"}, "applied")["identity_confidence"], "low")

    def test_mismatched_city_is_not_imported_and_existing_id_is_reused(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        (project_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"], "cities": {"上海": "101020100"}}), encoding="utf-8")
        cleaned = {"title": "Agent", "company": "Known", "city": "上海", "salary": "20K", "url": "https://www.zhipin.com/job_detail/existing.html", "desc": ""}
        from crawler.pipeline import process_one
        upsert_jobs([process_one(cleaned)], project_dir / "jobs_data.db")
        self._sync({"applied": [{"items": [{"encryptJobId": "existing", "title": "Agent", "company": "Known", "city": "上海", "url": cleaned["url"]}], "hasNext": False}]}, tabs=["applied"])
        with patch.object(service, "resolve_project", return_value=project_dir):
            reused = service.import_account_activity("demo", [1], db_path=self.db)
            self.assertEqual(reused["projectJobIds"], [1])

        self._sync({"applied": [{"items": [{"encryptJobId": "beijing", "title": "Agent", "company": "Other", "city": "北京"}], "hasNext": False}]}, tabs=["applied"])
        with patch.object(service, "resolve_project", return_value=project_dir):
            blocked = service.import_account_activity("demo", [2], db_path=self.db)
        self.assertEqual(blocked["imported"], 0)
        self.assertIn("不匹配", blocked["failed"][0]["reason"])

    def test_browser_adapter_reports_missing_logged_in_activity_page(self):
        with patch.object(service, "_connect_logged_browser", side_effect=service.AccountActivityBrowserBlocked("missing")):
            with self.assertRaises(service.AccountActivityBrowserBlocked):
                service.discover_account_activity_pages("demo", "profile")

    def test_browser_connection_starts_the_requested_profile_on_a_private_port(self):
        captured = {}

        class Crawler:
            def __init__(self, profile_dir, chrome_port):
                captured["profile_dir"] = profile_dir
                captured["chrome_port"] = chrome_port
                self.profile_dir = profile_dir
                self.chrome_port = chrome_port
                self.page = object()

            def start_browser(self, headless=False):
                self.headless = headless

        profile = Path(self.temp.name) / "profile"
        with patch("crawler.boss.BossCrawler", Crawler), patch("backend.services.project_service.find_free_port", return_value=9444):
            page, owns = service._connect_logged_browser(str(profile))
        self.assertTrue(owns)
        self.assertIsNotNone(page)
        self.assertEqual(captured["profile_dir"], profile.resolve())
        self.assertEqual(captured["chrome_port"], 9444)

    def test_import_requires_saved_login_only_when_new_detail_is_needed(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        (project_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"]}), encoding="utf-8")
        item = {"encryptJobId": "needs-detail", "title": "Agent", "company": "Company", "city": "上海", "detailUrl": "https://www.zhipin.com/job_detail/needs-detail.html"}
        self._sync({"communicated": [{"items": [item], "hasNext": False}]}, tabs=["communicated"])
        login_error = HTTPException(status_code=409, detail="BOSS 登录状态已失效，请前往系统设置重新登录。")
        with patch.object(service, "resolve_project", return_value=project_dir), patch.object(service, "require_saved_login", side_effect=login_error), patch.object(service, "_connect_logged_browser") as connect:
            with self.assertRaises(HTTPException) as raised:
                service.import_account_activity("project", [1], profile_project="project", db_path=self.db)
        self.assertEqual(raised.exception.status_code, 409)
        connect.assert_not_called()
        conn = sqlite3.connect(self.db)
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM project_job_links").fetchone()[0], 0)
        finally:
            conn.close()

    def test_import_reuses_one_designated_profile_session_for_a_batch(self):
        target_dir = Path(self.temp.name) / "target"
        profile_dir = Path(self.temp.name) / "profile"
        target_dir.mkdir(); profile_dir.mkdir()
        (target_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"], "relevance_keywords": ["Agent"], "blacklist_keywords": [], "cat_rules": {}}), encoding="utf-8")
        (profile_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"]}), encoding="utf-8")
        items = [{"encryptJobId": f"detail-{index}", "title": f"Agent {index}", "company": "Company", "city": "上海", "detailUrl": f"https://www.zhipin.com/job_detail/detail-{index}.html"} for index in range(2)]
        self._sync({"communicated": [{"items": items, "hasNext": False}]}, tabs=["communicated"])
        browser = object()
        fetched = []

        def fetch(profile_path, row, page_browser=None):
            fetched.append((profile_path, page_browser))
            return {"title": row["title"], "company": "Company", "city": "上海", "salary": "20K", "url": row["detail_url"], "desc": "这是足够长的完整岗位描述内容"}

        def resolve(name):
            return target_dir if name == "target" else profile_dir

        with patch.object(service, "resolve_project", side_effect=resolve), patch.object(service, "_match_job", return_value={"relevance": "matched", "confidence": "high", "reason": "matched"}), patch.object(service, "require_saved_login", return_value={"canSchedule": True}), patch.object(service, "_connect_logged_browser", return_value=(browser, True)) as connect, patch.object(service, "_verify_logged_session") as verify, patch.object(service, "_fetch_job_detail_with_browser", side_effect=fetch):
            result = service.import_account_activity("target", [1, 2], profile_project="profile", db_path=self.db)

        self.assertEqual(result["imported"], 2)
        connect.assert_called_once()
        verify.assert_called_once_with(browser)
        self.assertEqual(len(fetched), 2)
        self.assertEqual({page for _, page in fetched}, {browser})
        self.assertTrue(all(Path(path).resolve() == Path(service.paths_for_project(profile_dir)["profilePath"]).resolve() for path, _ in fetched))

    def test_truncated_or_login_detail_is_rejected_without_fallback_body(self):
        class Tab:
            url = "https://www.zhipin.com/job_detail/test.html"

            def run_js(self, _script):
                return {"title": "Agent", "description": "很短", "body": "统一登录系统开发", "loginIndicator": False, "loginText": ""}

            def close(self):
                return None

        class Browser:
            def new_tab(self, _url):
                return Tab()

        result = service._fetch_job_detail_with_browser("profile", {"detail_url": "https://www.zhipin.com/job_detail/test.html"}, page_browser=Browser())
        self.assertIsNone(result)

    def test_normal_jd_login_word_is_not_treated_as_login_page(self):
        class Tab:
            url = "https://www.zhipin.com/job_detail/test.html"

            def run_js(self, _script):
                return {"title": "Agent", "description": "负责统一登录系统开发与维护，参与服务治理和稳定性建设。", "body": "统一登录系统开发", "loginIndicator": False, "loginText": ""}

            def close(self):
                return None

        class Browser:
            def new_tab(self, _url):
                return Tab()

        result = service._fetch_job_detail_with_browser("profile", {"detail_url": "https://www.zhipin.com/job_detail/test.html", "title": "Agent", "company": "Company", "city": "上海"}, page_browser=Browser())
        self.assertIsNotNone(result)

    def test_explicit_login_container_is_rejected(self):
        class Tab:
            url = "https://www.zhipin.com/job_detail/test.html"

            def run_js(self, _script):
                return {"title": "Agent", "description": "这是足够长的描述文本，但页面实际展示的是登录容器。", "body": "", "loginIndicator": True, "loginText": ""}

            def close(self):
                return None

        class Browser:
            def new_tab(self, _url):
                return Tab()

        result = service._fetch_job_detail_with_browser("profile", {"detail_url": "https://www.zhipin.com/job_detail/test.html"}, page_browser=Browser())
        self.assertIsNone(result)

    def test_profile_connection_failure_is_a_batch_level_409(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        (project_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"]}), encoding="utf-8")
        item = {"encryptJobId": "profile-failure", "title": "Agent", "company": "Company", "city": "上海", "detailUrl": "https://www.zhipin.com/job_detail/profile-failure.html"}
        self._sync({"communicated": [{"items": [item], "hasNext": False}]}, tabs=["communicated"])
        with patch.object(service, "resolve_project", return_value=project_dir), patch.object(service, "require_saved_login", return_value={"canSchedule": True}), patch.object(service, "_connect_logged_browser", side_effect=service.AccountActivityBrowserBlocked("指定 Profile 无法启动")):
            with self.assertRaises(HTTPException) as raised:
                service.import_account_activity("project", [1], profile_project="project", db_path=self.db)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("Profile", raised.exception.detail)

    def test_import_api_blocks_when_a_browser_task_is_running(self):
        class RunningTask:
            def snapshot(self):
                return {"running": True}

        with self.assertRaises(HTTPException) as raised:
            service.import_account_activity("project", [], task_manager=RunningTask(), db_path=self.db)
        self.assertEqual(raised.exception.status_code, 409)

    def test_boss_network_card_is_reduced_to_safe_job_summary(self):
        payload = {"code": 0, "zpData": {"cardList": [{"encryptJobId": "stable", "jobName": "Agent", "brandName": "Company", "cityName": "上海", "jobSalary": "20K", "jobValidStatus": 1}]}}
        normalized = service._normalize_boss_card(payload["zpData"]["cardList"][0])
        self.assertEqual(normalized["encryptJobId"], "stable")
        self.assertEqual(normalized["closedStatus"], "open")
        self.assertNotIn("bossName", normalized)
        self.assertEqual(service._extract_json_document(json.dumps(payload))["code"], 0)

    def test_list_recomputes_match_when_config_changes_and_does_not_use_old_link(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        (project_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"], "cities": {"上海": "101020100"}}), encoding="utf-8")
        item = {"encryptJobId": "refresh", "title": "高级嵌入式软件开发工程师", "company": "Company", "city": "上海"}
        self._sync({"communicated": [{"items": [item], "hasNext": False}]}, tabs=["communicated"])
        with patch.object(service, "resolve_project", return_value=project_dir), patch.object(service, "_match_job", return_value={"relevance": "matched", "confidence": "medium", "reason": "old"}):
            first = service.list_account_activity("agent", account_key="account-1", db_path=self.db)
        self.assertEqual(first["items"][0]["relevance"], "matched")
        with patch.object(service, "resolve_project", return_value=project_dir), patch.object(service, "_match_job", return_value={"relevance": "mismatched", "confidence": "high", "reason": "rules changed"}):
            second = service.list_account_activity("agent", account_key="account-1", db_path=self.db)
        self.assertEqual(second["items"][0]["relevance"], "mismatched")
        conn = sqlite3.connect(self.db)
        try:
            self.assertEqual(conn.execute("SELECT relevance FROM project_job_links").fetchone()[0], "mismatched")
        finally:
            conn.close()

    def test_same_account_can_switch_matching_projects_without_changing_record_count(self):
        first_project = Path(self.temp.name) / "agent"
        second_project = Path(self.temp.name) / "embedded"
        first_project.mkdir(); second_project.mkdir()
        item = {"encryptJobId": "shared", "title": "Agent", "company": "Company", "city": "上海"}
        self._sync({"communicated": [{"items": [item], "hasNext": False}]}, tabs=["communicated"])
        with patch.object(service, "resolve_project", side_effect=lambda name: first_project if name == "agent" else second_project), patch.object(service, "_match_job", side_effect=lambda row, path: {"relevance": "matched" if path == first_project else "mismatched", "confidence": "medium", "reason": str(path.name)}):
            agent = service.list_account_activity("agent", account_key="account-1", profile_project="agent", db_path=self.db)
            embedded = service.list_account_activity("embedded", account_key="account-1", profile_project="agent", db_path=self.db)
        self.assertEqual(agent["total"], embedded["total"])
        self.assertEqual(agent["items"][0]["relevance"], "matched")
        self.assertEqual(embedded["items"][0]["relevance"], "mismatched")
        conn = sqlite3.connect(self.db)
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM account_jobs").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM project_job_links").fetchone()[0], 2)
        finally:
            conn.close()

    def test_list_matches_only_current_page_after_sql_pagination(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        items = [{"encryptJobId": f"job-{index}", "title": f"Agent {index}", "company": "Company", "city": "上海"} for index in range(45)]
        self._sync({"communicated": [{"items": items, "hasNext": False}]}, tabs=["communicated"])
        calls = []
        with patch.object(service, "resolve_project", return_value=project_dir), patch.object(service, "_match_job", side_effect=lambda row, path: calls.append(row["id"]) or {"relevance": "matched", "confidence": "medium", "reason": "ok"}):
            result = service.list_account_activity("agent", account_key="account-1", page=1, page_size=30, db_path=self.db)
        self.assertEqual(result["total"], 45)
        self.assertEqual(len(result["items"]), 30)
        self.assertEqual(len(calls), 30)

    def test_python_filtered_results_recount_and_repage(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        items = [{"encryptJobId": f"filtered-{index}", "title": f"Agent {index}", "company": "Company", "city": "上海"} for index in range(45)]
        self._sync({"communicated": [{"items": items, "hasNext": False}]}, tabs=["communicated"])

        def match(row, _path):
            index = int(str(row["title"]).rsplit(" ", 1)[-1])
            return {"relevance": "matched" if index < 12 else "mismatched", "confidence": "medium", "reason": "test"}

        with patch.object(service, "resolve_project", return_value=project_dir), patch.object(service, "_match_job", side_effect=match):
            result = service.list_account_activity("agent", account_key="account-1", page=2, page_size=10, match_status="matched", db_path=self.db)

        self.assertEqual(result["total"], 12)
        self.assertEqual(result["pages"], 2)
        self.assertEqual(len(result["items"]), 2)
        self.assertTrue({item["title"] for item in result["items"]}.issubset({f"Agent {index}" for index in range(12)}))

    def test_actionable_pending_count_excludes_imported_closed_mismatched_and_incomplete(self):
        project_dir = Path(self.temp.name) / "project"
        project_dir.mkdir()
        (project_dir / "config.json").write_text(json.dumps({"keywords": ["Agent"]}), encoding="utf-8")
        baseline = {"encryptJobId": "baseline", "title": "Agent baseline", "company": "Company", "city": "上海", "closedStatus": "open"}
        self._sync({"communicated": [{"items": [baseline], "hasNext": False}]}, tabs=["communicated"])
        new_item = {"encryptJobId": "new", "title": "Agent new", "company": "Company", "city": "上海", "closedStatus": "open"}
        mismatched = {"encryptJobId": "mismatch", "title": "Product manager", "company": "Company", "city": "上海", "closedStatus": "open"}
        closed = {"encryptJobId": "closed", "title": "Agent closed", "company": "Company", "city": "上海", "closedStatus": "closed"}
        self._sync({"communicated": [{"items": [baseline, new_item, mismatched, closed], "hasNext": False}]}, tabs=["communicated"])
        with patch.object(service, "resolve_project", return_value=project_dir):
            pending = service.list_account_activity(
                "project",
                account_key="account-1",
                profile_project="project",
                new_only=True,
                import_status="pending",
                job_status="open",
                actionable_only=True,
                db_path=self.db,
            )
        self.assertEqual((pending["total"], pending["summary"]["actionablePending"]), (1, 1))
        conn = sqlite3.connect(self.db)
        try:
            new_id = conn.execute("SELECT id FROM account_jobs WHERE encrypt_job_id='new'").fetchone()[0]
        finally:
            conn.close()
        detail = {"title": "Agent new", "company": "Company", "city": "上海", "salary": "20K", "url": "https://example/job_detail/new.html", "desc": "Agent"}
        with patch.object(service, "resolve_project", return_value=project_dir):
            imported = service.import_account_activity("project", [new_id], db_path=self.db, detail_provider=lambda _row: detail)
            after_import = service.list_account_activity("project", account_key="account-1", profile_project="project", new_only=True, import_status="pending", job_status="open", actionable_only=True, db_path=self.db)
        self.assertEqual(imported["imported"], 1)
        self.assertEqual(after_import["total"], 0)

        incomplete = {"encryptJobId": "incomplete", "title": "Agent incomplete", "company": "Company", "city": "上海", "closedStatus": "open"}
        self._sync({"communicated": [{"items": [incomplete], "hasNext": False}]}, tabs=["communicated"], complete=False, error="stopped")
        with patch.object(service, "resolve_project", return_value=project_dir):
            after_incomplete = service.list_account_activity("project", account_key="account-1", profile_project="project", new_only=True, import_status="pending", job_status="open", actionable_only=True, db_path=self.db)
        self.assertEqual(after_incomplete["total"], 0)


if __name__ == "__main__":
    unittest.main()
