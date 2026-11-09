from __future__ import annotations

import json
import shutil
import subprocess

import numpy as np
import pytest

from helpers import aligned_task, base_task, write_srt, write_task, write_tone


class FakeAdapter:
    def __init__(self, seconds=1.0, sample_rate=24000):
        self.seconds = seconds
        self.sample_rate = sample_rate
        self.closed = False

    def prepare(self, task=None, progress=None):
        return None

    def synthesize(self, text, output_path):
        frames = int(round(self.seconds * self.sample_rate))
        time_axis = np.arange(frames, dtype=np.float32) / self.sample_rate
        tone = (0.2 * np.sin(2 * np.pi * 440 * time_axis)).astype(np.float32)
        self._write(output_path, tone)
        return self.sample_rate

    def _write(self, path, pcm):
        from helpers import write_tone

        write_tone(path, self.seconds, self.sample_rate)

    def close(self):
        self.closed = True

    def voice_identity(self):
        return {"speaker": "serena"}

    def environment(self):
        return {"route": "fake"}


def _run_fake(r, task, monkeypatch, adapter):
    monkeypatch.setattr(r, "build_adapter", lambda task, result: adapter)
    return r.run_task(task)


def test_run_task_narration_completes(r, tmp_path, monkeypatch):
    path = write_task(
        tmp_path,
        base_task(
            segments=[
                {"id": 1, "text": "甲。", "start_sec": None, "end_sec": None},
                {"id": 2, "text": "乙。", "start_sec": None, "end_sec": None},
            ]
        ),
    )
    task = r.load_task(path)
    adapter = FakeAdapter(seconds=1.0)
    assert _run_fake(r, task, monkeypatch, adapter) == 0
    assert adapter.closed is True
    payload = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert payload["status"] == "completed"
    audio = tmp_path / "output" / "narration.dub.wav"
    subtitle = tmp_path / "output" / "narration.dub.srt"
    assert audio.is_file() and subtitle.is_file()
    assert r.wav_info(audio)[2] == pytest.approx(2.3, abs=0.02)
    assert r.ffprobe_json(audio)
    text = subtitle.read_text(encoding="utf-8")
    assert text.count("-->") == 2


def test_task_text_with_quotes_newlines_and_shell_chars_roundtrips(r, tmp_path, monkeypatch):
    text = '她说："开始吧。"\nC:\\temp\\100% & $HOME; \'single\''
    path = write_task(
        tmp_path,
        base_task(
            segments=[{"id": 1, "text": text, "start_sec": None, "end_sec": None}]
        ),
    )
    task = r.load_task(path)
    assert task.segments[0].text == text
    adapter = FakeAdapter(seconds=0.5)
    assert _run_fake(r, task, monkeypatch, adapter) == 0
    payload = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert payload["segments"][0]["text"] == text
    subtitle = (tmp_path / "output" / "narration.dub.srt").read_text(encoding="utf-8")
    assert '她说："开始吧。"' in subtitle
    assert "C:\\temp\\100%" in subtitle
    assert "$HOME" in subtitle
    assert "'single'" in subtitle


def test_run_task_aligned_overflow_returns_3(r, tmp_path, monkeypatch):
    write_srt(tmp_path / "input.srt")
    path = write_task(
        tmp_path,
        aligned_task(
            segments=[
                {"id": 1, "text": "很长的一句。", "start_sec": 0.5, "end_sec": 1.5}
            ]
        ),
    )
    task = r.load_task(path)
    adapter = FakeAdapter(seconds=2.0)
    assert _run_fake(r, task, monkeypatch, adapter) == 3
    payload = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert payload["status"] == "overflow"
    assert payload["error"]["details"]["overflow"][0]["segment_id"] == 1
    assert not (tmp_path / "output").exists()


def test_run_task_aligned_needs_polish(r, tmp_path, monkeypatch):
    write_srt(tmp_path / "input.srt")
    path = write_task(
        tmp_path,
        aligned_task(
            allow_text_edits=True,
            polish={"attempt": 0, "max_attempts": 2},
            segments=[
                {"id": 1, "text": "很长的一句。", "start_sec": 0.5, "end_sec": 1.5}
            ],
        ),
    )
    task = r.load_task(path)
    adapter = FakeAdapter(seconds=2.0)
    assert _run_fake(r, task, monkeypatch, adapter) == 3
    payload = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))
    assert payload["status"] == "needs_polish"


def test_run_task_narration_video_pads_tail(r, tmp_path, monkeypatch):
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        pytest.skip("ffmpeg/ffprobe unavailable")
    video = tmp_path / "input.mp4"
    subprocess.run(
        [
            r.FFMPEG,
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x120:rate=24:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(video),
        ],
        check=True,
    )
    path = write_task(
        tmp_path,
        base_task(
            input={"srt": None, "video": "input.mp4"},
            output={"deliver": ["audio", "video", "subtitle"]},
        ),
    )
    task = r.load_task(path)
    adapter = FakeAdapter(seconds=1.0)
    assert _run_fake(r, task, monkeypatch, adapter) == 0
    output_video = tmp_path / "output" / "input.dub.mp4"
    output_audio = tmp_path / "output" / "input.dub.wav"
    assert output_video.is_file() and output_audio.is_file()
    assert r.wav_info(output_audio)[2] == pytest.approx(1.0, abs=0.02)
    info = r.probe_video(output_video)
    assert info["duration"] == pytest.approx(3.0, abs=0.1)
