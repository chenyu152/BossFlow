from __future__ import annotations

import json
import threading
import time
from urllib.request import Request, urlopen


CONDITIONS_URL = "https://www.zhipin.com/wapi/zpgeek/pc/all/filter/conditions.json"
POSITION_URL = "https://www.zhipin.com/wapi/zpCommon/data/position.json"
INDUSTRY_URL = "https://www.zhipin.com/wapi/zpCommon/data/industry.json"
CACHE_SECONDS = 12 * 60 * 60

_cache_lock = threading.Lock()
_cache: tuple[float, dict] | None = None


FALLBACK_FIELDS = {
    "jobType": {
        "label": "求职类型",
        "options": [
            {"value": "", "label": "不限"},
            {"value": "1901", "label": "全职"},
            {"value": "1903", "label": "兼职"},
        ],
    },
    "salary": {
        "label": "薪资待遇",
        "options": [
            {"value": "", "label": "不限"},
            {"value": "402", "label": "3K以下"},
            {"value": "403", "label": "3-5K"},
            {"value": "404", "label": "5-10K"},
            {"value": "405", "label": "10-20K"},
            {"value": "406", "label": "20-50K"},
            {"value": "407", "label": "50K以上"},
        ],
    },
    "experience": {
        "label": "工作经验",
        "options": [
            {"value": "", "label": "不限"},
            {"value": "108", "label": "在校生"},
            {"value": "102", "label": "应届生"},
            {"value": "101", "label": "经验不限"},
            {"value": "103", "label": "1年以内"},
            {"value": "104", "label": "1-3年"},
            {"value": "105", "label": "3-5年"},
            {"value": "106", "label": "5-10年"},
            {"value": "107", "label": "10年以上"},
        ],
    },
    "degree": {
        "label": "学历要求",
        "options": [
            {"value": "", "label": "不限"},
            {"value": "209", "label": "初中及以下"},
            {"value": "208", "label": "中专/中技"},
            {"value": "206", "label": "高中"},
            {"value": "202", "label": "大专"},
            {"value": "203", "label": "本科"},
            {"value": "204", "label": "硕士"},
            {"value": "205", "label": "博士"},
        ],
    },
    "scale": {
        "label": "公司规模",
        "options": [
            {"value": "", "label": "不限"},
            {"value": "301", "label": "0-20人"},
            {"value": "302", "label": "20-99人"},
            {"value": "303", "label": "100-499人"},
            {"value": "304", "label": "500-999人"},
            {"value": "305", "label": "1000-9999人"},
            {"value": "306", "label": "10000人以上"},
        ],
    },
    "stage": {
        "label": "融资阶段",
        "options": [
            {"value": "", "label": "不限"},
            {"value": "801", "label": "未融资"},
            {"value": "802", "label": "天使轮"},
            {"value": "803", "label": "A轮"},
            {"value": "804", "label": "B轮"},
            {"value": "805", "label": "C轮"},
            {"value": "806", "label": "D轮及以上"},
            {"value": "807", "label": "已上市"},
            {"value": "808", "label": "不需要融资"},
        ],
    },
    "position": {"label": "职位类型", "options": [{"value": "", "label": "不限"}]},
    "industry": {"label": "公司行业", "options": [{"value": "", "label": "不限"}]},
}

CONDITION_FIELD_MAP = {
    "jobType": "jobTypeList",
    "salary": "salaryList",
    "experience": "experienceList",
    "degree": "degreeList",
    "scale": "scaleList",
    "stage": "stageList",
}


def _read_json(url: str) -> object:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Referer": "https://www.zhipin.com/web/geek/job",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urlopen(request, timeout=6) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("code") != 0:
        raise RuntimeError(str(payload.get("message") or "BOSS filter metadata request failed"))
    return payload.get("zpData")


def _condition_options(items: object) -> list[dict[str, str]]:
    options = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code") or "")
        label = str(item.get("name") or "").strip()
        if not label:
            continue
        options.append({"value": "" if code == "0" else code, "label": label})
    return options


def _tree_options(items: object, *, include_middle_level: bool) -> list[dict[str, str]]:
    options: list[dict[str, str]] = [{"value": "", "label": "不限"}]

    def visit(nodes: object, path: list[str], group: str) -> None:
        for item in nodes if isinstance(nodes, list) else []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            code = str(item.get("code") or "")
            children = item.get("subLevelModelList")
            next_path = [*path, name] if name else path
            if code and name and (not children or include_middle_level):
                options.append({
                    "value": code,
                    "label": " / ".join(next_path),
                    "group": group or name,
                })
            if children:
                visit(children, next_path, group or name)

    visit(items, [], "")
    return options


def search_filter_options(force_refresh: bool = False) -> dict:
    global _cache
    now = time.time()
    with _cache_lock:
        if not force_refresh and _cache and now - _cache[0] < CACHE_SECONDS:
            return _cache[1]

    fields = {
        key: {
            "label": str(value["label"]),
            "options": [dict(option) for option in value["options"]],
        }
        for key, value in FALLBACK_FIELDS.items()
    }
    sources: list[str] = []
    try:
        conditions = _read_json(CONDITIONS_URL)
        if isinstance(conditions, dict):
            for field, source_key in CONDITION_FIELD_MAP.items():
                options = _condition_options(conditions.get(source_key))
                if options:
                    fields[field]["options"] = options
            sources.append("conditions")
    except Exception:
        pass
    try:
        positions = _read_json(POSITION_URL)
        fields["position"]["options"] = _tree_options(positions, include_middle_level=False)
        sources.append("position")
    except Exception:
        pass
    try:
        industries = _read_json(INDUSTRY_URL)
        fields["industry"]["options"] = _tree_options(industries, include_middle_level=False)
        sources.append("industry")
    except Exception:
        pass

    result = {
        "ok": True,
        "source": "boss" if len(sources) == 3 else "partial" if sources else "fallback",
        "fields": fields,
    }
    with _cache_lock:
        _cache = (now, result)
    return result
