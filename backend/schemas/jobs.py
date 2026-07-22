from pydantic import BaseModel, Field


class JobLiveStatusUpdateRequest(BaseModel):
    project: str
    jobIds: list[int] = Field(default_factory=list)
    limit: int | None = Field(default=None, ge=1)
    skipClosed: bool = True
    workers: int = Field(default=1, ge=1, le=8)
    sleepSeconds: float = Field(default=5.0, ge=0)
    browserWaitSeconds: float = Field(default=6.0, ge=1)
    headless: bool = True
    interactiveOnCaptcha: bool = True
    verificationTimeoutSeconds: int = Field(default=240, ge=30, le=900)


class JobCreateRequest(BaseModel):
    project: str
    title: str
    company: str
    city: str = ""
    salary: str = ""
    exp: str = ""
    edu: str = ""
    desc: str = ""
    url: str = ""
    security_id: str = ""
