from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from backend.schemas.config import CrawlRequest
from backend.schemas.evidence import EvidenceCoverageClassifyRequest, EvidenceItemCreateRequest, EvidenceTaskUpdateRequest
from backend.schemas.interview import InterviewStoryDraftPayload
from backend.services.agent_audit_service import record_agent_action
from backend.services.agent_confirmation_service import AgentConfirmationService
from backend.services.crawler_service import start_crawl_task
from backend.services.cv_service import read_cv_document
from backend.services.evidence_service import (
    classify_coverage,
    confirm_evidence_item,
    create_evidence_item,
    list_evidence_tasks,
    list_requirements,
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
    read_resume_draft,
    read_resume_suggestion,
    save_agent_resume_suggestions as persist_agent_resume_suggestions,
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
            "Show this exact preview to the user and ask for an explicit yes/no decision. "
            "Only after an unambiguous yes in a later user message, repeat the unchanged call with confirmation_id."
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
        scrollTarget=payload["scrollTarget"],
        scrollMax=payload["scrollMax"],
        minSalary=payload["minSalary"],
        headlessMode=payload["headlessMode"],
        autoSqlite=payload["autoSqlite"],
        catRulesText=payload["catRulesText"],
        scoringRulesText=payload["scoringRulesText"],
        relevanceText=payload["relevanceText"],
        blacklistText=payload["blacklistText"],
    )


