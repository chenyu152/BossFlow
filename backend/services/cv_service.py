import re
import shutil
from typing import Any

from fastapi import HTTPException

from backend.storage.paths import BASE_DIR

CV_PATH = BASE_DIR / "cv.md"
CV_EXAMPLE_PATH = BASE_DIR / "cv.example.md"


def _read_cv() -> str:
    if not CV_PATH.exists() or not CV_PATH.is_file():
        return ""
    return CV_PATH.read_text(encoding="utf-8").strip()


def _has_years(text: str) -> bool:
    text = re.sub(r"[*_`#>\-]", "", text)
    patterns = [
        r"工作经验\s*[:：]?\s*\d+(?:\.\d+)?\s*年",
        r"工作经验\s*[:：]?\s*[一二两三四五六七八九十]+\s*年",
        r"\d+(?:\.\d+)?\s*年(?:以上)?(?:工作|开发|研发|行业)?经验",
        r"[一二两三四五六七八九十]+\s*年(?:以上)?(?:工作|开发|研发|行业)?经验",
        r"work\s+experience\s*[:：]?\s*\d+(?:\.\d+)?\s*years?",
        r"\d+(?:\.\d+)?\s*years?\s+of\s+(?:work|development|engineering)?\s*experience",
    ]
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def _has_education(text: str) -> bool:
    labels = ["中专", "高中", "大专", "专科", "本科", "学士", "硕士", "研究生", "博士", "bachelor", "master", "phd"]
    return any(label.lower() in text.lower() for label in labels)


def _has_heading(text: str, labels: list[str]) -> bool:
    for label in labels:
        if re.search(rf"^#+\s*.*{re.escape(label)}", text, flags=re.IGNORECASE | re.MULTILINE):
            return True
    return False


def cv_status() -> dict[str, Any]:
    exists = CV_PATH.exists() and CV_PATH.is_file()
    text = _read_cv()
    checks = {
        "hasContent": bool(text),
        "hasYears": _has_years(text),
        "hasEducation": _has_education(text),
        "hasSkills": _has_heading(text, ["技能", "Skills"]),
        "hasProjects": _has_heading(text, ["项目", "Projects"]),
        "hasExperience": _has_heading(text, ["工作", "经历", "Experience"]),
    }
    missing = [key for key, ok in checks.items() if not ok]
    return {
        "ok": True,
        "exists": exists,
        "path": str(CV_PATH),
        "examplePath": str(CV_EXAMPLE_PATH),
        "isEmpty": exists and not bool(text),
        "checks": checks,
        "missing": missing,
        "readyForScoring": exists and checks["hasContent"] and checks["hasYears"] and checks["hasEducation"],
        "readyForMaterials": exists and checks["hasContent"] and checks["hasSkills"] and checks["hasProjects"],
        "canCreateFromTemplate": not exists and CV_EXAMPLE_PATH.exists(),
    }


def create_cv_from_template() -> dict[str, Any]:
    if CV_PATH.exists():
        raise HTTPException(status_code=409, detail="cv.md already exists")
    if not CV_EXAMPLE_PATH.exists():
        raise HTTPException(status_code=404, detail="cv.example.md not found")
    shutil.copyfile(CV_EXAMPLE_PATH, CV_PATH)
    return cv_status()
