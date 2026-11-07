#!/usr/bin/env python3
"""
video-tts — 非交互 CLI：预检、流程编排、进度与报告。

所有交互选择（provider / 音色 / 语气 / 是否开跑 / 在线费用确认）都由
`SKILL.md` 在调用本脚本前用 `AskUserQuestion` 收集，本脚本只接受参数：

1. 有 `--video` 时先 `probe_video()` 取时长，否则总时长取最后一条字幕结束。
2. `load_cues()` 解析 SRT，打印越界 / 重叠 warning。
3. 解析音色（`find_voice`）或本地 VoiceDesign 描述，实例化 provider 并
   `prepare()`（加载模型 / 校验在线登录态）。
4. `run_engine()` 逐条合成、适配、拼轨，写 `<out>.dub.wav`。
5. 有视频且未 `--track-only` 时 `mux_video()` 混流并 `verify_output()` 校验。
6. 打印逐条报告与汇总；`--json-report` 另写机器可读 JSON。

`--dry-run` 只解析 SRT 并打印前 10 条计划，不创建 provider、不加载模型、
不合成。退出码：全部成功 0；截断 / 超速 warning 仍为 0；合成失败或混流
失败为 1。

在线合成只从环境变量 `DASHSCOPE_API_KEY` 读取 HTTP 兜底所需的 key，且从不
打印它。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
from dataclasses import replace
from pathlib import Path

from cache import SegmentCache
from engine import EngineOptions, SegmentResult, run_engine
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
from merge_plan import load_merge_plan
from srt_parse import Cue, SRTError, load_cues
from track_build import write_wav

PLAN_PREVIEW = 10


def build_parser() -> argparse.ArgumentParser:
    """构造 `video-tts` 的 argparse 解析器（spec §10 的参数表）。"""
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
    parser.add_argument("--json-report", help="写机器可读 JSON 报告到该路径")
    parser.add_argument(
        "--continue-on-error", action="store_true", help="单条失败继续（会缺句）"
    )
    parser.add_argument(
        "--skip-bracketed", action="store_true", help="跳过纯音效标记条目"
    )
    parser.add_argument(
        "--merge-plan",
        help="语义合并计划 JSON（groups 数组；由 Claude 读 SRT 后生成）",
    )
    parser.add_argument(
        "--max-speed", type=float, default=1.30, help="最大 atempo 倍率（默认 1.30）"
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="确认在线合成费用（online 真实运行必需；--dry-run 免确认）",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="只解析并打印计划，不合成"
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

    voice: Voice | None = None
    if args.provider == "local":
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

    if args.video and args.out and not args.track_only:
        video = Path(args.video)
        output = _video_output_from_out(Path(args.out))
        if _same_path(output, video):
            _fail(
                f"--out would overwrite the input video in place ({video}); "
                "ffmpeg cannot rewrite a file in place, choose a different output"
            )


def _require_binary(name: str) -> None:
    """预检外部工具；缺失时给出可执行的安装提示。"""
    if shutil.which(name) is None:
        raise RuntimeError(
            f"{name} not found on PATH; install it with: brew install ffmpeg"
        )


def _format_time(seconds: float) -> str:
    """把秒数格式化成 `HH:MM:SS.mmm`（与报告列宽一致）。"""
    millis = int(round(max(0.0, seconds) * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


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


def _print_plan(
    args: argparse.Namespace,
    srt: Path,
    video: Path | None,
    total_duration: float,
    cues: list[Cue],
    voice: Voice | None,
) -> None:
    """打印 `--dry-run` 的计划摘要（前 10 条），不触碰 provider。"""
    print("video-tts 预演（--dry-run：仅解析，不合成）")
    print(f"SRT: {srt}")
    if video is not None:
        print(f"视频: {video}")
    print(f"条目: {len(cues)} 条")
    print(f"总字数: {sum(len(cue.text) for cue in cues)} 字")
    print(f"总时长: {total_duration:.3f}s")
    if voice is not None:
        print(f"音色: {voice.name} ({voice.voice_id}, {voice.model})")
    elif args.design:
        print(f"VoiceDesign: {args.design}")
    print(f"计划（前 {min(PLAN_PREVIEW, len(cues))} 条）:")
    print("序号  开始          窗口    文本")
    for cue in cues[:PLAN_PREVIEW]:
        window = cue.end - cue.start
        print(f"{cue.index:<4}  {_format_time(cue.effective_start)}  "
              f"{window:5.2f}s  {cue.text}")
    if len(cues) > PLAN_PREVIEW:
        print(f"... 其余 {len(cues) - PLAN_PREVIEW} 条从略")


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
    """把单条合成结果转成 JSON 报告里的字典。"""
    cue = result.cue
    return {
        "index": cue.index,
        "start": cue.start,
        "end": cue.end,
        "effective_start": cue.effective_start,
        "next_start": cue.next_start,
        "text": cue.text,
        "synth_duration": result.synth_duration,
        "final_duration": result.final_duration,
        "speed": result.speed,
        "action": result.action.value,
        "failed": result.failed,
        "warning": result.warning,
    }


def _print_report(
    results: list[SegmentResult],
    srt_warning_count: int,
) -> tuple[int, int]:
    """打印逐条报告与汇总，返回 `(警告数, 失败数)`。"""
    print()
    print("序号  开始          窗口    合成    最终    倍率  状态         说明")
    for result in results:
        cue = result.cue
        window = cue.end - cue.start
        status = "failed" if result.failed else result.action.value
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
        f"汇总：{len(results)} 条；{total_chars} 字；"
        f"警告 {srt_warning_count + cue_warnings} 条；失败 {failures} 条"
    )
    return srt_warning_count + cue_warnings, failures


def _write_json_report(path: Path, payload: dict) -> None:
    """把报告写成 UTF-8 JSON（保留中文）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


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
    srt: Path,
    video: Path | None,
    voice: Voice | None,
    design: str | None,
    total_duration: float,
    track_path: Path,
    final_path: Path | None,
    srt_warnings: list[str],
    warning_count: int,
    failures: int,
    results: list[SegmentResult],
) -> dict:
    """组装 JSON 报告；`output` 只在成片真正写成功后才有值。"""
    return {
        "srt": str(srt),
        "video": str(video) if video is not None else None,
        "provider": args.provider,
        "voice": _voice_payload(voice),
        "design": design,
        "instruct": args.instruct,
        "lang": args.lang,
        "max_speed": args.max_speed,
        "total_duration": total_duration,
        "track": str(track_path),
        "output": str(final_path) if final_path is not None else None,
        "srt_warnings": srt_warnings,
        "warning_count": warning_count,
        "failure_count": failures,
        "cues": [_result_payload(result) for result in results],
    }


