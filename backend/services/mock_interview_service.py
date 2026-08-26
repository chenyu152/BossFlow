from __future__ import annotations

import datetime as dt
import json
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Iterator

import requests
from fastapi import HTTPException

from backend.services.interview_service import (
    _interview_evidence_context,
    read_story_bank,
    read_story_drafts,
    save_story_drafts,
)
from backend.services.llm_evaluation_service import (
    CV_PATH,
    _call_llm,
    _job_text,
    _llm_config,
    _load_pipeline_job,
    _read_text,
)
from backend.services.workspace_service import project_workspace, workspace_path


MOCK_INTERVIEW_DIR = workspace_path("data/interview-prep/mock-interviews")
MOCK_INTERVIEW_SESSIONS_DIR = workspace_path("data/interview-prep/mock-interviews/sessions")

_storage_lock = threading.RLock()
_evaluation_lock = threading.RLock()
_evaluating_sessions: set[str] = set()

VALID_MODES = {"comprehensive", "project_deep_dive", "behavioral", "technical"}
VALID_DIFFICULTIES = {"auto", "basic", "advanced", "pressure"}
VALID_DURATIONS = {10, 20, 30}

MODE_LABELS = {
    "comprehensive": "综合模拟",
    "project_deep_dive": "项目深挖",
    "behavioral": "行为面试",
    "technical": "技术面试",
}

DIFFICULTY_LABELS = {
    "auto": "根据岗位自动调整",
    "basic": "基础",
    "advanced": "进阶",
    "pressure": "压力面试",
}

QUESTION_COUNTS = {
    10: 5,
    20: 7,
    30: 8,
}

EVALUATION_DIMENSIONS = (
    "relevance",
    "evidence",
    "specificity",
    "structure",
    "credibility",
    "jobFit",
)


def _now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _session_path(session_id: str) -> Path:
    safe_id = re.sub(r"[^a-zA-Z0-9-]", "", str(session_id or ""))
    if not safe_id or safe_id != session_id:
        raise HTTPException(status_code=400, detail="Invalid mock interview session id")
    return MOCK_INTERVIEW_SESSIONS_DIR / f"{safe_id}.json"


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _write_session(session: dict[str, Any]) -> dict[str, Any]:
    session["updatedAt"] = _now()
    with _storage_lock:
        _atomic_write_json(_session_path(str(session["sessionId"])), session)
    return session


def _read_session(session_id: str) -> dict[str, Any]:
    path = _session_path(session_id)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Mock interview session not found")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Mock interview session is unreadable") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Mock interview session is invalid")
    return payload


def _decode_json_object(raw: str) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    candidates = [text]
    start = text.find("{")
    if start >= 0:
        candidates.append(text[start:])
    decoder = json.JSONDecoder()
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            try:
                payload, _ = decoder.raw_decode(candidate)
            except json.JSONDecodeError:
                continue
        if isinstance(payload, dict):
            return payload
    return None


def _clean_score(value: Any) -> int:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, score))


def _safe_internal_markdown(path_value: str, limit: int = 12000) -> str:
    if not path_value:
        return ""
    try:
        path = Path(path_value)
    except TypeError:
        return ""
    if path.suffix.lower() != ".md" or not path.exists() or not path.is_file():
        return ""
    return _read_text(path, limit)


def _question_context(source_key: str) -> tuple[dict[str, Any], dict[str, Any], str]:
    item, job = _load_pipeline_job(source_key)
    story_bank = read_story_bank()
    evidence_context = _interview_evidence_context(source_key)
    cv_text = _read_text(CV_PATH, 14000)
    tailored_resume = _safe_internal_markdown(str(item.get("resumeDraftPath") or ""), 14000)
    llm_report = _safe_internal_markdown(str(item.get("reportPath") or ""), 10000)
    confirmed_stories = [
        {
            "title": story.get("title", ""),
            "theme": story.get("theme", ""),
            "tags": story.get("tags", []),
            "situation": story.get("situation", ""),
            "task": story.get("task", ""),
            "action": story.get("action", ""),
            "result": story.get("result", ""),
            "reflection": story.get("reflection", ""),
        }
        for story in story_bank.get("stories", [])
    ]
    context = f"""
岗位：
{_job_text(job)}

基础简历：
{cv_text or "暂无"}

岗位定制简历：
{tailored_resume or "暂无"}

岗位精评：
{llm_report or "暂无"}

已确认能力依据：
{json.dumps(evidence_context, ensure_ascii=False)}

已确认面试案例：
{json.dumps(confirmed_stories, ensure_ascii=False)}
""".strip()
    return item, job, context


