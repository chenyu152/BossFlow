"""Generate review-only ingestion-rule drafts for a project."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException

from backend.services.llm_evaluation_service import _call_llm
from backend.services.project_service import resolve_project


KEYWORDS_ONLY_WARNING = "当前草稿仅基于目标岗位关键词生成；请确认分类边界，黑名单默认留空。"


def _clean_terms(value: Any, limit: int = 80) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        term = str(item or "").strip()
        key = term.casefold()
        if term and key not in seen:
            seen.add(key)
            result.append(term)
        if len(result) >= limit:
            break
    return result


def _clean_categories(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, list[str]] = {}
    for raw_name, raw_terms in value.items():
        name = str(raw_name or "").strip()[:60]
        terms = _clean_terms(raw_terms, limit=20)
        if name and terms:
            result[name] = terms
        if len(result) >= 10:
            break
    return result


def _parse_suggestion(content: str) -> dict[str, Any]:
    match = re.search(r"\{[\s\S]*\}", content)
    raw = match.group(0) if match else content
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="LLM did not return valid JSON matching-rule suggestions") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail="LLM returned an invalid matching-rule suggestion")
    return {
        "categoryRules": _clean_categories(value.get("categoryRules")),
        "relevanceKeywords": _clean_terms(value.get("relevanceKeywords")),
        "blacklistKeywords": _clean_terms(value.get("blacklistKeywords")),
        "rationale": str(value.get("rationale") or "").strip()[:500],
        "warnings": _clean_terms(value.get("warnings"), limit=8),
    }


def _has_existing_rules(snapshot: dict[str, str]) -> bool:
    try:
        categories = json.loads(snapshot.get("catRulesText") or "{}")
    except json.JSONDecodeError:
        categories = {}
    return bool(categories) or bool(snapshot.get("relevanceText", "").strip()) or bool(snapshot.get("blacklistText", "").strip())


def suggest_matching_rules(project: str, snapshot: dict[str, str]) -> dict[str, Any]:
    project_dir = resolve_project(project)
    has_existing_rules = _has_existing_rules(snapshot)
    system = """You generate a review-only job ingestion-rule draft for BossFlow.
Return JSON only, with no Markdown or other text.

Use only the supplied target job keywords and, when present, existing ingestion rules. Never use or infer anything from a candidate resume, city, or other personal profile data.

Rules:
- categoryRules maps a concise category name to title/description matching phrases.
- relevanceKeywords are narrowly scoped fallback keep-words when no category matches.
- blacklistKeywords must only include clearly unrelated job terms; do not broaden exclusions. When there are no existing ingestion rules, return an empty blacklistKeywords array.
- Do not use generic terms such as degree, experience, responsible, familiar, or job as matching phrases.
- Return at most 6 categories, 12 phrases per category, and 40 terms in each keyword list.
- When no existing rules are supplied, add a warning that the draft is based only on target job keywords and that the blacklist is intentionally empty.

Output shape:
{
  "categoryRules": {"Category": ["phrase"]},
  "relevanceKeywords": ["fallback keep-word"],
  "blacklistKeywords": ["clearly excluded term"],
  "rationale": "one-sentence coverage summary",
  "warnings": ["assumption to confirm"]
}"""
    user = {
        "project": project_dir.name,
        "currentSearchKeywords": snapshot.get("keywordsText", ""),
        "existingIngestionRules": {
            "categoryRules": snapshot.get("catRulesText", "{}"),
            "fallbackKeywords": snapshot.get("relevanceText", ""),
            "blacklistKeywords": snapshot.get("blacklistText", ""),
        } if has_existing_rules else "(No existing rules. Generate a conservative draft from target job keywords only.)",
    }
    content = _call_llm([
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
    ])
    suggestion = _parse_suggestion(content)
    if not has_existing_rules:
        suggestion["blacklistKeywords"] = []
        if KEYWORDS_ONLY_WARNING not in suggestion["warnings"]:
            suggestion["warnings"] = [KEYWORDS_ONLY_WARNING, *suggestion["warnings"]][:8]
    return {
        "ok": True,
        "project": project_dir.name,
        "basedOn": ["目标岗位关键词", *(["已有入库规则"] if has_existing_rules else [])],
        **suggestion,
    }
