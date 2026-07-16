from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from backend.storage.file_lock import exclusive_file_lock
from backend.storage.paths import BASE_DIR


AUDIT_LOG_PATH = BASE_DIR / "logs" / "agent-audit.log"
AUDIT_LOCK_PATH = BASE_DIR / "logs" / ".agent-audit.lock"


def record_agent_action(
    tool: str,
    status: str,
    *,
    target: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    """Append a secret-free JSON audit event for an MCP write operation."""
    event = {
        "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
        "tool": tool,
        "status": status,
        "target": target,
        "details": details or {},
    }
    AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with exclusive_file_lock(AUDIT_LOCK_PATH):
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
