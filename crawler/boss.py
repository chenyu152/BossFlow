#!/usr/bin/env python3
"""
BOSS直聘爬虫 - API拦截模式 + AI PM 强相关过滤

基于 DrissionPage 的 API 拦截方案，速度快、数据完整。
支持：关键词搜索、多城市、首页无限滚动、详情获取、人机模拟。

用法:
  python boss.py                          # 全量抓取
  python boss.py --quick                  # 快速模式（随机抽样关键词）
  python boss.py --city 杭州              # 只抓指定城市
  python boss.py                          # 首页无限滚动模式（默认目标20条）
  python boss.py --target 100             # 首页无限滚动模式（目标100条）
  python boss.py --login                  # 仅登录保存Cookie
"""
import sys
import io
import os
import time
import json
import random
import logging
import argparse
import re
import math
from pathlib import Path
from urllib.parse import urlencode

logger = logging.getLogger('boss_crawler')

# ==================== 配置默认值 ====================

PACKAGE_DIR = Path(__file__).parent
DEFAULT_CONFIG_FILE = PACKAGE_DIR / 'config' / 'keywords.json'
DEFAULT_PROFILE_DIR = Path('.chrome_profile')
DEFAULT_CHROME_PORT = 9222

DEFAULT_KEYWORDS = [
    'AI应用开发工程师', 'Agent应用开发工程师', 'AI Agent工程师',
    '智能体开发工程师', '大模型应用开发工程师', 
    'LLM应用开发工程师',
    '智能体架构工程师', 'AI Agent开发', 'AI应用开发',
    'Agent开发工程师',
    'AI平台开发工程师',
]

# AI 相关术语（用于相关性判断）
_AI_TERMS = [
    'AI', 'AIGC', 'AGI', '人工智能', '大模型', 'LLM', 'GPT', 'NLP',
    '智能', '算法', '机器学习', 'ML', '深度学习', 'DL', '智能体', 'AGENT',
    'CV', '计算机视觉', '自动驾驶', '机器人', 'ROBOTICS', '语音', 'TTS', 'ASR',
    '多模态', 'MULTIMODAL', '生成式', 'GENERATIVE', 'GENAI',
    'COPILOT', 'CHATBOT', 'RAG', 'MLOPS', 'FOUNDATION MODEL',
    '向量', 'EMBEDDING', 'TRANSFORMER', '预训练', '微调',
    '推荐', '搜索', '策略', '数据', '对话', '知识图谱',
    '视频生成', '文生视频', '图生视频', '短视频', '短剧', '剪辑', '数字人', '虚拟人', '影像',
]
_TARGET_ROLE_TERMS = [
    # 产品经理
    '产品', 'PRODUCT', '产品经理', '产品负责', '产品总监', '产品专家',
    'PM', '产品策划', '产品运营',
    # 开发工程师
    '开发', '工程师', 'ENGINEER', 'DEVELOPER', 'DEV', '研发',
    '前端', '后端', '全栈', 'FULLSTACK', '架构', 'ARCHITECT',
    '技术', 'TECH', '程序员', 'PROGRAMMER', 'CODING',
]

# 滚动采集参数
DEFAULT_SCROLL_TARGET = 20
DEFAULT_SCROLL_MAX_SCROLLS = 60

DEFAULT_SCRAPE_LIMITS = {
    'scroll_target': DEFAULT_SCROLL_TARGET,
    'scroll_max_scrolls': DEFAULT_SCROLL_MAX_SCROLLS,
}

# 防封参数
MIN_DELAY, MAX_DELAY = 0.8, 1.8
KEYWORD_REST_MIN, KEYWORD_REST_MAX = 1, 3
CITY_REST_MIN, CITY_REST_MAX = 2, 6
DETAIL_DELAY_MIN, DETAIL_DELAY_MAX = 0.8, 1.5
DETAIL_BATCH_PAUSE = (1, 5)
DETAIL_BATCH_SIZE = 25

# 强相关过滤关键词
RELEVANT_KEYWORDS = [
    'AI', 'ai', 'AIGC', '人工智能', '大模型', 'LLM', 'GPT',
    '智能', '算法', 'NLP', '机器学习', 'ML', '深度学习',
    '产品经理', '产品负责人', '产品总监', '产品专家', '智能体', 'Agent',
]

DETAIL_API = 'https://www.zhipin.com/wapi/zpgeek/job/detail.json'


# ==================== 工具函数 ====================

def _normalize_keyword(text):
    """标准化搜索关键词"""
    text = str(text or '').replace('　', ' ').strip()
    if not text:
        return ''
    text = text.replace('（', '(').replace('）', ')')
    text = re.sub(r'\s+', ' ', text)
    if 2 <= len(text) <= 24:
        return text
    return ''


def _merge_unique(*groups):
    """合并多个列表并去重"""
    merged, seen = [], set()
    for group in groups:
        for item in (group or []):
            term = _normalize_keyword(item)
            if term and term not in seen:
                seen.add(term)
                merged.append(term)
    return merged


