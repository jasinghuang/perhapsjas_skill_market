from __future__ import annotations

import math

import numpy as np
import pytest

from helpers import write_tone, write_tone_with_silence


def test_validate_pcm_rejects_empty_silent_and_nan(r):
    with pytest.raises(r.RunnerError, match="empty"):
        r.validate_pcm(np.zeros(0, dtype=np.float32), 48000)
    with pytest.raises(r.RunnerError, match="silent"):
        r.validate_pcm(np.zeros(48000, dtype=np.float32), 48000)
    bad = np.zeros(48000, dtype=np.float32)
    bad[0] = np.nan
    with pytest.raises(r.RunnerError, match="NaN"):
        r.validate_pcm(bad, 48000)
    with pytest.raises(r.RunnerError, match="too short"):
        r.validate_pcm(np.ones(10, dtype=np.float32) * 0.1, 48000)


def test_trim_silence_keeps_audio_and_removes_edges(r, tmp_path):
    path = write_tone_with_silence(tmp_path / "tone.wav", 1.0, 0.2, 0.3)
    pcm, sample_rate = r.read_wav(path)
    trimmed = r.trim_silence(pcm, sample_rate)
    before = pcm.size / sample_rate
    after = trimmed.size / sample_rate
    assert after < before
    assert after > 0.4
    assert np.max(np.abs(trimmed)) > 0.05


def test_resample_24k_to_48k(r):
    sample_rate = 24000
    frames = 12000
    time_axis = np.arange(frames, dtype=np.float32) / sample_rate
    tone = (0.2 * np.sin(2 * np.pi * 440 * time_axis)).astype(np.float32)
    output = r.resample_audio(tone, sample_rate, 48000)
    assert r._np().asarray(output).size == pytest.approx(frames * 2, rel=0.02)


def test_change_speed_duration_and_guard(r):
    sample_rate = 48000
    frames = 48000
    time_axis = np.arange(frames, dtype=np.float32) / sample_rate
    tone = (0.2 * np.sin(2 * np.pi * 440 * time_axis)).astype(np.float32)
    faster = r.change_speed(tone, 1.2, sample_rate)
    assert r._np().asarray(faster).size == pytest.approx(frames / 1.2, rel=0.03)
    same = r.change_speed(tone, 1.0, sample_rate)
    assert r._np().asarray(same).size == frames
    with pytest.raises(r.RunnerError, match="invalid speed"):
        r.change_speed(tone, 0.0, sample_rate)


def test_write_track_gap_and_duration(r, tmp_path):
    first = write_tone(tmp_path / "a.wav", 0.5, 48000)
    second = write_tone(tmp_path / "b.wav", 0.25, 48000)
    a_samples, _, _ = r.wav_info(first)
    b_samples, _, _ = r.wav_info(second)
    target = tmp_path / "track.wav"
    r.write_track(target, [(0.0, first, a_samples), (1.0, second, b_samples)], 2.0, 48000)
    samples, sample_rate, duration = r.wav_info(target)
    assert sample_rate == 48000
    assert duration == pytest.approx(2.0)
    assert samples == pytest.approx(96000, abs=2)


def test_write_track_rejects_overlap_and_overflow(r, tmp_path):
    first = write_tone(tmp_path / "a.wav", 0.5, 48000)
    second = write_tone(tmp_path / "b.wav", 0.5, 48000)
    a_samples, _, _ = r.wav_info(first)
    b_samples, _, _ = r.wav_info(second)
    with pytest.raises(r.RunnerError, match="overlapping"):
        r.write_track(
            tmp_path / "overlap.wav",
            [(0.0, first, a_samples), (0.25, second, b_samples)],
            2.0,
            48000,
        )
    with pytest.raises(r.RunnerError, match="beyond track"):
        r.write_track(
            tmp_path / "overflow.wav",
            [(0.0, first, a_samples)],
            0.1,
            48000,
        )


def test_pad_track_adds_trailing_silence(r, tmp_path):
    source = write_tone(tmp_path / "source.wav", 0.5, 48000)
    target = tmp_path / "padded.wav"
    r.pad_track(source, target, 1.0, 48000)
    samples, sample_rate, duration = r.wav_info(target)
    assert sample_rate == 48000
    assert duration == pytest.approx(1.0)
    pcm, _ = r.read_wav(target)
    assert abs(float(r._np().max(r._np().abs(pcm[-4800:])))) < 1e-6


def test_concat_wavs_with_pause(r, tmp_path):
    first = write_tone(tmp_path / "a.wav", 0.25, 48000)
    second = write_tone(tmp_path / "b.wav", 0.25, 48000)
    target = tmp_path / "concat.wav"
    r.concat_wavs([first, second], target, 0.1, 48000)
    _, sample_rate, duration = r.wav_info(target)
    assert sample_rate == 48000
    assert duration == pytest.approx(0.6)


def test_write_srt_format(r, tmp_path):
    target = tmp_path / "out.srt"
    r.write_srt(
        target,
        [(0.5, 1.25, "第一句。"), (61.0, 62.5, "第二句。")],
    )
    text = target.read_text(encoding="utf-8")
    assert "00:00:00,500 --> 00:00:01,250" in text
    assert "00:01:01,000 --> 00:01:02,500" in text
    assert text.endswith("\n")
