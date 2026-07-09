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

CV_PATH = BASE_DIR / "cv.md"

KEYWORD_HINTS = [
    "agent", "llm", "rag", "langchain", "prompt", "openai", "deepseek", "ai", "大模型", "智能体",
    "产品", "需求", "用户", "增长", "数据", "策略", "运营", "游戏", "系统", "数值", "策划",
    "python", "java", "go", "react", "后端", "前端", "架构", "平台", "工具", "自动化",
]

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


def _cfg_number(config: dict[str, Any], section: str, key: str, fallback: float) -> float:
    value = config.get(section, {}).get(key) if isinstance(config.get(section), dict) else None
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _cfg_weight(config: dict[str, Any], key: str, fallback: float) -> float:
    weights = config.get("weights") if isinstance(config.get("weights"), dict) else {}
    try:
        return float(weights.get(key))
    except (TypeError, ValueError):
        return fallback


def _extract_terms(job: dict[str, Any], scoring_config: dict[str, Any]) -> list[str]:
    text = "\n".join(
        str(part or "")
        for part in [
            job.get("title"),
            job.get("company"),
            job.get("desc"),
            " ".join(job.get("cats") or []),
            job.get("tier"),
        ]
    ).lower()
    terms: list[str] = []
    keyword_hints = scoring_config.get("keywordHints") if isinstance(scoring_config.get("keywordHints"), list) else KEYWORD_HINTS
    for hint in keyword_hints:
        if hint.lower() in text and hint not in terms:
            terms.append(hint)
    for token in re.findall(r"[A-Za-z][A-Za-z0-9+#.]{2,}", text):
        token_l = token.lower()
        if token_l not in terms and len(terms) < 28:
            terms.append(token_l)
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


def _gate_metrics(job: dict[str, Any], cv_text: str, scoring_config: dict[str, Any]) -> dict[str, Any]:
    candidate_years = _candidate_years(cv_text)
    required_years, exp_label = _required_years(job.get("exp") or "", job.get("desc") or "")
    candidate_edu, candidate_edu_label = _candidate_education(cv_text)
    required_edu, required_edu_label = _education_level(job.get("edu") or "")

    exp_risk = "unknown"
    exp_signal = _cfg_number(scoring_config, "experience", "unknownSignal", 0.82)
    if required_years == 0:
        exp_risk = "matched"
        exp_signal = 1.0
    elif required_years is not None and candidate_years is not None:
        gap = required_years - candidate_years
        if gap <= 0:
            exp_risk = "matched"
            exp_signal = 1.0
        elif gap <= _cfg_number(scoring_config, "experience", "nearYears", 1):
            exp_risk = "near"
            exp_signal = _cfg_number(scoring_config, "experience", "nearSignal", 0.72)
        else:
            exp_risk = "risk"
            exp_signal = _cfg_number(scoring_config, "experience", "riskSignal", 0.35)

    edu_risk = "unknown"
    edu_signal = _cfg_number(scoring_config, "education", "unknownSignal", 0.88)
    if required_edu == 0:
        edu_risk = "matched"
        edu_signal = 1.0
    elif required_edu is not None and candidate_edu is not None:
        gap = required_edu - candidate_edu
        if gap <= 0:
            edu_risk = "matched"
            edu_signal = 1.0
        elif gap <= _cfg_number(scoring_config, "education", "nearGap", 1):
            edu_risk = "near"
            edu_signal = _cfg_number(scoring_config, "education", "nearSignal", 0.7)
        else:
            edu_risk = "risk"
            edu_signal = _cfg_number(scoring_config, "education", "riskSignal", 0.35)

    return {
        "candidateYears": candidate_years,
        "requiredYears": required_years,
        "experienceLabel": exp_label,
        "experienceRisk": exp_risk,
        "experienceSignal": round(exp_signal * 100, 1),
        "candidateEducation": candidate_edu_label,
        "requiredEducation": required_edu_label,
        "educationRisk": edu_risk,
        "educationSignal": round(edu_signal * 100, 1),
    }


def _score(job: dict[str, Any], cv_text: str, terms: list[str], scoring_config: dict[str, Any]) -> dict[str, Any]:
    cv_l = cv_text.lower()
    matched = [term for term in terms if term.lower() in cv_l]
    missing = [term for term in terms if term.lower() not in cv_l]
    coverage = len(matched) / max(len(terms), 1)
    desc_len = len(job.get("desc") or "")
    jd_quality = (
        _cfg_number(scoring_config, "jdQuality", "highSignal", 1.0)
        if desc_len >= _cfg_number(scoring_config, "jdQuality", "highLength", 600)
        else _cfg_number(scoring_config, "jdQuality", "midSignal", 0.72)
        if desc_len >= _cfg_number(scoring_config, "jdQuality", "midLength", 200)
        else _cfg_number(scoring_config, "jdQuality", "lowSignal", 0.45)
    )
    avg = float(job.get("avg") or 0)
    salary_signal = (
        _cfg_number(scoring_config, "salary", "highSignal", 1.0)
        if avg >= _cfg_number(scoring_config, "salary", "highAvgK", 25)
        else _cfg_number(scoring_config, "salary", "midSignal", 0.85)
        if avg >= _cfg_number(scoring_config, "salary", "midAvgK", 15)
        else _cfg_number(scoring_config, "salary", "lowSignal", 0.7)
    )
    gates = _gate_metrics(job, cv_text, scoring_config)
    exp_signal = float(gates["experienceSignal"]) / 100
    edu_signal = float(gates["educationSignal"]) / 100
    try:
        base_score = float(scoring_config.get("baseScore"))
    except (TypeError, ValueError):
        base_score = 1.0
    raw = (
        base_score
        + coverage * _cfg_weight(scoring_config, "coverage", 2.0)
        + jd_quality * _cfg_weight(scoring_config, "jdQuality", 0.45)
        + salary_signal * _cfg_weight(scoring_config, "salary", 0.35)
        + exp_signal * _cfg_weight(scoring_config, "experience", 0.75)
        + edu_signal * _cfg_weight(scoring_config, "education", 0.45)
    )
    if gates["experienceRisk"] == "risk":
        raw = min(raw, _cfg_number(scoring_config, "experience", "riskCap", 3.1))
    if gates["educationRisk"] == "risk":
        raw = min(raw, _cfg_number(scoring_config, "education", "riskCap", 3.2))
    final = max(1.0, min(5.0, raw))
    fit = "Skip Unless Strategic"
    for level in scoring_config.get("fitLevels") or []:
        if final >= float(level.get("minScore") or 0):
            fit = str(level.get("label") or fit)
            break
    return {
        "score": round(final, 1),
        "coverage": round(coverage * 100, 1),
        "jdQuality": round(jd_quality * 100, 1),
        "salarySignal": round(salary_signal * 100, 1),
        **gates,
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
    terms = _extract_terms(job, scoring_config)
    metrics = _score(job, cv_text, terms, scoring_config)
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
    pending_updates: list[tuple[int, dict[str, Any]]] = []
    errors = []
    for job in jobs:
        try:
            metrics = _score(job, cv_text, _extract_terms(job, scoring_config), scoring_config)
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
