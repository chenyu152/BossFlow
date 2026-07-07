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


class InterviewStoryDraftPayload(InterviewStoryPayload):
    draftId: str = ""
    status: str = "needs_confirmation"
    sourceKey: str = ""
    sourceLabel: str = ""
    prepPath: str = ""
    createdAt: str = ""
    updatedAt: str = ""
    promotedAt: str = ""
    promotedStoryId: str = ""


class StoryDraftsSaveRequest(BaseModel):
    drafts: list[InterviewStoryDraftPayload]


class StoryDraftPromoteRequest(BaseModel):
    draftId: str
    draft: InterviewStoryDraftPayload
