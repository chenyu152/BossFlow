import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.mcp_security import McpSecurityMiddleware


def secured_client(token="secret"):
    inner = FastAPI()

    @inner.post("/")
    def ok():
        return {"ok": True}

    return TestClient(McpSecurityMiddleware(inner, token=token))


class McpSecurityTest(unittest.TestCase):
    def test_rejects_unconfigured_access(self):
        response = secured_client(token="").post("/")
        self.assertEqual(response.status_code, 503)

    def test_rejects_missing_token(self):
        response = secured_client().post("/")
        self.assertEqual(response.status_code, 401)

    def test_rejects_nonlocal_browser_origin(self):
        response = secured_client().post(
            "/",
            headers={"Authorization": "Bearer secret", "Origin": "https://evil.example"},
        )
        self.assertEqual(response.status_code, 403)

    def test_accepts_local_bearer_client(self):
        response = secured_client().post(
            "/",
            headers={"Authorization": "Bearer secret", "Origin": "http://127.0.0.1:5173"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})


if __name__ == "__main__":
    unittest.main()
