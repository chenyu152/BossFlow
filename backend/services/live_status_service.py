from __future__ import annotations

import datetime as dt
import sqlite3
import tempfile
import threading
import time
from argparse import Namespace
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.schemas.jobs import JobLiveStatusUpdateRequest
from backend.services.task_service import TaskManager
from scripts.update_job_live_status import (
    BrowserChecker,
    BrowserFactory,
    CheckResult,
    JobRow,
    check_url_with_factory,
    ensure_live_columns,
    needs_manual_verification,
    update_job,
)


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _load_target_jobs(conn: sqlite3.Connection, payload: JobLiveStatusUpdateRequest) -> list[JobRow]:
    where = ["url LIKE '%zhipin.com/job_detail/%'"]
    params: list[Any] = []
    if payload.jobIds:
        placeholders = ",".join("?" for _ in payload.jobIds)
        where.append(f"id IN ({placeholders})")
        params.extend([int(job_id) for job_id in payload.jobIds])
    if payload.skipClosed:
        where.append("(live_status IS NULL OR live_status != 'closed')")

    sql = f"""
        SELECT id, title, company, url
        FROM jobs
        WHERE {' AND '.join(where)}
        ORDER BY last_seen DESC, avg DESC, id DESC
    """
    if payload.limit:
        sql += " LIMIT ?"
        params.append(int(payload.limit))

    return [
        JobRow(int(row["id"]), row["title"] or "", row["company"] or "", row["url"] or "")
        for row in conn.execute(sql, params).fetchall()
    ]


def _script_args(payload: JobLiveStatusUpdateRequest, profile_dir: str | None = None) -> Namespace:
    return Namespace(
        method="browser",
        timeout=25,
        browser_visible=not payload.headless,
        browser_minimized=payload.headless,
        browser_profile_dir=profile_dir if payload.interactiveOnCaptcha else None,
        browser_address=None,
        no_browser_warmup=True,
        close_tabs=True,
        browser_wait=payload.browserWaitSeconds,
        retries=1,
        stop_on_captcha=True,
    )


def _print_result(row: JobRow, result: CheckResult, task_manager: TaskManager) -> None:
    title = f"{row.company} · {row.title}".strip(" ·")
    task_manager.append_log(f"#{row.id} {result.status} / {result.raw} / {title}")
    if result.error:
        task_manager.append_log(f"  {result.error}")


def _interactive_verify(
    row: JobRow,
    payload: JobLiveStatusUpdateRequest,
    profile_dir: str,
    stop_event: threading.Event,
    task_manager: TaskManager,
) -> CheckResult | None:
    task_manager.append_log("检测到 BOSS 安全验证/登录跳转，已打开可见浏览器窗口。请手动完成验证，任务会自动重试当前岗位核验。")
    browser: BrowserChecker | None = None
    deadline = time.time() + payload.verificationTimeoutSeconds
    try:
        browser = BrowserChecker(
            visible=True,
            timeout=25,
            profile_dir=profile_dir,
            warmup=False,
            browser_address=None,
            close_tabs=False,
        )
        while not stop_event.is_set() and time.time() < deadline:
            result = browser.check(row.url, payload.browserWaitSeconds, retries=0)
            if result.raw == "browser_error":
                task_manager.append_log("验证浏览器连接断开，正在使用同一浏览器资料重试当前岗位")
                try:
                    browser.close()
                except Exception:
                    pass
                browser = BrowserChecker(
                    visible=True,
                    timeout=25,
                    profile_dir=profile_dir,
                    warmup=False,
                    browser_address=None,
                    close_tabs=False,
                )
                time.sleep(2)
                continue
            if not needs_manual_verification(result):
                task_manager.append_log("安全验证已通过，继续核验岗位")
                return result
            remaining = int(deadline - time.time())
            task_manager.append_log(f"等待手动验证中，当前状态 {result.raw}，剩余约 {max(0, remaining)} 秒")
            time.sleep(5)
        task_manager.append_log("安全验证未完成，已停止本批次")
        return None
    finally:
        if browser:
            browser.close()


def start_live_status_update_task(
    project_dir: Path,
    payload: JobLiveStatusUpdateRequest,
    task_manager: TaskManager,
) -> dict[str, Any]:
    db_path = project_dir / "jobs_data.db"
    if not db_path.exists() or db_path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="jobs_data.db not found")

    stop_event = threading.Event()

    def stop() -> None:
        stop_event.set()

    def worker() -> None:
        profile_dir = str(Path(tempfile.gettempdir()) / "bossflow-live-status-web")
        conn = _connect(db_path)
        browser_factory: BrowserFactory | None = None
        checked_at = _now()
        stats = {"open": 0, "closed": 0, "unknown": 0, "captcha": 0}
        try:
            ensure_live_columns(conn)
            rows = _load_target_jobs(conn, payload)
            effective_workers = 1 if payload.interactiveOnCaptcha else payload.workers
            task_manager.append_log(
                f"岗位核验开始：目标 {len(rows)} 个，workers={effective_workers}，"
                f"skipClosed={payload.skipClosed}，mode={'普通Chrome最小化' if payload.headless else '普通Chrome可见'}"
            )
            if payload.interactiveOnCaptcha and payload.workers > 1:
                task_manager.append_log("已启用图形验证交互保护，本批次自动使用单 worker，避免继续触发验证")
            if not rows:
                return

            args = _script_args(payload, profile_dir)
            browser_factory = BrowserFactory(args)
            max_workers = max(1, min(effective_workers, len(rows)))
            row_iter = iter(rows)

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_row: dict[Future[CheckResult], JobRow] = {}

                def submit_next() -> bool:
                    if stop_event.is_set():
                        return False
                    try:
                        row = next(row_iter)
                    except StopIteration:
                        return False
                    future_to_row[executor.submit(check_url_with_factory, row.url, args, browser_factory)] = row
                    return True

                for _ in range(max_workers):
                    if not submit_next():
                        break

                while future_to_row and not stop_event.is_set():
                    done, _ = wait(future_to_row, return_when=FIRST_COMPLETED)
                    for future in done:
                        row = future_to_row.pop(future)
                        try:
                            result = future.result()
                        except Exception as exc:
                            result = CheckResult("unknown", "worker_error", str(exc), row.url, "browser")

                        if needs_manual_verification(result):
                            stats["captcha"] += 1
                            _print_result(row, result, task_manager)
                            if payload.interactiveOnCaptcha:
                                if browser_factory:
                                    browser_factory.close()
                                result = _interactive_verify(row, payload, profile_dir, stop_event, task_manager)
                                browser_factory = BrowserFactory(args)
                                if result is None or needs_manual_verification(result):
                                    stop_event.set()
                                    break
                            else:
                                stop_event.set()
                                break

                        stats[result.status] = stats.get(result.status, 0) + 1
                        _print_result(row, result, task_manager)
                        update_job(conn, row, result, checked_at)
                        conn.commit()
                        if payload.sleepSeconds > 0:
                            time.sleep(payload.sleepSeconds)
                        submit_next()

            task_manager.append_log(
                "岗位核验结束："
                f"open={stats.get('open', 0)} closed={stats.get('closed', 0)} "
                f"unknown={stats.get('unknown', 0)} captcha={stats.get('captcha', 0)}"
            )
        finally:
            if browser_factory:
                browser_factory.close()
            conn.close()

    task_manager.start("live-status", worker, stop_handler=stop)
    return {"ok": True, "status": "live-status"}
