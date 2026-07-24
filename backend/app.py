import asyncio
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import tempfile

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from backend.schemas.automation import AutomationScheduleInput, AutomationScheduleUpdate
from backend.schemas.account_activity import AccountActivityImportRequest, AccountActivitySyncRequest
from backend.schemas.config import ConfigUpdate, CrawlRequest, ProcessPartialRequest
from backend.schemas.cv import (
    CapabilityDecisionRequest,
    CvSaveRequest,
    ResumeCapabilityImportRequest,
)
from backend.schemas.evidence import (
    EvidenceCoverageClassifyRequest,
    EvidenceItemConfirmRequest,
    EvidenceItemCreateRequest,
    EvidenceItemUpdateRequest,
    EvidenceTaskCreateRequest,
    EvidenceTaskUpdateRequest,
    RequirementsUpsertRequest,
)
from backend.schemas.greeting import GreetingDraftSaveRequest, GreetingPreflightRequest, GreetingPrepareRequest
from backend.schemas.interview import InterviewPrepRequest, StoryBankSaveRequest, StoryDraftPromoteRequest, StoryDraftsSaveRequest
from backend.schemas.jobs import JobCreateRequest, JobLiveStatusUpdateRequest
from backend.schemas.pipeline import AddJobsToPipelineRequest, EvaluatePipelineItemRequest, LlmEvaluatePipelineItemRequest, PipelineDeleteRequest, PipelineStatusRequest, ScoreJobsRequest, ScorePipelineRequest
from backend.schemas.project import ProjectCreateRequest
from backend.schemas.resume import ResumeDraftRequest, ResumeDraftSaveRequest, ResumeSuggestionRequest
from backend.schemas.system_settings import LlmSettingsUpdate
from backend.mcp_security import DesktopRuntimeTokenMiddleware, McpSecurityMiddleware
from backend.mcp_server import create_bossflow_mcp
from backend.services.automation_service import AutomationService
from backend.services.account_activity_service import import_account_activity, list_account_activity, start_account_activity_sync
from backend.services.crawler_service import process_partial_task, start_crawl_task, start_login_task
from backend.services.cv_service import create_cv_from_template, cv_status, read_cv_document, save_cv_document
from backend.services.evidence_service import (
    apply_resume_capability_import,
    classify_capability,
    classify_coverage,
    confirm_evidence_item,
    create_evidence_item,
    create_evidence_task,
    list_capabilities,
    list_evidence_tasks,
    list_requirements,
    preview_resume_capability_import,
    read_evidence_overview,
    update_evidence_item,
    update_evidence_task,
    upsert_requirements,
)
from backend.services.evaluation_service import evaluate_pipeline_item, score_jobs, score_pipeline_items
from backend.services.greeting_prepare_service import start_greeting_prepare_task
from backend.services.greeting_service import preflight_greeting, read_greeting_draft, save_greeting_draft
from backend.services.interview_service import (
    generate_interview_prep,
    list_interview_items,
    read_interview_prep,
    read_story_bank,
    read_story_drafts,
    promote_story_draft,
    save_story_bank,
    save_story_drafts,
)
from backend.services.job_service import create_job, export_jobs_response, get_job_by_id, query_jobs
from backend.services.live_status_service import start_live_status_update_task
from backend.services.login_state_service import login_state
from backend.services.llm_evaluation_service import llm_evaluate_pipeline_item
from backend.services.pipeline_service import add_jobs_to_pipeline, delete_pipeline_item, read_pipeline, read_pipeline_report, update_pipeline_item_status
from backend.services.project_service import (
    config_payload,
    create_project,
    default_project_name,
    project_names,
    resolve_project,
    save_form_config,
    stats_for_project,
)
from backend.services.resume_parser_service import get_parse_status, start_parse
from backend.services.resume_service import generate_resume_draft, generate_resume_suggestions, list_resume_items, read_resume_draft, read_resume_suggestion, save_resume_draft
from backend.services.task_service import TaskManager
from backend.services.system_settings_service import llm_settings_status, reveal_llm_api_key, save_llm_settings, test_llm_connection
from backend.services.workspace_service import project_from_source_key, project_workspace
from crawler.boss import load_config

_desktop_mode = os.environ.get("BOSSFLOW_DESKTOP") == "1"
_runtime_token = os.environ.get("BOSSFLOW_RUNTIME_TOKEN", "")
_agent_token = os.environ.get("BOSSFLOW_AGENT_TOKEN", "")
task_manager = TaskManager()
automation_service = AutomationService(task_manager)
bossflow_mcp = create_bossflow_mcp(task_manager)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    automation_service.start()
    try:
        async with bossflow_mcp.session_manager.run():
            yield
    finally:
        automation_service.stop()


