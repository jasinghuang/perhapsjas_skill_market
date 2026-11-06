#!/usr/bin/env python3
"""
video-tts — 配音时间窗规划与音频辅助工具。

- `plan_fit()` 根据合成音频时长、字幕槽位与到下一句的可用时间，决定是直接
  使用、轻微压缩（≤15%）、溢入字幕后的空档、压到上限，还是会在下一句开始前
  被截断。
- `trim_silence()` 用逐窗 RMS 去掉首尾静音，避免 TTS 输出两端的空白把槽位
  撑满。
- `apply_atempo()` 通过 ffmpeg 的 `atempo` 滤镜改变语速；超过 2x 的倍率会
  拆成多个 `atempo` 串联（单个滤镜只支持 0.5–2.0）。
- `split_long_text()` 按句末标点切分过长文本，避免单次 TTS 请求过长。
"""

from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import numpy as np
import soundfile as sf

_SENTENCE_END = "。！？!?；;"
_FADE_SECONDS = 0.010
# 中文 TTS 常见语速约 4 字/秒。spec §8.5 要求「超过 300 字或按字数估算超过
# 60 秒」时切块；把 max_seconds 按该速率换算成字符预算。
_CHARS_PER_SECOND = 4.0


class FitAction(str, Enum):
    """配音时长相对字幕窗口的落点。"""

    FIT = "fit"
    FIT_COMPRESS = "fit_compress"
    SPILL = "spill"
    COMPRESS_MAX = "compress_max"
    TRUNCATED = "truncated"
    NO_WINDOW = "no_window"


@dataclass(frozen=True)
class FitPlan:
    """一次 fit 决策：播放倍率、动作类型与给用户的 warning。"""

    speed: float
    action: FitAction
    warning: str | None = None


def plan_fit(
    synth_duration: float,
    slot: float,
    available: float,
    warn_speed: float = 1.15,
    max_speed: float = 1.30,
) -> FitPlan:
    """决定合成音频如何放进字幕窗口。

    `slot` 是字幕自身时长，`available` 是从字幕起点到下一句开始的时间
    （含字幕后的空档）。`slot <= 0`（字幕窗口已退化）与 `available <= 0`
    都返回 `NO_WINDOW`。分支顺序固定：无窗口 → 直接放入 → 轻微压缩 →
    以警告上限溢入空档 → 压到上限 → 截断。
    """
    if available <= 0 or slot <= 0:
        return FitPlan(1.0, FitAction.NO_WINDOW, None)
    if synth_duration <= slot:
        return FitPlan(1.0, FitAction.FIT, None)

    cap = min(warn_speed, max_speed)
    ratio = synth_duration / slot
    if ratio <= cap:
        return FitPlan(ratio, FitAction.FIT_COMPRESS, None)
    if synth_duration / cap <= available:
        return FitPlan(
            cap,
            FitAction.SPILL,
            "spills past subtitle end but stays before next cue",
        )

    needed = synth_duration / available
    if needed <= max_speed:
        return FitPlan(
            needed,
            FitAction.COMPRESS_MAX,
            "compressed past warning speed to stay before next cue",
        )
    return FitPlan(
        max_speed,
        FitAction.TRUNCATED,
        "truncated at next cue start",
    )


