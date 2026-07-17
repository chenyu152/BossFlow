import unittest

from fastapi import HTTPException

from backend.services.agent_confirmation_service import AgentConfirmationService


class AgentConfirmationServiceTest(unittest.TestCase):
    def test_ticket_is_parameter_bound_and_one_use(self):
        service = AgentConfirmationService(ttl_seconds=60)
        ticket = service.issue("write", "target", {"value": 1})
        with self.assertRaises(HTTPException) as mismatch:
            service.consume(ticket["confirmationId"], "write", "target", {"value": 2})
        self.assertEqual(mismatch.exception.status_code, 409)

        ticket = service.issue("write", "target", {"value": 1})
        service.consume(ticket["confirmationId"], "write", "target", {"value": 1})
        with self.assertRaises(HTTPException) as reused:
            service.consume(ticket["confirmationId"], "write", "target", {"value": 1})
        self.assertEqual(reused.exception.status_code, 410)


if __name__ == "__main__":
    unittest.main()
