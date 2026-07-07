# BossFlow Handoff

This document is for continuing development in a new chat/thread.

## Collaboration Workflow

- Work in small, reviewable phases. Do not implement a large feature all at once.
- After each phase, explain:
  - what changed
  - how to run it
  - how the user should self-test it
- Wait for the user's self-test confirmation before starting the next phase.
- Commit and push only after the user confirms the phase works.
- Do not commit personal files or generated private artifacts.
- Keep Web and future agent/skill usage on the same backend logic where practical.
- Prefer module-level implementation:
  - backend services for business logic
  - schemas for request payloads
  - API methods in `bossspider-web/src/api.ts`
  - hook orchestration in `bossspider-web/src/hooks/useBossSpider.ts`
  - page-specific UI in `bossspider-web/src/pages/`
- Avoid putting large new logic directly in `App.tsx`.
- Preserve the current local dev process. The frontend is usually at `http://127.0.0.1:5173/`; avoid disrupting running crawl/backend/frontend processes unless the user allows it.

## Local Reference Projects

- `D:\Project\career-ops`
  - Main reference for product direction and agent/skill-style workflows.
  - Important areas:
    - `.agents/skills/career-ops/SKILL.md`
    - `modes/interview-prep.md`
    - `modes/interview/plan.md`
    - `modes/interview/practice.md`
    - `modes/interview/debrief.md`
    - `match-star.mjs`
  - Useful concepts:
    - parallel job evaluation
    - tailored resume generation with user confirmation
    - interview story bank using STAR+R
    - question bank and post-interview debrief
    - skill/agent-friendly file workflows

- `D:\Project\boss-cli`
  - Reference only for Boss Zhipin capability implementation.
  - Useful capabilities:
    - profile viewing
    - delivered jobs
    - interview invitations
    - communication list
    - greeting/message flow
  - Product shape is not preferred. BossFlow should keep user confirmation before any greeting/action.

## Current Project

- Main working directory: `D:\Project\BossSpider\new`
- Frontend: `D:\Project\BossSpider\new\bossspider-web`
- Backend: `D:\Project\BossSpider\new\backend`
- Git remote: `https://github.com/chenyu152/BossFlow.git`
- Git identity should be:
  - name: `chenyu152`
  - email: `871904461@qq.com`

## Privacy Rules

The project may contain personal resume, job, interview, and generated material. Do not commit these.

Important ignored paths/files include:

- `cv.md`
- `.env`
- `profile.yml`
- `data/pipeline.md`
- `data/interview-prep/`
- `reports/jobs/`
- `output/resumes/`
- `output/interview-prep/`
- local DB/log/cache files

Before committing, always run:

```powershell
git status --short
git diff --stat
```

If a private artifact appears as untracked or staged, stop and fix `.gitignore` before committing.

## Completed Features

- Web replacement for the original PyQt BossSpider flow.
- Jobs page:
  - large list display
  - pagination
  - score sort persistence
  - bulk selection by drag
  - enhanced filters
- Pipeline page:
  - status workflow
  - delete pipeline item
  - job detail panel
  - rough scoring
  - LLM scoring
  - LLM sort
  - LLM report viewer
- Scoring:
  - rough scoring includes experience and education signals
  - rough scoring performance improved
- Resume page:
  - LLM resume suggestions
  - selectable suggestions
  - tailored Markdown resume draft generation
  - no PDF output for now
- Dashboard:
  - data-driven metrics
- Job description formatting:
  - structured display for messy Boss Zhipin descriptions
- Interview page:
  - initial interview prep document generation
  - reads `story-bank.md`
  - saves prep docs to `output/interview-prep/`
  - story bank editor first version
  - editable STAR+R stories
  - draft story extraction from generated interview prep

## Current Unconfirmed Work

The latest change improves story draft extraction from generated interview prep:

- `C. 故事库匹配` table now creates CV-based story drafts.
- `D. 缺失故事` headings now create gap story drafts.
- It should no longer create meaningless buttons like `为什么可能问`, `可从哪些已有经历挖`, or `需补充事实`.

This change has been built/tested locally, but should be user-tested before committing.

Suggested self-test:

1. Restart backend if needed:
   ```powershell
   python -m uvicorn backend.app:app --reload --port 8000
   ```
