import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services.llm_evaluation_service import _call_llm
from backend.services.project_service import resolve_project


def _sample_jobs(project_dir: Path, limit: int) -> list[dict[str, Any]]:
    db_path = project_dir / "jobs_data.db"
    if not db_path.exists() or db_path.stat().st_size == 0:
        return []
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT title, company, cats_json, exp, edu, desc
            FROM jobs
            ORDER BY last_seen DESC, avg DESC, id DESC
            LIMIT ?
            """,
            [limit],
        ).fetchall()
    finally:
        conn.close()

    jobs = []
    for row in rows:
        try:
            cats = json.loads(row["cats_json"] or "[]")
        except json.JSONDecodeError:
            cats = []
        jobs.append(
            {
                "title": row["title"] or "",
                "company": row["company"] or "",
                "categories": cats,
                "experience": row["exp"] or "",
                "education": row["edu"] or "",
                "description": (row["desc"] or "")[:700],
            }
        )
    return jobs


def _parse_keywords(content: str) -> tuple[list[str], str]:
    match = re.search(r"\{[\s\S]*\}", content)
    raw = match.group(0) if match else content
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="LLM did not return valid JSON keyword suggestions") from exc
    keywords = data.get("keywords") if isinstance(data, dict) else []
    rationale = str(data.get("rationale") or "") if isinstance(data, dict) else ""
    if not isinstance(keywords, list):
        keywords = []
    cleaned = []
    seen = set()
    for item in keywords:
        keyword = str(item).strip()
        key = keyword.lower()
        if keyword and key not in seen:
            seen.add(key)
            cleaned.append(keyword)
    return cleaned[:80], rationale


def suggest_scoring_keywords(project: str, limit: int = 80) -> dict[str, Any]:
    project_dir = resolve_project(project)
    jobs = _sample_jobs(project_dir, limit)
    if not jobs:
        raise HTTPException(status_code=404, detail=f"No jobs found for project: {project_dir.name}")

    system = """你是 BossFlow 的岗位评分配置助手。你的任务是根据当前本地岗位库样本，提炼适合“粗评分技能词库”的关键词。
规则：
- 只输出 JSON，不要 Markdown，不要解释性废话。
- keywords 应该是短词或短语，适合用字符串包含匹配。
- 优先保留能体现岗位能力要求的技术词、方向词、业务场景词。
- 避免过泛的词，例如“负责”“熟悉”“岗位”“经验”“本科”“薪资”。
- 中英文大小写常见写法可以都保留，但不要重复太多。
- 输出 25-60 个关键词。"""
    user = {
        "project": project_dir.name,
        "sampleCount": len(jobs),
        "jobs": jobs,
        "outputSchema": {
            "keywords": ["LLM", "RAG", "Agent"],
            "rationale": "一句话说明这些词覆盖了哪些岗位类型",
        },
    }
    content = _call_llm(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
        ]
    )
    keywords, rationale = _parse_keywords(content)
    return {
        "ok": True,
        "project": project_dir.name,
        "sampleCount": len(jobs),
        "keywords": keywords,
        "rationale": rationale,
    }
