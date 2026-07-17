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
from backend.services.evidence_service import read_evidence_overview
from backend.storage.paths import BASE_DIR
from backend.services.workspace_service import workspace_path

INTERVIEW_DATA_DIR = workspace_path("data/interview-prep")
INTERVIEW_OUTPUT_DIR = workspace_path("output/interview-prep")
STORY_BANK_PATH = workspace_path("data/interview-prep/story-bank.md")
STORY_DRAFTS_PATH = workspace_path("data/interview-prep/story-drafts.json")
RESUME_OUTPUT_DIR = workspace_path("output/resumes")


def _next_interview_id() -> str:
    INTERVIEW_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    nums = []
    for path in INTERVIEW_OUTPUT_DIR.glob("*.md"):
        prefix = path.name[:3]
        if prefix.isdigit():
            nums.append(int(prefix))
    return f"{(max(nums) + 1) if nums else 1:03d}"


def _safe_read_markdown(path_value: str, root: Path, limit: int = 12000) -> str:
    if not path_value:
        return ""
    try:
        resolved = Path(path_value).resolve()
    except OSError:
        return ""
    root_resolved = root.resolve()
    if root_resolved != resolved and root_resolved not in resolved.parents:
        return ""
    if resolved.suffix.lower() != ".md" or not resolved.exists() or not resolved.is_file():
        return ""
    return _read_text(resolved, limit)


def _safe_interview_prep_path(path_value: str) -> Path:
    if not path_value:
        raise HTTPException(status_code=404, detail="Pipeline item has no interview prep")
    root = INTERVIEW_OUTPUT_DIR.resolve()
    try:
        resolved = Path(path_value).resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid interview prep path") from exc
    if root != resolved and root not in resolved.parents:
        raise HTTPException(status_code=403, detail="Interview prep path is outside the interview output directory")
    if resolved.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only Markdown interview prep can be viewed")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Interview prep file not found")
    return resolved


def _load_interview_prep_json(prep_path: Path) -> dict[str, Any]:
    json_path = prep_path.with_suffix(".json")
    if not json_path.exists() or not json_path.is_file():
        return {}
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _interview_evidence_context(source_key: str) -> dict[str, list[dict[str, Any]]]:
    """Return evidence that is safe to use for one job's interview preparation."""
    overview = read_evidence_overview()
    requirements = [
        item
        for item in overview.get("requirements", [])
        if item.get("sourceKey") == source_key and item.get("active") is not False
    ]
    requirement_ids = {str(item.get("requirementId") or "") for item in requirements}
    coverages_by_requirement = {
        str(item.get("requirementId") or ""): item
        for item in overview.get("coverages", [])
        if str(item.get("requirementId") or "") in requirement_ids
    }
    evidence_by_id = {
        str(item.get("evidenceId") or ""): item
        for item in overview.get("evidenceItems", [])
        if item.get("status") == "confirmed"
    }
    confirmed_ids = {
        str(evidence_id)
        for coverage in coverages_by_requirement.values()
        if coverage.get("coverageStatus") == "supported"
        for evidence_id in coverage.get("evidenceIds") or []
        if str(evidence_id) in evidence_by_id
    }
    source_verified_requirements = [
        {
            "requirementId": requirement.get("requirementId", ""),
            "label": requirement.get("label", ""),
            "jdQuote": requirement.get("jdQuote", ""),
            "candidateEvidenceRefs": coverages_by_requirement.get(
                str(requirement.get("requirementId") or ""), {}
            ).get("candidateEvidenceRefs", []),
        }
        for requirement in requirements
        if (
            coverages_by_requirement.get(str(requirement.get("requirementId") or ""), {}).get("coverageStatus") == "supported"
            and coverages_by_requirement.get(str(requirement.get("requirementId") or ""), {}).get("verificationStatus") == "source_verified"
        )
    ]
    pending_requirements = [
        {
            "requirementId": requirement.get("requirementId", ""),
            "label": requirement.get("label", ""),
            "importance": requirement.get("importance", "context"),
            "coverageStatus": coverage.get("coverageStatus", "unknown"),
            "userClassification": coverage.get("userClassification", ""),
            "rationale": coverage.get("rationale", ""),
        }
        for requirement in requirements
        for coverage in [coverages_by_requirement.get(str(requirement.get("requirementId") or ""), {})]
        if coverage.get("coverageStatus") != "supported"
    ]
    return {
        "confirmedEvidence": [
            {
                "evidenceId": evidence_id,
                "title": evidence_by_id[evidence_id].get("title", ""),
                "summary": evidence_by_id[evidence_id].get("summary", ""),
                "userRole": evidence_by_id[evidence_id].get("userRole", ""),
                "actions": evidence_by_id[evidence_id].get("actions", []),
                "results": evidence_by_id[evidence_id].get("results", []),
                "sourceRefs": evidence_by_id[evidence_id].get("sourceRefs", []),
            }
            for evidence_id in sorted(confirmed_ids)
        ],
        "sourceVerifiedRequirements": source_verified_requirements,
        "pendingRequirements": pending_requirements,
    }