def _historical_questions(limit: int = 80) -> list[str]:
    MOCK_INTERVIEW_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    rows: list[tuple[str, str]] = []
    for path in MOCK_INTERVIEW_SESSIONS_DIR.glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        updated_at = str(payload.get("updatedAt") or "")
        for turn in payload.get("turns") or []:
            if not turn.get("parentTurnId") and turn.get("question"):
                rows.append((updated_at, str(turn["question"])))
    rows.sort(key=lambda row: row[0], reverse=True)
    result: list[str] = []
    seen: set[str] = set()
    for _, question in rows:
        normalized = re.sub(r"\s+", "", question).lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(question)
        if len(result) >= limit:
            break
    return result


def _fallback_questions(job: dict[str, Any], mode: str, count: int) -> list[dict[str, Any]]:
    title = str(job.get("title") or "该岗位")
    base = [
        ("intro", f"请先用两分钟介绍自己，并说明为什么你适合{title}。"),
        ("project", "选择一个与该岗位最相关的项目，说明背景、你的职责、关键行动和最终结果。"),
        ("project", "在刚才的项目中，最困难的技术或协作问题是什么？你是如何定位并解决的？"),
        ("technical", "结合岗位要求，选择你最有把握的一项核心能力，说明你在真实项目中如何使用它。"),
        ("behavioral", "讲一次需求不清晰或目标发生变化的经历，你如何澄清问题并推动交付？"),
        ("credibility", "你刚才提到的成果中，哪些是你个人直接完成的，哪些依赖团队协作？"),
        ("gap", "这个岗位中你目前最需要补足的能力是什么？你准备如何降低入职后的风险？"),
        ("candidate_questions", "如果进入正式面试的反问环节，你最希望向面试官确认哪三个问题？"),
    ]
    if mode == "project_deep_dive":
        base = [base[index] for index in (1, 2, 5, 3, 4, 6, 0, 7)]
    elif mode == "behavioral":
        base = [base[index] for index in (0, 4, 2, 5, 1, 6, 3, 7)]
    elif mode == "technical":
        base = [base[index] for index in (3, 1, 2, 5, 6, 0, 4, 7)]
    return [
        {
            "category": category,
            "question": question,
            "rationale": "用于岗位定向模拟面试的基础问题。",
            "linkedRequirementIds": [],
        }
        for category, question in base[:count]
    ]


def _clean_questions(payload: dict[str, Any] | None, count: int, job: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    raw_questions = payload.get("questions") if isinstance(payload, dict) else None
    questions: list[dict[str, Any]] = []
    seen: set[str] = set()
    if isinstance(raw_questions, list):
        for raw in raw_questions:
            if not isinstance(raw, dict):
                continue
            question = str(raw.get("question") or "").strip()
            normalized = re.sub(r"\s+", "", question).lower()
            if not question or normalized in seen:
                continue
            seen.add(normalized)
            questions.append(
                {
                    "category": str(raw.get("category") or "general").strip() or "general",
                    "question": question,
                    "rationale": str(raw.get("rationale") or "").strip(),
                    "linkedRequirementIds": [
                        str(value).strip()
                        for value in (raw.get("linkedRequirementIds") or [])
                        if str(value).strip()
                    ],
                }
            )
            if len(questions) >= count:
                break
    if len(questions) < count:
        for fallback in _fallback_questions(job, mode, count):
            normalized = re.sub(r"\s+", "", fallback["question"]).lower()
            if normalized in seen:
                continue
            questions.append(fallback)
            seen.add(normalized)
            if len(questions) >= count:
                break
    return questions


def _generate_questions(
    source_key: str,
    mode: str,
    difficulty: str,
    duration_minutes: int,
    user_notes: str,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]], str]:
    item, job, context = _question_context(source_key)
    count = QUESTION_COUNTS[duration_minutes]
    historical = _historical_questions()
    system = """你是 BossFlow 的岗位定向模拟面试设计器。
只根据提供的岗位、简历、已确认能力依据和已确认面试案例出题，不得把未确认内容当作候选人事实。
目标是考察候选人是否能用真实、具体、可追问的事实证明与岗位的匹配。
输出必须是合法 JSON，不要输出 Markdown。"""
    user = f"""请为一次{MODE_LABELS[mode]}生成 {count} 个主问题。
难度：{DIFFICULTY_LABELS[difficulty]}
预计时长：{duration_minutes} 分钟
用户补充：{user_notes or "无"}

要求：
1. 问题覆盖自我介绍、核心岗位能力、项目深挖、行为或协作、事实可信度、能力缺口和反问环节；可按面试类型调整比例。
2. 不要直接泄露参考答案，不要在问题中替用户补充经历。
3. 每个问题必须能够单独回答；主问题之间不要重复。
4. 尽量避免与历史问题重复。
5. linkedRequirementIds 只能使用输入中真实存在的 requirementId，没有则为空数组。

历史问题：
{json.dumps(historical, ensure_ascii=False)}

上下文：
{context}

返回结构：
{{
  "outline": "一句话说明本次考察重点",
  "questions": [
    {{
      "category": "intro|technical|project|behavioral|credibility|gap|candidate_questions",
      "question": "问题正文",
      "rationale": "该问题考察什么",
      "linkedRequirementIds": []
    }}
  ]
}}"""
    raw = _call_llm(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=4500,
        temperature=0.35,
    )
    payload = _decode_json_object(raw)
    questions = _clean_questions(payload, count, job, mode)
    outline = str((payload or {}).get("outline") or "").strip() or f"围绕{job.get('title') or '目标岗位'}验证岗位匹配、项目深度和回答可信度。"
    return item, job, questions, outline


