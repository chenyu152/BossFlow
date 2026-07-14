"""Pydantic models for resume extraction — aligned with cv.md format."""

from typing import Optional

from pydantic import BaseModel, Field


class WorkExperience(BaseModel):
    company: str = Field(default="", description="公司名称")
    position: str = Field(default="", description="职位")
    duration: str = Field(default="", description="时间范围，如 2021.06-2023.09")
    responsibilities: list[str] = Field(default_factory=list, description="负责内容")
    achievements: list[str] = Field(default_factory=list, description="主要成果")


class Project(BaseModel):
    name: str = Field(default="", description="项目名称")
    role: str = Field(default="", description="你在项目中的角色")
    duration: str = Field(default="", description="项目时间范围")
    description: str = Field(default="", description="项目简介")
    highlights: list[str] = Field(default_factory=list, description="项目亮点 / 技术成果")


class Education(BaseModel):
    school: str = Field(default="", description="学校名称")
    degree: str = Field(default="", description="学位 / 学历")
    major: str = Field(default="", description="专业")
    duration: str = Field(default="", description="就读时间")


class Candidate(BaseModel):
    name: str = Field(default="", description="姓名")
    phone: str = Field(default="", description="手机号码")
    email: str = Field(default="", description="邮箱")
    target_cities: list[str] = Field(default_factory=list, description="意向城市")
    target_roles: list[str] = Field(default_factory=list, description="目标岗位")
    years_of_experience: Optional[float] = Field(default=None, description="工作年限（年）")
    highest_education: str = Field(default="本科", description="最高学历")


class Resume(BaseModel):
    """完整简历结构化数据，直接对应 cv.md 各章节。"""

    candidate: Candidate = Field(default_factory=Candidate)
    skills: list[str] = Field(default_factory=list, description="技能栈")
    languages: list[str] = Field(default_factory=list, description="编程语言")
    frameworks: list[str] = Field(default_factory=list, description="框架/平台")
    databases: list[str] = Field(default_factory=list, description="数据库/中间件")
    ai_llm: list[str] = Field(default_factory=list, description="AI/大模型相关技能")
    tools: list[str] = Field(default_factory=list, description="工程工具")
    work_experience: list[WorkExperience] = Field(default_factory=list, description="工作经历")
    projects: list[Project] = Field(default_factory=list, description="项目经历")
    education: list[Education] = Field(default_factory=list, description="教育背景")
    raw_text: str = Field(default="", description="OCR 识别的原始全文（保留备查）")
    extraction_confidence: str = Field(default="", description="LLM 提取置信度备注")
