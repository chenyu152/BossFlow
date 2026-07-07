from pydantic import BaseModel


class ResumeSuggestionRequest(BaseModel):
    sourceKey: str


class ResumeDraftRequest(BaseModel):
    sourceKey: str
    approvedSuggestionIds: list[str] = []
    userNotes: str = ""
