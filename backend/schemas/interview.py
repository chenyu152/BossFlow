from pydantic import BaseModel


class InterviewPrepRequest(BaseModel):
    sourceKey: str
    userNotes: str = ""


class InterviewStoryPayload(BaseModel):
    title: str = ""
    theme: str = ""
    source: str = ""
    tags: list[str] = []
    situation: str = ""
    task: str = ""
    action: str = ""
    result: str = ""
    reflection: str = ""


class StoryBankSaveRequest(BaseModel):
    stories: list[InterviewStoryPayload]
