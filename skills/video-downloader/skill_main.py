#!/usr/bin/env python3
"""
Video Downloader - 视频下载 Skill 入口
支持 Bilibili、YouTube 等平台，使用 yt-dlp Python API 下载
"""

import sys
import os
import argparse
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

DEFAULT_DOWNLOAD_DIR = Path.home() / "Downloads"
DEFAULT_COOKIE_FILE = Path.home() / "video-cookies.txt"

QUALITY_FORMATS = {
    "best": "bv*+ba/b",
    "high": "bv*[height<=1080]+ba/b[height<=1080]",
    "medium": "bv*[height<=720]+ba/b[height<=720]",
    "low": "bv*[height<=480]+ba/b[height<=480]",
    "audio-only": "ba/b",
}


def ensure_yt_dlp() -> bool:
    try:
        import yt_dlp
        return True
    except ImportError:
        pass

    print("📦 正在安装 yt-dlp...")
    try:
        subprocess.check_call([
            sys.executable, '-m', 'pip', 'install', '-U', 'yt-dlp[default]'
        ])
        return True
    except subprocess.CalledProcessError:
        try:
            subprocess.check_call([
                sys.executable, '-m', 'pip', 'install', '-U',
                '--break-system-packages', 'yt-dlp[default]'
            ])
            return True
        except subprocess.CalledProcessError:
            print("❌ 自动安装失败，请手动运行:")
            print(f'  {sys.executable} -m pip install -U "yt-dlp[default]"')
            return False


def detect_js_runtimes() -> List[str]:
    runtimes = []
    for rt in ['deno', 'node']:
        if shutil.which(rt):
            runtimes.append(rt)
    if not runtimes:
        print("⚠ 未检测到 JS runtime (deno/node)")
        print("  YouTube 等站点可能下载失败")
        print("  请安装 Node.js ≥20 或 Deno")
    return runtimes


def read_urls_from_file(file_path: Path) -> List[str]:
    with open(file_path, 'r', encoding='utf-8') as f:
        return [line.strip() for line in f if line.strip()]


def build_format_string(quality: str, resolution: Optional[int], codec: str,
                        custom_format: Optional[str], audio_only: bool) -> str:
    if custom_format:
        return custom_format

    if audio_only or quality == 'audio-only':
        return QUALITY_FORMATS['audio-only']

    if resolution:
        return f"bv*[height<={resolution}][vcodec^={codec}]+ba/b[height<={resolution}]"

    return QUALITY_FORMATS.get(quality, QUALITY_FORMATS['best'])


def build_opts(output_dir: Path, quality: str, resolution: Optional[int],
               codec: str, custom_format: Optional[str], audio_only: bool,
               cookie_file: Optional[Path], use_aria2: bool,
               runtimes: List[str]) -> dict:
    opts = {
        'outtmpl': str(output_dir / '%(title)s [%(id)s].%(ext)s'),
        'no_warnings': True,
    }

    fmt = build_format_string(quality, resolution, codec, custom_format, audio_only)
    opts['format'] = fmt

    if audio_only or quality == 'audio-only':
        opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'm4a',
        }]
    else:
        opts['merge_output_format'] = 'mp4'

    if cookie_file and cookie_file.exists():
        opts['cookiefile'] = str(cookie_file)

    if use_aria2:
        opts['external_downloader'] = 'aria2c'
        opts['external_downloader_args'] = {'aria2c': ['-x', '16', '-s', '16', '-k', '1M']}

    if runtimes:
        opts['js_runtimes'] = runtimes

    return opts


def download_videos(urls: List[str], opts: dict) -> int:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    try:
        with YoutubeDL(opts) as ydl:
            ret = ydl.download(urls)
            return ret
    except DownloadError as e:
        print(f"❌ 下载失败: {e}")
        return 1


def parse_args():
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
                        default=str(DEFAULT_DOWNLOAD_DIR),
                        help='输出目录（默认: ~/Downloads）')
    parser.add_argument('--quality', '-q',
                        choices=['best', 'high', 'medium', 'low', 'audio-only'],
                        default='best',
                        help='画质预设（默认: best）')
    parser.add_argument('--resolution', '-r', type=int,
                        help='指定分辨率（720/1080/2160）')
    parser.add_argument('--codec',
                        choices=['h264', 'h265', 'vp9', 'av1'],
                        default='h264',
                        help='视频编码（默认: h264）')
    parser.add_argument('--audio-only', action='store_true',
                        help='只下载音频')
    parser.add_argument('--format', help='直接传 yt-dlp format string')
    parser.add_argument('--aria2', action='store_true',
                        help='使用aria2加速下载')

    return parser.parse_args()


def main():
    if not ensure_yt_dlp():
        sys.exit(1)

    runtimes = detect_js_runtimes()

    args = parse_args()

    urls = args.urls or []
    if args.file:
        file_path = Path(args.file).expanduser()
        if file_path.exists():
            urls.extend(read_urls_from_file(file_path))
        else:
            print(f"❌ 文件不存在: {file_path}")
            sys.exit(1)

    if not urls:
        print("❌ 没有提供URL!")
        sys.exit(1)

    output_dir = Path(args.output).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    cookie_file = None
    if args.cookies:
        cookie_file = Path(args.cookies).expanduser()
    elif DEFAULT_COOKIE_FILE.exists():
        cookie_file = DEFAULT_COOKIE_FILE

    audio_only = args.audio_only or args.quality == 'audio-only'

    opts = build_opts(
        output_dir=output_dir,
        quality=args.quality,
        resolution=args.resolution,
        codec=args.codec,
        custom_format=args.format,
        audio_only=audio_only,
        cookie_file=cookie_file,
        use_aria2=args.aria2,
        runtimes=runtimes,
    )

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
    if runtimes:
        print(f"🔧 JS Runtime: {', '.join(runtimes)}")

    ret = download_videos(urls, opts)

    if ret == 0:
        print(f"\n✅ 全部下载完成")
        print(f"📁 输出目录: {output_dir}")
    else:
        print(f"\n❌ 部分视频下载失败 (错误码: {ret})")
        print(f"   💡 提示：")
        print(f"      - YouTube 403 错误：确保已安装 Node.js ≥20 或 Deno")
        print(f'      - 尝试: {sys.executable} -m pip install -U "yt-dlp[default]"')

    sys.exit(ret)


if __name__ == '__main__':
    main()
