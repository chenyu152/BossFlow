from typing import Optional

from pydantic import BaseModel, Field

from backend.storage.paths import BASE_DIR  # noqa: F401 - ensures crawler package is importable
from crawler.pipeline import MIN_AVG_SALARY_K


class ConfigUpdate(BaseModel):
    project: Optional[str] = None
    keywordsText: str = ""
    citiesText: str = ""
    newJobTarget: int = Field(default=20, ge=1, le=5000)
    maxJobs: int = Field(default=100, ge=1, le=5000)
    minSalary: float = Field(default=MIN_AVG_SALARY_K, ge=0)
    headlessMode: bool = True
    autoSqlite: bool = True
    catRulesText: str = "{}"
    scoringRulesText: str = "{}"
    relevanceText: str = ""
    blacklistText: str = ""


class CrawlRequest(ConfigUpdate):
    persistConfig: bool = True


class ProcessPartialRequest(ConfigUpdate):
    autoSqlite: bool = True
