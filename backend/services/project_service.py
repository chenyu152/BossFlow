import json
import socket
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from backend.schemas.config import ConfigUpdate
from backend.storage.paths import BASE_DIR, PROJECTS_DIR
from crawler.boss import DEFAULT_PROFILE_DIR, load_config
from crawler.config import DEFAULT_SCRAPE_LIMITS, save_config
from crawler.pipeline import MIN_AVG_SALARY_K


def find_free_port(start_port: int = 9222) -> int:
    port = start_port
    while port < 9500:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    return start_port


def project_names() -> List[str]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    names = [
        child.name
        for child in PROJECTS_DIR.iterdir()
        if child.is_dir() and (child / "config.json").exists()
    ]
    return sorted(names)


def default_project_name() -> str:
    names = project_names()
    if "agent" in names:
        return "agent"
    if names:
        return names[0]
    default_dir = PROJECTS_DIR / "default"
    default_dir.mkdir(parents=True, exist_ok=True)
    source = BASE_DIR / "crawler" / "config" / "keywords.json"
    target = default_dir / "config.json"
    if source.exists() and not target.exists():
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    return "default"


def resolve_project(project: Optional[str]) -> Path:
    name = project or default_project_name()
    if not name or Path(name).is_absolute() or any(part == ".." for part in Path(name).parts):
        raise HTTPException(status_code=400, detail="Invalid project name")
    path = (PROJECTS_DIR / name).resolve()
    if PROJECTS_DIR.resolve() not in path.parents and path != PROJECTS_DIR.resolve():
        raise HTTPException(status_code=400, detail="Project escapes workspace")
    if not (path / "config.json").exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {name}")
    return path


def paths_for_project(project_dir: Path) -> Dict[str, str]:
    return {
        "project": project_dir.name,
        "projectPath": str(project_dir),
        "configPath": str(project_dir / "config.json"),
        "dbPath": str(project_dir / "jobs_data.db"),
        "partialPath": str(project_dir / "crawl_partial.json"),
        "profilePath": str(project_dir / DEFAULT_PROFILE_DIR),
    }


def split_lines(value: Optional[str]) -> List[str]:
    return [line.strip() for line in str(value or "").splitlines() if line.strip()]


def cities_to_text(cities: Dict[str, str]) -> str:
    return "\n".join(f"{name}={code}" for name, code in cities.items())


def text_to_cities(text: str) -> Dict[str, str]:
    cities: Dict[str, str] = {}
    for raw in str(text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if "=" not in line:
            raise ValueError(f"城市配置格式错误: {line}")
        name, code = line.split("=", 1)
        name, code = name.strip(), code.strip()
        if name and code:
            cities[name] = code
    return cities


def stats_for_project(project_dir: Path, config: Dict[str, Any]) -> Dict[str, Any]:
    db_path = project_dir / "jobs_data.db"
    job_count = 0
    if db_path.exists() and db_path.stat().st_size > 0:
        try:
            conn = sqlite3.connect(str(db_path))
            try:
                row = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()
                job_count = int(row[0] or 0)
            finally:
                conn.close()
        except sqlite3.Error:
            job_count = 0
    return {
        "jobCount": job_count,
        "keywordCount": len(config.get("keywords") or []),
        "cityCount": len(config.get("cities") or {}),
        "dbFileName": db_path.name,
        "dbFilePath": str(db_path),
    }


def config_payload(project_dir: Path) -> Dict[str, Any]:
    config = load_config(str(project_dir))
    limits = DEFAULT_SCRAPE_LIMITS.copy()
    limits.update(config.get("scrape_limits") or {})
    paths = paths_for_project(project_dir)
    payload = {
        "ok": True,
        **paths,
        "config": config,
        "keywordsText": "\n".join(config.get("keywords") or []),
        "citiesText": cities_to_text(config.get("cities") or {}),
        "catRulesText": json.dumps(config.get("cat_rules") or {}, ensure_ascii=False, indent=2),
        "relevanceText": "\n".join(config.get("relevance_keywords") or []),
        "blacklistText": "\n".join(config.get("blacklist_keywords") or []),
        "maxPages": int(limits.get("max_pages", 3)),
        "maxScrollsPerPage": int(limits.get("max_scrolls_per_page", 2)),
        "scrollTarget": int(limits.get("scroll_target", 50)),
        "scrollMax": int(limits.get("scroll_max_scrolls", 60)),
        "greedyMaxPages": int(limits.get("greedy_max_pages", 0)),
        "maxJobsPerCityRound": int(limits.get("max_jobs_per_city_round", 0)),
        "minSalary": float(config.get("min_salary", MIN_AVG_SALARY_K)),
    }
    payload.update(stats_for_project(project_dir, config))
    return payload


def save_form_config(payload: ConfigUpdate) -> tuple[Path, Dict[str, Any], Dict[str, str]]:
    project_dir = resolve_project(payload.project)
    keywords = split_lines(payload.keywordsText)
    try:
        cities = text_to_cities(payload.citiesText)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not keywords:
        raise HTTPException(status_code=400, detail="至少需要一个关键词")
    if not cities:
        raise HTTPException(status_code=400, detail="至少需要一个城市")
    try:
        cat_rules = json.loads(payload.catRulesText or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"分类规则 JSON 格式错误: {exc}") from exc
    if not isinstance(cat_rules, dict):
        raise HTTPException(status_code=400, detail="分类规则必须是 JSON 对象")

    old_config = load_config(str(project_dir))
    old_limits = DEFAULT_SCRAPE_LIMITS.copy()
    old_limits.update(old_config.get("scrape_limits") or {})
    config = dict(old_config)
    config["keywords"] = keywords
    config["cities"] = cities
    config["scrape_limits"] = {
        "max_pages": int(payload.maxPages or old_limits["max_pages"]),
        "max_scrolls_per_page": int(old_limits.get("max_scrolls_per_page", 2)),
        "scroll_target": int(payload.scrollTarget or old_limits["scroll_target"]),
        "scroll_max_scrolls": int(payload.scrollMax or old_limits["scroll_max_scrolls"]),
        "greedy_max_pages": int(old_limits.get("greedy_max_pages", 0)),
        "max_jobs_per_city_round": int(old_limits.get("max_jobs_per_city_round", 0)),
    }
    config["min_salary"] = float(payload.minSalary or MIN_AVG_SALARY_K)
    config["cat_rules"] = cat_rules
    config["relevance_keywords"] = split_lines(payload.relevanceText)
    config["blacklist_keywords"] = split_lines(payload.blacklistText)
    save_config(config, str(project_dir))
    return project_dir, config, paths_for_project(project_dir)