app = FastAPI(title="BossSpider Web Backend", version="0.2.0", lifespan=lifespan)
app.add_middleware(DesktopRuntimeTokenMiddleware, token=_runtime_token)
app.mount("/mcp", McpSecurityMiddleware(bossflow_mcp.streamable_http_app(), token=_agent_token), name="mcp")

# The regular browser development server is the only cross-origin caller.  A
# packaged Electron app is same-origin and should not advertise its loopback
# API to arbitrary web pages.
if not _desktop_mode:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_origin_regex=r"^http://(?:127\.0\.0\.1|localhost):\d+$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _workspace_project(project: Optional[str] = None, source_key: str = "") -> str:
    return project_from_source_key(source_key) if source_key else (project or default_project_name())


@app.get("/api/health")
def health_check():
    return {
        "ok": True,
        "desktop": _desktop_mode,
        "mcp": {"configured": bool(_agent_token), "endpoint": "/mcp/"},
    }


@app.get("/api/mcp/status")
async def mcp_status():
    tools = await bossflow_mcp.list_tools()
    resources = await bossflow_mcp.list_resources()
    templates = await bossflow_mcp.list_resource_templates()
    return {
        "name": "BossFlow MCP Server",
        "status": "running" if _agent_token else "disabled",
        "transport": "Streamable HTTP + stdio bridge",
        "endpoint": "/mcp/",
        "toolCount": len(tools),
        "resourceCount": len(resources) + len(templates),
    }


@app.get("/api/projects")
def list_projects():
    names = project_names()
    return {"projects": names, "defaultProject": default_project_name() if names else ""}


@app.post("/api/projects")
def create_new_project(payload: ProjectCreateRequest):
    return config_payload(create_project(payload.name))


@app.get("/api/system/llm-settings")
def get_llm_settings():
    return llm_settings_status()


@app.put("/api/system/llm-settings")
def update_llm_settings(payload: LlmSettingsUpdate):
    try:
        return save_llm_settings(payload.apiKey, payload.apiBase, payload.model)
    except ValueError as error:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/system/llm-settings/api-key")
def get_llm_api_key():
    return {"apiKey": reveal_llm_api_key()}


@app.post("/api/system/llm-settings/test")
def test_llm_settings(payload: LlmSettingsUpdate):
    try:
        return test_llm_connection(payload.apiKey, payload.apiBase, payload.model)
    except ValueError as error:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/api/automation")
def get_automation():
    return automation_service.snapshot()


@app.get("/api/login-state")
def get_login_state(project: Optional[str] = None):
    return login_state(project or default_project_name())


@app.post("/api/automation/schedules")
def create_automation_schedule(payload: AutomationScheduleInput):
    return automation_service.create_schedule(payload)


@app.put("/api/automation/schedules/{schedule_id}")
def update_automation_schedule(schedule_id: str, payload: AutomationScheduleUpdate):
    return automation_service.update_schedule(schedule_id, payload)


@app.delete("/api/automation/schedules/{schedule_id}")
def delete_automation_schedule(schedule_id: str):
    return automation_service.delete_schedule(schedule_id)


@app.post("/api/automation/schedules/{schedule_id}/run")
def run_automation_schedule(schedule_id: str):
    return automation_service.run_now(schedule_id)


@app.get("/api/config")
def get_config(project: Optional[str] = None):
    return config_payload(resolve_project(project))


@app.post("/api/config")
def update_config(payload: ConfigUpdate):
    project_dir, _, _ = save_form_config(payload)
    return config_payload(project_dir)


@app.get("/api/stats")
def get_stats(project: Optional[str] = None):
    project_dir = resolve_project(project)
    config = load_config(str(project_dir))
    return stats_for_project(project_dir, config)


