import os
import sys
from pathlib import Path

# RESOURCE_DIR contains the immutable files shipped with the application.  In
# development it is the repository root; the Electron launcher points it at
# the PyInstaller ``_internal`` directory in a packaged build.
RESOURCE_DIR = Path(os.environ.get("BOSSFLOW_RESOURCE_DIR", Path(__file__).resolve().parents[2])).resolve()

# BASE_DIR is deliberately writable.  Desktop builds receive a per-user
# directory from Electron, while the source-tree layout remains unchanged for
# the normal Vite + Uvicorn development workflow.
BASE_DIR = Path(os.environ.get("BOSSFLOW_HOME", RESOURCE_DIR)).resolve()
PROJECTS_DIR = BASE_DIR / "projects"

if str(RESOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(RESOURCE_DIR))
