---
name: prepare-application
description: Prepare a BossFlow candidate role through fine review, evidence checks, resume suggestions, and interview preparation without inventing candidate facts. Use when the user wants to evaluate a shortlisted role, prepare application materials, tailor a resume, or get ready for an interview.
---

# Prepare Application

Use BossFlow MCP tools in sequence and preserve the human approval gates. Read [references/safety-gates.md](references/safety-gates.md) before any paid or write action.

## Workflow

1. Identify the exact candidate `sourceKey` from `get_pipeline`; do not substitute a similarly named job.
2. Call `get_application_context`, `get_evidence_requirements`, and `get_evidence_tasks`. Separate confirmed evidence, source-verified facts, unresolved requirements, and blocking gaps.
3. If no fine review exists, call `run_fine_review` without `confirmation_id`. Disclose that it uses the configured BossFlow LLM API. Show the preview, ask a direct yes/no question, stop, and wait. Only after an explicit yes in a later user message, repeat the unchanged call with its `confirmationId`.
4. Re-read application context after fine review.
5. Prefer the connected Agent for text generation: author evidence-bound resume suggestions from the returned context, then call `save_agent_resume_suggestions` without `confirmation_id`. Show its excerpt, evidence claim count, and target. Ask for approval and use its one-time `confirmationId` only after a later explicit yes.
6. Use `create_resume_suggestions` only when the user explicitly chooses BossFlow's configured LLM instead of the connected Agent. Keep that paid call behind its own preview and later approval.
7. For interview preparation, prefer authoring from `get_application_context` and saving through `save_agent_interview_preparation`. Use `create_interview_prep` only when the user explicitly selects the BossFlow LLM path.
8. Report artifact IDs/paths, generation mode, unresolved evidence, and the next user decision.

## Rules

- Never claim that an application, greeting, or message was sent.
- Never turn a missing fact into a negative claim about the candidate.
- Never approve resume claims on the user's behalf.
- Keep paid LLM actions separate so the user can decline later stages.
- Stop when a blocking evidence gap would make generated material misleading.
- Never infer approval from the initial request. A preview ticket is valid only for the exact parameters shown, expires quickly, is one-use, and may be consumed only after a later unambiguous yes. Preview again after any change or expiry.
