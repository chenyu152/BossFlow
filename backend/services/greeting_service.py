import datetime as dt
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException

from backend.services.pipeline_service import find_pipeline_item
from backend.storage.file_lock import exclusive_file_lock
from backend.services.workspace_service import workspace_path

GREETINGS_DIR = workspace_path("data/greetings")
GREETING_DRAFTS_PATH = workspace_path("data/greetings/greeting-drafts.json")
GREETING_LOCK_PATH = workspace_path("data/greetings/.greeting-drafts.lock")
GREETING_EVENTS_PATH = workspace_path("data/greetings/greeting-events.jsonl")
GREETING_STATUSES = {
    "draft",
    "edited",
    "copied",
    "sent",
    "preparing",
    "prepared",
    "prepare_failed",
    "manually_marked_sent",
    "dismissed",
}
GREETING_MIN_LENGTH = 10
GREETING_MAX_LENGTH = 800
_BLOCKED_MESSAGE_MARKERS = (
    "traceback",
    "error:",
    "as an ai",
    "作为一个ai",
    "作为 ai",
    "无法完成这个请求",
    "```",
)


def _now() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _empty_store() -> dict[str, Any]:
    return {"version": 1, "drafts": []}


def _ensure_store() -> None:
    GREETINGS_DIR.mkdir(parents=True, exist_ok=True)
    if not GREETING_DRAFTS_PATH.exists():
        GREETING_DRAFTS_PATH.write_text(json.dumps(_empty_store(), ensure_ascii=False, indent=2), encoding="utf-8")


def _read_store() -> dict[str, Any]:
    _ensure_store()
    try:
        data = json.loads(GREETING_DRAFTS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = _empty_store()
    if not isinstance(data, dict):
        data = _empty_store()
    drafts = data.get("drafts")
    if not isinstance(drafts, list):
        data["drafts"] = []
    return data


def _write_store(data: dict[str, Any]) -> None:
    _ensure_store()
    GREETING_DRAFTS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _append_event(event: dict[str, Any]) -> None:
    GREETINGS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"at": _now(), **event}
    with GREETING_EVENTS_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")


def _find_draft(data: dict[str, Any], source_key: str) -> dict[str, Any] | None:
    for draft in data.get("drafts", []):
        if isinstance(draft, dict) and draft.get("sourceKey") == source_key:
            return draft
    return None


def _safe_report_text(path_value: str) -> str:
    if not path_value:
        return ""
    try:
        path = Path(path_value).resolve()
    except OSError:
        return ""
    reports_root = workspace_path("reports/jobs").resolve()
    if reports_root != path and reports_root not in path.parents:
        return ""
    if path.suffix.lower() != ".md" or not path.exists() or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


_GREETING_OPTION_HEADING = re.compile(
    r"(?im)^###\s+话术\s+(?P<number>[12])（[^\r\n）]+）\s*$"
)


def _clean_greeting_option(text: str) -> str:
    text = re.sub(r"```(?:text|markdown)?", "", text, flags=re.IGNORECASE).replace("```", "")
    lines: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^>\s*", "", line)
        line = re.sub(r"^[-*]\s+", "", line)
        line = re.sub(r"^\d+[\.、)]\s*", "", line)
        line = line.strip().strip("*")
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _greeting_section(report_text: str) -> str:
    if not report_text.strip():
        return ""
    patterns = [
        r"^##\s*F[^\n]*(?:Boss|打招呼|沟通)[^\n]*\n(?P<body>.*?)(?=^##\s*[A-Z]|^---BOSSSPIDER_LLM_SUMMARY---|\Z)",
        r"^##\s*[^\n]*(?:Boss|打招呼|沟通)[^\n]*\n(?P<body>.*?)(?=^##\s+|^---BOSSSPIDER_LLM_SUMMARY---|\Z)",
    ]
    for pattern in patterns:
        match = re.search(pattern, report_text, flags=re.MULTILINE | re.DOTALL | re.IGNORECASE)
        if match:
            return match.group("body").strip()
    return ""


def extract_greeting_options(report_text: str) -> list[str]:
    body = _greeting_section(report_text)
    if not body:
        return []

    matches = list(_GREETING_OPTION_HEADING.finditer(body))
    if len(matches) != 2 or [match.group("number") for match in matches] != ["1", "2"]:
        return []

    candidates: list[str] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        candidates.append(_clean_greeting_option(body[match.end():end]))

    if any(not candidate.strip() for candidate in candidates):
        return []
    return [candidate.strip() for candidate in candidates]


def extract_greeting_text(report_text: str) -> str:
    options = extract_greeting_options(report_text)
    return options[0] if options else ""


