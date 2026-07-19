from __future__ import annotations

import datetime as dt
import difflib
import hashlib
import json
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from backend.schemas.config import CrawlRequest
from backend.schemas.cv import CapabilityDecisionRequest, ResumeCapabilityImportSelection
from backend.schemas.evidence import EvidenceCoverageClassifyRequest, EvidenceItemCreateRequest, EvidenceTaskUpdateRequest
from backend.schemas.interview import InterviewStoryDraftPayload
from backend.services.agent_audit_service import record_agent_action
from backend.services.agent_confirmation_service import AgentConfirmationService
from backend.services.crawler_service import start_crawl_task
from backend.services.cv_service import read_cv_document, save_cv_document
from backend.services.evidence_service import (
    apply_resume_capability_import,
    classify_capability,
    classify_coverage,
    confirm_evidence_item,
    create_evidence_item,
    list_capabilities,
    list_evidence_tasks,
    list_requirements,
    preview_resume_capability_import as build_resume_capability_import_preview,
    read_evidence_overview,
    update_evidence_task,
)
from backend.services.interview_service import (
    generate_interview_prep,
    promote_story_draft,
    read_interview_prep,
    read_story_bank,
    read_story_drafts,
    save_agent_interview_prep,
    save_story_drafts,
)
from backend.services.job_service import get_job_by_id, get_jobs_by_ids, query_jobs
from backend.services.llm_evaluation_service import llm_evaluate_pipeline_item
from backend.services.pipeline_service import (
    DECISION_STATUSES,
    add_jobs_to_pipeline,
    read_pipeline,
    read_pipeline_report,
    update_pipeline_item_status,
)
from backend.services.project_service import (
    config_payload,
    default_project_name,
    project_names,
    resolve_project,
    stats_for_project,
)
from backend.services.resume_service import (
    generate_resume_suggestions,
    list_resume_items,
    read_resume_draft,
    read_resume_suggestion,
    save_agent_resume_suggestions as persist_agent_resume_suggestions,
    save_resume_draft,
)
from backend.services.login_state_service import login_state
from backend.services.task_service import TaskManager
from backend.services.workspace_service import project_from_source_key, project_workspace
from crawler.boss import load_config


T = TypeVar("T")

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
SAFE_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)


