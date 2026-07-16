---
name: triage-new-jobs
description: Review newly collected BossFlow jobs, compare them with the active job-search target, explain shortlist decisions, and add user-approved roles to the candidate pipeline. Use for new-job triage, shortlist creation, daily job review, or deciding which collected roles deserve further evaluation.
---

# Triage New Jobs

Use the BossFlow MCP server as the only source of job and pipeline state.

## Workflow

1. Call `list_projects` when the project is not explicit. Ask for a choice only when multiple projects remain plausible.
2. Call `get_project_summary` and `get_pipeline` before assessing new jobs.
3. Call `search_jobs` with a narrow query or page size. Prefer batches of at most 50 and summarize at most 10 jobs at once.
4. Compare each job using stored score signals, salary, location, experience, education, categories, and JD evidence. Do not infer candidate experience that is not present in BossFlow.
5. Separate results into:
   - recommend adding;
   - worth a manual look;
   - skip, with a short reason.
6. Call `add_candidate_jobs` without confirmation to obtain the authoritative preview.
7. Show the preview and request confirmation. Call it again with `confirmed=true` only for the approved IDs.
8. Report added, skipped-as-duplicate, and missing counts.

## Collection

When collection is requested, call `start_collection` without confirmation first. Show the saved keywords, cities, target count, and current queue state. Run with `confirmed=true` only after the user accepts that preview. Poll `get_task_status`; do not start a second crawler task while one is active.

## Output

Keep the decision surface compact: company, role, city, salary, score signal, recommendation, and reason. Link decisions to returned data rather than generic market assumptions.
