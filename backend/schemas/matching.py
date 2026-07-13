from pydantic import BaseModel


class MatchingRulesSuggestionRequest(BaseModel):
    project: str
    keywordsText: str = ""
    catRulesText: str = "{}"
    relevanceText: str = ""
    blacklistText: str = ""