2. Open `http://127.0.0.1:5173/`.
3. Go to `Interview`.
4. Select the Tencent `agent应用开发工程师` prep.
5. Check `Draft stories from this prep`.
6. Expected draft buttons include titles such as:
   - `项目1：LangGraph设计“规划-执行-反思”高韧性推理决策网络`
   - `项目1：FastMCP框架封装15项运维与诊断Tool接口，支持stdio和SSE`
   - `Go语言项目经验`
   - `大数据计算开发经验`
   - `搜索引擎/大规模检索系统开发经验`

## Recommended Next Work

### 1. Finish Story Bank UX

Goal: make story bank maintenance comfortable and trustworthy.

Potential tasks:

- Add clearer separation between:
  - confirmed stories
  - drafts from CV/prep
  - missing/gap stories
- Add a visual `Needs confirmation` state.
- Add a preview mode for the final Markdown story.
- Add duplicate detection by title/theme.
- Add better empty-state guidance for STAR+R fields.

This should be done before advanced interview features.

### 2. Story Matching Without LLM

Reference: `D:\Project\career-ops\match-star.mjs`

Goal: given an interview question or JD requirement, rank existing stories.

Potential tasks:

- Parse `story-bank.md` into structured stories.
- Score stories by tags/title/action/result overlap.
- Add optional JD text boost.
- Expose backend endpoint:
  - `POST /api/interview/story-match`
- Use it in Interview page to show "best stories for this question".

### 3. Question Bank

Reference:

- `D:\Project\career-ops\modes/interview/practice.md`
- `D:\Project\career-ops\modes/interview/debrief.md`

Goal: persist actual and inferred interview questions.

Potential tasks:

- Create `data/interview-prep/question-bank.md` or JSON-backed equivalent.
- Store:
  - question
  - company/job
  - round type
  - source: JD inferred / report / real interview / practice
  - status: strong / solid / gap
  - linked story
- Add UI list and edit controls.

### 4. Interview Debrief

Goal: after a real interview, capture what happened while memory is fresh.

Potential tasks:

- Add `Debrief` panel under Interview.
- Capture:
  - round type
  - interviewer role
  - questions asked
  - user answer summary
  - what landed
  - gaps
  - next round details
- Update question bank.
- Suggest new story drafts.

### 5. Mock Interview / Practice

Reference: `D:\Project\career-ops\modes/interview/practice.md`

Goal: one-question-at-a-time practice with feedback.

Important product behavior:

- Ask one question at a time.
- Wait for user's answer.
- Give structured feedback:
  - what landed
  - what to sharpen
  - stronger version
  - status
- Record session transcript under ignored local data.

This should come after story bank and question bank are stable.

### 6. Company Research

Reference: `D:\Project\career-ops\modes/interview-prep.md`

Goal: enrich interview prep with company/process intelligence.

Potential tasks:

- Add optional web research mode.
- Search for:
  - interview process
  - salary/comp
  - recent company/team/product signals
  - likely round structure
- Require citations and source labels.
- Do not fabricate interview questions.
- Distinguish sourced questions from `[基于JD推断]`.

This should remain user-triggered because it uses network and can take time.

### 7. Boss Zhipin Account/Communication Features

Reference: `D:\Project\boss-cli`

Potential tasks:

- Personal profile view.
- Delivered/applied list.
- Interview invitations.
- Communication list.
- Greeting draft generation.
- User-confirmed send only.

Do not implement auto-send or auto-apply.

### 8. Agent/Skill Packaging

Goal: BossFlow can be used from Codex/Claude Code-style agents, not only Web.

Potential tasks:

- Formalize reusable backend/service commands.
- Add or update `.agents/skills/bossspider/SKILL.md`.
- Add command-style workflows:
  - evaluate job
  - generate resume suggestions
  - generate interview prep
  - match story
  - debrief interview

Keep logic shared with Web.

## Useful Commands

Run backend:

```powershell
cd D:\Project\BossSpider\new
python -m uvicorn backend.app:app --reload --port 8000
```

Run frontend:

```powershell
cd D:\Project\BossSpider\new\bossspider-web
npm run dev
```

Build frontend:

```powershell
cd D:\Project\BossSpider\new\bossspider-web
npm run build
```

Compile backend:

```powershell
cd D:\Project\BossSpider\new
python -m compileall backend
```

Commit after user confirmation:

```powershell
git status --short
git add <changed files>
git commit -m "<message>"
git push
```
