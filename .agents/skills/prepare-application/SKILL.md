---
name: prepare-application
description: Prepare a BossFlow candidate role through fine review, evidence checks, resume suggestions, and interview preparation without inventing candidate facts. Use when the user wants to evaluate a shortlisted role, prepare application materials, tailor a resume, or get ready for an interview.
---

# Prepare Application

Use BossFlow MCP tools in sequence and preserve the human approval gates. Read [references/safety-gates.md](references/safety-gates.md) before any paid or write action.

## Workflow

1. Identify the exact candidate `sourceKey` from `get_pipeline`; do not substitute a similarly named job.
2. Call `get_application_context` with `detail_level="full"`. Then call `get_capabilities` with the exact `source_key`, `detail_level="summary"`, and a bounded limit; call `get_requirement_groups` with that `source_key` and `detail_level="full"`; call `get_evidence_tasks` with that `source_key`. Do not request project-wide full evidence. Separate confirmed evidence, personal resume claims, source-verified facts, unresolved capabilities, and blocking gaps.
   - Treat a normalized capability as one reusable user decision even when several jobs phrase it differently.
   - For an `any_of` group, compare the number of satisfied alternatives with `minimumSatisfied`; never report every unselected alternative as an independent mandatory gap.
   - Compare proficiency only when `proficiencyApplicable` is true. Presence-only skills, experience, behavior, education, and work-year facts may not have a meaningful proficiency scale.
3. If no fine review exists, call `run_fine_review` without `confirmation_id`. Disclose that it uses the configured BossFlow LLM API. Show the preview, ask a direct yes/no question, stop, and wait. Only after an explicit yes in a later user message, repeat the unchanged call with its `confirmationId`.
4. Re-read application context after fine review.
5. Locate the user's base resume with `get_base_resume`. Its default `content_mode="path"` is intentional: a local Agent should read the returned Markdown path with its filesystem tools; use `content_mode="full"` only when the client cannot access that path. Never overwrite the file directly. When the user explicitly asks to modify the base resume, call `update_base_resume` with the latest `revision`, show the returned diff preview, and wait for later approval.
6. Prefer the connected Agent for text generation: author evidence-bound resume suggestions from the returned context, then call `save_agent_resume_suggestions` without `confirmation_id`. Show its excerpt, evidence claim count, and target. Ask for approval and use its one-time `confirmationId` only after a later explicit yes.
7. Use `create_resume_suggestions` only when the user explicitly chooses BossFlow's configured LLM instead of the connected Agent. Keep that paid call behind its own preview and later approval.
8. Use `list_tailored_resumes` to find an existing tailored resume and `get_tailored_resume` to obtain its local path and revision. A local Agent should read the returned file path instead of requesting full content. If the user asks for edits, call `update_tailored_resume` with the latest revision; do not directly overwrite the Markdown because BossFlow also maintains edit metadata.
9. For interview preparation, prefer authoring from `get_application_context` and saving through `save_agent_interview_preparation`. Use `create_interview_prep` only when the user explicitly selects the BossFlow LLM path.
10. Report artifact IDs/paths, generation mode, unresolved evidence, and the next user decision.

## Rules

- Never claim that an application, greeting, or message was sent.
- Never turn a missing fact into a negative claim about the candidate.
- Never approve resume claims on the user's behalf.
- Treat evidence imported from `cv.md` as a user-confirmed personal resume claim, not as independently verified project or artifact evidence.
- When staging stronger project or artifact evidence for a normalized capability, include its `capabilityId` in `capabilityIds`; do not require a job-specific requirement ID.
- Use `decide_capability` instead of repeatedly classifying equivalent requirements. Always preview the write and wait for later explicit approval.
- When the user asks to sync the base resume, call `preview_resume_capability_import`, show new/merge/already-synced items and source quotes, then preview `import_resume_capabilities`. Do not import or delete capabilities without the separate confirmation turn.
- Treat LLM reports, resume suggestions, and resume drafts as local artifacts: prefer the paths returned by BossFlow for reading. Keep writes behind BossFlow tools because suggestions carry evidence mappings and tailored-resume saves update associated metadata.
- Keep paid LLM actions separate so the user can decline later stages.
- Stop when a blocking evidence gap would make generated material misleading.
- Never infer approval from the initial request. A preview ticket is valid only for the exact parameters shown, expires quickly, is one-use, and may be consumed only after a later unambiguous yes. Preview again after any change or expiry.