# ==================== 配置加载 ====================

def load_config(config_file=None):
    """加载 keywords.json 配置"""
    path = Path(config_file) if config_file else DEFAULT_CONFIG_FILE
    if path.is_dir():
        path = path / 'config.json'
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    else:
        config = {}
    config.setdefault('keywords', DEFAULT_KEYWORDS)
    config.setdefault('cities', {
        '北京': '101010100', '上海': '101020100', '广州': '101280100',
        '深圳': '101280600', '杭州': '101210100', '成都': '101270100',
        '南京': '101190100', '武汉': '101200100', '苏州': '101190400',
        '西安': '101110100', '长沙': '101250100', '合肥': '101220100',
        '郑州': '101180100', '重庆': '101040100', '厦门': '101230200',
        '天津': '101030100', '济南': '101120100', '青岛': '101120200',
        '大连': '101070200', '福州': '101230100',
    })
    config.setdefault('scrape_limits', DEFAULT_SCRAPE_LIMITS.copy())
    return config


def load_scrape_limits(config_file=None):
    limits = DEFAULT_SCRAPE_LIMITS.copy()
    raw = load_config(config_file).get('scrape_limits') or {}
    for key, default in DEFAULT_SCRAPE_LIMITS.items():
        try:
            value = int(raw.get(key, default))
        except (TypeError, ValueError):
            value = default
        limits[key] = max(1, value)
    return limits


def load_cities(config_file=None):
    return load_config(config_file)['cities']


def load_keywords(config_file=None, quick=False):
    """加载关键词：全量模式下返回全部，快速模式下随机抽样6-10个"""
    config = load_config(config_file)
    all_kw = _merge_unique(config.get('keywords', []), DEFAULT_KEYWORDS)
    if not all_kw:
        return []
    if quick:
        pick_count = random.randint(6, min(10, len(all_kw)))
        selected = random.sample(all_kw, pick_count)
        random.shuffle(selected)
        logger.info(f'[快速模式] 词库 {len(all_kw)} 个，随机抽样 {len(selected)} 个')
        return selected
    return all_kw


# ==================== 防封 & 人机模拟 ====================

def random_delay(lo=MIN_DELAY, hi=MAX_DELAY):
    """高斯分布延迟，偶尔较长停顿"""
    mean = (lo + hi) / 2
    std = (hi - lo) / 4
    delay = max(lo * 0.8, random.gauss(mean, std))
    if random.random() < 0.03:
        delay += random.uniform(1, 3)
    time.sleep(delay)


def simulate_human(page):
    """模拟真人浏览：滚动、停顿、鼠标移动"""
    actions = random.randint(2, 4)
    for _ in range(actions):
        act = random.choices(
            ['down', 'up', 'pause', 'mouse', 'read'],
            weights=[30, 15, 20, 20, 15], k=1
        )[0]
        if act == 'down':
            total = random.randint(200, 600)
            steps = random.randint(2, 4)
            for i in range(steps):
                chunk = int(total * random.uniform(0.15, 0.45))
                page.scroll.down(chunk)
                time.sleep(random.uniform(0.05, 0.2))
            time.sleep(random.uniform(0.3, 0.8))
        elif act == 'up':
            page.scroll.up(random.randint(80, 250))
            time.sleep(random.uniform(0.3, 0.7))
        elif act == 'mouse':
            try:
                x = random.randint(100, 900)
                y = random.randint(200, 600)
                page.run_js(f'document.elementFromPoint({x},{y})')
            except Exception:
                pass
            time.sleep(random.uniform(0.2, 0.5))
        elif act == 'read':
            time.sleep(random.uniform(1.0, 3.0))
        else:
            time.sleep(random.uniform(0.4, 1.2))


def build_search_url(keyword: str, city_code: str, page_num: int = 1, salary_code: str = '') -> str:
    params = {'query': keyword, 'city': city_code}
    if salary_code:
        params['salary'] = str(salary_code)
    if page_num and page_num > 1:
        params['page'] = str(page_num)
    return f'https://www.zhipin.com/web/geek/job?{urlencode(params)}'


# ==================== 数据提取 ====================

def is_relevant(job_name: str, skills: str = '') -> bool:
    """判断岗位是否与 AI 产品经理强相关"""
    text = f'{job_name} {skills}'.upper()
    has_ai = any(kw.upper() in text for kw in _AI_TERMS)
    has_role = any(kw.upper() in text for kw in _TARGET_ROLE_TERMS)
    return has_ai and has_role


