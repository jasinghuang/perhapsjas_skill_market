#!/usr/bin/env python3
"""video-tts — 内部状态目录（spec §15.2）。

任务清单、内部完整报告、恢复材料默认保存在平台约定的应用目录，**不**
放进用户素材目录；用户只看到显式选择的交付成品：

- Windows：`%LOCALAPPDATA%\\video-toolkit\\video-tts\\`
- macOS：`~/Library/Caches/video-toolkit/video-tts/`
- 其他：`$XDG_CACHE_HOME`（默认 `~/.cache`）下同名目录
- `VIDEO_TTS_STATE_DIR` 显式覆盖（测试 / 自定义位置）

结构：`<root>/jobs/<job_id>/`（job.json、内部 report.json），
`<root>/segments/`（原生音频缓存，见 cache.py）。
"""

from __future__ import annotations

import os
import platform
from pathlib import Path


def app_state_root() -> Path:
    """内部状态根目录（尊重环境覆盖与平台约定）。"""
    override = os.environ.get("VIDEO_TTS_STATE_DIR")
    if override:
        return Path(override).expanduser()
    system = platform.system()
    if system == "Windows":
        base = Path(
            os.environ.get("LOCALAPPDATA")
            or (Path.home() / "AppData" / "Local")
        )
        return base / "video-toolkit" / "video-tts"
    if system == "Darwin":
        return Path.home() / "Library" / "Caches" / "video-toolkit" / "video-tts"
    base = os.environ.get("XDG_CACHE_HOME")
    cache_home = Path(base).expanduser() if base else Path.home() / ".cache"
    return cache_home / "video-toolkit" / "video-tts"


def jobs_root() -> Path:
    """所有任务的根目录：`<root>/jobs/`。"""
    return app_state_root() / "jobs"


def job_dir(job_id: str) -> Path:
    """单个任务的内部目录：`<root>/jobs/<job_id>/`。"""
    return jobs_root() / job_id
