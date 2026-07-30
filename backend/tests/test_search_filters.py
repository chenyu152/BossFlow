import unittest
from urllib.parse import parse_qs, urlparse

from backend.schemas.search_filters import JobSearchFilters, normalize_search_filters
from crawler.boss import build_search_url


class SearchFiltersTest(unittest.TestCase):
    def test_build_search_url_applies_supported_filters(self):
        url = build_search_url(
            "Agent 开发",
            "101280600",
            salary_code="403",
            search_filters={
                "position": "100101",
                "jobType": "1901",
                "salary": "405",
                "experience": "104",
                "degree": "203",
                "industry": "100020",
                "scale": "304",
                "stage": "807",
                "unexpected": "ignored",
            },
        )
        query = parse_qs(urlparse(url).query)
        self.assertEqual(query["query"], ["Agent 开发"])
        self.assertEqual(query["city"], ["101280600"])
        self.assertEqual(query["salary"], ["405"])
        self.assertEqual(query["position"], ["100101"])
        self.assertEqual(query["jobType"], ["1901"])
        self.assertEqual(query["experience"], ["104"])
        self.assertEqual(query["degree"], ["203"])
        self.assertEqual(query["industry"], ["100020"])
        self.assertEqual(query["scale"], ["304"])
        self.assertEqual(query["stage"], ["807"])
        self.assertNotIn("unexpected", query)

    def test_normalization_keeps_only_supported_numeric_codes(self):
        normalized = normalize_search_filters({
            "position": " 100101 ",
            "experience": 104,
            "salary": "0",
            "unexpected": "999",
        })
        self.assertEqual(normalized["position"], "100101")
        self.assertEqual(normalized["experience"], "104")
        self.assertEqual(normalized["salary"], "")
        self.assertNotIn("unexpected", normalized)

    def test_schema_rejects_non_numeric_filter_code(self):
        with self.assertRaisesRegex(ValueError, "digits only"):
            JobSearchFilters(position="backend")


if __name__ == "__main__":
    unittest.main()
