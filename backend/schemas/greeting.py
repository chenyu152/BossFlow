from pydantic import BaseModel


class GreetingDraftSaveRequest(BaseModel):
    sourceKey: str
    editedText: str = ""
    status: str = "draft"


class GreetingPreflightRequest(BaseModel):
    sourceKey: str
    message: str = ""


class GreetingPrepareRequest(GreetingPreflightRequest):
    confirmed: bool = False
