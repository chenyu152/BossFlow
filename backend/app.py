import asyncio
import json
from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from backend.schemas.config import ConfigUpdate, CrawlRequest, ProcessPartialRequest
from backend.schemas.greeting import GreetingDraftSaveRequest
from backend.schemas.interview import InterviewPrepRequest, StoryBankSaveRequest, StoryDraftPromoteRequest, StoryDraftsSaveRequest
from backend.schemas.pipeline import AddJobsToPipelineRequest, EvaluatePipelineItemRequest, LlmEvaluatePipelineItemRequest, PipelineDeleteRequest, PipelineStatusRequest, ScoreJobsRequest, ScorePipelineRequest
from backend.schemas.resume import ResumeDraftRequest, ResumeSuggestionRequest
from backend.services.crawler_service import process_partial_task, start_crawl_task, start_login_task
from backend.services.evaluation_service import evaluate_pipeline_item, score_jobs, score_pipeline_items
from backend.services.greeting_service import read_greeting_draft, save_greeting_draft
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
from backend.services.job_service import export_jobs_response, get_job_by_id, query_jobs
from backend.services.llm_evaluation_service import llm_evaluate_pipeline_item
from backend.services.pipeline_service import add_jobs_to_pipeline, delete_pipeline_item, read_pipeline, read_pipeline_report, update_pipeline_item_status
from backend.services.project_service import (
    config_payload,
    default_project_name,
    project_names,
    resolve_project,
    save_form_config,
    stats_for_project,
)
from backend.services.resume_service import generate_resume_draft, generate_resume_suggestions, list_resume_items, read_resume_draft, read_resume_suggestion
from backend.services.task_service import TaskManager
from crawler.boss import load_config

app = FastAPI(title="BossSpider Web Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

task_manager = TaskManager()


@app.get("/api/projects")
def list_projects():
    return {"projects": project_names(), "defaultProject": default_project_name()}


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


@app.get("/api/jobs")
def get_jobs(
    project: Optional[str] = None,
    q: str = "",
    limit: int = Query(default=20000, ge=1, le=20000),
    offset: int = Query(default=0, ge=0),
):
    return query_jobs(resolve_project(project), q.strip(), limit, offset)


@app.get("/api/jobs/export")
def export_jobs(project: Optional[str] = None, q: str = ""):
    rows = query_jobs(resolve_project(project), q.strip(), limit=50000, offset=0)["items"]
    return export_jobs_response(rows)


@app.get("/api/jobs/item")
def get_job_item(project: str, jobId: int):
    return get_job_by_id(resolve_project(project), jobId)


@app.post("/api/jobs/score")
def score_job_rows(payload: ScoreJobsRequest):
    return score_jobs(payload.project, payload.jobIds)


@app.get("/api/pipeline")
def get_pipeline():
    return read_pipeline()


@app.get("/api/pipeline/report")
def get_pipeline_report(sourceKey: str):
    return read_pipeline_report(sourceKey)


@app.get("/api/greetings/draft")
def get_greeting_draft(sourceKey: str):
    return read_greeting_draft(sourceKey)


@app.put("/api/greetings/draft")
def update_greeting_draft(payload: GreetingDraftSaveRequest):
    return save_greeting_draft(payload.sourceKey, payload.editedText, payload.status)


@app.post("/api/pipeline/jobs")
def add_pipeline_jobs(payload: AddJobsToPipelineRequest):
    return add_jobs_to_pipeline(payload.project, payload.jobIds)


@app.post("/api/pipeline/status")
def update_pipeline_status(payload: PipelineStatusRequest):
    return update_pipeline_item_status(payload.sourceKey, payload.decisionStatus)


@app.delete("/api/pipeline/item")
def delete_pipeline(payload: PipelineDeleteRequest):
    return delete_pipeline_item(payload.sourceKey)


@app.post("/api/pipeline/evaluate")
def evaluate_pipeline(payload: EvaluatePipelineItemRequest):
    result = evaluate_pipeline_item(payload.sourceKey)
    return {**result, "pipeline": read_pipeline()}


@app.post("/api/pipeline/score")
def score_pipeline(payload: ScorePipelineRequest):
    return score_pipeline_items(payload.sourceKeys)


@app.post("/api/pipeline/llm-evaluate")
def llm_evaluate_pipeline(payload: LlmEvaluatePipelineItemRequest):
    return llm_evaluate_pipeline_item(payload.sourceKey)


@app.post("/api/resume/suggestions")
def create_resume_suggestions(payload: ResumeSuggestionRequest):
    return generate_resume_suggestions(payload.sourceKey)


@app.get("/api/resume/items")
def get_resume_items():
    return list_resume_items()


@app.get("/api/resume/suggestion")
def get_resume_suggestion(sourceKey: str):
    return read_resume_suggestion(sourceKey)


@app.post("/api/resume/draft")
def create_resume_draft(payload: ResumeDraftRequest):
    return generate_resume_draft(payload.sourceKey, payload.approvedSuggestionIds, payload.userNotes)


@app.get("/api/resume/draft")
def get_resume_draft(sourceKey: str):
    return read_resume_draft(sourceKey)


@app.get("/api/interview/items")
def get_interview_items():
    return list_interview_items()


@app.get("/api/interview/story-bank")
def get_interview_story_bank():
    return read_story_bank()


@app.put("/api/interview/story-bank")
def update_interview_story_bank(payload: StoryBankSaveRequest):
    return save_story_bank([story.model_dump() for story in payload.stories])


@app.get("/api/interview/story-drafts")
def get_interview_story_drafts():
    return read_story_drafts()


@app.put("/api/interview/story-drafts")
def update_interview_story_drafts(payload: StoryDraftsSaveRequest):
    return save_story_drafts([draft.model_dump() for draft in payload.drafts])


@app.post("/api/interview/story-drafts/promote")
def confirm_interview_story_draft(payload: StoryDraftPromoteRequest):
    return promote_story_draft(payload.draftId, payload.draft.model_dump())


@app.post("/api/interview/prep")
def create_interview_prep(payload: InterviewPrepRequest):
    return generate_interview_prep(payload.sourceKey, payload.userNotes)


@app.get("/api/interview/prep")
def get_interview_prep(sourceKey: str):
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
