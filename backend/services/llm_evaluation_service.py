import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any

import requests
from fastapi import HTTPException

from backend.services.capability_service import merge_requirement_assessments, normalize_proficiency
from backend.services.evidence_service import read_capability_catalog, sync_requirement_assessment
from backend.services.job_service import get_jobs_by_ids
from backend.services.greeting_service import sync_greeting_draft_from_report
from backend.services.pipeline_service import find_pipeline_item, read_pipeline, update_pipeline_item_metadata
from backend.services.project_service import resolve_project
from backend.storage.paths import BASE_DIR
from backend.services.workspace_service import workspace_path

CV_PATH = workspace_path("cv.md")
PROFILE_PATH = workspace_path("profile.yml")
REPORTS_DIR = workspace_path("reports/jobs")
EVALUATION_PROFILE_VERSION = 2


def _read_text(path: Path, limit: int | None = None) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8").strip()
    return text[:limit].rstrip() if limit and len(text) > limit else text


def _env_file_values() -> dict[str, str]:
    env_path = BASE_DIR / ".env"
    values: dict[str, str] = {}
    if not env_path.exists():
        return values
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _env(name: str, fallback: str = "") -> str:
    return os.getenv(name) or _env_file_values().get(name, fallback)


def _llm_config() -> tuple[str, str, str]:
    api_key = (
        _env("BOSSSPIDER_LLM_API_KEY")
        or _env("DEEPSEEK_API_KEY")
        or _env("OPENAI_API_KEY")
    )
    api_base = (
        _env("BOSSSPIDER_LLM_API_BASE")
        or _env("DEEPSEEK_API_BASE")
        or _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
    )
    model = _env("BOSSSPIDER_LLM_MODEL") or _env("DEEPSEEK_MODEL", "deepseek-v4-flash")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"Missing LLM API key. Set BOSSSPIDER_LLM_API_KEY or DEEPSEEK_API_KEY in environment or {BASE_DIR / '.env'}.",
        )
    return api_key, api_base, model


def _slug(value: str, fallback: str = "job") -> str:
    value = (value or fallback).lower()
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff-]+", "", value)
    return value.strip("-")[:48] or fallback


def _next_report_id() -> str:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    nums = []
    for path in REPORTS_DIR.glob("*.md"):
        prefix = path.name[:3]
        if prefix.isdigit():
            nums.append(int(prefix))
    return f"{(max(nums) + 1) if nums else 1:03d}"


def _load_pipeline_job(source_key: str) -> tuple[dict[str, Any], dict[str, Any]]:
    item = find_pipeline_item(source_key)
    if not item:
        raise HTTPException(status_code=404, detail=f"Pipeline item not found: {source_key}")
    project = item.get("project")
    job_id = item.get("jobId")
    if not project or not job_id:
        raise HTTPException(status_code=400, detail="Pipeline item is missing project/jobId metadata")
    project_dir = resolve_project(project)
    jobs = get_jobs_by_ids(project_dir, [int(job_id)])
    if not jobs:
        raise HTTPException(status_code=404, detail=f"Job not found: {project}#{job_id}")
    return item, jobs[0]


def _job_text(job: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"Company: {job.get('company') or '-'}",
            f"Role: {job.get('title') or '-'}",
            f"City: {job.get('city') or '-'}",
            f"Salary: {job.get('salary') or '-'}",
            f"Average salary K: {job.get('avg') or 0}",
            f"Experience/Education: {job.get('exp') or '-'} / {job.get('edu') or '-'}",
            f"Categories: {', '.join(job.get('cats') or []) or job.get('tier') or '-'}",
            f"URL: {job.get('url') or '-'}",
            "",
            "JD:",
            (job.get("desc") or "")[:9000],
        ]
    )


