#!/usr/bin/env python3
"""
video-tts — 合成引擎：统一重试调度、逐组合成、时间适配与流式拼轨。

`run_engine()` 是整个配音流程的核心循环，按字幕顺序处理每条 `Cue`：

1. 起点取 `max(cue.effective_start, 上一组实际结束时间)`；按
   `timing_mode`（natural / strict_slot）计算允许窗口，窗口 ≤ 0 记
   `NO_WINDOW` 失败。
2. 文本按 `split_long_text()` 切块；每块先查 v2 原生缓存（键含 provider /
   模型 / 音色或 design / 风格 / 参考音频内容哈希），未命中才调用
   provider。**重试只在这一处控制**：每块总提交预算 `max_attempts`（默认
   3，含首次），provider 只返回错误分类——fatal / submission_unknown
   立即停止整个任务（修复条件后由用户恢复），retryable 在预算内退避重试
   （遵守 Retry-After），invalid_output（空音频 / NaN / 坏采样率）同样
   占预算且绝不写缓存。
3. 原生音频（带真实采样率）校验后立即写缓存；随后在原生采样率上裁剪
   首尾静音、下混、ffmpeg aresample 重采样到 `master_sample_rate`
   （默认 48000），时长用转换后的真实样本数计算。
4. `plan_fit()` 按允许窗口决定倍率：原速放得下用 1.0（natural 模式可借
   字幕后的空档）；需要加速时 ≤ `max_speed` 变速（> `warn_speed` 记
   accelerated 警告）；超过 `max_speed` 进入 **overflow——默认
   （overflow_policy=error）不截断**，标记 needs_attention 并中止；显式
   `truncate` 才按窗口裁剪 + 淡出，记录裁剪秒数。
5. 各组按起点经 `write_track()` 流式写入整轨 WAV（原子替换）；越界 /
   重叠检查集中在 `validate_placements` 一处。
6. 每组的合成时长、最终时长、倍率、动作、尝试次数与缓存命中记入
   `SegmentResult`，供报告与 job manifest 使用。

`continue_on_error=True` 时单组失败（无窗口、重试耗尽、无效音频等）只记
失败结果并继续，最终产物为 partial；fatal 错误、提交状态不明与默认策略下
的 overflow 仍然立即中止（这类问题不会因继续而消失）。
"""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Callable

import numpy as np

from audio_checks import validate_pcm
from audio_fit import (
    DEFAULT_SAFETY_GAP,
    FitAction,
    allowed_window,
    apply_atempo,
    plan_fit,
    split_long_text,
    trim_silence,
)
from audio_pipeline import downmix_to_mono, resample_pcm
from cache import SegmentCache, stable_cache_key
from providers.errors import (
    DOWNLOAD_FAILED,
    FATAL,
    SUBMISSION_UNKNOWN,
    SynthesisError,
)
from srt_parse import Cue
from track_build import write_track_files, write_wav

if TYPE_CHECKING:
    from providers.base import Voice

Progress = Callable[[str], None]
# 逐组结果回调：`(0 基组序号, SegmentResult)`；每组完成/失败立即触发，
# 供调用方把逐组状态原子落盘（manifest）——不等引擎全部返回。
GroupCallback = Callable[[int, "SegmentResult"], None]

_FADE_SECONDS = 0.050
# 采样点取整只允许 ≤1ms 的边界修正；更长修正按 overflow 处理
# （旧的 50ms「无损微调」豁免已删除，spec §7）。
_ROUNDING_EPSILON = 0.001

# 极短语气词（「嗯」「好」）可能天然短于 0.2s：文本很短时放宽下限，
# 仍要求非空、有限、非静音。
_SHORT_TEXT_CHARS = 4
_SHORT_MIN_DURATION = 0.05
_DEFAULT_MIN_DURATION = 0.2

TIMING_NATURAL = "natural"
TIMING_STRICT = "strict_slot"
OVERFLOW_ERROR = "error"
OVERFLOW_TRUNCATE = "truncate"


class EngineAbort(RuntimeError):
    """引擎主动中止（fatal / 提交状态不明 / overflow / 取消）。

    `results` 携带已完成的逐组结果，调用方据此写 job manifest 与报告。
    """

    def __init__(self, reason: BaseException | str, results: list["SegmentResult"]):
        if isinstance(reason, BaseException):
            message = str(reason) or type(reason).__name__
        else:
            message = str(reason)
        super().__init__(message)
        self.results = results
        self.error = reason if isinstance(reason, BaseException) else None