def _ensure_story_bank() -> None:
    INTERVIEW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    if STORY_BANK_PATH.exists():
        return
    STORY_BANK_PATH.write_text(
        "# Interview Story Bank\n\n"
        "Use this file to keep reusable STAR+R stories. Each story can be matched to multiple interview questions.\n\n"
        "## Stories\n\n"
        "### [Theme] Story title\n"
        "**Source:** Where this story comes from\n"
        "**Best for questions about:** ownership, ambiguity, collaboration\n"
        "**Format:** freeform\n"
        "**Structure status:** needs_structuring\n"
        "**Raw note:** \n"
        "**S (Situation):** \n"
        "**T (Task):** \n"
        "**A (Action):** \n"
        "**R (Result):** \n"
        "**Reflection:** \n",
        encoding="utf-8",
    )


def _ensure_story_drafts() -> None:
    INTERVIEW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    if STORY_DRAFTS_PATH.exists():
        return
    STORY_DRAFTS_PATH.write_text(
        json.dumps({"version": 1, "drafts": []}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _parse_story_bank(content: str) -> list[dict[str, Any]]:
    stories: list[dict[str, Any]] = []
    blocks = re.split(r"^###\s+", content, flags=re.MULTILINE)[1:]
    for index, block in enumerate(blocks):
        lines = block.strip().splitlines()
        if not lines:
            continue
        heading = lines[0].strip()
        theme = ""
        title = heading
        theme_match = re.match(r"^\[([^\]]+)\]\s*(.+)$", heading)
        if theme_match:
            theme = theme_match.group(1).strip()
            title = theme_match.group(2).strip()

        fields: dict[str, list[str]] = {}
        current_label = ""
        for line in lines[1:]:
            field_match = re.match(r"^\*\*([^:：]+)[:：]\*\*\s*(.*)$", line.strip())
            if field_match:
                current_label = field_match.group(1).strip()
                fields[current_label] = [field_match.group(2).strip()]
            elif current_label:
                fields[current_label].append(line.rstrip())

        def field(*labels: str) -> str:
            for label in labels:
                if label in fields:
                    return "\n".join(fields[label]).strip()
            return ""

        tags = [
            tag.strip()
            for tag in re.split(r"[,;，；]", field("Best for questions about"))
            if tag.strip()
        ]
        story = {
            "id": f"story-{index + 1}",
            "title": title,
            "theme": theme,
            "source": field("Source"),
            "tags": tags,
            "rawNote": field("Raw note", "Raw Note"),
            "format": field("Format") or "star",
            "structureStatus": field("Structure status", "Structure Status") or "structured",
            "situation": field("S (Situation)", "Situation"),
            "task": field("T (Task)", "Task"),
            "action": field("A (Action)", "Action"),
            "result": field("R (Result)", "Result"),
            "reflection": field("Reflection"),
        }
        if story["title"] and story["title"].lower() != "story title" and any(
            story[key] for key in ("rawNote", "situation", "task", "action", "result", "reflection")
        ):
            stories.append(story)
    return stories


def _clean_story(story: dict[str, Any]) -> dict[str, Any]:
    tags = story.get("tags") or []
    if isinstance(tags, str):
        tags = re.split(r"[,;，；]", tags)
    return {
        "title": str(story.get("title") or "").strip(),
        "theme": str(story.get("theme") or "").strip(),
        "source": str(story.get("source") or "").strip(),
        "tags": [str(tag).strip() for tag in tags if str(tag).strip()],
        "rawNote": str(story.get("rawNote") or "").strip(),
        "format": str(story.get("format") or "freeform").strip() or "freeform",
        "structureStatus": str(story.get("structureStatus") or "needs_structuring").strip() or "needs_structuring",
        "situation": str(story.get("situation") or "").strip(),
        "task": str(story.get("task") or "").strip(),
        "action": str(story.get("action") or "").strip(),
        "result": str(story.get("result") or "").strip(),
        "reflection": str(story.get("reflection") or "").strip(),
    }


def _clean_story_draft(draft: dict[str, Any]) -> dict[str, Any]:
    story = _clean_story(draft)
    status = str(draft.get("status") or "needs_confirmation").strip().lower()
    if status not in {"needs_confirmation", "editing", "ready", "promoted", "dismissed"}:
        status = "needs_confirmation"
    return {
        **story,
        "draftId": str(draft.get("draftId") or "").strip(),
        "status": status,
        "sourceKey": str(draft.get("sourceKey") or "").strip(),
        "sourceLabel": str(draft.get("sourceLabel") or "").strip(),
        "prepPath": str(draft.get("prepPath") or "").strip(),
        "createdAt": str(draft.get("createdAt") or "").strip(),
        "updatedAt": str(draft.get("updatedAt") or "").strip(),
        "promotedAt": str(draft.get("promotedAt") or "").strip(),
        "promotedStoryId": str(draft.get("promotedStoryId") or "").strip(),
    }


def _render_story_bank(stories: list[dict[str, Any]]) -> str:
    lines = [
        "# Interview Story Bank",
        "",
        "Reusable STAR+R stories for interview prep. Keep every claim defensible.",
        "",
        "## Stories",
        "",
    ]
    for raw_story in stories:
        story = _clean_story(raw_story)
        if not story["title"]:
            continue
        heading = f"[{story['theme']}] {story['title']}" if story["theme"] else story["title"]
        lines.extend(
            [
                f"### {heading}",
                f"**Source:** {story['source']}",
                f"**Best for questions about:** {', '.join(story['tags'])}",
                f"**Format:** {story['format']}",
                f"**Structure status:** {story['structureStatus']}",
                f"**Raw note:** {story['rawNote']}",
                f"**S (Situation):** {story['situation']}",
                f"**T (Task):** {story['task']}",
                f"**A (Action):** {story['action']}",
                f"**R (Result):** {story['result']}",
                f"**Reflection:** {story['reflection']}",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def _interview_item_from_pipeline_item(item: dict[str, Any]) -> dict[str, Any]:
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
        "resumeSuggestionPath": item.get("resumeSuggestionPath", ""),
        "resumeDraftPath": item.get("resumeDraftPath", ""),
        "interviewPrepId": item.get("interviewPrepId", ""),
        "interviewPrepPath": item.get("interviewPrepPath", ""),
        "interviewPreparedAt": item.get("interviewPreparedAt", ""),
        "decisionStatus": item.get("decisionStatus", ""),
    }


def list_interview_items() -> dict[str, Any]:
    pipeline = read_pipeline()
    items = []
    for item in [*pipeline["pending"], *pipeline["processed"]]:
        if (
            item.get("reportPath")
            or item.get("resumeSuggestionPath")
            or item.get("resumeDraftPath")
            or item.get("interviewPrepPath")
            or item.get("llmScore")
        ):
            items.append(_interview_item_from_pipeline_item(item))
    return {"ok": True, "items": items}


def read_story_bank() -> dict[str, Any]:
    _ensure_story_bank()
    content = STORY_BANK_PATH.read_text(encoding="utf-8")
    return {
        "ok": True,
        "path": str(STORY_BANK_PATH),
        "content": content,
        "stories": _parse_story_bank(content),
    }


def save_story_bank(stories: list[dict[str, Any]]) -> dict[str, Any]:
    _ensure_story_bank()
    cleaned = [_clean_story(story) for story in stories]
    content = _render_story_bank(cleaned)
    STORY_BANK_PATH.write_text(content, encoding="utf-8")
    return read_story_bank()


def read_story_drafts() -> dict[str, Any]:
    _ensure_story_drafts()
    try:
        payload = json.loads(STORY_DRAFTS_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        payload = {"version": 1, "drafts": []}
    drafts = [_clean_story_draft(draft) for draft in payload.get("drafts", []) if isinstance(draft, dict)]
    return {
        "ok": True,
        "path": str(STORY_DRAFTS_PATH),
        "drafts": drafts,
    }


def save_story_drafts(drafts: list[dict[str, Any]]) -> dict[str, Any]:
    _ensure_story_drafts()
    now = dt.datetime.now().isoformat()
    cleaned = []
    for draft in drafts:
        item = _clean_story_draft(draft)
        if not item["createdAt"]:
            item["createdAt"] = now
        item["updatedAt"] = now
        cleaned.append(item)
    payload = {
        "version": 1,
        "updatedAt": now,
        "drafts": cleaned,
    }
    STORY_DRAFTS_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return read_story_drafts()


def _has_promotable_story_fields(story: dict[str, Any]) -> bool:
    return any(story.get(key) for key in ("rawNote", "situation", "task", "action", "result"))


def promote_story_draft(draft_id: str, draft: dict[str, Any]) -> dict[str, Any]:
    current = _clean_story_draft({**draft, "draftId": draft_id or draft.get("draftId", "")})
    if not current["draftId"]:
        raise HTTPException(status_code=400, detail="Draft id is required")
    if not current["title"]:
        raise HTTPException(status_code=400, detail="Story title is required")
    if not _has_promotable_story_fields(current):
        raise HTTPException(status_code=400, detail="At least one STAR field is required")

    bank = read_story_bank()
    next_stories = [*bank["stories"], _clean_story(current)]
    saved_bank = save_story_bank(next_stories)
    promoted_story = saved_bank["stories"][-1] if saved_bank["stories"] else {}

    now = dt.datetime.now().isoformat()
    existing_drafts = read_story_drafts()["drafts"]
    promoted_draft = {
        **current,
        "status": "promoted",
        "promotedAt": now,
        "promotedStoryId": promoted_story.get("id", ""),
        "updatedAt": now,
    }
    found = False
    next_drafts = []
    for existing in existing_drafts:
        if existing.get("draftId") == current["draftId"]:
            next_drafts.append({**existing, **promoted_draft})
            found = True
        else:
            next_drafts.append(existing)
    if not found:
        next_drafts.append(promoted_draft)
    saved_drafts = save_story_drafts(next_drafts)
    saved_promoted_draft = next(
        (item for item in saved_drafts["drafts"] if item.get("draftId") == current["draftId"]),
        promoted_draft,
    )

    return {
        "ok": True,
        "story": promoted_story,
        "draft": saved_promoted_draft,
        "storyBank": saved_bank,
        "storyDrafts": saved_drafts,
    }


def _prompt(
    job: dict[str, Any],
    item: dict[str, Any],
    story_bank: str,
    report_text: str,
    resume_draft_text: str,
    evidence_context: dict[str, list[dict[str, Any]]],
    user_notes: str,
) -> list[dict[str, str]]:
    cv_text = _read_text(CV_PATH, 18000)
    profile_text = _read_text(PROFILE_PATH, 6000)
    system = """你是 BossFlow 的面试准备助手，负责把 Boss 直聘岗位、候选人简历、岗位精评和故事库整理成可执行的面试准备文档。

硬性规则：
- 只使用输入材料中存在的信息，不要编造候选人经历、指标、公司背景或真实面试题。
- 不能联网调研；如果需要公司调研，放到“后续联网调研待补充”。
- 未经来源证明的问题必须标注为“[基于JD推断]”。
- 故事匹配必须来自 story-bank.md 或 cv.md；如果证据不足，明确标为“缺故事/需用户补充”。
- 输出 Markdown，内容要适合直接给求职者面试前复习。
"""
    user = f"""请为以下 Boss 直聘岗位生成一份岗位面试准备文档。

请严格按这些章节输出：

# 面试准备：{{公司}} - {{岗位}}

## A. 岗位面试画像
- 这个岗位最可能考察的能力
- Boss 直聘沟通/面试阶段可能先确认的信息
- 当前材料里的主要优势和风险

## B. 高概率问题
按下面三类分组，每类 4-6 个问题。问题必须标注来源：
- HR/招聘沟通问题
- 项目/经历追问
- 技术/岗位能力问题
来源只能是：[基于JD推断]、[来自精评报告]、[来自故事库]。

## C. 故事库匹配
用表格输出：问题/能力点 | 推荐故事 | 为什么匹配 | 需要调整的角度 | 风险。
如果 story-bank.md 里没有合适故事，可从 cv.md 中指出“可发展为故事的经历”，但必须标注“待用户确认”。

## D. 缺失故事
列出 3-6 个当前还缺的 STAR+R 故事主题。每个主题给出：
- 为什么这个岗位可能会问
- 可以从哪些已有项目/经历里挖
- 需要用户补充的事实

## E. 技术与项目准备清单
输出最多 10 条 checklist，每条说明为什么重要、该复习到什么程度。

## F. 15 分钟面试前速览
- 一句话定位
- 最该讲的 3 个证据
- 最容易被追问的 3 个风险
- 可以反问面试官的 3 个问题

## G. 后续功能待补充
列出“联网公司调研”和“模拟面试”后续应该补齐的信息，但不要假装已经完成。

岗位信息：
```text
{_job_text(job)}
```

岗位精评报告：
```markdown
{report_text or "暂无岗位精评报告。"}
```

岗位定制简历草稿：
```markdown
{resume_draft_text or "暂无岗位定制简历草稿。"}
```

故事库 story-bank.md：
```markdown
{story_bank or "暂无故事库内容。"}
```

候选人 cv.md：
```markdown
{cv_text or "cv.md not found"}
```

profile.yml：
```yaml
{profile_text or "profile.yml not found"}
```

用户备注：
```text
{user_notes or "无"}
```
"""
    system += """

Evidence rules:
- Confirmed professional evidence is reusable across jobs. Use only the evidence IDs supplied below to support interview-ready experience, follow-up questions, and revision priorities; cite an evidence ID where useful.
- Source-verified resume facts may be used as objective facts only. Do not invent an evidence ID or expand one into a project experience.
- Pending requirements may only appear as follow-up questions, risks, or facts the user needs to supply. Never present them as completed candidate experience, metrics, or STAR stories.
- In the generated Markdown, attach `【证据：ev-...】` to every recommended answer angle, story match, or review point that relies on confirmed professional evidence. Use `【简历直接核验】` for source-verified resume facts and `【待补充】` for pending requirements. Do not cite an ID that is not supplied below.
"""
    user += f"""

Confirmed professional evidence (reusable across jobs):
```json
{json.dumps(evidence_context.get("confirmedEvidence", []), ensure_ascii=False, indent=2)}
```

Source-verified resume facts:
```json
{json.dumps(evidence_context.get("sourceVerifiedRequirements", []), ensure_ascii=False, indent=2)}
```

Pending requirements (only use as follow-up questions or missing facts):
```json
{json.dumps(evidence_context.get("pendingRequirements", []), ensure_ascii=False, indent=2)}
```
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def generate_interview_prep(source_key: str, user_notes: str = "") -> dict[str, Any]:
    item, job = _load_pipeline_job(source_key)
    _ensure_story_bank()
    story_bank = STORY_BANK_PATH.read_text(encoding="utf-8")
    report_text = _safe_read_markdown(str(item.get("reportPath") or ""), REPORTS_DIR, 15000)
    resume_draft_text = _safe_read_markdown(str(item.get("resumeDraftPath") or ""), RESUME_OUTPUT_DIR, 16000)
    evidence_context = _interview_evidence_context(source_key)
    content = _call_llm(_prompt(job, item, story_bank, report_text, resume_draft_text, evidence_context, user_notes))

    prep_id = _next_interview_id()
    now = dt.datetime.now()
    filename = (
        f"{prep_id}-{_slug(job.get('company'))}-{_slug(job.get('title'))}-"
        f"interview-prep-{now.strftime('%Y-%m-%d')}.md"
    )
    prep_path = INTERVIEW_OUTPUT_DIR / filename
    INTERVIEW_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    prep_path.write_text(content, encoding="utf-8")

    meta = {
        "interviewPrepId": prep_id,
        "sourceKey": source_key,
        "generatedAt": now.isoformat(),
        "job": job,
        "pipelineItem": item,
        "prepPath": str(prep_path),
        "storyBankPath": str(STORY_BANK_PATH),
        "userNotes": user_notes,
        "evidenceBindingVersion": 1,
        "evidenceContext": evidence_context,
    }
    json_path = prep_path.with_suffix(".json")
    json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    update_pipeline_item_metadata(
        source_key,
        {
            "interviewPrepId": prep_id,
            "interviewPrepPath": str(prep_path),
            "interviewPrepJsonPath": str(json_path),
            "interviewPreparedAt": now.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    return {
        "ok": True,
        "sourceKey": source_key,
        "interviewPrepId": prep_id,
        "prepPath": str(prep_path),
        "jsonPath": str(json_path),
        "content": content,
        "evidenceBindingVersion": 1,
        "evidenceContext": evidence_context,
        "pipeline": read_pipeline(),
    }


def save_agent_interview_prep(source_key: str, content: str, user_notes: str = "") -> dict[str, Any]:
    """Persist interview preparation authored by the connected Agent without a BossFlow LLM call."""
    item, job = _load_pipeline_job(source_key)
    normalized = str(content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="Interview preparation content cannot be empty")
    evidence_context = _interview_evidence_context(source_key)
    prep_id = _next_interview_id()
    now = dt.datetime.now()
    filename = (
        f"{prep_id}-{_slug(job.get('company'))}-{_slug(job.get('title'))}-"
        f"interview-prep-{now.strftime('%Y-%m-%d')}.md"
    )
    prep_path = INTERVIEW_OUTPUT_DIR / filename
    INTERVIEW_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    prep_path.write_text(normalized + "\n", encoding="utf-8")
    meta = {
        "interviewPrepId": prep_id,
        "sourceKey": source_key,
        "generatedAt": now.isoformat(),
        "generationMode": "connected_agent",
        "job": job,
        "pipelineItem": item,
        "prepPath": str(prep_path),
        "storyBankPath": str(STORY_BANK_PATH),
        "userNotes": user_notes,
        "evidenceBindingVersion": 1,
        "evidenceContext": evidence_context,
    }
    json_path = prep_path.with_suffix(".json")
    json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    update_pipeline_item_metadata(
        source_key,
        {
            "interviewPrepId": prep_id,
            "interviewPrepPath": str(prep_path),
            "interviewPrepJsonPath": str(json_path),
            "interviewPreparedAt": now.strftime("%Y-%m-%d %H:%M:%S"),
            "interviewPrepGenerationMode": "connected_agent",
        },
    )
    return {
        "ok": True,
        "sourceKey": source_key,
        "interviewPrepId": prep_id,
        "prepPath": str(prep_path),
        "jsonPath": str(json_path),
        "content": normalized + "\n",
        "generationMode": "connected_agent",
        "evidenceBindingVersion": 1,
        "evidenceContext": evidence_context,
        "pipeline": read_pipeline(),
    }


def read_interview_prep(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    path = _safe_interview_prep_path(str(item.get("interviewPrepPath") or ""))
    meta = _load_interview_prep_json(path)
    evidence_context = meta.get("evidenceContext")
    if not isinstance(evidence_context, dict):
        evidence_context = _interview_evidence_context(source_key)
    return {
        "ok": True,
        "sourceKey": source_key,
        "interviewPrepId": item.get("interviewPrepId", ""),
        "prepPath": str(path),
        "jsonPath": str(path.with_suffix(".json")),
        "content": path.read_text(encoding="utf-8"),
        "evidenceBindingVersion": int(meta.get("evidenceBindingVersion") or 0),
        "evidenceContext": evidence_context,
    }
