import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.services import evidence_service


class EvidenceServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        data_dir = Path(self.temp_dir.name)
        self.paths_patch = patch.multiple(
            evidence_service,
            DATA_DIR=data_dir,
            EVIDENCE_STORE_PATH=data_dir / "evidence-store.json",
            EVIDENCE_LOCK_PATH=data_dir / ".evidence-store.lock",
        )
        self.paths_patch.start()

    def tearDown(self):
        self.paths_patch.stop()
        self.temp_dir.cleanup()

    def test_creates_versioned_empty_store(self):
        overview = evidence_service.read_evidence_overview()

        self.assertEqual(overview["schemaVersion"], 7)
        self.assertEqual(overview["counts"]["requirements"], 0)
        self.assertTrue(Path(overview["path"]).exists())

    def test_resume_capability_import_creates_standalone_confirmed_capabilities(self):
        content = """# 个人简历

## 技术栈
- 熟练使用 Python、LangGraph 和 RAG 开发智能体应用
- 熟悉 Linux

## 教育经历
- 本科，计算机科学与技术
"""
        preview = evidence_service.preview_resume_capability_import(content)
        proposals = {item["canonicalKey"]: item for item in preview["proposals"]}

        self.assertIn("python-programming", proposals)
        self.assertIn("langgraph-framework", proposals)
        self.assertIn("rag-systems", proposals)
        self.assertIn("linux-development", proposals)
        self.assertIn("education-background", proposals)
        self.assertTrue(proposals["python-programming"]["selected"])

        result = evidence_service.apply_resume_capability_import(
            content,
            [
                {
                    "proposalId": item["proposalId"],
                    "selected": True,
                    "label": "Python 自动化" if item["canonicalKey"] == "python-programming" else item["label"],
                    "userProficiency": item["userProficiency"],
                }
                for item in preview["proposals"]
            ],
            preview["sourceRevision"],
        )
        capabilities = {
            item["canonicalKey"]: item
            for item in result["overview"]["capabilities"]
        }
        self.assertEqual(capabilities["python-programming"]["status"], "mastered")
        self.assertEqual(capabilities["python-programming"]["jobCount"], 0)
        self.assertEqual(capabilities["python-programming"]["origin"], "resume")
        self.assertEqual(capabilities["python-programming"]["evidenceCount"], 1)
        self.assertEqual(capabilities["python-programming"]["userProficiency"], "proficient")
        self.assertEqual(capabilities["python-programming"]["label"], "Python 自动化")
        self.assertFalse(capabilities["education-background"]["proficiencyApplicable"])
        self.assertEqual(capabilities["education-background"]["userProficiency"], "unspecified")
        self.assertEqual(capabilities["education-background"]["proofStatus"], "resume_recorded")
        self.assertEqual(capabilities["python-programming"]["proofStatus"], "resume_recorded")
        self.assertTrue(all(
            item["status"] == "confirmed"
            for item in result["overview"]["evidenceItems"]
        ))

        repeated = evidence_service.preview_resume_capability_import(content)
        self.assertTrue(all(
            item["action"] == "already_imported"
            for item in repeated["proposals"]
        ))

        changed_resume = evidence_service.preview_resume_capability_import(content + "\n## 其他\n- 可立即到岗\n")
        changed_python = next(
            item for item in changed_resume["proposals"]
            if item["canonicalKey"] == "python-programming"
        )
        self.assertEqual(changed_python["action"], "merge")
        self.assertEqual(changed_python["label"], "Python 自动化")
        self.assertEqual(changed_python["userProficiency"], "proficient")

    def test_resume_import_merges_existing_requirement_capability(self):
        existing = evidence_service.upsert_requirements([{
            "requirementId": "req-python-resume",
            "canonicalKey": "python-programming",
            "label": "掌握 Python",
            "category": "skill",
            "importance": "required",
            "sourceKey": "agent:501",
            "jdQuote": "熟练使用 Python",
            "requiredProficiency": "proficient",
        }])
        capability_id = next(
            item["capabilityId"]
            for item in existing["capabilities"]
            if item["canonicalKey"] == "python-programming"
        )
        evidence_service.classify_capability({
            "capabilityId": capability_id,
            "classification": "done",
            "userProficiency": "working",
        })
        content = "## 技能\n- 熟练使用 Python\n"
        preview = evidence_service.preview_resume_capability_import(content)
        python = next(
            item for item in preview["proposals"]
            if item["canonicalKey"] == "python-programming"
        )
        self.assertEqual(python["action"], "merge")

        result = evidence_service.apply_resume_capability_import(
            content,
            [{"proposalId": python["proposalId"], "selected": True, "userProficiency": "proficient"}],
            preview["sourceRevision"],
        )
        capabilities = [
            item for item in result["overview"]["capabilities"]
            if item["canonicalKey"] == "python-programming"
        ]
        self.assertEqual(len(capabilities), 1)
        self.assertEqual(capabilities[0]["jobCount"], 1)
        self.assertEqual(capabilities[0]["evidenceCount"], 1)
        self.assertEqual(capabilities[0]["origin"], "user")

    def test_resume_preview_includes_work_years_but_excludes_preferences(self):
        content = """# 个人简历

## 个人信息
- 意向城市：深圳
- 期望薪资：30-50K
- 工作经验：三年

## 求职意向
- 希望远程办公

## 技术栈
- 熟练使用 Python
"""
        preview = evidence_service.preview_resume_capability_import(content)
        proposals = {
            item["canonicalKey"]: item
            for item in preview["proposals"]
        }

        self.assertIn("experience-years", proposals)
        self.assertIn("python-programming", proposals)
        self.assertFalse(any(
            item["category"] in {"location", "preference"}
            or any(token in item["label"] for token in ("深圳", "薪资", "远程"))
            for item in preview["proposals"]
        ))

    def test_resume_import_rejects_a_stale_preview_revision(self):
        content = "## 技能\n- Python\n"
        preview = evidence_service.preview_resume_capability_import(content)

        with self.assertRaises(HTTPException) as raised:
            evidence_service.apply_resume_capability_import(
                content + "- Linux\n",
                [{
                    "proposalId": preview["proposals"][0]["proposalId"],
                    "selected": True,
                }],
                preview["sourceRevision"],
            )

        self.assertEqual(raised.exception.status_code, 409)

    def test_classify_standalone_capability(self):
        content = "## Skills\n- Python\n"
        preview = evidence_service.preview_resume_capability_import(content)
        proposal = next(item for item in preview["proposals"] if item["canonicalKey"] == "python-programming")
        imported = evidence_service.apply_resume_capability_import(
            content,
            [{"proposalId": proposal["proposalId"], "selected": True}],
            preview["sourceRevision"],
        )
        capability = next(
            item for item in imported["overview"]["capabilities"]
            if item["canonicalKey"] == "python-programming"
        )
        result = evidence_service.classify_capability({
            "capabilityId": capability["capabilityId"],
            "classification": "adjacent",
            "evidenceIds": [],
            "rationale": "仅有基础使用经验",
            "confidence": 1,
            "userProficiency": "familiar",
        })
        updated = next(
            item for item in result["overview"]["capabilities"]
            if item["capabilityId"] == capability["capabilityId"]
        )
        self.assertEqual(updated["status"], "adjacent")
        self.assertEqual(updated["userProficiency"], "familiar")

        added_evidence = evidence_service.create_evidence_item({
            "title": "Python 项目依据",
            "evidenceType": "project",
            "summary": "独立完成 Python 自动化项目。",
            "userRole": "开发者",
            "actions": ["实现核心流程"],
            "results": ["项目可运行"],
            "sourceRefs": [{"type": "project", "ref": "demo", "quote": "Python"}],
            "tags": ["python"],
            "capabilityIds": [capability["capabilityId"]],
        })
        confirmed = evidence_service.confirm_evidence_item(added_evidence["item"]["evidenceId"])
        with_direct_evidence = next(
            item for item in confirmed["overview"]["capabilities"]
            if item["capabilityId"] == capability["capabilityId"]
        )
        self.assertEqual(with_direct_evidence["evidenceCount"], 2)

    def test_requirement_evidence_coverage_and_task_flow(self):
        overview = evidence_service.upsert_requirements([
            {
                "requirementId": "req-go",
                "canonicalKey": "go-concurrency",
                "label": "Go 并发开发",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:1",
                "jdQuote": "熟悉 Go 并发开发",
                "extractionConfidence": 0.92,
            }
        ])
        self.assertEqual(overview["counts"]["requirements"], 1)

        created = evidence_service.create_evidence_item({
            "title": "并发任务调度项目",
            "evidenceType": "project",
            "summary": "实现过并发任务调度。",
            "userRole": "核心开发",
            "actions": ["设计 worker pool"],
            "results": [],
            "sourceRefs": [{"type": "project", "ref": "demo", "quote": ""}],
            "tags": ["go"],
            "status": "draft",
        })
        evidence_id = created["item"]["evidenceId"]

        classified = evidence_service.classify_coverage({
            "requirementId": "req-go",
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过，等待证据确认。",
            "confidence": 1,
        })
        self.assertEqual(classified["coverage"]["coverageStatus"], "partial")

        confirmed = evidence_service.confirm_evidence_item(evidence_id)
        self.assertEqual(confirmed["item"]["status"], "confirmed")
        self.assertEqual(confirmed["overview"]["coverages"][0]["coverageStatus"], "supported")
        self.assertEqual(confirmed["affectedSourceKeys"], ["agent:1"])

        created_task = evidence_service.create_evidence_task({
            "requirementId": "req-go",
            "taskType": "strengthen",
            "affectedSourceKeys": ["agent:1"],
            "recommendedAction": "补充结果说明",
            "estimatedEffortBand": "under_1_hour",
            "timeBudget": "under_1_hour",
            "userWillingness": "willing",
            "priorityBand": "high",
            "status": "pending",
            "completionEvidenceIds": [],
        })
        task_id = created_task["task"]["taskId"]
        completed = evidence_service.update_evidence_task({
            "taskId": task_id,
            "status": "completed",
            "completionEvidenceIds": [evidence_id],
            "progressPercent": 75,
            "nextStep": "整理项目说明",
            "progressNotes": ["完成并发模型复习"],
        })
        self.assertEqual(completed["task"]["status"], "completed")
        self.assertEqual(completed["task"]["progressPercent"], 100)
        self.assertEqual(completed["task"]["nextStep"], "整理项目说明")
        self.assertEqual(completed["task"]["progressNotes"], ["完成并发模型复习"])
        self.assertEqual(completed["overview"]["counts"]["pendingTasks"], 0)

    def test_capability_profile_groups_aliases_and_excludes_constraints(self):
        evidence_service.upsert_requirements([
            {
                "requirementId": "req-python-a",
                "canonicalKey": "python-proficiency",
                "label": "熟练使用 Python",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:1",
            },
            {
                "requirementId": "req-python-b",
                "canonicalKey": "python-programming",
                "label": "Python 编程",
                "category": "skill",
                "importance": "preferred",
                "sourceKey": "agent:2",
            },
            {
                "requirementId": "req-degree",
                "canonicalKey": "computer-science-degree",
                "label": "计算机相关本科学历",
                "category": "education",
                "importance": "required",
                "sourceKey": "agent:1",
            },
            {
                "requirementId": "req-location",
                "canonicalKey": "location-shenzhen",
                "label": "工作地点深圳",
                "category": "location",
                "importance": "required",
                "sourceKey": "agent:1",
            },
        ])
        evidence_service.classify_coverage({
            "requirementId": "req-python-a",
            "userClassification": "not_done",
            "evidenceIds": [],
            "rationale": "用户确认尚未掌握",
            "confidence": 1,
        })

        overview = evidence_service.read_evidence_overview()
        python = next(item for item in overview["capabilities"] if item["canonicalKey"] == "python-programming")
        degree = next(item for item in overview["capabilities"] if item["canonicalKey"] == "education-background")

        self.assertEqual(python["jobCount"], 2)
        self.assertEqual(python["requiredCount"], 1)
        self.assertEqual(python["preferredCount"], 1)
        self.assertEqual(python["status"], "gap")
        self.assertEqual(degree["actionability"], "basic")
        self.assertEqual(overview["counts"]["basicConditions"], 1)
        self.assertEqual(overview["counts"]["gapCapabilities"], 1)
        self.assertEqual([item["requirementId"] for item in overview["constraints"]], ["req-location"])

    def test_capability_profile_normalizes_agent_aliases_and_year_baselines(self):
        evidence_service.upsert_requirements([
            {
                "requirementId": "req-agent-a",
                "canonicalKey": "agent-dev-experience",
                "label": "Agent 开发经验",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:1",
            },
            {
                "requirementId": "req-agent-b",
                "canonicalKey": "agent-framework",
                "label": "智能体框架开发",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:2",
            },
            {
                "requirementId": "req-years",
                "canonicalKey": "years-experience-3-5",
                "label": "3-5年工作经验",
                "category": "experience",
                "importance": "required",
                "sourceKey": "agent:1",
            },
        ])

        overview = evidence_service.read_evidence_overview()
        agent = next(item for item in overview["capabilities"] if item["canonicalKey"] == "ai-agent-development")
        years = next(item for item in overview["capabilities"] if item["canonicalKey"] == "experience-years")

        self.assertEqual(agent["jobCount"], 2)
        self.assertEqual(agent["requiredCount"], 2)
        self.assertEqual(years["actionability"], "basic")
        self.assertEqual(overview["counts"]["basicConditions"], 1)

    def test_task_creation_is_idempotent_and_replaces_previous_action(self):
        requirement = evidence_service.upsert_requirements([
            {
                "requirementId": "req-action",
                "canonicalKey": "action-choice",
                "label": "行动选择",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:2",
                "jdQuote": "",
                "extractionConfidence": 1,
            }
        ])["requirements"][0]
        base_task = {
            "requirementId": requirement["requirementId"],
            "taskType": "learn",
            "affectedSourceKeys": ["agent:2"],
            "recommendedAction": "先学习",
            "estimatedEffortBand": "1_3_days",
            "timeBudget": "1_3_days",
            "userWillingness": "yes",
            "priorityBand": "high",
            "status": "pending",
            "completionEvidenceIds": [],
        }
        first = evidence_service.create_evidence_task(base_task)
        second = evidence_service.create_evidence_task({**base_task, "recommendedAction": "更新后的学习计划"})
        self.assertEqual(first["task"]["taskId"], second["task"]["taskId"])
        self.assertEqual(second["task"]["recommendedAction"], "更新后的学习计划")

        replacement = evidence_service.create_evidence_task({**base_task, "taskType": "accept_risk"})
        tasks = replacement["overview"]["tasks"]
        self.assertEqual(len(tasks), 2)
        self.assertEqual(next(task for task in tasks if task["taskType"] == "learn")["status"], "dismissed")
        self.assertEqual(replacement["task"]["status"], "pending")

    def test_confirming_evidence_completes_strengthening_task(self):
        evidence_service.upsert_requirements([
            {
                "requirementId": "req-confirm-task",
                "canonicalKey": "confirm-task",
                "label": "确认事实",
                "category": "experience",
                "importance": "required",
                "sourceKey": "agent:3",
                "jdQuote": "",
                "extractionConfidence": 1,
            }
        ])
        created = evidence_service.create_evidence_item({
            "title": "真实经历",
            "evidenceType": "fact",
            "summary": "用户填写的真实经历",
            "userRole": "负责人",
            "actions": ["完成行动"],
            "results": ["形成产物"],
            "sourceRefs": [{"type": "user_statement", "ref": "用户陈述", "quote": "真实经历"}],
            "tags": [],
            "status": "draft",
        })
        evidence_id = created["item"]["evidenceId"]
        evidence_service.classify_coverage({
            "requirementId": "req-confirm-task",
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过。",
            "confidence": 1,
        })
        evidence_service.create_evidence_task({
            "requirementId": "req-confirm-task",
            "taskType": "strengthen",
            "affectedSourceKeys": ["agent:3"],
            "recommendedAction": "确认并补强事实",
            "estimatedEffortBand": "under_1_hour",
            "timeBudget": "under_1_hour",
            "userWillingness": "yes",
            "priorityBand": "high",
            "status": "pending",
            "completionEvidenceIds": [],
        })

        confirmed = evidence_service.confirm_evidence_item(evidence_id)

        task = confirmed["overview"]["tasks"][0]
        self.assertEqual(task["status"], "completed")
        self.assertEqual(task["completionEvidenceIds"], [evidence_id])

    def test_confirmation_cannot_be_bypassed_by_create_or_update(self):
        created = evidence_service.create_evidence_item({
            "title": "待确认事实",
            "evidenceType": "fact",
            "summary": "",
            "userRole": "",
            "actions": [],
            "results": [],
            "sourceRefs": [],
            "tags": [],
            "status": "confirmed",
        })
        self.assertEqual(created["item"]["status"], "draft")

        with self.assertRaises(HTTPException) as raised:
            evidence_service.update_evidence_item({**created["item"], "status": "confirmed"})

        self.assertEqual(raised.exception.status_code, 400)

    def test_assessment_sync_uses_stable_ids_and_preserves_user_decisions(self):
        assessment = [
            {
                "canonicalKey": "go-concurrency",
                "label": "Go 并发开发",
                "category": "skill",
                "importance": "required",
                "jdQuote": "熟悉 Go 并发开发",
                "candidateEvidenceRefs": [{"sourceType": "cv", "quote": "并发任务项目", "locator": "项目经历"}],
                "coverageStatus": "supported",
                "rationale": "当前简历中找到候选证据。",
                "confidence": 0.9,
            },
            {
                "canonicalKey": "kubernetes-production",
                "label": "Kubernetes 生产经验",
                "category": "experience",
                "importance": "required",
                "jdQuote": "具备 Kubernetes 生产经验",
                "candidateEvidenceRefs": [],
                "coverageStatus": "not_found",
                "rationale": "当前材料中未找到相关证据。",
                "confidence": 0.95,
            },
        ]

        first = evidence_service.sync_requirement_assessment("agent:7", assessment)
        requirement_id = first["requirements"][0]["requirementId"]
        self.assertEqual(first["coverages"][0]["coverageStatus"], "partial")
        self.assertEqual(first["summary"]["potentialEvidenceRequirementCount"], 1)
        self.assertEqual(first["summary"]["blockingGapCount"], 1)

        created = evidence_service.create_evidence_item({
            "title": "并发任务项目",
            "evidenceType": "project",
            "summary": "",
            "userRole": "开发",
            "actions": ["实现并发调度"],
            "results": [],
            "sourceRefs": [],
            "tags": ["go"],
            "status": "draft",
        })
        evidence_id = created["item"]["evidenceId"]
        evidence_service.classify_coverage({
            "requirementId": requirement_id,
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过。",
            "confidence": 1,
        })
        evidence_service.confirm_evidence_item(evidence_id)

        changed_assessment = [{**assessment[0], "coverageStatus": "not_found", "candidateEvidenceRefs": []}]
        second = evidence_service.sync_requirement_assessment("agent:7", changed_assessment)
        coverage = second["coverages"][0]
        self.assertEqual(second["requirements"][0]["requirementId"], requirement_id)
        self.assertEqual(coverage["assessmentStatus"], "not_found")
        self.assertEqual(coverage["coverageStatus"], "supported")
        self.assertEqual(coverage["userClassification"], "done")
        self.assertEqual(coverage["rationale"], "用户确认做过。")
        listed = evidence_service.list_requirements("agent:7")
        self.assertEqual(len(listed["requirements"]), 1)
        self.assertEqual(second["summary"]["potentialEvidenceRequirementCount"], 0)
        self.assertEqual(second["overview"]["counts"]["unresolvedCoverages"], 0)

    def test_normalizes_canonical_keys_and_reuses_evidence_across_jobs(self):
        overview = evidence_service.upsert_requirements([
            {
                "requirementId": "req-python-a",
                "canonicalKey": " Python_FastAPI ",
                "label": "Python 与 FastAPI",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:11",
            },
            {
                "requirementId": "req-python-b",
                "canonicalKey": "python fastapi",
                "label": "熟悉 Python/FastAPI",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:12",
            },
        ])
        requirements = {item["requirementId"]: item for item in overview["requirements"]}
        self.assertEqual(requirements["req-python-a"]["canonicalKey"], "python-fastapi")
        self.assertEqual(
            requirements["req-python-a"]["canonicalGroupId"],
            requirements["req-python-b"]["canonicalGroupId"],
        )

        created = evidence_service.create_evidence_item({
            "title": "FastAPI 服务项目",
            "evidenceType": "project",
            "summary": "使用 FastAPI 开发服务。",
            "userRole": "核心开发",
            "actions": ["设计 API"],
            "results": ["服务上线"],
            "sourceRefs": [{"type": "project", "ref": "api", "quote": ""}],
            "tags": ["python", "fastapi"],
        })
        evidence_id = created["item"]["evidenceId"]
        classified = evidence_service.classify_coverage({
            "requirementId": "req-python-a",
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过 FastAPI 项目。",
            "confidence": 1,
        })

        self.assertEqual(classified["affectedSourceKeys"], ["agent:11", "agent:12"])
        self.assertEqual(classified["affectedRequirementIds"], ["req-python-a", "req-python-b"])
        coverages = {item["requirementId"]: item for item in classified["overview"]["coverages"]}
        self.assertEqual(coverages["req-python-a"]["decisionSource"], "direct")
        self.assertEqual(coverages["req-python-b"]["decisionSource"], "canonical_reuse")
        self.assertEqual(coverages["req-python-b"]["reusedFromRequirementId"], "req-python-a")
        self.assertEqual(coverages["req-python-b"]["evidenceIds"], [evidence_id])
        linked_item = classified["overview"]["evidenceItems"][0]
        self.assertEqual(linked_item["requirementIds"], ["req-python-a", "req-python-b"])

        confirmed = evidence_service.confirm_evidence_item(evidence_id)
        confirmed_coverages = {item["requirementId"]: item for item in confirmed["overview"]["coverages"]}
        self.assertEqual(confirmed_coverages["req-python-a"]["coverageStatus"], "supported")
        self.assertEqual(confirmed_coverages["req-python-b"]["coverageStatus"], "supported")
        self.assertEqual(confirmed["affectedSourceKeys"], ["agent:11", "agent:12"])

    def test_new_assessment_inherits_existing_canonical_evidence(self):
        assessment = [{
            "canonicalKey": "Python FastAPI",
            "label": "Python 与 FastAPI",
            "category": "skill",
            "importance": "required",
            "jdQuote": "熟悉 Python 和 FastAPI",
            "coverageStatus": "not_found",
            "rationale": "当前材料未找到。",
            "confidence": 0.9,
        }]
        first = evidence_service.sync_requirement_assessment("agent:21", assessment)
        first_requirement_id = first["requirements"][0]["requirementId"]
        created = evidence_service.create_evidence_item({
            "title": "FastAPI 服务",
            "evidenceType": "project",
            "summary": "开发过 FastAPI 服务。",
            "userRole": "开发者",
            "actions": ["实现接口"],
            "results": ["交付服务"],
            "sourceRefs": [{"type": "user_statement", "ref": "用户陈述", "quote": "开发过 FastAPI 服务"}],
            "tags": [],
        })
        evidence_id = created["item"]["evidenceId"]
        evidence_service.classify_coverage({
            "requirementId": first_requirement_id,
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过。",
            "confidence": 1,
        })
        evidence_service.confirm_evidence_item(evidence_id)

        second = evidence_service.sync_requirement_assessment("agent:22", [{**assessment[0], "canonicalKey": "python_fastapi"}])
        second_coverage = second["coverages"][0]
        self.assertEqual(second["requirements"][0]["canonicalKey"], "python-fastapi")
        self.assertEqual(second_coverage["coverageStatus"], "supported")
        self.assertEqual(second_coverage["decisionSource"], "canonical_reuse")
        self.assertEqual(second_coverage["reusedFromRequirementId"], first_requirement_id)
        self.assertEqual(second_coverage["evidenceIds"], [evidence_id])
        self.assertEqual(second["overview"]["evidenceItems"][0]["requirementIds"], sorted([
            first_requirement_id,
            second["requirements"][0]["requirementId"],
        ]))

    def test_direct_user_decision_is_not_overwritten_by_canonical_reuse(self):
        evidence_service.upsert_requirements([
            {"requirementId": "req-direct-a", "canonicalKey": "sql", "label": "SQL", "sourceKey": "agent:31"},
            {"requirementId": "req-direct-b", "canonicalKey": "SQL", "label": "SQL", "sourceKey": "agent:32"},
        ])
        evidence_service.classify_coverage({
            "requirementId": "req-direct-b",
            "userClassification": "not_done",
            "evidenceIds": [],
            "rationale": "用户明确没有该经历。",
            "confidence": 1,
        })
        created = evidence_service.create_evidence_item({
            "title": "SQL 项目",
            "evidenceType": "project",
            "summary": "另一个岗位确认的 SQL 经历。",
            "userRole": "开发",
            "actions": ["编写查询"],
            "results": [],
            "sourceRefs": [],
            "tags": [],
        })
        evidence_id = created["item"]["evidenceId"]
        result = evidence_service.classify_coverage({
            "requirementId": "req-direct-a",
            "userClassification": "done",
            "evidenceIds": [evidence_id],
            "rationale": "用户确认做过。",
            "confidence": 1,
        })
        coverage = next(item for item in result["overview"]["coverages"] if item["requirementId"] == "req-direct-b")
        self.assertEqual(coverage["userClassification"], "not_done")
        self.assertEqual(coverage["coverageStatus"], "user_confirmed_absent")
        self.assertEqual(coverage["decisionSource"], "direct")
        self.assertEqual(coverage["evidenceIds"], [])

    def test_document_fact_from_resume_is_source_verified_without_user_confirmation(self):
        result = evidence_service.sync_requirement_assessment("agent:51", [{
            "canonicalKey": "bachelor-computer-science",
            "label": "本科及以上学历，计算机相关专业",
            "category": "education",
            "verificationMode": "document_fact",
            "importance": "required",
            "jdQuote": "本科及以上学历，计算机相关专业",
            "candidateEvidenceRefs": [{
                "sourceType": "cv",
                "quote": "电子科技大学中山学院｜本科｜计算机科学与技术",
                "locator": "教育背景",
            }],
            "coverageStatus": "supported",
            "rationale": "简历教育背景直接满足要求。",
            "confidence": 1,
        }])

        requirement = result["requirements"][0]
        coverage = result["coverages"][0]
        self.assertEqual(requirement["verificationMode"], "document_fact")
        self.assertEqual(coverage["coverageStatus"], "supported")
        self.assertEqual(coverage["verificationStatus"], "source_verified")
        self.assertEqual(coverage["decisionSource"], "source_document")
        self.assertEqual(coverage["userDecisionAt"], "")
        self.assertEqual(result["summary"]["supportedRequirementCount"], 1)

    def test_preference_can_be_confirmed_without_creating_evidence(self):
        overview = evidence_service.upsert_requirements([{
            "requirementId": "req-location",
            "canonicalKey": "work-location-shanghai",
            "label": "工作地点上海",
            "category": "location",
            "verificationMode": "preference",
            "sourceKey": "agent:52",
        }])
        self.assertEqual(overview["requirements"][0]["verificationMode"], "preference")

        classified = evidence_service.classify_coverage({
            "requirementId": "req-location",
            "userClassification": "done",
            "evidenceIds": [],
            "rationale": "用户确认地点符合。",
            "confidence": 1,
        })

        self.assertEqual(classified["coverage"]["coverageStatus"], "supported")
        self.assertEqual(classified["coverage"]["verificationStatus"], "user_confirmed")
        self.assertEqual(classified["overview"]["evidenceItems"], [])

    def test_atomicizes_compound_capabilities_and_keeps_proficiency_separate(self):
        overview = evidence_service.upsert_requirements([{
            "requirementId": "req-compound",
            "canonicalKey": "rag-vector-db-experience",
            "label": "熟练掌握 RAG 与向量数据库经验",
            "category": "skill",
            "importance": "required",
            "sourceKey": "agent:80",
            "jdQuote": "熟练掌握 RAG 与向量数据库相关开发经验",
        }])

        capabilities = {item["canonicalKey"]: item for item in overview["capabilities"]}
        self.assertIn("rag-systems", capabilities)
        self.assertIn("vector-database", capabilities)
        self.assertEqual(capabilities["rag-systems"]["label"], "RAG")
        self.assertEqual(capabilities["rag-systems"]["highestRequiredProficiency"], "proficient")
        self.assertEqual(capabilities["vector-database"]["highestRequiredProficiency"], "proficient")
        self.assertNotIn("rag-vector-db-experience", capabilities)

    def test_hides_proficiency_for_presence_only_and_non_skill_capabilities(self):
        overview = evidence_service.upsert_requirements([
            {
                "requirementId": "req-evaluation",
                "canonicalKey": "ai-evaluation-system",
                "capabilityName": "AI应用评测体系建设",
                "label": "有AI应用评测体系建设经验",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:90",
            },
            {
                "requirementId": "req-teamwork",
                "canonicalKey": "teamwork",
                "capabilityName": "团队协作与自驱力",
                "label": "具备团队协作与自驱力",
                "category": "behavior",
                "importance": "required",
                "sourceKey": "agent:90",
                "requiredProficiency": "proficient",
            },
        ])

        capabilities = {item["canonicalKey"]: item for item in overview["capabilities"]}
        self.assertFalse(capabilities["ai-evaluation-system"]["proficiencyApplicable"])
        self.assertFalse(capabilities["teamwork"]["proficiencyApplicable"])
        self.assertEqual(capabilities["teamwork"]["highestRequiredProficiency"], "unspecified")

    def test_any_of_group_counts_as_one_requirement_and_one_match_satisfies_it(self):
        assessments = [
            {
                "canonicalKey": language,
                "capabilityName": label,
                "label": "熟练掌握 Python、Java 或 C++ 中至少一门",
                "category": "skill",
                "importance": "required",
                "requirementGroupId": "programming-language-choice",
                "requirementGroupMode": "any_of",
                "requirementGroupLabel": "Python、Java 或 C++ 中至少一门",
                "minimumSatisfied": 1,
                "candidateEvidenceRefs": (
                    [{"sourceType": "cv", "quote": "Python 项目经验", "locator": "项目经历"}]
                    if language == "python-programming"
                    else []
                ),
                "coverageStatus": "supported" if language == "python-programming" else "not_found",
                "confidence": 0.9,
            }
            for language, label in (
                ("python-programming", "Python"),
                ("java-programming", "Java"),
                ("cpp-programming", "C++"),
            )
        ]

        result = evidence_service.sync_requirement_assessment("agent:91", assessments)

        self.assertEqual(len(result["requirements"]), 3)
        self.assertTrue(all(
            item["requirementGroupMode"] == "any_of"
            for item in result["requirements"]
        ))
        self.assertEqual(result["summary"]["requirementCount"], 1)
        self.assertEqual(result["summary"]["supportedRequirementCount"], 0)
        self.assertEqual(result["summary"]["blockingGapCount"], 0)
        python_requirement = next(
            item for item in result["requirements"]
            if item["canonicalKey"] == "python-programming"
        )
        evidence = evidence_service.create_evidence_item({
            "title": "Python 项目证据",
            "evidenceType": "project",
            "summary": "使用 Python 完成项目开发。",
            "sourceRefs": [{"type": "project", "ref": "demo", "quote": "Python 项目"}],
            "requirementIds": [python_requirement["requirementId"]],
        })["item"]
        evidence_service.confirm_evidence_item(evidence["evidenceId"])
        evidence_service.classify_coverage({
            "requirementId": python_requirement["requirementId"],
            "userClassification": "done",
            "evidenceIds": [evidence["evidenceId"]],
            "rationale": "用户确认掌握 Python。",
            "confidence": 1,
        })
        refreshed = evidence_service.read_evidence_overview()
        coverage_by_id = {
            item["requirementId"]: item for item in refreshed["coverages"]
        }
        self.assertEqual(
            coverage_by_id[python_requirement["requirementId"]]["coverageStatus"],
            "supported",
        )

    def test_infers_any_of_group_from_shared_at_least_one_requirement(self):
        quote = "熟练掌握 Python、Java、C++ 中至少一门编程语言"
        overview = evidence_service.upsert_requirements([
            {
                "requirementId": f"req-{key}",
                "canonicalKey": key,
                "capabilityName": label,
                "label": quote,
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:92",
                "jdQuote": quote,
                "requiredProficiency": "proficient",
            }
            for key, label in (
                ("python-programming", "Python"),
                ("java-programming", "Java"),
                ("cpp-programming", "C++"),
            )
        ])

        requirements = [
            item for item in overview["requirements"]
            if item["sourceKey"] == "agent:92"
        ]
        self.assertEqual(
            len({item["requirementGroupId"] for item in requirements}),
            1,
        )
        self.assertTrue(all(item["requirementGroupMode"] == "any_of" for item in requirements))

    def test_user_proficiency_is_reused_without_creating_duplicate_capabilities(self):
        overview = evidence_service.upsert_requirements([
            {
                "requirementId": "req-cpp-a",
                "canonicalKey": "cpp-language",
                "label": "掌握 C++",
                "category": "skill",
                "importance": "required",
                "sourceKey": "agent:81",
            },
            {
                "requirementId": "req-cpp-b",
                "canonicalKey": "cpp-programming",
                "label": "精通 C++",
                "category": "skill",
                "importance": "preferred",
                "sourceKey": "agent:82",
            },
        ])
        self.assertEqual(
            len([item for item in overview["capabilities"] if item["canonicalKey"] == "cpp-programming"]),
            1,
        )

        classified = evidence_service.classify_coverage({
            "requirementId": "req-cpp-a",
            "userClassification": "done",
            "userProficiency": "working",
            "evidenceIds": [],
            "rationale": "用户确认掌握 C++。",
            "confidence": 1,
        })
        cpp = next(
            item for item in classified["overview"]["capabilities"]
            if item["canonicalKey"] == "cpp-programming"
        )
        self.assertEqual(cpp["jobCount"], 2)
        self.assertEqual(cpp["userProficiency"], "working")
        self.assertEqual(cpp["highestRequiredProficiency"], "expert")
        self.assertEqual(cpp["requiredProficiencyCounts"]["working"], 1)
        self.assertEqual(cpp["requiredProficiencyCounts"]["expert"], 1)

    def test_migrates_missing_collections_without_losing_requirements(self):
        evidence_service.EVIDENCE_STORE_PATH.write_text(
            json.dumps({
                "requirements": [{"requirementId": "req-existing", "label": "Existing"}],
                "evidenceItems": None,
            }),
            encoding="utf-8",
        )

        overview = evidence_service.read_evidence_overview()

        self.assertEqual(overview["schemaVersion"], 7)
        self.assertEqual(overview["requirements"][0]["requirementId"], "req-existing")
        self.assertEqual(overview["evidenceItems"], [])
        self.assertEqual(overview["coverages"], [])
        self.assertEqual(overview["tasks"], [])

    def test_migrates_v1_canonical_groups_and_evidence_links(self):
        evidence_service.EVIDENCE_STORE_PATH.write_text(
            json.dumps({
                "schemaVersion": 1,
                "requirements": [{
                    "requirementId": "req-existing",
                    "canonicalKey": " Python_FastAPI ",
                    "sourceKey": "agent:41",
                }],
                "evidenceItems": [{"evidenceId": "ev-existing", "status": "confirmed"}],
                "coverages": [{
                    "requirementId": "req-existing",
                    "evidenceIds": ["ev-existing"],
                    "userClassification": "done",
                    "userDecisionAt": "2026-07-01T00:00:00+08:00",
                }],
                "tasks": [],
            }),
            encoding="utf-8",
        )

        overview = evidence_service.read_evidence_overview()

        self.assertEqual(overview["schemaVersion"], 7)
        self.assertEqual(overview["requirements"][0]["canonicalKey"], "python-fastapi")
        self.assertTrue(overview["requirements"][0]["canonicalGroupId"].startswith("cgrp-"))
        self.assertEqual(overview["coverages"][0]["decisionSource"], "direct")
        self.assertEqual(overview["evidenceItems"][0]["requirementIds"], ["req-existing"])

    def test_rejects_newer_store_version(self):
        evidence_service.EVIDENCE_STORE_PATH.write_text(
            json.dumps({"schemaVersion": 99}),
            encoding="utf-8",
        )

        with self.assertRaises(HTTPException) as raised:
            evidence_service.read_evidence_overview()

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