def _prompt(job: dict[str, Any], item: dict[str, Any]) -> list[dict[str, str]]:
    cv_text = _read_text(CV_PATH, 12000)
    profile_text = _read_text(PROFILE_PATH, 6000)
    pre_score = item.get("score")
    capability_catalog = read_capability_catalog()
    capability_catalog_text = json.dumps(capability_catalog, ensure_ascii=False, separators=(",", ":"))
    system = """你是 BossSpider 的求职岗位精评估助手。

你的任务是根据 Boss 直聘岗位 JD、候选人 cv.md、可选 profile.yml，生成一份可落地的岗位精评估报告。

硬性规则：
- 只能使用 JD、cv.md、profile.yml 中存在的信息；不要编造经历、项目、指标、公司背景。
- 如果 CV 证据不足，直接标记为缺口，不要替候选人补事实。
- Boss 直聘场景下，下一步通常是“打招呼/沟通”，不是邮件投递。
- 只生成建议和草稿，不要声称已经发送、投递或联系。
- “当前材料中未找到证据”不等于候选人不具备能力，禁止据此断言候选人不会或缺乏某项能力。
- 输出 Markdown。
- 末尾必须包含机器可读 summary block。
- summary block 后必须包含机器可读 requirement assessment block。
"""
    user = f"""请精评估以下 Boss 直聘岗位。

请按这些章节输出：

# 岗位精评估

## A. 岗位摘要
提炼公司、岗位、城市、薪资、岗位链接、核心职责、硬性要求。

## B. 简历匹配证据
用表格列出 JD 要求、CV 中可对应的证据、证据强度。证据必须来自 cv.md。

## C. 缺口和风险
列出能力缺口、年限/行业/技术栈风险、JD 本身不清晰或可疑之处。

## D. 是否值得继续
给出 1.0-5.0 分，并解释为什么。参考但不要盲从本地粗筛分数：{pre_score or "未粗筛"}。

## E. 定制简历建议
只给建议，不直接改写简历。说明哪些 bullet 应该重排或强化，哪些内容需要用户确认事实。

## F. Boss 打招呼草稿
严格输出 2 条不同侧重点的短草稿，每条不超过 80 字，必须基于真实匹配点，不得虚构经历。
固定使用以下结构，两个标题和两条消息都必须存在；消息正文不要再添加编号、标签或备选内容：
### 话术 1（突出最强项目或业务匹配点）
> 一条可直接使用的消息
### 话术 2（突出技能组合或岗位兴趣）
> 一条可直接使用的消息

## G. 下一步动作
给出明确建议：跳过 / 先收藏 / 生成定制简历 / 打招呼前人工确认 / 准备面试故事。

末尾必须输出：
---BOSSSPIDER_LLM_SUMMARY---
SCORE: <1.0-5.0>
FIT_LEVEL: <High Fit | Worth Reviewing | Weak Match | Skip Unless Strategic>
RECOMMENDATION: <一句话建议>
GREETING_READY: <yes|no>
---END_SUMMARY---

紧接着 summary block 输出以下合法 JSON，不要放进 Markdown 代码块：
---BOSSFLOW_REQUIREMENT_ASSESSMENT---
[
  {{
    "canonicalKey": "纯能力的稳定键，不含熟练度、年限、岗位名称",
    "capabilityName": "原子能力名称，例如 C++、RAG、向量数据库",
    "label": "忠实保留该岗位的完整要求表达",
    "category": "skill|experience|behavior|education|location|preference|other",
    "verificationMode": "document_fact|experience_fact|preference|behavior_example|manual_review",
    "importance": "required|preferred|context",
    "requiredProficiency": "unspecified|awareness|familiar|working|proficient|expert",
    "requiredProficiencySource": "JD 中表示熟练度的原词，如了解、熟悉、掌握、熟练、精通；未说明则为空",
    "proficiencyApplicable": true,
    "requirementGroupId": "同一个任一满足组使用相同稳定标识；非任一满足组留空",
    "requirementGroupMode": "all_of|any_of",
    "requirementGroupLabel": "向用户解释任一满足关系的完整岗位要求；非任一满足组留空",
    "minimumSatisfied": 1,
    "jdQuote": "JD 中的对应短句",
    "candidateEvidenceRefs": [
      {{"sourceType": "cv", "quote": "cv.md 中的对应原文或短摘要", "locator": "简历章节或项目名"}}
    ],
    "coverageStatus": "supported|partial|not_found|unknown",
    "rationale": "只说明当前输入材料是否提供了相关证据",
    "confidence": 0.0
  }}
]
---END_REQUIREMENT_ASSESSMENT---

Requirement assessment 规则：
- 提取 5-16 条对岗位决策最重要的要求；只合并“同一能力的重复表达”，不能合并相关但不同的能力。
- 每个数组元素只能表达一个原子能力。RAG、向量数据库、Prompt Engineering、Tool Calling、LangChain、LangGraph、C++、Java 等必须分别输出。
- 如果 JD 使用 “C++/Java”“RAG 与向量数据库”等并列或任选表达，仍拆成多个元素；每个元素的 label 和 jdQuote 可以保留同一段 JD 原文。
- 必须区分“全部都要”和“满足任一即可”。“以及/并且/同时掌握”为 all_of；“或/任一/至少一门/任选其一/one of/any of”为 any_of。
- any_of 的每个原子能力分别输出，但 requirementGroupMode 必须为 any_of，并共享 requirementGroupId、requirementGroupLabel 和 minimumSatisfied。其他要求使用 all_of 且组字段留空。
- capabilityName 只写能力名词，不包含“熟悉、精通、经验、能力、加分项、岗位名称”等修饰语。
- label 忠实保留岗位要求的精确表达；能力身份以 canonicalKey + capabilityName 为准，岗位措辞不能用作新的能力身份。
- requiredProficiency 与能力身份分离：了解=awareness，熟悉=familiar，掌握=working，熟练=proficient，精通=expert；JD 未说明则为 unspecified。
- proficiencyApplicable 仅在该要求确实比较“掌握程度”时为 true。学历、年限、行业经历、行为能力，以及只判断“是否拥有/是否做过”的要求必须为 false；未出现熟练度要求的技能也应为 false。
- canonicalKey 应简短、稳定。先检索下方已有能力目录，语义完全相同时必须复用；只是相关、上下位或包含关系时不得强行复用。
- 不允许使用 programming-language-proficiency、rag-vector-db-experience、rag-prompt-tool-calling 等“多个技能组成的 key”。
- 学历、专业、证书等可由简历原文直接核验的结构化事实使用 document_fact。
- 技能和项目经历使用 experience_fact，行为举例使用 behavior_example，地点和求职偏好使用 preference。
- candidateEvidenceRefs 只能引用 cv.md 中真实存在的内容；没有证据时必须是空数组。
- supported 表示当前材料中存在直接证据，partial 表示只有相近或不完整证据。
- 当前材料中未找到证据时只能输出 not_found，绝不能输出 user_confirmed_absent。
- 不得输出 done、adjacent、not_done、unsure；这些只能由用户交互产生。
- confidence 必须是 0 到 1 之间的数字。

已有能力目录（用于检索增强归一化；只能复用语义相同的原子能力）：
```json
{capability_catalog_text}
```

候选人 cv.md：
```markdown
{cv_text or "cv.md not found"}
```

profile.yml：
```yaml
{profile_text or "profile.yml not found"}
```

岗位信息：
```text
{_job_text(job)}
```
"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _call_llm(messages: list[dict[str, str]], *, max_tokens: int = 5000, temperature: float = 0.25) -> str:
    api_key, api_base, model = _llm_config()
    url = f"{api_base.rstrip('/')}/chat/completions"
    response = requests.post(
        url,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens},
        timeout=120,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"LLM API failed ({response.status_code}): {response.text[:500]}")
    data = response.json()
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="LLM API returned an unexpected response shape") from exc


def _parse_summary(text: str) -> dict[str, Any]:
    summary = {
        "score": None,
        "fitLevel": "",
        "recommendation": "",
        "greetingReady": "",
    }
    match = re.search(r"---BOSSSPIDER_LLM_SUMMARY---\s*([\s\S]*?)---END_SUMMARY---", text)
    if not match:
        return summary
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().upper()
        value = value.strip()
        if key == "SCORE":
            try:
                summary["score"] = round(float(value), 1)
            except ValueError:
                pass
        elif key == "FIT_LEVEL":
            summary["fitLevel"] = value
        elif key == "RECOMMENDATION":
            summary["recommendation"] = value
        elif key == "GREETING_READY":
            summary["greetingReady"] = value
    return summary


def _canonical_key(value: str, fallback: str) -> str:
    key = re.sub(r"\s+", "-", (value or fallback).strip().lower())
    key = re.sub(r"[^a-z0-9\u4e00-\u9fff._-]+", "-", key)
    return re.sub(r"-+", "-", key).strip("-._")[:80]


def _decode_requirement_payload(raw: str) -> list[Any] | None:
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s*```$", "", raw)
    candidates = [raw]
    repaired = re.sub(r",\s*([}\]])", r"\1", raw)
    if repaired != raw:
        candidates.append(repaired)
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payload = payload.get("requirements")
        if isinstance(payload, list):
            return payload
    return None


def _requirement_payload(text: str) -> list[Any] | None:
    match = re.search(
        r"---BOSSFLOW_REQUIREMENT_ASSESSMENT---\s*([\s\S]*?)---END_REQUIREMENT_ASSESSMENT---",
        text,
    )
    if match:
        payload = _decode_requirement_payload(match.group(1))
        if payload is not None:
            return payload

    # Some OpenAI-compatible models wrap the requested JSON in a fenced block
    # or omit our marker lines. Accept only blocks that look like requirement
    # assessments so unrelated snippets in the narrative report are ignored.
    for fenced in re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
        if '"canonicalKey"' not in fenced:
            continue
        payload = _decode_requirement_payload(fenced)
        if payload is not None:
            return payload

    # If the response was truncated after the JSON but before the end marker,
    # JSONDecoder can still recover a complete leading array/object.
    decoder = json.JSONDecoder()
    starts: list[int] = []
    for key_match in re.finditer(r'"canonicalKey"\s*:', text):
        for delimiter in ("[", "{"):
            start = text.rfind(delimiter, 0, key_match.start())
            if start >= 0 and start not in starts:
                starts.append(start)
    for start in starts:
        fragment = text[start:].lstrip()
        try:
            decoded, _ = decoder.raw_decode(fragment)
        except json.JSONDecodeError:
            # A response can be cut off after a complete object but before
            # the closing array bracket. Recover those complete objects so a
            # provider's output limit does not turn an otherwise usable
            # assessment into a hard failure.
            if not fragment.startswith("["):
                continue
            remainder = fragment[1:].lstrip()
            recovered: list[Any] = []
            while remainder and not remainder.startswith("]"):
                try:
                    item, consumed = decoder.raw_decode(remainder)
                except json.JSONDecodeError:
                    break
                if isinstance(item, dict) and item.get("canonicalKey"):
                    recovered.append(item)
                remainder = remainder[consumed:].lstrip()
                if remainder.startswith(","):
                    remainder = remainder[1:].lstrip()
                elif not remainder.startswith("]"):
                    break
            if recovered:
                return recovered
            continue
        if isinstance(decoded, dict):
            decoded = decoded.get("requirements")
        if isinstance(decoded, list):
            return decoded
    return None


def _parse_requirement_assessment(text: str) -> list[dict[str, Any]]:
    payload = _requirement_payload(text)
    if not isinstance(payload, list):
        return []

    allowed_categories = {"skill", "experience", "behavior", "education", "location", "preference", "other"}
    allowed_importance = {"required", "preferred", "context"}
    allowed_statuses = {"supported", "partial", "not_found", "unknown"}
    allowed_verification_modes = {"document_fact", "experience_fact", "preference", "behavior_example", "manual_review"}
    requirements: list[dict[str, Any]] = []
    for raw_item in payload:
        if not isinstance(raw_item, dict):
            continue
        label = str(raw_item.get("label") or "").strip()
        canonical_key = _canonical_key(str(raw_item.get("canonicalKey") or ""), label)
        if not label or not canonical_key:
            continue
        category = str(raw_item.get("category") or "other").strip().lower()
        importance = str(raw_item.get("importance") or "context").strip().lower()
        coverage_status = str(raw_item.get("coverageStatus") or "unknown").strip().lower()
        if category not in allowed_categories:
            category = "other"
        if importance not in allowed_importance:
            importance = "context"
        if coverage_status not in allowed_statuses:
            coverage_status = "unknown"
        verification_mode = str(raw_item.get("verificationMode") or "").strip().lower()
        if verification_mode not in allowed_verification_modes:
            if category == "education":
                verification_mode = "document_fact"
            elif category in {"location", "preference"}:
                verification_mode = "preference"
            elif category == "behavior":
                verification_mode = "behavior_example"
            elif category in {"skill", "experience"}:
                verification_mode = "experience_fact"
            else:
                verification_mode = "manual_review"
        try:
            confidence = max(0.0, min(1.0, float(raw_item.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0

        refs = []
        for raw_ref in raw_item.get("candidateEvidenceRefs") or []:
            if not isinstance(raw_ref, dict):
                continue
            quote = str(raw_ref.get("quote") or "").strip()
            if not quote:
                continue
            refs.append(
                {
                    "sourceType": str(raw_ref.get("sourceType") or "cv").strip() or "cv",
                    "quote": quote,
                    "locator": str(raw_ref.get("locator") or "").strip(),
                }
            )
        if coverage_status == "not_found":
            refs = []
        elif coverage_status in {"supported", "partial"} and not refs:
            coverage_status = "not_found"
        requirements.append(
            {
                "canonicalKey": canonical_key,
                "capabilityName": str(raw_item.get("capabilityName") or "").strip(),
                "label": label,
                "category": category,
                "verificationMode": verification_mode,
                "importance": importance,
                "requiredProficiency": normalize_proficiency(
                    raw_item.get("requiredProficiency"),
                    f"{label} {raw_item.get('jdQuote') or ''}",
                ),
                "requiredProficiencySource": str(raw_item.get("requiredProficiencySource") or "").strip(),
                "proficiencyApplicable": raw_item.get("proficiencyApplicable"),
                "requirementGroupId": str(raw_item.get("requirementGroupId") or "").strip(),
                "requirementGroupMode": (
                    "any_of"
                    if str(raw_item.get("requirementGroupMode") or "").strip().lower() == "any_of"
                    else "all_of"
                ),
                "requirementGroupLabel": str(raw_item.get("requirementGroupLabel") or "").strip(),
                "minimumSatisfied": raw_item.get("minimumSatisfied") or 1,
                "jdQuote": str(raw_item.get("jdQuote") or "").strip(),
                "candidateEvidenceRefs": refs,
                "coverageStatus": coverage_status,
                "rationale": str(raw_item.get("rationale") or "").strip(),
                "confidence": confidence,
            }
        )
    return merge_requirement_assessments(requirements)


def _repair_requirement_messages(
    job: dict[str, Any],
    item: dict[str, Any],
    previous_response: str,
) -> list[dict[str, str]]:
    return [
        *_prompt(job, item),
        {"role": "assistant", "content": previous_response[-18000:]},
        {
            "role": "user",
            "content": """上一次回答缺少可解析的 requirement assessment，或 JSON 格式不完整。
