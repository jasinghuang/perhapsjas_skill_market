#!/usr/bin/env python3
"""
video-tts — 非交互 CLI：预检、流程编排、job manifest、报告与退出码。

所有交互选择（provider / 音色 / 语气 / 在线费用确认）由宿主（SKILL.md
流程）在调用本脚本前收集，本脚本只接受参数：

1. 有 `--video` 时先 `probe_video()` 取时长，否则总时长取音频时长或最后
   一组允许结束时间。
2. `load_cues()` 解析 SRT；`--merge-plan` 校验（含 srt_sha256）并合并。
3. 解析音色（`find_voice`）/ VoiceDesign / Base 克隆参考，实例化
   provider 并 `prepare()`；参考音频内容哈希在此时算一次。
4. `run_engine()` 统一重试调度、逐组合成、时间适配（natural /
   strict_slot；overflow 默认 error），把整轨流式写到 `<out>.dub.wav`
   （master 采样率，默认 48kHz）。
5. 有视频且未 `--track-only` 时 `mux_video()` 原子混流 + 双流时长校验。
6. `<out>.dub.srt`（按实际配音起止的块级字幕）、`<out>.report.json`
   （机器可读报告）与 `<out>.job.json`（恢复清单）默认生成。

退出码：0 完整成功（含无内容裁剪的加速警告）；1 运行失败 / partial /
needs_attention / submission_unknown / cancelled；2 参数或输入错误；
3 用户显式允许裁剪且实际发生内容裁剪（有损成品，不能当普通成功）。

`--dry-run` 只读取输入、校验参数并打印计划——不加载模型、不联网、不
合成、不写任何文件（含 dub.srt）；需要保存预览计划用显式 `--write-plan`。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path

from cache import SegmentCache, file_sha256
from engine import (
    EngineAbort,
    EngineOptions,
    SegmentResult,
    run_engine,
)
from job import JobManifest, write_json
from merge_plan import load_merge_plan, plan_payload
from mux import mux_video, probe_audio_duration, probe_video, verify_output
from providers import (
    FLAGSHIP_MODEL,
    LOCAL_BASE_MODEL,
    LOCAL_DESIGN_MODEL,
    find_voice,
    get_provider,
    is_base_model,
    is_voice_design_model,
)
from providers.base import Voice
from providers.errors import SUBMISSION_UNKNOWN, SynthesisError
from srt_parse import Cue, SRTError, Subtitle, load_cues, write_srt

PLAN_PREVIEW = 10
REPORT_SCHEMA = 2
DEFAULT_MASTER_RATE = 48000
ALLOWED_MASTER_RATES = (24000, 44100, 48000)

IS_WINDOWS = platform.system() == "Windows"


def build_parser() -> argparse.ArgumentParser:
    """构造 `video-tts` 的 argparse 解析器（spec §15 的参数表）。"""
    parser = argparse.ArgumentParser(
        prog="video-tts",
        description="把中文 SRT 配成与视频等长的中文配音轨 / 成片（非交互）。",
        allow_abbrev=False,
    )
    parser.add_argument("--srt", required=True, help="中文 SRT 路径（UTF-8）")
    parser.add_argument("--video", help="视频路径；提供则混流输出 mp4")
    parser.add_argument(
        "--audio", help="音频文件（只取时长，不混流；与 --video 互斥）"
    )
    parser.add_argument(
        "--provider",
        required=True,
        choices=("local", "online"),
        help="local = 本地 MLX Qwen3-TTS；online = 百炼 qwen3-tts",
    )
    parser.add_argument("--out", help="输出前缀或 .mp4 路径（默认取视频 / SRT 的 stem）")
    parser.add_argument("--voice", help="音色 ID（本地 9 个 / 在线 16 个）")
    parser.add_argument("--instruct", default="", help="语气 / 风格指令")
    parser.add_argument(
        "--rate", type=float, help="在线语速 0.5-2.0（默认由模型决定）"
    )
    parser.add_argument(
        "--pitch", type=float, help="在线音调 0.5-2.0（默认由模型决定）"
    )
    parser.add_argument(
        "--volume", type=int, help="在线音量 0-100（默认由模型决定）"
    )
    parser.add_argument(
        "--seed", type=int, help="随机种子 0-65535（本地/在线，提升一致性）"
    )
    parser.add_argument(
        "--temperature", type=float, help="本地采样温度（默认 0.9；越低越稳定）"
    )
    parser.add_argument(
        "--top-p", type=float, help="本地 top-p 采样（0-1，默认 1.0）"
    )
    parser.add_argument(
        "--top-k", type=int, help="本地 top-k 采样（默认 50）"
    )
    parser.add_argument(
        "--enable-ssml",
        action="store_true",
        help="在线 SSML 模式（仅 3.1 Plus 旗舰音色支持）",
    )
    parser.add_argument(
        "--hotfix-file",
        help="hot_fix JSON 文件（仅在线 3.1 Plus，强制走 HTTP 兜底）",
    )
    parser.add_argument(
        "--design", help="本地 VoiceDesign 音色描述；与 --voice 互斥"
    )
    parser.add_argument(
        "--ref-audio", help="本地 Base 克隆参考音频（与 --ref-text 成对）"
    )
    parser.add_argument(
        "--ref-text", help="参考音频对应的文本（与 --ref-audio 成对）"
    )
    parser.add_argument("--lang", default="chinese", help="语言代码（默认 chinese）")
    parser.add_argument("--model", help="覆盖 provider 的模型 id")
    parser.add_argument(
        "--tts-endpoint",
        help="DashScope HTTP 兜底 endpoint（仅在 bl 不可用时使用）",
    )
    parser.add_argument("--bl-bin", default="bl", help="百炼 bl CLI 可执行文件")
    parser.add_argument(
        "--track-only", action="store_true", help="只出配音轨，不混流"
    )
    parser.add_argument(
        "--keep-segments", action="store_true", help="保留逐条 wav 到 segments/"
    )
    parser.add_argument("--no-cache", action="store_true", help="禁用片段缓存")
    parser.add_argument("--json-report", help="机器可读报告路径（默认 <out>.report.json）")
    parser.add_argument(
        "--continue-on-error", action="store_true", help="单条失败继续（产物标记 partial）"
    )
    parser.add_argument(
        "--skip-bracketed", action="store_true", help="跳过纯音效标记条目"
    )
    parser.add_argument(
        "--merge-plan",
        help="语义合并计划 JSON（groups 数组；由宿主读 SRT 后生成）",
    )
    parser.add_argument(
        "--max-speed", type=float, default=1.30, help="最大 atempo 倍率（默认 1.30）"
    )
    parser.add_argument(
        "--warn-speed", type=float, default=1.15,
        help="超过该倍率记 accelerated 警告（默认 1.15）",
    )
    parser.add_argument(
        "--timing-mode", choices=("natural", "strict_slot"), default="natural",
        help="natural=优先原速借空档（默认）；strict_slot=严格守字幕边界",
    )
    parser.add_argument(
        "--overflow-policy", choices=("error", "truncate"), default="error",
        help="放不下时：error=停止并保存恢复信息（默认）；truncate=显式裁剪"
             "（退出码 3，completed_with_warnings）",
    )
    parser.add_argument(
        "--master-sample-rate", type=int, default=DEFAULT_MASTER_RATE,
        help=f"制作与默认导出采样率（默认 {DEFAULT_MASTER_RATE}；"
             f"可选 {'/'.join(map(str, ALLOWED_MASTER_RATES))}）",
    )
    parser.add_argument(
        "--safety-gap", type=float, default=0.10,
        help="natural 模式借用空档时与下一组起点的安全间隔秒数（默认 0.10）",
    )
    parser.add_argument(
        "--max-attempts", type=int, default=3,
        help="每组合成提交总预算（含首次，默认 3）",
    )
    parser.add_argument(
        "--resume", help="从指定 job manifest（<out>.job.json）恢复任务",
    )
    parser.add_argument(
        "--overwrite", action="store_true",
        help="显式允许覆盖已存在的成品（默认拒绝覆盖）",
    )
    parser.add_argument(
        "--write-plan", action="store_true",
        help="保存预览计划（<out>.plan.json + <out>.plan.srt）；不合成",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="确认在线合成费用（online 真实运行必需；--dry-run 免确认）",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="只读取输入、校验并打印计划；不联网、不合成、不写任何文件",
    )
    return parser


def _fail(message: str) -> None:
    """按 argparse 的约定打印错误并以状态码 2 退出。"""
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def _require_voice(provider: str, voice_id: str) -> Voice:
    """按 provider 查音色；非法音色以状态码 2 退出（而不是运行期 ValueError）。"""
    try:
        return find_voice(provider, voice_id)
    except ValueError as exc:
        _fail(str(exc))


def validate_args(args: argparse.Namespace) -> None:
    """结构性校验后再检查输入文件，错误一律 `SystemExit`。

    顺序很重要：provider / 音色 / `--yes` / 倍率的检查先于 `--srt`
    是否存在，避免用户先被文件错误掩盖真正的参数问题。音色与模型在
    这里就完成查找与一致性校验，非法音色统一退出 2。
    """
    if args.provider not in ("local", "online"):
        _fail(f"unknown provider {args.provider!r}; expected local or online")
    if not math.isfinite(args.max_speed) or args.max_speed < 1.0:
        _fail(
            f"--max-speed must be a finite value >= 1.0 (got {args.max_speed}); "
            "video-tts never slows speech down"
        )
    if not math.isfinite(args.warn_speed) or not (1.0 <= args.warn_speed <= args.max_speed):
        _fail(
            f"--warn-speed must be in [1.0, --max-speed={args.max_speed}] "
            f"(got {args.warn_speed})"
        )
    if args.master_sample_rate not in ALLOWED_MASTER_RATES:
        _fail(
            f"--master-sample-rate must be one of "
            f"{list(ALLOWED_MASTER_RATES)} (got {args.master_sample_rate})"
        )
    if args.max_attempts < 1:
        _fail(f"--max-attempts must be >= 1 (got {args.max_attempts})")
    if args.safety_gap < 0:
        _fail(f"--safety-gap must be >= 0 (got {args.safety_gap})")
    if args.timing_mode == "strict_slot" and args.overflow_policy == "truncate":
        _fail(
            "--overflow-policy truncate is not combinable with strict_slot; "
            "strict mode exists to guarantee complete speech within the slot"
        )

    voice: Voice | None = None
    if args.provider == "local":
        if args.ref_audio and IS_WINDOWS:
            _fail("local provider requires Apple Silicon macOS; use --provider online")
        if bool(args.ref_audio) != bool(args.ref_text):
            _fail("--ref-audio and --ref-text must be provided together")
        if args.ref_audio:
            if args.voice or args.design:
                _fail("--ref-audio cannot be combined with --voice or --design")
            if args.instruct:
                _fail("--ref-audio cannot be combined with --instruct")
            if not Path(args.ref_audio).is_file():
                _fail(f"--ref-audio not found: {args.ref_audio}")
            if args.model and not is_base_model(args.model):
                _fail(
                    f"--ref-audio requires a Base model (got {args.model!r}); "
                    f"omit --model to use {LOCAL_BASE_MODEL}"
                )
        else:
            if bool(args.voice) == bool(args.design):
                _fail(
                    "local provider requires exactly one of --voice, --design, "
                    "or --ref-audio/--ref-text"
                )
            if args.design and args.instruct:
                _fail(
                    "--design cannot be combined with --instruct; "
                    "the design description already controls the voice"
                )
            if args.voice:
                voice = _require_voice("local", args.voice)
                if args.model and is_voice_design_model(args.model):
                    _fail(
                        f"--voice {args.voice!r} cannot be used with VoiceDesign "
                        f"model {args.model!r}; use --design or a CustomVoice model"
                    )
                if args.model and is_base_model(args.model):
                    _fail(
                        f"--voice {args.voice!r} cannot be used with Base model "
                        f"{args.model!r}; Base is only for --ref-audio clone"
                    )
            if args.design and args.model and not is_voice_design_model(args.model):
                _fail(
                    f"--design requires a VoiceDesign model (got {args.model!r}); "
                    f"omit --model to use {LOCAL_DESIGN_MODEL}"
                )
    else:
        if args.design:
            _fail("--design is only supported by the local provider")
        if args.ref_audio or args.ref_text:
            _fail("--ref-audio/--ref-text are only supported by the local provider")
        if not args.voice:
            _fail("online provider requires --voice")
        voice = _require_voice("online", args.voice)
        if args.model and args.model != voice.model:
            _fail(
                f"--model {args.model!r} does not match voice {args.voice!r} "
                f"(which uses {voice.model!r}); online --model can only "
                "restate the model of the selected voice group"
            )

    online_only = (args.rate, args.pitch, args.volume)
    if args.provider == "local" and any(value is not None for value in online_only):
        _fail("--rate/--pitch/--volume are only supported by the online provider")
    sampling = (args.temperature, args.top_p, args.top_k)
    if args.provider == "online" and any(value is not None for value in sampling):
        _fail("--temperature/--top-p/--top-k are only supported by the local provider")
    if args.provider == "local" and args.enable_ssml:
        _fail("--enable-ssml is only supported by the online provider")
    if args.rate is not None and not (0.5 <= args.rate <= 2.0):
        _fail(f"--rate must be in [0.5, 2.0] (got {args.rate})")
    if args.pitch is not None and not (0.5 <= args.pitch <= 2.0):
        _fail(f"--pitch must be in [0.5, 2.0] (got {args.pitch})")
    if args.volume is not None and not (0 <= args.volume <= 100):
        _fail(f"--volume must be in [0, 100] (got {args.volume})")
    if args.seed is not None and not (0 <= args.seed <= 65535):
        _fail(f"--seed must be in [0, 65535] (got {args.seed})")
    if args.temperature is not None and not (0.0 <= args.temperature <= 2.0):
        _fail(f"--temperature must be in [0, 2] (got {args.temperature})")
    if args.top_p is not None and not (0.0 < args.top_p <= 1.0):
        _fail(f"--top-p must be in (0, 1] (got {args.top_p})")
    if args.top_k is not None and args.top_k < 1:
        _fail(f"--top-k must be >= 1 (got {args.top_k})")
    if (
        args.enable_ssml
        and args.provider == "online"
        and voice is not None
        and voice.model != FLAGSHIP_MODEL
    ):
        _fail(
            "--enable-ssml is only supported by qwen-audio-3.1-tts-plus "
            "flagship voices"
        )

    args.hotfix = None
    if args.hotfix_file:
        if args.provider != "online":
            _fail("--hotfix-file is only supported by the online provider")
        if voice is None or voice.model != FLAGSHIP_MODEL:
            _fail("--hotfix-file requires a 3.1 Plus flagship voice")
        if not args.dry_run:
            if not os.environ.get("DASHSCOPE_API_KEY"):
                _fail("--hotfix-file requires DASHSCOPE_API_KEY (HTTP fallback)")
            if not args.tts_endpoint:
                _fail("--hotfix-file requires --tts-endpoint (HTTP fallback)")
        hotfix_path = Path(args.hotfix_file)
        if not hotfix_path.is_file():
            _fail(f"--hotfix-file not found: {args.hotfix_file}")
        try:
            hotfix = json.loads(hotfix_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            _fail(f"--hotfix-file is not valid JSON: {exc}")
        if not isinstance(hotfix, dict) or not (
            isinstance(hotfix.get("pronunciation", []), list)
            and isinstance(hotfix.get("replace", []), list)
        ):
            _fail(
                "--hotfix-file must be a JSON object with optional "
                "'pronunciation' and 'replace' arrays"
            )
        args.hotfix = hotfix

    if args.provider == "online" and not args.yes and not args.dry_run:
        _fail(
            "online synthesis is billed; re-run with --yes after confirming cost"
        )

    if args.audio and args.video:
        _fail("--audio and --video are mutually exclusive")
    if not Path(args.srt).is_file():
        _fail(f"SRT not found: {args.srt}")
    if args.merge_plan and not Path(args.merge_plan).is_file():
        _fail(f"merge plan not found: {args.merge_plan}")
    if args.resume and not Path(args.resume).is_file():
        _fail(f"--resume manifest not found: {args.resume}")

    if args.video and args.out and not args.track_only:
        video = Path(args.video)
        output = _video_output_from_out(Path(args.out))
        if _same_path(output, video):
            _fail(
                f"--out would overwrite the input video in place ({video}); "
                "ffmpeg cannot rewrite a file in place, choose a different output"
            )


def _require_binary(name: str) -> None:
    """预检外部工具；缺失时按平台给出可执行的安装提示。"""
    if shutil.which(name) is None:
        hint = (
            "winget install ffmpeg" if IS_WINDOWS else "brew install ffmpeg"
        )
        raise RuntimeError(
            f"{name} not found on PATH; install it with: {hint}"
        )


def _format_time(seconds: float) -> str:
    """把秒数格式化成 `HH:MM:SS.mmm`（与报告列宽一致）。"""
    millis = int(round(max(0.0, seconds) * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}.{millis:03d}"


def _with_suffix(path: Path, suffix: str) -> Path:
    """返回 `path` 名字后接 `suffix` 的同目录路径（保留原后缀）。"""
    return path.with_name(path.name + suffix)


def _video_output_from_out(raw: Path) -> Path:
    """把 `--out` 解析成最终的成品 mp4 路径。

    只有 `.mp4` 后缀被当作显式成品路径；其它后缀（`.mkv`、`.mov` 等）
    按输出前缀处理，避免把非 mp4 名字直接当成容器格式。
    """
    if raw.suffix.lower() == ".mp4":
        return raw
    return _with_suffix(raw, ".dub.mp4")


def _same_path(left: Path, right: Path) -> bool:
    """比较两个路径是否指向同一文件（尽量解开符号链接 / `..`）。"""
    try:
        return left.resolve() == right.resolve()
    except OSError:  # pragma: no cover - resolve 失败时退回字符串比较
        return os.path.abspath(str(left)) == os.path.abspath(str(right))


def _resolve_outputs(
    args: argparse.Namespace,
    video: Path | None,
    srt: Path,
) -> tuple[Path, Path | None]:
    """返回 `(out_prefix, video_out)`。

    `--out` 可以是前缀（`foo` → `foo.dub.wav` / `foo.dub.mp4`），也可以是
    成品 mp4 路径（`foo.mp4` → `foo.dub.wav` / `foo.mp4`）。非 `.mp4`
    后缀一律按前缀处理。未提供时用视频 stem（无视频则 SRT stem）。
    """
    if args.out:
        raw = Path(args.out)
        if raw.suffix.lower() == ".mp4":
            return raw.with_suffix(""), raw
        return raw, _video_output_from_out(raw)
    base = (video if video is not None else srt).with_suffix("")
    return base, _with_suffix(base, ".dub.mp4")


def _check_overwrite(
    paths: list[Path], args: argparse.Namespace
) -> None:
    """默认拒绝覆盖已有成品；`--overwrite` 显式放行（resume 同任务亦放行）。"""
    if args.overwrite or args.resume:
        return
    existing = [str(p) for p in paths if p.exists()]
    if existing:
        _fail(
            "output already exists (refusing to overwrite): "
            + "; ".join(existing)
            + "; pass --overwrite to replace it, or choose another --out"
        )


def _print_plan(
    args: argparse.Namespace,
    srt: Path,
    video: Path | None,
    total_duration: float,
    cues: list[Cue],
    voice: Voice | None,
) -> None:
    """打印 `--dry-run` 的计划摘要（前 10 组），不触碰 provider、不写文件。"""
    print("video-tts 预演（--dry-run：仅解析，不合成、不写文件）")
    print(f"SRT: {srt}")
    if video is not None:
        print(f"视频: {video}")
    print(f"条目: {len(cues)} 组")
    print(f"总字数: {sum(len(cue.text) for cue in cues)} 字")
    print(f"总时长: {total_duration:.3f}s")
    print(
        f"时间模式: {args.timing_mode}  溢出策略: {args.overflow_policy}  "
        f"制作采样率: {args.master_sample_rate}Hz"
    )
    if voice is not None:
        print(f"音色: {voice.name} ({voice.voice_id}, {voice.model})")
    elif args.design:
        print(f"VoiceDesign: {args.design}")
    elif args.ref_audio:
        print(f"克隆参考: {args.ref_audio}")
    print(f"计划（前 {min(PLAN_PREVIEW, len(cues))} 组）:")
    print("序号  开始          窗口    文本")
    for cue in cues[:PLAN_PREVIEW]:
        window = cue.end - cue.start
        print(f"{cue.index:<4}  {_format_time(cue.effective_start)}  "
              f"{window:5.2f}s  {cue.text}")
    if len(cues) > PLAN_PREVIEW:
        print(f"... 其余 {len(cues) - PLAN_PREVIEW} 组从略")


def _write_plan_files(out_prefix: Path, cues: list[Cue], srt: Path) -> None:
    """写 `<out>.plan.json`（结构化计划）与 `<out>.plan.srt`（预览字幕）。"""
    payload = plan_payload(cues, srt)
    write_json(_with_suffix(out_prefix, ".plan.json"), payload)
    write_srt(cues, _with_suffix(out_prefix, ".plan.srt"))
    print(f"计划: {_with_suffix(out_prefix, '.plan.json')}")
    print(f"计划字幕: {_with_suffix(out_prefix, '.plan.srt')}")


def _write_dub_srt(
    out_prefix: Path, results: list[SegmentResult]
) -> Path | None:
    """按实际配音起止写块级字幕 `<out>.dub.srt`。

    时间是实际放置结果（natural 延长 / 变速后的真实结束时间），不是计划
    窗口的复制；组级字幕，不代表字级强制对齐。失败组不写条目。
    """
    entries: list[Subtitle] = []
    for result in results:
        if result.failed or result.actual_start is None:
            continue
        entries.append(
            Subtitle(
                index=len(entries) + 1,
                start=max(0.0, result.actual_start),
                end=result.actual_start + result.final_duration,
                text=result.cue.text,
            )
        )
    if not entries:
        return None
    path = _with_suffix(out_prefix, ".dub.srt")
    write_srt(entries, path)
    return path


def _voice_payload(voice: Voice | None) -> dict | None:
    """把 `Voice` 转成 JSON 报告里的字典。"""
    if voice is None:
        return None
    return {
        "name": voice.name,
        "voice_id": voice.voice_id,
        "gender": voice.gender,
        "description": voice.description,
        "model": voice.model,
        "provider": voice.provider,
    }


def _result_payload(result: SegmentResult) -> dict:
    """把单组合成结果转成 JSON 报告里的字典（spec §14 每组字段）。"""
    cue = result.cue
    return {
        "index": cue.index,
        "source_indices": list(cue.source_indices or (cue.index,)),
        "start": cue.start,
        "end": cue.end,
        "effective_start": cue.effective_start,
        "next_start": cue.next_start,
        "planned_start": cue.effective_start,
        "planned_end": cue.end,
        "actual_start": result.actual_start,
        "actual_end": result.actual_end,
        "text": cue.text,
        "synth_duration": result.synth_duration,
        "trimmed_seconds": result.trimmed_seconds,
        "final_duration": result.final_duration,
        "speed": result.speed,
        "action": result.action.value,
        "failed": result.failed,
        "status": result.status,
        "warning": result.warning,
        "truncated_seconds": result.truncated_seconds,
        "overflow_gap": result.overflow_gap,
        "attempts": result.attempts,
        "cache_hits": result.cache_hits,
        "chunks": result.chunks,
        "native_sample_rate": result.native_sample_rate,
        "synth_seconds": round(result.synth_seconds, 3),
        "error_kind": result.error_kind,
    }


def _print_report(
    results: list[SegmentResult],
    srt_warning_count: int,
) -> tuple[int, int]:
    """打印逐组报告与汇总，返回 `(警告数, 失败数)`。"""
    print()
    print("序号  开始          窗口    合成    最终    倍率  状态         说明")
    for result in results:
        cue = result.cue
        window = cue.end - cue.start
        status = result.status if result.failed else result.action.value
        line = (
            f"{cue.index:<4}  {_format_time(cue.effective_start)}  "
            f"{window:5.2f}s  {result.synth_duration:5.2f}s  "
            f"{result.final_duration:5.2f}s  {result.speed:4.2f}x  "
            f"{status:<12}"
        )
        if result.warning:
            line += f"  {result.warning}"
        print(line)

    cue_warnings = sum(1 for result in results if result.warning)
    failures = sum(1 for result in results if result.failed)
    total_chars = sum(len(result.cue.text) for result in results)
    print()
    print(
        f"汇总：{len(results)} 组；{total_chars} 字；"
        f"警告 {srt_warning_count + cue_warnings} 条；失败 {failures} 条"
    )
    return srt_warning_count + cue_warnings, failures


def _env_payload() -> dict:
    """环境信息（报告用）；ffmpeg 版本尽力获取，失败不阻塞。"""
    ffmpeg_version = None
    try:
        probe = subprocess.run(
            ["ffmpeg", "-version"], capture_output=True, text=True, timeout=10
        )
        ffmpeg_version = (probe.stdout or "").splitlines()[0] if probe.stdout else None
    except Exception:
        pass
    return {
        "system": platform.system(),
        "machine": platform.machine(),
        "python": sys.version.split()[0],
        "ffmpeg": ffmpeg_version,
    }


def _job_status(
    results: list[SegmentResult],
    *,
    truncated: bool,
    failures: int,
    mux_failed: bool,
) -> str:
    """由逐组结果推导任务终态（spec §14 状态枚举）。"""
    if any(r.status == "submission_unknown" for r in results):
        return "submission_unknown"
    if any(r.status == "needs_attention" for r in results):
        return "needs_attention"
    if mux_failed:
        return "failed"
    if failures:
        return "partial"
    if truncated:
        return "completed_with_warnings"
    return "complete"


def _exit_code(status: str, args: argparse.Namespace) -> int:
    """状态 → 退出码（0 成功 / 1 异常态 / 2 参数 / 3 显式裁剪）。"""
    if status == "complete":
        return 0
    if (
        status == "completed_with_warnings"
        and args.overflow_policy == "truncate"
    ):
        return 3
    return 1


def _build_provider(args: argparse.Namespace, design: str | None):
    """按 provider 组装 kwargs 并实例化（实现模块懒导入）。"""
    kwargs: dict = {}
    if args.provider == "local":
        if args.ref_audio:
            kwargs["model_id"] = args.model or LOCAL_BASE_MODEL
        elif design:
            kwargs["design"] = design
            # VoiceDesign 模式必须加载 VoiceDesign 模型；未显式覆盖时用默认。
            kwargs["model_id"] = args.model or LOCAL_DESIGN_MODEL
        elif args.model:
            kwargs["model_id"] = args.model
    else:
        kwargs["bl_bin"] = args.bl_bin
        if args.tts_endpoint:
            kwargs["endpoint"] = args.tts_endpoint
        # key 只用于 bl 不可用时的 HTTP 兜底；绝不打印。
        api_key = os.environ.get("DASHSCOPE_API_KEY")
        if api_key:
            kwargs["api_key"] = api_key
        if getattr(args, "hotfix", None) is not None:
            kwargs["force_http"] = True
    return get_provider(args.provider, **kwargs)


def _report_payload(
    args: argparse.Namespace,
    *,
    job_id: str,
    status: str,
    srt: Path,
    video: Path | None,
    voice: Voice | None,
    design: str | None,
    total_duration: float,
    track_path: Path | None,
    final_path: Path | None,
    srt_warnings: list[str],
    results: list[SegmentResult],
    timings: dict,
    error: str | None,
) -> dict:
    """组装机器可读报告（spec §14）；产物只在真正写成功后才有值。"""
    truncated = any(r.truncated_seconds > 0 for r in results)
    return {
        "schema_version": REPORT_SCHEMA,
        "job_id": job_id,
        "status": status,
        "error": error,
        "inputs": {
            "srt": str(srt),
            "video": str(video) if video is not None else None,
            "srt_warnings": srt_warnings,
        },
        "env": _env_payload(),
        "provider": args.provider,
        "voice": _voice_payload(voice),
        "design": design,
        "instruct": args.instruct,
        "lang": args.lang,
        "timing": {
            "timing_mode": args.timing_mode,
            "overflow_policy": args.overflow_policy,
            "warn_speed": args.warn_speed,
            "max_speed": args.max_speed,
            "safety_gap": args.safety_gap,
        },
        "audio": {
            "source_sample_rate": sorted(
                {r.native_sample_rate for r in results if r.native_sample_rate}
            ),
            "master_sample_rate": args.master_sample_rate,
            "export_sample_rate": args.master_sample_rate,
            "channels": 1,
        },
        "retry": {
            "max_attempts": args.max_attempts,
            "total_attempts": sum(r.attempts for r in results),
            "cache_hits": sum(r.cache_hits for r in results),
        },
        "content_truncated": truncated,
        "total_duration": total_duration,
        "track": str(track_path) if track_path is not None else None,
        "output": str(final_path) if final_path is not None else None,
        "timings": timings,
        "cues": [_result_payload(result) for result in results],
    }


def _run(args: argparse.Namespace) -> int:
    """执行一次完整流程，返回退出码。"""
    started = time.monotonic()
    srt = Path(args.srt)
    video = Path(args.video) if args.video else None
    audio = Path(args.audio) if args.audio else None

    video_duration: float | None = None
    audio_duration: float | None = None
    codec_name = ""
    if video is not None:
        _require_binary("ffprobe")
        info = probe_video(video)
        video_duration = info.duration
        codec_name = info.codec_name
    elif audio is not None:
        _require_binary("ffprobe")
        audio_duration = probe_audio_duration(audio)

    cues, srt_warnings = load_cues(
        srt,
        video_duration if video_duration is not None else audio_duration,
        skip_bracketed=args.skip_bracketed,
    )
    for warning in srt_warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if not cues:
        raise SRTError(f"{srt}: no cues found")

    srt_sha = file_sha256(srt)
    original_count = len(cues)
    if args.merge_plan:
        try:
            cues = load_merge_plan(Path(args.merge_plan), cues, srt_sha256=srt_sha)
        except ValueError as exc:
            _fail(str(exc))
        print(f"合并: {original_count} 条 → {len(cues)} 组")

    if video_duration is not None:
        total_duration = video_duration
    elif audio_duration is not None:
        total_duration = audio_duration
    else:
        # 无媒体：整轨到最后一组的允许结束时间（natural 窗口终点）。
        total_duration = max(cue.next_start for cue in cues)

    voice = find_voice(args.provider, args.voice) if args.voice else None
    if voice is not None and args.model:
        voice = replace(voice, model=args.model)
    if args.provider == "local" and args.ref_audio:
        # Base 克隆没有预设音色；伪 Voice 只用于报告（缓存身份走内容哈希）。
        voice = Voice(
            "Reference",
            "ref-clone",
            "",
            "",
            args.model or LOCAL_BASE_MODEL,
            "local",
        )
    design = args.design if args.provider == "local" else None

    out_prefix, video_out = _resolve_outputs(args, video, srt)
    track_path = _with_suffix(out_prefix, ".dub.wav")

    # --- dry-run：只读、校验、打印；不写任何文件 -----------------------
    if args.dry_run:
        _print_plan(args, srt, video, total_duration, cues, voice)
        return 0

    # --- write-plan：只写预览计划，不合成 -------------------------------
    if args.write_plan:
        _write_plan_files(out_prefix, cues, srt)
        return 0

    # --- 覆盖保护：成品默认拒绝覆盖（--overwrite / --resume 放行）-------
    _check_overwrite(
        [track_path] + ([video_out] if video_out is not None else []),
        args,
    )

    # --- job manifest：先建（或 resume），失败也有恢复依据 --------------
    plan_sha = file_sha256(Path(args.merge_plan)) if args.merge_plan else None
    ref_sha = file_sha256(Path(args.ref_audio)) if args.ref_audio else None
    if args.resume:
        try:
            manifest = JobManifest.load(Path(args.resume))
        except ValueError as exc:
            _fail(str(exc))
        mismatches = manifest.check_resume_inputs(srt_sha, plan_sha, ref_sha)
        if mismatches:
            _fail("cannot resume: " + "; ".join(mismatches))
        print(f"恢复任务: {manifest.job_id}（原状态 {manifest.status}）")
    else:
        manifest = JobManifest.create(
            _with_suffix(out_prefix, ".job.json"),
            inputs={
                "srt_sha256": srt_sha,
                "merge_plan_sha256": plan_sha,
                "ref_audio_sha256": ref_sha,
            },
            config={
                "provider": args.provider,
                "voice": voice.voice_id if voice else None,
                "design": design,
                "instruct": args.instruct,
                "lang": args.lang,
                "model": voice.model if voice else None,
                "timing_mode": args.timing_mode,
                "overflow_policy": args.overflow_policy,
                "master_sample_rate": args.master_sample_rate,
                "max_speed": args.max_speed,
                "style": {
                    key: value for key, value in (
                        ("rate", args.rate), ("pitch", args.pitch),
                        ("volume", args.volume), ("seed", args.seed),
                        ("temperature", args.temperature),
                        ("top_p", args.top_p), ("top_k", args.top_k),
                        ("enable_ssml", args.enable_ssml or None),
                    ) if value is not None
                },
            },
            groups=[
                {
                    "source_indices": list(cue.source_indices or (cue.index,)),
                    "text": cue.text,
                    "start": cue.start,
                    "end": cue.end,
                    "status": "pending",
                }
                for cue in cues
            ],
        )
    manifest.save("preparing")

    # 真正的合成流程才需要 ffmpeg（重采样 / 变速 / 混流）。
    _require_binary("ffmpeg")

    provider = _build_provider(args, design)
    prepare_started = time.monotonic()
    provider.prepare()
    prepare_seconds = time.monotonic() - prepare_started

    if voice is not None:
        print(
            f"video-tts: provider={args.provider} voice={voice.voice_id} "
            f"model={voice.model}"
        )
    else:
        print(f"video-tts: provider={args.provider} design={design}")
    if (
        args.provider == "online"
        and args.instruct
        and voice is not None
        and voice.model != FLAGSHIP_MODEL
    ):
        print(
            f"warning: {voice.model} 不支持 --instruct，已忽略该指令",
            file=sys.stderr,
        )

    options = EngineOptions(
        master_sample_rate=args.master_sample_rate,
        timing_mode=args.timing_mode,
        overflow_policy=args.overflow_policy,
        safety_gap=args.safety_gap,
        warn_speed=args.warn_speed,
        max_speed=args.max_speed,
        max_attempts=args.max_attempts,
        keep_segments=args.keep_segments,
        segments_dir=out_prefix.parent / "segments" if args.keep_segments else None,
        no_cache=args.no_cache,
        continue_on_error=args.continue_on_error,
        design=design,
        rate=args.rate,
        pitch=args.pitch,
        volume=args.volume,
        seed=args.seed,
        enable_ssml=args.enable_ssml,
        hot_fix=args.hotfix,
        temperature=args.temperature,
        top_p=args.top_p,
        top_k=args.top_k,
        ref_audio=args.ref_audio,
        ref_text=args.ref_text,
        ref_audio_sha256=ref_sha,
    )
    cache = SegmentCache(enabled=not args.no_cache)

    manifest.save("synthesizing")

    # VoiceDesign 模式下 provider 用 design 作为 prompt；引擎经 options.design
    # 把完整描述纳入缓存键，避免不同设计串音。
    engine_instruct = args.instruct  # design 不再冒充 instruct 进键
    engine_voice = voice

    results: list[SegmentResult] = []
    aborted: BaseException | None = None
    synth_started = time.monotonic()
    try:
        results = run_engine(
            cues,
            provider,
            engine_voice,
            engine_instruct,
            args.lang,
            total_duration,
            options,
            cache,
            track_path,
            progress=lambda line: print(line, flush=True),
        )
    except EngineAbort as abort:
        results = abort.results
        aborted = abort.error if abort.error is not None else RuntimeError(str(abort))
    synth_seconds = time.monotonic() - synth_started

    for position, result in enumerate(results):
        manifest.update_group(
            position,
            status=result.status,
            cache_key=result.cache_key,
            attempts=result.attempts,
            error_kind=result.error_kind,
            actual_start=result.actual_start,
            actual_end=result.actual_end,
            final_duration=result.final_duration,
            truncated_seconds=result.truncated_seconds,
            overflow_gap=result.overflow_gap,
        )

    failures = sum(1 for result in results if result.failed)
    truncated_any = any(result.truncated_seconds > 0 for result in results)

    warning_count = 0
    if results:
        warning_count, failures = _print_report(results, len(srt_warnings))
        if aborted is None:
            # 正常完成（含 partial）才写块级字幕；中止路径靠 manifest 与
            # 缓存恢复，不产出看起来完整的字幕成品。
            print(f"配音轨: {track_path}")
            dub_srt = _write_dub_srt(out_prefix, results)
            if dub_srt is not None:
                print(f"块级字幕: {dub_srt}")
    else:
        failures = len(cues)

    # 混流只在全部组完成（允许无裁剪警告）时进行；partial /
    # needs_attention 不产出看似成功的成片。
    final_path: Path | None = None
    mux_failed = False
    if (
        aborted is None
        and video is not None
        and not args.track_only
        and failures == 0
    ):
        manifest.save("exporting")
        mux_started = time.monotonic()
        try:
            mux_video(
                video, track_path, video_out, codec_name,
                sample_rate=args.master_sample_rate,
            )
            verify_output(video_out, video_duration)
            final_path = video_out
            print(f"成片: {final_path}")
        except Exception as exc:  # noqa: BLE001 - 混流失败保留音轨与报告
            mux_failed = True
            print(f"video-tts: mux failed: {exc}", file=sys.stderr)
        timings_mux = time.monotonic() - mux_started
    else:
        timings_mux = 0.0

    if isinstance(aborted, KeyboardInterrupt):
        status = "cancelled"
    elif aborted is not None:
        unknown = any(r.status == "submission_unknown" for r in results)
        attention = any(r.status == "needs_attention" for r in results)
        status = (
            "submission_unknown" if unknown
            else "needs_attention" if attention
            else "failed"
        )
    else:
        status = _job_status(
            results, truncated=truncated_any, failures=failures,
            mux_failed=mux_failed,
        )

    timings = {
        "prepare_seconds": round(prepare_seconds, 3),
        "synthesizing_seconds": round(synth_seconds, 3),
        "mux_seconds": round(timings_mux, 3),
        "total_seconds": round(time.monotonic() - started, 3),
    }
    error_text = f"{type(aborted).__name__}: {aborted}" if aborted else (
        "mux failed" if mux_failed else None
    )

    manifest.save(status, note=error_text)
    report_path = Path(args.json_report) if args.json_report else _with_suffix(
        out_prefix, ".report.json"
    )
    write_json(
        report_path,
        _report_payload(
            args,
            job_id=manifest.job_id,
            status=status,
            srt=srt,
            video=video,
            voice=voice,
            design=design,
            total_duration=total_duration,
            track_path=track_path if (results and not aborted) else None,
            final_path=final_path,
            srt_warnings=srt_warnings,
            results=results,
            timings=timings,
            error=error_text,
        ),
    )
    print(f"报告: {report_path}")
    print(f"任务清单: {manifest.path}")
    if status != "complete":
        print(f"状态: {status}", file=sys.stderr)
        print(
            "恢复：修正输入后用 --resume " f"{manifest.path} 重跑；"
            "已完成组会从原生缓存复用。",
            file=sys.stderr,
        )

    return _exit_code(status, args)


def main(argv: list[str] | None = None) -> int:
    """CLI 入口：参数错误以 `SystemExit` 退出，运行错误返回 1。"""
    args = build_parser().parse_args(argv)
    validate_args(args)
    try:
        return _run(args)
    except SynthesisError as exc:
        if exc.kind == SUBMISSION_UNKNOWN:
            print(
                f"video-tts: submission state unknown: {exc}\n"
                "已提交的在线任务不自动重试；请到控制台核对后决定是否重跑。",
                file=sys.stderr,
            )
        else:
            print(f"video-tts: error: {exc}", file=sys.stderr)
        return 1
    except SRTError as exc:
        # 输入内容错误（空 SRT / 非法时间轴）按退出码 2。
        print(f"video-tts: error: {exc}", file=sys.stderr)
        return 2
    except SystemExit as exc:  # _fail / argparse 的参数错误统一成退出码 2
        return int(exc.code if isinstance(exc.code, int) else 2)
    except Exception as exc:  # noqa: BLE001 - CLI 边界统一转成退出码
        print(f"video-tts: error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
