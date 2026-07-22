import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