@app.get("/api/cv/status")
def get_cv_status(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return cv_status()


@app.get("/api/cv")
def get_cv_document(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return read_cv_document()


@app.put("/api/cv")
def update_cv_document(payload: CvSaveRequest):
    with project_workspace(_workspace_project(payload.project)):
        return save_cv_document(payload.content)


@app.get("/api/cv/capability-import-preview")
def get_cv_capability_import_preview(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        document = read_cv_document()
        return preview_resume_capability_import(document.get("content", ""))


@app.post("/api/cv/capability-import")
def import_cv_capabilities(payload: ResumeCapabilityImportRequest):
    with project_workspace(_workspace_project(payload.project)):
        document = read_cv_document()
        return apply_resume_capability_import(
            document.get("content", ""),
            [item.model_dump() for item in payload.selections],
            payload.sourceRevision,
        )


@app.post("/api/cv/from-template")
def create_cv_template(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return create_cv_from_template()


@app.post("/api/cv/parse-pdf")
async def parse_pdf_resume(file: UploadFile = File(...)):
    temp_dir = Path(tempfile.mkdtemp(prefix="resume_parse_"))
    pdf_path = temp_dir / (file.filename or "resume.pdf")
    content = await file.read()
    pdf_path.write_bytes(content)

    output_dir = temp_dir / "output"
    start_parse(str(pdf_path), str(output_dir))
    return {"ok": True, "status": "processing"}


@app.get("/api/cv/parse-status")
def parse_status():
    return get_parse_status()


@app.get("/api/jobs")
def get_jobs(
    project: Optional[str] = None,
    q: str = "",
    limit: int = Query(default=20000, ge=1, le=20000),
    offset: int = Query(default=0, ge=0),
):
    with project_workspace(_workspace_project(project)):
        return query_jobs(resolve_project(project), q.strip(), limit, offset)


@app.get("/api/jobs/export")
def export_jobs(project: Optional[str] = None, q: str = ""):
    with project_workspace(_workspace_project(project)):
        rows = query_jobs(resolve_project(project), q.strip(), limit=50000, offset=0)["items"]
        return export_jobs_response(rows)


@app.get("/api/jobs/item")
def get_job_item(project: str, jobId: int):
    with project_workspace(_workspace_project(project)):
        return get_job_by_id(resolve_project(project), jobId)


@app.post("/api/jobs")
def add_job(payload: JobCreateRequest):
    with project_workspace(payload.project):
        return create_job(payload)


@app.post("/api/jobs/score")
def score_job_rows(payload: ScoreJobsRequest):
    with project_workspace(_workspace_project(payload.project)):
        return score_jobs(payload.project, payload.jobIds)


@app.post("/api/jobs/live-status/update")
def update_job_live_status(payload: JobLiveStatusUpdateRequest):
    return start_live_status_update_task(resolve_project(payload.project), payload, task_manager)


@app.get("/api/pipeline")
def get_pipeline(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return read_pipeline()


@app.get("/api/pipeline/report")
def get_pipeline_report(sourceKey: str):
    with project_workspace(_workspace_project(source_key=sourceKey)):
        return read_pipeline_report(sourceKey)


@app.get("/api/greetings/draft")
def get_greeting_draft(sourceKey: str):
    with project_workspace(_workspace_project(source_key=sourceKey)):
        return read_greeting_draft(sourceKey)


@app.put("/api/greetings/draft")
def update_greeting_draft(payload: GreetingDraftSaveRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        result = save_greeting_draft(payload.sourceKey, payload.editedText, payload.status)
        if payload.status == "manually_marked_sent":
            result["pipeline"] = update_pipeline_item_status(payload.sourceKey, "greeted")
        return result


@app.post("/api/greetings/preflight")
def greeting_preflight(payload: GreetingPreflightRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return preflight_greeting(payload.sourceKey, payload.message, task_manager.snapshot())


@app.post("/api/greetings/prepare")
def prepare_greeting(payload: GreetingPrepareRequest):
    return start_greeting_prepare_task(payload, task_manager)


@app.post("/api/pipeline/jobs")
def add_pipeline_jobs(payload: AddJobsToPipelineRequest):
    with project_workspace(_workspace_project(payload.project)):
        return add_jobs_to_pipeline(payload.project, payload.jobIds)


@app.get("/api/account-activity")
def get_account_activity(
    project: Optional[str] = None,
    matchProject: str = "",
    profileProject: str = "",
    tab: str = "all",
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=30, ge=1, le=200),
    search: str = "",
    newOnly: bool = False,
    accountKey: str = "",
    matchStatus: str = "all",
    importStatus: str = "all",
    jobStatus: str = "all",
    actionableOnly: bool = False,
):
    target = matchProject or project or default_project_name()
    profile = profileProject or project or default_project_name()
    return list_account_activity(target, tab, page, pageSize, search, newOnly, accountKey, profile_project=profile, match_status=matchStatus, import_status=importStatus, job_status=jobStatus, actionable_only=actionableOnly)


@app.post("/api/account-activity/sync")
def sync_account_activity(payload: AccountActivitySyncRequest):
    return start_account_activity_sync(payload.model_dump(), task_manager)


@app.post("/api/account-activity/import")
def import_account_activity_jobs(payload: AccountActivityImportRequest):
    target = payload.matchProject or payload.project or default_project_name()
    return import_account_activity(target, payload.accountJobIds, payload.mode, payload.allowUncertain, payload.accountKey, profile_project=payload.profileProject or payload.project or target, task_manager=task_manager)


@app.post("/api/pipeline/status")
def update_pipeline_status(payload: PipelineStatusRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return update_pipeline_item_status(payload.sourceKey, payload.decisionStatus)


@app.delete("/api/pipeline/item")
def delete_pipeline(payload: PipelineDeleteRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return delete_pipeline_item(payload.sourceKey)


@app.post("/api/pipeline/evaluate")
def evaluate_pipeline(payload: EvaluatePipelineItemRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        result = evaluate_pipeline_item(payload.sourceKey)
        return {**result, "pipeline": read_pipeline()}


@app.post("/api/pipeline/score")
def score_pipeline(payload: ScorePipelineRequest):
    project = _workspace_project(payload.project, payload.sourceKeys[0] if payload.sourceKeys else "")
    with project_workspace(project):
        return score_pipeline_items(payload.sourceKeys)


@app.post("/api/pipeline/llm-evaluate")
def llm_evaluate_pipeline(payload: LlmEvaluatePipelineItemRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return llm_evaluate_pipeline_item(payload.sourceKey)


@app.post("/api/resume/suggestions")
def create_resume_suggestions(payload: ResumeSuggestionRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return generate_resume_suggestions(payload.sourceKey)


@app.get("/api/evidence/overview")
def get_evidence_overview(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return read_evidence_overview()


@app.get("/api/evidence/capabilities")
def get_capabilities(
    status: str = "",
    category: str = "",
    sourceKey: str = "",
    limit: int = Query(default=200, ge=1, le=500),
    project: Optional[str] = None,
):
    with project_workspace(_workspace_project(project, sourceKey)):
        return list_capabilities(status, category, sourceKey, limit)


@app.get("/api/evidence/requirements")
def get_evidence_requirements(sourceKey: str = "", project: Optional[str] = None):
    with project_workspace(_workspace_project(project, sourceKey)):
        return list_requirements(sourceKey)


@app.put("/api/evidence/requirements")
def save_evidence_requirements(payload: RequirementsUpsertRequest):
    source_key = payload.requirements[0].sourceKey if payload.requirements else ""
    with project_workspace(_workspace_project(payload.project, source_key)):
        return upsert_requirements([item.model_dump() for item in payload.requirements])


@app.get("/api/evidence/tasks")
def get_evidence_tasks(status: str = "", sourceKey: str = "", project: Optional[str] = None):
    with project_workspace(_workspace_project(project, sourceKey)):
        return list_evidence_tasks(status, sourceKey)


@app.post("/api/evidence/coverage/classify")
def classify_evidence_coverage(payload: EvidenceCoverageClassifyRequest):
    with project_workspace(_workspace_project(payload.project)):
        return classify_coverage(payload.model_dump())


@app.post("/api/evidence/capabilities/classify")
def classify_capability_profile(payload: CapabilityDecisionRequest):
    with project_workspace(_workspace_project(payload.project)):
        return classify_capability(payload.model_dump())


@app.post("/api/evidence/items")
def add_evidence_item(payload: EvidenceItemCreateRequest):
    with project_workspace(_workspace_project(payload.project)):
        return create_evidence_item(payload.model_dump())


@app.put("/api/evidence/items")
def save_evidence_item(payload: EvidenceItemUpdateRequest):
    with project_workspace(_workspace_project(payload.project)):
        return update_evidence_item(payload.model_dump())


@app.post("/api/evidence/items/confirm")
def confirm_evidence(payload: EvidenceItemConfirmRequest):
    with project_workspace(_workspace_project(payload.project)):
        return confirm_evidence_item(payload.evidenceId)


@app.post("/api/evidence/tasks")
def add_evidence_task(payload: EvidenceTaskCreateRequest):
    with project_workspace(_workspace_project(payload.project)):
        return create_evidence_task(payload.model_dump())


@app.put("/api/evidence/tasks")
def save_evidence_task(payload: EvidenceTaskUpdateRequest):
    with project_workspace(_workspace_project(payload.project)):
        return update_evidence_task(payload.model_dump())


@app.get("/api/resume/items")
def get_resume_items(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return list_resume_items()


@app.get("/api/resume/suggestion")
def get_resume_suggestion(sourceKey: str):
    with project_workspace(_workspace_project(source_key=sourceKey)):
        return read_resume_suggestion(sourceKey)


@app.post("/api/resume/draft")
def create_resume_draft(payload: ResumeDraftRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return generate_resume_draft(payload.sourceKey, payload.approvedSuggestionIds, payload.userNotes)


@app.get("/api/resume/draft")
def get_resume_draft(sourceKey: str):
    with project_workspace(_workspace_project(source_key=sourceKey)):
        return read_resume_draft(sourceKey)


@app.put("/api/resume/draft")
def update_resume_draft(payload: ResumeDraftSaveRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return save_resume_draft(payload.sourceKey, payload.content)


@app.get("/api/interview/items")
def get_interview_items(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return list_interview_items()


@app.get("/api/interview/story-bank")
def get_interview_story_bank(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return read_story_bank()


@app.put("/api/interview/story-bank")
def update_interview_story_bank(payload: StoryBankSaveRequest):
    with project_workspace(_workspace_project(payload.project)):
        return save_story_bank([story.model_dump() for story in payload.stories])


@app.get("/api/interview/story-drafts")
def get_interview_story_drafts(project: Optional[str] = None):
    with project_workspace(_workspace_project(project)):
        return read_story_drafts()


@app.put("/api/interview/story-drafts")
def update_interview_story_drafts(payload: StoryDraftsSaveRequest):
    with project_workspace(_workspace_project(payload.project)):
        return save_story_drafts([draft.model_dump() for draft in payload.drafts])


@app.post("/api/interview/story-drafts/promote")
def confirm_interview_story_draft(payload: StoryDraftPromoteRequest):
    with project_workspace(_workspace_project(payload.project)):
        return promote_story_draft(payload.draftId, payload.draft.model_dump())


@app.post("/api/interview/prep")
def create_interview_prep(payload: InterviewPrepRequest):
    with project_workspace(_workspace_project(source_key=payload.sourceKey)):
        return generate_interview_prep(payload.sourceKey, payload.userNotes)


@app.get("/api/interview/prep")
def get_interview_prep(sourceKey: str):
    with project_workspace(_workspace_project(source_key=sourceKey)):
        return read_interview_prep(sourceKey)


@app.post("/api/tasks/crawl")
def start_crawl(payload: CrawlRequest):
    return start_crawl_task(payload, task_manager)


@app.post("/api/tasks/login")
def start_login(payload: ConfigUpdate):
    return start_login_task(payload, task_manager)


@app.post("/api/tasks/process-partial")
def process_partial(payload: ProcessPartialRequest):
    return process_partial_task(payload, task_manager)


@app.post("/api/tasks/stop")
def stop_task():
    task_manager.stop()
    return {"ok": True, **task_manager.snapshot()}


@app.get("/api/tasks/status")
def task_status():
    return task_manager.snapshot()


@app.get("/api/logs")
def get_logs(since: int = Query(default=0, ge=0)):
    snapshot = task_manager.snapshot()
    return {
        "running": snapshot["running"],
        "status": snapshot["status"],
        "from": since,
        "next": snapshot["logCount"],
        "logs": snapshot["logs"][since:],
    }


@app.get("/api/logs/stream")
async def stream_logs():
    async def events():
        index = 0
        while True:
            snapshot = task_manager.snapshot()
            logs = snapshot["logs"]
            while index < len(logs):
                yield f"data: {json.dumps({'index': index, 'line': logs[index]}, ensure_ascii=False)}\n\n"
                index += 1
            await asyncio.sleep(0.5)

    return StreamingResponse(events(), media_type="text/event-stream")


def _desktop_web_dir() -> Optional[Path]:
    value = os.environ.get("BOSSFLOW_WEB_DIR", "")
    if not value:
        return None
    directory = Path(value).resolve()
    index = directory / "index.html"
    return directory if index.is_file() else None


_web_dir = _desktop_web_dir()
if _web_dir:
    _web_index = _web_dir / "index.html"

    @app.get("/", include_in_schema=False)
    def desktop_index():
        return FileResponse(_web_index)

    @app.get("/{resource_path:path}", include_in_schema=False)
    def desktop_assets(resource_path: str):
        # Keep unknown API requests as API 404s instead of returning the SPA.
        if resource_path == "api" or resource_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (_web_dir / resource_path).resolve()
        if _web_dir not in candidate.parents or not candidate.is_file():
            return FileResponse(_web_index)
        return FileResponse(candidate)
