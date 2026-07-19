from typing import Literal

from pydantic import BaseModel, Field, field_validator


AutomationCadence = Literal["daily", "weekdays", "weekly"]
AutomationMisfirePolicy = Literal["run_once", "skip"]


class AutomationScheduleInput(BaseModel):
    project: str = Field(min_length=1, max_length=60)
    enabled: bool = True
    cadence: AutomationCadence = "daily"
    timeOfDay: str = Field(default="09:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    daysOfWeek: list[int] = Field(default_factory=list, max_length=7)
    misfirePolicy: AutomationMisfirePolicy = "run_once"
    maxDelayMinutes: int = Field(default=360, ge=0, le=10080)
    keywordsText: str = Field(default="", max_length=4000)
    citiesText: str = Field(default="", max_length=12000)
    newJobTarget: int = Field(default=20, ge=1, le=5000)
    maxJobs: int = Field(default=100, ge=1, le=5000)

    @field_validator("daysOfWeek")
    @classmethod
    def validate_days_of_week(cls, value: list[int]) -> list[int]:
        normalized = sorted(set(value))
        if any(day < 0 or day > 6 for day in normalized):
            raise ValueError("daysOfWeek values must be between 0 and 6")
        return normalized


class AutomationScheduleUpdate(AutomationScheduleInput):
    pass
