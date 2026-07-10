import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services.llm_evaluation_service import (
    CV_PATH,
    PROFILE_PATH,
    REPORTS_DIR,
    _call_llm,
    _job_text,
    _load_pipeline_job,
    _read_text,
    _slug,
)
from backend.services.pipeline_service import find_pipeline_item, read_pipeline, update_pipeline_item_metadata
from backend.storage.paths import BASE_DIR

RESUME_OUTPUT_DIR = BASE_DIR / "output" / "resumes"


def _next_resume_id() -> str:
    RESUME_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    nums = []
    for path in RESUME_OUTPUT_DIR.glob("*.md"):
        prefix = path.name[:3]
        if prefix.isdigit():
            nums.append(int(prefix))
    return f"{(max(nums) + 1) if nums else 1:03d}"


def _safe_read_report(item: dict[str, Any], limit: int = 12000) -> str:
    report_path = str(item.get("reportPath") or "")
    if not report_path:
        return ""
    reports_root = REPORTS_DIR.resolve()
    try:
        resolved = Path(report_path).resolve()
    except OSError:
        return ""
    if reports_root != resolved and reports_root not in resolved.parents:
        return ""
    if resolved.suffix.lower() != ".md" or not resolved.exists() or not resolved.is_file():
        return ""
    return _read_text(resolved, limit)


def _safe_resume_suggestion_path(path_value: str) -> Path:
    if not path_value:
        raise HTTPException(status_code=404, detail="Pipeline item has no resume suggestions")
    resumes_root = RESUME_OUTPUT_DIR.resolve()
    try:
        resolved = Path(path_value).resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid resume suggestion path") from exc
    if resumes_root != resolved and resumes_root not in resolved.parents:
        raise HTTPException(status_code=403, detail="Resume suggestion path is outside the resumes directory")
    if resolved.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only Markdown resume suggestions can be viewed")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Resume suggestion file not found")
    return resolved


def _safe_resume_draft_path(path_value: str) -> Path:
    if not path_value:
        raise HTTPException(status_code=404, detail="Pipeline item has no tailored resume draft")
    resumes_root = RESUME_OUTPUT_DIR.resolve()
    try:
        resolved = Path(path_value).resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid resume draft path") from exc
    if resumes_root != resolved and resumes_root not in resolved.parents:
        raise HTTPException(status_code=403, detail="Resume draft path is outside the resumes directory")
    if resolved.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only Markdown resume drafts can be viewed")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Resume draft file not found")
    return resolved