现在不要重写 Markdown 报告，只修复结构化要求。
严格输出以下三部分，不要添加解释或 Markdown 代码围栏：
---BOSSFLOW_REQUIREMENT_ASSESSMENT---
<合法 JSON 数组；字段与上一条指令完全一致>
---END_REQUIREMENT_ASSESSMENT---
必须输出 5-16 项重要要求，并继续遵守原子能力、熟练度适用性和 any_of 分组规则。""",
        },
    ]


def _structured_requirement_messages(job: dict[str, Any]) -> list[dict[str, str]]:
    """Ask for the machine-readable assessment without regenerating the report."""
    cv_text = _read_text(CV_PATH, 12000)
    profile_text = _read_text(PROFILE_PATH, 6000)
    system = """你是 BossSpider 的岗位要求结构化提取器。
只根据岗位 JD、cv.md 和 profile.yml 输出机器可读 requirement assessment。
不要输出 Markdown、解释、代码围栏或任何 JSON 之外的内容。
必须输出 5-16 条最重要的原子要求；同一能力可以合并，相关但不同的能力不能合并。
candidateEvidenceRefs 只能引用 cv.md 中真实存在的内容；没有证据时必须为空数组并使用 not_found。
coverageStatus 只能使用 supported、partial、not_found、unknown。
输出格式必须是：
---BOSSFLOW_REQUIREMENT_ASSESSMENT---
[合法 JSON 数组]
---END_REQUIREMENT_ASSESSMENT---
每项至少包含 canonicalKey、capabilityName、label、category、verificationMode、importance、
requiredProficiency、proficiencyApplicable、jdQuote、candidateEvidenceRefs、coverageStatus、rationale、confidence。
category 使用 skill|experience|behavior|education|location|preference|other；
verificationMode 使用 document_fact|experience_fact|preference|behavior_example|manual_review；
importance 使用 required|preferred|context；confidence 是 0 到 1 的数字。"""
    user = f"""岗位信息：