def trim_silence(
    pcm: np.ndarray,
    sample_rate: int,
    threshold: float = 0.01,
    window_ms: int = 10,
) -> np.ndarray:
    """去掉首尾静音，返回仍带 10 ms 淡入淡出的单声道波形。

    以 `window_ms` 为窗计算 RMS，找到首个 / 最后一个高于 `threshold` 的窗，
    前后各留一窗余量后切片。整段都是静音时抛 `ValueError`。
    """
    samples = np.asarray(pcm, dtype=np.float32)
    if samples.size == 0:
        raise ValueError("audio buffer is empty")
    frame = max(1, int(sample_rate * window_ms / 1000))
    frame_count = (samples.size + frame - 1) // frame
    padded = np.zeros(frame_count * frame, dtype=np.float32)
    padded[: samples.size] = samples
    rms = np.sqrt(np.mean(padded.reshape(frame_count, frame) ** 2, axis=1))
    active = np.flatnonzero(rms > threshold)
    if active.size == 0:
        raise ValueError("audio buffer contains only silence")

    first, last = int(active[0]), int(active[-1])
    start = max(0, (first - 1) * frame)
    end = min(samples.size, (last + 2) * frame)
    trimmed = samples[start:end].copy()

    fade = min(int(sample_rate * _FADE_SECONDS), trimmed.size // 2)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        trimmed[:fade] *= ramp
        trimmed[-fade:] *= ramp[::-1]
    return trimmed


def _atempo_filter(speed: float) -> str:
    """构造 `atempo` 滤镜链；单个滤镜上限 2.0，超出时串联。"""
    factors: list[float] = []
    remaining = float(speed)
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    factors.append(remaining)
    return ",".join(f"atempo={factor:.6f}" for factor in factors)


def apply_atempo(
    pcm: np.ndarray,
    speed: float,
    sample_rate: int,
    ffmpeg: str = "ffmpeg",
) -> np.ndarray:
    """用 ffmpeg 的 `atempo` 改变语速并读回 float32 波形。

    `speed == 1.0` 时直接返回原数组（不做任何重采样）。中间文件用
    `soundfile` 写入临时目录，避免污染输出目录。ffmpeg 失败时把 stderr
    一并带进异常消息，便于定位滤镜参数问题。
    """
    samples = np.asarray(pcm, dtype=np.float32)
    if speed == 1.0 or samples.size == 0:
        return samples

    chain = _atempo_filter(speed)
    with tempfile.TemporaryDirectory(prefix="video-tts-atempo-") as tmp:
        source = Path(tmp) / "in.wav"
        target = Path(tmp) / "out.wav"
        sf.write(source, samples, sample_rate, subtype="FLOAT")
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    str(source),
                    "-filter:a",
                    chain,
                    str(target),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or "").strip()
            raise RuntimeError(
                f"ffmpeg atempo failed (exit {exc.returncode}): {detail or exc}"
            ) from exc
        stretched, _ = sf.read(target, dtype="float32")
    return stretched


def _split_sentences(text: str) -> list[str]:
    """按句末标点切句，标点留在前一句末尾。"""
    sentences: list[str] = []
    start = 0
    for index, char in enumerate(text):
        if char in _SENTENCE_END:
            sentence = text[start : index + 1].strip()
            if sentence:
                sentences.append(sentence)
            start = index + 1
    tail = text[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def split_long_text(
    text: str,
    max_chars: int = 300,
    max_seconds: float = 60.0,
) -> list[str]:
    """把长文本切成适合单次 TTS 请求的片段。

    先按句末标点切句，再把短句贪心累积到预算；单句本身超长时按预算硬切。
    预算 = `min(max_chars, max_seconds * _CHARS_PER_SECOND)`，同时满足
    spec §8.5 的「300 字」与「估算 60 秒」两条上限；时长按中文 TTS 常见的
    `_CHARS_PER_SECOND`（4 字/秒）由字数估算。空文本返回空列表，绝不返回
    空片段。
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")
    if max_seconds <= 0:
        raise ValueError("max_seconds must be positive")
    budget = min(max_chars, max(1, int(max_seconds * _CHARS_PER_SECOND)))

    chunks: list[str] = []
    current = ""
    for sentence in _split_sentences(cleaned):
        while len(sentence) > budget:
            head, sentence = sentence[:budget], sentence[budget:]
            if current:
                chunks.append(current)
                current = ""
            chunks.append(head)
        if not sentence:
            continue
        if len(current) + len(sentence) <= budget:
            current += sentence
        else:
            if current:
                chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks
