from pydantic import BaseModel, Field, field_validator


SEARCH_FILTER_KEYS = (
    "position",
    "jobType",
    "salary",
    "experience",
    "degree",
    "industry",
    "scale",
    "stage",
)


class JobSearchFilters(BaseModel):
    position: str = Field(default="", max_length=12)
    jobType: str = Field(default="", max_length=12)
    salary: str = Field(default="", max_length=12)
    experience: str = Field(default="", max_length=12)
    degree: str = Field(default="", max_length=12)
    industry: str = Field(default="", max_length=12)
    scale: str = Field(default="", max_length=12)
    stage: str = Field(default="", max_length=12)

    @field_validator("*", mode="before")
    @classmethod
    def validate_code(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if normalized == "0":
            return ""
        if normalized and not normalized.isdigit():
            raise ValueError("BOSS search filter codes must contain digits only")
        return normalized


def normalize_search_filters(value: object) -> dict[str, str]:
    if isinstance(value, JobSearchFilters):
        return value.model_dump()
    if not isinstance(value, dict):
        value = {}
    return JobSearchFilters(**{
        key: value.get(key, "")
        for key in SEARCH_FILTER_KEYS
    }).model_dump()