@dataclass
class EngineOptions:
    """一次配音运行的选项。"""

    master_sample_rate: int = 48000
    timing_mode: str = TIMING_NATURAL
    overflow_policy: str = OVERFLOW_ERROR
    safety_gap: float = DEFAULT_SAFETY_GAP
    warn_speed: float = 1.15
    max_speed: float = 1.30
    # 每块合成提交的总预算（含首次）；下载重试在 provider 内单独计数。
    max_attempts: int = 3
    retry_delays: tuple[float, ...] = (1.0, 2.0)
    keep_segments: bool = False
    segments_dir: Path | None = None
    no_cache: bool = False
    continue_on_error: bool = False
    ffmpeg: str = "ffmpeg"
    design: str | None = None
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
    ref_audio: str | None = None
    ref_text: str | None = None
    # 参考音频内容 SHA-256（任务准备阶段算一次，进缓存键；不是路径）。
    ref_audio_sha256: str | None = None

    def __post_init__(self) -> None:
        if self.timing_mode not in (TIMING_NATURAL, TIMING_STRICT):
            raise ValueError(f"unknown timing_mode: {self.timing_mode!r}")
        if self.overflow_policy not in (OVERFLOW_ERROR, OVERFLOW_TRUNCATE):
            raise ValueError(
                f"unknown overflow_policy: {self.overflow_policy!r}"
            )
        if self.master_sample_rate <= 0:
            raise ValueError(
                f"master_sample_rate must be positive, got {self.master_sample_rate}"
            )
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")


@dataclass
class SegmentResult:
    """单组字幕的合成与适配结果。"""

    cue: Cue
    synth_duration: float          # 裁剪静音后的原生时长（秒，与采样率无关）
    final_duration: float
    speed: float
    action: FitAction
    warning: str | None
    failed: bool
    actual_start: float | None = None
    actual_end: float | None = None
    truncated_seconds: float = 0.0   # 显式 truncate 裁掉的内容秒数
    overflow_gap: float = 0.0        # overflow：按 max_speed 仍差多少秒
    attempts: int = 0                # 本组全部块的合成提交总次数
    cache_hits: int = 0              # 命中原生缓存的块数
    chunks: int = 0
    native_sample_rate: int | None = None
    trimmed_seconds: float = 0.0     # 静音裁剪掉的秒数（原生）
    cache_key: str | None = None     # 单块组的缓存键（多块组为 None）
    error_kind: str | None = None
    synth_seconds: float = 0.0       # 本组合成墙钟耗时（含重试）
    # download_failed 收据：服务端已生成（可能已计费）的结果地址。恢复时
    # 只按 URL 重新下载，绝不重新提交合成。
    audio_url: str | None = None
    request_id: str | None = None
    downloaded: bool = False         # 本组音频来自收据下载而非新合成
    status: str = "ok"               # ok | failed | needs_attention | submission_unknown | download_failed


def _provider_info(provider) -> dict:
    """返回 provider 自描述（名称 / 模型 / 后端版本），失败时降级。"""
    info: dict = {}
    describe = getattr(provider, "describe", None)
    if callable(describe):
        try:
            raw = describe()
        except Exception:
            raw = None
        if isinstance(raw, dict):
            info = raw
    if not info.get("provider"):
        info["provider"] = type(provider).__name__
    return info


def _style_dict(options: EngineOptions) -> dict:
    """收集影响合成的全部风格参数（进缓存键 / 透传 provider）。"""
    style: dict = {}
    for key in (
        "rate", "pitch", "volume", "seed", "temperature", "top_p", "top_k",
    ):
        value = getattr(options, key)
        if value is not None:
            style[key] = value
    if options.enable_ssml:
        style["enable_ssml"] = True
    if options.hot_fix is not None:
        style["hot_fix"] = options.hot_fix
    return style


