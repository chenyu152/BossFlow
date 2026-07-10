import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any

import requests
from fastapi import HTTPException

from backend.services.evidence_service import sync_requirement_assessment
from backend.services.job_service import get_jobs_by_ids
from backend.services.greeting_service import sync_greeting_draft_from_report
from backend.services.pipeline_service import find_pipeline_item, read_pipeline, update_pipeline_item_metadata
from backend.services.project_service import resolve_project
from backend.storage.paths import BASE_DIR

CV_PATH = BASE_DIR / "cv.md"
PROFILE_PATH = BASE_DIR / "profile.yml"
REPORTS_DIR = BASE_DIR / "reports" / "jobs"


def _read_text(path: Path, limit: int | None = None) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8").strip()
    return text[:limit].rstrip() if limit and len(text) > limit else text


def _env_file_values() -> dict[str, str]:
    env_path = BASE_DIR / ".env"
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _env(name: str, fallback: str = "") -> str:
    return os.getenv(name) or _env_file_values().get(name, fallback)


def _llm_config() -> tuple[str, str, str]:
    api_key = (
        _env("BOSSSPIDER_LLM_API_KEY")
        or _env("DEEPSEEK_API_KEY")
        or _env("OPENAI_API_KEY")
    )
    api_base = (
        _env("BOSSSPIDER_LLM_API_BASE")
        or _env("DEEPSEEK_API_BASE")
        or _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    )
    model = _env("BOSSSPIDER_LLM_MODEL") or _env("DEEPSEEK_MODEL", "deepseek-chat")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"Missing LLM API key. Set BOSSSPIDER_LLM_API_KEY or DEEPSEEK_API_KEY in environment or {BASE_DIR / '.env'}.",
        )
    return api_key, api_base, model


def _slug(value: str, fallback: str = "job") -> str:
    value = (value or fallback).lower()
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff-]+", "", value)
    return value.strip("-")[:48] or fallback


def _next_report_id() -> str:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    nums = []
    for path in REPORTS_DIR.glob("*.md"):
        prefix = path.name[:3]
        if prefix.isdigit():
            nums.append(int(prefix))
    return f"{(max(nums) + 1) if nums else 1:03d}"


def _load_pipeline_job(source_key: str) -> tuple[dict[str, Any], dict[str, Any]]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    project = item.get("project")
    job_id = item.get("jobId")
    if not project or not job_id:
        raise HTTPException(status_code=400, detail="Pipeline item is missing project/jobId metadata")
    project_dir = resolve_project(project)
    jobs = get_jobs_by_ids(project_dir, [int(job_id)])
    if not jobs:
        raise HTTPException(status_code=404, detail=f"Job not found: {project}#{job_id}")
    return item, jobs[0]


def _job_text(job: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Company: {job.get('company') or '-'}",
            f"Role: {job.get('title') or '-'}",
            f"City: {job.get('city') or '-'}",
            f"Salary: {job.get('salary') or '-'}",
            f"Average salary K: {job.get('avg') or 0}",
            f"Experience/Education: {job.get('exp') or '-'} / {job.get('edu') or '-'}",
            f"Categories: {', '.join(job.get('cats') or []) or job.get('tier') or '-'}",
            f"URL: {job.get('url') or '-'}",
            "",
            "JD:",
            (job.get("desc") or "")[:9000],
        ]
    )


