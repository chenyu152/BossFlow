"""增量合并：将新抓取的岗位与现有数据去重合并"""
import csv
import json
import logging
import datetime
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger('merger')

JOB_DETAIL_RE = re.compile(r'^https://www\.zhipin\.com/job_detail/[A-Za-z0-9_.-]+\.html$')


def _norm_text(value) -> str:
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def _valid_job_url(url: str) -> bool:
    return bool(JOB_DETAIL_RE.match(str(url or '').strip()))


def _job_identity(job: dict) -> tuple:
    """生成岗位唯一标识（优先用URL，回退到文本特征）"""
    url = _norm_text(job.get('url') or job.get('link'))
    if _valid_job_url(url):
        return ('url', url)
    return (
        'text',
        _norm_text(job.get('title')).lower(),
        _norm_text(job.get('company')).lower(),
        _norm_text(job.get('city')).lower(),
        _norm_text(job.get('salary')).lower(),
    )


def _job_score(job: dict) -> tuple:
    """岗位数据完整度评分（越高越好，用于重复时选优）"""
    url = _norm_text(job.get('url') or job.get('link'))
    desc = _norm_text(job.get('desc'))
    return (
        1 if _valid_job_url(url) else 0,
        1 if _norm_text(job.get('company')) else 0,
        1 if _norm_text(job.get('salary')) else 0,
        len(desc),
        _norm_text(job.get('_date')),
        _norm_text(job.get('_crawled_at')),
    )


def clean_jobs(jobs: list) -> tuple:
    """清洗岗位列表：去无效、去重、修URL"""
    cleaned_by_key = {}
    removed_invalid = 0
    removed_duplicate = 0
    stripped_bad_url = 0

    for raw in jobs:
        if not isinstance(raw, dict):
            removed_invalid += 1
            continue

        job = dict(raw)
        title = _norm_text(job.get('title'))
        company = _norm_text(job.get('company'))
        city = _norm_text(job.get('city'))
        salary = _norm_text(job.get('salary'))
        url = _norm_text(job.get('url') or job.get('link'))

        if url and not _valid_job_url(url):
            job.pop('url', None)
            job.pop('link', None)
            stripped_bad_url += 1
            url = ''

        if not title or not company or not city or not salary:
            removed_invalid += 1
            continue

        job['title'] = title
        job['city'] = city
        job['salary'] = salary
        if company:
            job['company'] = company
        if url:
            job['url'] = url

        identity = _job_identity(job)
        existing = cleaned_by_key.get(identity)
        if existing is None:
            cleaned_by_key[identity] = job
        elif _job_score(job) > _job_score(existing):
            cleaned_by_key[identity] = job
            removed_duplicate += 1
        else:
            removed_duplicate += 1

    cleaned = list(cleaned_by_key.values())
    cleaned.sort(key=lambda x: -float(x.get('avg') or 0))
    stats = {
        'input': len(jobs),
        'output': len(cleaned),
        'removed_invalid': removed_invalid,
        'removed_duplicate': removed_duplicate,
        'stripped_bad_url': stripped_bad_url,
    }
    return cleaned, stats


def load_existing(data_file: Path) -> tuple:
    """加载已有数据，返回 (key_set, jobs_list)"""
    if not data_file.exists():
        return set(), []
    with open(data_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    jobs = data.get('jobs', data if isinstance(data, list) else [])
    jobs = [j for j in jobs if isinstance(j, dict)]
    key_set = set()
    for j in jobs:
        key_set.add(_job_identity(j))
    return key_set, jobs


def merge(existing_jobs: list, existing_keys: set, new_jobs: list) -> tuple:
    """
    增量合并：新岗位加入，已存在的刷新日期。
    返回 (merged_list, added_count)
    """
    added = []
    refreshed = 0
    today_str = datetime.date.today().isoformat()

    key_to_idx = {}
    for i, ej in enumerate(existing_jobs):
        key_to_idx[_job_identity(ej)] = i

    for job in new_jobs:
        key = _job_identity(job)
        if key not in existing_keys:
            existing_keys.add(key)
            job['_new'] = True
            added.append(job)
        elif key in key_to_idx:
            idx = key_to_idx[key]
            existing_jobs[idx]['_date'] = today_str
            if not existing_jobs[idx].get('_crawled_at') and job.get('_crawled_at'):
                existing_jobs[idx]['_crawled_at'] = job['_crawled_at']
            refreshed += 1

    merged = existing_jobs + added
    merged.sort(key=lambda x: -x.get('avg', 0))

    logger.info(f'Merge: {len(existing_jobs)} existing + {len(added)} new = {len(merged)} total (refreshed {refreshed} dates)')
    return merged, len(added)


def save(jobs: list, data_file: Path, clean: bool = False):
    """保存岗位数据到 JSON 文件"""
    if clean:
        jobs, clean_stats = clean_jobs(jobs)
    else:
        jobs = [j for j in jobs if isinstance(j, dict)]
        clean_stats = {
            'input': len(jobs),
            'output': len(jobs),
            'removed_invalid': 0,
            'removed_duplicate': 0,
            'stripped_bad_url': 0,
        }
    meta = {
        'updated': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
        'total': len(jobs),
        'cleaned': clean_stats,
    }
    KEEP = {'_key', '_date', '_crawled_at'}
    frontend_jobs = []
    for j in jobs:
        fj = {
            k: v for k, v in j.items()
            if k != 'is_new' and (not k.startswith('_') or k in KEEP)
        }
        if j.get('_new'):
            fj['is_new'] = True
        frontend_jobs.append(fj)

    with open(data_file, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'jobs': frontend_jobs}, f, ensure_ascii=False)

    logger.info(f'Saved {len(jobs)} jobs to {data_file} ({clean_stats})')


def save_snapshot(new_jobs: list, history_dir: Path):
    """保存每日快照"""
    today = datetime.date.today().isoformat()
    history_dir.mkdir(parents=True, exist_ok=True)
    snap_file = history_dir / f'{today}.json'
    with open(snap_file, 'w', encoding='utf-8') as f:
        json.dump(new_jobs, f, ensure_ascii=False)
    logger.info(f'Snapshot saved: {snap_file} ({len(new_jobs)} jobs)')


CSV_COLUMNS = [
    'title', 'company', 'city', 'salary', 'avg', 'tier',
    'exp', 'edu', 'cats', 'kw', 'desc', 'url',
    'is_new', '_date', '_crawled_at',
]

CSV_HEADERS = [
    '岗位名称', '公司', '城市', '薪资', '月均(K)', '薪资区间',
    '经验', '学历', '分类', '关键词', '描述', '链接',
    '新增', '日期', '爬取时间',
]


def save_csv(jobs: list, csv_path: Path):
    """将岗位数据导出为 CSV 表格（UTF-8 BOM，Excel 直接打开不乱码）"""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for j in jobs:
        if not isinstance(j, dict):
            continue
        row = {}
        for col, header in zip(CSV_COLUMNS, CSV_HEADERS):
            value = j.get(col, '')
            if isinstance(value, list):
                value = ' / '.join(str(v) for v in value)
            elif isinstance(value, (int, float)):
                value = value
            else:
                value = str(value or '')
            row[header] = value
        rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(rows)

    logger.info(f'CSV exported: {csv_path} ({len(rows)} rows)')