def _prompt(job: dict[str, Any], item: dict[str, Any], report_text: str) -> list[dict[str, str]]:
    cv_text = _read_text(CV_PATH, 16000)
    profile_text = _read_text(PROFILE_PATH, 6000)
    evidence_map_example = json.dumps(
        [
            {
                "claimId": "S1",
                "claim": "建议动作摘要",
                "risk": "safe",
                "sources": [
                    {"type": "cv", "field": "涉及 CV 内容", "quote": "cv.md 中可对应的原文或摘要"},
                    {"type": "jd", "field": "为什么匹配 JD", "quote": "JD 需求或匹配理由"},
                ],
                "userDecision": "pending",
                "usedIn": [],
            }
        ],
        ensure_ascii=False,
        indent=2,
    )
    system = """你是 BossSpider 的定制简历建议助手。
你的任务是根据 Boss 直聘岗位 JD、候选人的 cv.md、可选 profile.yml、以及已有岗位精评报告，生成一份“简历修改建议”，而不是最终简历。

硬性规则：
- 只能使用 JD、cv.md、profile.yml、岗位精评报告里已经存在的信息。
- 不得编造工作经历、项目、指标、学历、公司、年限、薪资或技术成果。
- 如果某个 JD 要求在 CV 中没有证据，必须标记为“需要用户确认/补充证据”。
- 不要覆盖或改写 cv.md。
- 输出 Markdown。
- 不要输出“好的，收到”等开场白或解释性废话，直接从指定 Markdown 标题开始。
- 建议要能让用户逐条确认，避免一次性大段泛泛而谈。"""
    user = f"""请为以下 Boss 直聘岗位生成定制简历修改建议。

请严格按这些章节输出：

# 定制简历建议

## A. 岗位定位
用 3-5 条 bullet 概括这个岗位最看重什么。必须包含岗位链接。

## B. 可直接复用的 CV 证据
用表格列出：JD 要求 | cv.md 中可复用证据 | 建议放入简历位置 | 证据强度。

## C. 建议改写或前置的简历内容
输出 5-10 条可勾选建议。每条必须严格使用下面的单行格式：
- [ ] S1｜建议动作｜涉及 CV 内容｜为什么匹配 JD｜风险级别：safe
编号必须从 S1、S2、S3 递增；不要使用 C1、A1 或其他前缀；不要把“为什么匹配 JD”和“风险级别”拆成子 bullet。
风险级别只能是 safe、needs confirmation、avoid fabrication。

## D. 需要用户补充确认的事实
只列问题，不要替用户回答。比如项目指标、具体职责、技术深度、业务结果。

## E. 不建议写入的内容
列出容易夸大、证据不足或与岗位无关的内容。

## F. 后续生成定制简历时的策略
说明如果用户确认建议，最终 Markdown 简历应该如何组织：标题、技能摘要、项目顺序、bullet 风格。

末尾必须输出机器可读 evidence map。它必须是合法 JSON，不要放进 Markdown 代码块：
---BOSSSPIDER_EVIDENCE_MAP---
{evidence_map_example}
---END_EVIDENCE_MAP---

要求：
- evidence map 中的 `claimId` 必须和 C 节建议编号一一对应。
- `risk` 只能是 safe、needs_confirmation、avoid_fabrication。
- `sources.quote` 必须来自输入材料或对输入材料的短摘要；不能编造新事实。

岗位信息：
```text
{_job_text(job)}
```

岗位链接：
{job.get("url") or item.get("url") or "-"}

已有岗位精评报告：
```markdown
{report_text or "暂无岗位精评报告。"}
```

候选人 cv.md：
```markdown
{cv_text or "cv.md not found"}
```

profile.yml：
```yaml
{profile_text or "profile.yml not found"}
```
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _normalize_risk(value: str) -> str:
    risk = value.strip().lower().replace(" ", "_").replace("-", "_")
    if risk in {"safe", "low"}:
        return "safe"
    if risk in {"needs_confirmation", "needs_confirm", "confirm", "需要用户确认", "需确认"}:
        return "needs_confirmation"
    if risk in {"avoid_fabrication", "avoid", "fabrication", "avoid_fabricating", "避免编造"}:
        return "avoid_fabrication"
    if "avoid" in risk or "fabricat" in risk or "编造" in risk:
        return "avoid_fabrication"
    if "confirm" in risk or "确认" in risk:
        return "needs_confirmation"
    return "safe" if not risk else risk


def _clean_source_quote(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("风险级别", "")).strip(" ：:|｜")


def _evidence_map_from_markdown(content: str) -> list[dict[str, Any]]:
    claims: list[dict[str, Any]] = []
    for raw in content.splitlines():
        line = raw.strip()
        match = re.match(r"^[-*]\s+\[[ xX]\]\s*(S\d[\w-]*)\s*[｜|:：]\s*(.+)$", line, flags=re.IGNORECASE)
        if not match:
            continue
        claim_id = match.group(1).upper()
        parts = [part.strip() for part in re.split(r"[｜|]", match.group(2)) if part.strip()]
        action = parts[0] if parts else match.group(2).strip()
        cv_part = parts[1] if len(parts) > 1 else ""
        reason = parts[2] if len(parts) > 2 else ""
        risk_text = ""
        for part in parts:
            risk_match = re.search(r"风险级别\s*[:：]\s*(.+)$", part)
            if risk_match:
                risk_text = risk_match.group(1)
                break
        sources = []
        if cv_part:
            sources.append({"type": "cv", "field": "涉及 CV 内容", "quote": _clean_source_quote(cv_part)})
        if reason:
            sources.append({"type": "jd", "field": "为什么匹配 JD", "quote": _clean_source_quote(reason)})
        claims.append(
            {
                "claimId": claim_id,
                "claim": _clean_source_quote(action),
                "risk": _normalize_risk(risk_text),
                "sources": sources,
                "userDecision": "pending",
                "usedIn": [],
            }
        )
    return claims


def _parse_evidence_map(content: str) -> list[dict[str, Any]]:
    match = re.search(r"---BOSSSPIDER_EVIDENCE_MAP---\s*([\s\S]*?)---END_EVIDENCE_MAP---", content)
    if match:
        try:
            data = json.loads(match.group(1).strip())
            if isinstance(data, list):
                return [_clean_evidence_claim(item) for item in data if isinstance(item, dict)]
        except json.JSONDecodeError:
            pass
    return _evidence_map_from_markdown(content)


def _strip_evidence_map_block(content: str) -> str:
    return re.sub(
        r"\n?---BOSSSPIDER_EVIDENCE_MAP---\s*[\s\S]*?---END_EVIDENCE_MAP---\s*",
        "\n",
        content,
    ).rstrip() + "\n"


def _clean_evidence_claim(item: dict[str, Any]) -> dict[str, Any]:
    sources = item.get("sources") if isinstance(item.get("sources"), list) else []
    clean_sources = []
    for source in sources:
        if not isinstance(source, dict):
            continue
        clean_sources.append(
            {
                "type": str(source.get("type") or "").strip() or "unknown",
                "field": str(source.get("field") or "").strip(),
                "quote": str(source.get("quote") or "").strip(),
            }
        )
    return {
        "claimId": str(item.get("claimId") or "").strip().upper(),
        "claim": str(item.get("claim") or "").strip(),
        "risk": _normalize_risk(str(item.get("risk") or "")),
        "sources": clean_sources,
        "userDecision": str(item.get("userDecision") or "pending").strip() or "pending",
        "usedIn": item.get("usedIn") if isinstance(item.get("usedIn"), list) else [],
    }


def _load_resume_json(path: Path) -> dict[str, Any]:
    json_path = path.with_suffix(".json")
    if not json_path.exists():
        return {}
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _decisioned_evidence_map(evidence_map: list[dict[str, Any]], approved_ids: list[str]) -> list[dict[str, Any]]:
    approved = {item.upper() for item in approved_ids}
    result = []
    for raw_claim in evidence_map:
        claim = _clean_evidence_claim(raw_claim)
        claim["userDecision"] = "approved" if claim["claimId"] in approved else "rejected"
        result.append(claim)
    return result


def _draft_prompt(
    job: dict[str, Any],
    item: dict[str, Any],
    suggestion_text: str,
    approved_suggestion_ids: list[str],
    approved_evidence_map: list[dict[str, Any]],
    user_notes: str,
    report_text: str,
) -> list[dict[str, str]]:
    cv_text = _read_text(CV_PATH, 20000)
    profile_text = _read_text(PROFILE_PATH, 6000)
    approved = ", ".join(approved_suggestion_ids) if approved_suggestion_ids else "未勾选具体建议；请保守使用建议中 safe 的内容"
    system = """你是 BossSpider 的岗位定制简历生成助手。
