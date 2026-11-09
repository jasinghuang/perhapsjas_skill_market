"""Load the single-file runner for tests without installing it as a package."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
DEV_DIR = TESTS_DIR.parent
RUNNER_PATH = DEV_DIR / "runner.py"

sys.path.insert(0, str(TESTS_DIR))

_spec = importlib.util.spec_from_file_location("video_tts_runner", RUNNER_PATH)
assert _spec is not None and _spec.loader is not None
runner = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = runner
_spec.loader.exec_module(runner)


@pytest.fixture(scope="session")
def r():
    runner.check_tools()
    return runner


@pytest.fixture()
def ffmpeg_available() -> bool:
    import shutil

    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