def extract_jobs_from_api(json_data):
    """从 BOSS API 响应中提取岗位数据"""
    jobs = []
    try:
        job_list = json_data.get('zpData', {}).get('jobList', [])
        for item in job_list:
            jobs.append({
                'job_name': item.get('jobName', ''),
                'salary': item.get('salaryDesc', ''),
                'company': item.get('brandName', ''),
                'city': item.get('cityName', ''),
                'area': item.get('areaDistrict', ''),
                'business': item.get('businessDistrict', ''),
                'experience': item.get('jobExperience', ''),
                'degree': item.get('jobDegree', ''),
                'industry': item.get('brandIndustry', ''),
                'skills': ' '.join(item.get('skills', [])),
                'welfare': ' '.join(item.get('welfareList', [])),
                'security_id': item.get('securityId', ''),
                'encrypt_job_id': item.get('encryptJobId', ''),
                'url': f"https://www.zhipin.com/job_detail/{item.get('encryptJobId', '')}.html" if item.get('encryptJobId') else '',
            })
    except Exception as e:
        logger.warning(f'解析API数据出错: {e}')
    return jobs


def collect_api_responses(dp, timeout=5):
    """收集监听到的 API 响应"""
    all_api_jobs = []
    while True:
        try:
            r = dp.listen.wait(timeout=timeout)
            if r and r.response and r.response.body:
                body = r.response.body
                if isinstance(body, str):
                    body = json.loads(body)
                jobs = extract_jobs_from_api(body)
                all_api_jobs.extend(jobs)
            else:
                break
        except Exception:
            break
    return all_api_jobs


# ==================== 核心爬虫类 ====================

