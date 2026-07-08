import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services.pipeline_service import find_pipeline_item
from backend.storage.paths import BASE_DIR

GREETINGS_DIR = BASE_DIR / "data" / "greetings"
GREETING_DRAFTS_PATH = GREETINGS_DIR / "greeting-drafts.json"
GREETING_STATUSES = {"draft", "edited", "copied", "sent", "dismissed"}


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
    reports_root = (BASE_DIR / "reports" / "jobs").resolve()
    if reports_root != path and reports_root not in path.parents:
        return ""
    if path.suffix.lower() != ".md" or not path.exists() or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def extract_greeting_text(report_text: str) -> str:
    if not report_text.strip():
        return ""
    patterns = [
        r"^##\s*F[\.、\s]*[^\n]*(?:Boss|打招呼|沟通)[^\n]*\n(?P<body>.*?)(?=^##\s*[A-Z][\.、\s]|^---BOSSSPIDER_LLM_SUMMARY---|\Z)",
        r"^##\s*[^\n]*(?:Boss|打招呼|沟通)[^\n]*\n(?P<body>.*?)(?=^##\s+|^---BOSSSPIDER_LLM_SUMMARY---|\Z)",
    ]
    for pattern in patterns:
        match = re.search(pattern, report_text, flags=re.MULTILINE | re.DOTALL | re.IGNORECASE)
        if match:
            body = match.group("body").strip()
            return _clean_greeting_text(body)
    return ""


def _clean_greeting_text(text: str) -> str:
    text = re.sub(r"```(?:text|markdown)?", "", text, flags=re.IGNORECASE).replace("```", "")
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^[-*]\s+", "", line)
        line = re.sub(r"^\d+[\.、)]\s*", "", line)
        lines.append(line)
    return "\n\n".join(lines).strip()


def _draft_from_item(item: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    report_text = _safe_report_text(str(item.get("reportPath") or ""))
    draft_text = extract_greeting_text(report_text)
    return {
        "sourceKey": item.get("sourceKey", ""),
        "project": item.get("project", ""),
        "jobId": item.get("jobId"),
        "company": item.get("company", ""),
        "title": item.get("title", ""),
        "channel": "boss",
        "draftText": draft_text,
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
    data = _read_store()
    existing = _find_draft(data, source_key)
    next_draft = _draft_from_item(item)
    if existing:
        if existing.get("editedText") or existing.get("status") in {"edited", "copied", "sent", "dismissed"}:
            return existing
        existing.update({
            "draftText": next_draft["draftText"],
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
    data = _read_store()
    draft = _find_draft(data, source_key)
    if not draft:
        draft = sync_greeting_draft_from_report(source_key) or _draft_from_item(item)
        data = _read_store()
        if not _find_draft(data, source_key):
            data["drafts"].append(draft)
            _write_store(data)
    return {"ok": True, "path": str(GREETING_DRAFTS_PATH), "draft": draft}


def save_greeting_draft(source_key: str, edited_text: str, status: str) -> dict[str, Any]:
    if status not in GREETING_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unsupported greeting status: {status}")
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
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
    if status in {"copied", "sent"}:
        draft["usedAt"] = draft.get("usedAt") or _now()
    _write_store(data)
    return {"ok": True, "path": str(GREETING_DRAFTS_PATH), "draft": draft}
