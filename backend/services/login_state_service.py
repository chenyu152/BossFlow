from __future__ import annotations

import datetime as dt
import json
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Any

from backend.services.project_service import paths_for_project, resolve_project


LOGIN_STATE_FILE = ".bossflow-login-state.json"
AUTH_COOKIE_NAMES = {"zp_at", "wt2", "wbg"}
REFRESH_RECOMMENDED_DAYS = 3
CHROMIUM_EPOCH = dt.datetime(1601, 1, 1, tzinfo=dt.timezone.utc)


def _now() -> dt.datetime:
    return dt.datetime.now().astimezone()


def _chrome_time(value: int | float | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        return (CHROMIUM_EPOCH + dt.timedelta(microseconds=int(value))).astimezone()
    except (OverflowError, TypeError, ValueError):
        return None


def _cookie_database(profile_path: Path) -> Path | None:
    candidates = [profile_path / "Default" / "Network" / "Cookies", profile_path / "Default" / "Cookies"]
    return next((path for path in candidates if path.exists() and path.stat().st_size > 0), None)


def _read_cookie_metadata(cookie_path: Path) -> list[dict[str, Any]]:
    temp_file = tempfile.NamedTemporaryFile(prefix="bossflow-cookie-status-", suffix=".sqlite", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()
    try:
        shutil.copy2(cookie_path, temp_path)
        connection = sqlite3.connect(str(temp_path), timeout=2)
        try:
            rows = connection.execute(
                "SELECT name, expires_utc, last_access_utc FROM cookies WHERE host_key LIKE '%zhipin.com'"
            ).fetchall()
        finally:
            connection.close()
        return [
            {"name": str(name or ""), "expiresAt": _chrome_time(expires), "lastAccessAt": _chrome_time(last_access)}
            for name, expires, last_access in rows
        ]
    except (OSError, sqlite3.Error):
        return []
    finally:
        temp_path.unlink(missing_ok=True)


def _marker(project_dir: Path) -> dict[str, Any]:
    path = project_dir / LOGIN_STATE_FILE
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def record_login_verified(project: str) -> dict[str, Any]:
    project_dir = resolve_project(project)
    timestamp = _now().isoformat(timespec="seconds")
    path = project_dir / LOGIN_STATE_FILE
    path.write_text(json.dumps({"verifiedAt": timestamp}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return login_state(project)


def login_state(project: str) -> dict[str, Any]:
    project_dir = resolve_project(project)
    profile_path = Path(paths_for_project(project_dir)["profilePath"])
    cookie_path = _cookie_database(profile_path)
    marker = _marker(project_dir)
    rows = _read_cookie_metadata(cookie_path) if cookie_path else []
    auth_rows = [row for row in rows if row["name"] in AUTH_COOKIE_NAMES]
    now = _now()
    valid_auth_rows = [row for row in auth_rows if row["expiresAt"] is None or row["expiresAt"] > now]
    last_accesses = [row["lastAccessAt"] for row in auth_rows if row["lastAccessAt"]]
    cookie_last_access = max(last_accesses) if last_accesses else None
    verified_at = None
    if marker.get("verifiedAt"):
        try:
            verified_at = dt.datetime.fromisoformat(str(marker["verifiedAt"])).astimezone()
        except ValueError:
            verified_at = None
    last_saved_at = verified_at or cookie_last_access
    days_since = int((now - last_saved_at).total_seconds() // 86400) if last_saved_at else None
    expiries = [row["expiresAt"] for row in valid_auth_rows if row["expiresAt"]]
    earliest_expiry = min(expiries) if expiries else None
    # Chrome may keep the latest Cookie rows in its WAL while a crawler/login
    # window is open. In that short window the copied SQLite database can look
    # empty or stale even though BossFlow has just verified the authenticated
    # session in the live browser. Trust that explicit verification marker for
    # the same refresh window, but still require a persisted Cookie database.
    recently_verified = bool(
        verified_at
        and cookie_path
        and days_since is not None
        and days_since < REFRESH_RECOMMENDED_DAYS
    )
    can_schedule = bool(valid_auth_rows) or recently_verified

    if recently_verified and not valid_auth_rows:
        status = "available"
        message = "The live BOSS session was recently verified; Cookie metadata may still be flushing."
    elif not cookie_path or not rows:
        status = "missing"
        message = "No saved BOSS login cookies were found for this job target."
    elif not auth_rows:
        status = "missing"
        message = "The browser profile exists but no BOSS authentication cookies were found."
    elif not valid_auth_rows:
        status = "expired"
        message = "The saved BOSS authentication cookies have expired."
    elif days_since is not None and days_since >= REFRESH_RECOMMENDED_DAYS:
        status = "refresh_recommended"
        message = "The saved login is at least three days old; refresh it before relying on unattended collection."
    else:
        status = "available"
        message = "Saved BOSS authentication cookies are available."

    return {
        "project": project,
        "status": status,
        "canSchedule": can_schedule,
        "hasCookieDatabase": bool(cookie_path),
        "authCookieCount": len(auth_rows),
        "verifiedByLiveSession": recently_verified,
        "lastSavedAt": last_saved_at.isoformat(timespec="seconds") if last_saved_at else "",
        "daysSinceSaved": days_since,
        "earliestClientExpiryAt": earliest_expiry.isoformat(timespec="seconds") if earliest_expiry else "",
        "refreshRecommendedAfterDays": REFRESH_RECOMMENDED_DAYS,
        "message": message,
        "validityNote": "Cookie expiry is controlled by BOSS and the server may invalidate a session before the browser expiry time.",
    }


def require_saved_login(project: str) -> dict[str, Any]:
    state = login_state(project)
    if not state["canSchedule"]:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409,
            detail=f"{project}: no usable BOSS login Cookie. Open System Settings, choose Login / Save Cookie, then retry.",
        )
    return state