class BossCrawler:
    """BOSS直聘 API拦截模式爬虫 — AI PM 强相关岗位采集"""

    def __init__(self, profile_dir=None, chrome_port=None, config_file=None, partial_file=None,
                 scroll_max_scrolls=None):
        """
        profile_dir: Chrome Profile 目录（持久化 Cookie）。默认 ./.chrome_profile
        chrome_port: Chrome 调试端口，默认 9222
        config_file: keywords.json 路径，默认 crawler/config/keywords.json
        partial_file: 中途保存路径，默认 ./crawl_partial.json（Ctrl+C 后数据不会丢）
        """
        self.page = None
        self.all_jobs = {}
        self.skipped = 0
        self._processed_keys = set()
        self._progress_cb = None
        self._keyword_done_cb = None
        self._crawl_started_cb = None
        self._headless_requested = False
        self._partial_file = Path(partial_file) if partial_file else Path('crawl_partial.json')
        self._partial_results = []  # 已完成关键词的标准化结果
        self._stopped = False       # 信号中断标记

        self.profile_dir = Path(profile_dir) if profile_dir else DEFAULT_PROFILE_DIR
        self.chrome_port = int(os.environ.get('AI_PM_CHROME_PORT', str(chrome_port or DEFAULT_CHROME_PORT)))
        self.config_file = config_file or DEFAULT_CONFIG_FILE
        limits = load_scrape_limits(self.config_file)
        self.scroll_max_scrolls = int(scroll_max_scrolls or limits['scroll_max_scrolls'])

    # ========== 浏览器管理 ==========

    def _browser_alive(self) -> bool:
        try:
            _ = self.page.title
            return True
        except Exception:
            return False

    def _safe_listen_start(self, target):
        try:
            self.page.listen.start(target)
            return True
        except Exception:
            return False

    def _safe_listen_stop(self):
        try:
            self.page.listen.stop()
        except Exception:
            pass

    def _build_options(self, headless=False):
        from DrissionPage import ChromiumOptions
        self.profile_dir.mkdir(exist_ok=True)
        co = ChromiumOptions()
        co.set_argument('--disable-blink-features=AutomationControlled')
        # 随机UA
        minor = random.randint(0, 99)
        import platform as _plat
        if _plat.system() == 'Windows':
            co.set_user_agent(
                f'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                f'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.{minor} Safari/537.36'
            )
        else:
            co.set_user_agent(
                f'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                f'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.{minor} Safari/537.36'
            )
        co.set_pref('excludeSwitches', ['enable-automation'])
        co.set_pref('useAutomationExtension', False)
        w = random.choice([1440, 1512, 1680, 1920]) + random.randint(-20, 20)
        h = random.choice([900, 1080, 1050]) + random.randint(-20, 20)
        co.set_argument(f'--window-size={w},{h}')
        co.set_argument('--lang=zh-CN')
        co.set_user_data_path(str(self.profile_dir))
        co.set_local_port(self.chrome_port)
        if headless:
            co.set_argument('--headless=new')
        return co

    def start_browser(self, headless=False):
        """启动 Chrome 浏览器"""
        from DrissionPage import ChromiumPage
        from DrissionPage.common import Settings
        Settings.set_singleton_tab_obj(False)

        self._headless_requested = headless
        co = self._build_options(headless=False)
        self.page = ChromiumPage(addr_or_opts=co)
        try:
            self.page.set.timeouts(base=30, page_load=30, script=20)
        except Exception:
            pass
        # 注入反检测 JS
        try:
            self.page.run_js('''
                Object.defineProperty(navigator, "webdriver", {get: () => undefined});
                Object.defineProperty(navigator, "plugins", {get: () => [1,2,3,4,5]});
                Object.defineProperty(navigator, "languages", {get: () => ["zh-CN","zh","en"]});
                window.chrome = {runtime: {}, loadTimes: () => ({}), csi: () => ({})};
            ''')
        except Exception:
            pass
        print(f'[OK] 浏览器已启动 (Profile: {self.profile_dir})')

    def ensure_login(self, city_code='101010100'):
        """检测登录状态，未登录则弹窗提示"""
        from .platform_utils import activate_chrome, notify, show_login_dialog

        url = f'https://www.zhipin.com/web/geek/job?query=AI产品经理&city={city_code}'
        self.page.get(url)
        time.sleep(5)

        for attempt in range(8):
            try:
                has_jobs = self.page.run_js(
                    'return document.querySelectorAll("li[class*=job-card]").length > 0'
                )
                if has_jobs:
                    print('[OK] 已登录，检测到岗位列表')
                    return True
                is_verify = self.page.run_js(
                    'return document.title.includes("安全") || document.title.includes("验证")'
                )
                if is_verify:
                    print(f'  等待安全验证通过... ({attempt+1}/8)')
            except Exception:
                pass
            time.sleep(3)

        activate_chrome()
        notify('AI 岗位爬取', '请在 Chrome 中登录 BOSS 直聘')
        confirmed = show_login_dialog(
            'BOSS 爬虫 - 登录',
            '请先在 Chrome 中完成 BOSS 直聘登录，\n'
            '登录成功后点击「已登录」继续爬取。\n\n'
            'Cookie 会自动保存，下次无需再登录。'
        )
        if not confirmed:
            print('[WARN] 用户取消登录')
            return False
        print('[OK] 用户确认已登录')
        time.sleep(2)
        return True

    # ========== 核心抓取 ==========

    def is_relevant_job(self, job_name: str, skills: str = '') -> bool:
        """根据配置文件的规则过滤岗位"""
        try:
            config = load_config(self.config_file)
            cat_rules = config.get('cat_rules')
            relevance_keywords = config.get('relevance_keywords')
            blacklist_keywords = config.get('blacklist_keywords')
        except Exception:
            cat_rules = None
            relevance_keywords = None
            blacklist_keywords = None

        # 优先黑名单过滤
        if blacklist_keywords:
            if any(w.lower() in job_name.lower() for w in blacklist_keywords):
                return False

        if cat_rules or relevance_keywords:
            text = f'{job_name} {skills}'
            from .pipeline import classify
            cats, _ = classify(text, cat_rules)
            rel_kws = relevance_keywords if relevance_keywords is not None else ['AI', 'ai', 'AIGC', '大模型', '智能', '算法']
            related = any(w.lower() in job_name.lower() for w in rel_kws) if rel_kws else False
            return bool(cats or related)

        return is_relevant(job_name, skills)

    def _add_jobs(self, api_jobs):
        """添加岗位（带强相关过滤和去重）"""
        new_count = existing_count = relevant_count = 0
        for job in api_jobs:
            name = job.get('job_name', '')
            skills = job.get('skills', '')
            if not self.is_relevant_job(name, skills):
                self.skipped += 1
                continue
            relevant_count += 1
            key = f"{name}_{job.get('company', '')}"
            if key in self.all_jobs:
                existing_count += 1
            elif name:
                self.all_jobs[key] = job
                new_count += 1
        return new_count, existing_count, relevant_count

    def scrape_keyword_scroll(self, keyword: str, city_code: str, city_name: str = '',
                              salary_code: str = '', salary_label: str = '',
                              target_count: int = DEFAULT_SCROLL_TARGET, max_scrolls: int = None) -> int:
        """首页无限滚动模式：在第一页持续下滑触发动态加载，达目标数量停止"""
        keyword_new = 0
        scroll_idx = 0
        consecutive_zero = 0
        max_scrolls = int(max_scrolls or self.scroll_max_scrolls)

        if not self._safe_listen_start('wapi/zpgeek/search/joblist.json'):
            return 0

        url = build_search_url(keyword, city_code, salary_code=salary_code)
        self.page.get(url)
        random_delay(1.5, 3.0)

        page_jobs = collect_api_responses(self.page, timeout=8)
        if page_jobs:
            sn, _, _ = self._add_jobs(page_jobs)
            keyword_new += sn

        target_limit = target_count
        while keyword_new < target_limit and scroll_idx < max_scrolls:
            scroll_idx += 1

            if random.random() < 0.25:
                try:
                    self.page.scroll.to_bottom()
                except Exception:
                    self.page.run_js('window.scrollBy(0, document.body.scrollHeight)')
            else:
                total_dist = random.randint(800, 1600)
                sub_steps = random.randint(1, 2)
                for _ in range(sub_steps):
                    chunk = total_dist // sub_steps + random.randint(-30, 50)
                    self.page.scroll.down(max(200, chunk))
                    time.sleep(random.uniform(0.05, 0.15))

            random_delay(0.8, 1.5)
            if random.random() < 0.15:
                simulate_human(self.page)

            scroll_jobs = collect_api_responses(self.page, timeout=3)
            if scroll_jobs:
                sn, se, sr = self._add_jobs(scroll_jobs)
                keyword_new += sn
                consecutive_zero = 0 if sn > 0 else consecutive_zero + 1
            else:
                consecutive_zero += 1

            salary_part = f' [{salary_label}]' if salary_label else ''
            logger.info(
                f'    滚动#{scroll_idx}{salary_part}: +{keyword_new}条'
                f' (目标{target_limit}, 连续空{consecutive_zero})'
            )

            if consecutive_zero >= 5:
                logger.info(f'    连续{consecutive_zero}次滚动无新增，已无更多内容')
                break

        self._safe_listen_stop()
        return keyword_new

    def run_keyword(self, keyword: str, cities: dict, scroll_target: int = DEFAULT_SCROLL_TARGET,
                    salary_code: str = '', salary_label: str = '') -> list:
        """爬取单个关键词×所有城市，返回标准化结果"""
        if not self._browser_alive():
            logger.warning(f'浏览器已断连，跳过关键词 {keyword}')
            return []

        kw_before = len(self.all_jobs)
        city_items = list(cities.items())
        random.shuffle(city_items)

        for city_i, (city_name, city_code) in enumerate(city_items):
            if not self._browser_alive():
                logger.warning(f'浏览器已断连，停止关键词 {keyword}')
                break

            n = self.scrape_keyword_scroll(keyword, city_code, city_name,
                                           salary_code=salary_code,
                                           salary_label=salary_label,
                                           target_count=scroll_target)

            salary_part = f' [{salary_label}]' if salary_label else ''
            print(f'  → {keyword} @ {city_name}{salary_part}: +{n} | 累计 {len(self.all_jobs)} (过滤 {self.skipped})')

            if self._progress_cb:
                try:
                    self._progress_cb(kw_before + city_i + 1, len(cities), keyword, city_name, len(self.all_jobs))
                except Exception:
                    pass

            if city_i < len(city_items) - 1:
                random_delay(CITY_REST_MIN, CITY_REST_MAX)

        # 获取新岗位详情
        kw_new_keys = {k for k, j in self.all_jobs.items() if k not in self._processed_keys}
        if kw_new_keys:
            self._fetch_keyword_details(kw_new_keys)
            self._processed_keys.update(kw_new_keys)

        # 标准化
        results = []
        for key in kw_new_keys:
            if key in self.all_jobs:
                job = self.all_jobs[key]
                city = job.get('city', '')
                desc = job.get('full_desc', '') or job.get('skills', '')
                results.append({
                    'title': job.get('job_name', ''),
                    'company': job.get('company', ''),
                    'city': city,
                    'salary': job.get('salary', ''),
                    'exp': job.get('experience', ''),
                    'edu': job.get('degree', ''),
                    'desc': desc,
                    'url': job.get('url', ''),
                    'security_id': job.get('security_id', ''),
                    '_source': 'boss',
                })

        kw_raw = len(self.all_jobs) - kw_before
        logger.info(f'关键词 [{keyword}] 完成: 原始 {kw_raw} 条 → 标准化 {len(results)} 条')
        return results

    # ========== 详情获取 ==========

    def _fetch_keyword_details(self, new_keys: set):
        """批量获取岗位详情（通过详情页API拦截+DOM回退）"""
        jobs_needing_detail = [
            (k, j) for k, j in self.all_jobs.items()
            if k in new_keys and j.get('security_id') and not j.get('full_desc')
        ]
        if not jobs_needing_detail:
            return

        total = len(jobs_needing_detail)
        success = fail = consecutive_fail = 0

        for idx, (key, job) in enumerate(jobs_needing_detail, 1):
            if not self._browser_alive():
                logger.warning(f'浏览器已断连，停止详情获取 (已完成 {idx-1}/{total})')
                break

            sid = job['security_id']
            try:
                eid = job.get('encrypt_job_id', '')
                got_desc = False

                if eid:
                    detail_page_url = f'https://www.zhipin.com/job_detail/{eid}.html'
                    if not self._safe_listen_start('wapi/zpgeek/job/detail.json'):
                        fail += 1
                        continue
                    self.page.get(detail_page_url)
                    random_delay(1.0, 2.0)
                    try:
                        r = self.page.listen.wait(timeout=4)
                        if r and r.response and r.response.body:
                            body = r.response.body
                            if isinstance(body, str):
                                body = json.loads(body)
                            desc = body.get('zpData', {}).get('jobInfo', {}).get('postDescription', '')
                            if desc:
                                job['full_desc'] = desc
                                success += 1
                                got_desc = True
                    except Exception:
                        pass
                    self._safe_listen_stop()

                    if not got_desc:
                        try:
                            desc_text = self.page.run_js(
                                'return document.querySelector(".job-sec-text")?.innerText || '
                                'document.querySelector(".job-detail-section .text")?.innerText || ""'
                            )
                            if desc_text and len(desc_text) > 20:
                                job['full_desc'] = desc_text
                                success += 1
                                got_desc = True
                        except Exception:
                            pass

                    if got_desc and random.random() < 0.1:
                        simulate_human(self.page)

                if not got_desc and not job.get('full_desc'):
                    try:
                        detail_url = f'{DETAIL_API}?securityId={sid}'
                        if not self._safe_listen_start('wapi/zpgeek/job/detail.json'):
                            fail += 1
                            continue
                        self.page.get(detail_url)
                        r = self.page.listen.wait(timeout=5)
                        if r and r.response and r.response.body:
                            body = r.response.body
                            if isinstance(body, str):
                                body = json.loads(body)
                            desc = body.get('zpData', {}).get('jobInfo', {}).get('postDescription', '')
                            if desc:
                                job['full_desc'] = desc
                                success += 1
                                got_desc = True
                        self._safe_listen_stop()
                    except Exception:
                        self._safe_listen_stop()

                if not job.get('full_desc'):
                    fail += 1
                    consecutive_fail += 1
                else:
                    consecutive_fail = 0

                if consecutive_fail >= 5:
                    print(f'  [WARN] 连续 {consecutive_fail} 次失败，休息 10s...')
                    time.sleep(random.uniform(8, 12))
                    consecutive_fail = 0

                if idx % 20 == 0:
                    print(f'  详情进度: {idx}/{total} (成功 {success}, 失败 {fail})')

                random_delay(DETAIL_DELAY_MIN, DETAIL_DELAY_MAX)

                if idx % DETAIL_BATCH_SIZE == 0:
                    pause = random.uniform(*DETAIL_BATCH_PAUSE)
                    print(f'  ☕ 批次休息 {pause:.0f}s...')
                    simulate_human(self.page)
                    time.sleep(pause)

            except Exception as e:
                logger.warning(f'获取详情失败 [{key}]: {e}')
                fail += 1
                self._safe_listen_stop()

        print(f'  [OK] 详情获取完成: 成功 {success}/{total}, 失败 {fail}')

    # ========== 中断保护 ==========

    def _save_partial(self):
        """将已完成关键词的结果写入文件，Ctrl+C 不会丢数据"""
        if not self._partial_results:
            return
        try:
            data = {
                'count': len(self._partial_results),
                'saved_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'jobs': self._partial_results,
            }
            self._partial_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8'
            )
        except Exception as e:
            logger.warning(f'保存中间结果失败: {e}')

    def _setup_signal_handler(self):
        """注册 Ctrl+C 信号处理，退出前自动保存"""
        import signal
        def _handle(signum, frame):
            if self._stopped:
                return  # 第二次 Ctrl+C，直接退出
            self._stopped = True
            print(f'\n\n⏸  收到中断信号，正在保存已爬取数据...')
            self._save_partial()
            print(f'[SAVE] 已保存 {len(self._partial_results)} 条到 {self._partial_file}')
            print(f'   下次运行可指定 --partial 加载已有数据继续')
            # 尝试关闭浏览器
            try:
                if self.page:
                    self.page.quit()
            except Exception:
                pass
            import sys
            sys.exit(0)
        try:
            signal.signal(signal.SIGINT, _handle)
        except Exception:
            pass  # 某些环境不支持 signal

    def _load_partial(self):
        """加载历史中途保存的结果"""
        if self._partial_file.exists():
            try:
                data = json.loads(self._partial_file.read_text(encoding='utf-8'))
                return data.get('jobs', [])
            except Exception:
                pass
        return []

    # ========== 完整流程 ==========

    def run(self, keywords=None, cities=None, headless=False,
            scroll_target=DEFAULT_SCROLL_TARGET):
        """
        完整抓取流程。
        keywords: 关键词列表，默认从 config 加载
        cities: 城市字典 {城市名: 城市码}，默认从 config 加载
        scroll_target: 每个关键词、城市组合的目标采集数
        """
        if keywords is None:
            keywords = load_keywords(self.config_file)
        if cities is None:
            cities = load_cities(self.config_file)
        if scroll_target is None:
            scroll_target = load_scrape_limits(self.config_file)['scroll_target']

        self._setup_signal_handler()
        self.start_browser(headless=headless)
        first_city = list(cities.values())[0]
        if not self.ensure_login(first_city):
            self.page.quit()
            return []

        if headless and self._headless_requested:
            print('↻ 登录完成，切换为后台模式运行...')
            self.page.quit()
            from DrissionPage import ChromiumPage
            co = self._build_options(headless=True)
            self.page = ChromiumPage(addr_or_opts=co)

        if self._crawl_started_cb:
            try:
                self._crawl_started_cb()
            except Exception:
                pass

        self._processed_keys = set()
        mode_label = f'滚动(目标{scroll_target}条)'
        total_kws = len(keywords)
        print(f'\n[STATS] [{mode_label}] {total_kws} 关键词 × {len(cities)} 城市')

        kw_list = list(keywords)
        random.shuffle(kw_list)

        all_results = []
        t_start = time.time()

        for kw_idx, kw in enumerate(kw_list, 1):
            if self._stopped:
                break
            if not self._browser_alive():
                logger.warning(f'浏览器已断连，停止爬取 (已完成 {kw_idx-1}/{total_kws} 关键词)')
                break

            elapsed = time.time() - t_start
            print(f'\n[{kw_idx}/{total_kws}] 关键词: {kw}  (已用{elapsed/60:.1f}分)')

            try:
                kw_results = self.run_keyword(kw, cities, scroll_target=scroll_target)
                all_results.extend(kw_results)
                self._partial_results = list(all_results)  # 同步
                self._save_partial()  # 每个关键词完成后立即落盘
            except Exception as e:
                logger.error(f'关键词 [{kw}] 爬取失败: {e}')

            if self._keyword_done_cb:
                try:
                    self._keyword_done_cb(kw, len(all_results), kw_idx, total_kws)
                except Exception:
                    pass

            if kw_idx < total_kws:
                rest = random.uniform(KEYWORD_REST_MIN, KEYWORD_REST_MAX)
                print(f'  ☕ 关键词切换休息 {rest:.0f}s...')
                simulate_human(self.page)
                time.sleep(rest)

        elapsed_total = (time.time() - t_start) / 60
        try:
            self.page.quit()
        except Exception:
            pass
        print(f'\n[OK] 完成! 耗时 {elapsed_total:.1f} 分钟')
        print(f'   强相关岗位: {len(all_results)} 条 | 过滤非相关: {self.skipped} 条')

        # 最终保存，完成后清理临时文件
        if all_results:
            self._partial_results = all_results
            self._save_partial()
        else:
            try:
                self._partial_file.unlink(missing_ok=True)
            except Exception:
                pass

        return all_results

    def set_progress_callback(self, cb):
        """进度回调: cb(combo_idx, total_combos, keyword, city_name, total_jobs)"""
        self._progress_cb = cb

    def set_keyword_done_callback(self, cb):
        """关键词完成回调: cb(keyword, total_jobs_so_far, kw_idx, total_kws)"""
        self._keyword_done_cb = cb

    def set_crawl_started_callback(self, cb):
        """登录完成并准备开始采集时的回调。"""
        self._crawl_started_cb = cb


