---
name: import-story-bank
description: Extract source-grounded interview story drafts from a user-authorized local project and stage them in BossFlow for review. Use when the user asks to turn a codebase, project repository, work log, or portfolio project into reusable interview stories or evidence-backed STAR drafts.
---

# Import Story Bank

Read [references/story-draft-schema.md](references/story-draft-schema.md) before constructing drafts.

## Workflow

1. Obtain an explicit project directory from the user and treat it as read-only.
2. Exclude `.git`, dependencies, build output, browser profiles, environment files, keys, cookies, credentials, generated binaries, and unrelated personal files.
3. Inspect high-signal sources first: project documentation, manifests, architecture notes, tests, migrations, and focused implementation files.
4. Capture only defensible facts. Record source file paths and narrow line references in `source` or `sourceLabel`. Separate direct evidence from inference.
5. Draft stories using the reference schema. Leave unknown metrics and the user's exact role blank or mark them as needing confirmation.
6. Call `save_imported_story_drafts` without confirmation and show its preview.
7. Save with `confirmed=true` only after the user approves the proposed drafts. Saved items remain drafts.
8. Promote a draft with `confirm_story_draft` only after the user reviews that specific draft and approves its facts.

## Guardrails

- Do not modify the source repository.
- Do not scan outside the authorized directory.
- Do not copy secrets or large source excerpts into BossFlow.
- Do not invent ownership, production impact, team size, performance gains, or business metrics.
- Prefer three strong, distinct drafts over many repetitive ones.