def _turn_from_question(question: dict[str, Any], index: int) -> dict[str, Any]:
    return {
        "turnId": f"turn-{index + 1}-{uuid.uuid4().hex[:8]}",
        "questionId": f"question-{index + 1}",
        "parentTurnId": "",
        "category": question["category"],
        "question": question["question"],
        "rationale": question.get("rationale", ""),
        "linkedRequirementIds": question.get("linkedRequirementIds", []),
        "answerDraft": "",
        "answer": "",
        "skipped": False,
        "assisted": False,
        "status": "pending",
        "createdAt": _now(),
        "answeredAt": "",
    }


def _next_pending_turn_id(session: dict[str, Any]) -> str:
    for turn in session.get("turns") or []:
        if turn.get("status") == "pending":
            return str(turn.get("turnId") or "")
    return ""


def _decorate_session(session: dict[str, Any]) -> dict[str, Any]:
    session = dict(session)
    turns = session.get("turns") or []
    session["currentTurnId"] = _next_pending_turn_id(session)
    session["answeredCount"] = sum(1 for turn in turns if turn.get("status") == "answered")
    session["skippedCount"] = sum(1 for turn in turns if turn.get("status") == "skipped")
    session["mainQuestionCount"] = sum(1 for turn in turns if not turn.get("parentTurnId"))
    session["followUpCount"] = sum(1 for turn in turns if turn.get("parentTurnId"))
    return session


def create_mock_interview_session(
    source_key: str,
    mode: str = "comprehensive",
    difficulty: str = "auto",
    duration_minutes: int = 20,
    user_notes: str = "",
) -> dict[str, Any]:
    mode = str(mode or "comprehensive").strip()
    difficulty = str(difficulty or "auto").strip()
    if mode not in VALID_MODES:
        raise HTTPException(status_code=422, detail="Unsupported mock interview mode")
    if difficulty not in VALID_DIFFICULTIES:
        raise HTTPException(status_code=422, detail="Unsupported mock interview difficulty")
    if duration_minutes not in VALID_DURATIONS:
        raise HTTPException(status_code=422, detail="Mock interview duration must be 10, 20, or 30 minutes")

    item, job, questions, outline = _generate_questions(
        source_key,
        mode,
        difficulty,
        duration_minutes,
        user_notes,
    )
    session_id = f"mock-{dt.datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    project = str(item.get("project") or source_key.partition(":")[0])
    now = _now()
    session = {
        "version": 1,
        "sessionId": session_id,
        "project": project,
        "sourceKey": source_key,
        "jobId": item.get("jobId"),
        "job": {
            "title": job.get("title", ""),
            "company": job.get("company", ""),
            "city": job.get("city", ""),
            "salary": job.get("salary", ""),
        },
        "mode": mode,
        "difficulty": difficulty,
        "durationMinutes": duration_minutes,
        "userNotes": str(user_notes or "").strip(),
        "outline": outline,
        "status": "in_progress",
        "turns": [_turn_from_question(question, index) for index, question in enumerate(questions)],
        "evaluation": None,
        "evaluationError": "",
        "storyDraftIds": [],
        "createdAt": now,
        "updatedAt": now,
        "completedAt": "",
    }
    _write_session(session)
    return {"ok": True, "session": _decorate_session(session)}


def get_mock_interview_session(session_id: str) -> dict[str, Any]:
    return {"ok": True, "session": _decorate_session(_read_session(session_id))}


