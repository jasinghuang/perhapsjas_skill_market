import shutil
import subprocess

import numpy as np
import pytest

from audio_fit import (
    DEFAULT_SAFETY_GAP,
    FitAction,
    allowed_window,
    apply_atempo,
    plan_fit,
    split_long_text,
    trim_silence,
)
from srt_parse import Cue


def cue(i, start, end, nxt):
    return Cue(i, start, end, f"第{i}句", start, nxt)


# --- plan_fit：单一 window 阶梯（自然 / 严格模式共用） ----------------------


def test_fit_at_original_speed_when_window_is_enough():
    p = plan_fit(2.0, 3.0)
    assert p.speed == 1.0 and p.action is FitAction.FIT and p.warning is None


def test_accelerate_when_needed_within_max():
    p = plan_fit(3.3, 3.0)
    # 倍率按扣除 atempo 滤镜余量的窗口计算（略高于 1.1）。
    assert p.speed == pytest.approx(1.1, abs=0.02)
    assert p.action is FitAction.ACCELERATED and p.warning is None


def test_accelerate_past_warn_speed_records_warning():
    p = plan_fit(3.6, 3.0)  # ~1.2x > warn 1.15, <= max 1.30
    assert p.speed == pytest.approx(1.2, abs=0.02)
    assert p.action is FitAction.ACCELERATED and p.warning


def test_overflow_when_even_max_does_not_fit():
    p = plan_fit(6.0, 3.0)  # needs 2.0x > max 1.30
    assert p.speed == pytest.approx(1.30)
    assert p.action is FitAction.OVERFLOW
    assert p.overflow_ratio == pytest.approx(2.0, abs=0.02)
    assert p.warning  # 调用方不得据此放置


def test_max_speed_changes_cap():
    p = plan_fit(3.3, 3.0, max_speed=1.10)  # raw 1.1x == max → 仍可加速
    assert p.speed == pytest.approx(1.10, abs=0.005)
    assert p.action is FitAction.ACCELERATED


def test_no_window():
    for window in (0.0, -1.0):
        p = plan_fit(2.0, window)
        assert p.action is FitAction.NO_WINDOW and p.speed == 1.0


# --- allowed_window：natural / strict_slot 边界 -----------------------------


def test_natural_window_spans_gap_minus_safety():
    c = cue(1, 0.0, 1.0, 10.0)
    window = allowed_window(c, 0.0, "natural", safety_gap=0.1)
    assert window == pytest.approx(10.0 - 0.1 - 0.0)


def test_natural_window_uses_effective_start():
    c = cue(1, 2.0, 10.0, 12.0)
    window = allowed_window(c, 5.0, "natural")  # 起点被推迟到 5.0
    assert window == pytest.approx(12.0 - DEFAULT_SAFETY_GAP - 5.0)


def test_strict_window_stops_at_cue_end():
    c = cue(1, 0.0, 3.0, 10.0)
    window = allowed_window(c, 0.0, "strict_slot")
    assert window == pytest.approx(3.0)  # 不借用之后 7s 空档


def test_strict_window_negative_when_start_pushed_past_end():
    c = cue(1, 2.0, 3.0, 10.0)
    assert allowed_window(c, 4.0, "strict_slot") < 0


def test_unknown_timing_mode_rejected():
    with pytest.raises(ValueError, match="timing_mode"):
        allowed_window(cue(1, 0.0, 1.0, 2.0), 0.0, "loose")


# --- trim_silence / atempo / split（行为保持） -------------------------------


def test_trim_silence_removes_edges_and_keeps_voice():
    sr = 24000
    silence = np.zeros(sr // 2, dtype=np.float32)
    tone = (0.2 * np.sin(2 * np.pi * 440 * np.arange(sr // 2) / sr)).astype(np.float32)
    out = trim_silence(np.concatenate([silence, tone, silence]), sr)
    assert len(out) < len(silence) * 2 + len(tone)
    assert len(out) >= len(tone) * 0.9


def test_trim_silence_keeps_quiet_speech_not_treated_as_silence():
    # F06 复现：整体 RMS ≈ 0.005 的轻声内容能通过 validate_pcm
    # （下限 1e-4），却曾被固定 0.01 的裁剪阈值整段判为静音。
    from audio_checks import validate_pcm

    sr = 24000
    amplitude = 0.005 * (2 ** 0.5)  # 正弦幅度 → 缓冲 RMS ≈ 0.005
    silence = np.zeros(sr // 4, dtype=np.float32)
    tone = (
        amplitude * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)
    ).astype(np.float32)
    pcm = np.concatenate([silence, tone, silence])
    validate_pcm(pcm, sr)  # 先确认该样本通过有效性检查
    out = trim_silence(pcm, sr)  # 不得抛「只有静音」
    # 语音主体保留（允许一窗余量），首尾静音仍被裁掉。
    assert out.size >= int(sr * 0.9)
    assert out.size <= int(sr * 1.1) + 2 * int(sr * 0.01) + 2


def test_trim_silence_threshold_scales_with_loudness():
    # 自适应阈值随峰值等比下移；正常响度（峰值 ≫ 0.1）行为与固定
    # 0.01 一致，不会裁得更深。
    sr = 24000
    lead = np.zeros(sr // 2, dtype=np.float32)
    tone = (0.3 * np.sin(2 * np.pi * 440 * np.arange(sr) / sr)).astype(np.float32)
    out = trim_silence(np.concatenate([lead, tone]), sr)
    assert out.size >= int(sr * 0.9)


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