def _draft_from_item(item: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    report_text = _safe_report_text(str(item.get("reportPath") or ""))
    draft_options = extract_greeting_options(report_text)
    draft_text = draft_options[0] if draft_options else ""
    return {
        "sourceKey": item.get("sourceKey", ""),
        "project": item.get("project", ""),
        "jobId": item.get("jobId"),
        "company": item.get("company", ""),
        "title": item.get("title", ""),
        "channel": "boss",
        "draftText": draft_text,
        "draftOptions": draft_options,
        "selectedOptionIndex": 0,
        "editedText": "",
        "status": "draft",
        "sourceReportPath": item.get("reportPath", ""),
        "sourceReportId": item.get("reportId", ""),
        "createdAt": now,
        "updatedAt": now,
        "usedAt": "",
    }


def sync_greeting_draft_from_report(source_key: str) -> dict[str, Any] | None:
    item = find_pipeline_item(source_key)
    if not item:
        return None
    with exclusive_file_lock(Path(GREETING_LOCK_PATH)):
        data = _read_store()
        existing = _find_draft(data, source_key)
        next_draft = _draft_from_item(item)
        if existing:
            report_changed = existing.get("sourceReportId") != next_draft.get("sourceReportId")
            needs_latest_format = not existing.get("draftOptions")
            if report_changed or needs_latest_format:
                existing.update({
                    "draftText": next_draft["draftText"],
                    "draftOptions": next_draft["draftOptions"],
                    "selectedOptionIndex": next_draft["selectedOptionIndex"],
                    "editedText": "",
                    "status": "draft",
                    "sourceReportPath": next_draft["sourceReportPath"],
                    "sourceReportId": next_draft["sourceReportId"],
                    "updatedAt": next_draft["updatedAt"],
                    "usedAt": "",
                    "lastError": "",
                })
                _write_store(data)
                return existing
            if existing.get("editedText") or existing.get("status") in {
                "edited", "copied", "sent", "preparing", "prepared",
                "prepare_failed", "manually_marked_sent", "dismissed",
            }:
                return existing
            existing.update({
                "draftText": next_draft["draftText"],
                "draftOptions": next_draft["draftOptions"],
                "selectedOptionIndex": next_draft["selectedOptionIndex"],
                "sourceReportPath": next_draft["sourceReportPath"],
                "sourceReportId": next_draft["sourceReportId"],
                "updatedAt": next_draft["updatedAt"],
            })
            result = existing
        else:
            data["drafts"].append(next_draft)
            result = next_draft
        _write_store(data)
        return result


def read_greeting_draft(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    draft = sync_greeting_draft_from_report(source_key) or _draft_from_item(item)
    return {"ok": True, "path": str(GREETING_DRAFTS_PATH), "draft": draft}


def save_greeting_draft(source_key: str, edited_text: str, status: str) -> dict[str, Any]:
    if status not in GREETING_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unsupported greeting status: {status}")
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    with exclusive_file_lock(Path(GREETING_LOCK_PATH)):
        data = _read_store()
        draft = _find_draft(data, source_key)
        if not draft:
            draft = _draft_from_item(item)
            data["drafts"].append(draft)
        draft.update({
            "editedText": edited_text,
            "status": status,
            "updatedAt": _now(),
        })
        if status in {"copied", "sent", "manually_marked_sent"}:
            draft["usedAt"] = draft.get("usedAt") or _now()
        if status != "prepare_failed":
            draft["lastError"] = ""
        if status == "prepared":
            draft["preparedAt"] = _now()
        _write_store(data)
    if status == "manually_marked_sent":
        _append_event({
            "sourceKey": source_key,
            "project": item.get("project", ""),
            "jobId": item.get("jobId"),
            "company": item.get("company", ""),
            "title": item.get("title", ""),
            "action": "manually_marked_sent",
            "result": "confirmed_by_user",
        })
    return {"ok": True, "path": str(GREETING_DRAFTS_PATH), "draft": draft}


def validate_greeting_message(message: str) -> list[str]:
    text = str(message or "").strip()
    errors: list[str] = []
    if len(text) < GREETING_MIN_LENGTH:
        errors.append(f"沟通内容至少需要 {GREETING_MIN_LENGTH} 个字符")
    if len(text) > GREETING_MAX_LENGTH:
        errors.append(f"沟通内容不能超过 {GREETING_MAX_LENGTH} 个字符")
    lowered = text.lower()
    if any(marker in lowered for marker in _BLOCKED_MESSAGE_MARKERS):
        errors.append("沟通内容疑似包含模型报错、拒答或代码围栏，请修改后重试")
    return errors


def _validated_job_url(value: str) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not (host == "zhipin.com" or host.endswith(".zhipin.com")):
        raise HTTPException(status_code=400, detail="候选岗位缺少有效的 BOSS 直聘链接")
    if "/job_detail/" not in parsed.path:
        raise HTTPException(status_code=400, detail="候选岗位链接不是可核验的岗位详情页")
    return url


def preflight_greeting(source_key: str, message: str, task_snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    text = str(message or "").strip()
    errors = validate_greeting_message(text)
    try:
        url = _validated_job_url(str(item.get("url") or ""))
    except HTTPException as exc:
        errors.append(str(exc.detail))
        url = str(item.get("url") or "")
    snapshot = task_snapshot or {}
    if snapshot.get("running"):
        errors.append("当前有其他浏览器任务正在运行，请等待任务结束后再试")
    return {
        "ok": not errors,
        "canProceed": not errors,
        "errors": errors,
        "preview": {
            "sourceKey": source_key,
            "project": item.get("project", ""),
            "jobId": item.get("jobId"),
            "company": item.get("company", ""),
            "title": item.get("title", ""),
            "url": url,
            "message": text,
            "messageLength": len(text),
            "finalSendByUser": True,
        },
    }


def update_greeting_prepare_result(
    source_key: str,
    message: str,
    status: str,
    *,
    error: str = "",
) -> dict[str, Any]:
    result = save_greeting_draft(source_key, message, status)
    if error:
        with exclusive_file_lock(Path(GREETING_LOCK_PATH)):
            data = _read_store()
            draft = _find_draft(data, source_key)
            if draft:
                draft["lastError"] = error[:1000]
                draft["updatedAt"] = _now()
                _write_store(data)
                result["draft"] = draft
    item = find_pipeline_item(source_key) or {}
    _append_event({
        "sourceKey": source_key,
        "project": item.get("project", ""),
        "jobId": item.get("jobId"),
        "company": item.get("company", ""),
        "title": item.get("title", ""),
        "action": "prepare_greeting",
        "result": status,
        "error": error[:1000],
    })
    return result
