from pydantic import BaseModel, Field


class MockInterviewCreateRequest(BaseModel):
    sourceKey: str
    mode: str = "comprehensive"
    difficulty: str = "auto"
    durationMinutes: int = 20
    userNotes: str = ""


class MockInterviewAnswerDraftRequest(BaseModel):
    project: str = ""
    turnId: str
    answer: str = ""
    assisted: bool = False


class MockInterviewAnswerRequest(MockInterviewAnswerDraftRequest):
    skipped: bool = False


class MockInterviewCompleteRequest(BaseModel):
    project: str = ""


class MockInterviewStoryDraftRequest(BaseModel):
    project: str = ""
    candidateIds: list[str] = Field(default_factory=list)
