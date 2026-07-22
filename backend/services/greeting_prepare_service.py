from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable

from fastapi import HTTPException

from backend.schemas.greeting import GreetingPrepareRequest
from backend.services.greeting_service import (
    preflight_greeting,
    save_greeting_draft,
    update_greeting_prepare_result,
)
from backend.services.pipeline_service import find_pipeline_item
from backend.services.project_service import find_free_port, paths_for_project, resolve_project
from backend.services.task_service import TaskManager, capture_task_output
from backend.services.workspace_service import project_workspace
from crawler.boss import BossCrawler


BrowserRunner = Callable[[dict[str, Any], str, dict[str, str], TaskManager], None]

CHAT_ENTRY_XPATH = (
    "xpath://a[contains(normalize-space(.), '立即沟通') or "
    "contains(normalize-space(.), '继续沟通')] | "
    "//button[contains(normalize-space(.), '立即沟通') or "
    "contains(normalize-space(.), '继续沟通')] | "
    "//*[@role='button' and (contains(normalize-space(.), '立即沟通') or "
    "contains(normalize-space(.), '继续沟通'))]"
)


def _normalize_button_text(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or ""))


def _open_chat_window(page: Any) -> str:
    """Open the BOSS chat panel with a real browser click.

    ``立即沟通`` sends BOSS's platform-defined greeting before the panel opens.
    ``继续沟通`` only reopens an existing conversation. Neither branch sends the
    BossFlow custom message.
    """
    entries = list(page.eles(CHAT_ENTRY_XPATH, timeout=8) or [])
    visible_entries = []
    for entry in entries:
        try:
            if entry.states.is_displayed:
                visible_entries.append(entry)
        except Exception:
            visible_entries.append(entry)

    if not visible_entries:
        raise RuntimeError("页面上未找到“立即沟通”或“继续沟通”入口，可能岗位已关闭或页面结构已变化")

    entry = next(
        (
            candidate
            for candidate in visible_entries
            if _normalize_button_text(candidate.text) in {"立即沟通", "继续沟通"}
        ),
        visible_entries[0],
    )
    label = _normalize_button_text(entry.text)
    if "立即沟通" in label:
        mode = "initial"
    elif "继续沟通" in label:
        mode = "existing"
    else:
        raise RuntimeError(f"无法识别沟通入口状态：{entry.text}")

    clicked = entry.click(timeout=5)
    if clicked is False:
        raise RuntimeError(f"未能点击“{entry.text}”入口，请在浏览器中手动重试")
    return mode


def _fill_chat_input(page: Any, message: str, timeout: float = 45) -> bool:
    deadline = time.monotonic() + timeout
    chat_input = None
    while time.monotonic() < deadline:
        chat_input = page.ele("#chat-input", timeout=0.5)
        if chat_input:
            try:
                if chat_input.states.is_displayed:
                    break
            except Exception:
                break
        chat_input = None
        time.sleep(0.5)
    if not chat_input:
        return False

    # DrissionPage uses CDP Input.insertText for a normal string. The message is
    # stripped before this point, so this never emits a trailing Enter key.
    chat_input.input(message, clear=True)
    actual = str(
        page.run_js(
            """
            const node = document.querySelector('#chat-input');
            if (!node) return '';
            return ('value' in node ? node.value : node.innerText || node.textContent || '').trim();
            """
        )
        or ""
    ).strip()
    return actual == message.strip()


def _expected_job_token(url: str) -> str:
    match = re.search(r"/job_detail/([^/?#]+)", url)
    return match.group(1) if match else ""


