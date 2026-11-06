#!/usr/bin/env python3
"""
video-tts — 整轨拼接与 WAV 读写。

`build_track()` 把各条配音片段按起始时间放进一条与视频等长的 float32
单声道缓冲。片段起点为负、超出总时长、或与上一条重叠时抛 `ValueError`，
避免静默截断或覆盖。

`write_wav()` / `read_wav()` 用 soundfile 读写 WAV，整轨始终保持单声道：
多声道输入 / 输出按声道取平均。
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Sequence

import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000


def _to_mono(pcm: np.ndarray) -> np.ndarray:
    """把波形转成 float32 一维单声道；多声道按声道取平均。"""
    samples = np.asarray(pcm, dtype=np.float32)
    if samples.ndim == 2:
        samples = samples.mean(axis=1, dtype=np.float32)
    elif samples.ndim != 1:
        raise ValueError(
            f"audio buffer must be 1-D mono or 2-D (frames, channels), "
            f"got shape {samples.shape}"
        )
    return samples


def build_track(
    total_duration: float,
    placements: Sequence[tuple[float, np.ndarray]],
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    """把 `(start_seconds, pcm)` 片段拼进一条全长的静音缓冲。

    缓冲长度为 `ceil(total_duration * sample_rate)` 个采样点。片段按起点
    排序后依次写入；起点为负、结束超出缓冲、或与上一条已放入的片段重叠
    时抛 `ValueError`（消息里带上片段序号与时间）。
    """
    if total_duration < 0:
        raise ValueError(f"total_duration must be non-negative, got {total_duration}")
    if sample_rate <= 0:
        raise ValueError(f"sample_rate must be positive, got {sample_rate}")

    length = int(math.ceil(total_duration * sample_rate))
    track = np.zeros(length, dtype=np.float32)

    ordered = sorted(placements, key=lambda placement: placement[0])
    previous_end: int | None = None
    for index, (start, pcm) in enumerate(ordered):
        if start < 0:
            raise ValueError(
                f"placement {index}: start {start:.3f}s is negative"
            )
        segment = _to_mono(pcm)
        start_sample = int(round(start * sample_rate))
        end_sample = start_sample + segment.size
        if end_sample > length:
            raise ValueError(
                f"placement {index}: segment ending at {end_sample / sample_rate:.3f}s "
                f"exceeds track duration {total_duration:.3f}s"
            )
        if previous_end is not None and start_sample < previous_end:
            raise ValueError(
                f"placement {index}: start {start_sample / sample_rate:.3f}s overlaps "
                f"previous segment ending at {previous_end / sample_rate:.3f}s"
            )
        track[start_sample:end_sample] = segment
        previous_end = end_sample

    return track


def write_wav(path: Path, pcm: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    """把波形写成 float32 WAV；多声道输入先平均成单声道。"""
    samples = _to_mono(pcm)
    sf.write(Path(path), samples, sample_rate, subtype="FLOAT")


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """读回 `(float32 单声道波形, 采样率)`；多声道文件按声道取平均。"""
    samples, sample_rate = sf.read(Path(path), dtype="float32", always_2d=False)
    return _to_mono(samples), int(sample_rate)