你的任务是基于候选人的 cv.md、Boss 直聘岗位 JD、岗位精评报告、用户确认的简历修改建议，生成一份“岗位定制 Markdown 简历草稿”。

硬性规则：
- 只能改写、重排、提炼 cv.md 中已有事实，不能编造经历、指标、项目、公司、学历、年限、薪资或成果。
- 用户备注可以作为方向，但如果备注包含未经证实的新事实，只能标记为待确认，不要写成确定事实。
- 优先使用 approvedEvidenceMap 中 userDecision=approved 且 risk=safe 或 needs_confirmation 的建议。
- risk=avoid_fabrication 的建议只能放入“待用户确认后可补充”，不能写成确定事实。
- 不覆盖 cv.md，只输出一份新的 Markdown 草稿。
- 输出必须适合用户继续人工编辑。
- 不要输出 PDF、HTML 或解释性废话。"""
    user = f"""请生成一份针对以下 Boss 直聘岗位的定制 Markdown 简历草稿。

输出结构建议：
# 候选人姓名 - 针对「公司 / 岗位」的定制简历
## 求职目标
## 核心匹配摘要
## 技能栈
## 项目经历
## 工作/实习/其他经历
## 教育背景
## 待用户确认后可补充

要求：
- 保留真实可追溯事实。
- 优先使用用户确认的建议编号：{approved}
- 对每个重点项目/经历，尽量使用“动作 + 技术/方法 + 结果/影响”的 bullet。
- 如果没有结果指标，不要编造数字；可以写“可补充：具体指标/效果”。
- 若发现 JD 要求但 cv.md 缺证据，请放入“待用户确认后可补充”。