def list_mock_interview_sessions() -> dict[str, Any]:
    MOCK_INTERVIEW_SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    sessions: list[dict[str, Any]] = []
    for path in MOCK_INTERVIEW_SESSIONS_DIR.glob("*.json"):
        try:
            session = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(session, dict):
            continue
        decorated = _decorate_session(session)
        evaluation = decorated.get("evaluation") if isinstance(decorated.get("evaluation"), dict) else {}
        sessions.append(
            {
                "sessionId": decorated.get("sessionId", ""),
                "sourceKey": decorated.get("sourceKey", ""),
                "job": decorated.get("job", {}),
                "mode": decorated.get("mode", ""),
                "difficulty": decorated.get("difficulty", ""),
                "durationMinutes": decorated.get("durationMinutes", 0),
                "status": decorated.get("status", ""),
                "answeredCount": decorated.get("answeredCount", 0),
                "mainQuestionCount": decorated.get("mainQuestionCount", 0),
                "followUpCount": decorated.get("followUpCount", 0),
                "overallScore": evaluation.get("overallScore"),
                "storyDraftIds": decorated.get("storyDraftIds", []),
                "createdAt": decorated.get("createdAt", ""),
                "updatedAt": decorated.get("updatedAt", ""),
                "completedAt": decorated.get("completedAt", ""),
            }
        )
    sessions.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
    return {"ok": True, "sessions": sessions}


def save_mock_interview_answer_draft(
    session_id: str,
    turn_id: str,
    answer: str,
    assisted: bool = False,
) -> dict[str, Any]:
    session = _read_session(session_id)
    if session.get("status") not in {"in_progress", "ready_for_evaluation"}:
        raise HTTPException(status_code=409, detail="This mock interview can no longer be edited")
    found = False
    for turn in session.get("turns") or []:
        if turn.get("turnId") != turn_id:
            continue
        if turn.get("status") not in {"pending", "answered"}:
            raise HTTPException(status_code=409, detail="Skipped answers cannot be edited")
        turn["answerDraft"] = str(answer or "")
        turn["assisted"] = bool(assisted)
        found = True
        break
    if not found:
        raise HTTPException(status_code=404, detail="Mock interview turn not found")
    _write_session(session)
    return {"ok": True, "session": _decorate_session(session)}


