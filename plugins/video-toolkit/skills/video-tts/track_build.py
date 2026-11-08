#!/usr/bin/env python3
"""
video-tts — 整轨拼接与 WAV 读写。

`validate_placements()` 检查片段序列（排序、非负、不越界、不重叠）；
`write_track()` 按顺序**流式**把各条配音片段写进一条与媒体等长的 WAV
（48kHz 长片不再为整轨缓冲多份完整波形），先写临时文件再原子替换，失败
不会破坏已有成品。`build_track()` 保留内存版实现（短轨 / 测试用），共用
同一套校验。

`write_track_files()`（F07，spec §12.3）是低内存版本：placements 只持有
**文件引用**（起点 + 片段 WAV 路径 + 样本数），不保留全片 ndarray。逐段
用 `sf.blocks` 分块读入写出；空档与末尾补零复用同一块固定大小的零缓冲
循环写入，绝不 `zeros(整个空档样本数)`——内存占用有界（当前段 + 一个
固定缓冲），不随整片总时长线性累积。校验语义与 `validate_placements`
一致（越界 / 重叠在这里抛错）。

`write_wav()` / `read_wav()` 用 soundfile 读写 WAV；整轨单声道，多声道
输入按声道取平均。
"""

from __future__ import annotations

import math
import os
import tempfile
from pathlib import Path
from typing import Sequence

import numpy as np
import soundfile as sf

DEFAULT_SAMPLE_RATE = 48000

# 空档补零 / 分块读写的块大小（样本数，48kHz 下约 5.5s；有界缓冲）。
IO_CHUNK_SAMPLES = 1 << 18


def _zeros(size: int) -> np.ndarray:
    """分配零缓冲（测试用它观测单次分配大小的上界）。"""
    return np.zeros(size, dtype=np.float32)


def to_mono(pcm: np.ndarray) -> np.ndarray:
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


def validate_placements(
    placements: Sequence[tuple[float, np.ndarray]],
    total_duration: float,
    sample_rate: int,
) -> list[tuple[int, int, np.ndarray]]:
    """排序并校验片段，返回 `(start_sample, end_sample, mono_pcm)` 列表。

    起点为负、结束超出总时长、或与上一条已放入的片段重叠时抛
    `ValueError`（消息带片段序号与时间），避免静默截断或覆盖。
    """
    if total_duration < 0:
        raise ValueError(
            f"total_duration must be non-negative, got {total_duration}"
        )
    if sample_rate <= 0:
        raise ValueError(f"sample_rate must be positive, got {sample_rate}")

    length = int(math.ceil(total_duration * sample_rate))
    ordered = sorted(placements, key=lambda placement: placement[0])
    validated: list[tuple[int, int, np.ndarray]] = []
    previous_end: int | None = None
    for index, (start, pcm) in enumerate(ordered):
        if start < 0:
            raise ValueError(
                f"placement {index}: start {start:.3f}s is negative"
            )
        segment = to_mono(pcm)
        start_sample = int(round(start * sample_rate))
        end_sample = start_sample + segment.size
        if end_sample > length:
            raise ValueError(
                f"placement {index}: segment ending at "
                f"{end_sample / sample_rate:.3f}s exceeds track duration "
                f"{total_duration:.3f}s"
            )
        if previous_end is not None and start_sample < previous_end:
            raise ValueError(
                f"placement {index}: start {start_sample / sample_rate:.3f}s "
                f"overlaps previous segment ending at "
                f"{previous_end / sample_rate:.3f}s"
            )
        validated.append((start_sample, end_sample, segment))
        previous_end = end_sample
    return validated


