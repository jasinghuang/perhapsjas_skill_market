from __future__ import annotations

import subprocess
import sys
from pathlib import Path

DEV = Path(__file__).resolve().parents[1]
DEV_RUNNER = DEV / "runner.py"
TEMPLATE = DEV / "SKILL.template.md"
BUILD = DEV / "build_skill.py"
SKILL_DIR = DEV.parents[1] / "plugins" / "video-toolkit" / "skills" / "video-tts"
SKILL = SKILL_DIR / "SKILL.md"
RUNNER = SKILL_DIR / "runner.py"


def test_distribution_contains_two_files():
    files = sorted(path.name for path in SKILL_DIR.iterdir())
    assert files == ["SKILL.md", "runner.py"]


def test_checked_in_skill_matches_template():
    assert SKILL.read_text(encoding="utf-8") == TEMPLATE.read_text(encoding="utf-8")


def test_checked_in_runner_matches_source():
    assert RUNNER.read_text(encoding="utf-8") == DEV_RUNNER.read_text(encoding="utf-8")


def test_skill_md_does_not_embed_the_runner():
    text = SKILL.read_text(encoding="utf-8")
    assert "<!-- runner:" not in text
    assert "@@RUNNER_BLOCK@@" not in text
    assert "```python" not in text
    assert "def main(" not in text


def test_checked_in_runner_compiles(tmp_path):
    import py_compile

    # Compile to a temp cfile so the distribution directory stays at two files.
    py_compile.compile(
        str(RUNNER),
        cfile=str(tmp_path / "runner.pyc"),
        doraise=True,
    )


def test_build_outputs_are_current():
    result = subprocess.run(
        [sys.executable, str(BUILD), "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
