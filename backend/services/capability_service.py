from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any


PROFICIENCY_LEVELS = (
    "unspecified",
    "awareness",
    "familiar",
    "working",
    "proficient",
    "expert",
)
PROFICIENCY_RANK = {level: index for index, level in enumerate(PROFICIENCY_LEVELS)}


@dataclass(frozen=True)
class CapabilityDefinition:
    key: str
    label: str
    aliases: tuple[str, ...] = ()
    patterns: tuple[str, ...] = ()


CAPABILITY_DEFINITIONS = (
    CapabilityDefinition("rag-systems", "RAG", ("rag-experience", "rag-system-development"), (r"(?i)(?<![a-z])rag(?![a-z])",)),
    CapabilityDefinition("vector-database", "向量数据库", ("vector-database-familiarity",), (r"向量数据库", r"(?i)vector[-_\s]*(?:database|db)")),
    CapabilityDefinition("graph-database", "图数据库", (), (r"图数据库", r"(?i)graph\s+database")),
    CapabilityDefinition("prompt-engineering", "Prompt Engineering", (), (r"(?i)prompt(?:[-_\s]*engineering)?", r"提示词工程")),
    CapabilityDefinition(
        "tool-calling",
        "Tool Calling",
        ("tool-calling-function-calling", "function-calling"),
        (r"(?i)(?:tool|function)\s*calling", r"工具调用", r"函数调用"),
    ),
    CapabilityDefinition(
        "ai-agent-development",
        "AI Agent 开发",
        (
            "ai-agent-experience",
            "llm-agent-experience",
            "agent-development-experience",
            "agent-dev-experience",
            "external-experience-agent-application",
            "agent-framework",
            "agent-architecture-design",
            "agentic-architecture-knowledge",
            "engineering-delivery",
        ),
        (
            r"(?i)(?:ai[-_\s]*)?agent[-_\s]*(?:application|development|architecture|mechanism|experience|system)",
            r"(?i)(?:ai\s*)?agent.{0,8}(?:应用|开发|研发|构建|架构|机制|系统|工程|实践|经验|能力)",
            r"(?<!多)智能体",
        ),
    ),
    CapabilityDefinition("langchain-framework", "LangChain", ("langchain-experience",), (r"(?i)langchain",)),
    CapabilityDefinition("langgraph-framework", "LangGraph", ("langgraph-experience",), (r"(?i)langgraph",)),
    CapabilityDefinition("python-programming", "Python", ("python-proficiency", "python-language", "python-skill"), (r"(?i)\bpython\b",)),
    CapabilityDefinition("java-programming", "Java", ("java-language",), (r"(?i)(?<!script)\bjava\b(?!script)",)),
    CapabilityDefinition("cpp-programming", "C++", ("cpp-language", "c-plus-plus"), (r"(?i)(?:c\+\+|\bcpp\b)",)),
    CapabilityDefinition("c-programming", "C", ("c-language",), (r"(?i)(?<![a-z+#])\bc\b(?![a-z+#])",)),
    CapabilityDefinition("go-programming", "Go", ("go-language",), (r"(?i)(?<![a-z])golang(?![a-z])", r"(?i)(?<![a-z])go(?![a-z])")),
    CapabilityDefinition("javascript-programming", "JavaScript", ("javascript-language",), (r"(?i)\bjavascript\b", r"(?i)\bjs\b")),
    CapabilityDefinition("swift-programming", "Swift", (), (r"(?i)\bswift\b",)),
    CapabilityDefinition("kotlin-programming", "Kotlin", (), (r"(?i)\bkotlin\b",)),
    CapabilityDefinition("linux-development", "Linux", (), (r"(?i)\blinux\b",)),
    CapabilityDefinition("api-design", "API 设计", ("backend-api-design",), (r"(?i)\bapi\b.{0,8}(?:设计|design)",)),
    CapabilityDefinition("async-programming", "异步编程", (), (r"异步编程", r"(?i)asynchronous\s+programming")),
    CapabilityDefinition("multithreaded-programming", "多线程编程", (), (r"多线程", r"(?i)multi-?thread")),
    CapabilityDefinition("memory-management", "内存管理", (), (r"内存管理", r"(?i)memory\s+management")),
    CapabilityDefinition("performance-optimization", "性能优化", ("linux-performance-analysis",), (r"性能.{0,6}(?:分析|优化)", r"高性能代码优化")),
    CapabilityDefinition("database-systems", "数据库", (), (r"(?<!向量)(?<!图)数据库",)),
    CapabilityDefinition("virtualization", "虚拟化", (), (r"虚拟化", r"(?i)virtualization")),
    CapabilityDefinition("network-programming", "网络编程", (), (r"网络编程", r"(?i)network\s+programming")),
    CapabilityDefinition("high-concurrency", "高并发系统", (), (r"高并发",)),
    CapabilityDefinition("high-availability", "高可用系统", ("high-performance-high-availability",), (r"高可用",)),
    CapabilityDefinition("search-systems", "搜索/检索系统", ("search-engine-experience", "search-recommendation-experience"), (r"检索引擎", r"搜索系统", r"搜推系统")),
    CapabilityDefinition("multi-agent-systems", "多智能体系统", ("multi-agent-experience", "multi-agent-architecture"), (r"多智能体", r"(?i)multi-?agent")),
    CapabilityDefinition(
        "agent-memory-context-management",
        "Agent 记忆与上下文管理",
        ("agent-memory-context", "memory-context-management"),
        (r"(?i)(?:memory|记忆).{0,8}(?:context|上下文)", r"上下文管理"),
    ),
    CapabilityDefinition("machine-learning", "机器学习", (), (r"机器学习", r"(?i)machine\s+learning")),
    CapabilityDefinition("deep-learning", "深度学习", (), (r"深度学习", r"(?i)deep\s+learning")),
    # Demand planning and supply-chain capability pack.  These definitions are
    # intentionally domain concepts rather than JD phrases, so multiple roles
    # can reuse the same capability identity while retaining their original
    # wording on each requirement.
    CapabilityDefinition(
        "data-analysis-insights",
        "数据分析与业务洞察",
        ("data-analysis", "skill-data-analysis", "req-skill-data-analysis", "business-data-analysis"),
        (r"数据(?:复盘|处理|统计)?分析", r"业务(?:分析|洞察)", r"(?i)\bdata\s+analysis\b"),
    ),
    CapabilityDefinition(
        "demand-forecasting",
        "需求预测与预测准确率",
        ("demand-forecasting-model", "forecast-accuracy", "sales-forecasting"),
        (r"需求预测", r"销量预测", r"预测准确率", r"预测模型", r"(?i)\bdemand\s+forecast"),
    ),
    CapabilityDefinition(
        "demand-planning",
        "需求计划编制与滚动管理",
        ("demand-plan", "rolling-demand-plan", "demand-planning-management"),
        (
            r"需求计划(?![^，。；]{0,8}(?:经验|背景))",
            r"滚动计划",
            r"滚动预测",
            r"(?i)\bdemand\s+planning\b(?!\s+experience)",
        ),
    ),
    CapabilityDefinition(
        "demand-planning-experience",
        "需求计划经验",
        ("demand-planner-experience",),
        (r"需求计划.{0,8}(?:经验|背景)", r"(?i)demand\s+planning\s+experience"),
    ),
    CapabilityDefinition(
        "inventory-management",
        "库存管理与补货优化",
        ("inventory-health-management", "inventory-control", "replenishment-management"),
        (r"库存(?:管理|控制|健康|周转|优化)", r"补货(?:管理|计划|优化)", r"(?i)\binventory\s+(?:management|control|optimization)"),
    ),
    CapabilityDefinition(
        "supply-planning-balancing",
        "供应计划与供需平衡",
        ("supply-planning", "supply-demand-balancing", "supply-demand-matching"),
        (r"供应计划", r"供需(?:平衡|匹配|协同)", r"(?i)\bsupply\s+planning\b"),
    ),
    CapabilityDefinition(
        "sop-ibp",
        "S&OP / IBP 产销协同",
        ("sales-operations-planning", "integrated-business-planning", "production-sales-coordination"),
        (r"(?i)(?<![a-z])s\s*&\s*op(?![a-z])", r"(?i)(?<![a-z])ibp(?![a-z])", r"产销协同"),
    ),
    CapabilityDefinition(
        "order-delivery-logistics",
        "订单、交付与物流协同",
        ("order-fulfillment", "delivery-management", "logistics-coordination"),
        (r"订单(?:履约|管理|交付)", r"交付(?:管理|协同|跟进)", r"物流(?:管理|协同|跟进)"),
    ),
    CapabilityDefinition(
        "supply-chain-risk-management",
        "供应链风险与异常管理",
        ("supply-chain-risk", "supply-chain-exception-management", "risk-exception-closure"),
        (r"供应链.{0,8}(?:风险|异常)", r"(?:风险|异常).{0,8}(?:识别|管理|处理|闭环)"),
    ),
    CapabilityDefinition(
        "cross-functional-collaboration",
        "跨部门沟通、协同与推动",
        ("cross-functional-communication", "cross-department-communication", "communication-influence", "cross-functional-coordination"),
        (r"跨部门(?:沟通|协同|协调|推动)", r"跨团队(?:沟通|协同|协调|推动)", r"(?i)cross[-\s]*functional.{0,12}(?:communication|collaboration|coordination)"),
    ),
    CapabilityDefinition(
        "excel",
        "Excel",
        ("excel-proficiency", "skill-excel-advanced", "req-excel-skills", "advanced-excel"),
        (r"(?i)(?<![a-z])excel(?![a-z])",),
    ),
    CapabilityDefinition(
        "business-intelligence",
        "BI 可视化工具",
        ("bi-tools", "data-visualization", "power-bi", "tableau"),
        (r"(?i)(?<![a-z])power\s*bi(?![a-z])", r"(?i)(?<![a-z])tableau(?![a-z])", r"BI\s*(?:工具|报表|可视化)", r"数据可视化"),
    ),
    CapabilityDefinition(
        "erp-systems",
        "ERP / SAP / Oracle",
        ("erp", "sap", "oracle-erp"),
        (r"(?i)(?<![a-z])erp(?![a-z])", r"(?i)(?<![a-z])sap(?![a-z])", r"(?i)oracle\s*(?:erp|系统)"),
    ),
    CapabilityDefinition(
        "supplier-procurement-collaboration",
        "供应商与采购协同",
        ("supplier-management", "procurement-collaboration"),
        (r"供应商(?:管理|协同|沟通)", r"采购(?:协同|配合|管理)"),
    ),
    CapabilityDefinition(
        "promotion-new-product-forecasting",
        "促销、新品与活动预测",
        ("promotion-forecasting", "new-product-forecasting", "event-forecasting"),
        (r"促销.{0,8}(?:预测|计划)", r"新品.{0,8}(?:预测|计划)", r"活动.{0,8}(?:预测|备货)"),
    ),
)