def _prepare_greeting_in_browser(
    item: dict[str, Any],
    message: str,
    paths: dict[str, str],
    task_manager: TaskManager,
) -> None:
    crawler = BossCrawler(
        profile_dir=paths["profilePath"],
        chrome_port=find_free_port(9222),
        config_file=paths["configPath"],
        partial_file=paths["partialPath"],
    )
    task_manager.current_crawler = crawler
    crawler.start_browser(headless=False)
    page = crawler.page
    job_url = str(item.get("url") or "")
    print(f"[INFO] 正在打开目标岗位：{item.get('company', '')} · {item.get('title', '')}")
    page.get(job_url)
    time.sleep(2)

    current_url = str(getattr(page, "url", "") or "")
    body_text = str(page.run_js("return document.body?.innerText || ''") or "")
    title = str(item.get("title") or "").strip()
    company = str(item.get("company") or "").strip()
    token = _expected_job_token(job_url)
    identity_matches = bool(token and token in current_url) or bool(
        title and title in body_text and (not company or company in body_text)
    )
    if not identity_matches:
        if "登录" in body_text or "/login" in current_url:
            raise RuntimeError("BOSS 登录状态已失效，请先完成登录后重试")
        raise RuntimeError("无法确认当前页面是所选岗位，已停止填入消息")

    chat_mode = _open_chat_window(page)
    if chat_mode == "initial":
        print("[INFO] 已点击“立即沟通”；BOSS 将先发送平台预设问候，正在等待沟通框")
    else:
        print("[INFO] 已点击“继续沟通”；正在打开已有会话")

    if not _fill_chat_input(page, message):
        if chat_mode == "initial":
            raise RuntimeError("已触发 BOSS 预设问候，但未能安全填入 BossFlow 话术；请在浏览器中手动粘贴")
        raise RuntimeError("已有沟通窗口已打开，但未能安全填入 BossFlow 话术；请在浏览器中手动粘贴")

    try:
        from crawler.platform_utils import activate_chrome

        activate_chrome()
    except Exception:
        pass
    print("[OK] BossFlow 话术已填入沟通框但未发送；请在可见浏览器中检查并亲自发送")


def start_greeting_prepare_task(
    payload: GreetingPrepareRequest,
    task_manager: TaskManager,
    *,
    browser_runner: BrowserRunner | None = None,
) -> dict[str, Any]:
    project_name = str(payload.sourceKey or "").partition(":")[0]
    project_dir = resolve_project(project_name)
    with project_workspace(project_name):
        preflight = preflight_greeting(payload.sourceKey, payload.message, task_manager.snapshot())
        if not preflight["canProceed"]:
            raise HTTPException(status_code=400, detail="；".join(preflight["errors"]))
        if not payload.confirmed:
            raise HTTPException(status_code=400, detail="请先在确认窗口核对岗位与沟通内容")
        item = find_pipeline_item(payload.sourceKey)
        if not item:
            raise HTTPException(status_code=404, detail=f"Pipeline item not found: {payload.sourceKey}")

    paths = paths_for_project(project_dir)
    runner = browser_runner or _prepare_greeting_in_browser
    start_gate = threading.Event()
    cancelled_before_start = threading.Event()

    def worker() -> None:
        start_gate.wait()
        if cancelled_before_start.is_set():
            return
        with project_workspace(project_name), capture_task_output(task_manager):
            try:
                runner(item, payload.message.strip(), paths, task_manager)
                update_greeting_prepare_result(payload.sourceKey, payload.message.strip(), "prepared")
            except Exception as exc:
                update_greeting_prepare_result(
                    payload.sourceKey,
                    payload.message.strip(),
                    "prepare_failed",
                    error=str(exc),
                )
                raise

    task_manager.start("greeting-prepare", worker)
    try:
        with project_workspace(project_name):
            draft = save_greeting_draft(payload.sourceKey, payload.message.strip(), "preparing")["draft"]
    except Exception:
        cancelled_before_start.set()
        start_gate.set()
        raise
    start_gate.set()
    return {
        "ok": True,
        "status": "preparing",
        "message": "正在准备沟通；首次联系会触发 BOSS 预设问候，BossFlow 话术只填入、不发送",
        "draft": draft,
        "preview": preflight["preview"],
    }
