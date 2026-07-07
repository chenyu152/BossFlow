import datetime as dt
import json
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
    system = """你是 BossSpider 的定制简历建议助手。
你的任务是根据 Boss 直聘岗位 JD、候选人的 cv.md、可选 profile.yml、以及已有岗位精评报告，生成一份“简历修改建议”，而不是最终简历。

硬性规则：
- 只能使用 JD、cv.md、profile.yml、岗位精评报告里已经存在的信息。
- 不得编造工作经历、项目、指标、学历、公司、年限、薪资或技术成果。
- 如果某个 JD 要求在 CV 中没有证据，必须标记为“需要用户确认/补充证据”。
- 不要覆盖或改写 cv.md。
- 输出 Markdown。
- 建议要能让用户逐条确认，避免一次性大段泛泛而谈。"""
    user = f"""请为以下 Boss 直聘岗位生成定制简历修改建议。

请严格按这些章节输出：

# 定制简历建议

## A. 岗位定位
用 3-5 条 bullet 概括这个岗位最看重什么。必须包含岗位链接。

## B. 可直接复用的 CV 证据
用表格列出：JD 要求 | cv.md 中可复用证据 | 建议放入简历位置 | 证据强度。

## C. 建议改写或前置的简历内容
输出 5-10 条可勾选建议。每条建议格式：
- [ ] S编号｜建议动作｜涉及 CV 内容｜为什么匹配 JD｜风险级别
风险级别只能是 safe、needs confirmation、avoid fabrication。

## D. 需要用户补充确认的事实
只列问题，不要替用户回答。比如项目指标、具体职责、技术深度、业务结果。

## E. 不建议写入的内容
列出容易夸大、证据不足或与岗位无关的内容。

## F. 后续生成定制简历时的策略
说明如果用户确认建议，最终 Markdown 简历应该如何组织：标题、技能摘要、项目顺序、bullet 风格。

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


def _draft_prompt(
    job: dict[str, Any],
    item: dict[str, Any],
    suggestion_text: str,
    approved_suggestion_ids: list[str],
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
    content = _call_llm(_prompt(job, item, report_text))
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
    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeSuggestionId": item.get("resumeSuggestionId", ""),
        "suggestionPath": str(path),
        "content": path.read_text(encoding="utf-8"),
    }


def generate_resume_draft(source_key: str, approved_suggestion_ids: list[str], user_notes: str = "") -> dict[str, Any]:
    item, job = _load_pipeline_job(source_key)
    suggestion_path = _safe_resume_suggestion_path(str(item.get("resumeSuggestionPath") or ""))
    suggestion_text = suggestion_path.read_text(encoding="utf-8")
    report_text = _safe_read_report(item)
    content = _call_llm(_draft_prompt(job, item, suggestion_text, approved_suggestion_ids, user_notes, report_text))

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
        "pipeline": read_pipeline(),
    }


def read_resume_draft(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    path = _safe_resume_draft_path(str(item.get("resumeDraftPath") or ""))
    return {
        "ok": True,
        "sourceKey": source_key,
        "resumeDraftId": item.get("resumeDraftId", ""),
        "draftPath": str(path),
        "content": path.read_text(encoding="utf-8"),
    }
