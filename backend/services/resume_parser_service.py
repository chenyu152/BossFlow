"""PDF resume parsing service.

Runs the full pipeline (PDF → images → OCR → LLM → cv.md) in a
background daemon thread so the HTTP request can return immediately.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

#: Module-level state for tracking parse progress (single-user local app).
_parse_state: dict[str, Any] = {
    "status": "idle",  # "idle" | "processing" | "done" | "failed"
    "result": "",
    "error": "",
    "started_at": None,
    "finished_at": None,
}


def get_parse_status() -> dict[str, Any]:
    """Return a shallow copy of the current parse state."""
    return dict(_parse_state)


def start_parse(pdf_path: str, output_dir: str) -> None:
    """Start PDF resume parsing in a background daemon thread."""
    if _parse_state["status"] == "processing":
        return

    _parse_state["status"] = "processing"
    _parse_state["result"] = ""
    _parse_state["error"] = ""
    _parse_state["started_at"] = datetime.now(timezone.utc).isoformat()
    _parse_state["finished_at"] = None

    thread = threading.Thread(
        target=_run_parse,
        args=(pdf_path, output_dir),
        daemon=True,
    )
    thread.start()


def _run_parse(pdf_path: str, output_dir: str) -> None:
    try:
        from backend.services.resume_parser.pipeline import run_pipeline

        cv_content = run_pipeline(
            pdf_path,
            output_dir=output_dir,
            save_images=False,
            save_json=False,
        )

        _parse_state["status"] = "done"
        _parse_state["result"] = cv_content
        _parse_state["finished_at"] = datetime.now(timezone.utc).isoformat()

    except Exception as exc:
        _parse_state["status"] = "failed"
        _parse_state["error"] = f"{type(exc).__name__}: {exc}"
        _parse_state["finished_at"] = datetime.now(timezone.utc).isoformat()
