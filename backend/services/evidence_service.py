from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.storage.file_lock import exclusive_file_lock
from backend.storage.paths import BASE_DIR

DATA_DIR = BASE_DIR / "data"
EVIDENCE_STORE_PATH = DATA_DIR / "evidence-store.json"
EVIDENCE_LOCK_PATH = DATA_DIR / ".evidence-store.lock"
EVIDENCE_SCHEMA_VERSION = 3

VERIFICATION_MODES = {"document_fact", "experience_fact", "preference", "behavior_example", "manual_review"}


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _stable_requirement_id(source_key: str, canonical_key: str) -> str:
    digest = hashlib.sha1(f"{source_key}|{canonical_key}".encode("utf-8")).hexdigest()[:12]
    return f"req-{digest}"


def _normalize_canonical_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    normalized = re.sub(r"[\s_/\\|:：]+", "-", normalized)
    normalized = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", normalized, flags=re.UNICODE)
    return re.sub(r"-+", "-", normalized).strip("-")


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
        "requirements": [],
        "evidenceItems": [],
        "coverages": [],
        "tasks": [],
        "updatedAt": _now(),
    }


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
    for key in ("requirements", "evidenceItems", "coverages", "tasks"):
        if not isinstance(store.get(key), list):
            store[key] = []
            changed = True

    for requirement in store["requirements"]:
        if not isinstance(requirement, dict):
            continue
        canonical_key = _normalize_canonical_key(requirement.get("canonicalKey"))
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
        and task.get("status") in {"pending", "in_progress"}
    )
    return {
        "ok": True,
        "path": str(EVIDENCE_STORE_PATH),
        **store,
        "counts": {
            "requirements": sum(1 for item in store["requirements"] if item.get("active") is not False),
            "evidenceItems": len(store["evidenceItems"]),
            "confirmedEvidenceItems": confirmed,
            "unresolvedCoverages": unresolved,
            "pendingTasks": pending_tasks,
        },
    }


def read_evidence_overview() -> dict[str, Any]:
    with exclusive_file_lock(EVIDENCE_LOCK_PATH):
        return _overview(_read_store_unlocked())


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
        for raw in requirements:
            item = dict(raw)
            canonical_key = _normalize_canonical_key(item.get("canonicalKey"))
            if not canonical_key:
                continue
            item["canonicalKey"] = canonical_key
            item["canonicalGroupId"] = _canonical_group_id(canonical_key)
            item["verificationMode"] = _verification_mode(item.get("category"), item.get("verificationMode"))
            item["active"] = True
            requirement_id = str(item.get("requirementId") or "").strip() or _new_id("req")
            item["requirementId"] = requirement_id
            if requirement_id in by_id:
                by_id[requirement_id].update(item)
            else:
                store["requirements"].append(item)
                by_id[requirement_id] = item
        _write_store_unlocked(store)
        return _overview(store)


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

        for assessment in assessments:
            canonical_key = _normalize_canonical_key(assessment.get("canonicalKey"))
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
                            "userDecisionAt": "",
                            "decisionSource": "assessment",
                            "verificationStatus": "candidate" if assessment_patch["candidateEvidenceRefs"] else "needs_input",
                            "reusedFromRequirementId": "",
                            "reusedAt": "",
                        }
                    )
            synced_coverages.append(coverage)

        synced_requirement_ids = {item["requirementId"] for item in synced_requirements}
        required_ids = {
            item["requirementId"]
            for item in synced_requirements
            if item.get("importance") == "required"
        }
        supported_count = sum(
            1
            for coverage in synced_coverages
            if coverage.get("coverageStatus") == "supported"
        )
        potential_count = sum(
            1
            for coverage in synced_coverages
            if not coverage.get("userDecisionAt")
            and coverage.get("assessmentStatus") in {"supported", "partial"}
        )
        unresolved_count = sum(
            1
            for coverage in synced_coverages
            if coverage.get("coverageStatus") != "supported"
        )
        blocking_count = sum(
            1
            for coverage in synced_coverages
            if coverage.get("requirementId") in required_ids
            and coverage.get("coverageStatus") in {"not_found", "user_confirmed_absent"}
        )
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
                "requirementCount": len(synced_requirements),
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
        task.update({"status": payload["status"], "completionEvidenceIds": completion_ids, "updatedAt": _now()})
        if payload["status"] == "completed":
            task["completedAt"] = task["updatedAt"]
        _write_store_unlocked(store)
        return {"ok": True, "task": task, "overview": _overview(store), "affectedSourceKeys": task["affectedSourceKeys"]}
