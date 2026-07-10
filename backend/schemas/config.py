from typing import Optional

from pydantic import BaseModel, Field

from backend.storage.paths import BASE_DIR  # noqa: F401 - ensures crawler package is importable
from crawler.pipeline import MIN_AVG_SALARY_K


class ConfigUpdate(BaseModel):
    project: Optional[str] = None
    keywordsText: str = ""
    citiesText: str = ""
    maxPages: int = Field(default=3, ge=1, le=50)
    scrollTarget: int = Field(default=50, ge=1, le=5000)
    scrollMax: int = Field(default=60, ge=1, le=1000)
    minSalary: float = Field(default=MIN_AVG_SALARY_K, ge=0)
    strategyIndex: int = Field(default=2, ge=0, le=2)
    headlessMode: bool = True
    autoSqlite: bool = True
    catRulesText: str = "{}"
    scoringRulesText: str = "{}"
    relevanceText: str = ""
    blacklistText: str = ""


class CrawlRequest(ConfigUpdate):
    pass


class ProcessPartialRequest(ConfigUpdate):
    autoSqlite: bool = True
