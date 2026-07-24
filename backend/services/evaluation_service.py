import datetime as dt
import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services.job_service import get_jobs_by_ids
from backend.services.pipeline_service import find_pipeline_item, read_pipeline, update_pipeline_item_metadata
from backend.services.project_service import resolve_project
from backend.services.scoring_config import scoring_config_for_project
from backend.services.score_store import update_job_score, update_job_scores
from backend.storage.paths import BASE_DIR
from backend.services.workspace_service import workspace_path

CV_PATH = workspace_path("cv.md")

EDU_LEVELS = {
    "不限": 0,
    "学历不限": 0,
    "中专": 1,
    "高中": 1,
    "大专": 2,
    "专科": 2,
    "本科": 3,
    "硕士": 4,
    "研究生": 4,
    "博士": 5,
}

CN_NUMBERS = {
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


def _load_cv() -> str:
    return CV_PATH.read_text(encoding="utf-8") if CV_PATH.exists() else ""


def _extract_terms(
    job: dict[str, Any],
    scoring_config: dict[str, Any],
    target_keywords: list[str] | None = None,
) -> list[str]:
    text = "\n".join(
        str(part or "")
        for part in [
            job.get("title"),
            job.get("desc"),
        ]
    ).lower()
    terms: list[str] = []
    keyword_hints = scoring_config.get("keywordHints") if isinstance(scoring_config.get("keywordHints"), list) else []
    candidates = list(keyword_hints) + list(target_keywords or [])
    seen = set()
    for hint in candidates:
        term = str(hint or "").strip()
        key = term.casefold()
        if term and key not in seen and key in text:
            seen.add(key)
            terms.append(term)
    return terms[:28]


def _cn_number_to_int(value: str) -> int | None:
    if not value:
        return None
    if value in CN_NUMBERS:
        return CN_NUMBERS[value]
    if "十" in value:
        left, _, right = value.partition("十")
        tens = CN_NUMBERS.get(left, 1 if not left else 0)
        ones = CN_NUMBERS.get(right, 0) if right else 0
        return tens * 10 + ones
    return None


def _candidate_years(cv_text: str) -> float | None:
    cv_text = re.sub(r"[*_`#>\-]", "", cv_text)
    patterns = [
        r"工作经验[：:\s]*(\d+(?:\.\d+)?)\s*年",
        r"(\d+(?:\.\d+)?)\s*年(?:以上)?(?:工作|开发|研发|行业)?经验",
        r"工作经验[：:\s]*([一二两三四五六七八九十]+)\s*年",
        r"([一二两三四五六七八九十]+)\s*年(?:以上)?(?:工作|开发|研发|行业)?经验",
    ]
    for pattern in patterns:
        match = re.search(pattern, cv_text)
        if not match:
            continue
        raw = match.group(1)
        if raw.replace(".", "", 1).isdigit():
            return float(raw)
        parsed = _cn_number_to_int(raw)
        if parsed is not None:
            return float(parsed)
    return None


def _required_years(exp_text: str, desc: str) -> tuple[float | None, str]:
    text = f"{exp_text or ''}\n{desc or ''}"
    if re.search(r"经验不限|不限经验|无经验|应届", text):
        return 0.0, exp_text or "经验不限"
    patterns = [
        r"(\d+(?:\.\d+)?)\s*[-~至到]\s*\d+(?:\.\d+)?\s*年",
        r"(\d+(?:\.\d+)?)\s*年(?:以上|\+|及以上)",
        r"至少\s*(\d+(?:\.\d+)?)\s*年",
        r"(\d+(?:\.\d+)?)\s*年以上",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return float(match.group(1)), exp_text or match.group(0)
    return None, exp_text or ""


def _education_level(text: str) -> tuple[int | None, str]:
    if not text:
        return None, ""
    for label, level in sorted(EDU_LEVELS.items(), key=lambda item: len(item[0]), reverse=True):
        if label in text:
            return level, label
    return None, text


def _candidate_education(cv_text: str) -> tuple[int | None, str]:
    candidates = []
    for label, level in EDU_LEVELS.items():
        if level > 0 and label in cv_text:
            candidates.append((level, label))
    if not candidates:
        return None, ""
    level, label = max(candidates, key=lambda item: item[0])
    return level, label


def _gate_metrics(
    job: dict[str, Any],
    cv_text: str,
    scoring_config: dict[str, Any] | None = None,
    experience_gap_years: float = 1,
) -> dict[str, Any]:
    candidate_years = _candidate_years(cv_text)
    required_years, exp_label = _required_years(job.get("exp") or "", job.get("desc") or "")
    candidate_edu, candidate_edu_label = _candidate_education(cv_text)
    required_edu, required_edu_label = _education_level(job.get("edu") or "")

    exp_risk = "unknown"
    exp_signal = None
    if required_years == 0:
        exp_risk = "matched"
        exp_signal = 1.0
    elif required_years is not None and candidate_years is not None:
        gap = required_years - candidate_years
        if gap <= 0:
            exp_risk = "matched"
            exp_signal = 1.0
        elif gap <= max(0, float(experience_gap_years)):
            exp_risk = "near"
            exp_signal = 0.6
        else:
            exp_risk = "risk"
            exp_signal = 0.0

    edu_risk = "unknown"
    edu_signal = None
    if required_edu == 0:
        edu_risk = "matched"
        edu_signal = 1.0
    elif required_edu is not None and candidate_edu is not None:
        gap = required_edu - candidate_edu
        if gap <= 0:
            edu_risk = "matched"
            edu_signal = 1.0
        elif gap <= 1:
            edu_risk = "near"
            edu_signal = 0.6
        else:
            edu_risk = "risk"
            edu_signal = 0.0

    return {
        "candidateYears": candidate_years,
        "requiredYears": required_years,
        "experienceLabel": exp_label,
        "experienceRisk": exp_risk,
        "experienceSignal": round(exp_signal * 100, 1) if exp_signal is not None else None,
        "candidateEducation": candidate_edu_label,
        "requiredEducation": required_edu_label,
        "educationRisk": edu_risk,
        "educationSignal": round(edu_signal * 100, 1) if edu_signal is not None else None,
    }


def _score(
    job: dict[str, Any],
    cv_text: str,
    terms: list[str],
    scoring_config: dict[str, Any],
    min_salary: float | None = None,
    experience_gap_years: float = 1,
    target_keywords: list[str] | None = None,
) -> dict[str, Any]:
    """Calculate explainable scoring v2 with fixed internal weights."""
    cv_l = cv_text.casefold()
    matched = [term for term in terms if term.casefold() in cv_l]
    missing = [term for term in terms if term.casefold() not in cv_l]
    keyword_known = bool(terms)
    coverage = len(matched) / len(terms) if keyword_known else None

    gates = _gate_metrics(job, cv_text, scoring_config, experience_gap_years)
    avg = float(job.get("avg") or 0)
    salary_known = bool(min_salary and float(min_salary) > 0 and avg > 0)
    salary_match = None if not salary_known else ("matched" if avg >= float(min_salary) else "risk")

    components: list[tuple[float, float]] = []
    if coverage is not None:
        components.append((coverage, 2.0))
    if salary_match is not None:
        components.append((1.0 if salary_match == "matched" else 0.0, 1.0))
    if gates["experienceRisk"] != "unknown":
        components.append((1.0 if gates["experienceRisk"] == "matched" else 0.6 if gates["experienceRisk"] == "near" else 0.0, 1.0))
    if gates["educationRisk"] != "unknown":
        components.append((1.0 if gates["educationRisk"] == "matched" else 0.6 if gates["educationRisk"] == "near" else 0.0, 1.0))
    normalised = sum(value * weight for value, weight in components) / sum(weight for _, weight in components) if components else 0.0
    final = max(1.0, min(5.0, round(1.0 + normalised * 4.0, 1)))

    title = str(job.get("title") or "")
    target_hits = [str(term).strip() for term in (target_keywords or []) if str(term).strip().casefold() in title.casefold()]
    desc_len = len(job.get("desc") or "")
    known_fields = sum([bool(avg), gates["experienceRisk"] != "unknown", gates["educationRisk"] != "unknown"])
    confidence = "high" if desc_len >= 200 and known_fields >= 2 else "medium" if desc_len >= 80 or known_fields >= 1 else "low"

    reasons: list[str] = []
    reason_codes: list[str] = []
    if target_hits:
        reasons.append(f"命中 {'、'.join(target_hits[:3])}")
        reason_codes.append("target_keyword_hit")
    if matched:
        reasons.append(f"简历命中 {'、'.join(matched[:3])}")
        reason_codes.append("cv_keyword_match")
    if missing:
        reasons.append(f"简历缺少 {'、'.join(missing[:2])}")
        reason_codes.append("cv_keyword_missing")
    if gates["experienceRisk"] == "risk":
        reasons.append(f"经验要求高于简历约 {max(1, round((gates['requiredYears'] or 0) - (gates['candidateYears'] or 0), 1))} 年")
        reason_codes.append("experience_risk")
    elif gates["experienceRisk"] == "near":
        reasons.append("经验要求接近当前经历")
        reason_codes.append("experience_near")
    elif gates["experienceRisk"] == "unknown":
        reasons.append("经验要求或简历经历信息不足")
        reason_codes.append("experience_unknown")
    if gates["educationRisk"] == "risk":
        reasons.append("学历要求存在差距")
        reason_codes.append("education_risk")
    elif gates["educationRisk"] == "unknown":
        reasons.append("学历信息不足")
        reason_codes.append("education_unknown")
    if salary_match == "risk":
        reasons.append("薪资低于期望")
        reason_codes.append("salary_risk")
    elif salary_match is None:
        reasons.append("薪资缺失或面议")
        reason_codes.append("salary_unknown")
    if confidence != "high":
        reasons.append("岗位信息不完整，判断可信度有限")
        reason_codes.append("incomplete_job_info")

    if gates["experienceRisk"] == "risk" or gates["educationRisk"] == "risk":
        fit = "存在明显门槛"
    elif normalised >= 0.7:
        fit = "优先查看"
    elif normalised >= 0.45:
        fit = "可以看看"
    else:
        fit = "低相关"

    keyword_coverage = {
        "status": "known" if keyword_known else "unknown",
        "matchedTerms": matched[:12],
        "missingTerms": missing[:12],
        "coverage": round(coverage * 100, 1) if coverage is not None else None,
    }
    return {
        "scoringVersion": 2,
        "score": final,
        "coverage": keyword_coverage["coverage"],
        "jdQuality": None,
        "salarySignal": 100.0 if salary_match == "matched" else 0.0 if salary_match == "risk" else None,
        "salaryRisk": salary_match,
        "salaryMatch": salary_match,
        "keywordCoverage": keyword_coverage,
        **gates,
        "confidence": confidence,
        "reasons": reasons[:5],
        "reasonCodes": reason_codes[:8],
        "fitLevel": fit,
        "matchedTerms": matched,
        "missingTerms": missing[:12],
    }


def score_pipeline_item(source_key: str) -> dict[str, Any]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    project = item.get("project")
    job_id = item.get("jobId")
    if not project or not job_id:
        raise HTTPException(status_code=400, detail="Pipeline item is missing project/jobId metadata")

    project_dir = resolve_project(project)
    jobs = get_jobs_by_ids(project_dir, [int(job_id)])
    if not jobs:
        raise HTTPException(status_code=404, detail=f"Job not found: {project}#{job_id}")
    job = jobs[0]
    cv_text = _load_cv()
    scoring_config = scoring_config_for_project(project_dir)
    from crawler.boss import load_config
    project_config = load_config(str(project_dir))
    target_keywords = project_config.get("relevance_keywords") or project_config.get("keywords") or []
    terms = _extract_terms(job, scoring_config, target_keywords)
    metrics = _score(
        job,
        cv_text,
        terms,
        scoring_config,
        min_salary=project_config.get("min_salary"),
        experience_gap_years=project_config.get("experience_gap_years", 1),
        target_keywords=target_keywords,
    )
    update_job_score(project_dir.name, int(job_id), metrics)

    update_pipeline_item_metadata(
        source_key,
        {
            "score": metrics["score"],
            "fitLevel": metrics["fitLevel"],
            "coverage": metrics["coverage"],
            "jdQuality": metrics["jdQuality"],
            "salarySignal": metrics["salarySignal"],
            "experienceSignal": metrics["experienceSignal"],
            "experienceRisk": metrics["experienceRisk"],
            "experienceLabel": metrics["experienceLabel"],
            "candidateYears": metrics["candidateYears"],
            "requiredYears": metrics["requiredYears"],
            "educationSignal": metrics["educationSignal"],
            "educationRisk": metrics["educationRisk"],
            "candidateEducation": metrics["candidateEducation"],
            "requiredEducation": metrics["requiredEducation"],
            "matchedTerms": metrics["matchedTerms"][:12],
            "missingTerms": metrics["missingTerms"][:12],
            "scoringVersion": metrics["scoringVersion"],
            "keywordCoverage": metrics["keywordCoverage"],
            "salaryRisk": metrics["salaryRisk"],
            "salaryMatch": metrics["salaryMatch"],
            "confidence": metrics["confidence"],
            "reasons": metrics["reasons"],
            "reasonCodes": metrics["reasonCodes"],
            "scoredAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        },
    )

    return {
        "ok": True,
        "sourceKey": source_key,
        "score": metrics["score"],
        "fitLevel": metrics["fitLevel"],
        "metrics": metrics,
    }


def score_jobs(project: str, job_ids: list[int]) -> dict[str, Any]:
    project_dir = resolve_project(project)
    jobs = get_jobs_by_ids(project_dir, job_ids)
    found_ids = {int(job["id"]) for job in jobs}
    cv_text = _load_cv()
    scoring_config = scoring_config_for_project(project_dir)
    from crawler.boss import load_config
    project_config = load_config(str(project_dir))
    target_keywords = project_config.get("relevance_keywords") or project_config.get("keywords") or []
    pending_updates: list[tuple[int, dict[str, Any]]] = []
    errors = []
    for job in jobs:
        try:
            metrics = _score(
                job,
                cv_text,
                _extract_terms(job, scoring_config, target_keywords),
                scoring_config,
                min_salary=project_config.get("min_salary"),
                experience_gap_years=project_config.get("experience_gap_years", 1),
                target_keywords=target_keywords,
            )
            pending_updates.append((int(job["id"]), metrics))
        except Exception as exc:
            errors.append({"jobId": int(job["id"]), "error": str(exc)})

    payloads = update_job_scores(project_dir.name, pending_updates)
    scored = [
        {
            "project": project_dir.name,
            "jobId": job_id,
            "score": cached.get("score"),
            "fitLevel": cached.get("fitLevel", ""),
            "metrics": cached,
        }
        for job_id, cached in payloads.items()
    ]

    missing = [int(job_id) for job_id in job_ids if int(job_id) not in found_ids]
    for job_id in missing:
        errors.append({"jobId": job_id, "error": f"Job not found: {project_dir.name}#{job_id}"})

    return {
        "ok": not errors,
        "project": project_dir.name,
        "scored": len(scored),
        "results": scored,
        "errors": errors,
    }


def score_pipeline_items(source_keys: list[str] | None = None) -> dict[str, Any]:
    pipeline = read_pipeline()
    keys = source_keys or [item["sourceKey"] for item in pipeline["pending"] if item.get("sourceKey")]
    scored = []
    errors = []
    for source_key in keys:
        try:
            scored.append(score_pipeline_item(source_key))
        except Exception as exc:
            errors.append({"sourceKey": source_key, "error": str(exc)})
    return {
        "ok": not errors,
        "scored": len(scored),
        "errors": errors,
        "pipeline": read_pipeline(),
    }


evaluate_pipeline_item = score_pipeline_item
