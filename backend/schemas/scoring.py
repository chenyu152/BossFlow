from pydantic import BaseModel, Field


class ScoringKeywordSuggestionRequest(BaseModel):
    project: str
    limit: int = Field(default=80, ge=10, le=300)
