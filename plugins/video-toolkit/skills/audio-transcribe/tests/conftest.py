import sys
from pathlib import Path

# 让 tests/ 能 import 上级目录的 skill 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


import pytest

@pytest.fixture(autouse=True)
def isolated_job_cache(monkeypatch, tmp_path):
    monkeypatch.setenv("AUDIO_TRANSCRIBE_CACHE", str(tmp_path / "app-cache"))
