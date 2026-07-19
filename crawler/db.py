"""SQLite storage for crawled BOSS jobs."""
import datetime
import json
import re
import sqlite3
from pathlib import Path
from typing import Iterable


DEFAULT_DB_FILE = Path('jobs_data.db')
JOB_DETAIL_ID_RE = re.compile(r'/job_detail/([^/?#]+)\.html')


def _json_dumps(value) -> str:
    return json.dumps(value or [], ensure_ascii=False)


def _json_loads(value):
    if not value:
        return []
    try:
        return json.loads(value)
    except Exception:
        return []


def connect(db_file=None):
    path = Path(db_file or DEFAULT_DB_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def init_db(conn: sqlite3.Connection):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_key TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            city TEXT,
            salary TEXT,
            avg REAL DEFAULT 0,
            tier TEXT,
            exp TEXT,
            edu TEXT,
            cats_json TEXT,
            kw_json TEXT,
            desc TEXT,
            url TEXT,
            source TEXT DEFAULT 'boss',
            first_seen TEXT,
            last_seen TEXT,
            crawled_at TEXT,
            is_new INTEGER DEFAULT 0,
            security_id TEXT,
            raw_json TEXT
        )
    ''')
    columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
    if "security_id" not in columns:
        conn.execute("ALTER TABLE jobs ADD COLUMN security_id TEXT")
    conn.execute('CREATE INDEX IF NOT EXISTS idx_jobs_city ON jobs(city)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs(title)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_jobs_last_seen ON jobs(last_seen)')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS crawl_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT,
            finished_at TEXT,
            keywords_json TEXT,
            cities_json TEXT,
            mode TEXT,
            raw_count INTEGER DEFAULT 0,
            cleaned_count INTEGER DEFAULT 0,
            added_count INTEGER DEFAULT 0,
            db_file TEXT,
            note TEXT
        )
    ''')
    conn.commit()


def _job_key(job: dict) -> str:
    return str(job.get('_key') or '').strip()


def _encrypt_job_id(url: str) -> str:
    match = JOB_DETAIL_ID_RE.search(str(url or '').strip())
    return match.group(1) if match else ''


def load_existing_job_index(db_file=None) -> dict:
    """Load lightweight identities used to skip detail reads for known jobs."""
    conn = connect(db_file)
    try:
        rows = conn.execute(
            'SELECT id, job_key, url, raw_json FROM jobs'
        ).fetchall()
    finally:
        conn.close()

    by_encrypt_id: dict[str, int] = {}
    by_job_key: dict[str, int] = {}
    for row in rows:
        row_id = int(row['id'])
        job_key = str(row['job_key'] or '').strip()
        if job_key:
            by_job_key[job_key] = row_id

        encrypt_id = _encrypt_job_id(row['url'])
        if not encrypt_id and row['raw_json']:
            try:
                raw = json.loads(row['raw_json'])
            except (TypeError, json.JSONDecodeError):
                raw = {}
            encrypt_id = str(raw.get('encrypt_job_id') or '').strip()
            if not encrypt_id:
                encrypt_id = _encrypt_job_id(raw.get('url'))
        if encrypt_id:
            by_encrypt_id[encrypt_id] = row_id

    return {
        'by_encrypt_id': by_encrypt_id,
        'by_job_key': by_job_key,
        'job_count': len(rows),
    }


def touch_existing_jobs(job_ids: Iterable[int], db_file=None) -> int:
    """Refresh last-seen dates without pretending saved details were re-fetched."""
    normalized_ids = sorted({int(job_id) for job_id in job_ids if int(job_id) > 0})
    if not normalized_ids:
        return 0

    today = datetime.date.today().isoformat()
    conn = connect(db_file)
    updated = 0
    try:
        # Keep below SQLite's default parameter limit.
        for offset in range(0, len(normalized_ids), 500):
            batch = normalized_ids[offset:offset + 500]
            placeholders = ','.join('?' for _ in batch)
            cursor = conn.execute(
                f'''
                    UPDATE jobs
                    SET last_seen = ?, is_new = 0
                    WHERE id IN ({placeholders})
                ''',
                (today, *batch),
            )
            updated += max(0, int(cursor.rowcount or 0))
        conn.commit()
    finally:
        conn.close()
    return updated


