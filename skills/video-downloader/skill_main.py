#!/usr/bin/env python3
"""
Video Downloader - 视频下载 Skill 入口
支持 Bilibili、YouTube 等平台，使用 yt-dlp 下载
"""

import sys
import argparse
import json
import subprocess
from pathlib import Path
from typing import List, Optional

DEFAULT_DOWNLOAD_DIR = Path.home() / "Downloads"
DEFAULT_COOKIE_FILE = Path.home() / "video-cookies.txt"
CONFIG_FILE = Path(__file__).parent / "config.json"

QUALITY_FORMATS = {
    "best": "bestvideo+bestaudio/best",
    "high": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "medium": "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "low": "worstvideo[height<=480]+worstaudio/worst[height<=480]",
    "audio-only": "bestaudio/best",
}


def check_yt_dlp() -> bool:
    try:
        subprocess.run(['yt-dlp', '--version'], capture_output=True)
        return True
    except FileNotFoundError:
        return False


def update_yt_dlp() -> bool:
    print("\n🔄 检查 yt-dlp 更新...")
    try:
        result = subprocess.run(['yt-dlp', '-U'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"   {result.stdout.strip()}")
            return True
        print(f"   ⚠️ 更新检查失败: {result.stderr}")
        return False
    except Exception as e:
        print(f"   ⚠️ 更新检查失败: {e}")
        return False


def read_urls_from_file(file_path: Path) -> List[str]:
    with open(file_path, 'r', encoding='utf-8') as f:
        return [line.strip() for line in f if line.strip()]


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def build_format_string(quality: str, resolution: Optional[int], codec: str, custom_format: Optional[str], audio_only: bool) -> List[str]:
    """Build yt-dlp format arguments based on parameters."""
    args = []

    if custom_format:
        args.extend(['-f', custom_format])
        return args

    if audio_only:
        args.extend(['-f', QUALITY_FORMATS['audio-only']])
        args.extend(['--extract-audio', '--audio-format', 'm4a'])
        return args

    if resolution:
        fmt = f"bestvideo[height<={resolution}]+bestaudio/best[height<={resolution}]"
        args.extend(['-f', fmt])
    else:
        fmt = QUALITY_FORMATS.get(quality, QUALITY_FORMATS['best'])
        args.extend(['-f', fmt])

    args.extend(['--format-sort', f'vcodec:{codec},acodec:aac'])
    args.extend(['--merge-output-format', 'mp4'])

    return args


def download_video(
    url: str,
    output_dir: Path,
    quality: str = "best",
    resolution: Optional[int] = None,
    codec: str = "h264",
    custom_format: Optional[str] = None,
    audio_only: bool = False,
    use_aria2: bool = False,
    cookie_file: Optional[Path] = None
) -> Optional[Path]:
    print(f"\n📥 下载视频: {url}")

    cmd = [
        'yt-dlp',
        '--no-warnings',
        '-o', str(output_dir / '%(title)s.%(ext)s'),
    ]

    if cookie_file and cookie_file.exists():
        cmd.extend(['--cookies', str(cookie_file)])

    cmd.extend(build_format_string(quality, resolution, codec, custom_format, audio_only))

    if use_aria2:
        cmd.extend([
            '--external-downloader', 'aria2c',
            '--external-downloader-args', '-x 16 -s 16 -k 1M'
        ])

    cmd.append(url)

    before = set(output_dir.iterdir())

    try:
        result = subprocess.run(cmd, text=True)

        if result.returncode == 0:
            after = set(output_dir.iterdir())
            new_files = after - before
            if new_files:
                video_path = max(new_files, key=lambda p: p.stat().st_mtime)
                size_mb = video_path.stat().st_size / 1024 / 1024
                print(f"\n✅ 下载完成: {video_path.name}")
                print(f"   文件大小: {size_mb:.1f} MB")
                return video_path

        print(f"\n❌ 下载失败")
        print(f"   💡 如遇 YouTube 403 错误，请尝试：")
        print(f"      导出浏览器 Cookie 到 ~/video-cookies.txt 后重试")
        print(f"      或升级 yt-dlp: python3 -m pip install -U 'yt-dlp[default]'")
        return None

    except FileNotFoundError:
        print("❌ yt-dlp 未安装!")
        print("   安装: python3 -m pip install -U 'yt-dlp[default]'")
        print("   或者: brew install yt-dlp")
        return None
    except Exception as e:
        print(f"❌ 下载失败: {e}")
        return None


def main():
    config = load_config()
    dl_config = config.get('download', {})

    parser = argparse.ArgumentParser(
        description='Video Downloader',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  %(prog)s "https://www.bilibili.com/video/BV1xx411c7mD"
  %(prog)s "https://youtube.com/watch?v=xxx"
  %(prog)s --file urls.txt
  %(prog)s --quality high "URL"
  %(prog)s --audio-only "URL"
  %(prog)s --resolution 720 "URL"
  %(prog)s --aria2 "URL"
        """
    )

    parser.add_argument('urls', nargs='*', help='视频URL（支持多个）')
    parser.add_argument('--file', '-f', help='从文件读取URL列表')
    parser.add_argument('--cookies', '-c', help='Cookie文件路径')
    parser.add_argument('--output', '-o',
                        default=dl_config.get('output_dir', str(DEFAULT_DOWNLOAD_DIR)),
                        help='输出目录（默认: ~/Downloads）')
    parser.add_argument('--quality', '-q',
                        choices=['best', 'high', 'medium', 'low', 'audio-only'],
                        default=dl_config.get('quality', 'best'),
                        help='画质预设（默认: best）')
    parser.add_argument('--resolution', '-r', type=int,
                        help='指定分辨率（720/1080/2160）')
    parser.add_argument('--codec',
                        choices=['h264', 'h265', 'vp9', 'av1'],
                        default=dl_config.get('codec', 'h264'),
                        help='视频编码（默认: h264）')
    parser.add_argument('--audio-only', action='store_true',
                        help='只下载音频')
    parser.add_argument('--format', help='直接传 yt-dlp format string')
    parser.add_argument('--aria2', action='store_true',
                        help='使用aria2加速下载')

    args = parser.parse_args()

    if not check_yt_dlp():
        print("❌ yt-dlp 未安装!")
        print("   安装: python3 -m pip install -U 'yt-dlp[default]'")
        print("   或者: brew install yt-dlp")
        sys.exit(1)

    urls = args.urls or []
    if args.file:
        file_path = Path(args.file).expanduser()
        if file_path.exists():
            urls.extend(read_urls_from_file(file_path))
        else:
            print(f"❌ 文件不存在: {file_path}")
            sys.exit(1)

    if not urls:
        parser.print_help()
        print("\n❌ 没有提供URL!")
        sys.exit(1)

    output_dir = Path(args.output).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    cookie_file = None
    if args.cookies:
        cookie_file = Path(args.cookies).expanduser()
    elif DEFAULT_COOKIE_FILE.exists():
        cookie_file = DEFAULT_COOKIE_FILE

    audio_only = args.audio_only or args.quality == 'audio-only'

    print(f"\n{'='*60}")
    print(f"🎬 Video Downloader")
    print(f"{'='*60}")
    print(f"📁 输出目录: {output_dir}")
    print(f"🎞️  质量: {args.quality}")
    print(f"📦 视频数量: {len(urls)}")
    if args.resolution:
        print(f"📐 分辨率: {args.resolution}p")
    print(f"🎥 编码: {args.codec}")
    if audio_only:
        print(f"🔊 仅音频")
    if args.aria2:
        print(f"⚡ 加速: aria2")
    if cookie_file:
        print(f"🍪 Cookie: {cookie_file}")

    downloaded = []
    failed = []

    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] 处理: {url}")
        path = download_video(
            url, output_dir,
            quality=args.quality,
            resolution=args.resolution,
            codec=args.codec,
            custom_format=args.format,
            audio_only=audio_only,
            use_aria2=args.aria2,
            cookie_file=cookie_file
        )
        if path:
            downloaded.append(path)
        else:
            failed.append(url)

    print(f"\n{'='*60}")
    print(f"📊 下载完成")
    print(f"   ✅ 成功: {len(downloaded)}/{len(urls)}")
    if failed:
        print(f"   ❌ 失败: {len(failed)}/{len(urls)}")
    print(f"📁 输出目录: {output_dir}")


if __name__ == '__main__':
    main()
