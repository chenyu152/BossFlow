"""Per-project job-search workspace paths and legacy-data migration.

Projects are independent job-search directions.  The crawler configuration and
job database have always lived below ``projects/<name>``; this module extends
that boundary to the candidate materials as well.
"""

from __future__ import annotations

import json
import shutil
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Iterator, Optional

from fastapi import HTTPException

from backend.services.project_service import default_project_name, resolve_project
from backend.storage.paths import BASE_DIR


WORKSPACE_DIR_NAME = "workspace"
MIGRATION_MARKER = ".workspace-migration-v1.json"
_workspace_root: ContextVar[Optional[Path]] = ContextVar("workspace_root", default=None)


class WorkspacePath:
    """A Path-like value resolved against the request's selected project.

    Keeping it path-like lets existing services retain their file handling while
    preventing process-global path state from leaking between API requests.
    """

    def __init__(self, relative_path: str):
        self.relative_path = Path(relative_path)

    def path(self) -> Path:
        root = _workspace_root.get()
        return (root / self.relative_path) if root else (BASE_DIR / self.relative_path)

    def __fspath__(self) -> str:
        return str(self.path())

    def __str__(self) -> str:
        return str(self.path())

    def __repr__(self) -> str:
        return f"WorkspacePath({self.relative_path!s})"

    def __truediv__(self, other: object) -> Path:
        return self.path() / other  # type: ignore[arg-type]

    def __getattr__(self, name: str):
        return getattr(self.path(), name)


def workspace_path(relative_path: str) -> WorkspacePath:
    return WorkspacePath(relative_path)


def project_from_source_key(source_key: str) -> str:
    project, separator, _ = str(source_key or "").partition(":")
    if not separator or not project:
        raise HTTPException(status_code=400, detail="Invalid pipeline source key")
    resolve_project(project)
    return project


def _replace_legacy_paths(workspace_root: Path) -> None:
    replacements: dict[str, str] = {}
    for relative_path in ("data", "reports", "output"):
        old_path = BASE_DIR / relative_path
        new_path = workspace_root / relative_path
        for old_value in {str(old_path), old_path.as_posix(), str(old_path).replace("/", "\\\\")}:
            replacements[old_value] = str(new_path)
            replacements[old_value.replace("\\", "\\\\")] = str(new_path).replace("\\", "\\\\")
    for path in workspace_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".md", ".json"}:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        rewritten = content
        for old, new in replacements.items():
            rewritten = rewritten.replace(old, new)
        if rewritten != content:
            path.write_text(rewritten, encoding="utf-8")


def _migrate_legacy_workspace(project_dir: Path, workspace_root: Path) -> None:
    """Seed the historical global workspace into the default project once.

    The original files are intentionally retained as a read-only fallback and
    recovery copy.  New requests never read them after a project workspace has
    been selected.
    """
    marker = workspace_root / MIGRATION_MARKER
    if marker.exists() or project_dir.name != default_project_name():
        return

    legacy_entries = ("cv.md", "profile.yml", "data", "reports", "output")
    copied: list[str] = []
    for entry in legacy_entries:
        source = BASE_DIR / entry
        target = workspace_root / entry
        if not source.exists() or target.exists():
            continue
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        copied.append(entry)

    _replace_legacy_paths(workspace_root)
    marker.write_text(
        json.dumps(
            {
                "version": 3,
                "source": str(BASE_DIR),
                "copied": copied,
                "note": "Legacy files were copied and intentionally retained for recovery.",
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )


def ensure_project_workspace(project: str | None) -> Path:
    project_dir = resolve_project(project)
    workspace_root = project_dir / WORKSPACE_DIR_NAME
    workspace_root.mkdir(parents=True, exist_ok=True)
    _migrate_legacy_workspace(project_dir, workspace_root)
    marker = workspace_root / MIGRATION_MARKER
    if marker.exists():
        try:
            version = int(json.loads(marker.read_text(encoding="utf-8")).get("version") or 1)
        except (OSError, ValueError, json.JSONDecodeError):
            version = 1
        if version < 3:
            _replace_legacy_paths(workspace_root)
            marker.write_text(
                json.dumps({"version": 3, "source": str(BASE_DIR), "note": "Legacy files retained for recovery."}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    for relative_dir in ("data", "reports/jobs", "output/resumes", "output/interview-prep"):
        (workspace_root / relative_dir).mkdir(parents=True, exist_ok=True)
    return workspace_root


@contextmanager
def project_workspace(project: str | None) -> Iterator[Path]:
    workspace_root = ensure_project_workspace(project)
    token = _workspace_root.set(workspace_root)
    try:
        yield workspace_root
    finally:
        _workspace_root.reset(token)
