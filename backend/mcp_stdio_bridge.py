from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx
from mcp import ClientSession, types
from mcp.client.streamable_http import streamable_http_client
from mcp.server import NotificationOptions, Server
from mcp.server.lowlevel.helper_types import ReadResourceContents
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server


def _connection() -> tuple[str, str]:
    url = os.environ.get("BOSSFLOW_MCP_URL", "").strip()
    token = os.environ.get("BOSSFLOW_AGENT_TOKEN", "").strip()
    connection_file = os.environ.get("BOSSFLOW_AGENT_CONNECTION_FILE", "").strip()
    if connection_file:
        try:
            payload = json.loads(Path(connection_file).expanduser().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Cannot read BossFlow Agent connection file: {error}") from error
        url = url or str(payload.get("url") or "").strip()
        token = token or str(payload.get("token") or "").strip()
    if not url:
        raise RuntimeError("Set BOSSFLOW_MCP_URL or BOSSFLOW_AGENT_CONNECTION_FILE")
    if not token:
        raise RuntimeError("Set BOSSFLOW_AGENT_TOKEN or use a connection file containing the token")
    return url, token


def _create_proxy(upstream: ClientSession) -> Server:
    proxy = Server("BossFlow stdio bridge")

    @proxy.list_tools()
    async def list_tools() -> list[types.Tool]:
        return (await upstream.list_tools()).tools

    @proxy.call_tool(validate_input=True)
    async def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        return await upstream.call_tool(name, arguments)

    @proxy.list_resources()
    async def list_resources() -> list[types.Resource]:
        return (await upstream.list_resources()).resources

    @proxy.list_resource_templates()
    async def list_resource_templates() -> list[types.ResourceTemplate]:
        return (await upstream.list_resource_templates()).resourceTemplates

    @proxy.read_resource()
    async def read_resource(uri: Any) -> list[ReadResourceContents]:
        result = await upstream.read_resource(uri)
        contents: list[ReadResourceContents] = []
        for item in result.contents:
            if isinstance(item, types.TextResourceContents):
                contents.append(ReadResourceContents(item.text, item.mimeType, item.meta))
            elif isinstance(item, types.BlobResourceContents):
                contents.append(ReadResourceContents(base64.b64decode(item.blob), item.mimeType, item.meta))
        return contents

    return proxy


async def run_bridge() -> None:
    url, token = _connection()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=60) as http_client:
        async with streamable_http_client(url, http_client=http_client) as (upstream_read, upstream_write, _):
            async with ClientSession(upstream_read, upstream_write) as upstream:
                initialized = await upstream.initialize()
                proxy = _create_proxy(upstream)
                capabilities = proxy.get_capabilities(
                    NotificationOptions(resources_changed=False, tools_changed=False),
                    experimental_capabilities={},
                )
                async with stdio_server() as (read_stream, write_stream):
                    await proxy.run(
                        read_stream,
                        write_stream,
                        InitializationOptions(
                            server_name="BossFlow",
                            server_version=initialized.serverInfo.version,
                            capabilities=capabilities,
                            instructions=(
                                "Thin stdio bridge to the running BossFlow desktop MCP server. "
                                "BossFlow remains the only owner of state and task execution."
                            ),
                        ),
                    )


def main() -> None:
    try:
        asyncio.run(run_bridge())
    except Exception as error:
        print(f"BossFlow MCP stdio bridge failed: {error}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
