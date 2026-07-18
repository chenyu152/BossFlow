from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import os
import re
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.services.capability_service import (
    PROFICIENCY_RANK,
    atomicize_requirement,
    canonical_capability_label,
    canonicalize_capability_key,
    compact_requirement_text,
    highest_proficiency,
    infer_proficiency,
    is_proficiency_applicable,
    matching_capability_definitions,
    merge_requirement_assessments,
    normalize_canonical_key,
    normalize_proficiency,
)
from backend.storage.file_lock import exclusive_file_lock
from backend.storage.paths import BASE_DIR
from backend.services.workspace_service import workspace_path

DATA_DIR = workspace_path("data")
EVIDENCE_STORE_PATH = workspace_path("data/evidence-store.json")
EVIDENCE_LOCK_PATH = workspace_path("data/.evidence-store.lock")
EVIDENCE_SCHEMA_VERSION = 7

VERIFICATION_MODES = {"document_fact", "experience_fact", "preference", "behavior_example", "manual_review"}
IMPROVEMENT_TASK_TYPES = {"learn", "project", "strengthen", "translate"}

def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _stable_requirement_id(source_key: str, canonical_key: str) -> str:
    digest = hashlib.sha1(f"{source_key}|{canonical_key}".encode("utf-8")).hexdigest()[:12]
    return f"req-{digest}"


def _normalize_canonical_key(value: Any) -> str:
    return normalize_canonical_key(value)


def _capability_key(value: Any, category: Any = "") -> str:
    return canonicalize_capability_key(value, category)


def _canonical_group_id(canonical_key: str) -> str:
    digest = hashlib.sha1(canonical_key.encode("utf-8")).hexdigest()[:12]
    return f"cgrp-{digest}"


def _verification_mode(category: Any, value: Any = "") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in VERIFICATION_MODES:
        return normalized
    category_value = str(category or "other").strip().lower()
    if category_value == "education":
        return "document_fact"
    if category_value in {"location", "preference"}:
        return "preference"
    if category_value == "behavior":
        return "behavior_example"
    if category_value in {"skill", "experience"}:
        return "experience_fact"
    return "manual_review"


def _empty_store() -> dict[str, Any]:
    return {
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "capabilityRecords": [],
        "requirements": [],
        "evidenceItems": [],
        "coverages": [],
        "tasks": [],
        "updatedAt": _now(),
    }