岗位信息：
```text
{_job_text(job)}
```

岗位精评报告：
```markdown
{report_text or "暂无岗位精评报告。"}
```

简历修改建议：
```markdown
{suggestion_text or "暂无简历修改建议。"}
```

已确认 evidence map：
```json
{json.dumps(approved_evidence_map, ensure_ascii=False, indent=2)}
```

用户确认的建议编号：
```text
{approved}
```

用户备注：
```text
{user_notes or "无"}
```

候选人 cv.md：
```markdown
{cv_text or "cv.md not found"}
```

profile.yml：
```yaml
{profile_text or "profile.yml not found"}
```
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _resume_item_from_pipeline_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "sourceKey": item.get("sourceKey", ""),
        "company": item.get("company", ""),
        "title": item.get("title", ""),
        "city": item.get("city", ""),
        "salary": item.get("salary", ""),
        "url": item.get("url", ""),
        "project": item.get("project", ""),
        "jobId": item.get("jobId"),
        "llmScore": item.get("llmScore"),
        "llmFitLevel": item.get("llmFitLevel", ""),
        "llmRecommendation": item.get("llmRecommendation", ""),
        "reportPath": item.get("reportPath", ""),
        "resumeSuggestionId": item.get("resumeSuggestionId", ""),
        "resumeSuggestionPath": item.get("resumeSuggestionPath", ""),
        "resumeSuggestedAt": item.get("resumeSuggestedAt", ""),
        "resumeDraftId": item.get("resumeDraftId", ""),
        "resumeDraftPath": item.get("resumeDraftPath", ""),
        "resumeDraftedAt": item.get("resumeDraftedAt", ""),
        "decisionStatus": item.get("decisionStatus", ""),
    }


