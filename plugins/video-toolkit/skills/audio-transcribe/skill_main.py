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
    output_dir: Optional[Path] = None,
    model_size: str = None,
    language: str = "auto",
    output_format: str = "md",
    keep_timestamps: bool = False,
) -> Path:
    if model_size is None:
        model_size = DEFAULT_MODEL

    video_path = Path(video_path).expanduser()
    if not video_path.exists():
        raise FileNotFoundError(f"File not found: {video_path}")

    if output_dir is None:
        output_dir = video_path.parent
    else:
        output_dir = Path(output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    backend = get_backend()
    backend.load_model(model_size)

    print(f"Transcribing: {video_path.name}")
    result = backend.transcribe(str(video_path), language=language)

    segments = result["segments"]
    detected_lang = result["language"]

    # Apply zhconv for Chinese
    if detected_lang in ("zh", "chinese"):
        for seg in segments:
            seg["text"] = convert_to_simplified_chinese(seg["text"])

    base_name = video_path.stem
    backend_name = type(backend).__name__

    if output_format == "srt":
        output_path = output_dir / f"{base_name}.srt"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(segments_to_srt(segments))
    elif output_format == "md":
        output_path = output_dir / f"{base_name}.md"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(
                segments_to_md(segments, base_name, model_size, language, keep_timestamps, backend_name)
            )
    elif output_format == "json":
        output_path = output_dir / f"{base_name}.json"
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
  python skill_main.py audio.mp3 --output result.srt
  python skill_main.py video.mp4 --model large-v3 --language zh
  python skill_main.py video.mp4 --format srt
        """,
    )

    parser.add_argument("input", type=str, help="Video or audio file path")
    parser.add_argument("--output", "-o", type=str, help="Output file path")
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
        default=config.get("output_format", "md"),
        help="Output format (default: md)",
    )
    parser.add_argument(
        "--keep-timestamps",
        "-t",
        action="store_true",
        default=config.get("keep_timestamps", False),
        help="Keep timestamps in markdown output",
    )

    args = parser.parse_args()

    # Check dependencies via backend
    backend = get_backend()
    if not backend.check_dependencies():
        sys.exit(1)

    output_dir = Path(args.output).parent if args.output else Path(args.input).expanduser().parent

    print(f"\n{'=' * 60}")
    print(f"Audio Transcriber ({'Mac / MLX-Whisper' if platform.system() == 'Darwin' else 'Win / Faster-Whisper'})")
    print(f"{'=' * 60}")
    print(f"  Input: {args.input}")
    print(f"  Model: {args.model}")
    print(f"  Language: {args.language}")
    print(f"  Format: {args.format}")
    print(f"  Timestamps: {'Yes' if args.keep_timestamps else 'No'}")
    print(f"{'=' * 60}\n")

    try:
        output_path = transcribe(
            video_path=args.input,
            output_dir=output_dir,
            model_size=args.model,
            language=args.language,
            output_format=args.format,
            keep_timestamps=args.keep_timestamps,
        )
        print(f"\n{'=' * 60}")
        print(f"Done! Output: {output_path}")
        print(f"{'=' * 60}\n")
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)