def _run(args: argparse.Namespace) -> int:
    """执行一次完整流程，返回退出码。"""
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

    if args.merge_plan:
        original_count = len(cues)
        try:
            cues = load_merge_plan(Path(args.merge_plan), cues)
        except ValueError as exc:
            _fail(str(exc))
        print(f"合并: {original_count} 条 → {len(cues)} 组")

    if video_duration is not None:
        total_duration = video_duration
    elif audio_duration is not None:
        total_duration = audio_duration
    else:
        total_duration = cues[-1].end

    voice = find_voice(args.provider, args.voice) if args.voice else None
    if voice is not None and args.model:
        voice = replace(voice, model=args.model)
    if args.provider == "local" and args.ref_audio:
        # Base 克隆没有预设音色；伪 Voice 只用于缓存 key / 报告。
        voice = Voice(
            "Reference",
            f"ref:{Path(args.ref_audio).resolve()}",
            "",
            "",
            args.model or LOCAL_BASE_MODEL,
            "local",
        )
    design = args.design if args.provider == "local" else None

    if args.dry_run:
        _print_plan(args, srt, video, total_duration, cues, voice)
        return 0

    # 真正的合成流程才需要 ffmpeg（atempo / 混流）；dry-run 不检查。
    _require_binary("ffmpeg")

    provider = _build_provider(args, design)
    provider.prepare()

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

    out_prefix, video_out = _resolve_outputs(args, video, srt)
    track_path = _with_suffix(out_prefix, ".dub.wav")
    track_path.parent.mkdir(parents=True, exist_ok=True)

    options = EngineOptions(
        max_speed=args.max_speed,
        keep_segments=args.keep_segments,
        segments_dir=out_prefix.parent / "segments" if args.keep_segments else None,
        no_cache=args.no_cache,
        continue_on_error=args.continue_on_error,
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
    )
    cache = SegmentCache(enabled=not args.no_cache)

    # VoiceDesign 模式下 provider 用 design 作为 prompt、忽略 instruct；
    # 把 design 传进引擎可让它进入片段缓存 key，避免不同设计串音。伪 Voice
    # 只用于让缓存 key 带上实际模型 id（provider 在 design 模式会忽略它）。
    engine_instruct = design if design else args.instruct
    engine_voice = voice
    if design:
        engine_voice = Voice(
            name="VoiceDesign",
            voice_id="",
            gender="",
            description=design,
            model=getattr(provider, "model_id", "unknown"),
            provider=args.provider,
        )

    master, results = run_engine(
        cues,
        provider,
        engine_voice,
        engine_instruct,
        args.lang,
        total_duration,
        options,
        cache,
        progress=lambda line: print(line, flush=True),
    )
    write_wav(track_path, master)

    warning_count, failures = _print_report(results, len(srt_warnings))
    # 先报告音轨与逐条结果：即使随后混流失败，用户仍拿到完整可用的 wav。
    print(f"配音轨: {track_path}")

    report_path: Path | None = None
    if args.json_report:
        report_path = Path(args.json_report)
        _write_json_report(
            report_path,
            _report_payload(
                args, srt, video, voice, design, total_duration, track_path,
                None, srt_warnings, warning_count, failures, results,
            ),
        )
        print(f"报告: {report_path}")

    final_path: Path | None = None
    if video is not None and not args.track_only:
        video_out.parent.mkdir(parents=True, exist_ok=True)
        mux_video(video, track_path, video_out, codec_name)
        verify_output(video_out, video_duration)
        final_path = video_out
        print(f"成片: {final_path}")
        if report_path is not None:
            _write_json_report(
                report_path,
                _report_payload(
                    args, srt, video, voice, design, total_duration,
                    track_path, final_path, srt_warnings, warning_count,
                    failures, results,
                ),
            )

    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    """CLI 入口：参数错误以 `SystemExit` 退出，运行错误返回 1。"""
    args = build_parser().parse_args(argv)
    validate_args(args)
    try:
        return _run(args)
    except Exception as exc:  # noqa: BLE001 - CLI 边界统一转成退出码
        print(f"video-tts: error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
