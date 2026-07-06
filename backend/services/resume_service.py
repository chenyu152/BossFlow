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
