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
needs_attention / submission_unknown / download_failed / cancelled；2 参数或
输入错误；3 用户显式允许裁剪且实际发生内容裁剪（有损成品，不能当普通成功）。

交付保护（spec §15.2）：同名成品默认**整组自动编号** `name_2`、`name_3`
（不覆盖、不为每件单独询问）；`--overwrite` 显式替换；输出永不覆盖输入
素材（SRT / 视频 / 音频 / 参考音频 / 计划）。

恢复（spec §13）：`--resume` 按输入指纹与配置快照对账——SRT 变化、克隆
身份变化（含移除参考参数）与合成身份配置变化阻断；计划修订与加工参数
修订允许并记录历史；上次 `download_failed` 的组凭收据只重新下载、不重新
提交合成。

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

from app_dirs import job_dir
from audio_pipeline import process_result
from track_build import write_wav
from cache import SegmentCache, file_sha256
from engine import (
    EngineAbort,
    EngineOptions,
    SegmentResult,
    run_engine,
)
from job import JobManifest, new_job_id, write_json
from merge_plan import load_merge_plan, plan_payload
from mux import mux_video, probe_audio_duration, probe_video, verify_output
from providers import (
    FLAGSHIP_MODEL,
    LOCAL_BASE_MODEL,
    LOCAL_DESIGN_MODEL,
    LOCAL_MODEL,
    TORCH_BASE_MODEL,
    TORCH_CUSTOM_MODEL,
    TORCH_DESIGN_MODEL,
    find_voice,
    get_provider,
    is_base_model,
    is_voice_design_model,
    local_backend,
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
        "--preview-text",
        help="设计后克隆第一步（spec §7.2）：用 --design 只合成这段试听"
             "文本并输出 <out>.preview.wav，不执行整片。用户选定后以"
             " --ref-audio <该文件> --ref-text <试听文本> 走 Base 克隆。",
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
        "--deliver",
        help="交付成品，逗号分隔：audio,video,subtitle,report（默认 "
             "audio,video,subtitle；report 只在明确选择时才进交付目录，"
             "内部完整报告始终保留在应用任务目录）。--track-only 等价于 "
             "--deliver audio",
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
        "--lenient-srt", action="store_true",
        help="跳过格式不完整的 SRT 块（默认严格解析：坏块报错阻塞，"
             "确认内容缺失后才用本开关）",
    )
    parser.add_argument(
        "--allow-text-edits", action="store_true",
        help="接受 merge plan 中已授权的正文改写（计划需带 "
             "text_edit_authorized: true；改写逐组记录）",
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
        help="显式覆盖已存在的成品（默认同名整组自动编号 name_2，不覆盖）",
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


DELIVER_CHOICES = ("audio", "video", "subtitle", "report")


def _parse_deliver(raw: str | None, *, track_only: bool) -> frozenset[str]:
    """解析 `--deliver`（F12，spec §15.1）。

    - `--track-only` 等价于 `--deliver audio`，与其它 deliver 组合冲突；
    - 未指定时默认 `audio,video,subtitle`（video 无视频输入时自动省略，
      与旧行为一致）；report 只在显式选择时才复制进交付目录。
    """
    if track_only and raw:
        _fail("--track-only cannot be combined with --deliver; "
              "--track-only means --deliver audio")
    if track_only:
        return frozenset({"audio"})
    if not raw:
        return frozenset({"audio", "video", "subtitle"})
    items = [item.strip().lower() for item in raw.split(",") if item.strip()]
    if not items:
        _fail("--deliver is empty; expected a comma list of "
              + "/".join(DELIVER_CHOICES))
    unknown = [item for item in items if item not in DELIVER_CHOICES]
    if unknown:
        _fail(f"--deliver has unknown items {unknown}; expected "
              + "/".join(DELIVER_CHOICES))
    return frozenset(items)


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
    args.deliver_set = _parse_deliver(args.deliver, track_only=args.track_only)

    voice: Voice | None = None
    if args.provider == "local":
        # 本地路线按平台解析后端（Apple Silicon→mlx / Windows x64→torch，
        # spec §4.1）；平台能力检测由 launcher（run.py）完成并给出修复步骤。
        if args.preview_text and not args.design:
            _fail("--preview-text requires --design (设计后克隆的第一步)")
        if args.preview_text and (args.voice or args.ref_audio):
            _fail("--preview-text cannot be combined with --voice/--ref-audio")
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

    if (
        args.provider == "online"
        and not args.yes
        and not args.dry_run
        and not args.write_plan
    ):
        # --write-plan 只写计划、不合成、不联网（F14）：不触发费用确认。
        _fail(
            "online synthesis is billed; re-run with --yes after confirming cost"
        )

    if args.audio and args.video:
        _fail("--audio and --video are mutually exclusive")
    if not Path(args.srt).is_file():
        _fail(f"SRT not found: {args.srt}")
    if args.merge_plan and not Path(args.merge_plan).is_file():
        _fail(f"merge plan not found: {args.merge_plan}")
    if args.resume:
        # 接受 job.json 路径 / 任务目录 / job ID（F12 内部目录布局）。
        _resolve_manifest_path(args.resume)

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


def _resolve_manifest_path(value: str) -> Path:
    """把 `--resume` 的值解析成 job.json：文件 / 任务目录 / job ID 皆可。"""
    candidate = Path(value)
    if candidate.is_file():
        return candidate
    if (candidate / "job.json").is_file():
        return candidate / "job.json"
    by_id = job_dir(value) / "job.json"
    if by_id.is_file():
        return by_id
    _fail(
        f"--resume 目标不存在：{value}（期望 job.json 路径、任务目录"
        "或 job ID）"
    )


def _input_paths(
    srt: Path, video: Path | None, audio: Path | None, args: argparse.Namespace
) -> list[Path]:
    """所有输入素材路径（输出绝不允许覆盖它们）。"""
    inputs = [srt]
    inputs.extend(p for p in (video, audio) if p is not None)
    if args.ref_audio:
        inputs.append(Path(args.ref_audio))
    if args.merge_plan:
        inputs.append(Path(args.merge_plan))
    return inputs


def _protect_inputs(paths: list[Path], inputs: list[Path]) -> None:
    """输出路径与任何输入撞车（resolve 后同文件）一律拒绝，`--overwrite`
    也不放行——覆盖输入素材永远需要先换 `--out`。"""
    for path in paths:
        for source in inputs:
            if _same_path(path, source):
                _fail(
                    f"输出路径会覆盖输入文件：{path} == {source}；"
                    "请换一个 --out 前缀"
                )


def _renumber_prefix(
    out_prefix: Path,
    build_paths,
    inputs: list[Path],
    limit: int = 999,
) -> tuple[Path, list[Path]]:
    """同名成品已存在时整组自动编号（`name_2`、`name_3`…），不覆盖（F09）。

    所有交付共用同一编号；编号组内任何一件已存在、或与输入撞车都跳过
    该编号。`--overwrite` 由调用方先行放行，不走本函数。
    """
    for number in range(2, limit + 1):
        candidate = out_prefix.with_name(f"{out_prefix.name}_{number}")
        paths = build_paths(candidate)
        if any(path.exists() for path in paths):
            continue
        if any(
            _same_path(path, source) for path in paths for source in inputs
        ):
            continue
        return candidate, paths
    _fail(
        f"could not find a free output number for {out_prefix} "
        f"(tried _2.._{limit}); choose another --out"
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
        "text_edited": cue.text_edited,
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
        "audio_url": result.audio_url,
        "request_id": result.request_id,
        "downloaded": result.downloaded,
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
    if any(r.status == "download_failed" for r in results):
        return "download_failed"
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
    """按 provider 组装 kwargs 并实例化（实现模块懒导入）。

    本地路线先解析后端（Apple Silicon→mlx / Windows x64→torch），
    默认模型 ID 随后端（spec §4.2）——用户不需要理解两套模型 ID。
    """
    kwargs: dict = {}
    if args.provider == "local":
        backend = local_backend()
        defaults = {
            "mlx": {
                "preset": LOCAL_MODEL,
                "design": LOCAL_DESIGN_MODEL,
                "base": LOCAL_BASE_MODEL,
            },
            "torch": {
                "preset": TORCH_CUSTOM_MODEL,
                "design": TORCH_DESIGN_MODEL,
                "base": TORCH_BASE_MODEL,
            },
        }.get(backend)
        if defaults is None:
            _fail(
                "当前平台没有默认本地路线（Intel Mac / 未知系统）；"
                "请使用 --provider online，或参考 references/setup.md"
            )
        if args.ref_audio:
            kwargs["model_id"] = args.model or defaults["base"]
        elif design:
            kwargs["design"] = design
            # VoiceDesign 模式必须加载 VoiceDesign 模型；未显式覆盖时用默认。
            kwargs["model_id"] = args.model or defaults["design"]
        elif args.model:
            kwargs["model_id"] = args.model
        kwargs["backend"] = backend
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
    deliver: frozenset[str] | None = None,
    internal_dir: Path | None = None,
) -> dict:
    """组装机器可读报告（spec §14）；产物只在真正写成功后才有值。"""
    truncated = any(r.truncated_seconds > 0 for r in results)
    return {
        "schema_version": REPORT_SCHEMA,
        "job_id": job_id,
        "status": status,
        "error": error,
        "deliver": sorted(deliver) if deliver is not None else None,
        "internal_dir": str(internal_dir) if internal_dir else None,
        "inputs": {
            "srt": str(srt),
            "video": str(video) if video is not None else None,
            "srt_warnings": srt_warnings,
        },
        "env": _env_payload(),
        "provider": args.provider,
        "voice": _voice_payload(voice),
        "design": design,
        "ref": (
            {"ref_audio": str(args.ref_audio), "ref_text": args.ref_text}
            if args.ref_audio
            else None
        ),
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


class _LazyProvider:
    """把 `prepare()` 延迟到首次真实使用（A12，spec §5.3）。

    `describe()` 直接转发（不触发模型加载 / 登录）；`synthesize()` 首次
    调用时才 prepare——全片命中原生缓存的任务从不调用 synthesize，
    模型加载次数为零，重新拼轨不必再等模型。`download()`（收据恢复）
    不需要模型，同样不触发 prepare。`prepare_seconds` 记录真实耗时
    （未发生时为 None）。
    """

    def __init__(self, provider) -> None:
        self._provider = provider
        self._prepared = False
        self.prepare_seconds: float | None = None
        self.prepare_count = 0

    def _ensure_prepared(self) -> None:
        if not self._prepared:
            started = time.monotonic()
            self._provider.prepare()
            self.prepare_seconds = time.monotonic() - started
            self.prepare_count += 1
            self._prepared = True

    def prepare(self) -> None:
        self._ensure_prepared()

    def describe(self) -> dict:
        return self._provider.describe()

    def synthesize(self, *args, **kwargs):
        self._ensure_prepared()
        return self._provider.synthesize(*args, **kwargs)

    def download(self, *args, **kwargs):
        return self._provider.download(*args, **kwargs)


def _run_design_preview(
    args: argparse.Namespace,
    design: str | None,
    out_prefix: Path,
    inputs: list[Path],
) -> int:
    """设计后克隆第一步（spec §7.2）：只合成试听，不执行整片。

    预览进程独立于整片任务——用户选定参考后，整片走 Base 克隆
    （`--ref-audio <试听文件> --ref-text <试听文本>`）。设计模型与
    Base 模型因此天然不同进程驻留，切换显存由进程退出完整归还
    （§7.2 切换契约的最强实现；同进程切换见 provider.release_model）。
    """
    def _preview_paths(prefix: Path) -> list[Path]:
        return [_with_suffix(prefix, ".preview.wav")]

    preview_path = _with_suffix(out_prefix, ".preview.wav")
    _protect_inputs(_preview_paths(out_prefix), inputs)
    if preview_path.exists() and not args.overwrite:
        out_prefix, _ = _renumber_prefix(out_prefix, _preview_paths, inputs)
        preview_path = _with_suffix(out_prefix, ".preview.wav")
        print(f"同名试听已存在，自动编号: {out_prefix.name}")

    _require_binary("ffmpeg")
    provider = _LazyProvider(_build_provider(args, design))
    provider.prepare()  # 预览必须真实加载设计模型
    result = provider.synthesize(args.preview_text, None)
    processed = process_result(result, args.master_sample_rate)
    write_wav(preview_path, processed.pcm, args.master_sample_rate)
    print(f"试听音频: {preview_path}")
    print(f"试听文本（选定后原样传给 --ref-text）: {args.preview_text}")
    print(
        "试听选定 → 整片克隆：--ref-audio <试听文件> --ref-text <试听文本>；"
        "调整描述 → 改 --design 重跑本预览（旧试听保留）。"
    )
    return 0


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
        lenient=args.lenient_srt,
    )
    for warning in srt_warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if not cues:
        raise SRTError(f"{srt}: no cues found")

    srt_sha = file_sha256(srt)
    original_count = len(cues)
    if args.merge_plan:
        try:
            cues = load_merge_plan(
                Path(args.merge_plan), cues,
                srt_sha256=srt_sha,
                allow_text_edits=args.allow_text_edits,
            )
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
    if (
        voice is not None
        and args.provider == "local"
        and local_backend() == "torch"
        and voice.model == LOCAL_MODEL
    ):
        # torch 后端的预设音色用官方模型 ID（缓存身份 / 报告与实际一致）。
        voice = replace(voice, model=TORCH_CUSTOM_MODEL)
    # Base 克隆没有预设音色：voice 保持 None，引擎向 provider 传
    # ref_audio/ref_text（F01 修复后不再构造 voice_id="ref-clone" 的假音色）。
    design = args.design if args.provider == "local" else None

    out_prefix, _ = _resolve_outputs(args, video, srt)
    inputs = _input_paths(srt, video, audio, args)
    deliver: frozenset[str] = args.deliver_set
    if "video" in deliver and video is None:
        if args.deliver or args.track_only:
            _fail("--deliver video 需要 --video 输入（本次未提供视频）")
        deliver = deliver - {"video"}  # 默认集合无视频输入时自动省略

    def _derive_video_out(prefix: Path) -> Path | None:
        """按 `--out` 的原始形态从前缀推导成片路径（编号后保持同一规则）。"""
        if video is None or "video" not in deliver:
            return None
        if args.out and Path(args.out).suffix.lower() == ".mp4":
            return prefix.with_suffix(".mp4")
        return _with_suffix(prefix, ".dub.mp4")

    # --- dry-run：只读、校验、打印；不写任何文件 -----------------------
    if args.dry_run:
        _print_plan(args, srt, video, total_duration, cues, voice)
        return 0

    # --- write-plan：只写预览计划，不合成 -------------------------------
    if args.write_plan:
        def _plan_paths(prefix: Path) -> list[Path]:
            return [
                _with_suffix(prefix, ".plan.json"),
                _with_suffix(prefix, ".plan.srt"),
            ]
        _protect_inputs(_plan_paths(out_prefix), inputs)
        if (
            not args.overwrite
            and any(path.exists() for path in _plan_paths(out_prefix))
        ):
            out_prefix, _ = _renumber_prefix(out_prefix, _plan_paths, inputs)
            print(f"同名计划已存在，自动编号: {out_prefix.name}")
        _write_plan_files(out_prefix, cues, srt)
        return 0

    # --- design preview：设计后克隆第一步（spec §7.2），不执行整片 ------
    if args.preview_text:
        return _run_design_preview(args, design, out_prefix, inputs)

    # --- 交付路径保护：统一编号 / 显式覆盖 / 输入永不覆盖（F09/F12）----
    # 交付集合只含用户显式选择的成品；job.json / 内部报告在应用任务目录
    # （jobs/<job_id>/），不进素材目录、不参与编号。
    if args.json_report:
        # 自定义报告路径不参与编号，但同样做所有权检查（防止绕过保护）。
        custom_report = Path(args.json_report)
        _protect_inputs([custom_report], inputs)
        if (
            custom_report.exists()
            and not args.overwrite
            and not args.resume
        ):
            _fail(
                f"--json-report 目标已存在：{custom_report}；"
                "换一个路径或显式 --overwrite"
            )

    def _build_deliverables(prefix: Path) -> list[Path]:
        paths: list[Path] = []
        if "audio" in deliver:
            paths.append(_with_suffix(prefix, ".dub.wav"))
        derived = _derive_video_out(prefix)
        if derived is not None:
            paths.append(derived)
        if "subtitle" in deliver:
            paths.append(_with_suffix(prefix, ".dub.srt"))
        if "report" in deliver and not args.json_report:
            paths.append(_with_suffix(prefix, ".report.json"))
        if args.json_report:
            paths.append(Path(args.json_report))
        if args.keep_segments:
            paths.append(prefix.parent / "segments")
        return paths

    _protect_inputs(_build_deliverables(out_prefix), inputs)
    if args.resume:
        pass  # resume 沿用原任务路径；身份由 reconcile_resume 对账保证
    elif not args.overwrite:
        if any(path.exists() for path in _build_deliverables(out_prefix)):
            out_prefix, _ = _renumber_prefix(
                out_prefix, _build_deliverables, inputs,
            )
            print(
                f"同名成品已存在，整组自动编号为 {out_prefix.name}"
                "（不覆盖旧文件；换 --out 可自定义，或 --overwrite 显式替换）"
            )
    video_out = _derive_video_out(out_prefix)
    track_path = (
        _with_suffix(out_prefix, ".dub.wav") if "audio" in deliver
        else None  # 稍后指向内部任务目录（用户没选音轨交付）
    )

    # --- job manifest：先建（或 resume），失败也有恢复依据 --------------
    plan_sha = file_sha256(Path(args.merge_plan)) if args.merge_plan else None
    ref_sha = file_sha256(Path(args.ref_audio)) if args.ref_audio else None
    # 实际生效的模型（含克隆 / 设计的默认解析，随后端）：进配置快照供
    # resume 对账。
    _torch_local = args.provider == "local" and local_backend() == "torch"
    resolved_model = args.model or (
        (TORCH_BASE_MODEL if _torch_local else LOCAL_BASE_MODEL)
        if (args.provider == "local" and args.ref_audio)
        else (TORCH_DESIGN_MODEL if _torch_local else LOCAL_DESIGN_MODEL)
        if (args.provider == "local" and design)
        else (voice.model if voice else None)
    )
    job_config = {
        "provider": args.provider,
        "voice": voice.voice_id if voice else None,
        "design": design,
        # ref_audio 的身份是 inputs.ref_audio_sha256；ref_text 影响
        # 合成与缓存身份，必须进配置快照供 resume 对账。
        "ref_text": args.ref_text,
        "instruct": args.instruct,
        "lang": args.lang,
        "model": resolved_model,
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
    }
    job_groups = [
        {
            "source_indices": list(cue.source_indices or (cue.index,)),
            "text": cue.text,
            "text_edited": cue.text_edited,
            "start": cue.start,
            "end": cue.end,
            "status": "pending",
        }
        for cue in cues
    ]
    receipts: dict[int, dict] = {}
    if args.resume:
        manifest_path = _resolve_manifest_path(args.resume)
        internal_dir = manifest_path.parent
        try:
            manifest = JobManifest.load(manifest_path)
        except ValueError as exc:
            _fail(str(exc))
        blockers, revisions, plan_changed = manifest.reconcile_resume(
            srt_sha, plan_sha, ref_sha, job_config,
        )
        if blockers:
            _fail("cannot resume: " + "; ".join(blockers))
        if revisions:
            for note in revisions:
                print(f"resume 修订: {note}")
            manifest.apply_revision(
                config=job_config,
                groups=job_groups if plan_changed else None,
                notes=revisions,
            )
        print(f"恢复任务: {manifest.job_id}（原状态 {manifest.status}）")
        # 上次 download_failed 的组：收据优先，恢复时只下载、不重新提交。
        # 计划修订时 groups 已重建（文本映射变化，旧收据作废）。
        receipts = {
            position: {
                "audio_url": record.get("audio_url"),
                "request_id": record.get("request_id"),
            }
            for position, record in enumerate(manifest.group_records())
            if record.get("status") == "download_failed"
            and record.get("audio_url")
        }
        submitting = [
            position
            for position, record in enumerate(manifest.group_records())
            if record.get("status") == "submitting"
        ]
        if submitting:
            print(
                f"warning: 上次在第 {len(submitting)} 组提交期间中断"
                f"（组 {submitting}）；无法确认服务端是否已受理，"
                "本次将重新提交这些组——如担心重复计费请先到控制台核对。",
                file=sys.stderr,
            )
    else:
        # F12：任务状态在应用目录 jobs/<job_id>/，不与用户成品混放。
        fresh_id = new_job_id()
        internal_dir = job_dir(fresh_id)
        internal_dir.mkdir(parents=True, exist_ok=True)
        manifest = JobManifest.create(
            internal_dir / "job.json",
            job_id=fresh_id,
            inputs={
                "srt_sha256": srt_sha,
                "merge_plan_sha256": plan_sha,
                "ref_audio_sha256": ref_sha,
            },
            config=job_config,
            groups=job_groups,
        )
    manifest.save("preparing")
    if track_path is None:
        # 用户未选音轨交付：整轨只作为混流中间产物放内部目录。
        track_path = internal_dir / "track.dub.wav"

    # 真正的合成流程才需要 ffmpeg（重采样 / 变速 / 混流）。
    _require_binary("ffmpeg")

    # A12：prepare 延迟到首次真实合成（懒包装）——全片缓存命中的任务
    # 模型加载次数为零；describe 仍可用（provider 信息进缓存键 / 报告）。
    provider = _LazyProvider(_build_provider(args, design))

    if voice is not None:
        print(
            f"video-tts: provider={args.provider} voice={voice.voice_id} "
            f"model={voice.model}"
        )
    elif design:
        print(f"video-tts: provider={args.provider} design={design}")
    else:
        print(
            f"video-tts: provider={args.provider} "
            f"clone ref_audio={args.ref_audio}"
        )
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

    def _record_group(position: int, result: SegmentResult) -> None:
        """逐组原子落盘（spec §13）：不等引擎结束，崩溃也保住最近状态。"""
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
            audio_url=result.audio_url,
            request_id=result.request_id,
            downloaded=result.downloaded,
        )
        manifest.save()

    def _mark_submitting(position: int) -> None:
        """在线提交前落 submitting 标记（spec §14 / A09）：崩溃后能看出
        提交是否已发出，恢复时保守处理而不是当作未发生。"""
        manifest.update_group(position, status="submitting")
        manifest.save()

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
            receipts=receipts,
            on_result=_record_group,
            on_submit=_mark_submitting,
        )
    except EngineAbort as abort:
        results = abort.results
        aborted = abort.error if abort.error is not None else RuntimeError(str(abort))
    synth_seconds = time.monotonic() - synth_started

    failures = sum(1 for result in results if result.failed)
    truncated_any = any(result.truncated_seconds > 0 for result in results)

    warning_count = 0
    if results:
        warning_count, failures = _print_report(results, len(srt_warnings))
        if aborted is None:
            # 正常完成（含 partial）才写块级字幕；中止路径靠 manifest 与
            # 缓存恢复，不产出看起来完整的字幕成品。
            if "audio" in deliver:
                print(f"配音轨: {track_path}")
            if "subtitle" in deliver:
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
        and "video" in deliver
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
        download_failed = any(
            r.status == "download_failed" for r in results
        )
        attention = any(r.status == "needs_attention" for r in results)
        status = (
            "submission_unknown" if unknown
            else "download_failed" if download_failed
            else "needs_attention" if attention
            else "failed"
        )
    else:
        status = _job_status(
            results, truncated=truncated_any, failures=failures,
            mux_failed=mux_failed,
        )

    timings = {
        # 懒加载下未发生 prepare（全片缓存命中）为 None——如实记录零加载。
        "prepare_seconds": (
            round(provider.prepare_seconds, 3)
            if provider.prepare_seconds is not None else None
        ),
        "prepare_count": provider.prepare_count,
        "synthesizing_seconds": round(synth_seconds, 3),
        "mux_seconds": round(timings_mux, 3),
        "total_seconds": round(time.monotonic() - started, 3),
    }
    error_text = f"{type(aborted).__name__}: {aborted}" if aborted else (
        "mux failed" if mux_failed else None
    )

    manifest.save(status, note=error_text)
    # F12：内部完整报告始终写应用任务目录；只有用户选择 report 交付
    # （--deliver report 或 --json-report）才复制进交付目录。
    report_payload = _report_payload(
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
        deliver=deliver,
        internal_dir=internal_dir,
    )
    write_json(internal_dir / "report.json", report_payload)
    if args.json_report:
        report_path = Path(args.json_report)
        write_json(report_path, report_payload)
    elif "report" in deliver:
        report_path = _with_suffix(out_prefix, ".report.json")
        write_json(report_path, report_payload)
    else:
        report_path = internal_dir / "report.json"
    print(f"报告: {report_path}")
    print(f"任务清单: {manifest.path}")
    if status != "complete":
        print(f"状态: {status}", file=sys.stderr)
        print(
            f"恢复：修正输入后用 --resume {internal_dir} 重跑；"
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
