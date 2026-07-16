"""PyInstaller entry point for the BossFlow desktop sidecar.

The normal developer workflow continues to use ``uvicorn backend.app:app``.
Electron starts this module only in packaged builds and supplies all runtime
paths through environment variables.
"""

from __future__ import annotations

import os
import sys


def _configure_standard_streams() -> None:
    """Use UTF-8 for Electron's sidecar pipes on Windows."""
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def _port() -> int:
    value = os.environ.get("BOSSFLOW_PORT", "")
    try:
        port = int(value)
    except ValueError as error:
        raise RuntimeError("BOSSFLOW_PORT must be a valid TCP port") from error
    if not 1 <= port <= 65535:
        raise RuntimeError("BOSSFLOW_PORT must be between 1 and 65535")
    return port


def main() -> None:
    _configure_standard_streams()
    if "--mcp-stdio-bridge" in sys.argv:
        from backend.mcp_stdio_bridge import main as bridge_main

        bridge_main()
        return
    if not os.environ.get("BOSSFLOW_HOME"):
        raise RuntimeError("BOSSFLOW_HOME is required for the desktop sidecar")
    os.environ.setdefault("BOSSFLOW_DESKTOP", "1")

    import uvicorn
    # Import the application directly instead of handing Uvicorn an import
    # string.  PyInstaller can then discover the full ``backend`` package.
    from backend.app import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=_port(),
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"BossFlow desktop sidecar failed to start: {error}", file=sys.stderr)
        raise