def _cache_material(
    provider_info: dict,
    voice: Voice | None,
    options: EngineOptions,
    instruct: str,
    lang: str,
    chunk: str,
    chunk_index: int,
    chunk_count: int,
    style: dict,
) -> dict:
    """构造单块的 v2 缓存键材料（结构化，不再拼接字符串）。"""
    if options.design is not None:
        voice_part = {"design": options.design}
        model_id = str(provider_info.get("model") or "")
    elif options.ref_audio:
        voice_part = {"clone": True}
        model_id = str(
            voice.model if voice is not None else provider_info.get("model") or ""
        )
    elif voice is None:
        voice_part = {"voice_id": ""}
        model_id = str(provider_info.get("model") or "unknown")
    else:
        voice_part = {"voice_id": voice.voice_id}
        model_id = voice.model

    material: dict = {
        "provider": str(provider_info.get("provider") or ""),
        "model": model_id,
        "model_revision": str(provider_info.get("model_revision") or ""),
        "backend": (
            f"{provider_info.get('backend', '')}"
            f"{provider_info.get('backend_version', '')}"
        ),
        "voice": voice_part,
        "instruct": instruct or "",
        "lang": lang,
        "text": {
            "chunk_index": chunk_index,
            "chunk_count": chunk_count,
            "text": chunk,
        },
        "style": style,
    }
    if options.ref_audio:
        material["ref"] = {
            "audio_sha256": options.ref_audio_sha256 or "",
            "ref_text": options.ref_text or "",
            # v2：F01 修复前克隆参数从未传到 provider（假预设音色 ref-clone
            # 合成的音频污染过缓存）。带版本标记使旧克隆缓存全部失效；
            # 预设音色缓存不受影响。
            "call_version": 2,
        }
    return material


def _min_duration_for(text: str) -> float:
    """按文本长度选择最短有效时长（极短语气词放宽到 0.05s）。"""
    return _SHORT_MIN_DURATION if len(text.strip()) <= _SHORT_TEXT_CHARS else _DEFAULT_MIN_DURATION


def _backoff_delay(
    options: EngineOptions, attempt: int, retry_after: float | None
) -> float:
    """选择下一次重试前的等待秒数（遵守 Retry-After；测试可传 0）。"""
    if retry_after is not None and retry_after > 0:
        return retry_after
    if not options.retry_delays:
        return 0.0
    return options.retry_delays[min(attempt - 1, len(options.retry_delays) - 1)]


def _put_cached(cache: SegmentCache, key: str, pcm: np.ndarray, rate: int) -> None:
    """写缓存失败绝不失败本组（cache.put 内部兜底之外的纵深防御）。

    缓存是加速手段而非正确性依赖；`OSError`（磁盘满 / 只读）只影响
    下次能否命中，已取得的音频照常进入拼轨。
    """
    try:
        cache.put(key, pcm, rate)
    except OSError:
        pass


