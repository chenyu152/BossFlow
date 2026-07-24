import datetime as dt
import json
from pathlib import Path
from typing import Any

from backend.storage.paths import BASE_DIR
from backend.services.workspace_service import workspace_path

DATA_DIR = workspace_path("data")
SCORES_PATH = workspace_path("data/job_scores.json")

SCORE_FIELDS = [
    "scoringVersion",
    "score",
    "fitLevel",
    "coverage",
    "jdQuality",
    "salarySignal",
    "salaryRisk",
    "salaryMatch",
    "keywordCoverage",
    "experienceSignal",
    "experienceRisk",
    "experienceLabel",
    "candidateYears",
    "requiredYears",
    "educationSignal",
    "educationRisk",
    "candidateEducation",
    "requiredEducation",
    "matchedTerms",
    "missingTerms",
    "confidence",
    "reasons",
    "reasonCodes",
    "scoredAt",
]


def _key(project: str, job_id: int | str) -> str:
    return f"{project}:{int(job_id)}"


def read_scores() -> dict[str, dict[str, Any]]:
    if not SCORES_PATH.exists():
        return {}
    try:
        data = json.loads(SCORES_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def write_scores(scores: dict[str, dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCORES_PATH.write_text(json.dumps(scores, ensure_ascii=False, indent=2), encoding="utf-8")


def get_job_score(project: str, job_id: int | str) -> dict[str, Any]:
    return read_scores().get(_key(project, job_id), {})


def update_job_score(project: str, job_id: int | str, metrics: dict[str, Any]) -> dict[str, Any]:
    scores = read_scores()
    payload = score_payload(metrics)
    scores[_key(project, job_id)] = payload
    write_scores(scores)
    return payload


def score_payload(metrics: dict[str, Any], scored_at: str | None = None) -> dict[str, Any]:
    payload = {field: metrics.get(field) for field in SCORE_FIELDS if field in metrics}
    payload["scoredAt"] = scored_at or dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return payload


def update_job_scores(project: str, scored_items: list[tuple[int | str, dict[str, Any]]]) -> dict[int, dict[str, Any]]:
    if not scored_items:
        return {}
    scores = read_scores()
    scored_at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payloads: dict[int, dict[str, Any]] = {}
    for job_id, metrics in scored_items:
        numeric_id = int(job_id)
        payload = score_payload(metrics, scored_at)
        scores[_key(project, numeric_id)] = payload
        payloads[numeric_id] = payload
    write_scores(scores)
    return payloads


def apply_scores_to_jobs(project: str, jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scores = read_scores()
    for job in jobs:
        score = scores.get(_key(project, job["id"]), {})
        for field in SCORE_FIELDS:
            if field in score:
                job[field] = score[field]
    return jobs
