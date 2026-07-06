import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
PROJECTS_DIR = BASE_DIR / "projects"

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
