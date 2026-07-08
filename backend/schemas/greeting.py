from pydantic import BaseModel


class GreetingDraftSaveRequest(BaseModel):
    sourceKey: str
    editedText: str = ""
    status: str = "draft"
