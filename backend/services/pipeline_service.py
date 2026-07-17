import datetime as dt
import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services.job_service import get_jobs_by_ids
from backend.services.project_service import resolve_project
from backend.storage.file_lock import exclusive_file_lock
from backend.storage.paths import BASE_DIR
from backend.services.workspace_service import workspace_path

DATA_DIR = workspace_path("data")
PIPELINE_PATH = workspace_path("data/pipeline.md")
PIPELINE_LOCK_PATH = workspace_path("data/.pipeline.lock")
PIPELINE_SCHEMA_VERSION = 1
PIPELINE_META_MARKER = "<!-- bossspider-pipeline:"
REPORTS_DIR = workspace_path("reports/jobs")
RESUMES_DIR = workspace_path("output/resumes")
INTERVIEW_OUTPUT_DIR = workspace_path("output/interview-prep")
DECISION_STATUSES = {"needs_llm", "needs_review", "ready_to_greet", "greeted", "interviewing", "skipped", "archived"}


def _pipeline_header() -> str:
    return f'{PIPELINE_META_MARKER} {json.dumps({"schemaVersion": PIPELINE_SCHEMA_VERSION}, separators=(",", ":"))} -->'


def _default_pipeline_text() -> str:
    return (
        "# Pipeline\n"
        f"{_pipeline_header()}\n\n"
        "## Pending\n\n"
        "## Processed\n"
    )


def _ensure_pipeline_file_unlocked() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PIPELINE_PATH.exists():
        PIPELINE_PATH.write_text(_default_pipeline_text(), encoding="utf-8")


def ensure_pipeline_file() -> None:
    with exclusive_file_lock(PIPELINE_LOCK_PATH):
        _ensure_pipeline_file_unlocked()
        _load_pipeline_text_unlocked()


def _pipeline_metadata_from_text(text: str) -> dict[str, Any]:
    for line in text.splitlines():
        if PIPELINE_META_MARKER not in line:
            continue
        raw = line.split(PIPELINE_META_MARKER, 1)[1].split("-->", 1)[0].strip()
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _schema_version_from_text(text: str) -> int:
    version = _pipeline_metadata_from_text(text).get("schemaVersion")
    try:
        return int(version)
    except (TypeError, ValueError):
        return 0


def _migrate_pipeline_text(text: str) -> tuple[str, bool]:
    if not text.strip():
        return _default_pipeline_text(), True

    lines = text.splitlines()
    changed = False

    if not any(line.strip() == "# Pipeline" for line in lines):
        lines.insert(0, "# Pipeline")
        changed = True

    meta_index = next((index for index, line in enumerate(lines) if PIPELINE_META_MARKER in line), None)
    if meta_index is None:
        title_index = next((index for index, line in enumerate(lines) if line.strip() == "# Pipeline"), 0)
        lines.insert(title_index + 1, _pipeline_header())
        changed = True
    else:
        meta = _pipeline_metadata_from_text("\n".join(lines))
        if meta.get("schemaVersion") != PIPELINE_SCHEMA_VERSION:
            meta["schemaVersion"] = PIPELINE_SCHEMA_VERSION
            lines[meta_index] = f"{PIPELINE_META_MARKER} {json.dumps(meta, ensure_ascii=False, separators=(',', ':'))} -->"
            changed = True

    stripped = {line.strip() for line in lines}
    if "## Pending" not in stripped:
        lines.extend(["", "## Pending"])
        changed = True
    if "## Processed" not in stripped:
        lines.extend(["", "## Processed"])
        changed = True

    migrated = "\n".join(lines).rstrip() + "\n"
    return migrated, changed


def _load_pipeline_text_unlocked() -> str:
    _ensure_pipeline_file_unlocked()
    text = PIPELINE_PATH.read_text(encoding="utf-8")
    migrated, changed = _migrate_pipeline_text(text)
    if changed:
        PIPELINE_PATH.write_text(migrated, encoding="utf-8")
    return migrated


def _split_sections(text: str) -> tuple[list[str], list[str], list[str]]:
    lines = text.splitlines()
    before: list[str] = []
    pending: list[str] = []
    processed: list[str] = []
    current = "before"
    for line in lines:
        if line.strip() == "## Pending":
            before.append(line)
            current = "pending"
            continue
        if line.strip() == "## Processed":
            current = "processed"
            processed.append(line)
            continue
        if current == "before":
            before.append(line)
        elif current == "pending":
            pending.append(line)
        else:
            processed.append(line)
    if not any(line.strip() == "## Pending" for line in before):
        before.extend(["", "## Pending"])
    if not any(line.strip() == "## Processed" for line in processed):
        processed.insert(0, "## Processed")
    return before, pending, processed


