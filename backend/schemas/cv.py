from typing import Literal

from pydantic import BaseModel, Field

from backend.schemas.evidence import ProficiencyLevel


class CvSaveRequest(BaseModel):
    project: str = ""
    content: str = ""


class ResumeCapabilityImportSelection(BaseModel):
    proposalId: str
    selected: bool = True
    label: str = ""
    userProficiency: ProficiencyLevel = "unspecified"


class ResumeCapabilityImportRequest(BaseModel):
    project: str = ""
    selections: list[ResumeCapabilityImportSelection] = Field(default_factory=list)
    sourceRevision: str


class CapabilityDecisionRequest(BaseModel):
    project: str = ""
    capabilityId: str
    classification: Literal["done", "adjacent", "not_done", "unsure"]
    evidenceIds: list[str] = Field(default_factory=list)
    rationale: str = ""
    confidence: float = Field(default=1, ge=0, le=1)
    userProficiency: ProficiencyLevel = "unspecified"