def upsert_jobs(jobs: Iterable[dict], db_file=None) -> dict:
    """Insert or refresh cleaned jobs. Returns basic merge stats."""
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    today = datetime.date.today().isoformat()
    inserted = updated = skipped = 0

    conn = connect(db_file)
    try:
        for job in jobs:
            if not isinstance(job, dict):
                skipped += 1
                continue
            key = _job_key(job)
            title = str(job.get('title') or '').strip()
            company = str(job.get('company') or '').strip()
            if not key or not title or not company:
                skipped += 1
                continue

            existing = conn.execute(
                'SELECT id FROM jobs WHERE job_key = ?', (key,)
            ).fetchone()
            payload = (
                key,
                title,
                company,
                str(job.get('city') or '').strip(),
                str(job.get('salary') or '').strip(),
                float(job.get('avg') or 0),
                str(job.get('tier') or '').strip(),
                str(job.get('exp') or '').strip(),
                str(job.get('edu') or '').strip(),
                _json_dumps(job.get('cats')),
                _json_dumps(job.get('kw')),
                str(job.get('desc') or '').strip(),
                str(job.get('url') or '').strip(),
                str(job.get('_source') or 'boss'),
                str(job.get('_date') or today),
                str(job.get('_crawled_at') or now),
                str(job.get('security_id') or '').strip(),
                _json_dumps(job),
            )
            if existing:
                conn.execute('''
                    UPDATE jobs
                    SET title = ?, company = ?, city = ?, salary = ?, avg = ?,
                        tier = ?, exp = ?, edu = ?, cats_json = ?, kw_json = ?,
                        desc = ?, url = ?, source = ?, last_seen = ?,
                        crawled_at = ?, is_new = 0, security_id = ?, raw_json = ?
                    WHERE job_key = ?
                ''', payload[1:] + (key,))
                updated += 1
            else:
                conn.execute('''
                    INSERT INTO jobs (
                        job_key, title, company, city, salary, avg, tier, exp,
                        edu, cats_json, kw_json, desc, url, source, first_seen,
                        last_seen, crawled_at, is_new, security_id, raw_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                ''', payload[:15] + (payload[14], payload[15], payload[16], payload[17]))
                inserted += 1

        conn.commit()
    finally:
        conn.close()

    return {
        'input': inserted + updated + skipped,
        'inserted': inserted,
        'updated': updated,
        'skipped': skipped,
    }


def load_jobs(db_file=None) -> list:
    conn = connect(db_file)
    try:
        rows = conn.execute(
            'SELECT * FROM jobs ORDER BY avg DESC, last_seen DESC, id DESC'
        ).fetchall()
    finally:
        conn.close()
    jobs = []
    for row in rows:
        jobs.append({
            'title': row['title'],
            'company': row['company'],
            'city': row['city'],
            'salary': row['salary'],
            'avg': row['avg'],
            'tier': row['tier'],
            'exp': row['exp'],
            'edu': row['edu'],
            'cats': _json_loads(row['cats_json']),
            'kw': _json_loads(row['kw_json']),
            'desc': row['desc'],
            'url': row['url'],
            'is_new': bool(row['is_new']),
            '_key': row['job_key'],
            '_date': row['last_seen'],
            '_crawled_at': row['crawled_at'],
        })
    return jobs


def save_run(db_file=None, **kwargs):
    conn = connect(db_file)
    try:
        conn.execute('''
            INSERT INTO crawl_runs (
                started_at, finished_at, keywords_json, cities_json, mode,
                raw_count, cleaned_count, added_count, db_file, note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            kwargs.get('started_at'),
            kwargs.get('finished_at') or datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            _json_dumps(kwargs.get('keywords')),
            _json_dumps(kwargs.get('cities')),
            kwargs.get('mode') or '',
            int(kwargs.get('raw_count') or 0),
            int(kwargs.get('cleaned_count') or 0),
            int(kwargs.get('added_count') or 0),
            str(db_file or DEFAULT_DB_FILE),
            kwargs.get('note') or '',
        ))
        conn.commit()
    finally:
        conn.close()
