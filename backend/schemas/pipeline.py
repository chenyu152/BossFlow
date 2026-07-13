from pydantic import BaseModel, Field


class AddJobsToPipelineRequest(BaseModel):
    project: str
    jobIds: list[int] = Field(default_factory=list, min_length=1)


class EvaluatePipelineItemRequest(BaseModel):
    sourceKey: str


class ScorePipelineRequest(BaseModel):
    project: str = ""
    sourceKeys: list[str] = Field(default_factory=list)


class ScoreJobsRequest(BaseModel):
    project: str
    jobIds: list[int] = Field(default_factory=list, min_length=1)


class LlmEvaluatePipelineItemRequest(BaseModel):
    sourceKey: str


class PipelineStatusRequest(BaseModel):
    sourceKey: str
    decisionStatus: str


class PipelineDeleteRequest(BaseModel):
    sourceKey: str
