from copy import deepcopy
from pathlib import Path
from typing import Any

from crawler.boss import load_config


DEFAULT_SCORING_CONFIG: dict[str, Any] = {
    "keywordHints": [
        "agent", "llm", "rag", "langchain", "prompt", "openai", "deepseek", "ai",
        "大模型", "智能体", "产品", "需求", "用户", "增长", "数据", "策略", "运营",
        "游戏", "系统", "数值", "策划", "python", "java", "go", "react",
        "后端", "前端", "架构", "平台", "工具", "自动化",
    ],
    "baseScore": 1.0,
    "weights": {
        "coverage": 2.0,
        "jdQuality": 0.45,
        "salary": 0.35,
        "experience": 0.75,
        "education": 0.45,
    },
    "jdQuality": {
        "highLength": 600,
        "midLength": 200,
        "highSignal": 1.0,
        "midSignal": 0.72,
        "lowSignal": 0.45,
    },
    "salary": {
        "highAvgK": 25,
        "midAvgK": 15,
        "highSignal": 1.0,
        "midSignal": 0.85,
        "lowSignal": 0.7,
    },
    "experience": {
        "unknownSignal": 0.82,
        "nearYears": 1,
        "nearSignal": 0.72,
        "riskSignal": 0.35,
        "riskCap": 3.1,
    },
    "education": {
        "unknownSignal": 0.88,
        "nearGap": 1,
        "nearSignal": 0.7,
        "riskSignal": 0.35,
        "riskCap": 3.2,
    },
    "fitLevels": [
        {"label": "High Fit", "minScore": 4.2},
        {"label": "Worth Reviewing", "minScore": 3.4},
        {"label": "Weak Match", "minScore": 2.6},
        {"label": "Skip Unless Strategic", "minScore": 1.0},
    ],
}


def _deep_merge(defaults: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(defaults)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def normalize_scoring_config(value: Any) -> dict[str, Any]:
    raw_config = value if isinstance(value, dict) else {}
    has_keyword_hints = "keywordHints" in raw_config
    config = _deep_merge(DEFAULT_SCORING_CONFIG, raw_config)

    keyword_hints = config.get("keywordHints")
    if not has_keyword_hints or not isinstance(keyword_hints, list):
        config["keywordHints"] = DEFAULT_SCORING_CONFIG["keywordHints"]
    else:
        config["keywordHints"] = [str(item).strip() for item in keyword_hints if str(item).strip()]

    fit_levels = config.get("fitLevels")
    if not isinstance(fit_levels, list):
        config["fitLevels"] = DEFAULT_SCORING_CONFIG["fitLevels"]
    else:
        cleaned = []
        for item in fit_levels:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            try:
                min_score = float(item.get("minScore"))
            except (TypeError, ValueError):
                continue
            if label:
                cleaned.append({"label": label, "minScore": min_score})
        config["fitLevels"] = sorted(cleaned or DEFAULT_SCORING_CONFIG["fitLevels"], key=lambda item: item["minScore"], reverse=True)

    return config


def scoring_config_for_project(project_dir: Path) -> dict[str, Any]:
    config = load_config(str(project_dir))
    return normalize_scoring_config(config.get("scoring"))
