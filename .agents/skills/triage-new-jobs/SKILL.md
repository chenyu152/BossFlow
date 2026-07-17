---
name: triage-new-jobs
description: Review newly collected BossFlow jobs, compare them with the active job-search target, explain shortlist decisions, and add user-approved roles to the candidate pipeline. Use for new-job triage, shortlist creation, daily job review, or deciding which collected roles deserve further evaluation.
---

# Triage New Jobs

Use the BossFlow MCP server as the only source of job and pipeline state.

## Workflow

1. Call `list_projects` when the project is not explicit. Ask for a choice only when multiple projects remain plausible.
2. Call `get_project_summary` and `get_pipeline` before assessing new jobs.
3. Call `search_jobs` with the narrowest useful filters: city, salary range, score threshold, fit/risk signal, category, freshness, or recruitment status. Prefer batches of at most 50 and summarize at most 10 jobs at once.
4. Compare each job using stored score signals, salary, location, experience, education, categories, and JD evidence. Do not infer candidate experience that is not present in BossFlow.
5. Separate results into:
   - recommend adding;
   - worth a manual look;
   - skip, with a short reason.
6. Call `add_candidate_jobs` without `confirmation_id` to obtain the authoritative preview.
7. Show the exact jobs, duplicates, target project, and expiry time from the preview. Ask a direct yes/no question.
8. Stop and wait. Treat silence, a new request, or an ambiguous answer as no approval.
9. Only after an explicit yes in a later user message, repeat the unchanged call with the returned `confirmationId`. If IDs change or the ticket expires, discard it and preview again.
10. Report added, skipped-as-duplicate, and missing counts.

## Collection

When collection is requested, call `get_login_state` first. If no usable Cookie exists, stop and direct the user to BossFlow's “登录 / 保存 Cookie” action. Treat `refresh_recommended` as a warning rather than proof of expiry. Then call `start_collection` without `confirmation_id`; show saved keywords, cities, target count, Cookie status, and queue state. Follow the two-turn confirmation protocol above, then poll `get_task_status`. Do not start a second crawler task while one is active.

## Confirmation protocol

Never turn the user's initial task request into approval of a later preview. Never fabricate, reuse, edit, or immediately consume a `confirmationId`. A compliant preview/approval/write sequence always spans two user-visible turns.

## Output

Keep the decision surface compact: company, role, city, salary, score signal, recommendation, and reason. Link decisions to returned data rather than generic market assumptions.
