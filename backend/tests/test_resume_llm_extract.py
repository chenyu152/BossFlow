import json
import unittest
from unittest.mock import patch

from backend.services.resume_parser import llm_extract


class ResumeLlmExtractTest(unittest.TestCase):
    def test_extract_resume_normalises_common_llm_shape_variations(self):
        payload = {
            "candidate": {
                "name": "张三",
                "phone": None,
                "email": "zhang@example.com",
                "target_cities": "深圳\n上海",
                "target_roles": "嵌入式软件工程师",
                "years_of_experience": "3.5 年",
                "highest_education": None,
            },
            "skills": "沟通\n团队协作",
            "languages": ["C", None, "C++"],
            "work_experience": {
                "company": "示例公司",
                "position": "工程师",
                "duration": None,
                "responsibilities": "开发产品\n维护服务",
                "achievements": None,
            },
            "projects": [{
                "name": "项目 A",
                "role": None,
                "duration": "2024",
                "description": None,
                "highlights": "提升稳定性",
            }],
            "education": {
                "school": "示例大学",
                "degree": "本科",
                "major": "计算机科学",
                "duration": None,
            },
        }

        with patch.object(llm_extract, "_call_llm", return_value=json.dumps(payload, ensure_ascii=False)):
            resume = llm_extract.extract_resume("OCR 原文")

        self.assertEqual(resume.raw_text, "OCR 原文")
        self.assertEqual(resume.candidate.target_cities, ["深圳", "上海"])
        self.assertEqual(resume.candidate.target_roles, ["嵌入式软件工程师"])
        self.assertEqual(resume.candidate.years_of_experience, 3.5)
        self.assertEqual(resume.candidate.highest_education, "")
        self.assertEqual(resume.skills, ["沟通", "团队协作"])
        self.assertEqual(resume.languages, ["C", "C++"])
        self.assertEqual(len(resume.work_experience), 1)
        self.assertEqual(resume.work_experience[0].responsibilities, ["开发产品", "维护服务"])
        self.assertEqual(resume.work_experience[0].achievements, [])
        self.assertEqual(resume.projects[0].highlights, ["提升稳定性"])
        self.assertEqual(resume.education[0].duration, "")

    def test_extract_resume_rejects_invalid_json_with_actionable_message(self):
        with patch.object(llm_extract, "_call_llm", return_value="not-json"):
            with self.assertRaisesRegex(llm_extract.ResumeExtractionError, "未返回可解析的 JSON"):
                llm_extract.extract_resume("OCR 原文")

    def test_extract_resume_rejects_irrecoverable_nested_records_with_field_name(self):
        payload = {
            "candidate": {"name": "张三"},
            "work_experience": ["不是对象"],
        }

        with patch.object(llm_extract, "_call_llm", return_value=json.dumps(payload, ensure_ascii=False)):
            with self.assertRaisesRegex(llm_extract.ResumeExtractionError, "work_experience 包含非对象条目"):
                llm_extract.extract_resume("OCR 原文")


if __name__ == "__main__":
    unittest.main()
