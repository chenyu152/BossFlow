from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets
import threading
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException


CONFIRMATION_TTL_SECONDS = 10 * 60


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _fingerprint(action: str, target: str, payload: Any) -> str:
    encoded = json.dumps(
        {"action": action, "target": target, "payload": payload},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class ConfirmationTicket:
    ticket_id: str
    fingerprint: str
    expires_at: dt.datetime


class AgentConfirmationService:
    """Issue short-lived, one-use tickets bound to an exact MCP mutation."""

    def __init__(self, ttl_seconds: int = CONFIRMATION_TTL_SECONDS):
        self.ttl_seconds = max(30, int(ttl_seconds))
        self._tickets: dict[str, ConfirmationTicket] = {}
        self._lock = threading.RLock()

    def issue(self, action: str, target: str, payload: Any) -> dict[str, Any]:
        now = _now()
        expires_at = now + dt.timedelta(seconds=self.ttl_seconds)
        ticket_id = secrets.token_urlsafe(24)
        ticket = ConfirmationTicket(ticket_id, _fingerprint(action, target, payload), expires_at)
        with self._lock:
            self._prune(now)
            self._tickets[ticket_id] = ticket
        return {
            "confirmationId": ticket_id,
            "expiresAt": expires_at.isoformat(timespec="seconds"),
            "expiresInSeconds": self.ttl_seconds,
        }

    def consume(self, confirmation_id: str, action: str, target: str, payload: Any) -> None:
        ticket_id = str(confirmation_id or "").strip()
        if not ticket_id:
            raise HTTPException(status_code=428, detail="A confirmationId from the preview is required")
        now = _now()
        with self._lock:
            self._prune(now)
            ticket = self._tickets.pop(ticket_id, None)
        if not ticket:
            raise HTTPException(status_code=410, detail="Confirmation expired, was already used, or is unknown; request a new preview")
        if not secrets.compare_digest(ticket.fingerprint, _fingerprint(action, target, payload)):
            raise HTTPException(status_code=409, detail="Confirmation does not match the requested action or parameters")

    def _prune(self, now: dt.datetime) -> None:
        expired = [ticket_id for ticket_id, ticket in self._tickets.items() if ticket.expires_at <= now]
        for ticket_id in expired:
            self._tickets.pop(ticket_id, None)
