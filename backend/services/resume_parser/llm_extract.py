"""DeepSeek LLM call — OCR text → structured JSON (Pydantic Resume model)."""

import json
import os
import re
from typing import Any

import requests
from dotenv import load_dotenv

from schema import Resume

# ── config ──────────────────────────────────────────────

def _load_api_config(env_path: str | None = None) -> tuple[str, str, str]:
    """加载 API 配置。先找 ppocrdemo/.env，再找 BossFlow/.env。"""
    candidates = [
        env_path,
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", "BossFlow", ".env"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            load_dotenv(path)
            break

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    api_base = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    return api_key, api_base, model


def _call_llm(messages: list[dict[str, str]], response_json: bool = True) -> str:
    """OpenAI 兼容接口调用。"""
    api_key, api_base, model = _load_api_config()
    if not api_key:
        raise RuntimeError("DEEPSEEK_API_KEY 未设置，请检查 .env 文件")

    url = f"{api_base.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 6000,
    }
    if response_json:
        payload["response_format"] = {"type": "json_object"}

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"LLM API 失败 ({resp.status_code}): {resp.text[:500]}")

    data = resp.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError("LLM API 返回格式异常") from e


# ── extraction prompt ───────────────────────────────────

EXTRACTION_SYSTEM = """你是一个专业简历解析助手。根据 OCR 识别出的简历文本，提取结构化信息。

规则：
- 只提取文本中明确写出的信息，不要编造任何字段。
- 数值、年份、电话号码必须与原文一致。
- **工作年限（candidate.years_of_experience）**：根据工作经历中的时间范围推算。例如最早工作开始于 2023.02，简历日期为 2026.07，则填 3.4。如果简历日期无法确定，用当前日期估算。
- 如果某个字段在原文中找不到，留空字符串 "" 或 []。
- 技能按类别分组：编程语言 → languages，框架平台 → frameworks，数据库中间件 → databases，AI/大模型 → ai_llm，工程工具 → tools，通用技能 → skills。
- 工作经历和项目经历按时间倒序排列。
- 输出必须是合法 JSON，对应以下结构。
"""

EXTRACTION_USER = """请从以下 OCR 识别结果中提取简历信息。

OCR 识别全文（可能包含少量识别错误，请结合上下文推断修正）：
```
{ocr_text}
```

请严格按照以下 JSON Schema 输出（不要输出任何其他内容）。所有字段若原文找不到则留空：

{{
  "candidate": {{
    "name": "",
    "phone": "",
    "email": "",
    "target_cities": [],
    "target_roles": [],
    "years_of_experience": null,
    "highest_education": ""
  }},
  "skills": [],
  "languages": [],
  "frameworks": [],
  "databases": [],
  "ai_llm": [],
  "tools": [],
  "work_experience": [
    {{
      "company": "",
      "position": "",
      "duration": "",
      "responsibilities": [],
      "achievements": []
    }}
  ],
  "projects": [
    {{
      "name": "",
      "role": "",
      "duration": "",
      "description": "",
      "highlights": []
    }}
  ],
  "education": [
    {{
      "school": "",
      "degree": "",
      "major": "",
      "duration": ""
    }}
  ],
  "extraction_confidence": ""
}}
"""


# ── public API ──────────────────────────────────────────

def extract_resume(ocr_text: str) -> Resume:
    """
    将 OCR 识别文本发送给 LLM，返回结构化 Resume 对象。

    Args:
        ocr_text: PaddleOCR 识别出的完整文本

    Returns:
        Resume Pydantic 模型（解析失败时 raw_text 保留原文，其他字段为空）
    """
    messages = [
        {"role": "system", "content": EXTRACTION_SYSTEM},
        {"role": "user", "content": EXTRACTION_USER.format(ocr_text=ocr_text[:15000])},
    ]

    raw_response = _call_llm(messages, response_json=True)

    # 尝试直接解析 JSON
    try:
        data = json.loads(raw_response)
    except json.JSONDecodeError:
        # 有时 LLM 会包在 ```json ... ``` 里
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw_response)
        if match:
            try:
                data = json.loads(match.group(1))
            except json.JSONDecodeError:
                return Resume(raw_text=ocr_text, extraction_confidence="JSON 解析失败")
        else:
            return Resume(raw_text=ocr_text, extraction_confidence="JSON 解析失败")

    try:
        resume = Resume(**data)
        resume.raw_text = ocr_text
        return resume
    except Exception:
        return Resume(raw_text=ocr_text, extraction_confidence="Pydantic 校验失败")