def _synthesize_chunk(
    provider,
    voice: Voice | None,
    instruct: str,
    lang: str,
    chunk: str,
    chunk_index: int,
    chunk_count: int,
    options: EngineOptions,
    cache: SegmentCache,
    provider_info: dict,
    style: dict,
    receipt: dict | None = None,
    on_submit: Callable[[], None] | None = None,
) -> tuple[np.ndarray, int, str, int, bool, bool]:
    """取回或合成一个文本块。

    返回 `(原生单声道波形, 真实采样率, 缓存键, 提交次数, 是否缓存命中,
    是否收据下载)`。缓存内容是**原生采样率**的音频：改制作采样率 / 时间窗 /
    max_speed 都能复用，只重做后续加工。重试预算由本函数统一控制（spec §10）。

    `receipt` 是上次 ``download_failed`` 落盘的收据（audio_url /
    request_id）：服务端已生成该文本的音频（可能已计费），本次**只下载、
    不重新提交**；下载预算在 provider 内独立计。
    """
    key = stable_cache_key(
        _cache_material(
            provider_info, voice, options, instruct, lang,
            chunk, chunk_index, chunk_count, style,
        )
    )
    use_cache = not options.no_cache
    if use_cache:
        cached = cache.get(key)
        if cached is not None:
            pcm, rate = cached
            try:
                validate_pcm(pcm, rate, min_duration=_min_duration_for(chunk))
            except ValueError:
                pass  # 损坏缓存按未命中处理，重新合成覆盖。
            else:
                return pcm, rate, key, 0, True, False

    # 收据优先：恢复时先尝试重新下载上次已生成的结果（F02：绝不重提）。
    audio_url = (receipt or {}).get("audio_url")
    if audio_url:
        downloader = getattr(provider, "download", None)
        if callable(downloader):
            result = downloader(
                audio_url, voice=voice,
                request_id=(receipt or {}).get("request_id"),
            )
            mono = downmix_to_mono(result.audio)
            validate_pcm(mono, result.sample_rate, min_duration=_min_duration_for(chunk))
            if use_cache:
                _put_cached(cache, key, mono, result.sample_rate)
            return mono, int(result.sample_rate), key, 0, False, True
        # provider 不具备下载能力（换了后端）→ 按正常合成走。

    if on_submit is not None:
        on_submit()  # 真正要提交了（缓存未命中、无收据）才落 submitting

    attempts = 0
    # F01：克隆参考必须真实穿透到 provider（voice=None，绝不伪装预设
    # 音色）；缓存身份走 material["ref"]，不与 style 混淆。
    synth_voice = None if options.ref_audio else voice
    ref_kwargs: dict = {}
    if options.ref_audio:
        ref_kwargs = {
            "ref_audio": options.ref_audio,
            "ref_text": options.ref_text,
        }
    while True:
        attempts += 1
        try:
            result = provider.synthesize(
                chunk, synth_voice, instruct=instruct, lang=lang,
                **style, **ref_kwargs,
            )
            mono = downmix_to_mono(result.audio)
            validate_pcm(mono, result.sample_rate, min_duration=_min_duration_for(chunk))
            if use_cache:
                _put_cached(cache, key, mono, result.sample_rate)
            return mono, int(result.sample_rate), key, attempts, False, False
        except SynthesisError as exc:
            if exc.kind in (FATAL, SUBMISSION_UNKNOWN, DOWNLOAD_FAILED):
                exc.attempts = attempts  # 立即停止整个任务，由用户修复后恢复。
                raise
            if attempts < options.max_attempts:
                delay = _backoff_delay(options, attempts, exc.retry_after)
                if delay > 0:
                    time.sleep(delay)
                continue
            error = SynthesisError(
                f"synthesis failed after {attempts} attempts: {exc}",
                kind=exc.kind,
                retry_after=exc.retry_after,
                request_id=exc.request_id,
                audio_url=exc.audio_url,
            )
            error.attempts = attempts
            raise error from exc
        except ValueError as exc:
            # validate_pcm 拒绝：空 / NaN / 静音 / 过短——按 invalid_output
            # 占用重试预算，坏结果绝不写缓存。
            if attempts < options.max_attempts:
                continue
            error = SynthesisError(
                f"synthesis output rejected after {attempts} attempts: {exc}",
                kind="invalid_output",
            )
            error.attempts = attempts
            raise error from exc
        except Exception as exc:  # 未知异常：按可重试处理，但有预算上限。
            if attempts < options.max_attempts:
                delay = _backoff_delay(options, attempts, None)
                if delay > 0:
                    time.sleep(delay)
                continue
            error = SynthesisError(
                f"synthesis failed after {attempts} attempts: {exc}",
                kind="invalid_output",
            )
            error.attempts = attempts
            raise error from exc


def _fade_out(pcm: np.ndarray, sample_rate: int) -> np.ndarray:
    """返回末尾带 50 ms 线性淡出的副本（显式 truncate 裁剪边界用）。"""
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
    return f"{hours:02}:{minutes:02}:{secs:02}.{millis:03d}"


