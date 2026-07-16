import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.mcp_stdio_bridge import _connection


class McpStdioBridgeTest(unittest.TestCase):
    def test_reads_runtime_connection_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "agent-runtime.json"
            path.write_text(
                json.dumps({"url": "http://127.0.0.1:8765/mcp/", "token": "secret-token"}),
                encoding="utf-8",
            )
            with patch.dict(
                os.environ,
                {"BOSSFLOW_AGENT_CONNECTION_FILE": str(path)},
                clear=True,
            ):
                self.assertEqual(_connection(), ("http://127.0.0.1:8765/mcp/", "secret-token"))

    def test_explicit_environment_overrides_connection_file(self):
        with patch.dict(
            os.environ,
            {"BOSSFLOW_MCP_URL": "http://127.0.0.1:8000/mcp/", "BOSSFLOW_AGENT_TOKEN": "direct"},
            clear=True,
        ):
            self.assertEqual(_connection(), ("http://127.0.0.1:8000/mcp/", "direct"))


if __name__ == "__main__":
    unittest.main()
