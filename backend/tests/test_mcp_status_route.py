import unittest

from fastapi.testclient import TestClient

import backend.app as app_module


class McpStatusRouteTest(unittest.TestCase):
    def test_reports_server_capabilities(self):
        response = TestClient(app_module.app).get("/api/mcp/status")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "BossFlow MCP Server")
        self.assertEqual(payload["endpoint"], "/mcp/")
        self.assertEqual(payload["toolCount"], 27)
        self.assertEqual(payload["resourceCount"], 9)
        self.assertIn(payload["status"], {"running", "disabled"})


if __name__ == "__main__":
    unittest.main()
