---
name: prepare-application
description: Prepare a BossFlow candidate role through fine review, evidence checks, resume suggestions, and interview preparation without inventing candidate facts. Use when the user wants to evaluate a shortlisted role, prepare application materials, tailor a resume, or get ready for an interview.
---

# Prepare Application

Use BossFlow MCP tools in sequence and preserve the human approval gates. Read [references/safety-gates.md](references/safety-gates.md) before any paid or write action.

## Workflow

1. Identify the candidate `sourceKey` from `get_pipeline`. Do not substitute a similarly named job.
2. Read `get_evidence` and the job record. Summarize confirmed evidence, source-verified facts, unresolved requirements, and blocking gaps separately.
3. If no fine review exists, call `run_fine_review` without confirmation. Explain the LLM cost and preview, then repeat with `confirmed=true` only after approval.
4. Re-read the pipeline and evidence state after fine review.
5. Call `create_resume_suggestions` through the same preview-confirm sequence. Treat the result as suggestions, not an approved final resume.
6. Generate interview preparation only when requested or when the user approves the next step. Call `create_interview_prep` first as a preview and then with `confirmed=true`.
7. Report generated artifact IDs/paths, unresolved evidence, and the next user decision.

## Rules

- Never claim that an application, greeting, or message was sent.
- Never turn a missing fact into a negative claim about the candidate.
- Never approve resume claims on the user's behalf.
- Keep paid LLM actions separate so the user can decline later stages.
- Stop when a blocking evidence gap would make generated material misleading.
