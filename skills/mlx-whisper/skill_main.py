#!/usr/bin/env python3
"""
MLX Whisper Transcriber
Audio/video transcription using MLX-Whisper (Apple Silicon native)
"""

import json
import sys
from pathlib import Path
from typing import List, Dict, Optional

CONFIG_FILE = Path(__file__).parent / "config.json"

MODEL_REPOS = {
    "base": "mlx-community/whisper-base",
    "small": "mlx-community/whisper-small",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "large-v3": "mlx-community/whisper-large-v3",
    "large-v2": "mlx-community/whisper-large-v2",
}

MODEL_INFO = [
    ("base", "74M", "很快", "一般", "快速试用，先看效果"),
    ("small", "244M", "快", "良好", "快速预览"),
    ("large-v3-turbo", "809M", "较快", "优秀", "【推荐】速度与质量平衡"),
    ("large-v3", "1550M", "慢", "最佳", "最高准确率"),
    ("large-v2", "1550M", "慢", "很好", "备用"),
]


def ensure_config() -> dict:
    """首次运行时引导用户选择模型，保存到 config.json"""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass

    print("\n首次使用，请选择 Whisper 模型：\n")
    for i, (name, size, speed, quality, note) in enumerate(MODEL_INFO, 1):
        print(f"  {i}. {name} ({size}) - {speed}/{quality} - {note}")

    print()
    choice = input("请输入编号 [3]: ").strip()
    if not choice:
        idx = 2
    else:
        try:
            idx = int(choice) - 1
            idx = max(0, min(idx, len(MODEL_INFO) - 1))
        except ValueError:
            idx = 2

    selected = MODEL_INFO[idx][0]
    config = {
        "model": selected,
        "language": "auto",
        "output_format": "md",
        "keep_timestamps": False
    }
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"\n✅ 已保存模型设置: {selected}")
    return config


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "model": "large-v3-turbo",
        "language": "auto",
        "output_format": "md",
        "keep_timestamps": False
    }


def check_mlx_whisper() -> bool:
    try:
        import mlx_whisper
        return True
    except ImportError:
        print("❌ mlx-whisper 未安装。安装: pip install mlx-whisper")
        return False


def check_ffmpeg() -> bool:
    import subprocess
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True)
        return True
    except FileNotFoundError:
        print("❌ ffmpeg 未安装。安装: brew install ffmpeg")
        return False


def convert_to_simplified_chinese(text: str) -> str:
    try:
        import zhconv
        return zhconv.convert(text, 'zh-cn')
    except ImportError:
        return text


def extract_subtitles(
    video_path: Path,
    model_name: str = "large-v3-turbo",
    language: str = "auto"
) -> Dict:
    import mlx_whisper

    repo = MODEL_REPOS.get(model_name, MODEL_REPOS["large-v3-turbo"])
    print(f"🎙️  Loading MLX-Whisper model ({model_name})...")
    print(f"   Repo: {repo}")

    print(f"📝 Transcribing: {video_path.name}")
    print(f"   This may take a while...")

    whisper_language = None if language == "auto" else language

    result = mlx_whisper.transcribe(
        str(video_path),
        path_or_hf_repo=repo,
        language=whisper_language,
        verbose=False
    )

    detected_lang = result.get("language", "unknown")
    print(f"   ✅ Detected language: {detected_lang}")

    segments = []
    for segment in result['segments']:
        text = segment['text'].strip()
        if detected_lang in ['zh', 'chinese']:
            text = convert_to_simplified_chinese(text)
        if text:
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
        lines.append(seg['text'])
        lines.append("")
    return "\n".join(lines)


def segments_to_md(segments: List[Dict], title: str, model_size: str, language: str, keep_timestamps: bool) -> str:
    from datetime import datetime

    md = [f"# {title}\n"]
    md.append("---\n")
    md.append("## 元信息\n")
    md.append("- **转录工具**: MLX-Whisper")
    md.append(f"- **模型大小**: {model_size}")
    md.append(f"- **语言**: {language}")
    md.append(f"- **转录时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    md.append(f"- **段落数量**: {len(segments)}")
    md.append(f"- **时间码**: {'保留' if keep_timestamps else '已移除'}")
    md.append("- **校准状态**: ⚠️ 未经过 LLM 校准（可能有错别字、同音字错误）\n")
    md.append("> 💡 建议使用 `text-refine` skill 进行校准\n")
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
    model_size: str = "large-v3-turbo",
    language: str = "auto",
    output_format: str = "md",
    keep_timestamps: bool = False
) -> Path:
    video_path = Path(video_path).expanduser()
    if not video_path.exists():
        raise FileNotFoundError(f"文件不存在: {video_path}")

    if output_dir is None:
        output_dir = video_path.parent
    else:
        output_dir = Path(output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    result = extract_subtitles(video_path, model_size, language)
    segments = result['segments']
    detected_lang = result['language']

    base_name = video_path.stem

    if output_format == "srt":
        output_path = output_dir / f"{base_name}.srt"
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(segments_to_srt(segments))
    elif output_format == "md":
        output_path = output_dir / f"{base_name}.md"
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(segments_to_md(segments, base_name, model_size, language, keep_timestamps))
    elif output_format == "json":
        output_path = output_dir / f"{base_name}.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    else:
        raise ValueError(f"未知格式: {output_format}")

    print(f"   ✅ Saved: {output_path}")
    return output_path


if __name__ == "__main__":
    import argparse

    config = ensure_config()

    parser = argparse.ArgumentParser(
        description='Transcribe audio/video using MLX-Whisper',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skill_main.py video.mp4
  python skill_main.py audio.mp3 --output result.srt
  python skill_main.py video.mp4 --model large-v3 --language zh
  python skill_main.py video.mp4 --format srt
        """
    )

    parser.add_argument('input', type=str, help='Video or audio file path')
    parser.add_argument('--output', '-o', type=str, help='Output file path')
    parser.add_argument('--model', '-m',
                        choices=list(MODEL_REPOS.keys()),
                        default=config.get('model', 'large-v3-turbo'),
                        help=f"Model (default: {config.get('model', 'large-v3-turbo')})")
    parser.add_argument('--language', '-l', type=str, default=config.get('language', 'auto'),
                        help='Language code (auto/zh/en/ko/ja/etc)')
    parser.add_argument('--format', '-f', choices=['srt', 'md', 'json'],
                        default=config.get('output_format', 'md'),
                        help='Output format (default: md)')
    parser.add_argument('--keep-timestamps', '-t', action='store_true',
                        default=config.get('keep_timestamps', False),
                        help='Keep timestamps in markdown output')

    args = parser.parse_args()

    if not check_mlx_whisper():
        sys.exit(1)
    if not check_ffmpeg():
        sys.exit(1)

    output_dir = Path(args.output).parent if args.output else Path(args.input).expanduser().parent

    print(f"\n{'='*60}")
    print(f"🎬 MLX Whisper Transcriber")
    print(f"{'='*60}")
    print(f"   📁 Input: {args.input}")
    print(f"   🎙️  Model: {args.model}")
    print(f"   🌐 Language: {args.language}")
    print(f"   📄 Format: {args.format}")
    print(f"   ⏱️  Timestamps: {'Yes' if args.keep_timestamps else 'No'}")
    print(f"{'='*60}\n")

    try:
        output_path = transcribe(
            video_path=args.input,
            output_dir=output_dir,
            model_size=args.model,
            language=args.language,
            output_format=args.format,
            keep_timestamps=args.keep_timestamps
        )
        print(f"\n{'='*60}")
        print(f"✅ Done! Output: {output_path}")
        print(f"{'='*60}\n")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
