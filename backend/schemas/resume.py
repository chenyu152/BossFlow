from pydantic import BaseModel


class ResumeSuggestionRequest(BaseModel):
    sourceKey: str
