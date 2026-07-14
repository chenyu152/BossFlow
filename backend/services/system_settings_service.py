import os
from pathlib import Path

import requests

from backend.storage.paths import BASE_DIR


ENV_PATH = BASE_DIR / ".env"
_MANAGED_KEYS = {"BOSSSPIDER_LLM_API_KEY", "BOSSSPIDER_LLM_API_BASE", "BOSSSPIDER_LLM_MODEL"}


def _file_values() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    values: dict[str, str] = {}
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _env_or_file(name: str, values: dict[str, str], fallback: str = "") -> str:
    return os.getenv(name) or values.get(name, fallback)


def _resolved_llm_values() -> tuple[str, str, str, bool]:
    values = _file_values()
    environment_configured = bool(
        os.getenv("BOSSSPIDER_LLM_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
    )
    api_key = (
        _env_or_file("BOSSSPIDER_LLM_API_KEY", values)
        or _env_or_file("DEEPSEEK_API_KEY", values)
        or _env_or_file("OPENAI_API_KEY", values)
    )
    api_base = (
        _env_or_file("BOSSSPIDER_LLM_API_BASE", values)
        or _env_or_file("DEEPSEEK_API_BASE", values)
        or _env_or_file("DEEPSEEK_BASE_URL", values, "https://api.deepseek.com/v1")
    )
    model = _env_or_file("BOSSSPIDER_LLM_MODEL", values) or _env_or_file("DEEPSEEK_MODEL", values, "deepseek-chat")
    return api_key, api_base, model, environment_configured


def llm_settings_status() -> dict[str, object]:
    api_key, api_base, model, environment_configured = _resolved_llm_values()
    return {
        "configured": bool(api_key),
        "apiKeyMasked": f"{'*' * max(8, len(api_key) - 4)}{api_key[-4:]}" if api_key else "",
        "apiBase": api_base,
        "model": model,
        "source": "environment" if environment_configured else "settings-file",
    }


def reveal_llm_api_key() -> str:
    return _resolved_llm_values()[0]


def test_llm_connection(api_key: str, api_base: str, model: str) -> dict[str, str]:
    configured_key, configured_base, configured_model, _ = _resolved_llm_values()
    api_key = api_key.strip() or configured_key
    api_base = api_base.strip() or configured_base
    model = model.strip() or configured_model
    if not api_key:
        raise ValueError("LLM API key is required")
    if not api_base.startswith(("https://", "http://")):
        raise ValueError("LLM API Base must start with http:// or https://")
    if not model:
        raise ValueError("LLM model is required")
    try:
        response = requests.post(
            f"{api_base.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": [{"role": "user", "content": "Reply with OK."}], "max_tokens": 8, "temperature": 0},
            timeout=20,
        )
    except requests.RequestException as error:
        raise ValueError(f"LLM API request failed: {error}") from error
    if not response.ok:
        raise ValueError(f"LLM API failed ({response.status_code}): {response.text[:300]}")
    return {"ok": "true", "model": model}


def save_llm_settings(api_key: str, api_base: str, model: str) -> dict[str, object]:
    api_key = api_key.strip()
    api_base = api_base.strip()
    model = model.strip()
    if api_base and not api_base.startswith(("https://", "http://")):
        raise ValueError("LLM API Base must start with http:// or https://")
    if not model:
        raise ValueError("LLM model is required")

    existing_lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    retained = [
        line for line in existing_lines
        if not (line.strip() and not line.lstrip().startswith("#") and line.split("=", 1)[0].strip() in _MANAGED_KEYS)
    ]
    values = _file_values()
    resolved_key = (
        api_key
        or values.get("BOSSSPIDER_LLM_API_KEY", "")
        or values.get("DEEPSEEK_API_KEY", "")
        or values.get("OPENAI_API_KEY", "")
    )
    if not resolved_key:
        raise ValueError("LLM API key is required")
    next_lines = retained + [
        "",
        "# BossFlow system LLM settings",
        f"BOSSSPIDER_LLM_API_KEY={resolved_key}",
        f"BOSSSPIDER_LLM_API_BASE={api_base or 'https://api.deepseek.com/v1'}",
        f"BOSSSPIDER_LLM_MODEL={model}",
    ]
    ENV_PATH.write_text("\n".join(next_lines).rstrip() + "\n", encoding="utf-8")
    return llm_settings_status()