def create_bossflow_mcp(task_manager: TaskManager) -> FastMCP:
    """Create the single MCP surface shared by HTTP and the stdio bridge."""
    mcp = FastMCP(
        "BossFlow",
        instructions=(
            "Operate the user's local BossFlow job-search workspace. Read context before acting. "
            "All write and paid-generation tools require a short-lived confirmationId bound to the exact preview. "
            "Never consume a confirmationId until the user explicitly approves that preview in a later message. "
            "Never invent candidate facts or bypass BossFlow's crawler queue."
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
        """List BossFlow job-search projects and identify the default project."""
        names = project_names()
        return {"projects": names, "defaultProject": default_project_name() if names else ""}

    @mcp.tool(annotations=READ_ONLY)
    def get_project_summary(project: str) -> dict[str, Any]:
        """Read saved collection configuration and workspace counts for one project."""
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
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Filter collected jobs by text, city, salary, score, fit/risk signals, freshness, and live status."""
        if not 1 <= limit <= 200:
            raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
        if offset < 0:
            raise HTTPException(status_code=400, detail="offset must be non-negative")
        if sort_by not in {"salary_desc", "score_desc", "newest"}:
            raise HTTPException(status_code=400, detail="sort_by must be salary_desc, score_desc, or newest")
        project_dir = resolve_project(project)
        with project_workspace(project):
            return query_jobs(
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

    @mcp.tool(annotations=READ_ONLY)
    def get_job(project: str, job_id: int) -> dict[str, Any]:
        """Read the complete collected record for a job ID."""
        project_dir = resolve_project(project)
        with project_workspace(project):
            return get_job_by_id(project_dir, job_id)

    @mcp.tool(annotations=READ_ONLY)
    def get_pipeline(project: str, decision_status: str = "", limit: int = 100) -> dict[str, Any]:
        """Read candidate jobs for a project, optionally filtered by decision status."""
        if not 1 <= limit <= 500:
            raise HTTPException(status_code=400, detail="limit must be between 1 and 500")
        if decision_status and decision_status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unsupported decision status: {decision_status}")
        with project_workspace(project):
            pipeline = read_pipeline()
        pending = pipeline["pending"]
        processed = pipeline["processed"]
        if decision_status:
            pending = [item for item in pending if item.get("decisionStatus") == decision_status]
            processed = [item for item in processed if item.get("decisionStatus") == decision_status]
        return {
            **pipeline,
            "pending": pending[:limit],
            "processed": processed[:limit],
            "returned": {"pending": min(len(pending), limit), "processed": min(len(processed), limit)},
        }

    @mcp.tool(annotations=READ_ONLY)
    def get_task_status() -> dict[str, Any]:
        """Read the current crawler task status and recent log tail."""
        snapshot = task_manager.snapshot()
        return {**snapshot, "logs": snapshot.get("logs", [])[-50:]}

    @mcp.tool(annotations=READ_ONLY)
    def get_evidence(project: str) -> dict[str, Any]:
        """Read the project's evidence overview without exposing secrets or source files."""
        with project_workspace(project):
            return read_evidence_overview()

    @mcp.tool(annotations=READ_ONLY)
    def get_login_state(project: str) -> dict[str, Any]:
        """Inspect saved BOSS authentication Cookie freshness and client-side expiry for a job target."""
        return login_state(project)

    @mcp.tool(annotations=READ_ONLY)
    def get_evidence_requirements(project: str, source_key: str = "") -> dict[str, Any]:
        """List extracted job requirements, optionally for one candidate sourceKey."""
        with project_workspace(project):
            return list_requirements(source_key)

    @mcp.tool(annotations=READ_ONLY)
    def get_evidence_tasks(project: str, status: str = "", source_key: str = "") -> dict[str, Any]:
        """List evidence follow-up tasks, optionally filtered by status or candidate sourceKey."""
        with project_workspace(project):
            return list_evidence_tasks(status, source_key)

    @mcp.tool(annotations=READ_ONLY)
    def get_application_context(source_key: str) -> dict[str, Any]:
        """Read the grounded context a connected Agent needs to author resume or interview material."""
        project = project_from_source_key(source_key)
        try:
            job_id = int(source_key.rsplit(":", 1)[1])
        except (IndexError, ValueError) as error:
            raise HTTPException(status_code=400, detail="source_key must end with a numeric job ID") from error
        project_dir = resolve_project(project)
        with project_workspace(project):
            pipeline = read_pipeline()
            item = next(
                (entry for entry in [*pipeline["pending"], *pipeline["processed"]] if entry.get("sourceKey") == source_key),
                None,
            )
            if not item:
                raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
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
            return {
                "sourceKey": source_key,
                "job": get_job_by_id(project_dir, job_id),
                "pipelineItem": item,
                "fineReview": report,
                "cv": read_cv_document(),
                "evidence": read_evidence_overview(),
                "storyBank": read_story_bank(),
                "storyDrafts": read_story_drafts(),
                "resumeSuggestion": optional_read(read_resume_suggestion),
                "resumeDraft": optional_read(read_resume_draft),
                "interviewPrep": optional_read(read_interview_prep),
            }

    @mcp.tool(annotations=READ_ONLY)
    def get_story_bank(project: str) -> dict[str, Any]:
        """Read confirmed interview stories for one project."""
        with project_workspace(project):
            return read_story_bank()

    @mcp.tool(annotations=READ_ONLY)
    def get_story_drafts(project: str) -> dict[str, Any]:
        """Read unconfirmed story drafts for one project."""
        with project_workspace(project):
            return read_story_drafts()

    @mcp.tool(annotations=SAFE_WRITE)
    def add_candidate_jobs(project: str, job_ids: list[int], confirmation_id: str = "") -> dict[str, Any]:
        """Preview or add collected jobs to the candidate pipeline using the returned confirmationId."""
        project_dir = resolve_project(project)
        normalized_ids = list(dict.fromkeys(int(value) for value in job_ids if int(value) > 0))
        if not normalized_ids:
            raise HTTPException(status_code=400, detail="At least one positive job ID is required")
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
        """Preview or update a candidate's workflow status using the returned confirmationId."""
        if decision_status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unsupported decision status: {decision_status}")
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
        """Preview or start collection using the project's saved configuration and global crawler queue."""
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
                scrollTarget=payload.scrollTarget,
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
        """Preview or run the paid LLM fine review for a candidate job."""
        confirmation_payload: dict[str, Any] = {}
        if not confirmation_id:
            return _confirmation_preview("run_fine_review", source_key, confirmation_payload, cost="Uses the configured BossFlow LLM API")
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
        """Preview or generate evidence-bound resume suggestions for a reviewed candidate job."""
        confirmation_payload: dict[str, Any] = {}
        if not confirmation_id:
            return _confirmation_preview("create_resume_suggestions", source_key, confirmation_payload, cost="Uses the configured BossFlow LLM API", alternative="Prefer save_agent_resume_suggestions when the connected Agent can author the content")
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
        """Preview or generate interview preparation grounded in confirmed project evidence."""
        confirmation_payload = {"userNotes": user_notes}
        if not confirmation_id:
            return _confirmation_preview(
                "create_interview_prep",
                source_key,
                confirmation_payload,
                cost="Uses the configured BossFlow LLM API",
                userNotes=user_notes,
                alternative="Prefer save_agent_interview_prep when the connected Agent can author the content",
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
        """Preview or stage a source-grounded evidence item as a draft; confirmation is a separate action."""
        resolve_project(project)
        validated = EvidenceItemCreateRequest.model_validate({"project": project, **item}).model_dump()
        confirmation_payload = {"item": validated}
        preview = {
            "title": validated["title"],
            "evidenceType": validated["evidenceType"],
            "sourceRefs": validated["sourceRefs"],
            "requirementIds": validated["requirementIds"],
            "status": "draft",
        }
        if not confirmation_id:
            return _confirmation_preview("stage_evidence_item", project, confirmation_payload, item=preview)
        _require_confirmation(confirmation_id, "stage_evidence_item", project, confirmation_payload)
        with project_workspace(project):
            return audited_write("stage_evidence_item", project, lambda: create_evidence_item(validated))

    @mcp.tool(annotations=SAFE_WRITE)
    def confirm_evidence(project: str, evidence_id: str, confirmation_id: str = "") -> dict[str, Any]:
        """Preview or confirm one reviewed evidence draft for reuse in application materials."""
        with project_workspace(project):
            overview = read_evidence_overview()
            item = next((entry for entry in overview.get("evidenceItems", []) if entry.get("evidenceId") == evidence_id), None)
            if not item:
                raise HTTPException(status_code=404, detail=f"Evidence item not found: {evidence_id}")
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
        """Preview or record the user's evidence classification for one job requirement."""
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
    def set_evidence_task_status(
        project: str,
        task_id: str,
        status: str,
        completion_evidence_ids: list[str] | None = None,
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """Preview or update the status of an evidence follow-up task."""
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
    def save_agent_resume_suggestions(
        source_key: str,
        content: str,
        evidence_map: list[dict[str, Any]] | None = None,
        confirmation_id: str = "",
    ) -> dict[str, Any]:
        """Preview or save resume suggestions authored by the connected Agent; does not use BossFlow's LLM API."""
        normalized_content = str(content or "").strip()
        if not normalized_content:
            raise HTTPException(status_code=422, detail="content cannot be empty")
        confirmation_payload = {"content": normalized_content, "evidenceMap": evidence_map or []}
        if not confirmation_id:
            return _confirmation_preview(
                "save_agent_resume_suggestions",
                source_key,
                confirmation_payload,
                characterCount=len(normalized_content),
                evidenceClaimCount=len(evidence_map or []),
                excerpt=normalized_content[:240],
                cost="No BossFlow LLM API call",
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
        """Preview or save interview preparation authored by the connected Agent; no BossFlow LLM API call."""
        normalized_content = str(content or "").strip()
        if not normalized_content:
            raise HTTPException(status_code=422, detail="content cannot be empty")
        confirmation_payload = {"content": normalized_content, "userNotes": user_notes}
        if not confirmation_id:
            return _confirmation_preview(
                "save_agent_interview_preparation",
                source_key,
                confirmation_payload,
                characterCount=len(normalized_content),
                excerpt=normalized_content[:240],
                cost="No BossFlow LLM API call",
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
        """Preview or save source-grounded story drafts. Drafts remain unconfirmed until promoted by the user."""
        resolve_project(project)
        if not drafts:
            raise HTTPException(status_code=400, detail="At least one story draft is required")
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
        """Preview or promote one reviewed story draft into the confirmed story bank."""
        with project_workspace(project):
            drafts = read_story_drafts()["drafts"]
            draft = next((item for item in drafts if item.get("draftId") == draft_id), None)
            if not draft:
                raise HTTPException(status_code=404, detail=f"Story draft not found: {draft_id}")
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
        """Discover available BossFlow job-search projects."""
        return _json_resource(list_projects())

    @mcp.resource("bossflow://project/{project}/summary", mime_type="application/json")
    def project_summary_resource(project: str) -> str:
        """Read a project's compact state summary."""
        return _json_resource(get_project_summary(project))

    @mcp.resource("bossflow://project/{project}/pipeline", mime_type="application/json")
    def project_pipeline_resource(project: str) -> str:
        """Read the first 500 candidate jobs in a project's pipeline."""
        return _json_resource(get_pipeline(project, limit=500))

    @mcp.resource("bossflow://project/{project}/evidence", mime_type="application/json")
    def project_evidence_resource(project: str) -> str:
        """Read the project's confirmed and pending evidence overview."""
        return _json_resource(get_evidence(project))

    @mcp.resource("bossflow://project/{project}/login-state", mime_type="application/json")
    def project_login_state_resource(project: str) -> str:
        """Read saved BOSS Cookie freshness for scheduled or unattended collection."""
        return _json_resource(get_login_state(project))

    @mcp.resource("bossflow://project/{project}/evidence-requirements", mime_type="application/json")
    def project_evidence_requirements_resource(project: str) -> str:
        """Read all active evidence requirements for a project."""
        return _json_resource(get_evidence_requirements(project))

    @mcp.resource("bossflow://project/{project}/story-bank", mime_type="application/json")
    def project_story_bank_resource(project: str) -> str:
        """Read the project's confirmed interview story bank."""
        return _json_resource(get_story_bank(project))

    @mcp.resource("bossflow://project/{project}/story-drafts", mime_type="application/json")
    def project_story_drafts_resource(project: str) -> str:
        """Read the project's unconfirmed story drafts."""
        return _json_resource(get_story_drafts(project))

    @mcp.resource("bossflow://job/{project}/{job_id}", mime_type="application/json")
    def job_resource(project: str, job_id: str) -> str:
        """Read one complete collected job record."""
        try:
            normalized_id = int(job_id)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="job_id must be an integer") from error
        return _json_resource(get_job(project, normalized_id))

    return mcp
