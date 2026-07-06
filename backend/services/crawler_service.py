import datetime as dt
import json
import random
from pathlib import Path

from backend.schemas.config import ConfigUpdate, CrawlRequest, ProcessPartialRequest
from backend.services.project_service import find_free_port, save_form_config
from backend.services.task_service import TaskManager, capture_task_output
from crawler.boss import BossCrawler
from crawler.db import save_run, upsert_jobs
from crawler.pipeline import MIN_AVG_SALARY_K, process_batch


def start_crawl_task(payload: CrawlRequest, task_manager: TaskManager) -> dict:
    project_dir, config, paths = save_form_config(payload)

    def worker():
        with capture_task_output(task_manager):
            keywords = list(config.get("keywords") or [])
            cities = dict(config.get("cities") or {})
            if payload.quickMode and len(keywords) > 10:
                keywords = random.sample(keywords, random.randint(6, 10))
            mode = ["standard", "greedy", "scroll"][max(0, min(int(payload.strategyIndex), 2))]
            limits = config.get("scrape_limits") or {}
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
                max_pages=int(limits.get("max_pages", payload.maxPages)),
                max_scrolls_per_page=int(limits.get("max_scrolls_per_page", 2)),
                scroll_max_scrolls=int(limits.get("scroll_max_scrolls", payload.scrollMax)),
                greedy_max_pages=int(limits.get("greedy_max_pages", 0)),
                max_jobs_per_city_round=int(limits.get("max_jobs_per_city_round", 0)),
            )
            task_manager.current_crawler = crawler
            raw_jobs = crawler.run(
                keywords=keywords,
                cities=cities,
                headless=bool(payload.headlessMode),
                greedy=mode == "greedy",
                scroll=mode == "scroll",
                scroll_target=int(payload.scrollTarget),
            )
            if payload.autoSqlite and raw_jobs:
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
                    started_at=dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
                    keywords=keywords,
                    cities=list(cities.keys()),
                    mode=mode,
                    raw_count=len(raw_jobs),
                    cleaned_count=len(cleaned),
                    added_count=stats["inserted"],
                )
                print(f"[OK] SQLite 写入完成: 新增 {stats['inserted']}，刷新 {stats['updated']}，跳过 {stats['skipped']}")

    task_manager.start("crawling", worker)
    return {"ok": True, "status": "crawling"}


def start_login_task(payload: ConfigUpdate, task_manager: TaskManager) -> dict:
    project_dir, config, paths = save_form_config(payload)

    def worker():
        with capture_task_output(task_manager):
            limits = config.get("scrape_limits") or {}
            port = find_free_port(9222)
            print(f"[INFO] Project: {project_dir.name}")
            print(f"[INFO] Chrome profile: {paths['profilePath']}")
            print(f"[INFO] Chrome debug port: {port}")
            crawler = BossCrawler(
                profile_dir=paths["profilePath"],
                chrome_port=port,
                config_file=paths["configPath"],
                partial_file=paths["partialPath"],
                max_pages=int(limits.get("max_pages", payload.maxPages)),
                max_scrolls_per_page=int(limits.get("max_scrolls_per_page", 2)),
                scroll_max_scrolls=int(limits.get("scroll_max_scrolls", payload.scrollMax)),
                greedy_max_pages=int(limits.get("greedy_max_pages", 0)),
                max_jobs_per_city_round=int(limits.get("max_jobs_per_city_round", 0)),
            )
            task_manager.current_crawler = crawler
            crawler.start_browser(headless=False)
            first_city = next(iter(config.get("cities") or {"北京": "101010100"}.values()))
            crawler.ensure_login(first_city)
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