DEFINITION_BY_KEY = {definition.key: definition for definition in CAPABILITY_DEFINITIONS}
CAPABILITY_DEFINITION_CATEGORIES = {
    "cross-functional-collaboration": "behavior",
    "demand-planning-experience": "experience",
}

CAPABILITY_KEY_ALIASES: dict[str, str] = {
    alias: definition.key
    for definition in CAPABILITY_DEFINITIONS
    for alias in definition.aliases
}
CAPABILITY_KEY_ALIASES.update(
    {
        "education-bachelor": "education-background",
        "education-requirement": "education-background",
        "computer-science-degree": "education-background",
        "bachelor-degree": "education-background",
        "degree-requirement": "education-background",
        "work-experience-years": "experience-years",
        "years-of-experience": "experience-years",
        "years-experience": "experience-years",
        "years-experience-3-5": "experience-years",
        "experience-years-3plus": "experience-years",
        "years-of-work-experience": "experience-years",
        "langchain-langgraph": "langchain-framework",
        "langchain-langgraph-experience": "langchain-framework",
        "langchain-langgraph-proficiency": "langchain-framework",
        "langchain-langgraph-framework": "langchain-framework",
        "high-concurrency-system": "high-concurrency",
        "concurrent-system-design": "high-concurrency",
        "high-concurrency-availability": "high-concurrency",
    }
)


