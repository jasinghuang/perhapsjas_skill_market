from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

DEV = Path(__file__).resolve().parents[1]
RUNNER = DEV / "runner.py"
BUILD = DEV / "build_skill.py"
SKILL = DEV.parents[1] / "plugins" / "video-toolkit" / "skills" / "video-tts" / "SKILL.md"


def extract_runner() -> str:
    text = SKILL.read_text(encoding="utf-8")
    block = text.rsplit("<!-- runner:start -->", 1)[1].rsplit("<!-- runner:end -->", 1)[0]
    lines = block.strip().splitlines()
    return "\n".join(lines[1:-1]) + "\n"


def test_skill_md_contains_exact_runner_source():
    assert extract_runner() == RUNNER.read_text(encoding="utf-8")


def test_skill_md_is_current():
    result = subprocess.run(
        [sys.executable, str(BUILD), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_extracted_runner_compiles(tmp_path):
    target = tmp_path / "runner.py"
    target.write_text(extract_runner(), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "py_compile", str(target)],
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")


def test_distribution_skill_dir_contains_only_skill_md():
    files = sorted(path.name for path in SKILL.parent.iterdir())
    assert files == ["SKILL.md"]
