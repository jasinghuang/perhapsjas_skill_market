#!/usr/bin/env python3
"""
video-tts — 三层采样率之间的音频加工管线。

三层采样率（spec §6）：

1. ``source``：provider 实际输出的原生采样率（当前 Qwen3-TTS 为 24000）。
2. ``master``：本项目拼轨与时间适配使用的制作采样率，默认 48000。
3. ``export``：最终 WAV / 视频音轨采样率，默认与 master 相同。

处理顺序（每段合成结果统一走 `process_result`）：

    原生音频（含元数据）→ 原生采样率上裁剪首尾静音 → 按声道下混
    → ffmpeg aresample 重采样到 master → 用转换后真实样本数计算时长

重采样一律由 ffmpeg 的 ``aresample``（swresample）完成并实际重写波形；
禁止只改 WAV 头 / 写入采样率变量来“转换”音频。24k→48k 是制作规格统一，
不会恢复模型未生成的高频细节。
"""

from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from audio_fit import trim_silence
from providers.base import SynthesisResult

# swresample 精度；默认已足够，这里显式固定便于复现。
_ARESAMPLE_FILTER = "aresample=resampler=swr:dither_method=0"
# 24k→48k / 48k→24k 等整倍转换的样本数容差（重采样器首尾舍入）。
_RESAMPLE_TOLERANCE = 0.02


def downmix_to_mono(pcm: np.ndarray) -> np.ndarray:
    """把波形下混成 float32 一维单声道。

    单声道直接透传；多声道 (frames, channels) 按声道求平均（记录在案的
    混音策略）。禁止 `reshape(-1)`：那会把交错立体声拉长一倍、时长翻倍。
    """
    samples = np.asarray(pcm, dtype=np.float32)
    if samples.ndim == 1:
        return samples
    if samples.ndim == 2:
        return np.ascontiguousarray(
            samples.mean(axis=1, dtype=np.float32), dtype=np.float32
        )
    raise ValueError(
        f"audio must be 1-D mono or 2-D (frames, channels), got {samples.shape}"
    )


def resample_pcm(
    pcm: np.ndarray,
    from_rate: int,
    to_rate: int,
    ffmpeg: str = "ffmpeg",
) -> np.ndarray:
    """用 ffmpeg aresample 把单声道波形重采样到 `to_rate`。

    同采样率直接返回；输入若是多声道先下混。ffmpeg 失败时把 stderr 带进
    异常消息。样本数按比例换算并做容差校验，防止滤镜链被静默改坏。
    """
    samples = downmix_to_mono(pcm)
    if from_rate == to_rate:
        return samples
    if from_rate <= 0 or to_rate <= 0:
        raise ValueError(
            f"sample rates must be positive (from={from_rate}, to={to_rate})"
        )

    with tempfile.TemporaryDirectory(prefix="video-tts-resample-") as tmp:
        source = Path(tmp) / "in.wav"
        target = Path(tmp) / "out.wav"
        sf.write(source, samples, from_rate, subtype="FLOAT")
        try:
            subprocess.run(
                [
                    ffmpeg, "-y", "-loglevel", "error",
                    "-i", str(source),
                    "-filter:a", _ARESAMPLE_FILTER,
                    "-ar", str(to_rate),
                    str(target),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or "").strip()
            raise RuntimeError(
                f"ffmpeg aresample failed (exit {exc.returncode}): "
                f"{detail or exc}"
            ) from exc
        resampled, rate = sf.read(target, dtype="float32", always_2d=False)

    if int(rate) != to_rate:
        raise RuntimeError(
            f"aresample produced {rate} Hz, expected {to_rate} Hz"
        )
    expected = samples.size * to_rate / from_rate
    if abs(resampled.size - expected) > expected * _RESAMPLE_TOLERANCE:
        raise RuntimeError(
            f"aresample produced {resampled.size} samples, expected "
            f"~{expected:.0f}; filter chain may be misconfigured"
        )
    return np.ascontiguousarray(resampled, dtype=np.float32)


@dataclass(frozen=True)
class ProcessedAudio:
    """一段完成「裁剪静音 → 下混 → 重采样」的音频及其元数据。"""

    pcm: np.ndarray            # float32 单声道，master 采样率
    native_sample_rate: int    # provider 原生采样率（进报告 / 缓存）
    master_sample_rate: int
    trimmed_seconds: float     # 静音裁剪掉的时长（原生采样率下）


def process_result(
    result: SynthesisResult,
    master_sample_rate: int,
    *,
    trim_threshold: float | None = None,
    trim_window_ms: int = 10,
    ffmpeg: str = "ffmpeg",
) -> ProcessedAudio:
    """把原生合成结果加工成 master 采样率的单声道波形。

    静音裁剪发生在原生采样率上（先裁剪再重采样，避免重采样引入的噪声
    干扰 RMS 判定）；裁剪策略保守（保留一窗余量 + 10ms 淡入淡出），
    阈值默认自适应（见 `trim_silence`，F06：轻声不被误杀）。
    """
    mono_native = downmix_to_mono(result.audio)
    before = mono_native.size / result.sample_rate
    trimmed = trim_silence(
        mono_native,
        result.sample_rate,
        threshold=trim_threshold,
        window_ms=trim_window_ms,
    )
    after = trimmed.size / result.sample_rate
    resampled = resample_pcm(
        trimmed, result.sample_rate, master_sample_rate, ffmpeg=ffmpeg
    )
    return ProcessedAudio(
        pcm=resampled,
        native_sample_rate=result.sample_rate,
        master_sample_rate=master_sample_rate,
        trimmed_seconds=max(0.0, before - after),
    )