def capability_definition_category(key: str) -> str:
    return CAPABILITY_DEFINITION_CATEGORIES.get(key, "skill")

PROFICIENCY_PATTERNS = (
    ("expert", (r"精通", r"专家级", r"(?i)\bexpert\b")),
    ("proficient", (r"熟练掌握", r"熟练使用", r"熟练", r"深入掌握", r"(?i)\bproficient\b")),
    ("working", (r"掌握", r"具备.{0,8}开发能力", r"(?i)\bworking\s+knowledge\b")),
    ("familiar", (r"熟悉", r"(?i)\bfamiliar\b")),
    ("awareness", (r"了解", r"基础知识", r"(?i)\bawareness\b")),
)


def normalize_canonical_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    normalized = re.sub(r"[\s_/\\|:：]+", "-", normalized)
    normalized = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", normalized, flags=re.UNICODE)
    return re.sub(r"-+", "-", normalized).strip("-")


def normalize_proficiency(value: Any, fallback_text: str = "") -> str:
    normalized = str(value or "").strip().lower()
    if normalized in PROFICIENCY_RANK:
        return normalized
    return infer_proficiency(fallback_text)


def infer_proficiency(text: str) -> str:
    source = str(text or "")
    for level, patterns in PROFICIENCY_PATTERNS:
        if any(re.search(pattern, source) for pattern in patterns):
            return level
    return "unspecified"