def _metadata_from_line(line: str) -> dict[str, Any]:
    marker = "<!-- bossspider:"
    if marker not in line:
        return {}
    raw = line.split(marker, 1)[1].split("-->", 1)[0].strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _evaluation_profile_version(meta: dict[str, Any]) -> int:
    try:
        explicit_version = int(meta.get("evaluationProfileVersion") or 0)
    except (TypeError, ValueError):
        explicit_version = 0
    if explicit_version:
        return explicit_version

    report_value = str(meta.get("reportPath") or "").strip()
    if not report_value:
        return 0
    try:
        json_path = Path(report_value).with_suffix(".json").resolve()
        reports_root = REPORTS_DIR.resolve()
        if json_path != reports_root and reports_root not in json_path.parents:
            return 0
        payload = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return 0
    if not isinstance(payload, dict):
        return 0
    try:
        sidecar_version = int(payload.get("evaluationProfileVersion") or 0)
    except (TypeError, ValueError):
        sidecar_version = 0
    if sidecar_version:
        return sidecar_version

    requirements = payload.get("requirementAssessment")
    if (
        isinstance(requirements, list)
        and requirements
        and all(
            isinstance(item, dict)
            and item.get("canonicalKey")
            and item.get("capabilityName")
            and "requiredProficiency" in item
            for item in requirements
        )
    ):
        return 2
    return 0


