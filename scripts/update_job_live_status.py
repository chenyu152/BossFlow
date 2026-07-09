"""Check and update BOSS job live status without using crawler login cookies.

Examples:
  python scripts/update_job_live_status.py --url https://www.zhipin.com/job_detail/xxx.html --dry-run
  python scripts/update_job_live_status.py --url https://www.zhipin.com/job_detail/xxx.html --method browser --browser-visible --browser-profile-dir %TEMP%/bossflow-boss-public-browser --dry-run
  python scripts/update_job_live_status.py --url https://www.zhipin.com/job_detail/xxx.html --method browser --browser-address 127.0.0.1:9333 --dry-run
  python scripts/update_job_live_status.py --project agent --limit 50 --workers 4 --dry-run
  python scripts/update_job_live_status.py --project agent --limit 50 --method auto
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import html
import random
import re
import sqlite3
import tempfile
import threading
import time
from dataclasses import dataclass
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import requests


BASE_DIR = Path(__file__).resolve().parents[1]
PROJECTS_DIR = BASE_DIR / "projects"
LIVE_COLUMNS = {
    "live_status": "TEXT",
    "live_status_raw": "TEXT",
    "live_checked_at": "TEXT",
    "live_closed_at": "TEXT",
    "live_check_error": "TEXT",
}
OPEN_MARKERS = ("招聘中", "最新")
CLOSED_MARKER = "职位已关闭"
CAPTCHA_MARKERS = (
    "安全验证",
    "点击按钮进行验证",
    "请选择下图中所有的",
    "当前 IP 地址可能存在异常访问行为",
)
MANUAL_VERIFICATION_RAWS = {"captcha_required", "security_check", "login_required"}


@dataclass
class JobRow:
    id: int | None
    title: str
    company: str
    url: str


@dataclass
class CheckResult:
    status: str
    raw: str
    error: str
    final_url: str
    method: str
    http_status: int | None = None


class BrowserChecker:
    def __init__(
        self,
        visible: bool = False,
        timeout: int = 25,
        profile_dir: str | None = None,
        warmup: bool = True,
        browser_address: str | None = None,
        close_tabs: bool = True,
        minimized: bool = False,
    ):
        from DrissionPage import ChromiumOptions, ChromiumPage
        from DrissionPage.common import Settings

        Settings.set_singleton_tab_obj(False)
        self.owns_browser = not browser_address
        self.close_tabs = close_tabs
        if browser_address:
            self.profile_dir = None
            co = ChromiumOptions()
            co.set_address(_normalize_browser_address(browser_address))
            self.page = ChromiumPage(addr_or_opts=co)
        else:
            self.profile_dir = Path(profile_dir).resolve() if profile_dir else Path(tempfile.mkdtemp(prefix="bossflow-live-check-"))
            self.profile_dir.mkdir(parents=True, exist_ok=True)
            co = ChromiumOptions()
            co.set_user_data_path(str(self.profile_dir))
            co.set_paths(local_port=random.randint(41000, 59000))
            co.set_argument("--disable-blink-features=AutomationControlled")
            co.set_argument("--lang=zh-CN")
            co.set_argument("--window-size=1365,900")
            co.set_user_agent(_user_agent())
            if not visible and not minimized:
                co.set_argument("--headless=new")
            if minimized:
                co.set_argument("--start-minimized")
            self.page = ChromiumPage(addr_or_opts=co)
        try:
            self.page.set.timeouts(base=timeout, page_load=timeout, script=timeout)
        except Exception:
            pass
        if warmup:
            self.warmup()

    def warmup(self) -> None:
        try:
            self.page.get("https://www.zhipin.com/")
            time.sleep(2)
        except Exception:
            pass

    def check(self, url: str, wait_seconds: float, retries: int = 0) -> CheckResult:
        last_result = CheckResult("unknown", "browser_error", "browser check did not run", url, "browser")
        for attempt in range(max(0, retries) + 1):
            page = self.page
            opened_tab = None
            try:
                if not self.owns_browser:
                    opened_tab = self.page.new_tab(url=url, background=True)
                    page = opened_tab
                else:
                    page.get(url)
                time.sleep(wait_seconds)
                text = page.run_js(
                    "return document.body ? document.body.innerText : document.documentElement.innerText"
                ) or ""
                page_html = page.html or ""
                final_url = str(page.url or url)
                return classify_page(text, page_html, final_url, None, "browser")
            except Exception as exc:
                last_result = CheckResult("unknown", "browser_error", str(exc), url, "browser")
                if attempt < retries:
                    time.sleep(1 + attempt)
            finally:
                if opened_tab and self.close_tabs:
                    try:
                        self.page.close_tabs(opened_tab)
                    except Exception:
                        pass
        return last_result

    def close(self) -> None:
        if not self.owns_browser:
            return
        try:
            self.page.quit()
        except Exception:
            pass


def _user_agent() -> str:
    minor = random.randint(0, 99)
    return (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/130.0.0.{minor} Safari/537.36"
    )


def _normalize_browser_address(value: str) -> str:
    address = value.strip()
    if address.startswith("http://"):
        address = address.removeprefix("http://")
    if address.startswith("https://"):
        address = address.removeprefix("https://")
    return address.rstrip("/")


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _strip_html(value: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return html.unescape(re.sub(r"\s+", " ", text)).strip()


def classify_page(text: str, page_html: str, final_url: str, http_status: int | None, method: str) -> CheckResult:
    haystack = "\n".join([text or "", _strip_html(page_html or ""), final_url or ""])
    if CLOSED_MARKER in haystack:
        return CheckResult("closed", CLOSED_MARKER, "", final_url, method, http_status)
    for marker in OPEN_MARKERS:
        if marker in haystack:
            return CheckResult("open", marker, "", final_url, method, http_status)

    parsed = urlparse(final_url or "")
    if any(marker in haystack for marker in CAPTCHA_MARKERS):
        return CheckResult(
            "unknown",
            "captcha_required",
            "BOSS captcha/security verification page",
            final_url,
            method,
            http_status,
        )
    if "web/user" in parsed.path or ("登录/注册" in haystack and "验证码登录" in haystack):
        return CheckResult("unknown", "login_required", "redirected to login page", final_url, method, http_status)
    if "security.html" in parsed.path or "_security_check" in haystack or "请稍候" in haystack:
        return CheckResult("unknown", "security_check", "BOSS security check page", final_url, method, http_status)
    if http_status and http_status >= 400:
        return CheckResult("unknown", f"http_{http_status}", f"HTTP {http_status}", final_url, method, http_status)
    return CheckResult("unknown", "no_marker", "no known live-status marker found", final_url, method, http_status)


def check_with_requests(url: str, timeout: int) -> CheckResult:
    headers = {
        "User-Agent": _user_agent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
    }
    try:
        response = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        return classify_page(response.text, response.text, response.url, response.status_code, "requests")
    except Exception as exc:
        return CheckResult("unknown", "request_error", str(exc), url, "requests")


def should_try_browser(result: CheckResult) -> bool:
    return result.raw in {"security_check", "login_required", "no_marker", "request_error"}


def needs_manual_verification(result: CheckResult) -> bool:
    return result.raw in MANUAL_VERIFICATION_RAWS


def resolve_db_path(project: str | None, db_file: str | None) -> Path:
    if db_file:
        return Path(db_file).resolve()
    if not project:
        project = "agent"
    return (PROJECTS_DIR / project / "jobs_data.db").resolve()


def connect_db(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise FileNotFoundError(f"Database not found: {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def existing_columns(conn: sqlite3.Connection) -> set[str]:
    return {str(row["name"]) for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}


def ensure_live_columns(conn: sqlite3.Connection) -> None:
    columns = existing_columns(conn)
    for name, kind in LIVE_COLUMNS.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {name} {kind}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_live_status ON jobs(live_status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_live_checked_at ON jobs(live_checked_at)")
    conn.commit()


def load_jobs(conn: sqlite3.Connection, args: argparse.Namespace) -> list[JobRow]:
    columns = existing_columns(conn)
    where = ["url LIKE '%zhipin.com/job_detail/%'"]
    params: list[object] = []
    if args.only_unchecked and "live_checked_at" in columns:
        where.append("(live_checked_at IS NULL OR live_checked_at = '')")
    if args.older_than_hours is not None and "live_checked_at" in columns:
        cutoff = (dt.datetime.now() - dt.timedelta(hours=float(args.older_than_hours))).strftime("%Y-%m-%d %H:%M:%S")
        where.append("(live_checked_at IS NULL OR live_checked_at = '' OR live_checked_at < ?)")
        params.append(cutoff)
    if args.status and "live_status" in columns:
        where.append("COALESCE(live_status, '') = ?")
        params.append(args.status)

    sql = f"""
        SELECT id, title, company, url
        FROM jobs
        WHERE {' AND '.join(where)}
        ORDER BY last_seen ASC, id ASC
        LIMIT ?
    """
    params.append(int(args.limit))
    return [
        JobRow(int(row["id"]), row["title"] or "", row["company"] or "", row["url"] or "")
        for row in conn.execute(sql, params).fetchall()
    ]


def update_job(conn: sqlite3.Connection, row: JobRow, result: CheckResult, checked_at: str) -> None:
    current = conn.execute(
        "SELECT live_closed_at FROM jobs WHERE id = ?",
        (row.id,),
    ).fetchone()
    live_closed_at = current["live_closed_at"] if current and "live_closed_at" in current.keys() else ""
    if result.status == "closed" and not live_closed_at:
        live_closed_at = checked_at
    conn.execute(
        """
        UPDATE jobs
        SET live_status = ?,
            live_status_raw = ?,
            live_checked_at = ?,
            live_closed_at = ?,
            live_check_error = ?
        WHERE id = ?
        """,
        (result.status, result.raw, checked_at, live_closed_at or "", result.error, row.id),
    )


def check_url(url: str, args: argparse.Namespace, browser: BrowserChecker | None) -> CheckResult:
    if args.method in {"requests", "auto"}:
        result = check_with_requests(url, args.timeout)
        if args.method == "requests" or not should_try_browser(result):
            return result
    if browser:
        return browser.check(url, args.browser_wait, args.retries)
    return result


class BrowserFactory:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.local = threading.local()
        self.browsers: list[BrowserChecker] = []
        self.lock = threading.Lock()
        self.warned = False

    def get(self) -> BrowserChecker | None:
        browser = getattr(self.local, "browser", None)
        if browser:
            return browser
        try:
            browser = BrowserChecker(
                visible=self.args.browser_visible,
                timeout=self.args.timeout,
                profile_dir=self.args.browser_profile_dir,
                warmup=not self.args.no_browser_warmup,
                browser_address=self.args.browser_address,
                close_tabs=self.args.close_tabs,
                minimized=getattr(self.args, "browser_minimized", False),
            )
        except Exception as exc:
            if self.args.method == "browser":
                raise
            with self.lock:
                if not self.warned:
                    print(f"[WARN] browser fallback unavailable: {exc}")
                    self.warned = True
            return None
        self.local.browser = browser
        with self.lock:
            self.browsers.append(browser)
        return browser

    def close(self) -> None:
        for browser in self.browsers:
            browser.close()


def check_url_with_factory(url: str, args: argparse.Namespace, browser_factory: BrowserFactory | None) -> CheckResult:
    if args.method in {"requests", "auto"}:
        result = check_with_requests(url, args.timeout)
        if args.method == "requests" or not should_try_browser(result):
            return result
    if browser_factory:
        browser = browser_factory.get()
        if browser:
            return browser.check(url, args.browser_wait, args.retries)
    return result


def iter_checked_results(
    rows: list[JobRow],
    args: argparse.Namespace,
    browser_factory: BrowserFactory | None,
) -> Iterator[tuple[JobRow, CheckResult]]:
    if args.workers <= 1 or len(rows) <= 1:
        browser = browser_factory.get() if browser_factory else None
        for index, row in enumerate(rows, start=1):
            result = check_url(row.url, args, browser)
            yield row, result
            if args.stop_on_captcha and needs_manual_verification(result):
                return
            if index < len(rows) and args.sleep > 0:
                time.sleep(args.sleep)
        return

    max_workers = max(1, min(args.workers, len(rows)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        row_iter = iter(rows)
        future_to_row: dict[concurrent.futures.Future[CheckResult], JobRow] = {}

        def submit_next() -> bool:
            try:
                row = next(row_iter)
            except StopIteration:
                return False
            future = executor.submit(check_url_with_factory, row.url, args, browser_factory)
            future_to_row[future] = row
            return True

        for _ in range(max_workers):
            if not submit_next():
                break

        while future_to_row:
            done, _ = concurrent.futures.wait(
                future_to_row,
                return_when=concurrent.futures.FIRST_COMPLETED,
            )
            for future in done:
                row = future_to_row.pop(future)
                try:
                    result = future.result()
                except Exception as exc:
                    result = CheckResult("unknown", "worker_error", str(exc), row.url, args.method)
                yield row, result
                if args.stop_on_captcha and needs_manual_verification(result):
                    for pending in future_to_row:
                        pending.cancel()
                    return
                if args.sleep > 0:
                    time.sleep(args.sleep)
                submit_next()


def print_result(row: JobRow, result: CheckResult, dry_run: bool) -> None:
    ident = f"#{row.id}" if row.id is not None else "url"
    title = f"{row.company} · {row.title}".strip(" ·")
    prefix = "DRY" if dry_run else "UPD"
    print(
        f"[{prefix}] {ident} {result.status:<7} raw={result.raw:<15} method={result.method:<8} "
        f"{title} | {row.url}"
    )
    if result.error:
        print(f"      error: {result.error}")
    if result.final_url and result.final_url != row.url:
        print(f"      final: {result.final_url}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update BOSS job live status without crawler login cookies.")
    parser.add_argument("--project", default="agent", help="Project name under projects/. Default: agent")
    parser.add_argument("--db-file", help="Explicit jobs_data.db path")
    parser.add_argument("--url", action="append", default=[], help="Check a URL directly. Can be repeated.")
    parser.add_argument("--limit", type=int, default=20, help="Max DB rows to check")
    parser.add_argument("--dry-run", action="store_true", help="Do not alter database")
    parser.add_argument("--workers", type=int, default=1, help="Concurrent workers. Start with 3-5 for browser mode")
    parser.add_argument("--method", choices=["requests", "browser", "auto"], default="auto")
    parser.add_argument("--browser-visible", action="store_true", help="Run fallback browser visibly instead of headless")
    parser.add_argument("--browser-minimized", action="store_true", help="Run normal browser minimized instead of headless")
    parser.add_argument(
        "--browser-address",
        help="Attach to an existing Chrome/Edge remote debugging address, e.g. 127.0.0.1:9333",
    )
    parser.add_argument(
        "--browser-profile-dir",
        help=(
            "Use an independent persistent browser profile directory. "
            "Recommended outside the repo for BOSS public pages, e.g. %%TEMP%%/bossflow-boss-public-browser"
        ),
    )
    parser.add_argument("--no-browser-warmup", action="store_true", help="Skip visiting zhipin.com before detail pages")
    parser.add_argument("--keep-tabs", dest="close_tabs", action="store_false", help="Keep browser tabs opened after checks")
    parser.add_argument("--browser-wait", type=float, default=8.0, help="Seconds to wait after browser navigation")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP/browser timeout seconds")
    parser.add_argument("--retries", type=int, default=1, help="Retry browser checks on transient browser errors")
    parser.add_argument("--sleep", type=float, default=1.5, help="Seconds between checks")
    parser.add_argument(
        "--no-stop-on-captcha",
        dest="stop_on_captcha",
        action="store_false",
        help="Continue after captcha pages. Not recommended for BOSS public pages",
    )
    parser.add_argument("--only-unchecked", action="store_true", help="Only rows never checked before")
    parser.add_argument("--older-than-hours", type=float, help="Only rows not checked within N hours")
    parser.add_argument("--status", choices=["open", "closed", "unknown"], help="Only rows with this current live_status")
    parser.set_defaults(close_tabs=True)
    parser.set_defaults(stop_on_captcha=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows: list[JobRow]
    conn: sqlite3.Connection | None = None

    if args.url:
        rows = [JobRow(None, "", "", url.strip()) for url in args.url if url.strip()]
    else:
        db_path = resolve_db_path(args.project, args.db_file)
        conn = connect_db(db_path)
        if not args.dry_run:
            ensure_live_columns(conn)
        rows = load_jobs(conn, args)
        print(f"DB: {db_path}")

    browser_factory: BrowserFactory | None = None
    if args.method in {"browser", "auto"}:
        browser_factory = BrowserFactory(args)

    stats = {"open": 0, "closed": 0, "unknown": 0}
    checked_at = _now()
    try:
        for row, result in iter_checked_results(rows, args, browser_factory):
            stats[result.status] = stats.get(result.status, 0) + 1
            print_result(row, result, args.dry_run or row.id is None)
            if conn and row.id is not None and not args.dry_run:
                update_job(conn, row, result, checked_at)
                conn.commit()
    finally:
        if browser_factory:
            browser_factory.close()
        if conn:
            conn.close()

    print(f"Summary: open={stats.get('open', 0)} closed={stats.get('closed', 0)} unknown={stats.get('unknown', 0)} total={len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