def is_proficiency_applicable(
    category: Any,
    proficiency: Any = "unspecified",
    fallback_text: str = "",
    explicit: Any = None,
) -> bool:
    if isinstance(explicit, bool):
        return explicit
    if str(category or "").strip().lower() != "skill":
        return False
    return normalize_proficiency(proficiency, fallback_text) != "unspecified"


def highest_proficiency(levels: list[str]) -> str:
    normalized = [level for level in levels if level in PROFICIENCY_RANK]
    return max(normalized, key=lambda level: PROFICIENCY_RANK[level], default="unspecified")


def canonical_capability_label(key: str, fallback: str = "") -> str:
    if key == "education-background":
        return "学历背景"
    if key == "experience-years":
        return "工作年限"
    definition = DEFINITION_BY_KEY.get(key)
    if definition:
        return definition.label
    cleaned = str(fallback or key).strip()
    cleaned = re.sub(
        r"^(?:熟练掌握|熟练使用|深入掌握|精通|熟练|掌握|熟悉|了解|具备|拥有)\s*",
        "",
        cleaned,
    )
    cleaned = re.sub(r"(?:（加分项）|\(加分项\)|加分项)$", "", cleaned).strip()
    cleaned = re.sub(r"(?:开发)?经验$|能力$|技能$", "", cleaned).strip()
    return cleaned or key


def compact_requirement_text(value: Any) -> str:
    parts = [
        part.strip()
        for part in re.split(r"[；;]+", str(value or ""))
        if part.strip()
    ]
    return "；".join(dict.fromkeys(parts))


def canonicalize_capability_key(value: Any, category: Any = "", capability_name: str = "") -> str:
    if str(category or "").strip().lower() == "education":
        return "education-background"
    key = normalize_canonical_key(value or capability_name)
    return CAPABILITY_KEY_ALIASES.get(key, key)


_GENERIC_KEY_PARTS = {"req", "requirement", "capability", "ability"}
_GENERIC_NAME_SUFFIXES = (
    "相关开发经验", "相关工作经验", "项目实践经验", "项目经验", "开发经验", "工作经验",
    "实践经验", "相关经验", "经验", "相关能力", "能力", "技能",
)


def capability_identity_fingerprint(value: Any, category: Any = "") -> str:
    """Return a conservative identity fingerprint for exact alias reuse.

    This intentionally does not collapse arbitrary parent/child concepts.  It
    only removes presentation noise (req/skill prefixes, proficiency wording,
    and generic suffixes) so concurrent evaluations cannot create trivial
    variants such as ``skill-data-analysis`` and ``req-data-analysis``.
    """
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = re.sub(
        r"^(?:熟练掌握|熟练使用|深入掌握|精通|熟练|掌握|熟悉|了解|具备|拥有|具有)\s*",
        "",
        text,
    )
    for suffix in _GENERIC_NAME_SUFFIXES:
        if text.endswith(suffix) and len(text) > len(suffix):
            text = text[:-len(suffix)].strip()
            break
    key = normalize_canonical_key(text)
    parts = [part for part in key.split("-") if part]
    category_value = str(category or "").strip().lower()
    removable = set(_GENERIC_KEY_PARTS)
    if category_value == "skill":
        removable.add("skill")
    while parts and parts[0] in removable:
        parts.pop(0)
    while parts and parts[-1] in removable:
        parts.pop()
    return "-".join(parts)


