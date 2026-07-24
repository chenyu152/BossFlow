"""Account-scoped BOSS activity storage and safe import orchestration.

The account activity database is intentionally separate from each direction's
``jobs_data.db``.  Browser extraction is kept behind an explicit adapter: the
current release does not guess BOSS's private activity URL or DOM selectors.
"""

from __future__ import annotations

import hashlib
import html
import json
import logging
import random
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException

from backend.services.login_state_service import require_saved_login
from backend.services.project_service import paths_for_project, resolve_project
from backend.storage.paths import BASE_DIR
from crawler.boss import load_config
from crawler.db import JOB_DETAIL_ID_RE, load_existing_job_index, upsert_jobs
from crawler.pipeline import admission_decision, process_one

logger = logging.getLogger(__name__)

ACCOUNT_ACTIVITY_DB = BASE_DIR / "data" / "account" / "account_activity.db"
EVENT_TYPES = ("communicated", "applied", "interview", "favorited")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, separators=(",", ":"))


def _connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    path = Path(db_path or ACCOUNT_ACTIVITY_DB)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    init_account_activity_db(conn)
    return conn


def init_account_activity_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS platform_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_key TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL DEFAULT '',
          last_sync_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_sync_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES platform_accounts(id),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          is_complete INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          tabs_json TEXT NOT NULL DEFAULT '[]',
          page_counts_json TEXT NOT NULL DEFAULT '{}',
          item_counts_json TEXT NOT NULL DEFAULT '{}',
          error TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS account_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES platform_accounts(id),
          platform_key TEXT NOT NULL,
          encrypt_job_id TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          company TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          salary TEXT NOT NULL DEFAULT '',
          detail_url TEXT NOT NULL DEFAULT '',
          closed_status TEXT NOT NULL DEFAULT 'unknown',
          identity_confidence TEXT NOT NULL DEFAULT 'weak',
          raw_summary_json TEXT NOT NULL DEFAULT '{}',
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          detail_synced_at TEXT,
          first_sync_run_id INTEGER NOT NULL REFERENCES account_sync_runs(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ux_account_jobs_key ON account_jobs(account_id, platform_key);
        CREATE INDEX IF NOT EXISTS ix_account_jobs_account_seen ON account_jobs(account_id, last_seen_at);
        CREATE TABLE IF NOT EXISTS account_job_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_job_id INTEGER NOT NULL REFERENCES account_jobs(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          initiator TEXT NOT NULL DEFAULT 'unknown',
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          first_sync_run_id INTEGER NOT NULL REFERENCES account_sync_runs(id),
          UNIQUE(account_job_id, event_type)
        );
        CREATE TABLE IF NOT EXISTS project_job_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_job_id INTEGER NOT NULL REFERENCES account_jobs(id) ON DELETE CASCADE,
          project TEXT NOT NULL,
          relevance TEXT NOT NULL DEFAULT 'uncertain',
          confidence TEXT NOT NULL DEFAULT 'low',
          reason TEXT NOT NULL DEFAULT '',
          project_job_id INTEGER,
          imported_at TEXT,
          pipeline_source_key TEXT,
          UNIQUE(account_job_id, project)
        );
        """
    )
    conn.commit()


def _account_key(value: str, fallback: str = "") -> str:
    value = str(value or "").strip()
    if value:
        return value[:180]
    # Never persist a cookie. A profile-derived digest is only an isolation key.
    return "profile:" + hashlib.sha256(str(fallback or "default").encode()).hexdigest()[:32]


def _get_account(conn: sqlite3.Connection, account_key: str, display_name: str = "") -> int:
    now = _now()
    conn.execute(
        "INSERT INTO platform_accounts(account_key, display_name, created_at) VALUES (?, ?, ?) "
        "ON CONFLICT(account_key) DO UPDATE SET display_name=CASE WHEN excluded.display_name <> '' THEN excluded.display_name ELSE platform_accounts.display_name END",
        (account_key, str(display_name or "")[:120], now),
    )
    return int(conn.execute("SELECT id FROM platform_accounts WHERE account_key=?", (account_key,)).fetchone()[0])


def _platform_key(raw: dict[str, Any]) -> tuple[str, str, str]:
    encrypt_id = str(raw.get("encryptJobId") or raw.get("encrypt_job_id") or "").strip()
    url = str(raw.get("detailUrl") or raw.get("detail_url") or raw.get("url") or "").strip()
    if not encrypt_id:
        match = JOB_DETAIL_ID_RE.search(url)
        encrypt_id = match.group(1) if match else ""
    if encrypt_id:
        return "encrypt:" + encrypt_id, encrypt_id, "high"
    if url:
        return "url:" + url, "", "medium"
    weak = "|".join(str(raw.get(key) or "").strip().lower() for key in ("title", "company", "city"))
    return "weak:" + hashlib.sha256(weak.encode()).hexdigest(), "", "low"


def normalize_activity_item(raw: dict[str, Any], event_type: str) -> dict[str, Any]:
    if event_type not in EVENT_TYPES:
        raise ValueError(f"unsupported activity event: {event_type}")
    platform_key, encrypt_id, confidence = _platform_key(raw)
    summary = {
        key: str(raw.get(key) or "").strip()
        for key in ("title", "company", "city", "salary", "exp", "edu", "detailUrl", "detail_url", "url")
        if raw.get(key) not in (None, "")
    }
    return {
        "platform_key": platform_key,
        "encrypt_job_id": encrypt_id,
        "title": str(raw.get("title") or "").strip()[:200],
        "company": str(raw.get("company") or "").strip()[:200],
        "city": str(raw.get("city") or "").strip()[:120],
        "salary": str(raw.get("salary") or "").strip()[:80],
        "detail_url": str(raw.get("detailUrl") or raw.get("detail_url") or raw.get("url") or "").strip()[:1000],
        "closed_status": str(raw.get("closedStatus") or raw.get("closed_status") or "unknown").strip().lower() or "unknown",
        "identity_confidence": confidence,
        "raw_summary_json": _json(summary),
        "event_type": event_type,
        "initiator": "unknown",
    }


def page_fingerprint(items: list[dict[str, Any]]) -> str:
    keys = [normalize_activity_item(item, "communicated")["platform_key"] for item in items]
    return hashlib.sha256(_json(sorted(keys)).encode()).hexdigest()


def should_continue_page(items: list[dict[str, Any]], has_next: bool | None, seen_fingerprints: set[str]) -> tuple[bool, str]:
    if not items:
        return False, "empty_page"
    fingerprint = page_fingerprint(items)
    if fingerprint in seen_fingerprints:
        return False, "duplicate_page"
    seen_fingerprints.add(fingerprint)
    if has_next is False:
        return False, "next_disabled"
    return True, "next"


def _upsert_page(conn: sqlite3.Connection, account_id: int, run_id: int, event_type: str, items: list[dict[str, Any]]) -> tuple[int, int]:
    now = _now()
    new_jobs = new_events = 0
    for raw in items:
        item = normalize_activity_item(raw, event_type)
        row = conn.execute("SELECT id FROM account_jobs WHERE account_id=? AND platform_key=?", (account_id, item["platform_key"])).fetchone()
        if row:
            job_id = int(row[0])
            conn.execute(
                "UPDATE account_jobs SET encrypt_job_id=CASE WHEN ? <> '' THEN ? ELSE encrypt_job_id END, title=?, company=?, city=?, salary=?, detail_url=?, closed_status=?, identity_confidence=?, raw_summary_json=?, last_seen_at=? WHERE id=?",
                (item["encrypt_job_id"], item["encrypt_job_id"], item["title"], item["company"], item["city"], item["salary"], item["detail_url"], item["closed_status"], item["identity_confidence"], item["raw_summary_json"], now, job_id),
            )
        else:
            cursor = conn.execute(
                "INSERT INTO account_jobs(account_id, platform_key, encrypt_job_id, title, company, city, salary, detail_url, closed_status, identity_confidence, raw_summary_json, first_seen_at, last_seen_at, first_sync_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (account_id, item["platform_key"], item["encrypt_job_id"], item["title"], item["company"], item["city"], item["salary"], item["detail_url"], item["closed_status"], item["identity_confidence"], item["raw_summary_json"], now, now, run_id),
            )
            job_id = int(cursor.lastrowid)
            new_jobs += 1
        event = conn.execute("SELECT id FROM account_job_events WHERE account_job_id=? AND event_type=?", (job_id, event_type)).fetchone()
        if event:
            conn.execute("UPDATE account_job_events SET last_seen_at=? WHERE id=?", (now, int(event[0])))
        else:
            conn.execute(
                "INSERT INTO account_job_events(account_job_id, event_type, initiator, first_seen_at, last_seen_at, first_sync_run_id) VALUES (?, ?, 'unknown', ?, ?, ?)",
                (job_id, event_type, now, now, run_id),
            )
            new_events += 1
    return new_jobs, new_events


def sync_activity_pages(
    account_key: str,
    pages_by_event: dict[str, list[dict[str, Any]]],
    tabs: list[str] | None = None,
    complete: bool = True,
    error: str = "",
    display_name: str = "",
    db_path: str | Path | None = None,
) -> dict[str, Any]:
    selected = [tab for tab in (tabs or EVENT_TYPES) if tab in EVENT_TYPES]
    conn = _connect(db_path)
    try:
        account_id = _get_account(conn, _account_key(account_key), display_name)
        previous = conn.execute("SELECT id FROM account_sync_runs WHERE account_id=? AND is_complete=1 ORDER BY id DESC LIMIT 1", (account_id,)).fetchone()
        cursor = conn.execute("INSERT INTO account_sync_runs(account_id, started_at, tabs_json) VALUES (?, ?, ?)", (account_id, _now(), _json(selected)))
        run_id = int(cursor.lastrowid)
        page_counts: dict[str, int] = {}
        item_counts: dict[str, int] = {}
        new_jobs = new_events = 0
        incomplete_reason = error
        for event_type in selected:
            seen: set[str] = set()
            pages = pages_by_event.get(event_type) or []
            for page in pages:
                items = list(page.get("items") or [])
                keep_going, reason = should_continue_page(items, page.get("hasNext"), seen)
                if reason == "duplicate_page":
                    incomplete_reason = incomplete_reason or f"{event_type}: duplicate page fingerprint"
                    complete = False
                    break
                if not items:
                    break
                added_jobs, added_events = _upsert_page(conn, account_id, run_id, event_type, items)
                new_jobs += added_jobs
                new_events += added_events
                page_counts[event_type] = page_counts.get(event_type, 0) + 1
                item_counts[event_type] = item_counts.get(event_type, 0) + len(items)
                conn.execute("UPDATE account_sync_runs SET page_counts_json=?, item_counts_json=? WHERE id=?", (_json(page_counts), _json(item_counts), run_id))
                conn.commit()
                if not keep_going:
                    break
        if incomplete_reason:
            complete = False
        status = "succeeded" if complete else "incomplete"
        conn.execute("UPDATE account_sync_runs SET finished_at=?, is_complete=?, status=?, page_counts_json=?, item_counts_json=?, error=? WHERE id=?", (_now(), int(complete), status, _json(page_counts), _json(item_counts), incomplete_reason, run_id))
        if complete:
            conn.execute("UPDATE platform_accounts SET last_sync_at=? WHERE id=?", (_now(), account_id))
        conn.commit()
        # A first complete run is a baseline; it must not produce new badges.
        if not complete or (previous is None and complete):
            new_jobs = new_events = 0
        return {"ok": complete, "runId": run_id, "status": status, "accountKey": _account_key(account_key), "newJobs": new_jobs, "newEvents": new_events, "pageCounts": page_counts, "itemCounts": item_counts, "error": incomplete_reason}
    finally:
        conn.close()


def record_sync_failure(account_key: str, error: str, db_path: str | Path | None = None) -> dict[str, Any]:
    conn = _connect(db_path)
    try:
        account_id = _get_account(conn, _account_key(account_key))
        now = _now()
        cursor = conn.execute("INSERT INTO account_sync_runs(account_id, started_at, finished_at, status, error) VALUES (?, ?, ?, 'failed', ?)", (account_id, now, now, str(error)))
        conn.commit()
        return {"ok": False, "runId": int(cursor.lastrowid), "status": "failed", "error": str(error)}
    finally:
        conn.close()


class AccountActivityBrowserBlocked(RuntimeError):
    pass


ACTIVITY_ENDPOINTS = {
    "communicated": "https://www.zhipin.com/wapi/zprelation/interaction/geekGetJob?page={page}&tag=5&isActive=true",
    "applied": "https://www.zhipin.com/wapi/zprelation/resume/geekDeliverList?page={page}",
    "interview": "https://www.zhipin.com/wapi/zpinterview/geek/interview/list?page={page}",
    "favorited": "https://www.zhipin.com/wapi/zprelation/interaction/geekGetJob?page={page}&tag=4&isActive=true",
}


def _extract_json_document(markup: str) -> dict[str, Any]:
    match = re.search(r"<pre[^>]*>(.*?)</pre>", str(markup or ""), flags=re.IGNORECASE | re.DOTALL)
    raw = html.unescape(match.group(1) if match else str(markup or "")).strip()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AccountActivityBrowserBlocked("BOSS 活动接口返回了无法解析的结果；本轮未写入岗位数据。") from exc
    if not isinstance(payload, dict) or payload.get("code") not in (0, "0", None):
        raise AccountActivityBrowserBlocked(f"BOSS 活动接口不可用：{payload.get('message', 'unknown error') if isinstance(payload, dict) else 'invalid response'}")
    return payload


def _normalize_boss_card(card: dict[str, Any]) -> dict[str, Any]:
    encrypt_id = str(card.get("encryptJobId") or card.get("encrypt_job_id") or "").strip()
    # The URL shape is directly observed on the logged-in activity page; the
    # stable encrypt id remains the primary deduplication key.
    detail_url = str(card.get("detailUrl") or card.get("url") or "").strip()
    if not detail_url and encrypt_id:
        detail_url = f"https://www.zhipin.com/job_detail/{encrypt_id}.html"
    valid_status = card.get("jobValidStatus")
    closed_status = "open" if valid_status == 1 else "closed" if valid_status in (0, 2) else "unknown"
    return {
        "encryptJobId": encrypt_id,
        "detailUrl": detail_url,
        "title": str(card.get("jobName") or card.get("title") or "").strip(),
        "company": str(card.get("brandName") or card.get("company") or "").strip(),
        "city": str(card.get("cityName") or card.get("city") or "").strip(),
        "salary": str(card.get("salaryDesc") or card.get("jobSalary") or "").strip(),
        "exp": str(card.get("jobExperience") or "").strip(),
        "edu": str(card.get("jobDegree") or "").strip(),
        "closedStatus": closed_status,
    }


def _connect_logged_browser(profile_path: str):
    try:
        from backend.services.project_service import find_free_port
        from crawler.boss import BossCrawler
    except Exception as exc:
        raise AccountActivityBrowserBlocked("当前环境没有可用的浏览器连接组件。") from exc
    resolved_profile = Path(profile_path).expanduser().resolve()
    try:
        crawler = BossCrawler(profile_dir=resolved_profile, chrome_port=find_free_port(9222))
        crawler.start_browser(headless=False)
        return crawler.page, True
    except Exception as launch_error:
        raise AccountActivityBrowserBlocked(
            f"未能启动指定 BOSS Profile（{resolved_profile}）；请先在系统设置中登录并保存 Cookie。"
        ) from launch_error


def _verify_logged_session(page_browser: Any) -> dict[str, Any]:
    """Make one authenticated BOSS request before reading activity or JD detail."""
    tab = None
    try:
        tab = page_browser.new_tab(ACTIVITY_ENDPOINTS["communicated"].format(page=1))
        time.sleep(random.uniform(0.4, 0.8))
        payload = _extract_json_document(tab.html)
        if payload.get("code") not in (0, "0") or not isinstance(payload.get("zpData"), dict):
            raise AccountActivityBrowserBlocked("BOSS 登录状态已失效，请前往系统设置重新登录。")
        return payload
    except AccountActivityBrowserBlocked:
        raise
    except Exception as exc:
        raise AccountActivityBrowserBlocked("BOSS 登录状态已失效，请前往系统设置重新登录。") from exc
    finally:
        if tab is not None:
            tab.close()


def discover_account_activity_pages(
    _project: str,
    profile_path: str,
    tabs: list[str] | None = None,
    max_pages: int | None = None,
) -> dict[str, list[dict[str, Any]]]:
    selected = [tab for tab in (tabs or EVENT_TYPES) if tab in ACTIVITY_ENDPOINTS]
    if not selected:
        return {}
    page_browser, owns_browser = _connect_logged_browser(profile_path)
    pages_by_event: dict[str, list[dict[str, Any]]] = {}
    try:
        _verify_logged_session(page_browser)
        for event_type in selected:
            seen: set[str] = set()
            pages: list[dict[str, Any]] = []
            page_number = 1
            while True:
                tab = None
                try:
                    tab = page_browser.new_tab(ACTIVITY_ENDPOINTS[event_type].format(page=page_number))
                    time.sleep(random.uniform(0.8, 1.5))
                    payload = _extract_json_document(tab.html)
                finally:
                    if tab is not None:
                        tab.close()
                data = payload.get("zpData") or {}
                cards = data.get("cardList") or data.get("list") or data.get("items") or []
                items = [_normalize_boss_card(card) for card in cards if isinstance(card, dict)]
                has_more = bool(data.get("hasMore"))
                fingerprint = page_fingerprint(items) if items else ""
                if fingerprint and fingerprint in seen:
                    raise AccountActivityBrowserBlocked(f"{event_type} 活动页出现重复分页，已安全停止。")
                if fingerprint:
                    seen.add(fingerprint)
                pages.append({"items": items, "hasNext": has_more, "fingerprint": fingerprint})
                if not items or not has_more or (max_pages and len(pages) >= max_pages):
                    break
                page_number += 1
            pages_by_event[event_type] = pages
        return pages_by_event
    finally:
        if owns_browser:
            try:
                page_browser.quit()
            except Exception:
                pass


def _fetch_job_detail_with_browser(profile_path: str, row: dict[str, Any], page_browser: Any | None = None) -> dict[str, Any] | None:
    detail_url = str(row.get("detail_url") or "").strip()
    if not detail_url:
        return None
    owns_browser = False
    if page_browser is None:
        page_browser, owns_browser = _connect_logged_browser(profile_path)
        try:
            _verify_logged_session(page_browser)
        except Exception:
            if owns_browser:
                try:
                    page_browser.quit()
                except Exception:
                    pass
            raise
    tab = None
    try:
        tab = page_browser.new_tab(detail_url)
        time.sleep(random.uniform(0.8, 1.5))
        data = tab.run_js(
            "return {title: document.querySelector('.job-primary .name')?.innerText || '', "
            "description: document.querySelector('.job-sec-text')?.innerText || "
            "document.querySelector('.job-detail-section .text')?.innerText || '', "
            "body: (document.body?.innerText || '').slice(0, 6000), "
            "loginIndicator: Boolean(document.querySelector('form[action*=\\\"login\\\"], .login-wrap, .login-content, .login-container, [data-testid=\\\"login\\\"]')), "
            "loginText: (document.querySelector('.login-wrap, .login-content, .login-container')?.innerText || '').slice(0, 500)};"
        ) or {}
        body = str(data.get("body") or "")
        if any(marker in body for marker in ("职位已关闭", "职位已下线", "职位不存在")):
            return {"closedStatus": "closed"}
        page_title = str(data.get("title") or "").strip()
        description = str(data.get("description") or "").strip()
        page_url = str(getattr(tab, "url", "") or "").lower()
        login_text = str(data.get("loginText") or "")
        if "login" in page_url or bool(data.get("loginIndicator")) or any(marker in login_text for marker in ("请先登录", "登录后继续", "扫码登录", "账号登录", "手机登录")):
            return None
        if not page_title or len(description) < 20:
            return None
        return {
            "title": page_title,
            "company": str(row.get("company") or "").strip(),
            "city": str(row.get("city") or "").strip(),
            "salary": str(row.get("salary") or "").strip(),
            "exp": str(json.loads(row.get("raw_summary_json") or "{}").get("exp") or "").strip(),
            "edu": str(json.loads(row.get("raw_summary_json") or "{}").get("edu") or "").strip(),
            "url": detail_url,
            "desc": description,
            "closedStatus": "open",
        }
    finally:
        if tab is not None:
            tab.close()
        if owns_browser:
            try:
                page_browser.quit()
            except Exception:
                pass


def start_account_activity_sync(payload: dict[str, Any], task_manager: Any, browser_sync: Callable[..., dict[str, list[dict[str, Any]]]] | None = None) -> dict[str, Any]:
    profile_project = str(payload.get("profileProject") or payload.get("project") or "").strip()
    match_project = str(payload.get("matchProject") or payload.get("project") or profile_project).strip()
    require_saved_login(profile_project)
    project_dir = resolve_project(profile_project)
    profile_path = paths_for_project(project_dir)["profilePath"]
    account_key = _account_key(payload.get("accountKey", ""), profile_path)
    tabs = list(payload.get("tabs") or EVENT_TYPES)
    sync_adapter = browser_sync or discover_account_activity_pages

    def worker() -> None:
        try:
            pages = (
                discover_account_activity_pages(match_project, profile_path, tabs=tabs)
                if browser_sync is None
                else browser_sync(match_project, profile_path)
            )
            sync_activity_pages(account_key, pages, tabs=tabs)
        except Exception as exc:
            record_sync_failure(account_key, str(exc))
            raise

    task_manager.start("account-activity-sync", worker)
    return {"ok": True, "status": "queued", "accountKey": account_key, "message": "BOSS 活动同步已加入队列"}


def _match_job(row: sqlite3.Row, project_dir: Path) -> dict[str, Any]:
    title, company, city = str(row["title"] or ""), str(row["company"] or ""), str(row["city"] or "")
    if not title or not company or not city:
        return {"relevance": "uncertain", "confidence": "low", "reason": "岗位摘要信息不足，需人工确认"}
    config = load_config(str(project_dir))
    cities = [str(name).strip() for name in (config.get("cities") or {}).keys() if str(name).strip()]
    if cities and not any(name in city or city in name for name in cities):
        return {"relevance": "mismatched", "confidence": "high", "reason": "城市不在当前求职目标范围"}
    raw = {"title": title, "company": company, "city": city, "salary": row["salary"], "url": row["detail_url"], "desc": json.loads(row["raw_summary_json"] or "{}").get("desc", "")}
    relevance = config.get("relevance_keywords") or []
    blacklist = config.get("blacklist_keywords") or []
    decision = admission_decision(
        raw,
        relevance_keywords=relevance,
        blacklist_keywords=blacklist,
        target_keywords=config.get("keywords") or [],
    )
    if not decision["accepted"]:
        return {"relevance": "mismatched", "confidence": "medium", "reason": decision["reason"]}
    return {"relevance": "matched", "confidence": "medium", "reason": decision["reason"]}


def _existing_project_id(row: sqlite3.Row, project_dir: Path) -> int | None:
    index = load_existing_job_index(project_dir / "jobs_data.db")
    return _existing_project_id_from_index(row, index)


def _existing_project_id_from_index(row: sqlite3.Row, index: dict[str, Any]) -> int | None:
    if row["encrypt_job_id"] and row["encrypt_job_id"] in index["by_encrypt_id"]:
        return int(index["by_encrypt_id"][row["encrypt_job_id"]])
    summary = json.loads(row["raw_summary_json"] or "{}")
    url = row["detail_url"] or summary.get("url") or summary.get("detailUrl")
    if url:
        for candidate in index["by_encrypt_id"].items():
            if candidate[0] and candidate[0] in str(url):
                return int(candidate[1])
    return None


def _legacy_list_account_activity(project: str, tab: str = "all", page: int = 1, page_size: int = 30, search: str = "", new_only: bool = False, account_key: str = "", db_path: str | Path | None = None) -> dict[str, Any]:
    if tab not in ("all", *EVENT_TYPES):
        raise HTTPException(status_code=400, detail="Unsupported account activity tab")
    project_dir = resolve_project(project)
    conn = _connect(db_path)
    try:
        account = conn.execute("SELECT id, account_key FROM platform_accounts WHERE account_key=?", (_account_key(account_key, paths_for_project(project_dir)["profilePath"]),)).fetchone()
        if not account:
            return {"ok": True, "items": [], "total": 0, "page": page, "pageSize": page_size, "pages": 0, "sync": None}
        account_id = int(account["id"])
        baseline = conn.execute("SELECT id FROM account_sync_runs WHERE account_id=? AND is_complete=1 ORDER BY id LIMIT 1", (account_id,)).fetchone()
        where = ["j.account_id=?"]
        params: list[Any] = [account_id]
        if tab != "all":
            where.append("EXISTS (SELECT 1 FROM account_job_events fe WHERE fe.account_job_id=j.id AND fe.event_type=?)")
            params.append(tab)
        if search.strip():
            needle = f"%{search.strip()}%"
            where.append("(j.title LIKE ? OR j.company LIKE ? OR j.city LIKE ?)")
            params.extend([needle, needle, needle])
        rows = conn.execute(f"SELECT j.*, GROUP_CONCAT(e.event_type) AS event_types, GROUP_CONCAT(e.first_sync_run_id) AS event_runs FROM account_jobs j LEFT JOIN account_job_events e ON e.account_job_id=j.id WHERE {' AND '.join(where)} GROUP BY j.id ORDER BY j.last_seen_at DESC", params).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            first_run_complete = conn.execute("SELECT is_complete FROM account_sync_runs WHERE id=?", (int(row["first_sync_run_id"]),)).fetchone()
            event_runs = [int(x) for x in str(row["event_runs"] or "").split(",") if x]
            event_complete = bool(event_runs) and all(conn.execute("SELECT is_complete FROM account_sync_runs WHERE id=?", (event_run,)).fetchone()[0] for event_run in event_runs)
            is_new = bool(baseline and first_run_complete and first_run_complete[0] and event_complete and (int(row["first_sync_run_id"]) != int(baseline["id"]) or any(event_run != int(baseline["id"]) for event_run in event_runs)))
            if new_only and not is_new:
                continue
            match = _match_job(row, project_dir)
            link = conn.execute("SELECT * FROM project_job_links WHERE account_job_id=? AND project=?", (int(row["id"]), project)).fetchone()
            if link:
                match = {"relevance": link["relevance"], "confidence": link["confidence"], "reason": link["reason"]}
            items.append({"id": int(row["id"]), "platformKey": row["platform_key"], "encryptJobId": row["encrypt_job_id"], "title": row["title"], "company": row["company"], "city": row["city"], "salary": row["salary"], "detailUrl": row["detail_url"], "closedStatus": row["closed_status"], "identityConfidence": row["identity_confidence"], "eventTypes": sorted(set(str(row["event_types"] or "").split(",")) - {""}), "firstSeenAt": row["first_seen_at"], "lastSeenAt": row["last_seen_at"], "isNew": is_new, "relevance": match["relevance"], "confidence": match["confidence"], "reason": match["reason"], "projectJobId": _existing_project_id(row, project_dir), "imported": bool(link and link["imported_at"]), "candidate": bool(link and link["pipeline_source_key"]), "initiator": "unknown"})
            conn.execute("INSERT INTO project_job_links(account_job_id, project, relevance, confidence, reason, project_job_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_job_id, project) DO UPDATE SET relevance=excluded.relevance, confidence=excluded.confidence, reason=excluded.reason, project_job_id=COALESCE(project_job_links.project_job_id, excluded.project_job_id)", (int(row["id"]), project, match["relevance"], match["confidence"], match["reason"], items[-1]["projectJobId"]))
        conn.commit()
        total = len(items)
        start = max(0, (max(1, page) - 1) * max(1, page_size))
        sync = conn.execute("SELECT status, error, finished_at AS finishedAt, id AS runId FROM account_sync_runs WHERE account_id=? ORDER BY id DESC LIMIT 1", (account_id,)).fetchone()
        return {"ok": True, "items": items[start:start + page_size], "total": total, "page": max(1, page), "pageSize": max(1, page_size), "pages": (total + page_size - 1) // page_size, "sync": dict(sync) if sync else None}
    finally:
        conn.close()


def list_account_activity(project: str, tab: str = "all", page: int = 1, page_size: int = 30, search: str = "", new_only: bool = False, account_key: str = "", db_path: str | Path | None = None, profile_project: str = "", match_status: str = "all", import_status: str = "all", job_status: str = "all", actionable_only: bool = False) -> dict[str, Any]:
    """List one page of account facts with a project-specific live overlay.

    Account jobs/events are global to the selected BOSS profile. Matching and
    import state are always scoped to ``project`` and matching is recalculated
    from the current config instead of trusting an old project link.
    """
    if tab not in ("all", *EVENT_TYPES):
        raise HTTPException(status_code=400, detail="Unsupported account activity tab")
    project_dir = resolve_project(project)
    profile_dir = resolve_project(profile_project or project)
    conn = _connect(db_path)
    try:
        account = conn.execute(
            "SELECT id, account_key, display_name, last_sync_at FROM platform_accounts WHERE account_key=?",
            (_account_key(account_key, paths_for_project(profile_dir)["profilePath"]),),
        ).fetchone()
        safe_page = max(1, int(page))
        safe_size = max(1, int(page_size))
        if not account:
            return {"ok": True, "items": [], "total": 0, "page": safe_page, "pageSize": safe_size, "pages": 0, "tabs": {"all": 0, **{event: 0 for event in EVENT_TYPES}}, "account": None, "sync": None, "summary": {"new": 0, "matched": 0, "closed": 0}}
        account_id = int(account["id"])
        baseline = conn.execute("SELECT id FROM account_sync_runs WHERE account_id=? AND is_complete=1 ORDER BY id LIMIT 1", (account_id,)).fetchone()
        where = ["j.account_id=?"]
        params: list[Any] = [account_id]
        if tab != "all":
            where.append("EXISTS (SELECT 1 FROM account_job_events fe WHERE fe.account_job_id=j.id AND fe.event_type=?)")
            params.append(tab)
        if search.strip():
            needle = f"%{search.strip()}%"
            where.append("(j.title LIKE ? OR j.company LIKE ? OR j.city LIKE ?)")
            params.extend([needle, needle, needle])
        if import_status == "imported":
            where.append("EXISTS (SELECT 1 FROM project_job_links il WHERE il.account_job_id=j.id AND il.project=? AND il.imported_at IS NOT NULL)")
            params.append(project)
        elif import_status == "pending":
            where.append("NOT EXISTS (SELECT 1 FROM project_job_links il WHERE il.account_job_id=j.id AND il.project=? AND il.imported_at IS NOT NULL)")
            params.append(project)
        if job_status in ("open", "closed"):
            where.append("j.closed_status=?")
            params.append(job_status)
        if new_only:
            if baseline:
                where.append("(j.first_sync_run_id<>? OR EXISTS (SELECT 1 FROM account_job_events ne WHERE ne.account_job_id=j.id AND ne.first_sync_run_id<>?))")
                params.extend([int(baseline["id"]), int(baseline["id"])])
            else:
                where.append("0")
        where_sql = " AND ".join(where)
        total = int(conn.execute(f"SELECT COUNT(*) FROM account_jobs j WHERE {where_sql}", params).fetchone()[0])
        needs_match_filter = match_status != "all" or actionable_only or new_only
        pagination = "" if needs_match_filter else " LIMIT ? OFFSET ?"
        rows = conn.execute(
            f"SELECT j.*, GROUP_CONCAT(e.event_type) AS event_types, GROUP_CONCAT(e.first_sync_run_id) AS event_runs "
            f"FROM account_jobs j LEFT JOIN account_job_events e ON e.account_job_id=j.id "
            f"WHERE {where_sql} GROUP BY j.id ORDER BY j.last_seen_at DESC{pagination}",
            [*params, *([] if needs_match_filter else [safe_size, (safe_page - 1) * safe_size])],
        ).fetchall()

        row_ids = [int(row["id"]) for row in rows]
        link_map: dict[int, sqlite3.Row] = {}
        if row_ids:
            marks = ",".join("?" for _ in row_ids)
            link_map = {int(link["account_job_id"]): link for link in conn.execute(f"SELECT * FROM project_job_links WHERE project=? AND account_job_id IN ({marks})", [project, *row_ids]).fetchall()}
        run_ids = {int(row["first_sync_run_id"]) for row in rows}
        for row in rows:
            run_ids.update(int(value) for value in str(row["event_runs"] or "").split(",") if value)
        run_map: dict[int, sqlite3.Row] = {}
        if run_ids:
            marks = ",".join("?" for _ in run_ids)
            run_map = {int(run["id"]): run for run in conn.execute(f"SELECT id, is_complete FROM account_sync_runs WHERE id IN ({marks})", list(run_ids)).fetchall()}
        existing_index = load_existing_job_index(project_dir / "jobs_data.db")
        items: list[dict[str, Any]] = []
        for row in rows:
            first_run = run_map.get(int(row["first_sync_run_id"]))
            event_runs = [int(value) for value in str(row["event_runs"] or "").split(",") if value]
            event_complete = bool(event_runs) and all(bool(run_map.get(value) and run_map[value]["is_complete"]) for value in event_runs)
            is_new = bool(baseline and first_run and first_run["is_complete"] and event_complete and (int(row["first_sync_run_id"]) != int(baseline["id"]) or any(value != int(baseline["id"]) for value in event_runs)))
            if (new_only or actionable_only) and not is_new:
                continue
            match = _match_job(row, project_dir)
            if match_status != "all" and match["relevance"] != match_status:
                continue
            if actionable_only and match["relevance"] not in ("matched", "uncertain"):
                continue
            link = link_map.get(int(row["id"]))
            project_job_id = int(link["project_job_id"]) if link and link["project_job_id"] else _existing_project_id_from_index(row, existing_index)
            item = {"id": int(row["id"]), "platformKey": row["platform_key"], "encryptJobId": row["encrypt_job_id"], "title": row["title"], "company": row["company"], "city": row["city"], "salary": row["salary"], "detailUrl": row["detail_url"], "closedStatus": row["closed_status"], "identityConfidence": row["identity_confidence"], "eventTypes": sorted(set(str(row["event_types"] or "").split(",")) - {""}), "firstSeenAt": row["first_seen_at"], "lastSeenAt": row["last_seen_at"], "isNew": is_new, "relevance": match["relevance"], "confidence": match["confidence"], "reason": match["reason"], "projectJobId": project_job_id, "imported": bool(link and link["imported_at"]), "candidate": bool(link and link["pipeline_source_key"]), "initiator": "unknown"}
            items.append(item)
            conn.execute("INSERT INTO project_job_links(account_job_id, project, relevance, confidence, reason, project_job_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_job_id, project) DO UPDATE SET relevance=excluded.relevance, confidence=excluded.confidence, reason=excluded.reason, project_job_id=COALESCE(project_job_links.project_job_id, excluded.project_job_id)", (int(row["id"]), project, match["relevance"], match["confidence"], match["reason"], project_job_id))
        conn.commit()
        filtered_total = total
        if needs_match_filter:
            filtered_total = len(items)
            start = (safe_page - 1) * safe_size
            items = items[start:start + safe_size]
        tabs_count = {"all": int(conn.execute("SELECT COUNT(*) FROM account_jobs WHERE account_id=?", (account_id,)).fetchone()[0])}
        for event in EVENT_TYPES:
            tabs_count[event] = int(conn.execute("SELECT COUNT(DISTINCT account_job_id) FROM account_job_events e JOIN account_jobs j ON j.id=e.account_job_id WHERE j.account_id=? AND e.event_type=?", (account_id, event)).fetchone()[0])
        sync = conn.execute("SELECT status, error, finished_at AS finishedAt, id AS runId FROM account_sync_runs WHERE account_id=? ORDER BY id DESC LIMIT 1", (account_id,)).fetchone()
        new_count = int(conn.execute("SELECT COUNT(*) FROM account_jobs WHERE account_id=? AND first_sync_run_id<>?", (account_id, int(baseline["id"]) if baseline else -1)).fetchone()[0]) if baseline else 0
        return {"ok": True, "items": items, "total": filtered_total, "page": safe_page, "pageSize": safe_size, "pages": (filtered_total + safe_size - 1) // safe_size, "tabs": tabs_count, "account": {"accountKey": account["account_key"], "displayName": account["display_name"], "lastSyncAt": account["last_sync_at"]}, "sync": dict(sync) if sync else None, "summary": {"new": new_count, "actionablePending": filtered_total if actionable_only else None, "matched": sum(item["relevance"] == "matched" for item in items), "closed": int(conn.execute("SELECT COUNT(*) FROM account_jobs WHERE account_id=? AND closed_status='closed'", (account_id,)).fetchone()[0])}}
    finally:
        conn.close()


def import_account_activity(project: str, account_job_ids: list[int], mode: str = "library", allow_uncertain: bool = False, account_key: str = "", db_path: str | Path | None = None, detail_provider: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None, profile_project: str = "", task_manager: Any | None = None) -> dict[str, Any]:
    if mode not in ("library", "candidate"):
        raise HTTPException(status_code=400, detail="Unsupported import mode")
    if task_manager is not None and task_manager.snapshot().get("running"):
        raise HTTPException(status_code=409, detail="当前采集、登录或同步任务正在使用 BOSS 浏览器，请稍后再导入。")
    project_dir = resolve_project(project)
    browser_page = None
    owns_browser = False
    profile_path = ""
    if detail_provider is None:
        profile_dir = resolve_project(profile_project or project)
        profile_path = paths_for_project(profile_dir)["profilePath"]

        def fetch_detail(row: dict[str, Any]) -> dict[str, Any] | None:
            nonlocal browser_page, owns_browser
            if browser_page is None:
                require_saved_login(profile_project or project)
                try:
                    browser_page, owns_browser = _connect_logged_browser(profile_path)
                    _verify_logged_session(browser_page)
                except AccountActivityBrowserBlocked as exc:
                    raise HTTPException(status_code=409, detail=str(exc)) from exc
            return _fetch_job_detail_with_browser(profile_path, row, page_browser=browser_page)

        detail_provider = fetch_detail
    conn = _connect(db_path)
    imported: list[int] = []
    failed: list[dict[str, Any]] = []
    try:
        for raw_id in sorted({int(value) for value in account_job_ids}):
            row = conn.execute("SELECT * FROM account_jobs WHERE id=?", (raw_id,)).fetchone()
            if not row:
                failed.append({"id": raw_id, "reason": "账号活动岗位不存在"})
                continue
            match = _match_job(row, project_dir)
            if match["relevance"] == "mismatched":
                failed.append({"id": raw_id, "reason": "当前目标不匹配，禁止导入"})
                continue
            if match["relevance"] == "uncertain" and not allow_uncertain:
                failed.append({"id": raw_id, "reason": "信息不足，请确认后再导入"})
                continue
            project_job_id = _existing_project_id(row, project_dir)
            if not project_job_id:
                if row["closed_status"] == "closed":
                    failed.append({"id": raw_id, "reason": "岗位已关闭，未写入岗位库"})
                    continue
                if detail_provider is None:
                    failed.append({"id": raw_id, "reason": "详情抓取适配器尚未启用，未写入岗位库"})
                    continue
                try:
                    detail = detail_provider(dict(row))
                except HTTPException:
                    raise
                except Exception as exc:
                    failed.append({"id": raw_id, "reason": f"岗位详情读取失败，未写入岗位库：{exc}"})
                    continue
                if not detail or str(detail.get("closedStatus") or detail.get("closed_status") or "unknown") == "closed":
                    failed.append({"id": raw_id, "reason": "详情失效或岗位已关闭，未写入岗位库"})
                    continue
                config = load_config(str(project_dir))
                cleaned = process_one(
                    detail,
                    config.get("cat_rules") or {},
                    config.get("min_salary"),
                    config.get("relevance_keywords") or [],
                    config.get("blacklist_keywords") or [],
                    config.get("keywords") or [],
                )
                if not cleaned:
                    failed.append({"id": raw_id, "reason": "岗位详情未通过确定性规则，未写入岗位库"})
                    continue
                upsert_jobs([cleaned], project_dir / "jobs_data.db")
                project_job_id = _existing_project_id_by_cleaned(cleaned, project_dir)
            conn.execute(
                "INSERT INTO project_job_links(account_job_id, project, relevance, confidence, reason, project_job_id, imported_at, pipeline_source_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_job_id, project) DO UPDATE SET relevance=excluded.relevance, confidence=excluded.confidence, reason=excluded.reason, project_job_id=excluded.project_job_id, imported_at=excluded.imported_at, pipeline_source_key=excluded.pipeline_source_key",
                (raw_id, project, match["relevance"], match["confidence"], match["reason"], project_job_id, _now(), f"{project}:{project_job_id}" if mode == "candidate" else ""),
            )
            imported.append(int(project_job_id))
        conn.commit()
        return {"ok": not failed, "mode": mode, "projectJobIds": imported, "imported": len(imported), "failed": failed}
    finally:
        if owns_browser and browser_page is not None:
            try:
                browser_page.quit()
            except Exception:
                pass
        conn.close()


def _existing_project_id_by_cleaned(cleaned: dict[str, Any], project_dir: Path) -> int | None:
    index = load_existing_job_index(project_dir / "jobs_data.db")
    if cleaned.get("_key") in index["by_job_key"]:
        return int(index["by_job_key"][cleaned["_key"]])
    return None
