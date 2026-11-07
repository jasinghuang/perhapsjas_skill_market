#!/usr/bin/env python3
"""
video-tts — 合成引擎：逐条合成、适配、缓存与拼轨。

`run_engine()` 是整个配音流程的核心循环，按字幕顺序处理每条 `Cue`：

1. 起点取 `max(cue.effective_start, 上一条实际结束时间)`；起点已到
   `next_start` 时该条无可用窗口，记 `NO_WINDOW` 失败。
2. 文本按 `split_long_text()` 切块；每块先查 `SegmentCache`，未命中才调用
   provider。合成失败（provider 异常或校验不通过）重试一次，仍失败才向上
   抛出；结果经 `trim_silence()` / `validate_pcm()` 校验后才写缓存，绝不
   缓存空音频、静音或 NaN。
3. 用 `plan_fit()` 决定 atempo 倍率与动作，`apply_atempo()` 施加到整条音频；
   `TRUNCATED` 时在 `next_start` 前截断并做 50 ms 淡出，保证不与下一条重叠。
4. 处理结果按起点交给 `track_build.build_track()` 拼成整轨，因此越界 /
   重叠检查只保留在一处。
5. 每条的合成时长、最终时长、倍率、动作与 warning 记入 `SegmentResult`，
   供 CLI 输出报告。

`continue_on_error=True` 时单条失败（无窗口、provider 异常、无效音频等）
只记录失败结果并继续；否则立刻抛出，避免生成残缺成品。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable

import numpy as np

from audio_checks import validate_pcm
from audio_fit import (
    FitAction,
    apply_atempo,
    plan_fit,
    split_long_text,
    trim_silence,
)
from cache import SegmentCache, segment_cache_key
from srt_parse import Cue
from track_build import build_track, write_wav

if TYPE_CHECKING:
    from providers.base import Voice

Progress = Callable[[str], None]

_FADE_SECONDS = 0.050
# atempo / 采样取整可能让结果比可用窗口多几个样本；50ms 内视为取整，
# 不记 TRUNCATED，避免把“无损微调”报成截断。
_SAFETY_TRIM_EPSILON = 0.050


@dataclass
class EngineOptions:
    """一次配音运行的选项。"""

    sample_rate: int = 24000
    warn_speed: float = 1.15
    max_speed: float = 1.30
    keep_segments: bool = False
    segments_dir: Path | None = None
    no_cache: bool = False
    continue_on_error: bool = False
    # 在线 provider 的配音优化参数；本地 provider 会拒绝非空 style。
    rate: float | None = None
    pitch: float | None = None
    volume: int | None = None
    seed: int | None = None
    enable_ssml: bool = False
    hot_fix: dict | None = None
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None


@dataclass
class SegmentResult:
    """单条字幕的合成与适配结果。"""

    cue: Cue
    synth_duration: float
    final_duration: float
    speed: float
    action: FitAction
    warning: str | None
    failed: bool


def _provider_name(provider) -> str:
    """返回稳定的 provider 名，用作缓存 key 的一部分。"""
    describe = getattr(provider, "describe", None)
    if callable(describe):
        try:
            info = describe()
        except Exception:
            info = None
        if isinstance(info, dict):
            for key in ("provider", "name"):
                value = info.get(key)
                if value:
                    return str(value)
    return type(provider).__name__


def _voice_ids(voice: Voice | None) -> tuple[str, str]:
    """返回 `(voice_id, model_id)`；测试 / 假 provider 的 `None` 走空值归一化。"""
    if voice is None:
        return "", "unknown"
    return voice.voice_id, voice.model


def _cache_key(
    provider_name: str,
    voice: Voice | None,
    instruct: str,
    lang: str,
    chunk: str,
    chunk_index: int,
    chunk_count: int,
    style: dict | None = None,
) -> str:
    """块级缓存 key；长文本切块时把块序号一并纳入 key。

    `normalize_text()` 会把所有空白（含换行）压成单个空格，因此规范化后的
    文本里不可能出现 `\\n`；用它分隔块序号，任何单块文本都不会伪造成
    多块文本的 key。
    """
    voice_id, model_id = _voice_ids(voice)
    text = chunk if chunk_count == 1 else f"{chunk_index}\n{chunk}"
    if style:
        # 语速 / 音调 / 音量 / seed / SSML 都影响音频，必须进入缓存键。
        text += "\nstyle=" + json.dumps(
            style, sort_keys=True, ensure_ascii=False, default=str
        )
    return segment_cache_key(
        provider_name, model_id, voice_id, instruct, lang, text
    )


def _synthesize_chunk(
    provider,
    voice: Voice | None,
    instruct: str,
    lang: str,
    chunk: str,
    chunk_index: int,
    chunk_count: int,
    sample_rate: int,
    cache: SegmentCache,
    use_cache: bool,
    provider_name: str,
    style: dict | None = None,
) -> np.ndarray:
    """取回或合成一个文本块，返回已裁剪并校验过的 float32 PCM。"""
    key = _cache_key(
        provider_name,
        voice,
        instruct,
        lang,
        chunk,
        chunk_index,
        chunk_count,
        style=style,
    )
    if use_cache:
        cached = cache.get(key, sample_rate)
        if cached is not None:
            try:
                validate_pcm(cached, sample_rate)
            except ValueError:
                cached = None  # 损坏的缓存按未命中处理，重新合成覆盖。
            else:
                return cached

    # spec §8.4：单块合成失败（provider 异常或校验不通过）重试一次，
    # 第二次仍失败才把异常抛给调用方（或由 continue_on_error 记为失败）。
    for attempt in range(2):
        try:
            raw = provider.synthesize(
                chunk, voice, instruct=instruct, lang=lang, **(style or {})
            )
            pcm = trim_silence(raw, sample_rate)
            validate_pcm(pcm, sample_rate)
        except Exception:
            if attempt == 1:
                raise
            continue
        if use_cache:
            cache.put(key, pcm, sample_rate)
        return pcm

    raise AssertionError("retry loop exhausted")  # pragma: no cover


def _fade_out(pcm: np.ndarray, sample_rate: int) -> np.ndarray:
    """返回末尾带 50 ms 线性淡出的副本。"""
    samples = np.asarray(pcm, dtype=np.float32).copy()
    fade = min(int(sample_rate * _FADE_SECONDS), samples.size)
    if fade > 0:
        samples[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
    return samples


def _format_time(seconds: float) -> str:
    """把秒数格式化成 `HH:MM:SS.mmm`。"""
    millis = int(round(max(0.0, seconds) * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _report_progress(
    progress: Progress | None,
    position: int,
    total: int,
    cue: Cue,
    available: float,
    result: SegmentResult,
) -> None:
    """向调用方报告单条进度（默认直接 print）。

    “窗口”是字幕自身的 `end - start`；“可用”是从 `effective_start` 到
    `next_start` 的实际可用时长，两者在起点被前一条挤后时会不同。
    """
    if progress is None:
        return
    window = cue.end - cue.start
    status = "failed" if result.failed else result.action.value
    line = (
        f"[{position}/{total}] {_format_time(cue.effective_start)}  "
        f"合成 {result.synth_duration:.2f}s  窗口 {window:.2f}s  "
        f"可用 {available:.2f}s  atempo {result.speed:.2f}x  {status}"
    )
    if result.warning:
        line += f"  ({result.warning})"
    progress(line)


def run_engine(
    cues: list[Cue],
    provider,
    voice: Voice | None,
    instruct: str,
    lang: str,
    total_duration: float,
    options: EngineOptions,
    cache: SegmentCache,
    progress: Progress | None = print,
) -> tuple[np.ndarray, list[SegmentResult]]:
    """逐条合成、适配并拼成 `total_duration` 秒的整轨。

    返回 `(master, results)`：`master` 是长度为
    `ceil(total_duration * sample_rate)` 的 float32 单声道缓冲；`results`
    与 `cues` 一一对应（失败的条目也保留，`failed=True`）。合成失败或
    无可用窗口时，默认立刻抛 `ValueError`；`continue_on_error=True` 时
    记录失败并继续。
    """
    sample_rate = options.sample_rate
    provider_name = _provider_name(provider)
    use_cache = not options.no_cache
    style: dict = {}
    for key in ("rate", "pitch", "volume", "seed", "temperature", "top_p", "top_k"):
        value = getattr(options, key)
        if value is not None:
            style[key] = value
    if options.enable_ssml:
        style["enable_ssml"] = True
    if options.hot_fix is not None:
        style["hot_fix"] = options.hot_fix

    segments_dir: Path | None = None
    if options.keep_segments:
        if options.segments_dir is None:
            raise ValueError("keep_segments requires options.segments_dir")
        segments_dir = Path(options.segments_dir)
        segments_dir.mkdir(parents=True, exist_ok=True)

    placements: list[tuple[float, np.ndarray]] = []
    results: list[SegmentResult] = []
    previous_end = 0.0
    total = len(cues)

    for position, cue in enumerate(cues, start=1):
        effective_start = max(cue.effective_start, previous_end)
        available = cue.next_start - effective_start

        if effective_start >= cue.next_start:
            result = SegmentResult(
                cue=cue,
                synth_duration=0.0,
                final_duration=0.0,
                speed=1.0,
                action=FitAction.NO_WINDOW,
                warning="no window before next cue",
                failed=True,
            )
            results.append(result)
            _report_progress(progress, position, total, cue, available, result)
            if not options.continue_on_error:
                raise ValueError(
                    f"cue {cue.index}: no usable window (effective start "
                    f"{effective_start:.3f}s >= next start {cue.next_start:.3f}s)"
                )
            continue

        plan = None
        synth_duration = 0.0
        try:
            chunks = split_long_text(cue.text)
            if not chunks:
                raise ValueError(
                    f"cue {cue.index}: text is empty after normalization"
                )
            pieces = [
                _synthesize_chunk(
                    provider,
                    voice,
                    instruct,
                    lang,
                    chunk,
                    chunk_index,
                    len(chunks),
                    sample_rate,
                    cache,
                    use_cache,
                    provider_name,
                    style=style,
                )
                for chunk_index, chunk in enumerate(chunks)
            ]
            pcm = pieces[0] if len(pieces) == 1 else np.concatenate(pieces)
            synth_duration = pcm.size / sample_rate

            slot = cue.end - cue.start
            plan = plan_fit(
                synth_duration,
                slot,
                available,
                warn_speed=options.warn_speed,
                max_speed=options.max_speed,
            )
            if plan.action is FitAction.NO_WINDOW:
                raise ValueError(
                    f"cue {cue.index}: no usable window "
                    f"(slot {slot:.3f}s, available {available:.3f}s)"
                )

            final = apply_atempo(pcm, plan.speed, sample_rate)
            action = plan.action
            warning = plan.warning
            limit = max(0, int(available * sample_rate))
            if action is FitAction.TRUNCATED:
                final = _fade_out(final[:limit], sample_rate)
            elif final.size > limit:
                # 兜底：即使 plan_fit 判为可放，也绝不越进下一条。
                overrun = final.size - limit
                final = _fade_out(final[:limit], sample_rate)
                if overrun > int(_SAFETY_TRIM_EPSILON * sample_rate):
                    action = FitAction.TRUNCATED
                    warning = "truncated at next cue start"

            final_duration = final.size / sample_rate
            if segments_dir is not None:
                write_wav(segments_dir / f"{cue.index}.wav", final, sample_rate)
            placements.append((effective_start, final))
            previous_end = effective_start + final_duration
            result = SegmentResult(
                cue=cue,
                synth_duration=synth_duration,
                final_duration=final_duration,
                speed=plan.speed,
                action=action,
                warning=warning,
                failed=False,
            )
        except Exception as exc:
            if not options.continue_on_error:
                raise
            result = SegmentResult(
                cue=cue,
                synth_duration=synth_duration,
                final_duration=0.0,
                speed=plan.speed if plan is not None else 1.0,
                action=plan.action if plan is not None else FitAction.NO_WINDOW,
                warning=f"failed: {exc}",
                failed=True,
            )

        results.append(result)
        _report_progress(progress, position, total, cue, available, result)

    master = build_track(total_duration, placements, sample_rate)
    return master, results