# ==================== CLI ====================

def main():
    parser = argparse.ArgumentParser(description='BOSS直聘 AI PM 岗位采集')
    parser.add_argument('--gui', action='store_true', help='打开 Figma/QML 图形化界面')
    parser.add_argument('--city', type=str, help='只抓指定城市')
    parser.add_argument('--quick', action='store_true', help='快速模式（随机抽取关键词）')
    parser.add_argument('--target', type=int, default=None, metavar='N',
                        help=f'每个关键词、城市组合的目标岗位数（默认{DEFAULT_SCROLL_TARGET}）')
    parser.add_argument('--merge', action='store_true', help='自动合并到已有数据')
    parser.add_argument('--login', action='store_true', help='仅登录保存Cookie')
    parser.add_argument('--headless', action='store_true', help='无头模式')
    parser.add_argument('--config', type=str, help='keywords.json 路径')
    parser.add_argument('--profile', type=str, help='Chrome Profile 目录')
    parser.add_argument('--db', type=str, default=None, help='SQLite 数据库文件路径')
    parser.add_argument('--data', type=str, default=None, help='兼容旧参数：SQLite 数据库文件路径')
    parser.add_argument('--history', type=str, default='history', help='快照保存目录')
    parser.add_argument('--partial-file', type=str, default='crawl_partial.json', help='中途保存路径（Ctrl+C 断点续爬）')
    parser.add_argument('--scroll-max-scrolls', type=int, help='滚动模式最多滚动次数')
    parser.add_argument('--process-partial', type=str, nargs='?', const='', default=None,
                        metavar='FILE', help='直接处理中断保存的 partial 文件（默认 crawl_partial.json），跳过爬虫')
    args = parser.parse_args()

    if args.gui:
        from .qml_gui import main as qml_gui_main
        qml_gui_main()
        return

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(name)s] %(message)s'
    )

    config_file = args.config
    
    # Resolve project directory if config_file is provided
    project_dir = None
    if config_file:
        p = Path(config_file)
        if p.is_dir():
            project_dir = p
        else:
            project_dir = p.parent

    # DB default resolution
    if args.db or args.data:
        db_file = args.db or args.data
    elif project_dir:
        db_file = str(project_dir / 'jobs_data.db')
    else:
        db_file = 'jobs_data.db'

    # Partial file resolution
    if args.partial_file == 'crawl_partial.json' and project_dir:
        partial_file = str(project_dir / 'crawl_partial.json')
    else:
        partial_file = args.partial_file

    cities = load_cities(config_file)
    keywords = load_keywords(config_file, quick=args.quick)

    if args.city:
        cities = {k: v for k, v in cities.items() if k == args.city}
        if not cities:
            print(f'未找到城市: {args.city}')
            return

    crawler = BossCrawler(
        profile_dir=args.profile,
        config_file=config_file,
        partial_file=partial_file,
        scroll_max_scrolls=args.scroll_max_scrolls,
    )

    if args.process_partial is not None:
        from .pipeline import process_batch, MIN_AVG_SALARY_K
        from .db import upsert_jobs, save_run

        partial_path = Path(args.process_partial if args.process_partial else partial_file)
        if not partial_path.exists():
            print(f'[X] 未找到文件: {partial_path}')
            return

        with open(partial_path, 'r', encoding='utf-8') as f:
            partial_data = json.load(f)
        raw_jobs = partial_data.get('jobs', partial_data if isinstance(partial_data, list) else [])
        print(f'[>>] 读取 {partial_path}: {len(raw_jobs)} 条原始数据')

        config = load_config(config_file)
        cat_rules = config.get('cat_rules')
        relevance_keywords = config.get('relevance_keywords')
        blacklist_keywords = config.get('blacklist_keywords')
        min_salary = float(config.get('min_salary', MIN_AVG_SALARY_K))
        cleaned = process_batch(raw_jobs, cat_rules=cat_rules, min_salary=min_salary, relevance_keywords=relevance_keywords, blacklist_keywords=blacklist_keywords)
        print(f'[*] 清洗后: {len(cleaned)} 条 (过滤薪资<{min_salary}K / 非相关)')

        if args.merge:
            stats = upsert_jobs(cleaned, db_file)
            save_run(
                db_file,
                mode='process_partial',
                raw_count=len(raw_jobs),
                cleaned_count=len(cleaned),
                added_count=stats['inserted'],
                note=f'partial={partial_path}',
            )
            print(f'[OK] 已写入 SQLite: {db_file}，新增 {stats["inserted"]} 条，刷新 {stats["updated"]} 条')
        else:
            print(f'\n清洗结果预览 ({len(cleaned)} 条):')
            for j in cleaned[:10]:
                cats = ', '.join(j.get('cats', []))
                print(f'  [{j["tier"]}] {j["title"]} | {j["company"]} | {j["city"]} | {j["salary"]} | {cats}')
            if len(cleaned) > 10:
                print(f'  ... 还有 {len(cleaned) - 10} 条')
            print(f'\n[TIP] 如需合并到主数据，请加 --merge 参数')
        return

    if args.login:
        crawler.start_browser(headless=False)
        first_city = list(cities.values())[0]
        crawler.ensure_login(first_city)
        print('[OK] 登录完成，Cookie 已保存到持久化 Profile')
        print('   以后自动运行无需再登录')
        crawler.page.quit()
        return

    raw_jobs = crawler.run(keywords, cities, headless=args.headless,
                           scroll_target=args.target)

    if args.merge and raw_jobs:
        from .pipeline import process_batch
        from .db import upsert_jobs, save_run

        config = load_config(config_file)
        cat_rules = config.get('cat_rules')
        relevance_keywords = config.get('relevance_keywords')
        blacklist_keywords = config.get('blacklist_keywords')
        min_salary = float(config.get('min_salary', 17.0)) # default from package pipeline is MIN_AVG_SALARY_K
        cleaned = process_batch(raw_jobs, cat_rules=cat_rules, min_salary=min_salary, relevance_keywords=relevance_keywords, blacklist_keywords=blacklist_keywords)
        print(f'清洗后: {len(cleaned)} 条 (过滤最低薪资: {min_salary}K)')

        stats = upsert_jobs(cleaned, db_file)
        save_run(
            db_file,
            keywords=keywords,
            cities=list(cities.keys()),
            mode='scroll',
            raw_count=len(raw_jobs),
            cleaned_count=len(cleaned),
            added_count=stats['inserted'],
        )
        print(f'[OK] 已写入 SQLite: {db_file}，新增 {stats["inserted"]} 条，刷新 {stats["updated"]} 条')
    elif raw_jobs:
        print(f'\n抓取到 {len(raw_jobs)} 条强相关岗位:')
        for j in raw_jobs[:10]:
            print(f'  {j["title"]} | {j["company"]} | {j["city"]} | {j["salary"]}')
        if len(raw_jobs) > 10:
            print(f'  ... 还有 {len(raw_jobs)-10} 条')
    else:
        print('[WARN] 未抓取到任何数据')


if __name__ == '__main__':
    main()