def generate_resume_suggestions(source_key: str) -> dict[str, Any]:
    item, job = _load_pipeline_job(source_key)
    report_text = _safe_read_report(item)
    raw_content = _call_llm(_prompt(job, item, report_text))
    evidence_map = _parse_evidence_map(raw_content)
    content = _strip_evidence_map_block(raw_content)
    resume_id = _next_resume_id()
    now = dt.datetime.now()
    filename = (
        f"{resume_id}-{_slug(job.get('company'))}-{_slug(job.get('title'))}-"
        f"suggestions-{now.strftime('%Y-%m-%d')}.md"
    )
    suggestion_path = RESUME_OUTPUT_DIR / filename
    RESUME_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    suggestion_path.write_text(content, encoding="utf-8")

    meta = {
        "resumeSuggestionId": resume_id,
        "sourceKey": source_key,
        "generatedAt": now.isoformat(),
        "job": job,
        "pipelineItem": item,
        "suggestionPath": str(suggestion_path),
        "sourceReportPath": item.get("reportPath", ""),
        "evidenceMap": evidence_map,
    }
    json_path = suggestion_path.with_suffix(".json")
    json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    update_pipeline_item_metadata(
        source_key,
        {
            "resumeSuggestionId": resume_id,
            "resumeSuggestionPath": str(suggestion_path),
            "resumeSuggestionJsonPath": str(json_path),
            "resumeSuggestedAt": now.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeSuggestionId": resume_id,
        "suggestionPath": str(suggestion_path),
        "jsonPath": str(json_path),
        "content": content,
        "evidenceMap": evidence_map,
        "pipeline": read_pipeline(),
    }


def list_resume_items() -> dict[str, Any]:
    pipeline = read_pipeline()
    items = [
        _resume_item_from_pipeline_item(item)
        for item in [*pipeline["pending"], *pipeline["processed"]]
        if item.get("resumeSuggestionPath") or item.get("resumeDraftPath")
    ]
    return {"ok": True, "items": items}


def read_resume_suggestion(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    path = _safe_resume_suggestion_path(str(item.get("resumeSuggestionPath") or ""))
    content = path.read_text(encoding="utf-8")
    meta = _load_resume_json(path)
    evidence_map = meta.get("evidenceMap") if isinstance(meta.get("evidenceMap"), list) else _parse_evidence_map(content)
    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeSuggestionId": item.get("resumeSuggestionId", ""),
        "suggestionPath": str(path),
        "jsonPath": str(path.with_suffix(".json")),
        "content": content,
        "evidenceMap": evidence_map,
    }


def generate_resume_draft(source_key: str, approved_suggestion_ids: list[str], user_notes: str = "") -> dict[str, Any]:
    item, job = _load_pipeline_job(source_key)
    suggestion_path = _safe_resume_suggestion_path(str(item.get("resumeSuggestionPath") or ""))
    suggestion_text = suggestion_path.read_text(encoding="utf-8")
    suggestion_meta = _load_resume_json(suggestion_path)
    evidence_map = suggestion_meta.get("evidenceMap") if isinstance(suggestion_meta.get("evidenceMap"), list) else _parse_evidence_map(suggestion_text)
    decisioned_evidence_map = _decisioned_evidence_map(evidence_map, approved_suggestion_ids)
    approved_evidence_map = [
        claim for claim in decisioned_evidence_map
        if claim.get("userDecision") == "approved" and claim.get("risk") != "avoid_fabrication"
    ]
    report_text = _safe_read_report(item)
    content = _call_llm(_draft_prompt(job, item, suggestion_text, approved_suggestion_ids, approved_evidence_map, user_notes, report_text))

    draft_id = _next_resume_id()
    now = dt.datetime.now()
    filename = (
        f"{draft_id}-{_slug(job.get('company'))}-{_slug(job.get('title'))}-"
        f"draft-{now.strftime('%Y-%m-%d')}.md"
    )
    draft_path = RESUME_OUTPUT_DIR / filename
    RESUME_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    draft_path.write_text(content, encoding="utf-8")

    meta = {
        "resumeDraftId": draft_id,
        "sourceKey": source_key,
        "generatedAt": now.isoformat(),
        "job": job,
        "pipelineItem": item,
        "draftPath": str(draft_path),
        "suggestionPath": str(suggestion_path),
        "approvedSuggestionIds": approved_suggestion_ids,
        "evidenceMap": decisioned_evidence_map,
        "approvedEvidenceMap": approved_evidence_map,
        "userNotes": user_notes,
    }
    json_path = draft_path.with_suffix(".json")
    json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    update_pipeline_item_metadata(
        source_key,
        {
            "resumeDraftId": draft_id,
            "resumeDraftPath": str(draft_path),
            "resumeDraftJsonPath": str(json_path),
            "resumeDraftedAt": now.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeDraftId": draft_id,
        "draftPath": str(draft_path),
        "jsonPath": str(json_path),
        "content": content,
        "evidenceMap": decisioned_evidence_map,
        "pipeline": read_pipeline(),
    }


def read_resume_draft(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    path = _safe_resume_draft_path(str(item.get("resumeDraftPath") or ""))
    meta = _load_resume_json(path)
    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeDraftId": item.get("resumeDraftId", ""),
        "draftPath": str(path),
        "jsonPath": str(path.with_suffix(".json")),
        "content": path.read_text(encoding="utf-8"),
        "evidenceMap": meta.get("evidenceMap") if isinstance(meta.get("evidenceMap"), list) else [],
    }


def save_resume_draft(source_key: str, content: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    if not content.strip():
        raise HTTPException(status_code=422, detail="Tailored resume content cannot be empty")

    path = _safe_resume_draft_path(str(item.get("resumeDraftPath") or ""))
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"
    path.write_text(normalized, encoding="utf-8")

    edited_at = dt.datetime.now()
    meta = _load_resume_json(path)
    meta["manuallyEditedAt"] = edited_at.isoformat()
    path.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeDraftId": item.get("resumeDraftId", ""),
        "draftPath": str(path),
        "jsonPath": str(path.with_suffix(".json")),
        "content": normalized,
        "evidenceMap": meta.get("evidenceMap") if isinstance(meta.get("evidenceMap"), list) else [],
        "editedAt": edited_at.strftime("%Y-%m-%d %H:%M:%S"),
    }