def build_track(
    total_duration: float,
    placements: Sequence[tuple[float, np.ndarray]],
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> np.ndarray:
    """把 `(start_seconds, pcm)` 片段拼进一条全长的静音缓冲（内存版）。"""
    length = int(math.ceil(total_duration * sample_rate))
    track = _zeros(length)
    for start_sample, end_sample, segment in validate_placements(
        placements, total_duration, sample_rate
    ):
        track[start_sample:end_sample] = segment
    return track


# 文件引用式 placement：`(起点秒, 片段 WAV 路径, 样本数)`。
FilePlacement = tuple[float, Path, int]


def validate_file_placements(
    placements: Sequence[FilePlacement],
    total_duration: float,
    sample_rate: int,
) -> list[tuple[int, int, Path]]:
    """校验文件引用式片段（排序、非负、不越界、不重叠），不加载 PCM。

    返回 `(start_sample, end_sample, path)` 列表；越界 / 重叠的语义与
    `validate_placements` 完全一致。
    """
    if total_duration < 0:
        raise ValueError(
            f"total_duration must be non-negative, got {total_duration}"
        )
    if sample_rate <= 0:
        raise ValueError(f"sample_rate must be positive, got {sample_rate}")

    length = int(math.ceil(total_duration * sample_rate))
    ordered = sorted(placements, key=lambda placement: placement[0])
    validated: list[tuple[int, int, Path]] = []
    previous_end: int | None = None
    for index, (start, path, samples) in enumerate(ordered):
        if start < 0:
            raise ValueError(
                f"placement {index}: start {start:.3f}s is negative"
            )
        if samples < 0:
            raise ValueError(
                f"placement {index}: negative sample count {samples}"
            )
        start_sample = int(round(start * sample_rate))
        end_sample = start_sample + samples
        if end_sample > length:
            raise ValueError(
                f"placement {index}: segment ending at "
                f"{end_sample / sample_rate:.3f}s exceeds track duration "
                f"{total_duration:.3f}s"
            )
        if previous_end is not None and start_sample < previous_end:
            raise ValueError(
                f"placement {index}: start {start_sample / sample_rate:.3f}s "
                f"overlaps previous segment ending at "
                f"{previous_end / sample_rate:.3f}s"
            )
        validated.append((start_sample, end_sample, Path(path)))
        previous_end = end_sample
    return validated


def _write_zeros(handle: sf.SoundFile, count: int) -> None:
    """用固定大小零缓冲循环写入 `count` 个样本（不一次分配全长）。"""
    if count <= 0:
        return
    buffer = _zeros(min(count, IO_CHUNK_SAMPLES))
    written = 0
    while written < count:
        chunk = min(buffer.size, count - written)
        handle.write(buffer[:chunk])
        written += chunk


def _copy_segment(handle: sf.SoundFile, path: Path, expected: int) -> None:
    """分块读入片段 WAV 并写出；样本数与元数据不一致时报错。"""
    copied = 0
    with sf.SoundFile(str(path)) as source:
        for block in source.blocks(
            blocksize=IO_CHUNK_SAMPLES, dtype="float32", always_2d=False
        ):
            handle.write(block)
            copied += block.size
    if copied != expected:
        raise ValueError(
            f"segment {path} contains {copied} samples, expected {expected}; "
            "the part file was modified or truncated"
        )


def write_track_files(
    path: Path,
    placements: Sequence[FilePlacement],
    total_duration: float,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> None:
    """把文件引用式片段拼进全长 WAV（低内存，F07）。

    校验只看元数据（不加载 PCM）；写出时段与段之间的空档用固定大小零
    缓冲循环补齐，末尾补零到整片长度；临时文件 + 原子替换，失败不破坏
    已有成品。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    validated = validate_file_placements(placements, total_duration, sample_rate)
    length = int(math.ceil(total_duration * sample_rate))

    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        cursor = 0
        with sf.SoundFile(
            tmp_name, mode="w", samplerate=sample_rate,
            channels=1, subtype="FLOAT",
        ) as handle:
            for start_sample, end_sample, part_path in validated:
                _write_zeros(handle, start_sample - cursor)
                _copy_segment(handle, part_path, end_sample - start_sample)
                cursor = end_sample
            _write_zeros(handle, length - cursor)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def write_track(
    path: Path,
    placements: Sequence[tuple[float, np.ndarray]],
    total_duration: float,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> None:
    """把片段按起点流式写进 `path` 的全长 WAV（临时文件 + 原子替换）。

    片段之间的空档按需补零写入，不整轨驻留内存；校验与 `build_track`
    完全一致（越界 / 重叠在这里抛错，成品不会被半写覆盖）。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    validated = validate_placements(placements, total_duration, sample_rate)
    length = int(math.ceil(total_duration * sample_rate))

    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        cursor = 0
        with sf.SoundFile(
            tmp_name, mode="w", samplerate=sample_rate,
            channels=1, subtype="FLOAT",
        ) as handle:
            for start_sample, end_sample, segment in validated:
                if start_sample > cursor:
                    handle.write(np.zeros(start_sample - cursor, dtype=np.float32))
                handle.write(segment)
                cursor = end_sample
            if length > cursor:
                handle.write(np.zeros(length - cursor, dtype=np.float32))
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def write_wav(
    path: Path,
    pcm: np.ndarray,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> None:
    """把波形写成 float32 WAV（临时文件 + 原子替换）；多声道先平均。"""
    samples = to_mono(pcm)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        sf.write(tmp_name, samples, sample_rate, subtype="FLOAT")
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """读回 `(float32 单声道波形, 采样率)`；多声道文件按声道取平均。"""
    samples, sample_rate = sf.read(Path(path), dtype="float32", always_2d=False)
    return to_mono(samples), int(sample_rate)
