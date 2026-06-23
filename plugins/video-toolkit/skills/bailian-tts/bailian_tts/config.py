"""API Key 解析:env > bl config.json > 报错。"""
from __future__ import annotations
import json
import os
from pathlib import Path


class ApiKeyError(RuntimeError):
    """无法解析到可用的 DashScope API Key。"""


def _bl_config_path() -> Path:
    return Path.home() / ".bailian" / "config.json"


def _read_bl_config_key() -> str | None:
    path = _bl_config_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    # 兼容几种可能的结构
    if isinstance(data.get("api_key"), dict):
        return data["api_key"].get("value")
    if isinstance(data.get("api_key"), str):
        return data["api_key"]
    if data.get("dashscope", {}).get("api_key"):
        return data["dashscope"]["api_key"]
    return None


def resolve_api_key() -> str:
    """解析顺序:DASHSCOPE_API_KEY env > bl config.json 明文 > 抛 ApiKeyError。"""
    key = os.environ.get("DASHSCOPE_API_KEY")
    if key:
        return key
    key = _read_bl_config_key()
    if key:
        return key
    raise ApiKeyError(
        "未找到 DashScope API Key。请执行 `export DASHSCOPE_API_KEY=sk-...`,"
        "或先 `bl auth login --api-key sk-...`。"
    )