def _item_from_line(line: str, status: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped.startswith("- ["):
        return None
    content = stripped
    if "-->" in content:
        content = content.split("<!--", 1)[0].strip()
    content = content.removeprefix("- [ ]").removeprefix("- [x]").strip()
    parts = [part.strip() for part in content.split("|")]
    meta = _metadata_from_line(line)
    return {
        "status": status,
        "company": parts[0] if len(parts) > 0 else "",
        "title": parts[1] if len(parts) > 1 else "",
        "city": parts[2] if len(parts) > 2 else "",
        "salary": parts[3] if len(parts) > 3 else "",
        "url": parts[4] if len(parts) > 4 else meta.get("url", ""),
        "project": meta.get("project", ""),
        "jobId": meta.get("jobId"),
        "avg": meta.get("avg"),
        "addedAt": meta.get("addedAt", ""),
        "sourceKey": meta.get("sourceKey", ""),
        "score": meta.get("score"),
        "fitLevel": meta.get("fitLevel", ""),
        "coverage": meta.get("coverage"),
        "jdQuality": meta.get("jdQuality"),
        "salarySignal": meta.get("salarySignal"),
        "experienceSignal": meta.get("experienceSignal"),
        "experienceRisk": meta.get("experienceRisk", ""),
        "experienceLabel": meta.get("experienceLabel", ""),
        "candidateYears": meta.get("candidateYears"),
        "requiredYears": meta.get("requiredYears"),
        "educationSignal": meta.get("educationSignal"),
        "educationRisk": meta.get("educationRisk", ""),
        "candidateEducation": meta.get("candidateEducation", ""),
        "requiredEducation": meta.get("requiredEducation", ""),
        "matchedTerms": meta.get("matchedTerms") or [],
        "missingTerms": meta.get("missingTerms") or [],
        "scoredAt": meta.get("scoredAt", ""),
        "reportPath": meta.get("reportPath", ""),
        "reportId": meta.get("reportId", ""),
        "evaluatedAt": meta.get("evaluatedAt", ""),
        "llmScore": meta.get("llmScore"),
        "llmFitLevel": meta.get("llmFitLevel", ""),
        "llmRecommendation": meta.get("llmRecommendation", ""),
        "greetingReady": meta.get("greetingReady", ""),
        "resumeSuggestionId": meta.get("resumeSuggestionId", ""),
        "resumeSuggestionPath": meta.get("resumeSuggestionPath", ""),
        "resumeSuggestionJsonPath": meta.get("resumeSuggestionJsonPath", ""),
        "resumeSuggestedAt": meta.get("resumeSuggestedAt", ""),
        "resumeDraftId": meta.get("resumeDraftId", ""),
        "resumeDraftPath": meta.get("resumeDraftPath", ""),
        "resumeDraftJsonPath": meta.get("resumeDraftJsonPath", ""),
        "resumeDraftedAt": meta.get("resumeDraftedAt", ""),
        "interviewPrepId": meta.get("interviewPrepId", ""),
        "interviewPrepPath": meta.get("interviewPrepPath", ""),
        "interviewPrepJsonPath": meta.get("interviewPrepJsonPath", ""),
        "interviewPreparedAt": meta.get("interviewPreparedAt", ""),
        "requirementCount": meta.get("requirementCount", 0),
        "supportedRequirementCount": meta.get("supportedRequirementCount", 0),
        "potentialEvidenceRequirementCount": meta.get("potentialEvidenceRequirementCount", 0),
        "unresolvedRequirementCount": meta.get("unresolvedRequirementCount", 0),
        "blockingGapCount": meta.get("blockingGapCount", 0),
        "requirementAssessedAt": meta.get("requirementAssessedAt", ""),
        "evaluationProfileVersion": _evaluation_profile_version(meta),
        "decisionStatus": meta.get("decisionStatus") or ("needs_review" if meta.get("reportPath") else "needs_llm"),
        "raw": line,
    }


def _pipeline_response_from_text(text: str) -> dict[str, Any]:
    _, pending_lines, processed_lines = _split_sections(text)
    pending = [item for line in pending_lines if (item := _item_from_line(line, "pending"))]
    processed = [item for line in processed_lines if (item := _item_from_line(line, "processed"))]
    return {
        "path": str(PIPELINE_PATH),
        "schemaVersion": _schema_version_from_text(text),
        "pending": pending,
        "processed": processed,
        "counts": {
            "pending": len(pending),
            "processed": len(processed),
        },
    }


def read_pipeline() -> dict[str, Any]:
    with exclusive_file_lock(PIPELINE_LOCK_PATH):
        text = _load_pipeline_text_unlocked()
        return _pipeline_response_from_text(text)


def _existing_keys(lines: list[str]) -> set[str]:
    keys: set[str] = set()
    for line in lines:
        item = _item_from_line(line, "any")
        if not item:
            continue
        if item.get("sourceKey"):
            keys.add(str(item["sourceKey"]))
        if item.get("url"):
            keys.add(f"url:{item['url']}")
    return keys


def _job_line(project: str, job: dict[str, Any]) -> str:
    url = job.get("url") or ""
    source_key = f"{project}:{job['id']}"
    meta = {
        "project": project,
        "jobId": job["id"],
        "avg": job.get("avg", 0),
        "url": url,
        "sourceKey": source_key,
        "addedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "decisionStatus": "needs_llm",
    }
    for field in [
        "score",
        "fitLevel",
        "coverage",
        "jdQuality",
        "salarySignal",
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
        "scoredAt",
    ]:
        if field in job:
            meta[field] = job[field]
    columns = [
        job.get("company") or "-",
        job.get("title") or "-",
        job.get("city") or "-",
        job.get("salary") or "-",
        url or "-",
    ]
    return f"- [ ] {' | '.join(columns)} <!-- bossspider: {json.dumps(meta, ensure_ascii=False, separators=(',', ':'))} -->"


def add_jobs_to_pipeline(project: str, job_ids: list[int]) -> dict[str, Any]:
    project_dir = resolve_project(project)
    jobs = get_jobs_by_ids(project_dir, job_ids)
    with exclusive_file_lock(PIPELINE_LOCK_PATH):
        text = _load_pipeline_text_unlocked()
        before, pending, processed = _split_sections(text)
        keys = _existing_keys([*pending, *processed])

        added_lines: list[str] = []
        skipped = 0
        for job in jobs:
            source_key = f"{project_dir.name}:{job['id']}"
            url_key = f"url:{job['url']}" if job.get("url") else ""
            if source_key in keys or (url_key and url_key in keys):
                skipped += 1
                continue
            line = _job_line(project_dir.name, job)
            added_lines.append(line)
            keys.add(source_key)
            if url_key:
                keys.add(url_key)

        pending_clean = [line for line in pending if line.strip()]
        if added_lines:
            pending_clean.extend(added_lines)

        out_lines = [*before, ""]
        out_lines.extend(pending_clean)
        out_lines.extend(["", *processed])
        next_text = "\n".join(out_lines).rstrip() + "\n"
        PIPELINE_PATH.write_text(next_text, encoding="utf-8")
        pipeline = _pipeline_response_from_text(next_text)
    return {
        "ok": True,
        "added": len(added_lines),
        "skipped": skipped,
        "missing": max(0, len(job_ids) - len(jobs)),
        **pipeline,
    }


def find_pipeline_item(source_key: str) -> dict[str, Any] | None:
    with exclusive_file_lock(PIPELINE_LOCK_PATH):
        pipeline = _pipeline_response_from_text(_load_pipeline_text_unlocked())
    for item in [*pipeline["pending"], *pipeline["processed"]]:
        if item.get("sourceKey") == source_key:
            return item
    return None


def update_pipeline_item_metadata(source_key: str, patch: dict[str, Any]) -> None:
    with exclusive_file_lock(PIPELINE_LOCK_PATH):
        text = _load_pipeline_text_unlocked()
        lines = text.splitlines()
        updated: list[str] = []
        for line in lines:
            meta = _metadata_from_line(line)
            if meta.get("sourceKey") != source_key:
                updated.append(line)
                continue
            meta.update(patch)
            visible = line.split("<!--", 1)[0].rstrip()
            updated.append(f"{visible} <!-- bossspider: {json.dumps(meta, ensure_ascii=False, separators=(',', ':'))} -->")
        PIPELINE_PATH.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")


def update_pipeline_item_status(source_key: str, decision_status: str) -> dict[str, Any]:
    if decision_status not in DECISION_STATUSES:
        raise HTTPException(status_code=400, detail=f"Unsupported decisionStatus: {decision_status}")
    update_pipeline_item_metadata(source_key, {"decisionStatus": decision_status})
    return read_pipeline()


def _safe_delete_report(path_value: str) -> list[str]:
    if not path_value:
        return []
    deleted: list[str] = []
    reports_root = REPORTS_DIR.resolve()
    candidates = [Path(path_value)]
    if candidates[0].suffix.lower() == ".md":
        candidates.append(candidates[0].with_suffix(".json"))
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if reports_root != resolved and reports_root not in resolved.parents:
            continue
        if resolved.exists() and resolved.is_file():
            resolved.unlink()
            deleted.append(str(resolved))
    return deleted


def _safe_delete_resume_artifact(path_value: str) -> list[str]:
    if not path_value:
        return []
    deleted: list[str] = []
    resumes_root = RESUMES_DIR.resolve()
    candidates = [Path(path_value)]
    if candidates[0].suffix.lower() == ".md":
        candidates.append(candidates[0].with_suffix(".json"))
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resumes_root != resolved and resumes_root not in resolved.parents:
            continue
        if resolved.exists() and resolved.is_file():
            resolved.unlink()
            deleted.append(str(resolved))
    return deleted


def _safe_delete_interview_artifact(path_value: str) -> list[str]:
    if not path_value:
        return []
    deleted: list[str] = []
    interview_root = INTERVIEW_OUTPUT_DIR.resolve()
    candidates = [Path(path_value)]
    if candidates[0].suffix.lower() == ".md":
        candidates.append(candidates[0].with_suffix(".json"))
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if interview_root != resolved and interview_root not in resolved.parents:
            continue
        if resolved.exists() and resolved.is_file():
            resolved.unlink()
            deleted.append(str(resolved))
    return deleted


def _safe_report_path(path_value: str) -> Path:
    if not path_value:
        raise HTTPException(status_code=404, detail="Pipeline item has no report")
    reports_root = REPORTS_DIR.resolve()
    try:
        resolved = Path(path_value).resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid report path") from exc
    if reports_root != resolved and reports_root not in resolved.parents:
        raise HTTPException(status_code=403, detail="Report path is outside the reports directory")
    if resolved.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only Markdown reports can be viewed")
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Report file not found")
    return resolved


def read_pipeline_report(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    report_path = _safe_report_path(str(item.get("reportPath") or ""))
    content = report_path.read_text(encoding="utf-8")
    return {
        "ok": True,
        "sourceKey": source_key,
        "reportId": item.get("reportId", ""),
        "reportPath": str(report_path),
        "title": f"{item.get('company') or ''} - {item.get('title') or ''}".strip(" -"),
        "content": content,
    }


def delete_pipeline_item(source_key: str) -> dict[str, Any]:
    with exclusive_file_lock(PIPELINE_LOCK_PATH):
        text = _load_pipeline_text_unlocked()
        lines = text.splitlines()
        updated: list[str] = []
        removed = False
        deleted_reports: list[str] = []
        deleted_resume_artifacts: list[str] = []
        deleted_interview_artifacts: list[str] = []
        for line in lines:
            meta = _metadata_from_line(line)
            if meta.get("sourceKey") != source_key:
                updated.append(line)
                continue
            removed = True
            deleted_reports.extend(_safe_delete_report(str(meta.get("reportPath") or "")))
            deleted_resume_artifacts.extend(_safe_delete_resume_artifact(str(meta.get("resumeSuggestionPath") or "")))
            deleted_resume_artifacts.extend(_safe_delete_resume_artifact(str(meta.get("resumeDraftPath") or "")))
            deleted_interview_artifacts.extend(_safe_delete_interview_artifact(str(meta.get("interviewPrepPath") or "")))
        if not removed:
            return {
                "ok": False,
                "deleted": False,
                "deletedReports": [],
                "deletedResumeArtifacts": [],
                "deletedInterviewArtifacts": [],
                **_pipeline_response_from_text(text),
            }
        next_text = "\n".join(updated).rstrip() + "\n"
        PIPELINE_PATH.write_text(next_text, encoding="utf-8")
    return {
        "ok": True,
        "deleted": True,
        "deletedReports": deleted_reports,
        "deletedResumeArtifacts": deleted_resume_artifacts,
        "deletedInterviewArtifacts": deleted_interview_artifacts,
        **_pipeline_response_from_text(next_text),
    }
