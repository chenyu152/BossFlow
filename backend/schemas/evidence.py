from typing import Literal

from pydantic import BaseModel, Field


RequirementCategory = Literal["skill", "experience", "behavior", "education", "location", "preference", "other"]
RequirementImportance = Literal["required", "preferred", "context"]
RequirementVerificationMode = Literal["document_fact", "experience_fact", "preference", "behavior_example", "manual_review"]
RequirementGroupMode = Literal["all_of", "any_of"]
EvidenceType = Literal["fact", "project", "metric", "artifact", "story"]
EvidenceStatus = Literal["draft", "confirmed", "rejected", "archived"]
EvidenceClassification = Literal["done", "adjacent", "not_done", "unsure"]
EvidenceTaskType = Literal["extract", "strengthen", "translate", "learn", "project", "accept_risk", "ignore"]
EvidenceTaskStatus = Literal["pending", "in_progress", "completed", "dismissed"]
ProficiencyLevel = Literal["unspecified", "awareness", "familiar", "working", "proficient", "expert"]


class RequirementPayload(BaseModel):
    requirementId: str = ""
    canonicalKey: str
    canonicalGroupId: str = ""
    capabilityName: str = ""
    label: str
    category: RequirementCategory = "other"
    verificationMode: RequirementVerificationMode = "manual_review"
    importance: RequirementImportance = "context"
    sourceKey: str
    jdQuote: str = ""
    requiredProficiency: ProficiencyLevel = "unspecified"
    requiredProficiencySource: str = ""
    proficiencyApplicable: bool = False
    requirementGroupId: str = ""
    requirementGroupMode: RequirementGroupMode = "all_of"
    requirementGroupLabel: str = ""
    minimumSatisfied: int = Field(default=1, ge=1)
    extractionConfidence: float = Field(default=0, ge=0, le=1)


class RequirementsUpsertRequest(BaseModel):
    project: str = ""
    requirements: list[RequirementPayload] = Field(default_factory=list)


class EvidenceSourceRefPayload(BaseModel):
    type: str
    ref: str = ""
    quote: str = ""


class EvidenceItemCreateRequest(BaseModel):
    project: str = ""
    title: str
    evidenceType: EvidenceType = "fact"
    summary: str = ""
    userRole: str = ""
    actions: list[str] = Field(default_factory=list)
    results: list[str] = Field(default_factory=list)
    sourceRefs: list[EvidenceSourceRefPayload] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    requirementIds: list[str] = Field(default_factory=list)
    status: Literal["draft"] = "draft"


class EvidenceItemUpdateRequest(EvidenceItemCreateRequest):
    evidenceId: str
    status: EvidenceStatus = "draft"


class EvidenceItemConfirmRequest(BaseModel):
    project: str = ""
    evidenceId: str


class EvidenceCoverageClassifyRequest(BaseModel):
    project: str = ""
    requirementId: str
    userClassification: EvidenceClassification
    evidenceIds: list[str] = Field(default_factory=list)
    rationale: str = ""
    confidence: float = Field(default=0, ge=0, le=1)
    userProficiency: ProficiencyLevel = "unspecified"


class EvidenceTaskCreateRequest(BaseModel):
    project: str = ""
    requirementId: str
    taskType: EvidenceTaskType
    affectedSourceKeys: list[str] = Field(default_factory=list)
    recommendedAction: str = ""
    estimatedEffortBand: str = ""
    timeBudget: str = ""
    userWillingness: str = ""
    priorityBand: Literal["high", "medium", "low"] = "medium"
    status: EvidenceTaskStatus = "pending"
    completionEvidenceIds: list[str] = Field(default_factory=list)
    progressPercent: int = Field(default=0, ge=0, le=100)
    nextStep: str = ""
    progressNotes: list[str] = Field(default_factory=list)
    currentProficiency: ProficiencyLevel = "unspecified"
    targetProficiency: ProficiencyLevel = "working"


class EvidenceTaskUpdateRequest(BaseModel):
    project: str = ""
    taskId: str
    status: EvidenceTaskStatus
    completionEvidenceIds: list[str] = Field(default_factory=list)
    progressPercent: int = Field(default=0, ge=0, le=100)
    nextStep: str = ""
    progressNotes: list[str] = Field(default_factory=list)
    currentProficiency: ProficiencyLevel = "unspecified"
    targetProficiency: ProficiencyLevel = "working"
