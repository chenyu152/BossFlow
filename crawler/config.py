"""配置管理 — 单例模式加载 keywords.json"""
import json
from pathlib import Path
from typing import Optional

PACKAGE_DIR = Path(__file__).parent
DEFAULT_CONFIG_FILE = PACKAGE_DIR / 'config' / 'keywords.json'
DEFAULT_SCRAPE_LIMITS = {
    'scroll_target': 20,
    'scroll_max_scrolls': 60,
}

_config_cache = None
_config_path = None


def set_config_path(path: str):
    """设置配置文件路径（在首次调用 get_config 之前）"""
    global _config_path, _config_cache
    _config_path = Path(path)
    _config_cache = None


def get_config(config_file: Optional[str] = None) -> dict:
    """获取配置（带缓存）"""
    global _config_cache, _config_path
    path = Path(config_file) if config_file else (_config_path or DEFAULT_CONFIG_FILE)
    if path.is_dir():
        path = path / 'config.json'
    if _config_cache is not None and path == (_config_path or DEFAULT_CONFIG_FILE):
        return _config_cache
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            _config_cache = json.load(f)
    else:
        _config_cache = {}
    _config_cache.setdefault('scrape_limits', DEFAULT_SCRAPE_LIMITS.copy())
    return _config_cache


def save_config(config: dict, config_file: Optional[str] = None):
    """保存配置，保留 UTF-8 中文内容。"""
    global _config_cache, _config_path
    path = Path(config_file) if config_file else (_config_path or DEFAULT_CONFIG_FILE)
    if path.is_dir():
        path = path / 'config.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    _config_cache = config
    _config_path = path


def get_keywords(config_file: Optional[str] = None) -> list:
    return get_config(config_file).get('keywords', [])


def get_cities(config_file: Optional[str] = None) -> dict:
    return get_config(config_file).get('cities', {})


def get_cat_rules(config_file: Optional[str] = None) -> dict:
    return get_config(config_file).get('cat_rules', {})


def get_scrape_limits(config_file: Optional[str] = None) -> dict:
    limits = DEFAULT_SCRAPE_LIMITS.copy()
    limits.update(get_config(config_file).get('scrape_limits', {}))
    return limits
