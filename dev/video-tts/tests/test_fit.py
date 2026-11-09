from __future__ import annotations

import numpy as np
import pytest


def tone(seconds: float, sample_rate: int = 48000) -> np.ndarray:
    frames = int(round(seconds * sample_rate))
    time_axis = np.arange(frames, dtype=np.float32) / sample_rate
    return (0.2 * np.sin(2 * np.pi * 440 * time_axis)).astype(np.float32)


def test_fit_uses_natural_speed_when_it_fits(r, tmp_path):
    pcm = tone(1.0)
    target = tmp_path / "fit.wav"
    output, duration, speed, overflow = r.fit_to_window(pcm, 48000, 1.5, 1.2, target)
    assert overflow is None
    assert speed == 1.0
    assert duration == pytest.approx(1.0)
    assert target.is_file()


def test_fit_accelerates_and_measures(r, tmp_path):
    pcm = tone(2.0)
    target = tmp_path / "fit.wav"
    output, duration, speed, overflow = r.fit_to_window(pcm, 48000, 1.8, 1.2, target)
    assert overflow is None
    assert speed > 1.0
    assert speed <= 1.2
    assert duration <= 1.8 + 1e-6
    assert target.is_file()


def test_fit_reports_overflow_without_truncating(r, tmp_path):
    pcm = tone(3.0)
    target = tmp_path / "fit.wav"
    output, duration, speed, overflow = r.fit_to_window(pcm, 48000, 1.0, 1.2, target)
    assert overflow is not None
    assert overflow["reason"] == "overflow"
    assert overflow["required_speed"] > 1.2
    assert not target.exists()


def test_fit_no_window_is_overflow(r, tmp_path):
    pcm = tone(1.0)
    output, duration, speed, overflow = r.fit_to_window(
        pcm, 48000, 0.0, 1.2, tmp_path / "fit.wav"
    )
    assert overflow is not None
    assert overflow["reason"] == "no_window"


def test_split_text_preserves_content(r):
    text = "甲" * 700
    chunks = r.split_text(text, "mlx_audio")
    assert len(chunks) > 1
    assert all(len(chunk) <= 280 for chunk in chunks)
    assert "".join(chunks) == text


def test_cache_key_changes_with_voice_parameters(r, tmp_path):
    from helpers import base_task, write_task

    task = r.load_task(write_task(tmp_path, base_task(parameters={"instruct": "自然"})))
    identity = {"speaker": "serena"}
    key1 = r.cache_key(task, identity, "测试")
    task.parameters["instruct"] = "平静"
    key2 = r.cache_key(task, identity, "测试")
    assert key1 != key2
