"""数据清洗 & 标准化管道：将爬虫原始数据转为统一格式"""
import re
import hashlib
import logging
from datetime import datetime, date

logger = logging.getLogger('pipeline')

# 默认最低月薪 (K)
MIN_AVG_SALARY_K = 17

# 兼容历史分类配置
DEFAULT_CAT_RULES = {
    'AI营销': ['营销', '广告', '投放', '增长', '获客', '私域', '品牌营销', '营销中台', '营销工具'],
    'AI内容': ['内容', '文案', '创作', '素材', '图文', '内容中台', '内容平台', '内容生成', '内容管理', '内容分发', '内容推荐', '内容审核', '内容电商'],
    'AI电商': ['电商', '淘宝', '天猫', '京东', '拼多多', '亚马逊', 'shopee', '独立站', '导购', '商家工具', '选品', '直播电商', '跨境电商'],
    'AI视频': ['视频', '短视频', '短剧', '直播', '影像', '视频生成', '文生视频', '图生视频', '剪辑', '数字人', '虚拟人'],
    'AI语音': ['语音', 'TTS', 'ASR', '音乐', '写歌'],
    'AI视觉': ['视觉', '图像', 'CV', '计算机视觉'],
    'AI平台工具': ['平台', '工具', 'SaaS', '中台', '工作流', '解决方案', '应用'],
    'AI对话': ['对话', '聊天', 'chatbot', '问答', '陪伴', 'chatGPT', '智能对话', '助手', '客服', '坐席', '呼叫'],
    'AI搜索推荐': ['搜索', '推荐', '策略', '归因', '数据'],
    '大模型': ['大模型', 'LLM', '语言模型', '基座模型', '预训练', '微调', 'RAG', 'Copilot', 'Agent', '智能体', '多模态', 'NLP', '机器学习', '深度学习'],
    'AI商业化': ['商业化', 'ToB', 'B端', '企业'],
    'AI机器人': ['机器人', '具身', '自动驾驶'],
    '行业AI': ['办公', '教育', '医疗', '金融', '风控'],
}


def parse_salary(s: str) -> float:
    """解析薪资字符串为月均K数"""
    if not s:
        return 0
    s = str(s).strip()
    # 15K-25K
    m = re.search(r'(\d+)-(\d+)K', s)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
        bonus = re.search(r'(\d+)薪', s)
        months = int(bonus.group(1)) if bonus else 12
        return round((lo + hi) / 2 * months / 12, 1)
    # 200-300元/天
    m2 = re.search(r'(\d+)-(\d+)元/天', s)
    if m2:
        lo, hi = int(m2.group(1)), int(m2.group(2))
        return round((lo + hi) / 2 * 22 / 1000, 1)
    # 15000-25000元/月
    m3 = re.search(r'(\d+)-(\d+)元/月', s)
    if m3:
        lo, hi = int(m3.group(1)), int(m3.group(2))
        return round((lo + hi) / 2 / 1000, 1)
    return 0


def classify(text: str, cat_rules: dict = None) -> tuple:
    """根据文本内容匹配分类"""
    cats = []
    matched_kw = []
    text_lower = text.lower()
    # An explicitly empty object means the direction has no category rules.
    # Do not silently substitute the legacy global AI rules in that case.
    rules = DEFAULT_CAT_RULES if cat_rules is None else cat_rules
    for cat_name, keywords in rules.items():
        hits = [k for k in keywords if k.lower() in text_lower]
        if hits:
            cats.append(cat_name)
            matched_kw.extend(hits)
    return cats, list(set(matched_kw))


def matching_rules_are_enabled(
    cat_rules: dict | None = None,
    relevance_keywords: list | None = None,
    blacklist_keywords: list | None = None,
    min_salary: float | None = None,
) -> bool:
    """Return whether configured ingestion rules should filter jobs.

    New directions intentionally have no matching rules.  Until rules are
    saved, results returned for the user's collection keywords must be kept
    instead of falling back to the historical AI-only defaults.
    """
    # Legacy category and salary arguments remain for compatibility, but do
    # not participate in the current admission policy.
    return bool(relevance_keywords or blacklist_keywords)


def _normalise_rule_terms(values) -> list[str]:
    """Return non-empty, trimmed rule terms with case-insensitive dedupe."""
    if not values:
        return []
    if isinstance(values, str):
        values = values.splitlines()
    result = []
    seen = set()
    for value in values:
        term = str(value or '').strip()
        key = term.casefold()
        if term and key not in seen:
            seen.add(key)
            result.append(term)
    return result


