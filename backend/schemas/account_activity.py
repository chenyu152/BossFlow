from typing import Literal

from pydantic import BaseModel, Field


ActivityTab = Literal["all", "communicated", "applied", "interview", "favorited"]
ActivityImportMode = Literal["library", "candidate"]


class AccountActivitySyncRequest(BaseModel):
    project: str = ""
    profileProject: str = ""
    matchProject: str = ""
    accountKey: str = ""
    tabs: list[Literal["communicated", "applied", "interview", "favorited"]] = Field(
        default_factory=lambda: ["communicated", "applied", "interview", "favorited"]
    )


class AccountActivityImportRequest(BaseModel):
    project: str = ""
    matchProject: str = ""
    profileProject: str = ""
    accountKey: str = ""
    accountJobIds: list[int] = Field(default_factory=list, min_length=1)
    mode: ActivityImportMode = "library"
    allowUncertain: bool = False
