from pydantic import BaseModel, Field


class LlmSettingsUpdate(BaseModel):
    apiKey: str = Field(default="", max_length=1000)
    apiBase: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=200)
