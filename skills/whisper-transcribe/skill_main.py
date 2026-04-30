#!/usr/bin/env python3
"""
Whisper Transcriber Module
Handles audio transcription using OpenAI Whisper
"""

import json
import sys
from pathlib import Path
from typing import List, Dict, Optional

# Config file path
CONFIG_FILE = Path(__file__).parent / "config.json"


def load_config() -> dict:
    """Load configuration from config.json"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {
        "model_size": "medium",
        "language": "auto",
        "output_format": "md",
        "output_dir": "~/Downloads",
        "keep_timestamps": False
    }


def check_whisper() -> bool:
    """Check if whisper is installed"""
    try:
        import whisper
        return True
    except ImportError:
        print("❌ Whisper not installed. Install with: pip install openai-whisper")
        return False


def check_ffmpeg() -> bool:
    """Check if ffmpeg is installed"""
    import subprocess
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True)
        return True
    except FileNotFoundError:
        print("❌ ffmpeg not installed. Install with: brew install ffmpeg")
        return False


def verify_detected_language(result: Dict, language: str = "auto") -> str:
    """
    Verify that Whisper detected the expected language
    Returns the detected language code
    """
    detected = result.get("language", "unknown")
    if language == "auto":
        return detected
    else:
        if detected != language:
            print(f"   ⚠️  Warning: Specified language '{language}' doesn't match detected '{detected}'")
        return language


def convert_to_simplified_chinese(text: str) -> str:
    """
    Convert Traditional Chinese to Simplified Chinese
    """
    try:
        import zhconv
        return zhconv.convert(text, 'zh-cn')
    except ImportError:
        # Fallback: try opencc
        try:
            import opencc
            converter = opencc.OpenCC('t2s')
            return converter.convert(text)
        except ImportError:
            print("   ⚠️  zhconv not installed, skipping traditional->simplified conversion")
            print("   💡 Install with: pip install zhconv")
            return text


def extract_subtitles(
    video_path: Path,
    model_size: str = "medium",
    language: str = "auto"
) -> Dict:
    """
    Extract subtitles from video using Whisper

    Args:
        video_path: Path to video file
        model_size: Whisper model size (tiny/base/small/medium/large)
        language: Language code (auto/zh/en/ko/ja/etc)

    Returns:
        Dict with 'segments' and 'language' keys
    """
    import whisper

    print(f"🎙️  Loading Whisper model ({model_size})...")
    model = whisper.load_model(model_size)

    print(f"📝 Transcribing: {video_path.name}")
    print(f"   This may take a while...")

    # Convert 'auto' to None for Whisper's auto-detection
    whisper_language = None if language == "auto" else language

    result = model.transcribe(
        str(video_path),
        language=whisper_language,
        verbose=False
    )

    # Verify detected language
    detected_lang = verify_detected_language(result, language)
    print(f"   ✅ Detected language: {detected_lang}")

    # Extract segments
    segments = []
    for segment in result['segments']:
        text = segment['text'].strip()
        # Convert traditional Chinese to simplified Chinese if detected language is Chinese
        if detected_lang in ['zh', 'chinese']:
            text = convert_to_simplified_chinese(text)
        segments.append({
            'start': segment['start'],
            'end': segment['end'],
            'text': text
        })

    return {
        'segments': segments,
        'language': detected_lang
    }


def format_timestamp(seconds: float) -> str:
    """Format seconds to SRT timestamp format (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    milliseconds = int((secs - int(secs)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{milliseconds:03d}"


def segments_to_srt(segments: List[Dict]) -> str:
    """
    Convert Whisper segments to SRT format

    Args:
        segments: List of segment dictionaries

    Returns:
        SRT formatted string
    """
    srt_content = []

    for i, seg in enumerate(segments, 1):
        start_time = format_timestamp(seg['start'])
        end_time = format_timestamp(seg['end'])

        srt_content.append(f"{i}")
        srt_content.append(f"{start_time} --> {end_time}")
        srt_content.append(seg['text'])
        srt_content.append("")  # Empty line

    return "\n".join(srt_content)


def segments_to_md(segments: List[Dict], title: str = "Transcript", model_size: str = "medium", language: str = "auto", keep_timestamps: bool = False) -> str:
    """
    Convert Whisper segments to Markdown format

    Args:
        segments: List of segment dictionaries
        title: Title for the document
        model_size: Whisper model size used
        language: Language code used
        keep_timestamps: Whether to include timestamps in output

    Returns:
        Markdown formatted string
    """
    from datetime import datetime

    md_content = [f"# {title}\n"]
    md_content.append("---\n")
    md_content.append("## 元信息\n")
    md_content.append(f"- **转录工具**: OpenAI Whisper")
    md_content.append(f"- **模型大小**: {model_size}")
    md_content.append(f"- **语言**: {language}")
    md_content.append(f"- **转录时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    md_content.append(f"- **段落数量**: {len(segments)}")
    md_content.append(f"- **时间码**: {'保留' if keep_timestamps else '已移除'}")
    md_content.append(f"- **校准状态**: ⚠️ 未经过 LLM 校准（可能有错别字、同音字错误）\n")
    md_content.append("> 💡 建议使用 `llm-refine` skill 进行校准\n")
    md_content.append("---\n")

    for seg in segments:
        if keep_timestamps:
            start_time = format_timestamp(seg['start'])
            end_time = format_timestamp(seg['end'])
            md_content.append(f"**[{start_time} - {end_time}]**\n")

        md_content.append(f"{seg['text']}\n")

        if keep_timestamps:
            md_content.append("---\n")

    return "\n".join(md_content)


def save_srt(srt_content: str, output_path: Path) -> None:
    """Save SRT subtitles to file"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(srt_content)
    print(f"   ✅ SRT saved: {output_path}")


def save_md(md_content: str, output_path: Path) -> None:
    """Save Markdown transcript to file"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(md_content)
    print(f"   ✅ Markdown saved: {output_path}")


def save_json(result: Dict, output_path: Path) -> None:
    """Save transcription result as JSON"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"   ✅ JSON saved: {output_path}")


def transcribe(
    video_path: Path,
    output_dir: Optional[Path] = None,
    model_size: str = "medium",
    language: str = "auto",
    output_format: str = "md",
    keep_timestamps: bool = False
) -> Path:
    """
    Main transcription function

    Args:
        video_path: Path to video/audio file
        output_dir: Output directory (default: same as video)
        model_size: Whisper model size
        language: Language code (auto for detection)
        output_format: Output format (srt, md, json)
        keep_timestamps: Whether to include timestamps in markdown output

    Returns:
        Path to output file
    """
    video_path = Path(video_path).expanduser()

    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")

    # Set output directory
    if output_dir is None:
        output_dir = video_path.parent
    else:
        output_dir = Path(output_dir).expanduser()

    output_dir.mkdir(parents=True, exist_ok=True)

    # Extract subtitles
    result = extract_subtitles(video_path, model_size, language)
    segments = result['segments']
    detected_lang = result['language']

    # Generate output filename
    base_name = video_path.stem

    # Save in requested format
    if output_format == "srt":
        output_path = output_dir / f"{base_name}.srt"
        srt_content = segments_to_srt(segments)
        save_srt(srt_content, output_path)
    elif output_format == "md":
        output_path = output_dir / f"{base_name}.md"
        md_content = segments_to_md(segments, base_name, model_size, language, keep_timestamps)
        save_md(md_content, output_path)
    elif output_format == "json":
        output_path = output_dir / f"{base_name}.json"
        save_json(result, output_path)
    else:
        raise ValueError(f"Unknown output format: {output_format}")

    return output_path


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description='Transcribe video/audio to subtitles using Whisper',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skill_main.py video.mp4
  python skill_main.py audio.mp3 --output result.srt
  python skill_main.py video.mp4 --model large --language zh
  python skill_main.py video.mp4 --format md
        """
    )

    parser.add_argument('input', type=str, help='Video or audio file path')
    parser.add_argument('--output', '-o', type=str, help='Output file path')
    parser.add_argument('--model', '-m', choices=['tiny', 'base', 'small', 'medium', 'large'],
                       default='medium', help='Whisper model size (default: medium)')
    parser.add_argument('--language', '-l', type=str, default='auto',
                       help='Language code (auto/zh/en/ko/ja/etc)')
    parser.add_argument('--format', '-f', choices=['srt', 'md', 'json'], default='md',
                       help='Output format (default: md)')
    parser.add_argument('--keep-timestamps', '-t', action='store_true',
                       help='Keep timestamps in markdown output (default: False)')

    args = parser.parse_args()

    # Check dependencies
    if not check_whisper():
        sys.exit(1)
    if not check_ffmpeg():
        sys.exit(1)

    # Load config for defaults
    config = load_config()
    model_size = args.model or config.get('model_size', 'medium')
    language = args.language or config.get('language', 'auto')
    output_format = args.format or config.get('output_format', 'md')
    keep_timestamps = args.keep_timestamps or config.get('keep_timestamps', False)
    # Default output to same directory as video file (ignore config output_dir)
    output_dir = Path(args.output).parent if args.output else Path(args.input).expanduser().parent

    print(f"\n{'='*60}")
    print(f"🎬 Whisper Transcriber")
    print(f"{'='*60}")
    print(f"   📁 Input: {args.input}")
    print(f"   🎙️  Model: {model_size}")
    print(f"   🌐 Language: {language}")
    print(f"   📄 Format: {output_format}")
    print(f"   ⏱️  Timestamps: {'Yes' if keep_timestamps else 'No'}")
    print(f"{'='*60}\n")

    try:
        output_path = transcribe(
            video_path=args.input,
            output_dir=output_dir,
            model_size=model_size,
            language=language,
            output_format=output_format,
            keep_timestamps=keep_timestamps
        )

        print(f"\n{'='*60}")
        print(f"✅ Done! Output: {output_path}")
        print(f"{'='*60}\n")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)