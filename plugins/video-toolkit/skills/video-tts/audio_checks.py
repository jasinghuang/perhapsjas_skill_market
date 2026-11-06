#!/usr/bin/env python3
"""
video-tts — 合成音频有效性校验。

`validate_pcm()` 是合成片段进入缓存、拼接或混流之前的最后一道检查：
空缓冲、含 NaN/Inf、短于 `min_duration` 秒、或整体近似静音（RMS 低于
`1e-4`）都抛 `ValueError`，避免坏片段被静默缓存或写进成片。
"""

from __future__ import annotations

import numpy as np

MIN_RMS = 1e-4


def validate_pcm(
    pcm: np.ndarray,
    sample_rate: int,
    min_duration: float = 0.2,
) -> None:
    """校验一段合成波形，不合格时抛 `ValueError`。

    波形先展平成一维（兼容多声道输入）。检查顺序：空缓冲、非有限值
    （NaN/Inf）、短于 `min_duration` 秒、RMS 低于 `MIN_RMS`。错误消息
    带上具体原因与实测值，便于定位 provider 输出问题。
    """
    if sample_rate <= 0:
        raise ValueError(f"sample_rate must be positive, got {sample_rate}")
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise ValueError("audio buffer is empty")
    if not np.isfinite(samples).all():
        raise ValueError("audio buffer contains NaN or Inf")
    minimum = min_duration * sample_rate
    if samples.size < minimum:
        raise ValueError(
            f"audio buffer is too short: {samples.size / sample_rate:.3f}s "
            f"< min {min_duration:.3f}s"
        )
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    if rms < MIN_RMS:
        raise ValueError(
            f"audio buffer is silent: RMS {rms:.2e} < {MIN_RMS:.0e}"
        )
