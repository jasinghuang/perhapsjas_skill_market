"""Opt-in real-model smoke test.

Run with:
    AUDIO_TRANSCRIBE_SMOKE=1 /opt/homebrew/bin/python3.14 -m pytest tests/test_integration_smoke.py -v
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parent.parent

pytestmark = pytest.mark.skipif(
    os.environ.get("AUDIO_TRANSCRIBE_SMOKE") != "1",
    reason="set AUDIO_TRANSCRIBE_SMOKE=1 to run the real-model smoke test",
)


def test_srt_identical_with_and_without_progress(tmp_path):
    tone = tmp_path / "tone.wav"
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "sine=frequency=440:duration=5",
            "-ar", "16000", str(tone),
        ],
        check=True,
        capture_output=True,
    )

    outputs = []
    for name, extra in (("on.srt", []), ("off.srt", ["--no-progress"])):
        out = tmp_path / name
        subprocess.run(
            [
                sys.executable,
                str(SKILL_DIR / "run.py"),
                str(tone),
                "--model", "large-v3-turbo",
                "--format", "srt",
                "-o", str(out),
                *extra,
            ],
            check=True,
            capture_output=True,
            cwd=str(SKILL_DIR),
        )
        outputs.append(out.read_bytes())

    assert outputs[0] == outputs[1]