```text
{_job_text(job)}
```

候选人 cv.md：
```markdown
{cv_text or "cv.md not found"}
```

profile.yml：
```yaml
{profile_text or "profile.yml not found"}
```"""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _save_failed_llm_output(
    job: dict[str, Any],
    initial_response: str,
    repair_response: str,
    structured_response: str = "",
) -> Path:
    failed_dir = REPORTS_DIR / "_failed-evaluations"
    failed_dir.mkdir(parents=True, exist_ok=True)
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{timestamp}-{_slug(job.get('company'))}-{_slug(job.get('title'))}.md"
    path = failed_dir / filename
    path.write_text(
        "\n".join(
            [
                "# Initial LLM response",
                "",
                initial_response,
                "",
                "# Automatic repair response",
                "",
                repair_response,
                "",
                "# Dedicated structured extraction response",
                "",
                structured_response,
                "",
            ]
        ),
        encoding="utf-8",
    )
    return path


def _strip_requirement_assessment_block(text: str) -> str:
    return re.sub(
        r"\n?---BOSSFLOW_REQUIREMENT_ASSESSMENT---\s*[\s\S]*?(?:---END_REQUIREMENT_ASSESSMENT---\s*|$)",
        "\n",
        text,
    ).rstrip() + "\n"


def llm_evaluate_pipeline_item(source_key: str) -> dict[str, Any]:
    item, job = _load_pipeline_job(source_key)
    report_text = _call_llm(_prompt(job, item))
    summary = _parse_summary(report_text)
    requirement_assessment = _parse_requirement_assessment(report_text)
    if not requirement_assessment:
        repair_text = _call_llm(
            _repair_requirement_messages(job, item, report_text),
            max_tokens=5000,
            temperature=0.05,
        )
        requirement_assessment = _parse_requirement_assessment(repair_text)
        if not requirement_assessment:
            structured_text = _call_llm(
                _structured_requirement_messages(job),
                max_tokens=6000,
                temperature=0.05,
            )
            requirement_assessment = _parse_requirement_assessment(structured_text)
            if not requirement_assessment:
                failed_path = _save_failed_llm_output(job, report_text, repair_text, structured_text)
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "LLM returned an invalid structured requirement assessment after automatic repair and "
                        "dedicated extraction fallback. "
                        f"Raw responses were saved to {failed_path}"
                    ),
                )
    report_id = _next_report_id()
    filename = f"{report_id}-{_slug(job.get('company'))}-{_slug(job.get('title'))}-{dt.datetime.now().strftime('%Y-%m-%d')}.md"
    report_path = REPORTS_DIR / filename
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(_strip_requirement_assessment_block(report_text), encoding="utf-8")
    evidence_sync = sync_requirement_assessment(source_key, requirement_assessment)
    evidence_summary = evidence_sync["summary"]
    json_path = report_path.with_suffix(".json")
    json_path.write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                "evaluationProfileVersion": EVALUATION_PROFILE_VERSION,
                "reportId": report_id,
                "sourceKey": source_key,
                "generatedAt": dt.datetime.now().isoformat(),
                "job": job,
                "summary": summary,
                "requirementAssessment": requirement_assessment,
                "evidenceSummary": evidence_summary,
                "evidenceCoverages": evidence_sync["coverages"],
                "reportPath": str(report_path),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    update_pipeline_item_metadata(
        source_key,
        {
            "llmScore": summary["score"],
            "llmFitLevel": summary["fitLevel"],
            "llmRecommendation": summary["recommendation"],
            "greetingReady": summary["greetingReady"],
            "reportPath": str(report_path),
            "reportId": report_id,
            "evaluationProfileVersion": EVALUATION_PROFILE_VERSION,
            "evaluatedAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "decisionStatus": "needs_review",
            **evidence_summary,
        },
    )
    sync_greeting_draft_from_report(source_key)

    return {
        "ok": True,
        "reportId": report_id,
        "reportPath": str(report_path),
        "jsonPath": str(json_path),
        "summary": summary,
        "requirementAssessment": requirement_assessment,
        "evidenceSummary": evidence_summary,
        "pipeline": read_pipeline(),
    }