def admission_decision(
    raw: dict,
    relevance_keywords: list | None = None,
    blacklist_keywords: list | None = None,
    target_keywords: list | None = None,
) -> dict:
    """Apply the shared, title-based job-library admission policy."""
    title = str((raw or {}).get('title') or '').strip()
    title_folded = title.casefold()
    blacklist = _normalise_rule_terms(blacklist_keywords)
    target = _normalise_rule_terms(relevance_keywords)
    if not target:
        target = _normalise_rule_terms(target_keywords)

    matched_blacklist = [term for term in blacklist if term.casefold() in title_folded]
    if matched_blacklist:
        return {
            'accepted': False,
            'matchedTargetTerms': [],
            'matchedBlacklistTerms': matched_blacklist,
            'reasonCode': 'blacklist_hit',
            'reason': '岗位标题命中排除岗位词',
        }
    if not title:
        return {
            'accepted': False,
            'matchedTargetTerms': [],
            'matchedBlacklistTerms': [],
            'reasonCode': 'missing_title',
            'reason': '岗位缺少标题',
        }
    if not target:
        return {
            'accepted': True,
            'matchedTargetTerms': [],
            'matchedBlacklistTerms': [],
            'reasonCode': 'no_target_rules',
            'reason': '未配置目标岗位词，保留岗位',
        }
    matched_target = [term for term in target if term.casefold() in title_folded]
    if matched_target:
        return {
            'accepted': True,
            'matchedTargetTerms': matched_target,
            'matchedBlacklistTerms': [],
            'reasonCode': 'target_keyword_hit',
            'reason': '岗位标题命中目标岗位词',
        }
    return {
        'accepted': False,
        'matchedTargetTerms': [],
        'matchedBlacklistTerms': [],
        'reasonCode': 'target_keyword_miss',
        'reason': '岗位标题未命中目标岗位词',
    }


def salary_tier(avg: float) -> str:
    if avg >= 50:
        return '50K+'
    elif avg >= 30:
        return '30-50K'
    elif avg >= 15:
        return '15-30K'
    elif avg >= 8:
        return '8-15K'
    else:
        return '<8K'


def clean_desc(desc) -> str:
    """清洗职位描述中的噪音文本"""
    if isinstance(desc, list):
        desc = ' '.join(str(x) for x in desc)
    desc = str(desc or '')
    for noise in ['BOSS直聘', 'kanzhun', 'boss', '直聘', '来自BOSS直聘',
                  '微信扫码分享举报', '微信扫码分享', '举报', '职位描述']:
        desc = desc.replace(noise, '')
    return re.sub(r'\s+', ' ', desc).strip()


def norm_city(city: str) -> str:
    """标准化城市名称"""
    city = str(city or '').strip()
    city = re.sub(r'[市省]$', '', city)
    city = city.split('·')[0]
    return city


def dedup_key(job: dict) -> str:
    """生成去重键"""
    raw = f"{job.get('company','')}{job.get('title','')}{norm_city(job.get('city',''))}"
    return hashlib.md5(raw.encode()).hexdigest()


def process_one(
    raw: dict,
    cat_rules: dict = None,
    min_salary: float = None,
    relevance_keywords: list = None,
    blacklist_keywords: list = None,
    target_keywords: list = None,
) -> dict:
    """
    清洗单条原始岗位数据。
    返回标准化 dict，不满足条件返回 None。
    """
    title = str(raw.get('title') or '')[:40]
    company = str(raw.get('company') or '')[:25]
    city = norm_city(raw.get('city') or raw.get('_city_name', ''))
    salary = str(raw.get('salary') or '')
    exp = str(raw.get('exp') or '')
    edu = str(raw.get('edu') or '')
    desc = clean_desc(raw.get('desc', ''))

    if not title or not company:
        return None

    decision = admission_decision(
        {'title': title},
        relevance_keywords=relevance_keywords,
        blacklist_keywords=blacklist_keywords,
        target_keywords=target_keywords,
    )
    if not decision['accepted']:
        return None

    text = f'{company} {title} {desc}'
    cats, kw = classify(text, cat_rules) if cat_rules else ([], [])

    avg = parse_salary(salary)
    tier = salary_tier(avg)

    url = str(raw.get('url') or '').strip()

    result = {
        'title': title,
        'company': company,
        'city': city,
        'salary': salary,
        'avg': avg,
        'tier': tier,
        'exp': exp,
        'edu': edu,
        'cats': cats if cats else ['通用'],
        'kw': kw,
        'admission': decision,
        'desc': desc,
        '_key': dedup_key({'title': title, 'company': company, 'city': city}),
        'security_id': str(raw.get('security_id') or '').strip(),
        '_date': date.today().isoformat(),
        '_crawled_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }
    if url:
        result['url'] = url
    return result


def process_batch(
    raw_list: list,
    cat_rules: dict = None,
    min_salary: float = None,
    relevance_keywords: list = None,
    blacklist_keywords: list = None,
    target_keywords: list = None,
) -> list:
    """批量清洗，自动去重"""
    results = []
    seen = set()
    for raw in raw_list:
        job = process_one(
            raw,
            cat_rules,
            min_salary,
            relevance_keywords,
            blacklist_keywords,
            target_keywords,
        )
        if job and job['_key'] not in seen:
            seen.add(job['_key'])
            results.append(job)
    logger.info(f'Pipeline: {len(raw_list)} raw -> {len(results)} cleaned')
    return results
