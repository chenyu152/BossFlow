"""数据清洗 & 标准化管道：将爬虫原始数据转为统一格式"""
import re
import hashlib
import logging
from datetime import datetime, date

logger = logging.getLogger('pipeline')

# 默认最低月薪 (K)
MIN_AVG_SALARY_K = 17

# 默认分类规则
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
    rules = cat_rules or DEFAULT_CAT_RULES
    for cat_name, keywords in rules.items():
        hits = [k for k in keywords if k.lower() in text_lower]
        if hits:
            cats.append(cat_name)
            matched_kw.extend(hits)
    return cats, list(set(matched_kw))


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


def process_one(raw: dict, cat_rules: dict = None, min_salary: float = None, relevance_keywords: list = None, blacklist_keywords: list = None) -> dict:
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

    # 黑名单过滤 (Blacklist keywords check in title)
    if blacklist_keywords:
        if any(w.lower() in title.lower() for w in blacklist_keywords):
            return None

    text = f'{company} {title} {desc}'
    cats, kw = classify(text, cat_rules)

    # 核心相关性过滤（若匹配到分类则直接保留；未匹配分类则标题中必须含有相关匹配词才予保留）
    rel_kws = relevance_keywords if relevance_keywords is not None else ['AI', 'ai', 'AIGC', '大模型', '智能', '算法']
    related = any(w.lower() in title.lower() for w in rel_kws) if rel_kws else False
    if not cats and not related:
        return None

    avg = parse_salary(salary)
    min_avg = min_salary if min_salary is not None else MIN_AVG_SALARY_K
    if avg < min_avg:
        return None
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
        'desc': desc,
        '_key': dedup_key({'title': title, 'company': company, 'city': city}),
        '_date': date.today().isoformat(),
        '_crawled_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
    }
    if url:
        result['url'] = url
    return result


def process_batch(raw_list: list, cat_rules: dict = None, min_salary: float = None, relevance_keywords: list = None, blacklist_keywords: list = None) -> list:
    """批量清洗，自动去重"""
    results = []
    seen = set()
    for raw in raw_list:
        job = process_one(raw, cat_rules, min_salary, relevance_keywords, blacklist_keywords)
        if job and job['_key'] not in seen:
            seen.add(job['_key'])
            results.append(job)
    logger.info(f'Pipeline: {len(raw_list)} raw -> {len(results)} cleaned')
    return results