def _json_resource(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


_DETAIL_LEVELS = {"summary", "full"}
_CONTENT_MODES = {"path", "full"}


def _validated_detail_level(detail_level: str) -> str:
    normalized = str(detail_level or "summary").strip().lower()
    if normalized not in _DETAIL_LEVELS:
        raise HTTPException(status_code=400, detail="detail_level 仅支持 summary 或 full")
    return normalized


def _validated_content_mode(content_mode: str) -> str:
    normalized = str(content_mode or "path").strip().lower()
    if normalized not in _CONTENT_MODES:
        raise HTTPException(status_code=400, detail="content_mode 仅支持 path 或 full")
    return normalized


def _normalized_markdown(content: str) -> str:
    normalized = str(content or "").replace("\r\n", "\n").replace("\r", "\n")
    if normalized and not normalized.endswith("\n"):
        normalized += "\n"
    return normalized


def _content_revision(content: str) -> str:
    return hashlib.sha256(str(content or "").encode("utf-8")).hexdigest()[:16]


def _file_metadata(path_value: str) -> dict[str, Any]:
    if not path_value:
        return {"path": "", "exists": False}
    path = Path(path_value)
    result: dict[str, Any] = {"path": str(path), "exists": path.exists() and path.is_file()}
    if result["exists"]:
        stat = path.stat()
        result.update({
            "sizeBytes": stat.st_size,
            "updatedAt": dt.datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        })
    return result


def _artifact_view(
    payload: dict[str, Any],
    path_field: str,
    content_mode: str,
    *,
    extra_fields: tuple[str, ...] = (),
) -> dict[str, Any]:
    content = str(payload.get("content") or "")
    result = {
        **_selected(payload, extra_fields),
        **_file_metadata(str(payload.get(path_field) or "")),
        "revision": _content_revision(content),
        "characterCount": len(content),
        "contentMode": content_mode,
    }
    if content_mode == "full":
        result["content"] = content
    return result


def _change_preview(before: str, after: str, *, limit: int = 8000) -> dict[str, Any]:
    diff = "\n".join(difflib.unified_diff(
        before.splitlines(),
        after.splitlines(),
        fromfile="当前版本",
        tofile="拟保存版本",
        lineterm="",
    ))
    return {
        "beforeCharacterCount": len(before),
        "afterCharacterCount": len(after),
        "diff": diff[:limit],
        "diffTruncated": len(diff) > limit,
    }


def _page(items: list[dict[str, Any]], offset: int, limit: int, *, max_limit: int = 200) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    normalized_offset = int(offset or 0)
    normalized_limit = int(limit or 20)
    if normalized_offset < 0:
        raise HTTPException(status_code=400, detail="offset 不能小于 0")
    if not 1 <= normalized_limit <= max_limit:
        raise HTTPException(status_code=400, detail=f"limit 必须在 1 到 {max_limit} 之间")
    page = items[normalized_offset:normalized_offset + normalized_limit]
    next_offset = normalized_offset + len(page)
    has_more = next_offset < len(items)
    return page, {
        "offset": normalized_offset,
        "limit": normalized_limit,
        "returned": len(page),
        "total": len(items),
        "hasMore": has_more,
        "nextOffset": next_offset if has_more else None,
    }


def _selected(item: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {field: item[field] for field in fields if field in item}


def _compact_job(item: dict[str, Any]) -> dict[str, Any]:
    return _selected(item, (
        "id", "title", "company", "city", "salary", "avg", "tier", "exp", "edu", "cats",
        "url", "firstSeen", "lastSeen", "score", "fitLevel", "coverage", "jdQuality",
        "experienceRisk", "educationRisk", "recruitmentObservationStatus",
    ))


def _compact_pipeline_item(item: dict[str, Any]) -> dict[str, Any]:
    return _selected(item, (
        "status", "company", "title", "city", "salary", "url", "project", "jobId", "sourceKey",
        "avg", "addedAt", "score", "fitLevel", "coverage", "experienceRisk", "educationRisk",
        "decisionStatus", "llmScore", "llmFitLevel", "llmRecommendation", "evaluatedAt",
        "requirementCount", "supportedRequirementCount", "potentialEvidenceRequirementCount",
        "unresolvedRequirementCount", "blockingGapCount", "greetingReady",
        "resumeSuggestionId", "resumeDraftId", "interviewPrepId",
    ))


def _compact_capability(item: dict[str, Any]) -> dict[str, Any]:
    return _selected(item, (
        "capabilityId", "canonicalKey", "label", "category", "actionability", "status",
        "proficiencyApplicable", "userProficiency", "highestRequiredProficiency",
        "impactTier", "jobCount", "requiredCount", "preferredCount", "evidenceCount",
        "sourceCount", "proofStatus", "origin", "userConfirmedAt",
    ))


def _compact_requirement(item: dict[str, Any]) -> dict[str, Any]:
    return _selected(item, (
        "requirementId", "canonicalKey", "capabilityName", "label", "category", "importance",
        "sourceKey", "requiredProficiency", "proficiencyApplicable", "verificationMode",
        "requirementGroupMode", "requirementGroupId", "requirementGroupLabel", "minimumSatisfied",
        "active",
    ))


def _compact_evidence_item(item: dict[str, Any]) -> dict[str, Any]:
    compact = _selected(item, (
        "evidenceId", "title", "evidenceType", "summary", "status", "capabilityIds",
        "requirementIds", "tags", "createdAt", "confirmedAt",
    ))
    compact["sourceCount"] = len(item.get("sourceRefs") or [])
    return compact


def _compact_task(item: dict[str, Any]) -> dict[str, Any]:
    return _selected(item, (
        "taskId", "title", "taskType", "status", "priority", "requirementId", "capabilityId",
        "affectedSourceKeys", "currentProficiency", "targetProficiency", "nextStep",
        "progressPercent", "createdAt", "updatedAt",
    ))


def _compact_story(item: dict[str, Any]) -> dict[str, Any]:
    return _selected(item, (
        "storyId", "draftId", "title", "status", "source", "sourceLabel", "tags",
        "createdAt", "updatedAt", "confirmedAt",
    ))


def _compact_import_proposal(item: dict[str, Any]) -> dict[str, Any]:
    compact = _selected(item, (
        "proposalId", "canonicalKey", "capabilityId", "label", "category",
        "proficiencyApplicable", "userProficiency", "confidence", "sourceRefs",
        "action", "selected",
    ))
    existing = item.get("existingCapability")
    if isinstance(existing, dict):
        compact["existingCapability"] = _selected(existing, (
            "capabilityId", "canonicalKey", "label", "category", "status",
            "userProficiency", "proofStatus", "jobCount", "evidenceCount",
        ))
    else:
        compact["existingCapability"] = None
    return compact


_confirmations = AgentConfirmationService()


def _confirmation_preview(action: str, target: str, payload: Any, **details: Any) -> dict[str, Any]:
    ticket = _confirmations.issue(action, target, payload)
    return {
        "ok": False,
        "requiresConfirmation": True,
        "action": action,
        "target": target,
        "details": details,
        **ticket,
        "nextStep": (
            "把这份完整预览展示给用户，并明确询问是否执行。"
            "只有用户在后续消息中明确同意后，才能保持其他参数不变并携带 confirmation_id 再次调用；"
            "不得在生成预览的同一轮中自动确认。"
        ),
    }


def _require_confirmation(confirmation_id: str, action: str, target: str, payload: Any) -> None:
    _confirmations.consume(confirmation_id, action, target, payload)


def _crawl_payload(project: str) -> CrawlRequest:
    payload = config_payload(resolve_project(project))
    return CrawlRequest(
        project=project,
        keywordsText=payload["keywordsText"],
        citiesText=payload["citiesText"],
        newJobTarget=payload["newJobTarget"],
        maxJobs=payload["maxJobs"],
        minSalary=payload["minSalary"],
        headlessMode=payload["headlessMode"],
        autoSqlite=payload["autoSqlite"],
        catRulesText=payload["catRulesText"],
        scoringRulesText=payload["scoringRulesText"],
        relevanceText=payload["relevanceText"],
        blacklistText=payload["blacklistText"],
    )


def create_bossflow_mcp(task_manager: TaskManager) -> FastMCP:
    """创建供 HTTP 与 stdio 桥接共用的 BossFlow MCP 服务。"""
    mcp = FastMCP(
        "BossFlow",
        instructions=(
            "你正在操作用户本地的 BossFlow 求职工作区，默认使用中文解释结果。"
            "执行任务前先读取必要上下文，并优先使用 summary、筛选和分页参数；"
            "不要一次读取整个工作区，也不要逐条批量调用详情工具。"
            "search_jobs 用于搜索全部已采集岗位，get_pipeline 用于读取候选岗位，"
            "get_job 仅用于读取用户关注的单个岗位详情。"
            "分析岗位要求时必须保留 any_of 关系，同一任意满足组中的能力不得分别计算为多个必备缺口。"
            "所有写入、采集及付费生成工具第一次调用都只能生成短期确认预览；"
            "只有用户在后续消息中明确同意，才能使用原样参数和 confirmation_id 执行。"
            "不得编造用户经历、能力、学历或项目事实，也不得绕过 BossFlow 的统一采集队列。"
        ),
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
    )
    write_lock = threading.RLock()

    def audited_write(tool: str, target: str, operation: Callable[[], T]) -> T:
        record_agent_action(tool, "started", target=target)
        try:
            with write_lock:
                result = operation()
        except Exception as error:
            record_agent_action(tool, "failed", target=target, details={"error": str(error)[:500]})
            raise
        record_agent_action(tool, "succeeded", target=target)
        return result

    @mcp.tool(annotations=READ_ONLY)
    def list_projects() -> dict[str, Any]:
        """列出 BossFlow 的求职目标，并标记默认目标；当用户没有明确目标时应先调用本工具。"""
        names = project_names()
        return {"projects": names, "defaultProject": default_project_name() if names else ""}

    @mcp.tool(annotations=READ_ONLY)
    def get_project_summary(project: str) -> dict[str, Any]:
        """读取一个求职目标的采集关键词、城市、岗位/候选/能力数量等紧凑概览；适合作为后续操作的入口。"""
        project_dir = resolve_project(project)
        config = load_config(str(project_dir))
        with project_workspace(project):
            pipeline = read_pipeline()
            evidence = read_evidence_overview()
        return {
            "project": project,
            "stats": stats_for_project(project_dir, config),
            "keywords": list(config.get("keywords") or []),
            "cities": list((config.get("cities") or {}).keys()),
            "pipelineCounts": pipeline["counts"],
            "evidenceSummary": evidence.get("summary", {}),
        }

    @mcp.tool(annotations=READ_ONLY)
    def search_jobs(
        project: str,
        query: str = "",
        cities: list[str] | None = None,
        tiers: list[str] | None = None,
        categories: list[str] | None = None,
        min_salary_k: float | None = None,
        max_salary_k: float | None = None,
        min_score: float | None = None,
        fit_levels: list[str] | None = None,
        experience_risks: list[str] | None = None,
        education_risks: list[str] | None = None,
        recruitment_statuses: list[str] | None = None,
        seen_since: str = "",
        scored_only: bool = False,
        sort_by: str = "salary_desc",
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """搜索全部已采集岗位并分页返回；默认仅返回列表摘要，选中具体岗位后再用 get_job 读取完整 JD。"""
        normalized_detail = _validated_detail_level(detail_level)
        if not 1 <= limit <= 200:
            raise HTTPException(status_code=400, detail="limit 必须在 1 到 200 之间")
        if offset < 0:
            raise HTTPException(status_code=400, detail="offset 不能小于 0")
        if sort_by not in {"salary_desc", "score_desc", "newest"}:
            raise HTTPException(status_code=400, detail="sort_by 仅支持 salary_desc、score_desc 或 newest")
        project_dir = resolve_project(project)
        with project_workspace(project):
            result = query_jobs(
                project_dir,
                query.strip(),
                limit,
                offset,
                cities=cities,
                tiers=tiers,
                categories=categories,
                min_avg=min_salary_k,
                max_avg=max_salary_k,
                min_score=min_score,
                fit_levels=fit_levels,
                experience_risks=experience_risks,
                education_risks=education_risks,
                recruitment_statuses=recruitment_statuses,
                seen_since=seen_since,
                scored_only=scored_only,
                sort_by=sort_by,
            )
        if normalized_detail == "summary":
            result["items"] = [_compact_job(item) for item in result.get("items", [])]
        next_offset = int(result.get("offset") or 0) + len(result.get("items") or [])
        result.update({
            "detailLevel": normalized_detail,
            "returned": len(result.get("items") or []),
            "hasMore": next_offset < int(result.get("total") or 0),
            "nextOffset": next_offset if next_offset < int(result.get("total") or 0) else None,
        })
        return result

    @mcp.tool(annotations=READ_ONLY)
    def get_job(project: str, job_id: int) -> dict[str, Any]:
        """按岗位 ID 读取一个已采集岗位的完整详情；job_id 应先从 search_jobs 获取，列表场景不要批量调用。"""
        project_dir = resolve_project(project)
        with project_workspace(project):
            return get_job_by_id(project_dir, job_id)

    @mcp.tool(annotations=READ_ONLY)
    def get_pipeline(
        project: str,
        decision_status: str = "",
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """分页读取已加入候选流程的岗位及处理状态；它不搜索完整岗位库，搜索请使用 search_jobs。"""
        normalized_detail = _validated_detail_level(detail_level)
        if not 1 <= limit <= 200:
            raise HTTPException(status_code=400, detail="limit 必须在 1 到 200 之间")
        if offset < 0:
            raise HTTPException(status_code=400, detail="offset 不能小于 0")
        if decision_status and decision_status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail=f"不支持的候选状态：{decision_status}")
        with project_workspace(project):
            pipeline = read_pipeline()
        pending = pipeline["pending"]
        processed = pipeline["processed"]
        if decision_status:
            pending = [item for item in pending if item.get("decisionStatus") == decision_status]
            processed = [item for item in processed if item.get("decisionStatus") == decision_status]
        pending_page, pending_pagination = _page(pending, offset, limit)
        processed_page, processed_pagination = _page(processed, offset, limit)
        if normalized_detail == "summary":
            pending_page = [_compact_pipeline_item(item) for item in pending_page]
            processed_page = [_compact_pipeline_item(item) for item in processed_page]
        return {
            "path": pipeline.get("path", ""),
            "schemaVersion": pipeline.get("schemaVersion"),
            "counts": {"pending": len(pending), "processed": len(processed)},
            "pending": pending_page,
            "processed": processed_page,
            "returned": {
                "pending": pending_pagination["returned"],
                "processed": processed_pagination["returned"],
            },
            "pagination": {"pending": pending_pagination, "processed": processed_pagination},
            "detailLevel": normalized_detail,
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_task_status() -> dict[str, Any]:
        """读取当前采集队列状态与最近 50 条日志；用于启动采集后轮询进度，禁止据此绕过统一队列。"""
        snapshot = task_manager.snapshot()
        return {**snapshot, "logs": snapshot.get("logs", [])[-50:]}

    @mcp.tool(annotations=READ_ONLY)
    def get_evidence(
        project: str,
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """读取能力档案概览；默认只返回统计和分页摘要，完整原始集合仅在明确需要时使用 full。"""
        normalized_detail = _validated_detail_level(detail_level)
        with project_workspace(project):
            overview = read_evidence_overview()
        if normalized_detail == "full":
            return {**overview, "detailLevel": "full"}
        capabilities, capability_page = _page(overview.get("capabilities", []), offset, limit)
        evidence_items, evidence_page = _page(overview.get("evidenceItems", []), offset, limit)
        tasks, task_page = _page(overview.get("tasks", []), offset, limit)
        constraints, constraint_page = _page(overview.get("constraints", []), offset, limit)
        return {
            "ok": True,
            "schemaVersion": overview.get("schemaVersion"),
            "updatedAt": overview.get("updatedAt", ""),
            "detailLevel": "summary",
            "counts": overview.get("counts", {}),
            "capabilityCounts": overview.get("capabilityCounts", {}),
            "capabilities": [_compact_capability(item) for item in capabilities],
            "evidenceItems": [_compact_evidence_item(item) for item in evidence_items],
            "tasks": [_compact_task(item) for item in tasks],
            "constraints": [_compact_requirement(item) for item in constraints],
            "pagination": {
                "capabilities": capability_page,
                "evidenceItems": evidence_page,
                "tasks": task_page,
                "constraints": constraint_page,
            },
            "guidance": "岗位要求请使用 get_requirement_groups；单项能力完整依据请使用 get_capability。",
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_capabilities(
        project: str,
        status: str = "",
        category: str = "",
        source_key: str = "",
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """分页读取归一化能力卡片；默认返回影响范围和状态摘要，查看单项完整要求/依据请使用 get_capability。"""
        normalized_detail = _validated_detail_level(detail_level)
        with project_workspace(project):
            payload = list_capabilities(status, category, source_key, 500)
        page, pagination = _page(payload.get("capabilities", []), offset, limit)
        if normalized_detail == "summary":
            page = [_compact_capability(item) for item in page]
        return {
            "ok": True,
            "capabilities": page,
            "returned": pagination["returned"],
            "total": payload.get("total", pagination["total"]),
            "pagination": pagination,
            "detailLevel": normalized_detail,
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_capability(project: str, capability_id: str) -> dict[str, Any]:
        """按 capability_id 读取一项归一化能力的完整要求来源、依据和提升计划关联；ID 来自 get_capabilities。"""
        with project_workspace(project):
            payload = list_capabilities(limit=500)
        capability = next(
            (item for item in payload.get("capabilities", []) if str(item.get("capabilityId") or "") == capability_id),
            None,
        )
        if not capability:
            raise HTTPException(status_code=404, detail=f"未找到能力：{capability_id}")
        return {"ok": True, "capability": capability}

    @mcp.tool(annotations=READ_ONLY)
    def get_requirement_groups(
        project: str,
        source_key: str = "",
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """分页读取岗位的有效要求组并保留 any_of 替代关系；分析具体候选岗位时应传入 source_key。"""
        normalized_detail = _validated_detail_level(detail_level)
        with project_workspace(project):
            payload = list_requirements(source_key)
        grouped: dict[str, dict[str, Any]] = {}
        for requirement in payload.get("requirements", []):
            is_any = (
                requirement.get("requirementGroupMode") == "any_of"
                and requirement.get("requirementGroupId")
            )
            group_id = (
                str(requirement.get("requirementGroupId"))
                if is_any
                else f"single:{requirement.get('requirementId')}"
            )
            group = grouped.setdefault(group_id, {
                "groupId": group_id,
                "mode": "any_of" if is_any else "all_of",
                "label": (
                    requirement.get("requirementGroupLabel")
                    if is_any
                    else requirement.get("label")
                ),
                "minimumSatisfied": int(requirement.get("minimumSatisfied") or 1),
                "requirements": [],
            })
            group["requirements"].append(requirement)
        groups = list(grouped.values())
        page, pagination = _page(groups, offset, limit)
        if normalized_detail == "summary":
            page = [
                {
                    **{key: value for key, value in group.items() if key != "requirements"},
                    "requirements": [_compact_requirement(item) for item in group["requirements"]],
                }
                for group in page
            ]
        return {
            "ok": True,
            "sourceKey": source_key,
            "groups": page,
            "pagination": pagination,
            "detailLevel": normalized_detail,
            "guidance": "any_of 组只需达到 minimumSatisfied，不得把未选择的替代项分别计算为多个必备缺口。",
        }

    @mcp.tool(annotations=READ_ONLY)
    def preview_resume_capability_import(
        project: str,
        limit: int = 50,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """只读分析基础简历中的原子能力，标记新增、合并、已同步或待判断；确认后才可调用导入工具。"""
        normalized_detail = _validated_detail_level(detail_level)
        with project_workspace(project):
            document = read_cv_document()
            payload = build_resume_capability_import_preview(document.get("content", ""))
        proposals, pagination = _page(payload.get("proposals", []), offset, limit)
        if normalized_detail == "summary":
            proposals = [_compact_import_proposal(item) for item in proposals]
        return {
            **{key: value for key, value in payload.items() if key != "proposals"},
            "proposals": proposals,
            "pagination": pagination,
            "detailLevel": normalized_detail,
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_login_state(project: str) -> dict[str, Any]:
        """检查求职目标保存的 BOSS Cookie 是否存在、是否过期及是否建议刷新；采集前应先调用。"""
        return login_state(project)

    @mcp.tool(annotations=READ_ONLY)
    def get_evidence_requirements(
        project: str,
        source_key: str = "",
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """分页读取精评提取的原子岗位要求；判断实际缺口时优先使用保留 any_of 的 get_requirement_groups。"""
        normalized_detail = _validated_detail_level(detail_level)
        with project_workspace(project):
            payload = list_requirements(source_key)
        requirements, pagination = _page(payload.get("requirements", []), offset, limit)
        if normalized_detail == "summary":
            requirements = [_compact_requirement(item) for item in requirements]
        return {
            "ok": True,
            "schemaVersion": payload.get("schemaVersion"),
            "sourceKey": source_key,
            "requirements": requirements,
            "pagination": pagination,
            "detailLevel": normalized_detail,
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_evidence_tasks(
        project: str,
        status: str = "",
        source_key: str = "",
        limit: int = 20,
        offset: int = 0,
        detail_level: str = "summary",
    ) -> dict[str, Any]:
        """分页读取能力补充或提升任务，可按状态及候选岗位 source_key 筛选。"""
        normalized_detail = _validated_detail_level(detail_level)
        with project_workspace(project):
            payload = list_evidence_tasks(status, source_key)
        tasks, pagination = _page(payload.get("tasks", []), offset, limit)
        if normalized_detail == "summary":
            tasks = [_compact_task(item) for item in tasks]
        return {
            "ok": True,
            "schemaVersion": payload.get("schemaVersion"),
            "tasks": tasks,
            "pagination": pagination,
            "detailLevel": normalized_detail,
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_application_context(source_key: str, detail_level: str = "summary") -> dict[str, Any]:
        """读取一个候选岗位的定制简历/面试准备上下文；默认返回摘要，生成材料时使用 full 获取岗位相关的完整依据。"""
        normalized_detail = _validated_detail_level(detail_level)
        project = project_from_source_key(source_key)
        try:
            job_id = int(source_key.rsplit(":", 1)[1])
        except (IndexError, ValueError) as error:
            raise HTTPException(status_code=400, detail="source_key 必须以数字岗位 ID 结尾") from error
        project_dir = resolve_project(project)
        with project_workspace(project):
            pipeline = read_pipeline()
            item = next(
                (entry for entry in [*pipeline["pending"], *pipeline["processed"]] if entry.get("sourceKey") == source_key),
                None,
            )
            if not item:
                raise HTTPException(status_code=404, detail=f"未找到候选岗位：{source_key}")
            report: dict[str, Any] | None
            try:
                report = read_pipeline_report(source_key)
            except HTTPException:
                report = None
            def optional_read(reader: Callable[[str], dict[str, Any]]) -> dict[str, Any] | None:
                try:
                    return reader(source_key)
                except HTTPException:
                    return None
            overview = read_evidence_overview()
            requirements = [
                requirement
                for requirement in overview.get("requirements", [])
                if requirement.get("sourceKey") == source_key
            ]
            requirement_ids = {
                str(requirement.get("requirementId") or "")
                for requirement in requirements
                if requirement.get("requirementId")
            }
            capabilities = [
                capability
                for capability in overview.get("capabilities", [])
                if source_key in (capability.get("sourceKeys") or [])
                or requirement_ids.intersection(str(value) for value in capability.get("requirementIds") or [])
            ]
            capability_ids = {
                str(capability.get("capabilityId") or "")
                for capability in capabilities
                if capability.get("capabilityId")
            }
            evidence_items = [
                evidence
                for evidence in overview.get("evidenceItems", [])
                if requirement_ids.intersection(str(value) for value in evidence.get("requirementIds") or [])
                or capability_ids.intersection(str(value) for value in evidence.get("capabilityIds") or [])
            ]
            tasks = [
                task
                for task in overview.get("tasks", [])
                if source_key in (task.get("affectedSourceKeys") or [])
                or str(task.get("requirementId") or "") in requirement_ids
                or str(task.get("capabilityId") or "") in capability_ids
            ]
            coverages = [
                coverage
                for coverage in overview.get("coverages", [])
                if str(coverage.get("requirementId") or "") in requirement_ids
            ]
            cv = read_cv_document()
            story_bank = read_story_bank()
            story_drafts = read_story_drafts()
            resume_suggestion = optional_read(read_resume_suggestion)
            resume_draft = optional_read(read_resume_draft)
            interview_prep = optional_read(read_interview_prep)

            if normalized_detail == "full":
                evidence_context = {
                    "counts": {
                        "requirements": len(requirements),
                        "capabilities": len(capabilities),
                        "evidenceItems": len(evidence_items),
                        "tasks": len(tasks),
                    },
                    "requirements": requirements,
                    "coverages": coverages,
                    "capabilities": capabilities,
                    "evidenceItems": evidence_items,
                    "tasks": tasks,
                }
                stories_context = {
                    "storyBank": story_bank,
                    "storyDrafts": story_drafts,
                }
                cv_context = cv
                pipeline_context = item
                report_context = report
                artifact_context = {
                    "resumeSuggestion": resume_suggestion,
                    "resumeDraft": resume_draft,
                    "interviewPrep": interview_prep,
                }
            else:
                evidence_context = {
                    "counts": {
                        "requirements": len(requirements),
                        "capabilities": len(capabilities),
                        "evidenceItems": len(evidence_items),
                        "tasks": len(tasks),
                    },
                    "requirements": [_compact_requirement(value) for value in requirements],
                    "coverages": [
                        _selected(value, (
                            "requirementId", "coverageStatus", "assessmentStatus", "verificationStatus",
                            "userClassification", "userProficiency", "evidenceIds", "decisionSource",
                        ))
                        for value in coverages
                    ],
                    "capabilities": [_compact_capability(value) for value in capabilities],
                    "evidenceItems": [_compact_evidence_item(value) for value in evidence_items],
                    "tasks": [_compact_task(value) for value in tasks],
                }
                stories_context = {
                    "storyBank": {
                        "count": len(story_bank.get("stories", [])),
                        "stories": [_compact_story(value) for value in story_bank.get("stories", [])],
                    },
                    "storyDrafts": {
                        "count": len(story_drafts.get("drafts", [])),
                        "drafts": [_compact_story(value) for value in story_drafts.get("drafts", [])],
                    },
                }
                cv_context = {
                    **_selected(cv, ("ok", "path", "format", "updatedAt")),
                    "characterCount": len(str(cv.get("content") or "")),
                }
                pipeline_context = _compact_pipeline_item(item)
                report_context = (
                    _selected(report, (
                        "reportId", "sourceKey", "score", "fitLevel", "recommendation",
                        "summary", "generatedAt", "reportPath",
                    ))
                    if isinstance(report, dict)
                    else None
                )
                artifact_context = {
                    "resumeSuggestion": _selected(resume_suggestion, (
                        "resumeSuggestionId", "sourceKey", "suggestionPath", "jsonPath",
                    )) if isinstance(resume_suggestion, dict) else None,
                    "resumeDraft": _selected(resume_draft, (
                        "resumeDraftId", "sourceKey", "draftPath", "jsonPath",
                    )) if isinstance(resume_draft, dict) else None,
                    "interviewPrep": _selected(interview_prep, (
                        "interviewPrepId", "sourceKey", "generatedAt", "path",
                    )) if isinstance(interview_prep, dict) else None,
                }

            return {
                "sourceKey": source_key,
                "job": get_job_by_id(project_dir, job_id),
                "pipelineItem": pipeline_context,
                "fineReview": report_context,
                "cv": cv_context,
                "evidence": evidence_context,
                **stories_context,
                **artifact_context,
                "detailLevel": normalized_detail,
                "guidance": (
                    "summary 适合判断下一步；生成定制简历或面试材料前，请显式使用 detail_level=full。"
                    if normalized_detail == "summary"
                    else "full 仍只包含与当前岗位相关的能力、要求、依据和任务，不包含无关岗位的整个能力库。"
                ),
            }

    @mcp.tool(annotations=READ_ONLY)
    def get_base_resume(project: str, content_mode: str = "path") -> dict[str, Any]:
        """定位并查看个人基础简历；默认仅返回本机文件路径、修改时间和版本号，本地 Agent 需要正文时应自行读取文件，无法访问文件系统时可改用 content_mode=full。"""
        normalized_mode = _validated_content_mode(content_mode)
        with project_workspace(project):
            document = read_cv_document()
        content = str(document.get("content") or "")
        result = {
            **_selected(document, (
                "ok", "exists", "examplePath", "isEmpty", "checks", "missing",
                "readyForScoring", "readyForMaterials", "canCreateFromTemplate",
            )),
            **_file_metadata(str(document.get("path") or "")),
            "revision": _content_revision(content),
            "characterCount": len(content),
            "contentMode": normalized_mode,
            "guidance": (
                "这是用户的本机 Markdown 文件。优先按 path 读取；修改后应调用 update_base_resume，"
                "不要直接覆盖文件，以保留人工确认和版本冲突保护。"
            ),
        }
        if normalized_mode == "full":
            result["content"] = content
        return result

    @mcp.tool(annotations=READ_ONLY)
    def list_tailored_resumes(project: str, offset: int = 0, limit: int = 20) -> dict[str, Any]:
        """分页列出已生成简历建议或岗位定制简历的候选岗位；用于先找到准确的 sourceKey 和本机文件位置，不返回大段正文。"""
        with project_workspace(project):
            payload = list_resume_items()
        items, pagination = _page(payload.get("items", []), offset, limit)
        compact_items = []
        for item in items:
            compact_items.append({
                **_selected(item, (
                    "sourceKey", "company", "title", "city", "salary", "project", "jobId",
                    "llmScore", "llmFitLevel", "decisionStatus", "resumeSuggestionId",
                    "resumeSuggestedAt", "resumeDraftId", "resumeDraftedAt",
                )),
                "suggestion": _file_metadata(str(item.get("resumeSuggestionPath") or "")),
                "draft": _file_metadata(str(item.get("resumeDraftPath") or "")),
            })
        return {"ok": True, "items": compact_items, "pagination": pagination}

    @mcp.tool(annotations=READ_ONLY)
    def get_tailored_resume(source_key: str, content_mode: str = "path") -> dict[str, Any]:
        """定位并查看单个候选岗位的简历建议和定制简历；默认只返回本机路径、元数据和版本号，只有无法直接访问文件时才使用 content_mode=full。"""
        normalized_mode = _validated_content_mode(content_mode)
        project = project_from_source_key(source_key)
        suggestion: dict[str, Any] | None = None
        draft: dict[str, Any] | None = None
        with project_workspace(project):
            try:
                suggestion = read_resume_suggestion(source_key)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
            try:
                draft = read_resume_draft(source_key)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
        if suggestion is None and draft is None:
            raise HTTPException(status_code=404, detail=f"该候选岗位尚无简历建议或定制简历：{source_key}")
        result: dict[str, Any] = {
            "ok": True,
            "sourceKey": source_key,
            "contentMode": normalized_mode,
            "guidance": (
                "本地 Agent 优先读取返回的文件路径。修改定制简历时调用 update_tailored_resume；"
                "简历建议与证据映射有关，不要直接覆盖建议文件。"
            ),
        }
        if suggestion is not None:
            result["suggestion"] = {
                **_artifact_view(
                    suggestion,
                    "suggestionPath",
                    normalized_mode,
                    extra_fields=("sourceKey", "resumeSuggestionId", "jsonPath", "evidenceBindingVersion"),
                ),
                "evidenceClaimCount": len(suggestion.get("evidenceMap") or []),
            }
        else:
            result["suggestion"] = None
        if draft is not None:
            result["draft"] = {
                **_artifact_view(
                    draft,
                    "draftPath",
                    normalized_mode,
                    extra_fields=("sourceKey", "resumeDraftId", "jsonPath"),
                ),
                "evidenceClaimCount": len(draft.get("evidenceMap") or []),
            }
        else:
            result["draft"] = None
        return result

    @mcp.tool(annotations=READ_ONLY)
    def get_story_bank(project: str) -> dict[str, Any]:
        """读取一个求职目标中已经用户确认、可复用于面试回答的故事库。"""
        with project_workspace(project):
            return read_story_bank()

    @mcp.tool(annotations=READ_ONLY)
    def get_story_drafts(project: str) -> dict[str, Any]:
        """读取尚未由用户确认的面试故事草稿；草稿不能当作已确认事实直接写入申请材料。"""
        with project_workspace(project):
            return read_story_drafts()

    @mcp.tool(annotations=SAFE_WRITE)
    def add_candidate_jobs(project: str, job_ids: list[int], confirmation_id: str = "") -> dict[str, Any]:
        """预览或把已采集岗位加入候选流程；首次调用只返回确认预览，用户后续明确同意后才能提交 confirmation_id。"""
        project_dir = resolve_project(project)
        normalized_ids = list(dict.fromkeys(int(value) for value in job_ids if int(value) > 0))
        if not normalized_ids:
            raise HTTPException(status_code=400, detail="至少需要一个大于 0 的岗位 ID")
        with project_workspace(project):
            jobs = get_jobs_by_ids(project_dir, normalized_ids)
            pipeline = read_pipeline()
            existing = {str(item.get("sourceKey")) for item in [*pipeline["pending"], *pipeline["processed"]]}
            preview = [
                {
                    "jobId": job["id"],
                    "sourceKey": f"{project}:{job['id']}",
                    "company": job.get("company", ""),
                    "title": job.get("title", ""),
                    "alreadyCandidate": f"{project}:{job['id']}" in existing,
                }
                for job in jobs
            ]
            confirmation_payload = {"jobIds": normalized_ids}
            if not confirmation_id:
                return _confirmation_preview("add_candidate_jobs", project, confirmation_payload, jobs=preview)
            _require_confirmation(confirmation_id, "add_candidate_jobs", project, confirmation_payload)
            return audited_write(
                "add_candidate_jobs",
                project,
                lambda: add_jobs_to_pipeline(project, normalized_ids),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def set_candidate_status(source_key: str, decision_status: str, confirmation_id: str = "") -> dict[str, Any]:
        """预览或更新候选岗位的流程状态；必须先展示预览并在用户后续明确确认后执行。"""
        if decision_status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail=f"不支持的候选状态：{decision_status}")
        confirmation_payload = {"decisionStatus": decision_status}
        if not confirmation_id:
            return _confirmation_preview("set_candidate_status", source_key, confirmation_payload, decisionStatus=decision_status)
        _require_confirmation(confirmation_id, "set_candidate_status", source_key, confirmation_payload)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "set_candidate_status",
                source_key,
                lambda: update_pipeline_item_status(source_key, decision_status),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def start_collection(project: str, confirmation_id: str = "") -> dict[str, Any]:
        """预览或按求职目标保存的配置启动采集；执行前应检查 Cookie，并遵守全局串行采集队列。"""
        payload = _crawl_payload(project)
        current = task_manager.snapshot()
        confirmation_payload = payload.model_dump()
        if not confirmation_id:
            return _confirmation_preview(
                "start_collection",
                project,
                confirmation_payload,
                keywords=[line for line in payload.keywordsText.splitlines() if line.strip()],
                cities=[line.split("=", 1)[0].strip() for line in payload.citiesText.splitlines() if line.strip()],
                newJobTarget=payload.newJobTarget,
                maxJobs=payload.maxJobs,
                currentTask={"running": current.get("running"), "status": current.get("status")},
                loginState=login_state(project),
            )
        _require_confirmation(confirmation_id, "start_collection", project, confirmation_payload)
        return audited_write(
            "start_collection",
            project,
            lambda: start_crawl_task(payload, task_manager),
        )

    @mcp.tool(annotations=SAFE_WRITE)
    def run_fine_review(source_key: str, confirmation_id: str = "") -> dict[str, Any]:
        """预览或对候选岗位执行付费 LLM 精评；会使用 BossFlow 配置的模型 API，必须单独确认。"""
        confirmation_payload: dict[str, Any] = {}
        if not confirmation_id:
            return _confirmation_preview("run_fine_review", source_key, confirmation_payload, cost="将调用 BossFlow 已配置的 LLM API")
        _require_confirmation(confirmation_id, "run_fine_review", source_key, confirmation_payload)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "run_fine_review",
                source_key,
                lambda: llm_evaluate_pipeline_item(source_key),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def create_resume_suggestions(source_key: str, confirmation_id: str = "") -> dict[str, Any]:
        """预览或使用 BossFlow 的付费 LLM 生成有依据约束的简历建议；优先考虑由外部 Agent 生成后保存。"""
        confirmation_payload: dict[str, Any] = {}
        if not confirmation_id:
            return _confirmation_preview(
                "create_resume_suggestions",
                source_key,
                confirmation_payload,
                cost="将调用 BossFlow 已配置的 LLM API",
                alternative="若当前外部 Agent 可以生成内容，优先使用 save_agent_resume_suggestions 保存，避免重复调用模型",
            )
        _require_confirmation(confirmation_id, "create_resume_suggestions", source_key, confirmation_payload)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "create_resume_suggestions",
                source_key,
                lambda: generate_resume_suggestions(source_key),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def create_interview_prep(source_key: str, user_notes: str = "", confirmation_id: str = "") -> dict[str, Any]:
        """预览或使用 BossFlow 的付费 LLM 生成面试准备；内容只能基于已确认事实、能力依据与故事。"""
        confirmation_payload = {"userNotes": user_notes}
        if not confirmation_id:
            return _confirmation_preview(
                "create_interview_prep",
                source_key,
                confirmation_payload,
                cost="将调用 BossFlow 已配置的 LLM API",
                userNotes=user_notes,
                alternative="若当前外部 Agent 可以生成内容，优先使用 save_agent_interview_preparation 保存，避免重复调用模型",
            )
        _require_confirmation(confirmation_id, "create_interview_prep", source_key, confirmation_payload)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "create_interview_prep",
                source_key,
                lambda: generate_interview_prep(source_key, user_notes),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def stage_evidence_item(project: str, item: dict[str, Any], confirmation_id: str = "") -> dict[str, Any]:
        """预览或保存一条带来源的能力依据草稿，并关联归一化能力或岗位要求；草稿尚不等于用户确认。"""
        resolve_project(project)
        validated = EvidenceItemCreateRequest.model_validate({"project": project, **item}).model_dump()
        confirmation_payload = {"item": validated}
        preview = {
            "title": validated["title"],
            "evidenceType": validated["evidenceType"],
            "sourceRefs": validated["sourceRefs"],
            "requirementIds": validated["requirementIds"],
            "capabilityIds": validated["capabilityIds"],
            "status": "draft",
        }
        if not confirmation_id:
            return _confirmation_preview("stage_evidence_item", project, confirmation_payload, item=preview)
        _require_confirmation(confirmation_id, "stage_evidence_item", project, confirmation_payload)
        with project_workspace(project):
            return audited_write("stage_evidence_item", project, lambda: create_evidence_item(validated))

    @mcp.tool(annotations=SAFE_WRITE)
    def confirm_evidence(project: str, evidence_id: str, confirmation_id: str = "") -> dict[str, Any]:
        """预览或把用户审阅过的能力依据草稿确认为可复用事实；确认后才可用于申请材料。"""
        with project_workspace(project):
            overview = read_evidence_overview()
            item = next((entry for entry in overview.get("evidenceItems", []) if entry.get("evidenceId") == evidence_id), None)
            if not item:
                raise HTTPException(status_code=404, detail=f"未找到能力依据：{evidence_id}")
            confirmation_payload = {"evidenceId": evidence_id}
            if not confirmation_id:
                return _confirmation_preview(
                    "confirm_evidence",
                    evidence_id,
                    confirmation_payload,
                    title=item.get("title", ""),
                    summary=item.get("summary", ""),
                    sourceRefs=item.get("sourceRefs", []),
                )
            _require_confirmation(confirmation_id, "confirm_evidence", evidence_id, confirmation_payload)
            return audited_write("confirm_evidence", evidence_id, lambda: confirm_evidence_item(evidence_id))

    @mcp.tool(annotations=SAFE_WRITE)
    def classify_evidence_requirement(
        project: str,
        requirement_id: str,
        classification: str,
        evidence_ids: list[str] | None = None,
        rationale: str = "",
        confidence: float = 0,
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或记录用户对一条具体岗位要求的匹配判断；同类能力优先使用 decide_capability 统一判断。"""
        validated = EvidenceCoverageClassifyRequest.model_validate(
            {
                "project": project,
                "requirementId": requirement_id,
                "userClassification": classification,
                "evidenceIds": evidence_ids or [],
                "rationale": rationale,
                "confidence": confidence,
            }
        ).model_dump()
        confirmation_payload = {key: value for key, value in validated.items() if key != "project"}
        if not confirmation_id:
            return _confirmation_preview(
                "classify_evidence_requirement",
                requirement_id,
                confirmation_payload,
                classification=classification,
                evidenceIds=evidence_ids or [],
                rationale=rationale,
            )
        _require_confirmation(confirmation_id, "classify_evidence_requirement", requirement_id, confirmation_payload)
        with project_workspace(project):
            return audited_write(
                "classify_evidence_requirement",
                requirement_id,
                lambda: classify_coverage(validated),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def decide_capability(
        project: str,
        capability_id: str,
        classification: str,
        evidence_ids: list[str] | None = None,
        rationale: str = "",
        user_proficiency: str = "unspecified",
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或记录一项归一化能力的可复用判断，使相同能力在多个岗位要求间复用，避免重复确认。"""
        validated = CapabilityDecisionRequest.model_validate({
            "project": project,
            "capabilityId": capability_id,
            "classification": classification,
            "evidenceIds": evidence_ids or [],
            "rationale": rationale,
            "confidence": 1,
            "userProficiency": user_proficiency,
        }).model_dump()
        confirmation_payload = {
            key: value
            for key, value in validated.items()
            if key != "project"
        }
        if not confirmation_id:
            return _confirmation_preview(
                "decide_capability",
                capability_id,
                confirmation_payload,
                classification=classification,
                evidenceIds=evidence_ids or [],
                userProficiency=user_proficiency,
            )
        _require_confirmation(confirmation_id, "decide_capability", capability_id, confirmation_payload)
        with project_workspace(project):
            return audited_write(
                "decide_capability",
                capability_id,
                lambda: classify_capability(confirmation_payload),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def import_resume_capabilities(
        project: str,
        source_revision: str,
        selections: list[dict[str, Any]],
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或导入用户选中的简历能力；必须沿用 preview_resume_capability_import 返回的 source_revision 与选项。"""
        normalized_selections = [
            ResumeCapabilityImportSelection.model_validate(item).model_dump()
            for item in selections
        ]
        confirmation_payload = {
            "sourceRevision": source_revision,
            "selections": normalized_selections,
        }
        if not confirmation_id:
            return _confirmation_preview(
                "import_resume_capabilities",
                project,
                confirmation_payload,
                selectedCount=sum(1 for item in normalized_selections if item["selected"]),
                sourceRevision=source_revision,
                evidenceStrength="personal_resume_claim",
            )
        _require_confirmation(
            confirmation_id,
            "import_resume_capabilities",
            project,
            confirmation_payload,
        )
        with project_workspace(project):
            document = read_cv_document()
            return audited_write(
                "import_resume_capabilities",
                project,
                lambda: apply_resume_capability_import(
                    document.get("content", ""),
                    normalized_selections,
                    source_revision,
                ),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def set_evidence_task_status(
        project: str,
        task_id: str,
        status: str,
        completion_evidence_ids: list[str] | None = None,
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或更新能力补充/提升任务状态，可在完成时关联新增的能力依据。"""
        validated = EvidenceTaskUpdateRequest.model_validate(
            {
                "project": project,
                "taskId": task_id,
                "status": status,
                "completionEvidenceIds": completion_evidence_ids or [],
            }
        ).model_dump()
        confirmation_payload = {key: value for key, value in validated.items() if key != "project"}
        if not confirmation_id:
            return _confirmation_preview("set_evidence_task_status", task_id, confirmation_payload, **confirmation_payload)
        _require_confirmation(confirmation_id, "set_evidence_task_status", task_id, confirmation_payload)
        with project_workspace(project):
            return audited_write("set_evidence_task_status", task_id, lambda: update_evidence_task(validated))

    @mcp.tool(annotations=SAFE_WRITE)
    def update_base_resume(
        project: str,
        content: str,
        expected_revision: str = "",
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或保存个人基础简历；写入前展示差异并要求用户在后续消息中确认，同时用 revision 防止覆盖用户或其他工具刚完成的修改。"""
        normalized_content = _normalized_markdown(content)
        if not normalized_content.strip():
            raise HTTPException(status_code=422, detail="个人简历内容不能为空")
        with project_workspace(project):
            current = read_cv_document()
        current_content = str(current.get("content") or "")
        current_revision = _content_revision(current_content)
        normalized_expected = str(expected_revision or "").strip() or current_revision
        if normalized_expected != current_revision:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"个人简历已发生变化，当前 revision 为 {current_revision}，"
                    "请重新读取并基于最新内容修改"
                ),
            )
        confirmation_payload = {
            "content": normalized_content,
            "expectedRevision": normalized_expected,
        }
        if not confirmation_id:
            return _confirmation_preview(
                "update_base_resume",
                project,
                confirmation_payload,
                path=str(current.get("path") or ""),
                currentRevision=current_revision,
                proposedRevision=_content_revision(normalized_content),
                **_change_preview(current_content, normalized_content),
            )
        _require_confirmation(confirmation_id, "update_base_resume", project, confirmation_payload)

        def persist() -> dict[str, Any]:
            saved = save_cv_document(normalized_content)
            saved_content = str(saved.pop("content", "") or "")
            return {
                **saved,
                **_file_metadata(str(saved.get("path") or "")),
                "revision": _content_revision(saved_content),
                "characterCount": len(saved_content),
            }

        with project_workspace(project):
            return audited_write("update_base_resume", project, persist)

    @mcp.tool(annotations=SAFE_WRITE)
    def update_tailored_resume(
        source_key: str,
        content: str,
        expected_revision: str = "",
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或保存某个岗位的定制简历；写入会同步编辑时间等关联元数据，并通过人工确认和 revision 校验避免静默覆盖。"""
        normalized_content = str(content or "").replace("\r\n", "\n").replace("\r", "\n").rstrip()
        if not normalized_content:
            raise HTTPException(status_code=422, detail="定制简历内容不能为空")
        normalized_content += "\n"
        project = project_from_source_key(source_key)
        with project_workspace(project):
            current = read_resume_draft(source_key)
        current_content = str(current.get("content") or "")
        current_revision = _content_revision(current_content)
        normalized_expected = str(expected_revision or "").strip() or current_revision
        if normalized_expected != current_revision:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"定制简历已发生变化，当前 revision 为 {current_revision}，"
                    "请重新读取并基于最新内容修改"
                ),
            )
        confirmation_payload = {
            "content": normalized_content,
            "expectedRevision": normalized_expected,
        }
        if not confirmation_id:
            return _confirmation_preview(
                "update_tailored_resume",
                source_key,
                confirmation_payload,
                path=str(current.get("draftPath") or ""),
                currentRevision=current_revision,
                proposedRevision=_content_revision(normalized_content),
                **_change_preview(current_content, normalized_content),
            )
        _require_confirmation(confirmation_id, "update_tailored_resume", source_key, confirmation_payload)

        def persist() -> dict[str, Any]:
            saved = save_resume_draft(source_key, normalized_content)
            saved_content = str(saved.pop("content", "") or "")
            return {
                **saved,
                **_file_metadata(str(saved.get("draftPath") or "")),
                "revision": _content_revision(saved_content),
                "characterCount": len(saved_content),
            }

        with project_workspace(project):
            return audited_write("update_tailored_resume", source_key, persist)

    @mcp.tool(annotations=SAFE_WRITE)
    def save_agent_resume_suggestions(
        source_key: str,
        content: str,
        evidence_map: list[dict[str, Any]] | None = None,
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或保存外部 Agent 编写的简历建议；不会调用 BossFlow 的 LLM API，内容仍必须绑定真实依据。"""
        normalized_content = str(content or "").strip()
        if not normalized_content:
            raise HTTPException(status_code=422, detail="content 不能为空")
        confirmation_payload = {"content": normalized_content, "evidenceMap": evidence_map or []}
        if not confirmation_id:
            return _confirmation_preview(
                "save_agent_resume_suggestions",
                source_key,
                confirmation_payload,
                characterCount=len(normalized_content),
                evidenceClaimCount=len(evidence_map or []),
                excerpt=normalized_content[:240],
                cost="不会调用 BossFlow 的 LLM API",
            )
        _require_confirmation(confirmation_id, "save_agent_resume_suggestions", source_key, confirmation_payload)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "save_agent_resume_suggestions",
                source_key,
                lambda: persist_agent_resume_suggestions(source_key, normalized_content, evidence_map or []),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def save_agent_interview_preparation(
        source_key: str,
        content: str,
        user_notes: str = "",
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """预览或保存外部 Agent 编写的面试准备；不会调用 BossFlow 的 LLM API，不得编造经历。"""
        normalized_content = str(content or "").strip()
        if not normalized_content:
            raise HTTPException(status_code=422, detail="content 不能为空")
        confirmation_payload = {"content": normalized_content, "userNotes": user_notes}
        if not confirmation_id:
            return _confirmation_preview(
                "save_agent_interview_preparation",
                source_key,
                confirmation_payload,
                characterCount=len(normalized_content),
                excerpt=normalized_content[:240],
                cost="不会调用 BossFlow 的 LLM API",
            )
        _require_confirmation(confirmation_id, "save_agent_interview_preparation", source_key, confirmation_payload)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "save_agent_interview_preparation",
                source_key,
                lambda: save_agent_interview_prep(source_key, normalized_content, user_notes),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def save_imported_story_drafts(project: str, drafts: list[dict[str, Any]], confirmation_id: str = "") -> dict[str, Any]:
        """预览或保存从用户授权项目提取的面试故事草稿；保存后仍是待确认状态。"""
        resolve_project(project)
        if not drafts:
            raise HTTPException(status_code=400, detail="至少需要一条故事草稿")
        normalized: list[dict[str, Any]] = []
        for raw in drafts:
            draft = InterviewStoryDraftPayload.model_validate(raw).model_dump()
            draft["draftId"] = draft["draftId"] or f"draft-{uuid.uuid4().hex[:12]}"
            draft["status"] = "needs_confirmation"
            normalized.append(draft)
        preview = [
            {
                "draftId": item["draftId"],
                "title": item["title"],
                "source": item["source"],
                "sourceLabel": item["sourceLabel"],
                "tags": item["tags"],
            }
            for item in normalized
        ]
        confirmation_payload = {"drafts": drafts}
        if not confirmation_id:
            return _confirmation_preview("save_imported_story_drafts", project, confirmation_payload, drafts=preview)
        _require_confirmation(confirmation_id, "save_imported_story_drafts", project, confirmation_payload)
        with project_workspace(project):
            existing = read_story_drafts()["drafts"]
            existing_ids = {item.get("draftId") for item in existing}
            merged = [*existing, *[item for item in normalized if item["draftId"] not in existing_ids]]
            return audited_write(
                "save_imported_story_drafts",
                project,
                lambda: save_story_drafts(merged),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def confirm_story_draft(project: str, draft_id: str, confirmation_id: str = "") -> dict[str, Any]:
        """预览或把用户审阅过的故事草稿收录到正式故事库；必须由用户单独确认。"""
        with project_workspace(project):
            drafts = read_story_drafts()["drafts"]
            draft = next((item for item in drafts if item.get("draftId") == draft_id), None)
            if not draft:
                raise HTTPException(status_code=404, detail=f"未找到故事草稿：{draft_id}")
            confirmation_payload = {"draftId": draft_id}
            if not confirmation_id:
                return _confirmation_preview(
                    "confirm_story_draft",
                    draft_id,
                    confirmation_payload,
                    title=draft.get("title", ""),
                    source=draft.get("source", ""),
                )
            _require_confirmation(confirmation_id, "confirm_story_draft", draft_id, confirmation_payload)
            return audited_write(
                "confirm_story_draft",
                draft_id,
                lambda: promote_story_draft(draft_id, draft),
            )

    @mcp.resource("bossflow://workspace/projects", mime_type="application/json")
    def projects_resource() -> str:
        """发现可用的 BossFlow 求职目标。"""
        return _json_resource(list_projects())

    @mcp.resource("bossflow://project/{project}/summary", mime_type="application/json")
    def project_summary_resource(project: str) -> str:
        """读取求职目标的紧凑状态概览。"""
        return _json_resource(get_project_summary(project))

    @mcp.resource("bossflow://project/{project}/pipeline", mime_type="application/json")
    def project_pipeline_resource(project: str) -> str:
        """读取候选流程中前 100 个岗位的紧凑摘要。"""
        return _json_resource(get_pipeline(project, limit=100))

    @mcp.resource("bossflow://project/{project}/evidence", mime_type="application/json")
    def project_evidence_resource(project: str) -> str:
        """读取求职目标的能力档案紧凑概览。"""
        return _json_resource(get_evidence(project))

    @mcp.resource("bossflow://project/{project}/capabilities", mime_type="application/json")
    def project_capabilities_resource(project: str) -> str:
        """读取归一化能力卡片摘要。"""
        return _json_resource(get_capabilities(project))

    @mcp.resource("bossflow://capability/{project}/{capability_id}", mime_type="application/json")
    def capability_resource(project: str, capability_id: str) -> str:
        """读取一项归一化能力的完整详情。"""
        return _json_resource(get_capability(project, capability_id))

    @mcp.resource("bossflow://project/{project}/login-state", mime_type="application/json")
    def project_login_state_resource(project: str) -> str:
        """读取定时或无人值守采集所需的 BOSS Cookie 状态。"""
        return _json_resource(get_login_state(project))

    @mcp.resource("bossflow://project/{project}/evidence-requirements", mime_type="application/json")
    def project_evidence_requirements_resource(project: str) -> str:
        """分页读取求职目标中的有效原子岗位要求摘要。"""
        return _json_resource(get_evidence_requirements(project))

    @mcp.resource("bossflow://project/{project}/story-bank", mime_type="application/json")
    def project_story_bank_resource(project: str) -> str:
        """读取用户已确认的面试故事库。"""
        return _json_resource(get_story_bank(project))

    @mcp.resource("bossflow://project/{project}/story-drafts", mime_type="application/json")
    def project_story_drafts_resource(project: str) -> str:
        """读取尚未由用户确认的面试故事草稿。"""
        return _json_resource(get_story_drafts(project))

    @mcp.resource("bossflow://job/{project}/{job_id}", mime_type="application/json")
    def job_resource(project: str, job_id: str) -> str:
        """读取一个已采集岗位的完整记录。"""
        try:
            normalized_id = int(job_id)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="job_id 必须是整数") from error
        return _json_resource(get_job(project, normalized_id))

    return mcp
