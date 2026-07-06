"""
BOSS直聘 AI PM 岗位爬虫 — 独立可复用包

核心用法:
    from crawler import BossCrawler, process_batch

    crawler = BossCrawler(profile_dir='./chrome_profile')
    crawler.run(keywords=['AI产品经理'], cities={'北京': '101010100'})

    # 带数据清洗和合并:
    cleaned = process_batch(raw_jobs)
    from crawler.merger import load_existing, merge, save, save_csv
    existing_keys, existing_jobs = load_existing(Path('jobs_data.json'))
    merged, added = merge(existing_jobs, existing_keys, cleaned)
    save(merged, Path('jobs_data.json'))
    save_csv(merged, Path('jobs_data.csv'))
"""

from .boss import BossCrawler, load_config, load_cities, load_keywords, load_scrape_limits, is_relevant
from .pipeline import (
    process_batch,
    process_one,
    parse_salary,
    classify,
    salary_tier,
    clean_desc,
    norm_city,
    dedup_key,
    DEFAULT_CAT_RULES,
    MIN_AVG_SALARY_K,
)
from .config import get_config, get_keywords, get_cities, get_cat_rules, get_scrape_limits, save_config, set_config_path
from .merger import save_csv
from .db import load_jobs, upsert_jobs

__version__ = '1.0.0'
__all__ = [
    # 爬虫
    'BossCrawler',
    'is_relevant',
    # 配置
    'load_config',
    'load_cities',
    'load_keywords',
    'load_scrape_limits',
    'get_config',
    'get_keywords',
    'get_cities',
    'get_cat_rules',
    'get_scrape_limits',
    'save_config',
    'set_config_path',
    # 数据清洗
    'process_batch',
    'process_one',
    'parse_salary',
    'classify',
    'salary_tier',
    'clean_desc',
    'norm_city',
    'dedup_key',
    'DEFAULT_CAT_RULES',
    'MIN_AVG_SALARY_K',
    # 导出
    'save_csv',
    'load_jobs',
    'upsert_jobs',
]
