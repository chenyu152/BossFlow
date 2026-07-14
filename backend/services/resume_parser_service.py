"""PDF resume parsing service using ppocrdemo pipeline.

This service bridges the ppocrdemo OCR pipeline into BossFlow.  It
tries to import the pipeline modules directly first; if PaddleOCR is
not available in the current Python environment it falls back to
running the pipeline as a subprocess inside the ``ppocrv6`` conda env.
"""

from __future__ import annotations

import os
import subprocess
import sys
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

#: Path to the ppocrdemo directory (sibling of BossFlow).
_PPOCRDEMO_DIR = Path(__file__).resolve().parents[3] / "ppocrdemo"
if str(_PPOCRDEMO_DIR) not in sys.path:
    sys.path.insert(0, str(_PPOCRDEMO_DIR))

#: Absolute path to pipeline.py inside ppocrdemo.
_PIPELINE_SCRIPT = _PPOCRDEMO_DIR / "pipeline.py"


def get_parse_status() -> dict[str, Any]:
    """Return a shallow copy of the current parse state."""
    return dict(_parse_state)


def start_parse(pdf_path: str, output_dir: str) -> None:
    """Start PDF resume parsing in a background daemon thread.

    Args:
        pdf_path: Absolute path to the uploaded PDF file.
        output_dir: Directory where images / OCR / cv.md will be written.
    """
    if _parse_state["status"] == "processing":
        return  # already running — caller should poll status

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
    """Execute the full parse pipeline (PDF → images → OCR → LLM → cv.md).

    Tries direct Python import first; falls back to ``conda run`` if
    PaddleOCR is not installed in the current environment.
    """
    try:
        try:
            _run_parse_direct(pdf_path, output_dir)
        except ImportError:
            _run_parse_subprocess(pdf_path, output_dir)
    except Exception as exc:
        _parse_state["status"] = "failed"
        _parse_state["error"] = f"{type(exc).__name__}: {exc}"
        _parse_state["finished_at"] = datetime.now(timezone.utc).isoformat()


# ── direct import path ──────────────────────────────────────────────

def _run_parse_direct(pdf_path: str, output_dir: str) -> None:
    # Lazy import — PaddleOCR is imported at module level inside pipeline.py.
    from pipeline import run_pipeline  # type: ignore[import-not-found]

    cv_content = run_pipeline(
        pdf_path,
        output_dir=output_dir,
        save_images=False,
        save_json=False,
    )

    _parse_state["status"] = "done"
    _parse_state["result"] = cv_content
    _parse_state["finished_at"] = datetime.now(timezone.utc).isoformat()


# ── subprocess fallback ─────────────────────────────────────────────

def _find_conda_python() -> str | None:
    """Locate the Python interpreter for the ``ppocrv6`` conda environment."""
    # Common conda root locations on macOS.
    conda_roots = [
        Path.home() / "miniconda3",
        Path.home() / "anaconda3",
        Path("/opt/homebrew/Caskroom/miniconda/base"),
        Path("/usr/local/Caskroom/miniconda/base"),
        Path("/opt/anaconda3"),
    ]
    for root in conda_roots:
        candidate = root / "envs" / "ppocrv6" / "bin" / "python"
        if candidate.is_file():
            return str(candidate)
    return None


def _run_parse_subprocess(pdf_path: str, output_dir: str) -> None:
    try:
        # Prefer a direct Python path (avoids shell init overhead).
        python_exe = _find_conda_python()

        if python_exe:
            cmd = [python_exe, str(_PIPELINE_SCRIPT), pdf_path,
                   "-o", output_dir, "--no-images", "--no-json"]
        else:
            # Last resort: use ``conda run``.  Requires conda on PATH.
            cmd = ["conda", "run", "--no-capture-output", "-n", "ppocrv6",
                   "python", str(_PIPELINE_SCRIPT), pdf_path,
                   "-o", output_dir, "--no-images", "--no-json"]

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )

        if proc.returncode != 0:
            raise RuntimeError(
                f"Pipeline exited with code {proc.returncode}.\n"
                f"STDERR: {proc.stderr[-1000:]}\n"
                f"STDOUT: {proc.stdout[-1000:]}"
            )

        # The pipeline writes cv.md to <output_dir>/<pdf_stem>_cv.md.
        pdf_name = Path(pdf_path).stem
        cv_path = Path(output_dir) / f"{pdf_name}_cv.md"

        if not cv_path.exists():
            raise RuntimeError(f"cv.md not found at {cv_path}")

        cv_content = cv_path.read_text(encoding="utf-8")

        _parse_state["status"] = "done"
        _parse_state["result"] = cv_content
        _parse_state["finished_at"] = datetime.now(timezone.utc).isoformat()

    except Exception as exc:
        _parse_state["status"] = "failed"
        _parse_state["error"] = str(exc)
        _parse_state["finished_at"] = datetime.now(timezone.utc).isoformat()
