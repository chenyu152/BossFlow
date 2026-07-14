from pydantic import BaseModel


class ProjectCreateRequest(BaseModel):
    name: str
