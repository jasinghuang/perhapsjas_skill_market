#!/usr/bin/env python3
"""
video-tts — 配音时间窗规划与音频辅助工具。

时间适配（spec §7）按 `timing_mode` 分两种：

- `natural`（默认，自然解说）：优先原速。窗口 = 到下一组实际边界之前的
  全部可用空档（减去可配置的安全间隔）；合成 5 s、字幕槽位 3 s、下一句
  前可用 10 s 时必须用 1.0 倍速原速放入，不得为对齐槽位先加速。
- `strict_slot`（严格同步）：窗口 = 本组自身有效结束时间减有效起点，
  不借用之后的空档；放不下就在 `max_speed` 内变速，仍放不下进入 overflow。

两种模式的规划阶梯一致：原速放得下 → 1.0；按实际窗口算出的倍率 ≤
`max_speed` → 变速（超过 `warn_speed` 记 accelerated 警告）；否则
**overflow——不直接截断**（截断必须由 `overflow_policy=truncate` 显式
启用）。默认 `max_speed=1.30`、`warn_speed=1.15`，只加速不减速。

其余工具：`trim_silence()`（保守去首尾静音）、`apply_atempo()`（ffmpeg
变速，>2x 拆链）、`split_long_text()`（长文本按句切块）。
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

# 自然模式借用的空档与下一组起点之间的安全间隔（秒）。
DEFAULT_SAFETY_GAP = 0.10

# 加速规划的滤镜余量：atempo 对非整倍率有毫秒级输出偏差，按略小的窗口
# 计算倍率，保证变换后的真实样本数不越过允许窗口（仍只加速不减速）。
ACCELERATION_MARGIN = 0.010


class FitAction(str, Enum):
    """配音时长相对允许窗口的落点。"""

    FIT = "fit"                    # 原速放入（允许借用到字幕后的空档）
    ACCELERATED = "accelerated"    # 变速放入（> warn_speed 时带警告）
    OVERFLOW = "overflow"          # 超过 max_speed 也放不下 → 需要处理
    TRUNCATED = "truncated"        # 显式 truncate 策略下裁剪了内容
    NO_WINDOW = "no_window"        # 窗口已退化（≤ 0）


@dataclass(frozen=True)
class FitPlan:
    """一次 fit 决策：播放倍率、动作类型与给用户的 warning。"""

    speed: float
    action: FitAction
    warning: str | None = None
    overflow_ratio: float = 0.0    # overflow 时：synth/max_speed 超出窗口的比例


def plan_fit(
    synth_duration: float,
    window: float,
    warn_speed: float = 1.15,
    max_speed: float = 1.30,
) -> FitPlan:
    """决定合成音频如何放进允许窗口（`window` 已由模式算好）。

    分支顺序固定：窗口退化 → 原速放入 → 计算所需倍率并变速 → overflow。
    overflow 时返回 `speed=max_speed` 仅供报告参考，调用方不得据此放置。
    """
    if window <= 0:
        return FitPlan(1.0, FitAction.NO_WINDOW, None)
    if synth_duration <= window:
        return FitPlan(1.0, FitAction.FIT, None)

    raw_needed = synth_duration / window
    if raw_needed > max_speed:
        return FitPlan(
            max_speed,
            FitAction.OVERFLOW,
            f"needs {raw_needed:.2f}x > max {max_speed:.2f}x to fit "
            f"{synth_duration:.2f}s into {window:.2f}s",
            overflow_ratio=raw_needed,
        )

    # 变速按扣除滤镜余量的窗口计算，让 atempo 的真实输出不越界；
    # 余量不得把倍率推过用户上限（边界情形按上限执行，交给引擎的
    # 取整检查兜底）。
    effective = max(window - ACCELERATION_MARGIN, window * 0.99, 1e-6)
    needed = min(synth_duration / effective, max_speed)
    warning = None
    if needed > warn_speed:
        warning = (
            f"accelerated to {needed:.2f}x (> warn {warn_speed:.2f}x) "
            "to stay within the allowed window"
        )
    return FitPlan(needed, FitAction.ACCELERATED, warning)


def allowed_window(
    cue,
    effective_start: float,
    timing_mode: str,
    safety_gap: float = DEFAULT_SAFETY_GAP,
) -> float:
    """按 timing_mode 计算本组允许的窗口秒数。

    natural：到下一组实际边界（`next_start`，即下一组名义起点；下一组
    的 effective_start 只会 ≥ 该值，因此借满空档也不会与下一组重叠）减
    安全间隔。strict_slot：本组自身有效结束时间（`cue.end`）为硬边界，
    不借用之后空档。所有窗口都以 `effective_start`（被前一组推迟后的
    实际起点）为基准。
    """
    if timing_mode == "strict_slot":
        return cue.end - effective_start
    if timing_mode != "natural":
        raise ValueError(f"unknown timing_mode: {timing_mode!r}")
    return (cue.next_start - safety_gap) - effective_start


def trim_silence(
    pcm: np.ndarray,
    sample_rate: int,
    threshold: float = 0.01,
    window_ms: int = 10,
) -> np.ndarray:
    """去掉首尾静音，返回仍带 10 ms 淡入淡出的单声道波形。

    以 `window_ms` 为窗计算 RMS，找到首个 / 最后一个高于 `threshold` 的窗，
    前后各留一窗余量后切片（保守：多留一窗，避免切掉气声与轻辅音起音）。
    整段都是静音时抛 `ValueError`。
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
