import datetime as dt
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.services import login_state_service


def chromium_time(value: dt.datetime) -> int:
    epoch = dt.datetime(1601, 1, 1, tzinfo=dt.timezone.utc)
    return int((value.astimezone(dt.timezone.utc) - epoch).total_seconds() * 1_000_000)


class LoginStateServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name) / "agent"
        self.profile = self.project / ".chrome_profile"
        self.project.mkdir(parents=True)
        self.addCleanup(self.temp.cleanup)

    def state(self):
        with (
            patch.object(login_state_service, "resolve_project", return_value=self.project),
            patch.object(login_state_service, "paths_for_project", return_value={"profilePath": str(self.profile)}),
        ):
            return login_state_service.login_state("agent")

    def test_missing_profile_blocks_scheduling(self):
        state = self.state()
        self.assertEqual(state["status"], "missing")
        self.assertFalse(state["canSchedule"])

    def test_reads_auth_cookie_freshness_without_reading_cookie_value(self):
        cookie_path = self.profile / "Default" / "Network" / "Cookies"
        cookie_path.parent.mkdir(parents=True)
        connection = sqlite3.connect(cookie_path)
        connection.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, expires_utc INTEGER, last_access_utc INTEGER)")
        now = dt.datetime.now().astimezone()
        connection.execute(
            "INSERT INTO cookies VALUES (?, ?, ?, ?)",
            (".zhipin.com", "zp_at", chromium_time(now + dt.timedelta(days=2)), chromium_time(now - dt.timedelta(days=1))),
        )
        connection.commit()
        connection.close()

        state = self.state()
        self.assertEqual(state["status"], "available")
        self.assertTrue(state["canSchedule"])
        self.assertEqual(state["authCookieCount"], 1)
        self.assertNotIn("cookieValue", state)


if __name__ == "__main__":
    unittest.main()