def _follow_up_question(session: dict[str, Any], turn: dict[str, Any]) -> str:
    answer = str(turn.get("answer") or "").strip()
    if len(answer) < 20:
        return "请补充一个真实、具体的例子，并说明你个人采取了哪些行动以及最终结果。"
    system = """你是一名严谨的模拟面试官。根据当前问题和候选人的回答判断是否需要追问。
追问只能用于澄清事实、个人职责、关键决策、结果或与岗位的关联，不能替候选人补充经历。
只输出合法 JSON。"""
    user = f"""岗位：{json.dumps(session.get("job") or {}, ensure_ascii=False)}
问题：{turn.get("question") or ""}
回答：{answer}

返回：
{{
  "followUpNeeded": true,
  "question": "只写一个简短追问；不需要追问时为空"
}}"""
    raw = _call_llm(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=800,
        temperature=0.2,
    )
    payload = _decode_json_object(raw) or {}
    if payload.get("followUpNeeded") is False:
        return ""
    return str(payload.get("question") or "").strip()


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_follow_up_question(session: dict[str, Any], turn: dict[str, Any]) -> Iterator[str]:
    answer = str(turn.get("answer") or "").strip()
    if len(answer) < 20:
        yield "请补充一个真实、具体的例子，并说明你个人采取了哪些行动以及最终结果。"
        return

    api_key, api_base, model = _llm_config()
    system = """你是一名严谨的模拟面试官。根据当前问题和候选人的回答判断是否需要追问。
追问只能用于澄清事实、个人职责、关键决策、结果或与岗位的关联，不能替候选人补充经历。
需要追问时只输出 QUESTION: 后跟一个简短追问；不需要追问时只输出 NO_FOLLOW_UP。"""
    user = f"""岗位：{json.dumps(session.get("job") or {}, ensure_ascii=False)}
问题：{turn.get("question") or ""}
回答：{answer}"""
    response = requests.post(
        f"{api_base.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": 300,
            "stream": True,
        },
        stream=True,
        timeout=(10, 30),
    )
    if response.status_code >= 400:
        detail = response.text[:800]
        raise RuntimeError(f"LLM stream failed: {response.status_code} {detail}")

    response.encoding = "utf-8"
    raw_text = ""
    emitted = 0
    mode = ""
    for line in response.iter_lines(decode_unicode=True):
        value = str(line or "").strip()
        if not value.startswith("data:"):
            continue
        data = value[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            payload = json.loads(data)
        except json.JSONDecodeError:
            continue
        delta = (
            ((payload.get("choices") or [{}])[0].get("delta") or {}).get("content")
            or ""
        )
        if not delta:
            continue
        raw_text += str(delta)
        normalized = raw_text.lstrip()
        if not mode:
            upper = normalized.upper()
            if upper.startswith("NO_FOLLOW_UP"):
                mode = "none"
            elif upper.startswith("QUESTION:") or upper.startswith("QUESTION："):
                mode = "question"
            elif len(normalized) >= len("NO_FOLLOW_UP"):
                mode = "question"
        if mode == "none":
            continue
        visible = normalized
        if visible.upper().startswith("QUESTION:") or visible.upper().startswith("QUESTION："):
            visible = visible[len("QUESTION:"):].lstrip()
        if len(visible) > emitted:
            yield visible[emitted:]
            emitted = len(visible)


def stream_mock_interview_answer(
    session_id: str,
    turn_id: str,
    answer: str,
    assisted: bool = False,
    skipped: bool = False,
) -> Iterator[str]:
    session = _read_session(session_id)
    if session.get("status") not in {"in_progress", "ready_for_evaluation"}:
        raise HTTPException(status_code=409, detail="This mock interview is not accepting answers")
    turns = session.get("turns") or []
    turn_index = next((index for index, turn in enumerate(turns) if turn.get("turnId") == turn_id), -1)
    if turn_index < 0:
        raise HTTPException(status_code=404, detail="Mock interview turn not found")
    turn = turns[turn_index]
    if turn.get("status") not in {"pending", "answered"}:
        raise HTTPException(status_code=409, detail="This mock interview turn has already been skipped")

    normalized_answer = str(answer or "").strip()
    if not skipped and not normalized_answer:
        raise HTTPException(status_code=422, detail="Answer cannot be empty")
    turn["answerDraft"] = normalized_answer
    turn["answer"] = normalized_answer
    turn["assisted"] = bool(assisted)
    turn["skipped"] = bool(skipped)
    turn["status"] = "skipped" if skipped else "answered"
    turn["answeredAt"] = _now()
    session["turns"] = turns
    session["status"] = "in_progress" if _next_pending_turn_id(session) else "ready_for_evaluation"
    _write_session(session)
    yield _sse("status", {"phase": "answer_saved"})

    follow_up_added = False
    streamed_question = ""
    if not skipped and not turn.get("parentTurnId"):
        existing_follow_up = any(candidate.get("parentTurnId") == turn_id for candidate in turns)
        if not existing_follow_up:
            yield _sse("status", {"phase": "analyzing"})
            try:
                for chunk in _stream_follow_up_question(session, turn):
                    streamed_question += chunk
                    yield _sse("delta", {"text": chunk})
            except Exception:  # noqa: BLE001 - answer is already safely persisted.
                yield _sse(
                    "warning",
                    {"message": "追问生成暂时失败，当前回答已保存，可以继续下一题。"},
                )
                streamed_question = ""
            question = streamed_question.strip()
            if question:
                follow_up = {
                    "turnId": f"followup-{uuid.uuid4().hex[:10]}",
                    "questionId": f"{turn.get('questionId')}-followup",
                    "parentTurnId": turn_id,
                    "category": turn.get("category", "follow_up"),
                    "question": question,
                    "rationale": "根据上一轮回答进行事实澄清或深挖。",
                    "linkedRequirementIds": turn.get("linkedRequirementIds", []),
                    "answerDraft": "",
                    "answer": "",
                    "skipped": False,
                    "assisted": False,
                    "status": "pending",
                    "createdAt": _now(),
                    "answeredAt": "",
                }
                turns.insert(turn_index + 1, follow_up)
                follow_up_added = True

    session["turns"] = turns
    session["status"] = "in_progress" if _next_pending_turn_id(session) else "ready_for_evaluation"
    _write_session(session)
    yield _sse(
        "done",
        {
            "ok": True,
            "followUpAdded": follow_up_added,
            "session": _decorate_session(session),
        },
    )


def submit_mock_interview_answer(
    session_id: str,
    turn_id: str,
    answer: str,
    assisted: bool = False,
    skipped: bool = False,
) -> dict[str, Any]:
    session = _read_session(session_id)
    if session.get("status") not in {"in_progress", "ready_for_evaluation"}:
        raise HTTPException(status_code=409, detail="This mock interview is not accepting answers")
    turns = session.get("turns") or []
    turn_index = next((index for index, turn in enumerate(turns) if turn.get("turnId") == turn_id), -1)
    if turn_index < 0:
        raise HTTPException(status_code=404, detail="Mock interview turn not found")
    turn = turns[turn_index]
    if turn.get("status") not in {"pending", "answered"}:
        raise HTTPException(status_code=409, detail="This mock interview turn has already been skipped")

    normalized_answer = str(answer or "").strip()
    if not skipped and not normalized_answer:
        raise HTTPException(status_code=422, detail="Answer cannot be empty")
    turn["answerDraft"] = normalized_answer
    turn["answer"] = normalized_answer
    turn["assisted"] = bool(assisted)
    turn["skipped"] = bool(skipped)
    turn["status"] = "skipped" if skipped else "answered"
    turn["answeredAt"] = _now()

    follow_up_added = False
    if not skipped and not turn.get("parentTurnId"):
        existing_follow_up = any(candidate.get("parentTurnId") == turn_id for candidate in turns)
        if not existing_follow_up:
            question = _follow_up_question(session, turn)
            if question:
                follow_up = {
                    "turnId": f"followup-{uuid.uuid4().hex[:10]}",
                    "questionId": f"{turn.get('questionId')}-followup",
                    "parentTurnId": turn_id,
                    "category": turn.get("category", "follow_up"),
                    "question": question,
                    "rationale": "根据上一轮回答进行事实澄清或深挖。",
                    "linkedRequirementIds": turn.get("linkedRequirementIds", []),
                    "answerDraft": "",
                    "answer": "",
                    "skipped": False,
                    "assisted": False,
                    "status": "pending",
                    "createdAt": _now(),
                    "answeredAt": "",
                }
                turns.insert(turn_index + 1, follow_up)
                follow_up_added = True

    session["turns"] = turns
    session["status"] = "in_progress" if _next_pending_turn_id(session) else "ready_for_evaluation"
    _write_session(session)
    return {
        "ok": True,
        "followUpAdded": follow_up_added,
        "session": _decorate_session(session),
    }


def _clean_dimension_scores(raw: Any) -> dict[str, int]:
    source = raw if isinstance(raw, dict) else {}
    return {key: _clean_score(source.get(key)) for key in EVALUATION_DIMENSIONS}


def _clean_story_candidate(raw: dict[str, Any], index: int, session: dict[str, Any]) -> dict[str, Any]:
    question_ids = [
        str(value).strip()
        for value in (raw.get("questionIds") or [])
        if str(value).strip()
    ]
    turn_map = {
        str(turn.get("questionId") or ""): turn
        for turn in session.get("turns") or []
    }
    raw_answers = [
        {
            "questionId": question_id,
            "question": turn_map[question_id].get("question", ""),
            "answer": turn_map[question_id].get("answer", ""),
            "assisted": bool(turn_map[question_id].get("assisted")),
        }
        for question_id in question_ids
        if question_id in turn_map
    ]
    return {
        "candidateId": str(raw.get("candidateId") or f"candidate-{index + 1}").strip(),
        "title": str(raw.get("title") or "").strip(),
        "theme": str(raw.get("theme") or "interview").strip(),
        "tags": [str(value).strip() for value in (raw.get("tags") or []) if str(value).strip()],
        "rawNote": str(raw.get("rawNote") or "").strip(),
        "format": str(raw.get("format") or "star").strip() or "star",
        "structureStatus": "needs_structuring",
        "situation": str(raw.get("situation") or "").strip(),
        "task": str(raw.get("task") or "").strip(),
        "action": str(raw.get("action") or "").strip(),
        "result": str(raw.get("result") or "").strip(),
        "reflection": str(raw.get("reflection") or "").strip(),
        "questionIds": question_ids,
        "rawAnswerSnapshot": raw_answers,
        "assisted": any(value.get("assisted") for value in raw_answers),
        "missingFields": [str(value).strip() for value in (raw.get("missingFields") or []) if str(value).strip()],
        "contradictionFlags": [str(value).strip() for value in (raw.get("contradictionFlags") or []) if str(value).strip()],
        "extractionConfidence": max(0.0, min(1.0, _safe_float(raw.get("extractionConfidence")))),
    }


def _fallback_evaluation(session: dict[str, Any], error: str = "") -> dict[str, Any]:
    answered = [turn for turn in session.get("turns") or [] if turn.get("status") == "answered"]
    assisted = [turn for turn in answered if turn.get("assisted")]
    specificity = min(100, round(sum(min(len(str(turn.get("answer") or "")), 500) for turn in answered) / max(len(answered), 1) / 5))
    completeness = round(len(answered) / max(len(session.get("turns") or []), 1) * 100)
    scores = {
        "relevance": completeness,
        "evidence": specificity,
        "specificity": specificity,
        "structure": specificity,
        "credibility": max(0, 100 - len(assisted) * 10),
        "jobFit": completeness,
    }
    return {
        "overallScore": round(sum(scores.values()) / len(scores)),
        "summary": "已保存本次回答，但模型评估未能完整生成。可以稍后重试评估。",
        "dimensionScores": scores,
        "turnFeedback": [],
        "strengths": [],
        "improvements": ["检查模型配置后重新评估本次模拟面试。"],
        "storyCandidates": [],
        "generatedAt": _now(),
        "fallback": True,
        "error": error,
    }


def _evaluate_session(session: dict[str, Any]) -> dict[str, Any]:
    answered_turns = [
        {
            "questionId": turn.get("questionId", ""),
            "parentTurnId": turn.get("parentTurnId", ""),
            "category": turn.get("category", ""),
            "question": turn.get("question", ""),
            "answer": turn.get("answer", ""),
            "assisted": bool(turn.get("assisted")),
            "linkedRequirementIds": turn.get("linkedRequirementIds", []),
        }
        for turn in session.get("turns") or []
        if turn.get("status") == "answered"
    ]
    _, _, context = _question_context(str(session.get("sourceKey") or ""))
    system = """你是 BossFlow 的模拟面试复盘助手。
评价必须只基于候选人的原始回答和提供的已确认材料。不得替候选人虚构事实、职责、指标或结果。
“当前材料中未体现”不等于候选人不会，只能指出回答证据不足。
案例候选只提炼回答中明确表达的内容；缺失字段留空并写入 missingFields。
输出必须是合法 JSON，不要输出 Markdown。"""
    user = f"""请评估以下岗位定向模拟面试。

岗位与已确认材料：
{context}

本次面试配置：
{json.dumps({key: session.get(key) for key in ("mode", "difficulty", "durationMinutes", "outline")}, ensure_ascii=False)}

问答：
{json.dumps(answered_turns, ensure_ascii=False)}

要求：
1. 六个评分维度为 0-100：relevance、evidence、specificity、structure、credibility、jobFit。
2. 每题反馈包括做得好的部分、缺失信息、可能追问和更好的回答结构。
3. 使用过提示的回答必须在评价中说明，不得与独立完成等同。
4. 只为包含真实项目、工作或行为经历的回答生成 storyCandidates。
5. storyCandidates 不得从岗位 JD 或模型建议中反向虚构用户经历。

返回结构：
{{
  "overallScore": 0,
  "summary": "总体复盘",
  "dimensionScores": {{
    "relevance": 0,
    "evidence": 0,
    "specificity": 0,
    "structure": 0,
    "credibility": 0,
    "jobFit": 0
  }},
  "turnFeedback": [
    {{
      "questionId": "question-1",
      "strengths": [],
      "missingInformation": [],
      "possibleFollowUps": [],
      "betterStructure": "建议的回答结构",
      "storyWorthy": false
    }}
  ],
  "strengths": [],
  "improvements": [],
  "storyCandidates": [
    {{
      "candidateId": "candidate-1",
      "title": "案例标题",
      "theme": "ownership|debugging|performance|collaboration|delivery",
      "tags": [],
      "rawNote": "仅记录回答中明确出现的事实和待确认问题",
      "format": "star",
      "situation": "",
      "task": "",
      "action": "",
      "result": "",
      "reflection": "",
      "questionIds": [],
      "missingFields": [],
      "contradictionFlags": [],
      "extractionConfidence": 0.0
    }}
  ]
}}"""
    raw = _call_llm(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=7000,
        temperature=0.2,
    )
    payload = _decode_json_object(raw)
    if not payload:
        return _fallback_evaluation(session, "Model output did not contain valid JSON")
    story_candidates = [
        _clean_story_candidate(candidate, index, session)
        for index, candidate in enumerate(payload.get("storyCandidates") or [])
        if isinstance(candidate, dict) and str(candidate.get("title") or "").strip()
    ]
    return {
        "overallScore": _clean_score(payload.get("overallScore")),
        "summary": str(payload.get("summary") or "").strip(),
        "dimensionScores": _clean_dimension_scores(payload.get("dimensionScores")),
        "turnFeedback": [
            feedback
            for feedback in (payload.get("turnFeedback") or [])
            if isinstance(feedback, dict)
        ],
        "strengths": [str(value).strip() for value in (payload.get("strengths") or []) if str(value).strip()],
        "improvements": [str(value).strip() for value in (payload.get("improvements") or []) if str(value).strip()],
        "storyCandidates": story_candidates,
        "generatedAt": _now(),
        "fallback": False,
        "error": "",
    }


def _run_evaluation(project: str, session_id: str) -> None:
    try:
        with project_workspace(project):
            session = _read_session(session_id)
            try:
                evaluation = _evaluate_session(session)
                session["evaluation"] = evaluation
                session["evaluationError"] = evaluation.get("error", "")
                session["status"] = "evaluated"
            except Exception as exc:
                session["evaluation"] = _fallback_evaluation(session, str(exc))
                session["evaluationError"] = str(exc)
                session["status"] = "evaluation_failed"
            _write_session(session)
    finally:
        with _evaluation_lock:
            _evaluating_sessions.discard(session_id)


def complete_mock_interview_session(session_id: str) -> dict[str, Any]:
    session = _read_session(session_id)
    if not any(turn.get("status") == "answered" for turn in session.get("turns") or []):
        raise HTTPException(status_code=422, detail="Answer at least one question before completing the mock interview")
    if session.get("status") == "evaluating":
        return {"ok": True, "session": _decorate_session(session)}
    if session.get("status") == "evaluated":
        return {"ok": True, "session": _decorate_session(session)}

    for turn in session.get("turns") or []:
        if turn.get("status") == "pending":
            turn["status"] = "skipped"
            turn["skipped"] = True
            turn["answeredAt"] = _now()
    session["status"] = "evaluating"
    session["completedAt"] = _now()
    session["evaluationError"] = ""
    _write_session(session)

    session_id = str(session["sessionId"])
    project = str(session.get("project") or "")
    with _evaluation_lock:
        if session_id not in _evaluating_sessions:
            _evaluating_sessions.add(session_id)
            threading.Thread(
                target=_run_evaluation,
                args=(project, session_id),
                daemon=True,
                name=f"mock-interview-evaluation-{session_id[-8:]}",
            ).start()
    return {"ok": True, "session": _decorate_session(session)}


def stage_mock_interview_story_drafts(session_id: str, candidate_ids: list[str]) -> dict[str, Any]:
    session = _read_session(session_id)
    evaluation = session.get("evaluation") if isinstance(session.get("evaluation"), dict) else {}
    candidates = evaluation.get("storyCandidates") if isinstance(evaluation, dict) else []
    requested = {str(value).strip() for value in candidate_ids if str(value).strip()}
    selected = [
        candidate
        for candidate in candidates or []
        if isinstance(candidate, dict) and (not requested or candidate.get("candidateId") in requested)
    ]
    if not selected:
        raise HTTPException(status_code=422, detail="No mock interview story candidates were selected")

    draft_store = read_story_drafts()
    existing = list(draft_store.get("drafts") or [])
    existing_ids = {str(draft.get("draftId") or "") for draft in existing}
    now = _now()
    added: list[dict[str, Any]] = []
    for candidate in selected:
        draft_id = f"mock-story-{session_id}-{candidate.get('candidateId')}"
        if draft_id in existing_ids:
            continue
        draft = {
            "title": candidate.get("title", ""),
            "theme": candidate.get("theme", ""),
            "source": f"模拟面试 {session_id}",
            "tags": candidate.get("tags", []),
            "rawNote": candidate.get("rawNote", ""),
            "format": candidate.get("format", "star"),
            "structureStatus": candidate.get("structureStatus", "needs_structuring"),
            "situation": candidate.get("situation", ""),
            "task": candidate.get("task", ""),
            "action": candidate.get("action", ""),
            "result": candidate.get("result", ""),
            "reflection": candidate.get("reflection", ""),
            "draftId": draft_id,
            "status": "needs_confirmation",
            "sourceKey": session.get("sourceKey", ""),
            "sourceLabel": f"模拟面试 · {session.get('job', {}).get('company', '')} · {session.get('job', {}).get('title', '')}",
            "prepPath": "",
            "createdAt": now,
            "updatedAt": now,
            "promotedAt": "",
            "promotedStoryId": "",
            "sourceType": "mock_interview",
            "sessionId": session_id,
            "questionIds": candidate.get("questionIds", []),
            "rawAnswerSnapshot": candidate.get("rawAnswerSnapshot", []),
            "assisted": bool(candidate.get("assisted")),
            "missingFields": candidate.get("missingFields", []),
            "contradictionFlags": candidate.get("contradictionFlags", []),
            "linkedRequirementIds": sorted(
                {
                    str(requirement_id)
                    for turn in session.get("turns") or []
                    if turn.get("questionId") in set(candidate.get("questionIds") or [])
                    for requirement_id in turn.get("linkedRequirementIds") or []
                    if str(requirement_id)
                }
            ),
            "extractionConfidence": candidate.get("extractionConfidence", 0.0),
        }
        existing.append(draft)
        existing_ids.add(draft_id)
        added.append(draft)
    saved = save_story_drafts(existing)
    session["storyDraftIds"] = sorted(
        set(session.get("storyDraftIds") or []) | {draft["draftId"] for draft in added}
    )
    _write_session(session)
    return {
        "ok": True,
        "added": len(added),
        "drafts": added,
        "storyDrafts": saved,
        "session": _decorate_session(session),
    }