def _prompt(job: dict[str, Any], item: dict[str, Any]) -> list[dict[str, str]]:
    cv_text = _read_text(CV_PATH, 12000)
    profile_text = _read_text(PROFILE_PATH, 6000)
    pre_score = item.get("score")
    system = """你是 BossSpider 的求职岗位精评估助手。

你的任务是根据 Boss 直聘岗位 JD、候选人 cv.md、可选 profile.yml，生成一份可落地的岗位精评估报告。

硬性规则：
- 只能使用 JD、cv.md、profile.yml 中存在的信息；不要编造经历、项目、指标、公司背景。
- 如果 CV 证据不足，直接标记为缺口，不要替候选人补事实。
- Boss 直聘场景下，下一步通常是“打招呼/沟通”，不是邮件投递。
- 只生成建议和草稿，不要声称已经发送、投递或联系。
- “当前材料中未找到证据”不等于候选人不具备能力，禁止据此断言候选人不会或缺乏某项能力。
- 输出 Markdown。
- 末尾必须包含机器可读 summary block。
- summary block 后必须包含机器可读 requirement assessment block。
"""
    user = f"""请精评估以下 Boss 直聘岗位。

请按这些章节输出：

# 岗位精评估

## A. 岗位摘要
提炼公司、岗位、城市、薪资、岗位链接、核心职责、硬性要求。

## B. 简历匹配证据
用表格列出 JD 要求、CV 中可对应的证据、证据强度。证据必须来自 cv.md。

## C. 缺口和风险
列出能力缺口、年限/行业/技术栈风险、JD 本身不清晰或可疑之处。

## D. 是否值得继续
给出 1.0-5.0 分，并解释为什么。参考但不要盲从本地粗筛分数：{pre_score or "未粗筛"}。

## E. 定制简历建议
只给建议，不直接改写简历。说明哪些 bullet 应该重排或强化，哪些内容需要用户确认事实。

## F. Boss 打招呼草稿
给 2 条短草稿，每条不超过 80 字。必须基于真实匹配点。

## G. 下一步动作
给出明确建议：跳过 / 先收藏 / 生成定制简历 / 打招呼前人工确认 / 准备面试故事。

末尾必须输出：
---BOSSSPIDER_LLM_SUMMARY---
SCORE: <1.0-5.0>
FIT_LEVEL: <High Fit | Worth Reviewing | Weak Match | Skip Unless Strategic>
RECOMMENDATION: <一句话建议>
GREETING_READY: <yes|no>
---END_SUMMARY---

紧接着 summary block 输出以下合法 JSON，不要放进 Markdown 代码块：
---BOSSFLOW_REQUIREMENT_ASSESSMENT---
[
  {{
    "canonicalKey": "规范、稳定、适合跨岗位聚合的键",
    "label": "要求名称",
    "category": "skill|experience|behavior|education|location|preference|other",
    "importance": "required|preferred|context",
    "jdQuote": "JD 中的对应短句",
    "candidateEvidenceRefs": [
      {{"sourceType": "cv", "quote": "cv.md 中的对应原文或短摘要", "locator": "简历章节或项目名"}}
    ],
    "coverageStatus": "supported|partial|not_found|unknown",
    "rationale": "只说明当前输入材料是否提供了相关证据",
    "confidence": 0.0
  }}
]
---END_REQUIREMENT_ASSESSMENT---

Requirement assessment 规则：
- 提取 5-12 条对岗位决策最重要的要求，合并语义重复项。
- canonicalKey 应简短、稳定；相同能力在不同岗位中应尽量使用相同 key。
- candidateEvidenceRefs 只能引用 cv.md 中真实存在的内容；没有证据时必须是空数组。
- supported 表示当前材料中存在直接证据，partial 表示只有相近或不完整证据。
- 当前材料中未找到证据时只能输出 not_found，绝不能输出 user_confirmed_absent。
- 不得输出 done、adjacent、not_done、unsure；这些只能由用户交互产生。
- confidence 必须是 0 到 1 之间的数字。

候选人 cv.md：
```markdown
{cv_text or "cv.md not found"}
```

profile.yml：
```yaml
{profile_text or "profile.yml not found"}
```

岗位信息：
```text
{_job_text(job)}
```
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _call_llm(messages: list[dict[str, str]]) -> str:
    api_key, api_base, model = _llm_config()
    url = f"{api_base.rstrip('/')}/chat/completions"
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "temperature": 0.25, "max_tokens": 5000},
        timeout=120,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"LLM API failed ({response.status_code}): {response.text[:500]}")
    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="LLM API returned an unexpected response shape") from exc


def _parse_summary(text: str) -> dict[str, Any]:
    summary = {
        "score": None,
        "fitLevel": "",
        "recommendation": "",
        "greetingReady": "",
    }
    match = re.search(r"---BOSSSPIDER_LLM_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---", text)
    if not match:
        return summary
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().upper()
        value = value.strip()
        if key == "SCORE":
            try:
                summary["score"] = round(float(value), 1)
            except ValueError:
                pass
        elif key == "FIT_LEVEL":
            summary["fitLevel"] = value
        elif key == "RECOMMENDATION":
            summary["recommendation"] = value
        elif key == "GREETING_READY":
            summary["greetingReady"] = value
    return summary


def _canonical_key(value: str, fallback: str) -> str:
    key = re.sub(r"\s+", "-", (value or fallback).strip().lower())
    key = re.sub(r"[^a-z0-9\u4e00-\u9fff._-]+", "-", key)
    return re.sub(r"-+", "-", key).strip("-._")[:80]


def _parse_requirement_assessment(text: str) -> list[dict[str, Any]]:
    match = re.search(
        r"---BOSSFLOW_REQUIREMENT_ASSESSMENT---\s*([\s\S]*?)---END_REQUIREMENT_ASSESSMENT---",
        text,
    )
    if not match:
        return []
    raw = match.group(1).strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        payload = payload.get("requirements")
    if not isinstance(payload, list):
        return []

    allowed_categories = {"skill", "experience", "behavior", "education", "location", "preference", "other"}
    allowed_importance = {"required", "preferred", "context"}
    allowed_statuses = {"supported", "partial", "not_found", "unknown"}
    requirements: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for raw_item in payload:
        if not isinstance(raw_item, dict):
            continue
        label = str(raw_item.get("label") or "").strip()
        canonical_key = _canonical_key(str(raw_item.get("canonicalKey") or ""), label)
        if not label or not canonical_key or canonical_key in seen_keys:
            continue
        category = str(raw_item.get("category") or "other").strip().lower()
        importance = str(raw_item.get("importance") or "context").strip().lower()
        coverage_status = str(raw_item.get("coverageStatus") or "unknown").strip().lower()
        if category not in allowed_categories:
            category = "other"
        if importance not in allowed_importance:
            importance = "context"
        if coverage_status not in allowed_statuses:
            coverage_status = "unknown"
        try:
            confidence = max(0.0, min(1.0, float(raw_item.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0

        refs = []
        for raw_ref in raw_item.get("candidateEvidenceRefs") or []:
            if not isinstance(raw_ref, dict):
                continue
            quote = str(raw_ref.get("quote") or "").strip()
            if not quote:
                continue
            refs.append(
                {
                    "sourceType": str(raw_ref.get("sourceType") or "cv").strip() or "cv",
                    "quote": quote,
                    "locator": str(raw_ref.get("locator") or "").strip(),
                }
            )
        if coverage_status == "not_found":
            refs = []
        elif coverage_status in {"supported", "partial"} and not refs:
            coverage_status = "not_found"
        requirements.append(
            {
                "canonicalKey": canonical_key,
                "label": label,
                "category": category,
                "importance": importance,
                "jdQuote": str(raw_item.get("jdQuote") or "").strip(),
                "candidateEvidenceRefs": refs,
                "coverageStatus": coverage_status,
                "rationale": str(raw_item.get("rationale") or "").strip(),
                "confidence": confidence,
            }
        )
        seen_keys.add(canonical_key)
    return requirements


def _strip_requirement_assessment_block(text: str) -> str:
    return re.sub(
        r"\n?---BOSSFLOW_REQUIREMENT_ASSESSMENT---\s*[\s\S]*?---END_REQUIREMENT_ASSESSMENT---\s*",
        "\n",
        text,
    ).rstrip() + "\n"


def llm_evaluate_pipeline_item(source_key: str) -> dict[str, Any]:
    item, job = _load_pipeline_job(source_key)
    report_text = _call_llm(_prompt(job, item))
    summary = _parse_summary(report_text)
    requirement_assessment = _parse_requirement_assessment(report_text)
    if not requirement_assessment:
        raise HTTPException(status_code=502, detail="LLM report is missing a valid structured requirement assessment")
    report_id = _next_report_id()
    filename = f"{report_id}-{_slug(job.get('company'))}-{_slug(job.get('title'))}-{dt.datetime.now().strftime('%Y-%m-%d')}.md"
    report_path = REPORTS_DIR / filename
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(_strip_requirement_assessment_block(report_text), encoding="utf-8")
    evidence_sync = sync_requirement_assessment(source_key, requirement_assessment)
    evidence_summary = evidence_sync["summary"]
    json_path = report_path.with_suffix(".json")
    json_path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "reportId": report_id,
                "sourceKey": source_key,
                "generatedAt": dt.datetime.now().isoformat(),
                "job": job,
                "summary": summary,
                "requirementAssessment": requirement_assessment,
                "evidenceSummary": evidence_summary,
                "evidenceCoverages": evidence_sync["coverages"],
                "reportPath": str(report_path),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    update_pipeline_item_metadata(
        source_key,
        {
            "llmScore": summary["score"],
            "llmFitLevel": summary["fitLevel"],
            "llmRecommendation": summary["recommendation"],
            "greetingReady": summary["greetingReady"],
            "reportPath": str(report_path),
            "reportId": report_id,
            "evaluatedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "decisionStatus": "needs_review",
            **evidence_summary,
        },
    )
    sync_greeting_draft_from_report(source_key)

    return {
        "ok": True,
        "reportId": report_id,
        "reportPath": str(report_path),
        "jsonPath": str(json_path),
        "summary": summary,
        "requirementAssessment": requirement_assessment,
        "evidenceSummary": evidence_summary,
        "pipeline": read_pipeline(),
    }
