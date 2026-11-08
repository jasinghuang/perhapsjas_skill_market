#!/usr/bin/env python3
"""
Audio Transcriber — unified file transcription.

Provider choice is explicit (doc §3): `--provider qwen` (local Qwen3-ASR-1.7B,
recommended) or `--provider scribe` (Elevenabs Scribe V2 online). Missing
provider is an error, never a silent default — and never an automatic online
upload. Every job produces TXT + JSON + SRT (SRT only with real alignment).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import List, Optional

SKILL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SKILL_DIR))

from backends import get_provider_backend, normalize_provider  # noqa: E402
from backends.scribe_backend import ScribeError  # noqa: E402
from progress import ProgressReporter  # noqa: E402
from results import build_result, validate_result  # noqa: E402
from subtitles import (  # noqa: E402
    build_entries,
    entries_to_srt,
    finalize_entries,
    validate_srt,
    DEFAULT_CONFIG as SUBTITLE_DEFAULTS,
)

FORMATS = ("txt", "json", "srt")
STAGES = ("环境检查", "准备", "转写", "对齐", "导出", "校验")


def stage(name: str) -> None:
    print(f"[{name}]", flush=True)


def load_config() -> dict:
    config_file = SKILL_DIR / "config.json"
    if config_file.exists():
        try:
            return json.loads(config_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    return {}


def convert_to_simplified_chinese(text: str) -> str:
    try:
        import zhconv
        return zhconv.convert(text, "zh-cn")
    except ImportError:
        return text


def _apply_zhconv(result: dict) -> None:
    if (result.get("language") or "").lower() not in ("zh", "chinese"):
        return
    if result.get("text"):
        result["text"] = convert_to_simplified_chinese(result["text"])
    for unit in result.get("words") or []:
        if unit.get("text"):
            unit["text"] = convert_to_simplified_chinese(unit["text"])
    for seg in result.get("segments") or []:
        if seg.get("text"):
            seg["text"] = convert_to_simplified_chinese(seg["text"])


def _paragraph_text(result: dict, paragraph_gap: float = 2.0) -> str:
    """TXT body: the raw transcription verbatim (doc §9 — no rewriting, no
    summarizing); falls back to joined segments only when raw text is absent."""
    raw = result.get("text") or ""
    if raw.strip():
        return raw.strip()
    segments = result.get("segments") or []
    if not segments:
        return raw
    paragraphs = []
    current: List[str] = []
    last_end = None
    for seg in segments:
        if last_end is not None and seg["start"] - last_end >= paragraph_gap:
            paragraphs.append("".join(current))
            current = []
        current.append(seg["text"])
        last_end = seg["end"]
    if current:
        paragraphs.append("".join(current))
    return "\n\n".join(paragraphs)


def atomic_write(path: Path, content: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def transcribe_one(
    backend,
    input_path: Path,
    output_dir: Path,
    formats: List[str],
    language: str,
    options: dict,
    show_progress: bool,
    output_stem: Optional[str] = None,
) -> dict:
    """Run one file through probe→transcribe→export→validate. Returns summary."""
    started = time.monotonic()

    import media as media_mod

    stage("准备")
    probe = backend.probe()
    if probe.get("status") == "unsupported":
        raise RuntimeError("本地路线在当前环境不受支持: " + "; ".join(probe["checks"]))
    if probe.get("status") == "needs_setup":
        if any("ELEVENLABS_API_KEY" in c for c in probe["checks"]):
            raise RuntimeError(
                "缺少在线转写凭证: " + "; ".join(probe["checks"])
                + "。配置方法见 references/scribe.md；密钥不会出现在日志或产物中。"
            )
        raise RuntimeError(
            "所选路线依赖未就绪（请通过 run.py 运行以自动安装）: " + "; ".join(probe["checks"])
        )
    if probe.get("status") == "unverified":
        print("  注意: " + "; ".join(probe["checks"]))

    media_info = media_mod.probe_media(input_path)
    print(f"  媒体时长 {media_info['duration']:.1f}s，音轨 {len(media_info['audio_streams'])} 条")

    work_dir = output_dir / f".{input_path.stem}.chunks"

    reporter = ProgressReporter() if show_progress else None
    result = backend.transcribe(
        str(input_path),
        language=language,
        options={**options, "media_info": media_info, "work_dir": work_dir},
        on_stage=stage,
        on_progress=reporter.update if reporter else None,
    )
    if reporter:
        reporter.finish()

    stage("导出")
    _apply_zhconv(result)

    words = result.get("words") or []
    can_srt = result.get("status") == "complete" and bool(words)
    if can_srt:
        subtitle_cfg = {**SUBTITLE_DEFAULTS, **(options.get("subtitles") or {})}
        entries = build_entries(words, subtitle_cfg)
        entries, timeline_warnings = finalize_entries(entries, result.get("duration_seconds"))
        result["warnings"].extend(timeline_warnings)
        srt_text = entries_to_srt(entries)
        result["segments"] = [
            {"start": e["start"], "end": e["end"], "text": e["text"], "speaker_id": None}
            for e in entries
        ]
    else:
        srt_text = None
        if result.get("status") == "partial":
            result["warnings"].append("SRT 未导出：对齐未完成（partial）")

    stem = output_stem or input_path.stem
    products = {}
    if "txt" in formats:
        path = output_dir / f"{stem}.txt"
        atomic_write(path, _paragraph_text(result))
        products["txt"] = path
    if "json" in formats:
        path = output_dir / f"{stem}.json"
        atomic_write(path, json.dumps(result, ensure_ascii=False, indent=2))
        products["json"] = path
    if "srt" in formats and srt_text is not None:
        path = output_dir / f"{stem}.srt"
        atomic_write(path, srt_text)
        products["srt"] = path

    stage("校验")
    issues = validate_result(result)
    if "json" in products:
        if issues:
            result["warnings"].extend(issues)
            atomic_write(products["json"], json.dumps(result, ensure_ascii=False, indent=2))
    if "srt" in products:
        srt_issues = validate_srt(products["srt"].read_text(encoding="utf-8"), result.get("duration_seconds"))
        if srt_issues:
            result["warnings"].extend(srt_issues)
            print("  SRT 校验问题: " + "; ".join(srt_issues))

    if result.get("status") == "complete" and work_dir.exists():
        # Success: drop work/cache files; failures keep them for resume (doc §12).
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)

    elapsed = time.monotonic() - started
    return {
        "input": str(input_path),
        "status": result["status"],
        "provider": result["provider"],
        "backend": result["backend"],
        "model_id": result["model_id"],
        "duration": result.get("duration_seconds"),
        "elapsed": elapsed,
        "products": {k: str(v) for k, v in products.items()},
        "warnings": result.get("warnings") or [],
    }


def run_detect_env(provider: Optional[str]) -> int:
    import env_check

    env = env_check.detect_environment()
    print(env_check.format_env_line(env))
    print(json.dumps(env, ensure_ascii=False, indent=2))
    if provider:
        try:
            normalized = normalize_provider(provider)
            print(json.dumps(env_check.probe_backend(normalized), ensure_ascii=False, indent=2))
        except ValueError as exc:
            print(f"Error: {exc}")
            return 2
    return 0


def parse_args(argv=None) -> argparse.Namespace:
    config = load_config()
    parser = argparse.ArgumentParser(
        description="Transcribe audio/video via Qwen3-ASR-1.7B (local) or Scribe V2 (online)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python run.py video.mp4 --provider qwen\n"
            "  python run.py video.mp4 --provider scribe --language zh\n"
            "  python run.py a.mp4 b.mp4 --provider qwen --formats srt --output ~/subtitles\n"
            "  python run.py --detect-env --provider qwen"
        ),
    )
    parser.add_argument("input", nargs="*", help="One or more audio/video files")
    parser.add_argument("--provider", help="qwen (local, recommended) or scribe (online). Required.")
    parser.add_argument("--language", "-l", default=config.get("language", "auto"),
                        help="Language code: auto/zh/en/ja/ko/... (default: auto)")
    parser.add_argument("--formats", default=",".join(config.get("formats", FORMATS)),
                        help=f"Comma-separated outputs among {FORMATS} (default: all three)")
    parser.add_argument("--output", "-o", help="Output directory (default: alongside each input)")
    parser.add_argument("--device", default="auto", help="auto / cpu / cuda:0 (qwen torch route)")
    parser.add_argument("--precision", default="8bit", choices=["8bit", "bf16", "6bit"],
                        help="Mac MLX weight precision (advanced; default: 8bit)")
    parser.add_argument("--diarize", action="store_true",
                        help="Speaker diarization (scribe only; may add cost)")
    parser.add_argument("--audio-track", type=int, default=None,
                        help="Audio stream index when a file has several tracks")
    parser.add_argument("--detect-env", action="store_true",
                        help="Print environment/backend detection and exit (never installs)")
    parser.add_argument("--no-progress", action="store_true", help="Disable live progress lines")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    if args.detect_env:
        return run_detect_env(args.provider)

    if not args.input:
        print("Error: no input files.")
        return 2

    if not args.provider:
        print(
            "Error: 转写方式（--provider）未指定。\n"
            "  1. qwen   — 本地 Qwen3-ASR-1.7B（推荐，Mac 用 MLX / Windows 用 CUDA）\n"
            "  2. scribe — ElevenLabs Scribe V2 在线（需 API 凭证，按量计费）\n"
            "非交互调用必须显式传入 --provider；不会默认触发在线上传。"
        )
        return 2

    try:
        provider = normalize_provider(args.provider)
    except ValueError as exc:
        print(f"Error: {exc}")
        return 2

    formats = [f.strip().lower() for f in args.formats.split(",") if f.strip()]
    invalid = [f for f in formats if f not in FORMATS]
    if invalid or not formats:
        print(f"Error: --formats 只支持 {FORMATS}，收到: {invalid or '空'}")
        return 2

    inputs = [Path(p).expanduser() for p in args.input]
    for path in inputs:
        if not path.is_file():
            print(f"Error: file not found: {path}")
            return 2

    output_dir = Path(args.output).expanduser() if args.output else None
    if output_dir is not None and output_dir.is_file():
        print(f"Error: --output 现在是输出目录（产物为 <stem>.txt/.json/.srt 三件套），"
              f"但给定路径已是文件: {output_dir}")
        return 2

    print(f"\n{'=' * 60}")
    print(f"Audio Transcriber — provider: {provider}")
    print(f"{'=' * 60}")
    print(f"  Inputs: {len(inputs)}")
    for path in inputs:
        print(f"    - {path}")
    print(f"  Language: {args.language}")
    print(f"  Formats: {', '.join(formats)}")
    if args.diarize:
        print("  Diarize: on (scribe)")
    print(f"{'=' * 60}\n")

    stage("环境检查")
    import env_check

    env = env_check.detect_environment()
    print("  " + env_check.format_env_line(env))

    try:
        backend = get_provider_backend(
            provider, {"precision": args.precision, "device": args.device}
        )
    except Exception as exc:
        print(f"Error: {exc}")
        return 1
    options = {"diarize": args.diarize, "audio_track": args.audio_track}

    summaries = []
    failures = []
    # Same-stem inputs (a.mp4 + a.mp3) would overwrite each other's trio —
    # deduplicate output stems up front (doc §10).
    claimed: dict = {}
    stem_overrides: dict = {}
    for path in inputs:
        base_dir = output_dir if output_dir is not None else path.parent
        key = (str(base_dir).lower(), path.stem.lower())
        claimed[key] = claimed.get(key, 0) + 1
        if claimed[key] > 1:
            stem_overrides[str(path)] = f"{path.stem}-{claimed[key]}"

    try:
        for index, path in enumerate(inputs, 1):
            if len(inputs) > 1:
                print(f"\n[{index}/{len(inputs)}] {path}")
            per_output = output_dir if output_dir is not None else path.parent
            per_output.mkdir(parents=True, exist_ok=True)
            try:
                summary = transcribe_one(
                    backend, path, per_output, formats, args.language, options,
                    show_progress=not args.no_progress,
                    output_stem=stem_overrides.get(str(path)),
                )
                summaries.append(summary)
                print(f"  Done: {summary['status']} in {summary['elapsed']:.1f}s")
                for kind, product in summary["products"].items():
                    print(f"    {kind}: {product}")
                for warning in summary["warnings"]:
                    print(f"    warning: {warning}")
            except KeyboardInterrupt:
                print("\n已取消：停止后续任务；已完成分块缓存已保留，可重新运行续传。")
                return 130
            except ScribeError as exc:
                failures.append((str(path), f"[{exc.kind}] {exc}"))
                print(f"  Error: [{exc.kind}] {exc}")
            except Exception as exc:
                failures.append((str(path), str(exc)))
                print(f"  Error: {exc}")
    finally:
        pass

    print(f"\n{'=' * 60}")
    for summary in summaries:
        available = ", ".join(sorted(summary["products"])) or "无（对齐失败或无语音）"
        print(
            f"  {Path(summary['input']).name}: {summary['status']} | "
            f"{summary['provider']}/{summary['model_id']} ({summary['backend']}) | "
            f"媒体 {summary['duration']:.1f}s，耗时 {summary['elapsed']:.1f}s | 产物: {available}"
        )
    if failures:
        print(f"Finished with {len(failures)} failure(s):")
        for item, message in failures:
            print(f"  - {item}: {message}")
        return 1
    print(f"All done! {len(summaries)} file(s) transcribed.")
    print(f"{'=' * 60}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