def find_catalog_capability(
    requirement: dict[str, Any],
    catalog: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Find a safe existing capability identity for a new requirement.

    The result is deliberately high precision: deterministic definitions and
    exact fingerprints are accepted, while fuzzy similarity is only used for
    near-identical spelling variants.  Related or hierarchical concepts remain
    separate and can be reviewed later.
    """
    category = str(requirement.get("category") or "other").strip().lower()
    raw_key = canonicalize_capability_key(
        requirement.get("canonicalKey"),
        category,
        str(requirement.get("capabilityName") or requirement.get("label") or ""),
    )
    if raw_key in DEFINITION_BY_KEY:
        return {"canonicalKey": raw_key, "capabilityName": DEFINITION_BY_KEY[raw_key].label, "category": category}

    fingerprints = {
        capability_identity_fingerprint(requirement.get("canonicalKey"), category),
        capability_identity_fingerprint(requirement.get("capabilityName"), category),
    }
    fingerprints.discard("")
    best: tuple[float, dict[str, Any]] | None = None
    for candidate in catalog:
        candidate_category = str(candidate.get("category") or "other").strip().lower()
        if category not in {"", "other"} and candidate_category not in {category, "other"}:
            continue
        candidate_values = [
            candidate.get("canonicalKey"),
            candidate.get("capabilityName"),
            candidate.get("label"),
            *(candidate.get("aliases") or []),
        ]
        candidate_fingerprints = {
            capability_identity_fingerprint(value, candidate_category)
            for value in candidate_values
            if value
        }
        candidate_fingerprints.discard("")
        if fingerprints & candidate_fingerprints:
            return candidate
        for left in fingerprints:
            for right in candidate_fingerprints:
                if min(len(left), len(right)) < 8:
                    continue
                score = SequenceMatcher(None, left, right).ratio()
                if score >= 0.96 and (best is None or score > best[0]):
                    best = (score, candidate)
    return best[1] if best else None


def reuse_catalog_capability(
    requirement: dict[str, Any],
    catalog: list[dict[str, Any]],
) -> dict[str, Any]:
    result = dict(requirement)
    matched = find_catalog_capability(result, catalog)
    if not matched:
        return result
    canonical_key = canonicalize_capability_key(
        matched.get("canonicalKey"),
        matched.get("category"),
        str(matched.get("capabilityName") or matched.get("label") or ""),
    )
    if not canonical_key:
        return result
    result["canonicalKey"] = canonical_key
    result["capabilityName"] = canonical_capability_label(
        canonical_key,
        str(matched.get("capabilityName") or matched.get("label") or result.get("capabilityName") or result.get("label") or ""),
    )
    return result


def reconcile_requirement_assessments(
    items: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Atomicize and reconcile assessments against the latest catalog.

    Callers should build ``catalog`` while holding the evidence-store lock.  In
    that position this becomes a commit-time uniqueness check: concurrent LLM
    calls may start with the same stale prompt catalog, but each completed
    result is reconciled against everything committed before it.
    """
    reconciled: list[dict[str, Any]] = []
    working_catalog = [dict(item) for item in catalog]
    for item in items:
        for atom in atomicize_requirement(item):
            normalized = reuse_catalog_capability(atom, working_catalog)
            reconciled.append(normalized)
            key = str(normalized.get("canonicalKey") or "")
            if key and not any(str(existing.get("canonicalKey") or "") == key for existing in working_catalog):
                working_catalog.append({
                    "canonicalKey": key,
                    "capabilityName": str(normalized.get("capabilityName") or normalized.get("label") or key),
                    "category": str(normalized.get("category") or "other"),
                })
    return merge_requirement_assessments(reconciled)


def matching_capability_definitions(text: str) -> list[tuple[CapabilityDefinition, tuple[int, int]]]:
    matches: list[tuple[CapabilityDefinition, tuple[int, int]]] = []
    for definition in CAPABILITY_DEFINITIONS:
        spans = [
            match.span()
            for pattern in definition.patterns
            for match in re.finditer(pattern, text)
        ]
        if spans:
            matches.append((definition, min(spans, key=lambda span: span[0])))
    return matches


def _proficiency_near(text: str, span: tuple[int, int], explicit: Any = "") -> str:
    explicit_level = normalize_proficiency(explicit)
    if explicit_level != "unspecified":
        return explicit_level
    start, end = span
    clause_start = max(
        text.rfind("，", 0, start),
        text.rfind(",", 0, start),
        text.rfind("；", 0, start),
        text.rfind(";", 0, start),
        text.rfind("。", 0, start),
    )
    next_boundaries = [
        index for token in ("，", ",", "；", ";", "。")
        if (index := text.find(token, end)) >= 0
    ]
    clause_end = min(next_boundaries, default=len(text))
    local = text[max(0, clause_start + 1):clause_end]
    return infer_proficiency(local) if infer_proficiency(local) != "unspecified" else infer_proficiency(text)


def _finalize_requirement_semantics(item: dict[str, Any], category: str) -> dict[str, Any]:
    finalized = dict(item)
    proficiency = normalize_proficiency(
        finalized.get("requiredProficiency"),
        f"{finalized.get('label') or ''} {finalized.get('jdQuote') or ''}",
    )
    finalized["requiredProficiency"] = proficiency
    finalized["proficiencyApplicable"] = is_proficiency_applicable(
        category,
        proficiency,
        f"{finalized.get('label') or ''} {finalized.get('jdQuote') or ''}",
        finalized.get("proficiencyApplicable"),
    )

    group_mode = str(finalized.get("requirementGroupMode") or "all_of").strip().lower()
    if group_mode != "any_of":
        finalized["requirementGroupMode"] = "all_of"
        finalized["requirementGroupId"] = ""
        finalized["requirementGroupLabel"] = ""
        finalized["minimumSatisfied"] = 1
        return finalized

    group_label = str(
        finalized.get("requirementGroupLabel")
        or finalized.get("jdQuote")
        or finalized.get("label")
        or ""
    ).strip()
    group_id = normalize_canonical_key(
        finalized.get("requirementGroupId") or f"any-of-{group_label}"
    )
    try:
        minimum_satisfied = max(1, int(finalized.get("minimumSatisfied") or 1))
    except (TypeError, ValueError):
        minimum_satisfied = 1
    finalized["requirementGroupMode"] = "any_of"
    finalized["requirementGroupId"] = group_id
    finalized["requirementGroupLabel"] = group_label
    finalized["minimumSatisfied"] = minimum_satisfied
    return finalized


def atomicize_requirement(requirement: dict[str, Any]) -> list[dict[str, Any]]:
    raw = dict(requirement)
    raw["jdQuote"] = compact_requirement_text(raw.get("jdQuote"))
    category = str(raw.get("category") or "other").strip().lower()
    if category == "education":
        return [_finalize_requirement_semantics({
            **raw,
            "canonicalKey": "education-background",
            "capabilityName": "学历背景",
            "requiredProficiency": "unspecified",
            "requiredProficiencySource": "",
            "proficiencyApplicable": False,
        }, category)]

    if raw.get("atomicizedFrom"):
        key = canonicalize_capability_key(
            raw.get("canonicalKey"),
            category,
            str(raw.get("capabilityName") or raw.get("label") or ""),
        )
        return [_finalize_requirement_semantics({
            **raw,
            "canonicalKey": key,
            "capabilityName": canonical_capability_label(
                key,
                str(raw.get("capabilityName") or raw.get("label") or ""),
            ),
            "requiredProficiency": normalize_proficiency(
                raw.get("requiredProficiency"),
                f"{raw.get('label') or ''} {raw.get('jdQuote') or ''}",
            ),
        }, category)]

    label = str(raw.get("label") or "").strip()
    capability_name = str(raw.get("capabilityName") or "").strip()
    source_text = " ".join(
        value for value in (
            capability_name,
            label,
            str(raw.get("canonicalKey") or ""),
            str(raw.get("jdQuote") or ""),
        )
        if value
    )
    matches = matching_capability_definitions(source_text)

    # More than one recognized technology means the source requirement is compound.
    # Store one requirement per atomic capability while preserving the original JD wording.
    if len(matches) > 1:
        atoms: list[dict[str, Any]] = []
        for definition, span in matches:
            atom_category = capability_definition_category(definition.key)
            level = _proficiency_near(
                source_text,
                span,
                raw.get("requiredProficiency"),
            )
            atoms.append(
                _finalize_requirement_semantics({
                    **raw,
                    "category": atom_category,
                    "canonicalKey": definition.key,
                    "capabilityName": definition.label,
                    "requiredProficiency": level,
                    "requiredProficiencySource": str(raw.get("requiredProficiencySource") or "").strip(),
                    "atomicizedFrom": str(raw.get("canonicalKey") or "").strip(),
                }, atom_category)
            )
        return atoms

    if matches:
        definition, span = matches[0]
        category = capability_definition_category(definition.key)
        normalized_key = normalize_canonical_key(raw.get("canonicalKey"))
        mapped_key = CAPABILITY_KEY_ALIASES.get(normalized_key, normalized_key)
        exact_identity = capability_identity_fingerprint(
            capability_name or label,
            category,
        ) in {
            capability_identity_fingerprint(definition.key, category),
            capability_identity_fingerprint(definition.label, category),
        }
        # Override a model key only for an explicit alias or an exact identity.
        # A partial pattern match (Python in "Python + FastAPI", Go in
        # "Go concurrency") is not enough and must retain the more specific
        # atomic identity until a dedicated definition or review exists.
        if mapped_key == definition.key or exact_identity:
            key = definition.key
            name = definition.label
        else:
            key = mapped_key
            name = canonical_capability_label(key, capability_name or label)
        proficiency = _proficiency_near(source_text, span, raw.get("requiredProficiency"))
    else:
        key = canonicalize_capability_key(raw.get("canonicalKey"), category, capability_name or label)
        name = canonical_capability_label(key, capability_name or label)
        proficiency = normalize_proficiency(raw.get("requiredProficiency"), f"{label} {raw.get('jdQuote') or ''}")

    return [
        _finalize_requirement_semantics({
            **raw,
            "canonicalKey": key,
            "capabilityName": name,
            "requiredProficiency": proficiency,
            "requiredProficiencySource": str(raw.get("requiredProficiencySource") or "").strip(),
        }, category)
    ]


def merge_requirement_assessments(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    importance_rank = {"context": 0, "preferred": 1, "required": 2}
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for item in items:
        for atom in atomicize_requirement(item):
            key = str(atom.get("canonicalKey") or "")
            if not key:
                continue
            merge_key = (str(atom.get("sourceKey") or ""), key)
            current = merged.get(merge_key)
            if current is None:
                merged[merge_key] = atom
                continue
            if importance_rank.get(str(atom.get("importance") or "context"), 0) > importance_rank.get(
                str(current.get("importance") or "context"),
                0,
            ):
                current["importance"] = atom.get("importance")
            current["requiredProficiency"] = highest_proficiency(
                [
                    str(current.get("requiredProficiency") or "unspecified"),
                    str(atom.get("requiredProficiency") or "unspecified"),
                ]
            )
            current["proficiencyApplicable"] = bool(
                current.get("proficiencyApplicable") or atom.get("proficiencyApplicable")
            )
            refs = [
                *current.get("candidateEvidenceRefs", []),
                *atom.get("candidateEvidenceRefs", []),
            ]
            current["candidateEvidenceRefs"] = list({
                (str(ref.get("sourceType") or ""), str(ref.get("quote") or ""), str(ref.get("locator") or "")): ref
                for ref in refs
                if isinstance(ref, dict) and ref.get("quote")
            }.values())
            quotes = [
                part
                for value in (current.get("jdQuote"), atom.get("jdQuote"))
                for part in compact_requirement_text(value).split("；")
                if part
            ]
            current["jdQuote"] = "；".join(dict.fromkeys(quotes))
            current["confidence"] = max(float(current.get("confidence") or 0), float(atom.get("confidence") or 0))
    return list(merged.values())
