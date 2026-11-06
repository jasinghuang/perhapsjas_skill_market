import shutil
import subprocess

import numpy as np
import pytest

from audio_fit import (
    FitAction,
    apply_atempo,
    plan_fit,
    split_long_text,
    trim_silence,
)


def test_fit_inside_slot():
    p = plan_fit(2.0, slot=3.0, available=5.0)
    assert p.speed == 1.0 and p.action is FitAction.FIT and p.warning is None


def test_compress_within_15_percent():
    p = plan_fit(3.3, slot=3.0, available=5.0)
    assert p.speed == pytest.approx(1.1)
    assert p.action is FitAction.FIT_COMPRESS and p.warning is None


def test_spill_into_gap_at_cap():
    p = plan_fit(3.5, slot=3.0, available=4.0)  # 3.5/1.15 = 3.04 <= 4.0
    assert p.speed == pytest.approx(1.15)
    assert p.action is FitAction.SPILL and p.warning


def test_compress_to_max_when_gap_short():
    p = plan_fit(5.0, slot=3.0, available=4.0)  # needed 1.25
    assert p.speed == pytest.approx(1.25)
    assert p.action is FitAction.COMPRESS_MAX and p.warning


def test_truncate_when_even_max_does_not_fit():
    p = plan_fit(6.0, slot=3.0, available=4.0)  # needed 1.5
    assert p.speed == pytest.approx(1.30)
    assert p.action is FitAction.TRUNCATED and p.warning


def test_max_speed_below_warn_changes_cap():
    p = plan_fit(3.3, slot=3.0, available=5.0, max_speed=1.10)
    assert p.speed == pytest.approx(1.10)
    assert p.action is FitAction.FIT_COMPRESS


def test_no_window():
    p = plan_fit(2.0, slot=1.0, available=0.0)
    assert p.action is FitAction.NO_WINDOW


def test_non_positive_slot_is_no_window():
    for slot in (0.0, -1.0):
        p = plan_fit(2.0, slot=slot, available=5.0)
        assert p.action is FitAction.NO_WINDOW and p.speed == 1.0


def test_trim_silence_removes_edges_and_keeps_voice():
    sr = 24000
    silence = np.zeros(sr // 2, dtype=np.float32)
    tone = (0.2 * np.sin(2 * np.pi * 440 * np.arange(sr // 2) / sr)).astype(np.float32)
    out = trim_silence(np.concatenate([silence, tone, silence]), sr)
    assert len(out) < len(silence) * 2 + len(tone)
    assert len(out) >= len(tone) * 0.9


def test_trim_silence_rejects_all_silence():
    with pytest.raises(ValueError):
        trim_silence(np.zeros(24000, dtype=np.float32), 24000)


def test_trim_silence_trims_both_edges():
    sr = 24000
    lead = np.zeros(sr // 4, dtype=np.float32)  # 0.25 s
    tone = (0.2 * np.sin(2 * np.pi * 440 * np.arange(sr // 2) / sr)).astype(np.float32)
    tail = np.zeros(sr, dtype=np.float32)  # 1.0 s
    out = trim_silence(np.concatenate([lead, tone, tail]), sr)
    active = np.flatnonzero(np.abs(out) > 0.01)
    assert active.size > 0
    lead_quiet = active[0] / sr
    tail_quiet = (out.size - 1 - active[-1]) / sr
    # 原来首尾分别有 0.25 s / 1.0 s 静音，两侧都应被裁到一窗余量内。
    assert lead_quiet < 0.02
    assert tail_quiet < 0.02


def test_split_long_text():
    text = "第一句。第二句！第三句？"
    assert split_long_text(text, max_chars=4) == ["第一句。", "第二句！", "第三句？"]
    assert split_long_text("短句。", max_chars=300) == ["短句。"]


def test_split_long_text_hard_splits_unpunctuated_run():
    assert split_long_text("一二三四五六七", max_chars=3) == ["一二三", "四五六", "七"]


def test_split_long_text_respects_max_seconds():
    # 4 字/秒时，1 秒预算 = 4 字；三句各 4 字，因此必须拆成三块。
    text = "第一句。第二句！第三句？"
    assert split_long_text(text, max_chars=300, max_seconds=1.0) == [
        "第一句。",
        "第二句！",
        "第三句？",
    ]


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg required")
def test_apply_atempo_shortens_duration():
    sr = 24000
    tone = (0.2 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)).astype(np.float32)
    out = apply_atempo(tone, 1.25, sr)
    assert 0.7 <= len(out) / len(tone) <= 0.9


def test_apply_atempo_surfaces_ffmpeg_stderr(monkeypatch):
    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(1, ["ffmpeg"], stderr="boom: bad filter")

    monkeypatch.setattr("audio_fit.subprocess.run", fail)
    with pytest.raises(RuntimeError, match="boom"):
        apply_atempo(np.zeros(2400, dtype=np.float32), 1.25, 24000)
