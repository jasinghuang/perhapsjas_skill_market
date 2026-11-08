import sys
from pathlib import Path

import pytest

# 让 tests/ 可以 import 上级目录的 skill 模块（srt_parse 等）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(autouse=True)
def _isolated_app_state(tmp_path, monkeypatch):
    """每个测试用独立的应用状态目录与音频缓存目录。

    内部状态（job.json / 内部报告）与原生音频缓存默认落在
    LOCALAPPDATA 等用户目录——测试必须重定向到 tmp，绝不污染真实环境。
    """
    monkeypatch.setenv("VIDEO_TTS_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("VIDEO_TTS_CACHE_DIR", str(tmp_path / "cache"))
