from pydantic import BaseModel


class CvSaveRequest(BaseModel):
    project: str = ""
    content: str = ""
