#!/usr/bin/env python3
"""
Audio Transcriber — unified file transcription.

Provider choice is explicit (doc §3): `--provider qwen` (local Qwen3-ASR-1.7B,
recommended) or `--provider scribe` (Elevenabs Scribe V2 online). Missing
provider is an error, never a silent default — and never an automatic online
upload. Only explicitly selected deliverables are published after validation.
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import List, Optional

SKILL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SKILL_DIR))

from backends import get_provider_backend, normalize_provider  # noqa: E402
from backends.scribe_backend import ScribeError  # noqa: E402
from progress import ProgressReporter  # noqa: E402
from results import validate_result  # noqa: E402
from subtitles import (  # noqa: E402
    build_entries,
    entries_to_srt,
    finalize_entries,
    validate_srt,
    DEFAULT_CONFIG as SUBTITLE_DEFAULTS,
)

FORMATS = ("srt", "md-timed", "md", "txt", "json")
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
    """Probe → transcribe/cache → validate → publish. Returns summary."""
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

    from job_cache import job_directory, write_json, JobLock
    from delivery import content_key, markdown, paragraphs, publish
    import shutil
    from subtitles import attach_punctuation, units_to_text

    tracks = [stream["index"] for stream in media_info["audio_streams"]]
    track = options.get("audio_track")
    if track is not None and track not in tracks:
        raise ValueError(f"音轨索引 {track} 无效，可用索引: {tracks}")
    # Resolve the default explicitly, consistently for all three backends.
    options = {**options, "audio_track": tracks[0] if track is None else track}
    job_dir = job_directory(input_path, backend, language, options)
    work_dir = job_dir / "work"
    cache_file = job_dir / "result.json"
    with JobLock(job_dir):
        work_dir.mkdir(exist_ok=True)
        result = None
        if cache_file.is_file():
            try:
                candidate = json.loads(cache_file.read_text(encoding="utf-8"))
                if candidate.get("status") == "complete" and isinstance(candidate.get("text"), str):
                    result = candidate
                    stage("命中完整转写缓存（仅重新导出）")
            except (OSError, ValueError):
                pass
        if result is None:
            reporter = ProgressReporter() if show_progress else None
            try:
                result = backend.transcribe(
                    str(input_path), language=language,
                    options={**options, "media_info": media_info, "work_dir": work_dir},
                    on_stage=stage, on_progress=reporter.update if reporter else None,
                )
            finally:
                if reporter:
                    reporter.finish()
            # Store recognition before rendering; export failures never require
            # a new paid upload or local inference. Partial chunks stay resumable.
            if result.get("status") == "complete":
                write_json(cache_file, result)
                # First use may download model refs. Publish the same raw
                # result under the now-resolved identity, so the next export
                # does not need to infer again solely because refs appeared.
                resolved_dir = job_directory(input_path, backend, language, options)
                from backends.qwen_torch_backend import cached_revision
                if (resolved_dir != job_dir and result.get("model_revision")
                        and result["model_revision"] == cached_revision(result["model_id"])):
                    try:
                        with JobLock(resolved_dir):
                            write_json(resolved_dir / "result.json", result)
                    except BlockingIOError:
                        pass  # Another invocation owns the new identity; original cache is safe.

        stage("校验")
        result.setdefault("warnings", [])
        result["duration_seconds"] = media_info["duration"]
        words = result.get("words") or []
        raw_text = result.get("text") or ""
        can_time = result.get("status") == "complete" and bool(words)
        entries, srt_text = [], None
        if can_time:
            try:
                for i, word in enumerate(words):
                    if i and (word["start"] < words[i-1]["start"] - 0.08
                              or words[i-1]["end"] - word["start"] > 0.5):
                        raise ValueError("词级对齐存在严重时序冲突，需要检查对齐")
                attached = attach_punctuation(words, raw_text)
                if attached:
                    words = attached
                if content_key(raw_text) != content_key(units_to_text(words)):
                    raise ValueError("对齐文本与原始转写内容不一致，拒绝发布缺字字幕")
                zero_spans = sum(1 for w in words if w["end"] == w["start"])
                if zero_spans:
                    result["warnings"].append(f"{zero_spans} 个零时长对齐单位按最小 80ms 修复；字幕边界已重新校验")
                subtitle_cfg = {**SUBTITLE_DEFAULTS, **(options.get("subtitles") or {}), "max_lines": 1}
                entries = build_entries(words, subtitle_cfg)
                entries, timeline_warnings = finalize_entries(entries, media_info["duration"])
                result["warnings"].extend(timeline_warnings)
                srt_text = entries_to_srt(entries)
                issues = validate_srt(srt_text, media_info["duration"])
                if issues:
                    raise ValueError("; ".join(issues))
                if content_key("".join(e["text"] for e in entries)) != content_key(raw_text):
                    raise ValueError("字幕导出内容覆盖校验失败")
                result["segments"] = [{"start": e["start"], "end": e["end"], "text": e["text"],
                                       "speaker_id": e.get("speaker_id")} for e in entries]
                wide = sum(1 for e in entries if __import__("subtitles").display_width(e["text"]) > subtitle_cfg["line_width"])
                if wide:
                    result["warnings"].append(f"{wide} 条字幕超过建议行宽；保留全文及真实时间单位，未截字")
            except ValueError as exc:
                can_time, srt_text = False, None
                result["status"] = "partial"
                result["segments"] = []
                result["warnings"].append(f"时间轴/SRT 校验未通过: {exc}")
        if raw_text.strip() and not can_time and any(f in formats for f in ("srt", "md-timed")):
            result["status"] = "partial"
            result["warnings"].append("SRT / 带时间码 MD 未导出：对齐未完成或校验失败")
        # Validate schema/numeric values separately. Model word spans can overlap;
        # final cue spans are checked strictly above without discarding words.
        all_issues = [i for i in validate_result(result) if "previous unit ends" not in i]
        issues = [i for i in all_issues if not (result.get("status") == "partial" and i.startswith(("words[", "segments[")))]
        if issues:
            raise ValueError("转写结构校验失败: " + "; ".join(issues))

        stage("导出")
        contents = {}
        for kind in dict.fromkeys(formats):
            if kind == "srt" and srt_text is not None:
                contents[kind] = srt_text
            elif kind == "md-timed" and can_time:
                contents[kind] = markdown(result, timed=True)
            elif kind == "md":
                contents[kind] = markdown(result)
            elif kind == "txt":
                contents[kind] = "\n\n".join(p["text"] for p in paragraphs(result))
            elif kind == "json":
                contents[kind] = json.dumps(result, ensure_ascii=False, indent=2)
        products = publish(output_dir, output_stem or input_path.stem, contents) if contents else {}
        if result.get("status") == "complete":
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

    env = env_check.detect_environment(check_local=provider is not None and provider.lower() in ("qwen", "local", "qwen-local", "qwen_local", "qwen3"))
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
    parser.add_argument("--formats", default=",".join(config.get("formats", ["srt"])),
                        help=f"Comma-separated outputs among {FORMATS} (default: srt only)")
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
        print(f"Error: --output 现在是输出目录（按 --formats 导出所选文件），"
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

                )
                summaries.append(summary)
                print(f"  Done: {summary['status']} in {summary['elapsed']:.1f}s")
                for kind, product in summary["products"].items():
                    print(f"    {kind}: {product}")
                for warning in summary["warnings"]:
                    print(f"    warning: {warning}")
            except KeyboardInterrupt:
                print("\n已取消：停止后续任务；已完成缓存保留在应用缓存目录；Torch 可复用分块，MLX 中断需重跑当前推理。")
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
    if any(s["status"] != "complete" for s in summaries):
        print("存在 partial 结果，所选交付未全部完成。")
        return 3
    print(f"All done! {len(summaries)} file(s) transcribed.")
    print(f"{'=' * 60}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
