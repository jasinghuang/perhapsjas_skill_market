from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from helpers import base_task, write_task

RUNNER = Path(__file__).resolve().parents[1] / "runner.py"


def run_cli(*args, timeout=180):
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return subprocess.run(
        [sys.executable, str(RUNNER), *args],
        capture_output=True,
        timeout=timeout,
        env=env,
    )


def test_detect_emits_json(r):
    result = run_cli("--detect")
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    payload = json.loads(result.stdout.decode("utf-8"))
    assert payload["os"]
    assert "local" in payload["routes"]
    assert "elevenlabs" in payload["routes"]
    assert payload["ffmpeg"]["path"]


def test_check_emits_json(r, tmp_path):
    path = write_task(tmp_path, base_task())
    result = run_cli("--check", "--task", str(path))
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    payload = json.loads(result.stdout.decode("utf-8"))
    assert payload["ok"] is True
    assert payload["mode"] == "narration"


def test_check_bad_task_returns_2(r, tmp_path):
    path = write_task(tmp_path, base_task(model_id="mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"))
    result = run_cli("--check", "--task", str(path))
    assert result.returncode == 2
    payload = json.loads(result.stdout.decode("utf-8"))
    assert payload["ok"] is False
    assert payload["error"]["exit_code"] == 2


def test_missing_task_returns_2(r):
    result = run_cli("--check", "--task", "/nonexistent/task.json")
    assert result.returncode == 2


def test_list_local_voices(r):
    result = run_cli("--list-voices", "--provider", "local")
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    payload = json.loads(result.stdout.decode("utf-8"))
    assert payload["ok"] is True
    speakers = [item["speaker"] for item in payload["voices"]]
    assert "serena" in speakers
    assert len(speakers) >= 9
