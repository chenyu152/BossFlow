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
from backend.schemas.interview import InterviewStoryDraftPayload
from backend.services.agent_audit_service import record_agent_action
from backend.services.crawler_service import start_crawl_task
from backend.services.evidence_service import read_evidence_overview
from backend.services.interview_service import (
    generate_interview_prep,
    promote_story_draft,
    read_story_bank,
    read_story_drafts,
    save_story_drafts,
)
from backend.services.job_service import get_job_by_id, get_jobs_by_ids, query_jobs
from backend.services.llm_evaluation_service import llm_evaluate_pipeline_item
from backend.services.pipeline_service import (
    DECISION_STATUSES,
    add_jobs_to_pipeline,
    read_pipeline,
    update_pipeline_item_status,
)
from backend.services.project_service import (
    config_payload,
    default_project_name,
    project_names,
    resolve_project,
    stats_for_project,
)
from backend.services.resume_service import generate_resume_suggestions
from backend.services.task_service import TaskManager
from backend.services.workspace_service import project_from_source_key, project_workspace
from crawler.boss import load_config


T = TypeVar("T")

READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
SAFE_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)


def _json_resource(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _confirmation_preview(action: str, target: str, **details: Any) -> dict[str, Any]:
    return {
        "ok": False,
        "requiresConfirmation": True,
        "action": action,
        "target": target,
        "details": details,
        "nextStep": "Review the preview, then repeat this tool call with confirmed=true.",
    }


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
            "All write and paid-generation tools require an explicit confirmed=true retry after preview. "
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
    def search_jobs(project: str, query: str = "", limit: int = 50, offset: int = 0) -> dict[str, Any]:
        """Search collected jobs in one project. Limit must be between 1 and 200."""
        if not 1 <= limit <= 200:
            raise HTTPException(status_code=400, detail="limit must be between 1 and 200")
        if offset < 0:
            raise HTTPException(status_code=400, detail="offset must be non-negative")
        project_dir = resolve_project(project)
        with project_workspace(project):
            return query_jobs(project_dir, query.strip(), limit, offset)

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
    def add_candidate_jobs(project: str, job_ids: list[int], confirmed: bool = False) -> dict[str, Any]:
        """Preview or add collected jobs to the candidate pipeline. Retry with confirmed=true to write."""
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
            if not confirmed:
                return _confirmation_preview("add_candidate_jobs", project, jobs=preview)
            return audited_write(
                "add_candidate_jobs",
                project,
                lambda: add_jobs_to_pipeline(project, normalized_ids),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def set_candidate_status(source_key: str, decision_status: str, confirmed: bool = False) -> dict[str, Any]:
        """Preview or update a candidate's workflow status. Retry with confirmed=true to write."""
        if decision_status not in DECISION_STATUSES:
            raise HTTPException(status_code=400, detail=f"Unsupported decision status: {decision_status}")
        if not confirmed:
            return _confirmation_preview("set_candidate_status", source_key, decisionStatus=decision_status)
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "set_candidate_status",
                source_key,
                lambda: update_pipeline_item_status(source_key, decision_status),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def start_collection(project: str, confirmed: bool = False) -> dict[str, Any]:
        """Preview or start collection using the project's saved configuration and global crawler queue."""
        payload = _crawl_payload(project)
        current = task_manager.snapshot()
        if not confirmed:
            return _confirmation_preview(
                "start_collection",
                project,
                keywords=[line for line in payload.keywordsText.splitlines() if line.strip()],
                cities=[line.split("=", 1)[0].strip() for line in payload.citiesText.splitlines() if line.strip()],
                scrollTarget=payload.scrollTarget,
                currentTask={"running": current.get("running"), "status": current.get("status")},
            )
        return audited_write(
            "start_collection",
            project,
            lambda: start_crawl_task(payload, task_manager),
        )

    @mcp.tool(annotations=SAFE_WRITE)
    def run_fine_review(source_key: str, confirmed: bool = False) -> dict[str, Any]:
        """Preview or run the paid LLM fine review for a candidate job."""
        if not confirmed:
            return _confirmation_preview("run_fine_review", source_key, cost="Uses the configured LLM API")
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "run_fine_review",
                source_key,
                lambda: llm_evaluate_pipeline_item(source_key),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def create_resume_suggestions(source_key: str, confirmed: bool = False) -> dict[str, Any]:
        """Preview or generate evidence-bound resume suggestions for a reviewed candidate job."""
        if not confirmed:
            return _confirmation_preview("create_resume_suggestions", source_key, cost="Uses the configured LLM API")
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "create_resume_suggestions",
                source_key,
                lambda: generate_resume_suggestions(source_key),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def create_interview_prep(source_key: str, user_notes: str = "", confirmed: bool = False) -> dict[str, Any]:
        """Preview or generate interview preparation grounded in confirmed project evidence."""
        if not confirmed:
            return _confirmation_preview(
                "create_interview_prep",
                source_key,
                cost="Uses the configured LLM API",
                userNotes=user_notes,
            )
        project = project_from_source_key(source_key)
        with project_workspace(project):
            return audited_write(
                "create_interview_prep",
                source_key,
                lambda: generate_interview_prep(source_key, user_notes),
            )

    @mcp.tool(annotations=SAFE_WRITE)
    def save_imported_story_drafts(project: str, drafts: list[dict[str, Any]], confirmed: bool = False) -> dict[str, Any]:
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
        if not confirmed:
            return _confirmation_preview("save_imported_story_drafts", project, drafts=preview)
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
    def confirm_story_draft(project: str, draft_id: str, confirmed: bool = False) -> dict[str, Any]:
        """Preview or promote one reviewed story draft into the confirmed story bank."""
        with project_workspace(project):
            drafts = read_story_drafts()["drafts"]
            draft = next((item for item in drafts if item.get("draftId") == draft_id), None)
            if not draft:
                raise HTTPException(status_code=404, detail=f"Story draft not found: {draft_id}")
            if not confirmed:
                return _confirmation_preview(
                    "confirm_story_draft",
                    draft_id,
                    title=draft.get("title", ""),
                    source=draft.get("source", ""),
                )
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