def _report_progress(
    progress: Progress | None,
    position: int,
    total: int,
    cue: Cue,
    window: float,
    result: SegmentResult,
    timing_mode: str,
) -> None:
    """向调用方报告单组进度（默认直接 print）。"""
    if progress is None:
        return
    slot = cue.end - cue.start
    boundary = "槽位" if timing_mode == TIMING_STRICT else "窗口"
    status = result.status if result.failed else result.action.value
    line = (
        f"[{position}/{total}] {_format_time(cue.effective_start)}  "
        f"合成 {result.synth_duration:.2f}s  槽位 {slot:.2f}s  "
        f"{boundary} {window:.2f}s  atempo {result.speed:.2f}x  {status}"
    )
    if result.attempts > 1:
        line += f"  尝试 {result.attempts} 次"
    if result.cache_hits:
        line += f"  缓存命中 {result.cache_hits}/{result.chunks}"
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
    track_path: Path,
    progress: Progress | None = print,
    receipts: dict[int, dict] | None = None,
    on_result: GroupCallback | None = None,
    on_submit: Callable[[int], None] | None = None,
) -> list[SegmentResult]:
    """逐组合成、适配，并把整轨流式写到 `track_path`。

    返回与 `cues` 一一对应的 `SegmentResult` 列表（失败的条目也保留）。
    单组失败默认中止；`continue_on_error=True` 时记录失败并继续（产物为
    partial）。fatal 错误、提交状态不明（submission_unknown）、下载收据
    耗尽（download_failed）与默认策略下的 overflow 无条件中止，抛
    `EngineAbort`（携带已完成的结果）。

    `receipts` 按 0 基组序号给出上次 ``download_failed`` 的收据；命中收据
    的组只重新下载、不重新提交。`on_result` 在每组结果落定后立即触发
    （含失败与 overflow），调用方据此逐组原子保存状态。`on_submit` 在
    每组首次提交前触发，供调用方落「submitting」标记（A09：崩溃后能看出
    提交是否已发出）。
    """
    master_rate = options.master_sample_rate
    provider_info = _provider_info(provider)
    style = _style_dict(options)

    segments_dir: Path | None = None
    if options.keep_segments:
        if options.segments_dir is None:
            raise ValueError("keep_segments requires options.segments_dir")
        segments_dir = Path(options.segments_dir)
        segments_dir.mkdir(parents=True, exist_ok=True)

    results: list[SegmentResult] = []
    # F07：placements 只保存文件引用（起点, part 路径, 样本数），
    # 不保存全片 ndarray；内部片段目录在整轨写出成功后清理。
    parts_dir = track_path.parent / (track_path.name + ".parts")
    placements: list[tuple[float, Path, int]] = []
    previous_end = 0.0
    total = len(cues)

    def _fail_result(cue, **kwargs) -> SegmentResult:
        fields: dict = dict(
            cue=cue, synth_duration=0.0, final_duration=0.0, speed=1.0,
            action=FitAction.NO_WINDOW, warning="", failed=True,
        )
        fields.update(kwargs)
        return SegmentResult(**fields)

    try:
        for position, cue in enumerate(cues, start=1):
            effective_start = max(cue.effective_start, previous_end)
            window = allowed_window(
                cue, effective_start, options.timing_mode, options.safety_gap
            )

            def _record(result: SegmentResult, window: float = window) -> None:
                """记录一组结果：进度 + 逐组回调（manifest 即时落盘）。"""
                results.append(result)
                _report_progress(
                    progress, position, total, cue, window, result,
                    options.timing_mode,
                )
                if on_result is not None:
                    on_result(position - 1, result)

            if window <= 0:
                result = _fail_result(
                    cue,
                    warning="no usable window before the next cue",
                    status="failed",
                )
                _record(result)
                if not options.continue_on_error:
                    raise EngineAbort(
                        f"cue {cue.index}: no usable window "
                        f"(effective start {effective_start:.3f}s)",
                        results,
                    )
                continue

            receipt = (receipts or {}).get(position - 1)
            submit_marked = False

            def _mark_submit() -> None:
                """每组首次真实提交前触发一次 submitting 标记。"""
                nonlocal submit_marked
                if not submit_marked and on_submit is not None:
                    submit_marked = True
                    on_submit(position - 1)

            chunks = split_long_text(cue.text) or [cue.text]
            pieces: list[tuple[np.ndarray, int]] = []
            group_attempts = 0
            group_hits = 0
            group_downloaded = False
            native_rate: int | None = None
            single_key: str | None = None
            synth_started = time.monotonic()
            try:
                if progress is not None:
                    progress(
                        f"[{position}/{total}] {_format_time(effective_start)}"
                        " 当前组生成中…"
                    )
                for chunk_index, chunk in enumerate(chunks):
                    mono, rate, key, attempts, hit, downloaded = _synthesize_chunk(
                        provider, voice, instruct, lang, chunk, chunk_index,
                        len(chunks), options, cache, provider_info, style,
                        receipt=receipt, on_submit=_mark_submit,
                    )
                    group_attempts += attempts
                    group_hits += 1 if hit else 0
                    group_downloaded = group_downloaded or downloaded
                    if native_rate is None:
                        native_rate = rate
                    elif rate != native_rate:
                        raise SynthesisError(
                            f"cue {cue.index}: chunks returned mixed sample "
                            f"rates ({native_rate} vs {rate})",
                            kind="invalid_output",
                        )
                    if len(chunks) == 1:
                        single_key = key
                    pieces.append((mono, rate))
                synth_seconds = time.monotonic() - synth_started
            except SynthesisError as exc:
                synth_seconds = time.monotonic() - synth_started
                group_attempts += getattr(exc, "attempts", 0) or 0
                if exc.kind == SUBMISSION_UNKNOWN:
                    status = "submission_unknown"
                elif exc.kind == DOWNLOAD_FAILED:
                    status = "download_failed"
                else:
                    status = "failed"
                result = _fail_result(
                    cue,
                    warning=f"failed: {exc}",
                    status=status,
                    attempts=group_attempts,
                    chunks=len(chunks),
                    error_kind=exc.kind,
                    synth_seconds=synth_seconds,
                    audio_url=exc.audio_url,
                    request_id=exc.request_id,
                )
                _record(result)
                # fatal / submission_unknown / download_failed 无论
                # continue_on_error 都中止；重试预算耗尽的暂时性错误按
                # continue_on_error 决定。
                if exc.kind in (
                    FATAL, SUBMISSION_UNKNOWN, DOWNLOAD_FAILED,
                ) or not options.continue_on_error:
                    raise EngineAbort(exc, results)
                continue

            # 原生块拼接 → 原生采样率裁剪静音 → 下混已做 → 重采样到 master。
            native = (
                pieces[0][0]
                if len(pieces) == 1
                else np.concatenate([piece[0] for piece in pieces])
            )
            assert native_rate is not None  # pieces 非空由上面循环保证
            try:
                trimmed = trim_silence(native, native_rate)
            except ValueError as exc:
                result = _fail_result(
                    cue,
                    warning=f"failed: {exc}",
                    status="failed",
                    attempts=group_attempts,
                    cache_hits=group_hits,
                    chunks=len(chunks),
                    native_sample_rate=native_rate,
                    error_kind="invalid_output",
                    synth_seconds=synth_seconds,
                )
                _record(result)
                if not options.continue_on_error:
                    raise EngineAbort(exc, results)
                continue
            trimmed_seconds = native.size / native_rate - trimmed.size / native_rate
            try:
                master_pcm = resample_pcm(
                    trimmed, native_rate, master_rate, ffmpeg=options.ffmpeg
                )
            except RuntimeError as exc:
                result = _fail_result(
                    cue,
                    warning=f"failed: {exc}",
                    status="failed",
                    attempts=group_attempts,
                    cache_hits=group_hits,
                    chunks=len(chunks),
                    native_sample_rate=native_rate,
                    error_kind="invalid_output",
                    synth_seconds=synth_seconds,
                )
                _record(result)
                if not options.continue_on_error:
                    raise EngineAbort(exc, results)
                continue

            synth_duration = master_pcm.size / master_rate
            plan = plan_fit(
                synth_duration, window,
                warn_speed=options.warn_speed, max_speed=options.max_speed,
            )

            action = plan.action
            warning = plan.warning
            speed = plan.speed
            truncated_seconds = 0.0
            overflow_gap = 0.0
            failed = False
            status = "ok"
            final: np.ndarray

            if action is FitAction.NO_WINDOW:  # pragma: no cover - 上面已挡
                raise EngineAbort(
                    f"cue {cue.index}: no usable window", results
                )
            elif action is FitAction.OVERFLOW:
                at_max = synth_duration / max(speed, 1e-9)
                overflow_gap = max(0.0, at_max - window)
                if options.overflow_policy == OVERFLOW_TRUNCATE:
                    final_full = apply_atempo(
                        master_pcm, speed, master_rate, ffmpeg=options.ffmpeg
                    )
                    limit = max(0, int(window * master_rate))
                    final = _fade_out(final_full[:limit], master_rate)
                    truncated_seconds = max(
                        0.0, final_full.size / master_rate - limit / master_rate
                    )
                    action = FitAction.TRUNCATED
                    warning = (
                        f"truncated {truncated_seconds:.2f}s at the window "
                        "boundary (explicit --overflow-policy truncate)"
                    )
                    status = "ok"  # 有损成功：CLI 层映射 completed_with_warnings
                else:
                    # 默认策略：不截断、不出伪完整成品；原生音频已在缓存，
                    # 用户可调整边界 / 上限 / 文本后 resume。
                    result = SegmentResult(
                        cue=cue,
                        synth_duration=synth_duration,
                        final_duration=0.0,
                        speed=speed,
                        action=FitAction.OVERFLOW,
                        warning=(
                            f"needs_attention: {warning}; gap "
                            f"{overflow_gap:.2f}s at max speed"
                        ),
                        failed=True,
                        status="needs_attention",
                        attempts=group_attempts,
                        cache_hits=group_hits,
                        chunks=len(chunks),
                        native_sample_rate=native_rate,
                        trimmed_seconds=trimmed_seconds,
                        cache_key=single_key,
                        synth_seconds=synth_seconds,
                        overflow_gap=overflow_gap,
                        downloaded=group_downloaded,
                    )
                    _record(result)
                    raise EngineAbort(
                        SynthesisError(
                            f"cue {cue.index}: overflow — synthesis "
                            f"{synth_duration:.2f}s cannot fit window "
                            f"{window:.2f}s even at {speed:.2f}x "
                            f"(gap {overflow_gap:.2f}s); adjust the merge "
                            "plan, raise --max-speed, or enable explicit "
                            "truncation, then resume",
                            kind=FATAL,
                        ),
                        results,
                    )
            else:
                final = apply_atempo(
                    master_pcm, speed, master_rate, ffmpeg=options.ffmpeg
                )
                limit = max(0, int(window * master_rate))
                if final.size > limit:
                    overrun = final.size - limit
                    if overrun <= int(_ROUNDING_EPSILON * master_rate):
                        final = final[:limit]  # ≤1ms 取整修正，不计截断
                    elif options.overflow_policy == OVERFLOW_TRUNCATE:
                        truncated_seconds = overrun / master_rate
                        final = _fade_out(final[:limit], master_rate)
                        action = FitAction.TRUNCATED
                        warning = (
                            f"truncated {truncated_seconds:.2f}s at the "
                            "window boundary (explicit --overflow-policy "
                            "truncate)"
                        )
                    else:
                        result = SegmentResult(
                            cue=cue,
                            synth_duration=synth_duration,
                            final_duration=0.0,
                            speed=speed,
                            action=FitAction.OVERFLOW,
                            warning=(
                                f"processed audio overruns the window by "
                                f"{overrun / master_rate:.3f}s; refusing to "
                                "cut without --overflow-policy truncate"
                            ),
                            failed=True,
                            status="needs_attention",
                            attempts=group_attempts,
                            cache_hits=group_hits,
                            chunks=len(chunks),
                            native_sample_rate=native_rate,
                            trimmed_seconds=trimmed_seconds,
                            cache_key=single_key,
                            synth_seconds=synth_seconds,
                            overflow_gap=overrun / master_rate,
                            downloaded=group_downloaded,
                        )
                        _record(result)
                        raise EngineAbort(
                            SynthesisError(
                                f"cue {cue.index}: overrun "
                                f"{overrun / master_rate:.3f}s exceeds the "
                                "1ms rounding allowance", kind=FATAL,
                            ),
                            results,
                        )

            final_duration = final.size / master_rate
            if segments_dir is not None:
                write_wav(
                    segments_dir / f"{cue.index}.wav", final, master_rate
                )
            # F07：处理完的片段立即落盘，placements 只保留文件引用与样本
            # 数——内存中不再累积全片 PCM（长片时长线性增长的是任务文件
            # 里的 part，不是内存）。
            parts_dir.mkdir(parents=True, exist_ok=True)
            part_path = parts_dir / f"{position:05d}.wav"
            write_wav(part_path, final, master_rate)
            placements.append((effective_start, part_path, final.size))
            previous_end = effective_start + final_duration
            result = SegmentResult(
                cue=cue,
                synth_duration=synth_duration,
                final_duration=final_duration,
                speed=speed,
                action=action,
                warning=warning,
                failed=False,
                actual_start=effective_start,
                actual_end=effective_start + final_duration,
                truncated_seconds=truncated_seconds,
                attempts=group_attempts,
                cache_hits=group_hits,
                chunks=len(chunks),
                native_sample_rate=native_rate,
                trimmed_seconds=trimmed_seconds,
                cache_key=single_key,
                synth_seconds=synth_seconds,
                downloaded=group_downloaded,
                status="ok",
            )
            _record(result)
    except KeyboardInterrupt:
        raise EngineAbort(KeyboardInterrupt("cancelled by user"), results)

    write_track_files(track_path, placements, total_duration, master_rate)
    # 整轨写成功后清理内部片段文件（abort 路径保留它们作为内部材料；
    # 原生音频另有缓存，part 始终可由缓存重加工得到）。
    shutil.rmtree(parts_dir, ignore_errors=True)
    return results
