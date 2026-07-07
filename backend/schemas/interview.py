from pydantic import BaseModel


class InterviewPrepRequest(BaseModel):
    sourceKey: str
    userNotes: str = ""
