from __future__ import annotations

import hmac
import json
from urllib.parse import urlparse

from starlette.types import ASGIApp, Message, Receive, Scope, Send


def _header(scope: Scope, name: str) -> str:
    expected = name.lower().encode("ascii")
    for key, value in scope.get("headers", []):
        if key.lower() == expected:
            return value.decode("latin-1")
    return ""


async def _json_response(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}, ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class DesktopRuntimeTokenMiddleware:
    """Protect packaged REST writes without buffering streaming responses."""

    def __init__(self, app: ASGIApp, token: str = "") -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and self.token
            and str(scope.get("path", "")).startswith("/api/")
            and str(scope.get("method", "")).upper() in {"POST", "PUT", "PATCH", "DELETE"}
            and not hmac.compare_digest(_header(scope, "X-BossFlow-Token"), self.token)
        ):
            await _json_response(send, 403, "Invalid desktop runtime token")
            return
        await self.app(scope, receive, send)


class McpSecurityMiddleware:
    """Require a local bearer token and reject browser-origin confusion."""

    def __init__(self, app: ASGIApp, token: str = "") -> None:
        self.app = app
        self.token = token

    @staticmethod
    def _origin_is_local(origin: str) -> bool:
        if not origin or origin == "null":
            return True
        parsed = urlparse(origin)
        return parsed.scheme in {"http", "https"} and parsed.hostname in {"127.0.0.1", "localhost", "::1"}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if not self.token:
            await _json_response(send, 503, "BossFlow Agent access is not configured")
            return
        if not self._origin_is_local(_header(scope, "Origin")):
            await _json_response(send, 403, "MCP requests must originate from a local client")
            return
        authorization = _header(scope, "Authorization")
        bearer = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        supplied = bearer or _header(scope, "X-BossFlow-Agent-Token")
        if not supplied or not hmac.compare_digest(supplied, self.token):
            await _json_response(send, 401, "Invalid BossFlow Agent token")
            return
        await self.app(scope, receive, send)
