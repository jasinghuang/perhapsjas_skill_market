#!/usr/bin/env python3
"""
Audio Transcriber — cross-platform
Mac: MLX-Whisper (Apple Silicon) | Windows: Faster-Whisper (CUDA / CPU)
"""

import json
import platform
import sys
from pathlib import Path
from typing import List, Dict, Optional

from backends import get_backend
from progress import ProgressReporter

CONFIG_FILE = Path(__file__).parent / "config.json"

DEFAULT_MODEL = "large-v3-turbo" if platform.system() == "Darwin" else "medium"


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "model": DEFAULT_MODEL,
        "language": "auto",
        "output_format": "md",
        "keep_timestamps": False,
    }


def convert_to_simplified_chinese(text: str) -> str:
    try:
        import zhconv
        return zhconv.convert(text, "zh-cn")
    except ImportError:
        return text


def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    milliseconds = int((secs - int(secs)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{milliseconds:03d}"


def segments_to_srt(segments: List[Dict]) -> str:
    lines = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{format_timestamp(seg['start'])} --> {format_timestamp(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def merge_segments_to_paragraphs(segments: List[Dict], gap_threshold: float = 2.0) -> List[Dict]:
    paragraphs = []
    current_texts = []
    current_start = None
    current_end = None

    for seg in segments:
        if current_end is not None and seg["start"] - current_end >= gap_threshold:
            paragraphs.append(
                {"start": current_start, "end": current_end, "text": "".join(current_texts)}
            )
            current_texts = []
            current_start = None

        if current_start is None:
            current_start = seg["start"]
        current_end = seg["end"]
        current_texts.append(seg["text"])

    if current_texts:
        paragraphs.append(
            {"start": current_start, "end": current_end, "text": "".join(current_texts)}
        )

    return paragraphs


def segments_to_md(
    segments: List[Dict],
    title: str,
    model_size: str,
    language: str,
    keep_timestamps: bool,
    backend_name: str,
) -> str:
    from datetime import datetime

    if not keep_timestamps:
        segments = merge_segments_to_paragraphs(segments)

    md = [f"# {title}\n"]
    md.append("---\n")
    md.append("## Meta\n")
    md.append(f"- **Transcriber**: {backend_name}")
    md.append(f"- **Model**: {model_size}")
    md.append(f"- **Language**: {language}")
    md.append(f"- **Time**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    md.append(f"- **Segments**: {len(segments)}")
    md.append(f"- **Timestamps**: {'kept' if keep_timestamps else 'removed'}")
    md.append("- **Calibration**: uncalibrated (may contain ASR errors)\n")
    md.append("> Suggest using `text-refine` skill for calibration.\n")
    md.append("---\n")

    for seg in segments:
        if keep_timestamps:
            md.append(f"**[{format_timestamp(seg['start'])} - {format_timestamp(seg['end'])}]**\n")
        md.append(f"{seg['text']}\n")
        if keep_timestamps:
            md.append("---\n")

    return "\n".join(md)


def transcribe(
    video_path: Path,
    output_path: Optional[Path] = None,
    output_dir: Optional[Path] = None,
    model_size: str = None,
    language: str = "auto",
    output_format: str = "md",
    keep_timestamps: bool = False,
    show_progress: bool = True,
) -> Path:
    if model_size is None:
        model_size = DEFAULT_MODEL

    video_path = Path(video_path).expanduser()
    if not video_path.exists():
        raise FileNotFoundError(f"File not found: {video_path}")

    if output_path is not None:
        output_path = Path(output_path).expanduser()
        output_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        if output_dir is None:
            output_dir = video_path.parent
        else:
            output_dir = Path(output_dir).expanduser()
        output_dir.mkdir(parents=True, exist_ok=True)

    backend = get_backend()
    backend.load_model(model_size)

    reporter = ProgressReporter() if show_progress else None

    print(f"Transcribing: {video_path.name}")
    result = backend.transcribe(
        str(video_path),
        language=language,
        on_progress=reporter.update if reporter else None,
    )
    if reporter is not None:
        reporter.finish()

    detected_lang = result.get("language", "unknown")
    print(f"  Detected language: {detected_lang}")

    segments = result["segments"]

    # Apply zhconv for Chinese
    if detected_lang in ("zh", "chinese"):
        for seg in segments:
            seg["text"] = convert_to_simplified_chinese(seg["text"])

    base_name = video_path.stem
    backend_name = type(backend).__name__

    if output_path is None:
        suffix = {"srt": ".srt", "md": ".md", "json": ".json"}.get(output_format)
        if suffix is None:
            raise ValueError(f"Unknown format: {output_format}")
        output_path = output_dir / f"{base_name}{suffix}"

    if output_format == "srt":
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(segments_to_srt(segments))
    elif output_format == "md":
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(
                segments_to_md(segments, base_name, model_size, detected_lang, keep_timestamps, backend_name)
            )
    elif output_format == "json":
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    else:
        raise ValueError(f"Unknown format: {output_format}")

    print(f"  Saved: {output_path}")
    return output_path


if __name__ == "__main__":
    import argparse

    config = load_config()

    parser = argparse.ArgumentParser(
        description="Transcribe audio/video (auto-detect Mac/Windows backend)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skill_main.py video.mp4
  python skill_main.py video.mp4 --output result.srt
  python skill_main.py a.mp4 b.mp4 --format srt --output ~/subtitles
  python skill_main.py video.mp4 --model large-v3 --language zh
        """,
    )

    parser.add_argument("input", nargs="+", type=str, help="One or more video/audio file paths")
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        help="Output file (single input) or directory (multiple inputs). "
        "A .srt/.md/.json suffix also selects the format.",
    )
    parser.add_argument(
        "--model",
        "-m",
        default=config.get("model", DEFAULT_MODEL),
        help=f"Model name (default: {config.get('model', DEFAULT_MODEL)})",
    )
    parser.add_argument(
        "--language",
        "-l",
        type=str,
        default=config.get("language", "auto"),
        help="Language code (auto/zh/en/ko/ja/etc)",
    )
    parser.add_argument(
        "--format",
        "-f",
        choices=["srt", "md", "json"],
        default=None,
        help="Output format (default: md, or inferred from --output suffix)",
    )
    parser.add_argument(
        "--keep-timestamps",
        "-t",
        action="store_true",
        default=config.get("keep_timestamps", False),
        help="Keep timestamps in markdown output",
    )
    parser.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable live transcription progress lines",
    )

    args = parser.parse_args()

    # Format precedence: explicit flag > config file > --output suffix > md
    output_format = args.format
    if output_format is None and CONFIG_FILE.exists():
        output_format = config.get("output_format")
    if output_format is None and args.output and len(args.input) == 1:
        output_format = {".srt": "srt", ".md": "md", ".json": "json"}.get(
            Path(args.output).suffix.lower()
        )
    output_format = output_format or "md"

    # Check dependencies via backend
    backend = get_backend()
    if not backend.check_dependencies():
        print("\nRun this skill through run.py so it can find or install the right interpreter:")
        print(f"  python3 {Path(__file__).parent / 'run.py'} <input> ...")
        sys.exit(1)

    # --output is a file for one input and a directory for several inputs
    # (or whenever it already points at an existing directory).
    out_arg = Path(args.output).expanduser() if args.output else None
    single_output_path = None
    output_dir = None

    if out_arg is not None and len(args.input) > 1:
        if out_arg.suffix.lower() in (".srt", ".md", ".json") and not out_arg.is_dir():
            print(f"Error: --output looks like a file, but {len(args.input)} inputs were given.")
            print("Use a directory: --output ~/subtitles")
            sys.exit(1)
        output_dir = out_arg
        output_dir.mkdir(parents=True, exist_ok=True)
    elif out_arg is not None:
        if out_arg.is_dir():
            output_dir = out_arg
        else:
            single_output_path = out_arg

    print(f"\n{'=' * 60}")
    print(f"Audio Transcriber ({'Mac / MLX-Whisper' if platform.system() == 'Darwin' else 'Win / Faster-Whisper'})")
    print(f"{'=' * 60}")
    print(f"  Inputs: {len(args.input)}")
    for item in args.input:
        print(f"    - {item}")
    print(f"  Model: {args.model}")
    print(f"  Language: {args.language}")
    print(f"  Format: {output_format}")
    print(f"  Timestamps: {'Yes' if args.keep_timestamps else 'No'}")
    print(f"{'=' * 60}\n")

    failures = []
    for index, item in enumerate(args.input, 1):
        if len(args.input) > 1:
            print(f"[{index}/{len(args.input)}] {item}")
        try:
            result_path = transcribe(
                video_path=item,
                output_path=single_output_path,
                output_dir=output_dir,
                model_size=args.model,
                language=args.language,
                output_format=output_format,
                keep_timestamps=args.keep_timestamps,
                show_progress=not args.no_progress,
            )
            print(f"  Done: {result_path}")
        except Exception as e:
            failures.append((item, str(e)))
            print(f"  Error: {e}")

    print(f"\n{'=' * 60}")
    if failures:
        print(f"Finished with {len(failures)} failure(s):")
        for item, message in failures:
            print(f"  - {item}: {message}")
        sys.exit(1)
    print(f"All done! {len(args.input)} file(s) transcribed.")
    print(f"{'=' * 60}\n")
