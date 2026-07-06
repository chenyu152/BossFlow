import contextlib
import datetime as dt
import io
import logging
import threading
import traceback
from typing import Any, List, Optional

from fastapi import HTTPException


class QueueWriter(io.TextIOBase):
    def __init__(self, sink):
        self.sink = sink
        self.buffer = ""

    def write(self, text):
        if not text:
            return 0
        self.buffer += str(text)
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            line = line.rstrip("\r")
            if line:
                self.sink(line)
        return len(text)

    def flush(self):
        if self.buffer:
            self.sink(self.buffer.rstrip("\r"))
            self.buffer = ""


class QueueLogHandler(logging.Handler):
    def __init__(self, sink):
        super().__init__(logging.INFO)
        self.sink = sink

    def emit(self, record):
        try:
            self.sink(self.format(record))
        except Exception:
            pass


class TaskManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.worker: Optional[threading.Thread] = None
        self.current_crawler: Optional[Any] = None
        self.status = "ready"
        self.running = False
        self.logs: List[str] = []

    def append_log(self, message: str):
        with self.lock:
            timestamp = dt.datetime.now().strftime("%H:%M:%S")
            self.logs.append(f"[{timestamp}] {message}")
            self.logs = self.logs[-2000:]

    def snapshot(self):
        with self.lock:
            return {
                "running": self.running,
                "status": self.status,
                "logCount": len(self.logs),
                "logs": list(self.logs),
            }

    def start(self, label: str, target):
        with self.lock:
            if self.worker and self.worker.is_alive():
                raise HTTPException(status_code=409, detail="已有任务正在运行")
            self.status = label
            self.running = True
            self.logs.clear()
        self.append_log("任务已启动")

        def runner():
            try:
                target()
                self.append_log("任务结束")
                with self.lock:
                    self.status = "ready"
                    self.running = False
                    self.current_crawler = None
            except Exception:
                self.append_log(traceback.format_exc())
                with self.lock:
                    self.status = "failed"
                    self.running = False
                    self.current_crawler = None

        self.worker = threading.Thread(target=runner, daemon=True)
        self.worker.start()

    def stop(self):
        crawler = self.current_crawler
        if not crawler:
            self.append_log("当前没有可终止的爬虫实例")
            return
        self.append_log("收到终止请求，正在保存中断数据并关闭浏览器")
        with self.lock:
            self.status = "stopping"
        try:
            crawler._stopped = True
            crawler._save_partial()
            crawler._safe_listen_stop()
            if crawler.page:
                crawler.page.quit()
        except Exception:
            self.append_log(traceback.format_exc())


@contextlib.contextmanager
def capture_task_output(task_manager: TaskManager):
    writer = QueueWriter(task_manager.append_log)
    handler = QueueLogHandler(task_manager.append_log)
    handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s"))
    root_logger = logging.getLogger()
    old_level = root_logger.level
    if old_level > logging.INFO:
        root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)
    try:
        with contextlib.redirect_stdout(writer), contextlib.redirect_stderr(writer):
            yield
    finally:
        writer.flush()
        root_logger.removeHandler(handler)
        root_logger.setLevel(old_level)
