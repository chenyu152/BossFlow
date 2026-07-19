import datetime as dt
import json
import math
from pathlib import Path

from backend.schemas.config import ConfigUpdate, CrawlRequest, ProcessPartialRequest
from backend.services.project_service import find_free_port, save_form_config
from backend.services.login_state_service import record_login_verified
from backend.services.task_service import TaskManager, capture_task_output
from crawler.boss import BossCrawler
from crawler.db import (
    load_existing_job_index,
    save_run,
    touch_existing_jobs,
    upsert_jobs,
)
from crawler.pipeline import MIN_AVG_SALARY_K, process_batch


def start_crawl_task(payload: CrawlRequest, task_manager: TaskManager, on_complete=None) -> dict:
    project_dir, config, paths = save_form_config(payload, persist=payload.persistConfig)

    def worker():
        with capture_task_output(task_manager):
            keywords = list(config.get("keywords") or [])
            cities = dict(config.get("cities") or {})
            mode = "scroll"
            port = find_free_port(9222)
            print(f"[INFO] Project: {project_dir.name}")
            print(f"[INFO] Config: {paths['configPath']}")
            print(f"[INFO] Chrome profile: {paths['profilePath']}")
            print(f"[INFO] Chrome debug port: {port}")
            crawler = BossCrawler(
                profile_dir=paths["profilePath"],
                chrome_port=port,
                config_file=paths["configPath"],
                partial_file=paths["partialPath"],
                scroll_max_scrolls=max(20, math.ceil(payload.maxJobs / 10) + 10),
            )
            def mark_authenticated():
                record_login_verified(project_dir.name)
                task_manager.mark_crawl_authenticated()

            crawler.set_crawl_started_callback(mark_authenticated)
            if payload.autoSqlite:
                crawler.set_existing_job_index(load_existing_job_index(paths["dbPath"]))
            task_manager.current_crawler = crawler
            run_started_at = dt.datetime.now()
            raw_jobs = crawler.run(
                keywords=keywords,
                cities=cities,
                headless=bool(payload.headlessMode),
                new_job_target=int(payload.newJobTarget),
                max_jobs=int(payload.maxJobs),
            )
            reused_count = 0
            if payload.autoSqlite:
                reused_count = touch_existing_jobs(
                    crawler.seen_existing_job_ids,
                    paths["dbPath"],
                )
                if reused_count:
                    print(f"[OK] 已有岗位快速刷新: {reused_count} 条，未重复获取详情")
            if payload.autoSqlite:
                cleaned = []
                stats = {"inserted": 0, "updated": 0, "skipped": 0}
                if raw_jobs:
                    cleaned = process_batch(
                        raw_jobs,
                        cat_rules=config.get("cat_rules"),
                        min_salary=float(config.get("min_salary", MIN_AVG_SALARY_K)),
                        relevance_keywords=config.get("relevance_keywords"),
                        blacklist_keywords=config.get("blacklist_keywords"),
                    )
                    stats = upsert_jobs(cleaned, paths["dbPath"])
                save_run(
                    paths["dbPath"],
                    started_at=run_started_at.strftime("%Y-%m-%d %H:%M:%S"),
                    keywords=keywords,
                    cities=list(cities.keys()),
                    mode=mode,
                    raw_count=crawler.discovered_job_count,
                    cleaned_count=len(cleaned),
                    added_count=stats["inserted"],
                    note=f"detail={len(raw_jobs)}, reused={reused_count}",
                )
                print(f"[OK] SQLite 写入完成: 新增 {stats['inserted']}，刷新 {stats['updated']}，跳过 {stats['skipped']}")

    task_manager.start("crawling", worker, on_complete=on_complete)
    return {"ok": True, "status": "crawling"}


def start_login_task(payload: ConfigUpdate, task_manager: TaskManager) -> dict:
    project_dir, config, paths = save_form_config(payload)

    def worker():
        with capture_task_output(task_manager):
            port = find_free_port(9222)
            print(f"[INFO] Project: {project_dir.name}")
            print(f"[INFO] Chrome profile: {paths['profilePath']}")
            print(f"[INFO] Chrome debug port: {port}")
            crawler = BossCrawler(
                profile_dir=paths["profilePath"],
                chrome_port=port,
                config_file=paths["configPath"],
                partial_file=paths["partialPath"],
                scroll_max_scrolls=max(20, math.ceil(payload.maxJobs / 10) + 10),
            )
            task_manager.current_crawler = crawler
            crawler.start_browser(headless=False)
            first_city = next(iter(config.get("cities") or {"北京": "101010100"}.values()))
            if not crawler.ensure_login(first_city):
                raise RuntimeError("BOSS login was not verified; Cookie was not saved")
            record_login_verified(project_dir.name)
            if crawler.page:
                crawler.page.quit()

    task_manager.start("login", worker)
    return {"ok": True, "status": "login"}


def process_partial_task(payload: ProcessPartialRequest, task_manager: TaskManager) -> dict:
    _, config, paths = save_form_config(payload)

    def worker():
        with capture_task_output(task_manager):
            partial = Path(paths["partialPath"])
            if not partial.exists():
                raise FileNotFoundError(partial)
            data = json.loads(partial.read_text(encoding="utf-8"))
            raw_jobs = data.get("jobs", data if isinstance(data, list) else [])
            print(f"[INFO] 已读取中断文件: {partial}，共 {len(raw_jobs)} 条")
            if payload.autoSqlite:
                cleaned = process_batch(
                    raw_jobs,
                    cat_rules=config.get("cat_rules"),
                    min_salary=float(config.get("min_salary", MIN_AVG_SALARY_K)),
                    relevance_keywords=config.get("relevance_keywords"),
                    blacklist_keywords=config.get("blacklist_keywords"),
                )
                stats = upsert_jobs(cleaned, paths["dbPath"])
                save_run(
                    paths["dbPath"],
                    mode="process_partial",
                    raw_count=len(raw_jobs),
                    cleaned_count=len(cleaned),
                    added_count=stats["inserted"],
                    note=f"partial={partial}",
                )
                print(f"[OK] 清洗 {len(cleaned)}，新增 {stats['inserted']}，刷新 {stats['updated']}")

    task_manager.start("processing-partial", worker)
    return {"ok": True, "status": "processing-partial"}
