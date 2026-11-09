#!/usr/bin/env python3
"""Build (or verify) the two-file video-tts skill package.

Distribution contains exactly:
    plugins/video-toolkit/skills/video-tts/SKILL.md   (business instructions)
    plugins/video-toolkit/skills/video-tts/runner.py  (fixed executable)

runner.py never needs to enter the model context.  `--check` fails if either
checked-in file differs from the development sources.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNNER_SOURCE = HERE / "runner.py"
TEMPLATE = HERE / "SKILL.template.md"
TARGET_DIR = HERE.parents[1] / "plugins" / "video-toolkit" / "skills" / "video-tts"
TARGET_SKILL = TARGET_DIR / "SKILL.md"
TARGET_RUNNER = TARGET_DIR / "runner.py"


def render_skill() -> str:
    template = TEMPLATE.read_text(encoding="utf-8")
    if "@@RUNNER_BLOCK@@" in template or "<!-- runner:" in template:
        raise SystemExit("SKILL.template.md must not embed the runner")
    return template


def main(argv: list[str]) -> int:
    expected_skill = render_skill()
    expected_runner = RUNNER_SOURCE.read_text(encoding="utf-8")
    if "--check" in argv:
        problems = []
        if not TARGET_SKILL.is_file():
            problems.append(f"missing: {TARGET_SKILL}")
        elif TARGET_SKILL.read_text(encoding="utf-8") != expected_skill:
            problems.append(f"out of date: {TARGET_SKILL}")
        if not TARGET_RUNNER.is_file():
            problems.append(f"missing: {TARGET_RUNNER}")
        elif TARGET_RUNNER.read_text(encoding="utf-8") != expected_runner:
            problems.append(f"out of date: {TARGET_RUNNER}")
        if problems:
            print("\n".join(problems))
            return 1
        print(f"up to date: {TARGET_SKILL}")
        print(f"up to date: {TARGET_RUNNER}")
        return 0

    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_SKILL.write_text(expected_skill, encoding="utf-8")
    TARGET_RUNNER.write_text(expected_runner, encoding="utf-8")
    print(f"wrote {TARGET_SKILL} ({len(expected_skill.splitlines())} lines)")
    print(f"wrote {TARGET_RUNNER} ({len(expected_runner.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
