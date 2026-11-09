#!/usr/bin/env python3
"""Build (or verify) the single-file video-tts SKILL.md.

The skill package must contain exactly one file: SKILL.md.  During development
the runner is kept in runner.py so it can be tested, then embedded verbatim
between the runner markers.  `--check` fails if the checked-in SKILL.md is out
of date.
"""

from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "runner.py"
TEMPLATE = HERE / "SKILL.template.md"
TARGET = HERE.parents[1] / "plugins" / "video-toolkit" / "skills" / "video-tts" / "SKILL.md"


def render() -> str:
    runner_text = RUNNER.read_text(encoding="utf-8").rstrip("\n")
    template = TEMPLATE.read_text(encoding="utf-8")
    if template.count("@@RUNNER_BLOCK@@") != 1:
        raise SystemExit("SKILL.template.md must contain exactly one @@RUNNER_BLOCK@@ placeholder")
    if "```" in runner_text:
        raise SystemExit("runner.py must not contain a triple-backtick fence")
    block = "```python\n" + runner_text + "\n```"
    return template.replace("@@RUNNER_BLOCK@@", block)


def main(argv: list[str]) -> int:
    expected = render()
    if "--check" in argv:
        if not TARGET.is_file():
            print(f"missing: {TARGET}")
            return 1
        current = TARGET.read_text(encoding="utf-8")
        if current != expected:
            print(f"out of date: {TARGET}")
            return 1
        print(f"up to date: {TARGET}")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(expected, encoding="utf-8")
    print(f"wrote {TARGET} ({len(expected.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