def _merge_coverage_records(current: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    decision_rank = {
        "direct": 4,
        "source_document": 3,
        "canonical_reuse": 2,
        "assessment": 1,
        "": 0,
    }
    if decision_rank.get(str(incoming.get("decisionSource") or ""), 0) > decision_rank.get(
        str(current.get("decisionSource") or ""),
        0,
    ):
        base, extra = incoming, current
    else:
        base, extra = current, incoming
    merged = copy.deepcopy(base)
    merged["evidenceIds"] = list(dict.fromkeys([
        *(base.get("evidenceIds") or []),
        *(extra.get("evidenceIds") or []),
    ]))
    merged["candidateEvidenceRefs"] = list({
        (
            str(ref.get("sourceType") or ""),
            str(ref.get("quote") or ""),
            str(ref.get("locator") or ""),
        ): ref
        for ref in [
            *(base.get("candidateEvidenceRefs") or []),
            *(extra.get("candidateEvidenceRefs") or []),
        ]
        if isinstance(ref, dict) and ref.get("quote")
    }.values())
    merged["userProficiency"] = highest_proficiency([
        normalize_proficiency(base.get("userProficiency")),
        normalize_proficiency(extra.get("userProficiency")),
    ])
    return merged


def _migrate_atomic_capabilities(store: dict[str, Any]) -> bool:
    original_requirements = [
        item for item in store.get("requirements", [])
        if isinstance(item, dict)
    ]
    if not original_requirements:
        return False

    changed = False
    id_map: dict[str, list[str]] = {}
    requirements_by_id: dict[str, dict[str, Any]] = {}
    requirement_id_by_source_and_key: dict[tuple[str, str], str] = {}
    importance_rank = {"context": 0, "preferred": 1, "required": 2}

    for original in original_requirements:
        old_id = str(original.get("requirementId") or "")
        atoms = atomicize_requirement(original)
        if len(atoms) != 1 or any(
            atoms[0].get(field) != original.get(field)
            for field in (
                "canonicalKey",
                "capabilityName",
                "requiredProficiency",
                "proficiencyApplicable",
                "requirementGroupId",
                "requirementGroupMode",
                "requirementGroupLabel",
                "minimumSatisfied",
                "jdQuote",
            )
        ):
            changed = True
        mapped_ids: list[str] = []
        for atom in atoms:
            canonical_key = _capability_key(atom.get("canonicalKey"), atom.get("category"))
            if not canonical_key:
                continue
            source_key = str(atom.get("sourceKey") or "")
            group_key = (source_key, canonical_key)
            requirement_id = requirement_id_by_source_and_key.get(group_key, "")
            if not requirement_id:
                requirement_id = (
                    old_id
                    if len(atoms) == 1 and old_id
                    else _stable_requirement_id(source_key, canonical_key)
                    if source_key
                    else _new_id("req")
                )
                requirement_id_by_source_and_key[group_key] = requirement_id
            mapped_ids.append(requirement_id)
            next_item = {
                **atom,
                "requirementId": requirement_id,
                "canonicalKey": canonical_key,
                "canonicalGroupId": _canonical_group_id(canonical_key),
                "capabilityName": canonical_capability_label(
                    canonical_key,
                    str(atom.get("capabilityName") or atom.get("label") or ""),
                ),
                "requiredProficiency": normalize_proficiency(
                    atom.get("requiredProficiency"),
                    f"{atom.get('label') or ''} {atom.get('jdQuote') or ''}",
                ),
            }
            existing = requirements_by_id.get(requirement_id)
            if existing is None:
                requirements_by_id[requirement_id] = next_item
                continue
            changed = True
            if importance_rank.get(str(next_item.get("importance") or "context"), 0) > importance_rank.get(
                str(existing.get("importance") or "context"),
                0,
            ):
                existing["importance"] = next_item.get("importance")
            existing["requiredProficiency"] = highest_proficiency([
                str(existing.get("requiredProficiency") or "unspecified"),
                str(next_item.get("requiredProficiency") or "unspecified"),
            ])
            existing["extractionConfidence"] = max(
                float(existing.get("extractionConfidence") or 0),
                float(next_item.get("extractionConfidence") or 0),
            )
            existing["active"] = bool(existing.get("active", True) or next_item.get("active", True))
            quotes = [
                part
                for value in (existing.get("jdQuote"), next_item.get("jdQuote"))
                for part in compact_requirement_text(value).split("；")
                if part
            ]
            existing["jdQuote"] = "；".join(dict.fromkeys(quotes))
        if old_id:
            id_map[old_id] = list(dict.fromkeys(mapped_ids))

    next_coverages: dict[str, dict[str, Any]] = {}
    for coverage in store.get("coverages", []):
        if not isinstance(coverage, dict):
            continue
        old_id = str(coverage.get("requirementId") or "")
        target_ids = id_map.get(old_id, [old_id])
        for target_id in target_ids:
            if not target_id or target_id not in requirements_by_id:
                continue
            clone = copy.deepcopy(coverage)
            clone["requirementId"] = target_id
            reused_from = str(clone.get("reusedFromRequirementId") or "")
            if reused_from in id_map:
                clone["reusedFromRequirementId"] = (id_map[reused_from] or [""])[0]
            if target_id in next_coverages:
                next_coverages[target_id] = _merge_coverage_records(next_coverages[target_id], clone)
            else:
                next_coverages[target_id] = clone
        if target_ids != [old_id]:
            changed = True

    for item in store.get("evidenceItems", []):
        if not isinstance(item, dict):
            continue
        previous = [str(value) for value in item.get("requirementIds") or [] if value]
        replacement = list(dict.fromkeys(
            target
            for requirement_id in previous
            for target in id_map.get(requirement_id, [requirement_id])
            if target
        ))
        if replacement != previous:
            item["requirementIds"] = replacement
            changed = True

    for task in store.get("tasks", []):
        if not isinstance(task, dict):
            continue
        old_id = str(task.get("requirementId") or "")
        target_ids = id_map.get(old_id, [old_id])
        if target_ids and target_ids[0] != old_id:
            task["requirementId"] = target_ids[0]
            changed = True
        task.setdefault("currentProficiency", "unspecified")
        task.setdefault("targetProficiency", "working")

    store["requirements"] = list(requirements_by_id.values())
    store["coverages"] = list(next_coverages.values())
    return changed


def _infer_any_of_groups(store: dict[str, Any]) -> bool:
    candidates: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for requirement in store.get("requirements", []):
        if not isinstance(requirement, dict):
            continue
        source_key = str(requirement.get("sourceKey") or "")
        quote = str(requirement.get("jdQuote") or "").strip()
        if not source_key or not quote:
            continue
        if not re.search(
            r"(?:至少\s*(?:一|1)\s*(?:门|项|种|个)|任一|任选|二选一|三选一|其中之一|"
            r"(?i:\bone\s+of\b|\bany\s+of\b|\bat\s+least\s+one\b|\beither\b))",
            quote,
        ):
            continue
        candidates.setdefault((source_key, quote), []).append(requirement)

    changed = False
    for (source_key, quote), related in candidates.items():
        canonical_keys = {
            str(item.get("canonicalKey") or "")
            for item in related
            if item.get("canonicalKey")
        }
        if len(canonical_keys) < 2:
            continue
        digest = hashlib.sha1(f"{source_key}\0{quote}".encode("utf-8")).hexdigest()[:12]
        group_id = f"any-of-{digest}"
        for requirement in related:
            for field, value in (
                ("requirementGroupId", group_id),
                ("requirementGroupMode", "any_of"),
                ("requirementGroupLabel", quote),
                ("minimumSatisfied", 1),
            ):
                if requirement.get(field) != value:
                    requirement[field] = value
                    changed = True
    return changed


def _normalize_store(raw: Any) -> tuple[dict[str, Any], bool]:
    if not isinstance(raw, dict):
        raise HTTPException(status_code=500, detail="Evidence store root must be a JSON object")

    version = raw.get("schemaVersion", 0)
    try:
        version = int(version)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Evidence store schemaVersion is invalid") from exc

    if version > EVIDENCE_SCHEMA_VERSION:
        raise HTTPException(
            status_code=409,
            detail=f"Evidence store schemaVersion {version} is newer than supported version {EVIDENCE_SCHEMA_VERSION}",
        )

    store = dict(raw)
    changed = version != EVIDENCE_SCHEMA_VERSION
    store["schemaVersion"] = EVIDENCE_SCHEMA_VERSION
    for key in ("capabilityRecords", "requirements", "evidenceItems", "coverages", "tasks"):
        if not isinstance(store.get(key), list):
            store[key] = []
            changed = True

    if _migrate_atomic_capabilities(store):
        changed = True
    if _infer_any_of_groups(store):
        changed = True

    for requirement in store["requirements"]:
        if not isinstance(requirement, dict):
            continue
        canonical_key = _capability_key(requirement.get("canonicalKey"), requirement.get("category"))
        if canonical_key and requirement.get("canonicalKey") != canonical_key:
            requirement["canonicalKey"] = canonical_key
            changed = True
        canonical_group_id = _canonical_group_id(canonical_key) if canonical_key else ""
        if requirement.get("canonicalGroupId", "") != canonical_group_id:
            requirement["canonicalGroupId"] = canonical_group_id
            changed = True
        verification_mode = _verification_mode(requirement.get("category"), requirement.get("verificationMode"))
        if requirement.get("verificationMode") != verification_mode:
            requirement["verificationMode"] = verification_mode
            changed = True
        capability_name = canonical_capability_label(
            canonical_key,
            str(requirement.get("capabilityName") or requirement.get("label") or ""),
        )
        if requirement.get("capabilityName") != capability_name:
            requirement["capabilityName"] = capability_name
            changed = True
        required_proficiency = normalize_proficiency(
            requirement.get("requiredProficiency"),
            f"{requirement.get('label') or ''} {requirement.get('jdQuote') or ''}",
        )
        if requirement.get("requiredProficiency") != required_proficiency:
            requirement["requiredProficiency"] = required_proficiency
            changed = True
        proficiency_applicable = is_proficiency_applicable(
            requirement.get("category"),
            required_proficiency,
            f"{requirement.get('label') or ''} {requirement.get('jdQuote') or ''}",
            requirement.get("proficiencyApplicable"),
        )
        if requirement.get("proficiencyApplicable") != proficiency_applicable:
            requirement["proficiencyApplicable"] = proficiency_applicable
            changed = True
        group_mode = (
            "any_of"
            if str(requirement.get("requirementGroupMode") or "").strip().lower() == "any_of"
            else "all_of"
        )
        group_id = (
            normalize_canonical_key(requirement.get("requirementGroupId"))
            if group_mode == "any_of"
            else ""
        )
        group_label = (
            str(requirement.get("requirementGroupLabel") or requirement.get("jdQuote") or "").strip()
            if group_mode == "any_of"
            else ""
        )
        try:
            minimum_satisfied = max(1, int(requirement.get("minimumSatisfied") or 1))
        except (TypeError, ValueError):
            minimum_satisfied = 1
        for field, value in (
            ("requirementGroupMode", group_mode),
            ("requirementGroupId", group_id),
            ("requirementGroupLabel", group_label),
            ("minimumSatisfied", minimum_satisfied),
        ):
            if requirement.get(field) != value:
                requirement[field] = value
                changed = True

    requirements_by_id = {
        str(item.get("requirementId") or ""): item
        for item in store["requirements"]
        if isinstance(item, dict) and item.get("requirementId")
    }
    linked_requirement_ids: dict[str, set[str]] = {}
    for coverage in store["coverages"]:
        if not isinstance(coverage, dict):
            continue
        evidence_ids = coverage.get("evidenceIds")
        if not isinstance(evidence_ids, list):
            evidence_ids = []
            coverage["evidenceIds"] = evidence_ids
            changed = True
        if coverage.get("userDecisionAt") and not coverage.get("decisionSource"):
            coverage["decisionSource"] = "direct"
            changed = True
        requirement_id = str(coverage.get("requirementId") or "")
        requirement = requirements_by_id.get(requirement_id, {})
        user_proficiency = normalize_proficiency(coverage.get("userProficiency"))
        if user_proficiency == "unspecified" and coverage.get("userDecisionAt"):
            classification = str(coverage.get("userClassification") or "")
            if classification == "done":
                required_level = normalize_proficiency(requirement.get("requiredProficiency"))
                user_proficiency = required_level if required_level != "unspecified" else "working"
            elif classification == "adjacent":
                user_proficiency = "familiar"
        if coverage.get("userProficiency") != user_proficiency:
            coverage["userProficiency"] = user_proficiency
            changed = True
        candidate_refs = coverage.get("candidateEvidenceRefs") if isinstance(coverage.get("candidateEvidenceRefs"), list) else []
        source_verified = (
            requirement.get("verificationMode") == "document_fact"
            and coverage.get("assessmentStatus") == "supported"
            and bool(candidate_refs)
            and not coverage.get("userDecisionAt")
        )
        verification_status = (
            "user_confirmed" if coverage.get("userDecisionAt")
            else "source_verified" if source_verified
            else "candidate" if candidate_refs
            else "needs_input"
        )
        if coverage.get("verificationStatus") != verification_status:
            coverage["verificationStatus"] = verification_status
            changed = True
        if source_verified:
            source_verified_at = str(coverage.get("assessedAt") or store.get("updatedAt") or _now())
            for key, value in {
                "coverageStatus": "supported",
                "decisionSource": "source_document",
                "sourceVerifiedAt": source_verified_at,
            }.items():
                if coverage.get(key) != value:
                    coverage[key] = value
                    changed = True
        for evidence_id in evidence_ids:
            linked_requirement_ids.setdefault(str(evidence_id), set()).add(requirement_id)

    for item in store["evidenceItems"]:
        if not isinstance(item, dict):
            continue
        evidence_id = str(item.get("evidenceId") or "")
        current_ids = item.get("requirementIds") if isinstance(item.get("requirementIds"), list) else []
        requirement_ids = sorted({str(value) for value in current_ids if value} | linked_requirement_ids.get(evidence_id, set()))
        if item.get("requirementIds") != requirement_ids:
            item["requirementIds"] = requirement_ids
            changed = True
        capability_ids = sorted({
            str(value)
            for value in (item.get("capabilityIds") if isinstance(item.get("capabilityIds"), list) else [])
            if value
        })
        if item.get("capabilityIds") != capability_ids:
            item["capabilityIds"] = capability_ids
            changed = True
    for task in store["tasks"]:
        if not isinstance(task, dict):
            continue
        defaults = {
            "progressPercent": 100 if task.get("status") == "completed" else 0,
            "nextStep": "",
            "progressNotes": [],
            "currentProficiency": "unspecified",
            "targetProficiency": "working",
        }
        for key, value in defaults.items():
            if key not in task:
                task[key] = value
                changed = True
    if not store.get("updatedAt"):
        store["updatedAt"] = _now()
        changed = True
    return store, changed


def _ensure_store_unlocked() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not EVIDENCE_STORE_PATH.exists():
        _write_store_unlocked(_empty_store())


def _read_store_unlocked() -> dict[str, Any]:
    _ensure_store_unlocked()
    try:
        raw = json.loads(EVIDENCE_STORE_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Evidence store contains invalid JSON: {exc.msg}") from exc
    store, changed = _normalize_store(raw)
    if changed:
        store["updatedAt"] = _now()
        _write_store_unlocked(store)
    return store


def _write_store_unlocked(store: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    store["schemaVersion"] = EVIDENCE_SCHEMA_VERSION
    store["updatedAt"] = _now()
    temp_path = EVIDENCE_STORE_PATH.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp_path, EVIDENCE_STORE_PATH)


def ensure_evidence_store() -> None:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        _read_store_unlocked()


def _overview(store: dict[str, Any]) -> dict[str, Any]:
    active_requirement_ids = {
        item.get("requirementId")
        for item in store["requirements"]
        if item.get("active") is not False
    }
    confirmed = sum(1 for item in store["evidenceItems"] if item.get("status") == "confirmed")
    unresolved = sum(
        1
        for coverage in store["coverages"]
        if coverage.get("requirementId") in active_requirement_ids
        if coverage.get("coverageStatus") in {"not_found", "unknown", "partial"}
    )
    pending_tasks = sum(
        1
        for task in store["tasks"]
        if task.get("requirementId") in active_requirement_ids
        and task.get("taskType") in IMPROVEMENT_TASK_TYPES
        and task.get("status") in {"pending", "in_progress"}
    )
    capability_summary = _capability_summary(store)
    return {
        "ok": True,
        "path": str(EVIDENCE_STORE_PATH),
        **store,
        **capability_summary,
        "counts": {
            "requirements": sum(1 for item in store["requirements"] if item.get("active") is not False),
            "evidenceItems": len(store["evidenceItems"]),
            "confirmedEvidenceItems": confirmed,
            "unresolvedCoverages": unresolved,
            "pendingTasks": pending_tasks,
            **capability_summary["capabilityCounts"],
        },
    }


def _is_basic_condition(requirements: list[dict[str, Any]]) -> bool:
    if any(str(item.get("category") or "") == "education" for item in requirements):
        return True
    for item in requirements:
        if str(item.get("category") or "") != "experience":
            continue
        key = str(item.get("canonicalKey") or "")
        label = str(item.get("label") or "")
        if key == "experience-years" or (
            "experience" in key and ("year" in key or "years" in key)
        ):
            return True
        if re.search(r"(工作|从业|开发).{0,8}(年限|年经验)", label):
            return True
        if re.search(r"\d+\s*(?:[-—~至到]\s*\d+|\+|以上)?\s*年.{0,8}(经验|经历)", label):
            return True
    return False


def _capability_status(
    requirements: list[dict[str, Any]],
    coverages: list[dict[str, Any]],
) -> str:
    classifications = {
        str(item.get("userClassification") or "")
        for item in coverages
        if item.get("userDecisionAt")
    }
    if "done" in classifications:
        return "mastered"
    if "adjacent" in classifications:
        return "adjacent"
    if "not_done" in classifications:
        return "gap"
    if "unsure" in classifications:
        return "pending"
    if _is_basic_condition(requirements) and any(
        item.get("decisionSource") == "source_document" and item.get("coverageStatus") == "supported"
        for item in coverages
    ):
        return "mastered"
    return "pending"


def _impact_tier(job_count: int, required_count: int, preferred_count: int) -> str:
    if required_count >= 3 or (job_count >= 4 and required_count >= 2):
        return "core"
    if required_count >= 2 or job_count >= 3:
        return "high_value"
    if required_count >= 1 or preferred_count >= 2:
        return "common"
    return "specialized"


def _proof_status(evidence_items: list[dict[str, Any]]) -> str:
    """Describe evidence strength independently from the user's capability decision."""
    rank = {
        "none": 0,
        "self_reported": 1,
        "resume_recorded": 2,
        "source_backed": 3,
        "external_verified": 4,
    }
    strongest = "none"
    for item in evidence_items:
        if item.get("status") == "archived":
            continue
        for source in item.get("sourceRefs") or []:
            source_type = str(source.get("type") or "").strip().lower()
            if source_type in {"certificate", "credential", "url", "link"}:
                candidate = "external_verified"
            elif source_type in {
                "project", "work", "work_experience", "file", "artifact", "code", "repository",
            }:
                candidate = "source_backed"
            elif source_type in {"cv", "resume", "resume_import"}:
                candidate = "resume_recorded"
            else:
                candidate = "self_reported"
            if rank[candidate] > rank[strongest]:
                strongest = candidate
    return strongest


def _source_metadata() -> dict[str, dict[str, str]]:
    try:
        from backend.services.pipeline_service import read_pipeline

        pipeline = read_pipeline()
    except Exception:
        return {}
    metadata: dict[str, dict[str, str]] = {}
    for item in [*pipeline.get("pending", []), *pipeline.get("processed", [])]:
        source_key = str(item.get("sourceKey") or "")
        if not source_key:
            continue
        company = str(item.get("company") or "").strip()
        title = str(item.get("title") or "").strip()
        metadata[source_key] = {
            "company": company,
            "jobTitle": title,
            "sourceLabel": " · ".join(value for value in (company, title) if value) or source_key,
        }
    return metadata


def _capability_summary(store: dict[str, Any]) -> dict[str, Any]:
    requirements = [
        item for item in store["requirements"]
        if isinstance(item, dict) and item.get("active") is not False
    ]
    coverages_by_requirement = {
        str(item.get("requirementId") or ""): item
        for item in store["coverages"]
        if isinstance(item, dict) and item.get("requirementId")
    }
    evidence_by_id = {
        str(item.get("evidenceId") or ""): item
        for item in store["evidenceItems"]
        if isinstance(item, dict) and item.get("evidenceId")
    }
    records_by_key = {
        str(item.get("canonicalKey") or ""): item
        for item in store.get("capabilityRecords", [])
        if isinstance(item, dict)
        and item.get("canonicalKey")
        and item.get("status", "active") != "archived"
    }
    source_metadata = _source_metadata()
    groups: dict[str, list[dict[str, Any]]] = {}
    constraints: list[dict[str, Any]] = []
    for requirement in requirements:
        if requirement.get("category") in {"location", "preference"}:
            constraints.append(requirement)
            continue
        key = _capability_key(requirement.get("canonicalKey"), requirement.get("category"))
        if key:
            groups.setdefault(key, []).append(requirement)
    for canonical_key in records_by_key:
        groups.setdefault(canonical_key, [])

    capabilities: list[dict[str, Any]] = []
    for canonical_key, related in groups.items():
        record = records_by_key.get(canonical_key, {})
        capability_id = str(record.get("capabilityId") or _canonical_group_id(canonical_key))
        requirement_ids = [str(item.get("requirementId") or "") for item in related]
        related_coverages = [
            coverages_by_requirement[requirement_id]
            for requirement_id in requirement_ids
            if requirement_id in coverages_by_requirement
        ]
        source_keys = sorted({str(item.get("sourceKey") or "") for item in related if item.get("sourceKey")})
        evidence_ids = {
            str(evidence_id)
            for coverage in related_coverages
            for evidence_id in (coverage.get("evidenceIds") or [])
            if evidence_id
        }
        evidence_ids.update(
            str(item.get("evidenceId") or "")
            for item in store["evidenceItems"]
            if capability_id in (item.get("capabilityIds") or [])
            and item.get("evidenceId")
            and item.get("status") != "archived"
        )
        evidence_ids = sorted(evidence_ids)
        evidence_items = [evidence_by_id[evidence_id] for evidence_id in evidence_ids if evidence_id in evidence_by_id]
        active_plans = [
            task for task in store["tasks"]
            if task.get("requirementId") in requirement_ids
            and task.get("taskType") in IMPROVEMENT_TASK_TYPES
            and task.get("status") in {"pending", "in_progress"}
        ]
        required_count = sum(1 for item in related if item.get("importance") == "required")
        preferred_count = sum(1 for item in related if item.get("importance") == "preferred")
        label_counts = Counter(
            str(item.get("capabilityName") or "").strip()
            for item in related
            if item.get("capabilityName")
        )
        label = (
            str(record.get("label") or "").strip()
            or (
                sorted(label_counts, key=lambda value: (-label_counts[value], len(value)))[0]
                if label_counts
                else canonical_capability_label(canonical_key)
            )
        )
        category_counts = Counter(str(item.get("category") or "other") for item in related)
        category = str(record.get("category") or (
            category_counts.most_common(1)[0][0] if category_counts else "other"
        ))
        record_classification = str(record.get("userClassification") or "")
        status = (
            "mastered" if record_classification == "done"
            else "adjacent" if record_classification == "adjacent"
            else "gap" if record_classification == "not_done"
            else _capability_status(related, related_coverages)
        )
        actionability = (
            str(record.get("actionability"))
            if record.get("actionability") in {"basic", "developable"}
            else "basic" if _is_basic_condition(related) or category == "education" or canonical_key == "experience-years"
            else "developable"
        )
        proficiency_applicable = actionability == "developable" and (
            bool(record.get("proficiencyApplicable"))
            or any(bool(item.get("proficiencyApplicable")) for item in related)
        )
        required_proficiency_counts = Counter(
            normalize_proficiency(item.get("requiredProficiency"))
            for item in related
            if item.get("proficiencyApplicable")
        )
        user_proficiency = highest_proficiency([
            normalize_proficiency(record.get("userProficiency")),
            *[
                normalize_proficiency(item.get("userProficiency"))
                for item in related_coverages
                if item.get("userDecisionAt") and item.get("userClassification") in {"done", "adjacent"}
            ],
        ]) if proficiency_applicable else "unspecified"
        capabilities.append(
            {
                "capabilityId": capability_id,
                "canonicalKey": canonical_key,
                "label": label,
                "category": category,
                "actionability": actionability,
                "status": status,
                "proficiencyApplicable": proficiency_applicable,
                "userProficiency": user_proficiency,
                "highestRequiredProficiency": highest_proficiency([
                    normalize_proficiency(item.get("requiredProficiency"))
                    for item in related
                    if item.get("proficiencyApplicable")
                ]),
                "requiredProficiencyCounts": {
                    level: required_proficiency_counts.get(level, 0)
                    for level in PROFICIENCY_RANK
                },
                "impactTier": _impact_tier(len(source_keys), required_count, preferred_count),
                "jobCount": len(source_keys),
                "requiredCount": required_count,
                "preferredCount": preferred_count,
                "evidenceCount": len(evidence_items),
                "sourceCount": sum(len(item.get("sourceRefs") or []) for item in evidence_items),
                "proofStatus": _proof_status(evidence_items),
                "requirementIds": requirement_ids,
                "sourceKeys": source_keys,
                "evidenceIds": evidence_ids,
                "planIds": [str(item.get("taskId") or "") for item in active_plans],
                "origin": str(record.get("origin") or ("resume" if not related else "job_requirement")),
                "userConfirmedAt": str(record.get("userConfirmedAt") or ""),
                "requirements": [
                    {
                        "requirementId": item.get("requirementId"),
                        "sourceKey": item.get("sourceKey"),
                        **source_metadata.get(str(item.get("sourceKey") or ""), {}),
                        "label": item.get("label"),
                        "capabilityName": item.get("capabilityName"),
                        "requiredProficiency": normalize_proficiency(item.get("requiredProficiency")),
                        "requiredProficiencySource": item.get("requiredProficiencySource", ""),
                        "proficiencyApplicable": bool(item.get("proficiencyApplicable")),
                        "requirementGroupId": item.get("requirementGroupId", ""),
                        "requirementGroupMode": item.get("requirementGroupMode", "all_of"),
                        "requirementGroupLabel": item.get("requirementGroupLabel", ""),
                        "minimumSatisfied": item.get("minimumSatisfied", 1),
                        "importance": item.get("importance"),
                        "jdQuote": item.get("jdQuote"),
                    }
                    for item in related
                ],
            }
        )

    status_rank = {"gap": 0, "pending": 1, "adjacent": 2, "mastered": 3}
    tier_rank = {"core": 0, "high_value": 1, "common": 2, "specialized": 3}
    capabilities.sort(
        key=lambda item: (
            0 if item["actionability"] == "developable" else 1,
            status_rank.get(item["status"], 9),
            tier_rank.get(item["impactTier"], 9),
            -item["jobCount"],
            item["label"],
        )
    )
    return {
        "capabilities": capabilities,
        "constraints": constraints,
        "capabilityCounts": {
            "capabilities": len(capabilities),
            "masteredCapabilities": sum(1 for item in capabilities if item["status"] == "mastered"),
            "pendingCapabilities": sum(1 for item in capabilities if item["status"] == "pending"),
            "gapCapabilities": sum(1 for item in capabilities if item["status"] == "gap"),
            "basicConditions": sum(1 for item in capabilities if item["actionability"] == "basic"),
            "activePlans": sum(
                1 for task in store["tasks"]
                if task.get("taskType") in IMPROVEMENT_TASK_TYPES
                and task.get("status") in {"pending", "in_progress"}
            ),
        },
    }


def read_evidence_overview() -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        return _overview(_read_store_unlocked())


def read_capability_catalog(limit: int = 80) -> list[dict[str, str]]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        summary = _capability_summary(_read_store_unlocked())
    capabilities = sorted(
        summary["capabilities"],
        key=lambda item: (-int(item.get("jobCount") or 0), str(item.get("label") or "")),
    )
    return [
        {
            "canonicalKey": str(item.get("canonicalKey") or ""),
            "capabilityName": str(item.get("label") or ""),
            "category": str(item.get("category") or "other"),
        }
        for item in capabilities[:max(1, min(limit, 120))]
        if item.get("canonicalKey") and item.get("label")
    ]


def list_capabilities(
    status: str = "",
    category: str = "",
    source_key: str = "",
    limit: int = 200,
) -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        overview = _overview(_read_store_unlocked())
    capabilities = overview["capabilities"]
    if status:
        capabilities = [item for item in capabilities if item.get("status") == status]
    if category:
        capabilities = [item for item in capabilities if item.get("category") == category]
    if source_key:
        capabilities = [item for item in capabilities if source_key in (item.get("sourceKeys") or [])]
    bounded_limit = max(1, min(int(limit or 200), 500))
    return {
        "ok": True,
        "capabilities": capabilities[:bounded_limit],
        "returned": min(len(capabilities), bounded_limit),
        "total": len(capabilities),
    }


def _resume_source_revision(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _resume_lines(content: str) -> list[tuple[int, str, str]]:
    heading = ""
    result: list[tuple[int, str, str]] = []
    for line_number, raw in enumerate(content.splitlines(), start=1):
        stripped = raw.strip()
        heading_match = re.match(r"^#{1,6}\s+(.+?)\s*$", stripped)
        if heading_match:
            heading = re.sub(r"[*_`]", "", heading_match.group(1)).strip()
            continue
        cleaned = re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", "", stripped)
        cleaned = re.sub(r"[*_`>\[\]]", "", cleaned).strip()
        if cleaned:
            result.append((line_number, heading, cleaned))
    return result


def _excluded_resume_context(heading: str, text: str) -> bool:
    source = f"{heading} {text}".lower()
    return any(token in source for token in (
        "意向城市",
        "期望城市",
        "工作地点偏好",
        "工作偏好",
        "求职意向",
        "期望薪资",
        "preferred location",
        "job preference",
        "salary expectation",
    ))


def _resume_capability_candidates(content: str, store: dict[str, Any]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    known_profiles = {
        str(item.get("canonicalKey") or ""): item
        for item in _capability_summary(store)["capabilities"]
        if item.get("canonicalKey")
    }

    def add_candidate(
        canonical_key: str,
        label: str,
        category: str,
        line_number: int,
        heading: str,
        quote: str,
        proficiency: str = "unspecified",
        confidence: float = 0.95,
    ) -> None:
        key = _capability_key(canonical_key, category)
        if not key or category in {"location", "preference"}:
            return
        capability_id = _canonical_group_id(key)
        item = grouped.setdefault(
            key,
            {
                "canonicalKey": key,
                "capabilityId": capability_id,
                "label": canonical_capability_label(key, label),
                "category": category,
                "proficiencyApplicable": False,
                "userProficiency": "unspecified",
                "confidence": confidence,
                "sourceRefs": [],
            },
        )
        item["confidence"] = max(float(item["confidence"]), confidence)
        item["userProficiency"] = highest_proficiency([
            str(item.get("userProficiency") or "unspecified"),
            normalize_proficiency(proficiency),
        ])
        if item["userProficiency"] != "unspecified" and category == "skill":
            item["proficiencyApplicable"] = True
        ref = {
            "type": "cv",
            "ref": f"cv.md#L{line_number}",
            "quote": quote,
            "heading": heading,
        }
        if not any(existing["ref"] == ref["ref"] and existing["quote"] == quote for existing in item["sourceRefs"]):
            item["sourceRefs"].append(ref)

    for line_number, heading, text in _resume_lines(content):
        if _excluded_resume_context(heading, text):
            continue
        for definition, span in matching_capability_definitions(text):
            local_start = max(0, span[0] - 12)
            local_end = min(len(text), span[1] + 12)
            proficiency = infer_proficiency(text[local_start:local_end])
            add_candidate(
                definition.key,
                definition.label,
                "skill",
                line_number,
                heading,
                text,
                proficiency,
            )

        lower_text = text.lower()
        for canonical_key, profile in known_profiles.items():
            label = str(profile.get("label") or "").strip()
            if len(label) < 2 or canonical_key in grouped:
                continue
            if label.lower() in lower_text:
                category = str(profile.get("category") or "other")
                add_candidate(
                    canonical_key,
                    label,
                    category,
                    line_number,
                    heading,
                    text,
                    infer_proficiency(text),
                    0.88,
                )

        if re.search(r"(?:本科|学士|硕士|研究生|博士|大专|专科|bachelor|master|phd)", text, re.IGNORECASE):
            add_candidate(
                "education-background",
                "学历背景",
                "education",
                line_number,
                heading,
                text,
                "unspecified",
                0.9,
            )
        if re.search(
            r"(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*年(?:以上)?(?:工作|开发|研发|行业)?经验|"
            r"(?:工作经验|工作年限|开发经验|研发经验)\s*[:：]?\s*"
            r"(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*年(?:以上)?|"
            r"\d+(?:\.\d+)?\s*years?\s+of\s+(?:work|development|engineering)?\s*experience",
            text,
            re.IGNORECASE,
        ):
            add_candidate(
                "experience-years",
                "工作年限",
                "experience",
                line_number,
                heading,
                text,
                "unspecified",
                0.9,
            )
    return list(grouped.values())


def preview_resume_capability_import(content: str) -> dict[str, Any]:
    source_revision = _resume_source_revision(content)
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        overview = _overview(store)
        existing_by_key = {
            str(item.get("canonicalKey") or ""): item
            for item in overview["capabilities"]
            if item.get("canonicalKey")
        }
        evidence_by_capability: dict[str, list[dict[str, Any]]] = {}
        for item in store["evidenceItems"]:
            if "resume-import" not in (item.get("tags") or []):
                continue
            for capability_id in item.get("capabilityIds") or []:
                evidence_by_capability.setdefault(str(capability_id), []).append(item)
        proposals = []
        extracted_ids: set[str] = set()
        for candidate in _resume_capability_candidates(content, store):
            capability_id = candidate["capabilityId"]
            extracted_ids.add(capability_id)
            existing_capability = existing_by_key.get(candidate["canonicalKey"])
            if existing_capability:
                candidate = {
                    **candidate,
                    "label": str(existing_capability.get("label") or candidate["label"]),
                    "category": str(existing_capability.get("category") or candidate["category"]),
                    "proficiencyApplicable": bool(
                        candidate["proficiencyApplicable"]
                        or existing_capability.get("proficiencyApplicable")
                    ),
                    "userProficiency": highest_proficiency([
                        candidate["userProficiency"],
                        str(existing_capability.get("userProficiency") or "unspecified"),
                    ]),
                }
            imported_items = evidence_by_capability.get(capability_id, [])
            already_imported = any(
                item.get("sourceRevision") == source_revision
                for item in imported_items
            )
            action = (
                "already_imported" if already_imported
                else "merge" if candidate["canonicalKey"] in existing_by_key
                else "new"
            )
            proposal_id = "rcp-" + hashlib.sha1(
                f"{source_revision}|{candidate['canonicalKey']}".encode("utf-8")
            ).hexdigest()[:12]
            proposals.append({
                **candidate,
                "proposalId": proposal_id,
                "action": action,
                "selected": action != "already_imported" and float(candidate["confidence"]) >= 0.9,
                "existingCapability": existing_capability,
            })
        stale = [
            {
                "capabilityId": item.get("capabilityId"),
                "canonicalKey": item.get("canonicalKey"),
                "label": item.get("label"),
            }
            for item in store.get("capabilityRecords", [])
            if item.get("origin") == "resume"
            and item.get("status", "active") != "archived"
            and item.get("capabilityId") not in extracted_ids
        ]
    return {
        "ok": True,
        "sourceRevision": source_revision,
        "proposals": proposals,
        "staleImports": stale,
        "counts": {
            "total": len(proposals),
            "new": sum(1 for item in proposals if item["action"] == "new"),
            "merge": sum(1 for item in proposals if item["action"] == "merge"),
            "alreadyImported": sum(1 for item in proposals if item["action"] == "already_imported"),
            "needsReview": sum(1 for item in proposals if not item["selected"] and item["action"] != "already_imported"),
            "stale": len(stale),
        },
    }


def apply_resume_capability_import(
    content: str,
    selections: list[dict[str, Any]],
    source_revision: str,
) -> dict[str, Any]:
    current_revision = _resume_source_revision(content)
    if source_revision != current_revision:
        raise HTTPException(status_code=409, detail="Resume changed after preview; refresh the import preview")
    preview = preview_resume_capability_import(content)
    proposals_by_id = {item["proposalId"]: item for item in preview["proposals"]}
    selected = [item for item in selections if item.get("selected", True)]
    unknown_ids = [
        str(item.get("proposalId") or "")
        for item in selected
        if str(item.get("proposalId") or "") not in proposals_by_id
    ]
    if unknown_ids:
        raise HTTPException(status_code=409, detail="Resume import proposal is stale or invalid")

    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        records_by_id = {
            str(item.get("capabilityId") or ""): item
            for item in store["capabilityRecords"]
            if item.get("capabilityId")
        }
        imported: list[dict[str, Any]] = []
        now = _now()
        for selection in selected:
            proposal = proposals_by_id[str(selection.get("proposalId") or "")]
            if proposal["action"] == "already_imported":
                continue
            capability_id = proposal["capabilityId"]
            proficiency = normalize_proficiency(
                selection.get("userProficiency") or proposal.get("userProficiency")
            )
            label = str(selection.get("label") or proposal["label"]).strip() or proposal["label"]
            record = records_by_id.get(capability_id)
            next_record = {
                "capabilityId": capability_id,
                "canonicalKey": proposal["canonicalKey"],
                "label": label,
                "category": proposal["category"],
                "actionability": (
                    "basic"
                    if proposal["category"] == "education" or proposal["canonicalKey"] == "experience-years"
                    else "developable"
                ),
                "proficiencyApplicable": bool(
                    proposal["proficiencyApplicable"]
                    and proposal["category"] != "education"
                    and proposal["canonicalKey"] != "experience-years"
                ),
                "userProficiency": (
                    proficiency
                    if proposal["proficiencyApplicable"]
                    and proposal["category"] != "education"
                    and proposal["canonicalKey"] != "experience-years"
                    else "unspecified"
                ),
                "userClassification": "done",
                "origin": "resume",
                "status": "active",
                "sourceRevision": current_revision,
                "userConfirmedAt": now,
                "updatedAt": now,
            }
            if record:
                next_record["origin"] = str(record.get("origin") or "resume")
                record.update({
                    **next_record,
                    "userProficiency": highest_proficiency([
                        normalize_proficiency(record.get("userProficiency")),
                        next_record["userProficiency"],
                    ]),
                    "createdAt": record.get("createdAt") or now,
                })
            else:
                record = {**next_record, "createdAt": now}
                store["capabilityRecords"].append(record)
                records_by_id[capability_id] = record

            evidence = next(
                (
                    item for item in store["evidenceItems"]
                    if "resume-import" in (item.get("tags") or [])
                    and capability_id in (item.get("capabilityIds") or [])
                    and item.get("status") != "archived"
                ),
                None,
            )
            source_refs = [
                {key: value for key, value in ref.items() if key in {"type", "ref", "quote"}}
                for ref in proposal["sourceRefs"]
            ]
            if evidence:
                existing_refs = {
                    (str(ref.get("type") or ""), str(ref.get("ref") or ""), str(ref.get("quote") or "")): ref
                    for ref in evidence.get("sourceRefs") or []
                    if ref.get("type") != "cv"
                }
                for ref in source_refs:
                    existing_refs[(ref["type"], ref["ref"], ref["quote"])] = ref
                evidence.update({
                    "title": label,
                    "summary": f"个人简历声明：{label}",
                    "sourceRefs": list(existing_refs.values()),
                    "status": "confirmed",
                    "sourceRevision": current_revision,
                    "updatedAt": now,
                    "confirmedAt": evidence.get("confirmedAt") or now,
                    "lastValidatedAt": now,
                })
            else:
                evidence = {
                    "evidenceId": _new_id("ev"),
                    "title": label,
                    "evidenceType": "fact",
                    "summary": f"个人简历声明：{label}",
                    "userRole": "",
                    "actions": [],
                    "results": [],
                    "sourceRefs": source_refs,
                    "tags": ["resume-import", f"capability:{proposal['canonicalKey']}"],
                    "requirementIds": [],
                    "capabilityIds": [capability_id],
                    "status": "confirmed",
                    "sourceRevision": current_revision,
                    "createdAt": now,
                    "updatedAt": now,
                    "confirmedAt": now,
                    "lastValidatedAt": now,
                }
                store["evidenceItems"].append(evidence)
            imported.append({
                "proposalId": proposal["proposalId"],
                "capabilityId": capability_id,
                "label": label,
                "action": proposal["action"],
                "evidenceId": evidence["evidenceId"],
            })
        _write_store_unlocked(store)
        overview = _overview(store)
    return {
        "ok": True,
        "sourceRevision": current_revision,
        "imported": imported,
        "staleImports": preview["staleImports"],
        "overview": overview,
        "affectedSourceKeys": sorted({
            source_key
            for item in imported
            for capability in overview["capabilities"]
            if capability["capabilityId"] == item["capabilityId"]
            for source_key in capability.get("sourceKeys") or []
        }),
    }


def list_requirements(source_key: str = "") -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        requirements = [item for item in store["requirements"] if item.get("active") is not False]
        if source_key:
            requirements = [item for item in requirements if item.get("sourceKey") == source_key]
        return {
            "ok": True,
            "path": str(EVIDENCE_STORE_PATH),
            "schemaVersion": store["schemaVersion"],
            "sourceKey": source_key,
            "requirements": requirements,
        }


def upsert_requirements(requirements: list[dict[str, Any]]) -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        by_id = {str(item.get("requirementId") or ""): item for item in store["requirements"] if item.get("requirementId")}
        for item in merge_requirement_assessments([dict(raw) for raw in requirements]):
            canonical_key = _capability_key(item.get("canonicalKey"), item.get("category"))
            if not canonical_key:
                continue
            item["canonicalKey"] = canonical_key
            item["canonicalGroupId"] = _canonical_group_id(canonical_key)
            item["capabilityName"] = canonical_capability_label(
                canonical_key,
                str(item.get("capabilityName") or item.get("label") or ""),
            )
            item["requiredProficiency"] = normalize_proficiency(
                item.get("requiredProficiency"),
                f"{item.get('label') or ''} {item.get('jdQuote') or ''}",
            )
            item["verificationMode"] = _verification_mode(item.get("category"), item.get("verificationMode"))
            item["active"] = True
            requirement_id = (
                _stable_requirement_id(str(item.get("sourceKey") or ""), canonical_key)
                if item.get("atomicizedFrom") and item.get("sourceKey")
                else str(item.get("requirementId") or "").strip() or _new_id("req")
            )
            item["requirementId"] = requirement_id
            if requirement_id in by_id:
                by_id[requirement_id].update(item)
            else:
                store["requirements"].append(item)
                by_id[requirement_id] = item
        _infer_any_of_groups(store)
        _write_store_unlocked(store)
        return _overview(store)


def _requirement_units(
    requirements: list[dict[str, Any]],
    coverages: list[dict[str, Any]],
) -> list[tuple[list[dict[str, Any]], list[dict[str, Any]], int]]:
    coverage_by_id = {
        str(item.get("requirementId") or ""): item
        for item in coverages
        if item.get("requirementId")
    }
    grouped: dict[str, list[dict[str, Any]]] = {}
    for requirement in requirements:
        group_id = str(requirement.get("requirementGroupId") or "")
        if requirement.get("requirementGroupMode") == "any_of" and group_id:
            unit_key = f"any_of:{group_id}"
        else:
            unit_key = f"single:{requirement.get('requirementId') or requirement.get('canonicalKey')}"
        grouped.setdefault(unit_key, []).append(requirement)

    units: list[tuple[list[dict[str, Any]], list[dict[str, Any]], int]] = []
    for related in grouped.values():
        related_coverages = [
            coverage_by_id[str(item.get("requirementId") or "")]
            for item in related
            if str(item.get("requirementId") or "") in coverage_by_id
        ]
        minimum = 1
        if related[0].get("requirementGroupMode") == "any_of":
            try:
                minimum = max(1, int(related[0].get("minimumSatisfied") or 1))
            except (TypeError, ValueError):
                minimum = 1
            minimum = min(minimum, len(related))
        units.append((related, related_coverages, minimum))
    return units


def sync_requirement_assessment(source_key: str, assessments: list[dict[str, Any]]) -> dict[str, Any]:
    """Sync machine-extracted requirements without overwriting user decisions."""
    assessed_at = _now()
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        existing_requirements = {
            (str(item.get("sourceKey") or ""), str(item.get("canonicalKey") or "")): item
            for item in store["requirements"]
        }
        coverages_by_requirement = {
            str(item.get("requirementId") or ""): item
            for item in store["coverages"]
            if item.get("requirementId")
        }
        synced_requirements: list[dict[str, Any]] = []
        synced_coverages: list[dict[str, Any]] = []

        for requirement in store["requirements"]:
            if requirement.get("sourceKey") == source_key:
                requirement["active"] = False

        for assessment in merge_requirement_assessments(assessments):
            canonical_key = _capability_key(assessment.get("canonicalKey"), assessment.get("category"))
            if not canonical_key:
                continue
            key = (source_key, canonical_key)
            requirement = existing_requirements.get(key)
            if requirement is None:
                requirement = {"requirementId": _stable_requirement_id(source_key, canonical_key)}
                store["requirements"].append(requirement)
                existing_requirements[key] = requirement
            requirement.update(
                {
                    "canonicalKey": canonical_key,
                    "canonicalGroupId": _canonical_group_id(canonical_key),
                    "capabilityName": canonical_capability_label(
                        canonical_key,
                        str(assessment.get("capabilityName") or assessment.get("label") or ""),
                    ),
                    "requiredProficiency": normalize_proficiency(
                        assessment.get("requiredProficiency"),
                        f"{assessment.get('label') or ''} {assessment.get('jdQuote') or ''}",
                    ),
                    "requiredProficiencySource": str(
                        assessment.get("requiredProficiencySource") or ""
                    ).strip(),
                    "proficiencyApplicable": is_proficiency_applicable(
                        assessment.get("category"),
                        assessment.get("requiredProficiency"),
                        f"{assessment.get('label') or ''} {assessment.get('jdQuote') or ''}",
                        assessment.get("proficiencyApplicable"),
                    ),
                    "requirementGroupId": str(assessment.get("requirementGroupId") or "").strip(),
                    "requirementGroupMode": (
                        "any_of"
                        if str(assessment.get("requirementGroupMode") or "").strip().lower() == "any_of"
                        else "all_of"
                    ),
                    "requirementGroupLabel": str(
                        assessment.get("requirementGroupLabel") or ""
                    ).strip(),
                    "minimumSatisfied": max(1, int(assessment.get("minimumSatisfied") or 1)),
                    "verificationMode": _verification_mode(
                        assessment.get("category"),
                        assessment.get("verificationMode"),
                    ),
                    "label": str(assessment.get("label") or canonical_key).strip(),
                    "category": str(assessment.get("category") or "other"),
                    "importance": str(assessment.get("importance") or "context"),
                    "sourceKey": source_key,
                    "jdQuote": str(assessment.get("jdQuote") or "").strip(),
                    "extractionConfidence": assessment.get("confidence", 0),
                    "assessedAt": assessed_at,
                    "active": True,
                }
            )
            synced_requirements.append(requirement)

            requirement_id = requirement["requirementId"]
            coverage = coverages_by_requirement.get(requirement_id)
            if coverage is None:
                coverage = {"requirementId": requirement_id, "evidenceIds": []}
                store["coverages"].append(coverage)
                coverages_by_requirement[requirement_id] = coverage

            assessment_status = str(assessment.get("coverageStatus") or "unknown")
            assessment_patch = {
                "assessmentStatus": assessment_status,
                "assessmentRationale": str(assessment.get("rationale") or "").strip(),
                "assessmentConfidence": assessment.get("confidence", 0),
                "candidateEvidenceRefs": assessment.get("candidateEvidenceRefs") or [],
                "assessedAt": assessed_at,
            }
            coverage.update(assessment_patch)

            if not coverage.get("userDecisionAt"):
                source_verified = (
                    requirement.get("verificationMode") == "document_fact"
                    and assessment_status == "supported"
                    and bool(assessment_patch["candidateEvidenceRefs"])
                )
                reusable = None if source_verified else _reusable_coverage_for_requirement(store, requirement)
                if source_verified:
                    coverage.update(
                        {
                            "evidenceIds": [],
                            "coverageStatus": "supported",
                            "rationale": assessment_patch["assessmentRationale"],
                            "confidence": assessment_patch["assessmentConfidence"],
                            "userClassification": "",
                            "userDecisionAt": "",
                            "decisionSource": "source_document",
                            "verificationStatus": "source_verified",
                            "sourceVerifiedAt": assessed_at,
                            "reusedFromRequirementId": "",
                            "reusedAt": "",
                        }
                    )
                elif reusable:
                    coverage.update(
                        {
                            "evidenceIds": list(reusable.get("evidenceIds") or []),
                            "coverageStatus": _coverage_status(
                                store,
                                str(reusable.get("userClassification") or "done"),
                                reusable.get("evidenceIds") or [],
                            ),
                            "rationale": str(reusable.get("rationale") or ""),
                            "confidence": reusable.get("confidence", 0),
                            "userClassification": str(reusable.get("userClassification") or "done"),
                            "userProficiency": normalize_proficiency(reusable.get("userProficiency")),
                            "userDecisionAt": str(reusable.get("userDecisionAt") or assessed_at),
                            "decisionSource": "canonical_reuse",
                            "verificationStatus": "user_confirmed",
                            "reusedFromRequirementId": str(reusable.get("requirementId") or ""),
                            "reusedAt": assessed_at,
                        }
                    )
                else:
                    safe_initial_status = "partial" if assessment_status == "supported" else assessment_status
                    if safe_initial_status not in {"partial", "not_found", "unknown"}:
                        safe_initial_status = "unknown"
                    coverage.update(
                        {
                            "coverageStatus": safe_initial_status,
                            "rationale": assessment_patch["assessmentRationale"],
                            "confidence": assessment_patch["assessmentConfidence"],
                            "userClassification": "",
                            "userProficiency": "unspecified",
                            "userDecisionAt": "",
                            "decisionSource": "assessment",
                            "verificationStatus": "candidate" if assessment_patch["candidateEvidenceRefs"] else "needs_input",
                            "reusedFromRequirementId": "",
                            "reusedAt": "",
                        }
                    )
            synced_coverages.append(coverage)

        _infer_any_of_groups(store)
        synced_requirement_ids = {item["requirementId"] for item in synced_requirements}
        units = _requirement_units(synced_requirements, synced_coverages)
        supported_count = 0
        potential_count = 0
        unresolved_count = 0
        blocking_count = 0
        for unit_requirements, unit_coverages, minimum in units:
            supported = sum(
                1 for coverage in unit_coverages
                if coverage.get("coverageStatus") == "supported"
            )
            if supported >= minimum:
                supported_count += 1
                continue
            unresolved_count += 1
            if any(
                not coverage.get("userDecisionAt")
                and coverage.get("assessmentStatus") in {"supported", "partial"}
                for coverage in unit_coverages
            ):
                potential_count += 1
            required = any(item.get("importance") == "required" for item in unit_requirements)
            unavailable = sum(
                1 for coverage in unit_coverages
                if coverage.get("coverageStatus") in {"not_found", "user_confirmed_absent"}
            )
            if required and len(unit_requirements) - unavailable < minimum:
                blocking_count += 1
        _sync_evidence_requirement_links(store)
        _write_store_unlocked(store)
        return {
            "ok": True,
            "sourceKey": source_key,
            "requirements": synced_requirements,
            "coverages": [
                item for item in store["coverages"]
                if item.get("requirementId") in synced_requirement_ids
            ],
            "summary": {
                "requirementCount": len(units),
                "supportedRequirementCount": supported_count,
                "potentialEvidenceRequirementCount": potential_count,
                "unresolvedRequirementCount": unresolved_count,
                "blockingGapCount": blocking_count,
                "requirementAssessedAt": assessed_at,
            },
            "overview": _overview(store),
        }


def _requirement(store: dict[str, Any], requirement_id: str) -> dict[str, Any]:
    requirement = next((item for item in store["requirements"] if item.get("requirementId") == requirement_id), None)
    if not requirement:
        raise HTTPException(status_code=404, detail=f"Evidence requirement not found: {requirement_id}")
    return requirement


def _evidence_item(store: dict[str, Any], evidence_id: str) -> dict[str, Any]:
    item = next((entry for entry in store["evidenceItems"] if entry.get("evidenceId") == evidence_id), None)
    if not item:
        raise HTTPException(status_code=404, detail=f"Evidence item not found: {evidence_id}")
    return item


def _requirements_in_canonical_group(store: dict[str, Any], requirement: dict[str, Any]) -> list[dict[str, Any]]:
    group_id = str(requirement.get("canonicalGroupId") or "")
    if not group_id:
        canonical_key = _normalize_canonical_key(requirement.get("canonicalKey"))
        group_id = _canonical_group_id(canonical_key) if canonical_key else ""
    return [
        item
        for item in store["requirements"]
        if item.get("active") is not False
        and group_id
        and str(item.get("canonicalGroupId") or "") == group_id
    ]


def _reusable_coverage_for_requirement(
    store: dict[str, Any],
    requirement: dict[str, Any],
) -> dict[str, Any] | None:
    peer_ids = {
        str(item.get("requirementId") or "")
        for item in _requirements_in_canonical_group(store, requirement)
        if item.get("requirementId") != requirement.get("requirementId")
    }
    confirmed_ids = {
        str(item.get("evidenceId") or "")
        for item in store["evidenceItems"]
        if item.get("status") == "confirmed"
    }
    candidates = [
        coverage
        for coverage in store["coverages"]
        if coverage.get("requirementId") in peer_ids
        and coverage.get("userClassification") in {"done", "adjacent"}
        and coverage.get("evidenceIds")
    ]
    if not candidates:
        return None

    def score(coverage: dict[str, Any]) -> tuple[int, int, int, str]:
        evidence_ids = coverage.get("evidenceIds") or []
        return (
            int(bool(evidence_ids) and all(str(value) in confirmed_ids for value in evidence_ids)),
            int(coverage.get("userClassification") == "done"),
            int(coverage.get("decisionSource") == "direct"),
            str(coverage.get("userDecisionAt") or ""),
        )

    return max(candidates, key=score)


def _sync_evidence_requirement_links(store: dict[str, Any]) -> None:
    requirement_ids_by_evidence: dict[str, set[str]] = {}
    for coverage in store["coverages"]:
        requirement_id = str(coverage.get("requirementId") or "")
        if not requirement_id:
            continue
        for evidence_id in coverage.get("evidenceIds") or []:
            requirement_ids_by_evidence.setdefault(str(evidence_id), set()).add(requirement_id)
    for item in store["evidenceItems"]:
        evidence_id = str(item.get("evidenceId") or "")
        item["requirementIds"] = sorted(requirement_ids_by_evidence.get(evidence_id, set()))


def create_evidence_item(payload: dict[str, Any]) -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        now = _now()
        item = {
            **payload,
            "evidenceId": _new_id("ev"),
            "requirementIds": [],
            "status": "draft",
            "createdAt": now,
            "updatedAt": now,
            "confirmedAt": "",
            "lastValidatedAt": "",
        }
        store["evidenceItems"].append(item)
        _write_store_unlocked(store)
        return {"ok": True, "item": item, "overview": _overview(store), "affectedSourceKeys": []}


def update_evidence_item(payload: dict[str, Any]) -> dict[str, Any]:
    evidence_id = str(payload.get("evidenceId") or "").strip()
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        item = _evidence_item(store, evidence_id)
        previous_status = item.get("status")
        if payload.get("status") == "confirmed" and previous_status != "confirmed":
            raise HTTPException(status_code=400, detail="Use the evidence confirmation endpoint to confirm an evidence item")
        item.update(payload)
        item["updatedAt"] = _now()
        _refresh_coverages_for_evidence(store, evidence_id)
        _sync_evidence_requirement_links(store)
        _write_store_unlocked(store)
        return {
            "ok": True,
            "item": item,
            "overview": _overview(store),
            "affectedSourceKeys": _source_keys_for_evidence(store, evidence_id),
        }


def confirm_evidence_item(evidence_id: str) -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        item = _evidence_item(store, evidence_id)
        now = _now()
        item.update({"status": "confirmed", "confirmedAt": now, "lastValidatedAt": now, "updatedAt": now})
        _refresh_coverages_for_evidence(store, evidence_id)
        requirement_ids = {
            coverage.get("requirementId")
            for coverage in store["coverages"]
            if evidence_id in coverage.get("evidenceIds", [])
        }
        for task in store["tasks"]:
            if (
                task.get("requirementId") in requirement_ids
                and task.get("taskType") in {"extract", "strengthen"}
                and task.get("status") in {"pending", "in_progress"}
            ):
                completion_ids = list(dict.fromkeys([*(task.get("completionEvidenceIds") or []), evidence_id]))
                task.update(
                    {
                        "status": "completed",
                        "completionEvidenceIds": completion_ids,
                        "completedAt": now,
                        "updatedAt": now,
                    }
                )
        _write_store_unlocked(store)
        return {
            "ok": True,
            "item": item,
            "overview": _overview(store),
            "affectedSourceKeys": _source_keys_for_evidence(store, evidence_id),
        }


def _coverage_status(
    store: dict[str, Any],
    classification: str,
    evidence_ids: list[str],
    verification_mode: str = "",
) -> str:
    if classification == "not_done":
        return "user_confirmed_absent"
    if classification == "unsure":
        return "unknown"
    if classification == "adjacent":
        return "partial"
    if classification == "done" and verification_mode in {"document_fact", "preference"}:
        return "supported"
    confirmed_ids = {
        item.get("evidenceId")
        for item in store["evidenceItems"]
        if item.get("status") == "confirmed"
    }
    return "supported" if evidence_ids and all(item in confirmed_ids for item in evidence_ids) else "partial"


def classify_coverage(payload: dict[str, Any]) -> dict[str, Any]:
    requirement_id = str(payload.get("requirementId") or "").strip()
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        requirement = _requirement(store, requirement_id)
        evidence_ids = list(dict.fromkeys(payload.get("evidenceIds") or []))
        for evidence_id in evidence_ids:
            _evidence_item(store, evidence_id)
        coverages_by_requirement = {
            str(item.get("requirementId") or ""): item
            for item in store["coverages"]
            if item.get("requirementId")
        }
        coverage = coverages_by_requirement.get(requirement_id)
        decided_at = _now()
        user_proficiency = (
            normalize_proficiency(payload.get("userProficiency"))
            if payload["userClassification"] in {"done", "adjacent"}
            else "unspecified"
        )
        next_coverage = {
            "requirementId": requirement_id,
            "evidenceIds": evidence_ids,
            "coverageStatus": _coverage_status(
                store,
                payload["userClassification"],
                evidence_ids,
                str(requirement.get("verificationMode") or ""),
            ),
            "rationale": payload.get("rationale", ""),
            "confidence": payload.get("confidence", 0),
            "userClassification": payload["userClassification"],
            "userProficiency": user_proficiency,
            "userDecisionAt": decided_at,
            "decisionSource": "direct",
            "verificationStatus": "user_confirmed",
            "reusedFromRequirementId": "",
            "reusedAt": "",
        }
        if coverage:
            coverage.update(next_coverage)
        else:
            store["coverages"].append(next_coverage)
            coverage = next_coverage

        affected_requirement_ids = {requirement_id}
        if payload["userClassification"] in {"done", "adjacent"} and evidence_ids:
            for peer in _requirements_in_canonical_group(store, requirement):
                peer_id = str(peer.get("requirementId") or "")
                if not peer_id or peer_id == requirement_id:
                    continue
                peer_coverage = coverages_by_requirement.get(peer_id)
                if peer_coverage is None:
                    peer_coverage = {"requirementId": peer_id, "evidenceIds": []}
                    store["coverages"].append(peer_coverage)
                    coverages_by_requirement[peer_id] = peer_coverage

                has_direct_decision = bool(peer_coverage.get("userDecisionAt")) and peer_coverage.get("decisionSource") != "canonical_reuse"
                if has_direct_decision:
                    if peer_coverage.get("userClassification") in {"done", "adjacent"}:
                        peer_evidence_ids = list(dict.fromkeys([*(peer_coverage.get("evidenceIds") or []), *evidence_ids]))
                        peer_coverage["evidenceIds"] = peer_evidence_ids
                        peer_coverage["coverageStatus"] = _coverage_status(
                            store,
                            str(peer_coverage.get("userClassification") or "adjacent"),
                            peer_evidence_ids,
                            str(peer.get("verificationMode") or ""),
                        )
                        peer_coverage["userProficiency"] = highest_proficiency([
                            normalize_proficiency(peer_coverage.get("userProficiency")),
                            user_proficiency,
                        ])
                        affected_requirement_ids.add(peer_id)
                    continue

                peer_coverage.update(
                    {
                        "evidenceIds": evidence_ids,
                        "coverageStatus": _coverage_status(
                            store,
                            payload["userClassification"],
                            evidence_ids,
                            str(peer.get("verificationMode") or ""),
                        ),
                        "rationale": payload.get("rationale", ""),
                        "confidence": payload.get("confidence", 0),
                        "userClassification": payload["userClassification"],
                        "userProficiency": user_proficiency,
                        "userDecisionAt": decided_at,
                        "decisionSource": "canonical_reuse",
                        "verificationStatus": "user_confirmed",
                        "reusedFromRequirementId": requirement_id,
                        "reusedAt": decided_at,
                    }
                )
                affected_requirement_ids.add(peer_id)

        _sync_evidence_requirement_links(store)
        affected_source_keys = sorted({
            str(item.get("sourceKey"))
            for item in store["requirements"]
            if item.get("requirementId") in affected_requirement_ids and item.get("sourceKey")
        })
        _write_store_unlocked(store)
        return {
            "ok": True,
            "coverage": coverage,
            "overview": _overview(store),
            "affectedSourceKeys": affected_source_keys,
            "affectedRequirementIds": sorted(affected_requirement_ids),
        }


def classify_capability(payload: dict[str, Any]) -> dict[str, Any]:
    capability_id = str(payload.get("capabilityId") or "").strip()
    classification = str(payload.get("classification") or "").strip()
    if classification not in {"done", "adjacent", "not_done", "unsure"}:
        raise HTTPException(status_code=422, detail="Unsupported capability classification")
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        summary = _capability_summary(store)
        capability = next(
            (item for item in summary["capabilities"] if item.get("capabilityId") == capability_id),
            None,
        )
        if not capability:
            raise HTTPException(status_code=404, detail=f"Capability not found: {capability_id}")
        evidence_ids = list(dict.fromkeys(payload.get("evidenceIds") or []))
        for evidence_id in evidence_ids:
            _evidence_item(store, evidence_id)
        records_by_id = {
            str(item.get("capabilityId") or ""): item
            for item in store["capabilityRecords"]
            if item.get("capabilityId")
        }
        now = _now()
        record = records_by_id.get(capability_id)
        record_update = {
            "capabilityId": capability_id,
            "canonicalKey": capability["canonicalKey"],
            "label": capability["label"],
            "category": capability["category"],
            "actionability": capability["actionability"],
            "proficiencyApplicable": bool(
                capability["actionability"] == "developable"
                and (
                    capability["proficiencyApplicable"]
                or (
                    capability["category"] == "skill"
                    and normalize_proficiency(payload.get("userProficiency")) != "unspecified"
                )
                )
            ),
            "userProficiency": (
                normalize_proficiency(payload.get("userProficiency"))
                if (
                    capability["category"] == "skill"
                    and classification in {"done", "adjacent"}
                )
                else "unspecified"
            ),
            "userClassification": classification,
            "origin": str((record or {}).get("origin") or "user"),
            "status": "active",
            "userConfirmedAt": now,
            "updatedAt": now,
        }
        if record:
            record.update(record_update)
        else:
            record = {**record_update, "createdAt": now}
            store["capabilityRecords"].append(record)
        _write_store_unlocked(store)
        requirement_ids = list(capability.get("requirementIds") or [])

    affected_source_keys: set[str] = set()
    affected_requirement_ids: set[str] = set()
    for requirement_id in requirement_ids:
        result = classify_coverage({
            "requirementId": requirement_id,
            "userClassification": classification,
            "evidenceIds": evidence_ids,
            "rationale": payload.get("rationale", ""),
            "confidence": payload.get("confidence", 1),
            "userProficiency": payload.get("userProficiency", "unspecified"),
        })
        affected_source_keys.update(result.get("affectedSourceKeys") or [])
        affected_requirement_ids.update(result.get("affectedRequirementIds") or [])
    return {
        "ok": True,
        "overview": read_evidence_overview(),
        "affectedSourceKeys": sorted(affected_source_keys),
        "affectedRequirementIds": sorted(affected_requirement_ids),
    }


def _refresh_coverages_for_evidence(store: dict[str, Any], evidence_id: str) -> None:
    requirements_by_id = {
        str(item.get("requirementId") or ""): item
        for item in store["requirements"]
        if item.get("requirementId")
    }
    for coverage in store["coverages"]:
        if evidence_id not in coverage.get("evidenceIds", []):
            continue
        coverage["coverageStatus"] = _coverage_status(
            store,
            str(coverage.get("userClassification") or "unsure"),
            coverage.get("evidenceIds") or [],
            str(requirements_by_id.get(str(coverage.get("requirementId") or ""), {}).get("verificationMode") or ""),
        )


def _source_keys_for_evidence(store: dict[str, Any], evidence_id: str) -> list[str]:
    requirement_ids = {
        coverage.get("requirementId")
        for coverage in store["coverages"]
        if evidence_id in coverage.get("evidenceIds", [])
    }
    return sorted({
        str(requirement.get("sourceKey"))
        for requirement in store["requirements"]
        if requirement.get("requirementId") in requirement_ids and requirement.get("sourceKey")
    })


def list_evidence_tasks(status: str = "", source_key: str = "") -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        tasks = store["tasks"]
        if status:
            tasks = [task for task in tasks if task.get("status") == status]
        if source_key:
            tasks = [task for task in tasks if source_key in task.get("affectedSourceKeys", [])]
        return {
            "ok": True,
            "path": str(EVIDENCE_STORE_PATH),
            "schemaVersion": store["schemaVersion"],
            "tasks": tasks,
        }


def create_evidence_task(payload: dict[str, Any]) -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        _requirement(store, str(payload.get("requirementId") or ""))
        now = _now()
        payload = {
            **payload,
            "progressPercent": max(0, min(100, int(payload.get("progressPercent") or 0))),
            "nextStep": str(payload.get("nextStep") or "").strip(),
            "progressNotes": [str(item).strip() for item in payload.get("progressNotes") or [] if str(item).strip()],
            "currentProficiency": normalize_proficiency(payload.get("currentProficiency")),
            "targetProficiency": normalize_proficiency(payload.get("targetProficiency")) or "working",
        }
        if payload["targetProficiency"] == "unspecified":
            payload["targetProficiency"] = "working"
        active_tasks = [
            task
            for task in store["tasks"]
            if task.get("requirementId") == payload.get("requirementId")
            and task.get("status") in {"pending", "in_progress"}
        ]
        matching_task = next((task for task in active_tasks if task.get("taskType") == payload.get("taskType")), None)
        for active_task in active_tasks:
            if active_task is matching_task:
                continue
            active_task.update({"status": "dismissed", "updatedAt": now})
        if matching_task:
            matching_task.update({**payload, "updatedAt": now})
            task = matching_task
        else:
            task = {**payload, "taskId": _new_id("task"), "createdAt": now, "updatedAt": now}
            store["tasks"].append(task)
        _write_store_unlocked(store)
        return {"ok": True, "task": task, "overview": _overview(store), "affectedSourceKeys": task["affectedSourceKeys"]}


def update_evidence_task(payload: dict[str, Any]) -> dict[str, Any]:
    task_id = str(payload.get("taskId") or "").strip()
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        store = _read_store_unlocked()
        task = next((item for item in store["tasks"] if item.get("taskId") == task_id), None)
        if not task:
            raise HTTPException(status_code=404, detail=f"Evidence task not found: {task_id}")
        completion_ids = list(dict.fromkeys(payload.get("completionEvidenceIds") or []))
        for evidence_id in completion_ids:
            _evidence_item(store, evidence_id)
        progress_percent = max(0, min(100, int(payload.get("progressPercent") or 0)))
        if payload["status"] == "completed":
            progress_percent = 100
        task.update(
            {
                "status": payload["status"],
                "completionEvidenceIds": completion_ids,
                "progressPercent": progress_percent,
                "nextStep": str(payload.get("nextStep") or "").strip(),
                "progressNotes": [
                    str(item).strip()
                    for item in payload.get("progressNotes") or []
                    if str(item).strip()
                ],
                "currentProficiency": normalize_proficiency(payload.get("currentProficiency")),
                "targetProficiency": normalize_proficiency(payload.get("targetProficiency")),
                "updatedAt": _now(),
            }
        )
        if task["targetProficiency"] == "unspecified":
            task["targetProficiency"] = "working"
        if payload["status"] == "completed":
            task["completedAt"] = task["updatedAt"]
        _write_store_unlocked(store)
        return {"ok": True, "task": task, "overview": _overview(store), "affectedSourceKeys": task["affectedSourceKeys"]}
