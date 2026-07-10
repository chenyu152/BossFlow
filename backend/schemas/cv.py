from pydantic import BaseModel


class CvSaveRequest(BaseModel):
    content: str = ""
