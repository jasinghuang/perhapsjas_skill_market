#!/usr/bin/env python3
"""
Bilibili Video Downloader - 视频下载 Skill 入口
只负责视频下载，字幕功能已拆分到 whisper-transcribe 和 llm-refine skills
"""

import sys
import argparse
import json
import subprocess
import re
from pathlib import Path
from typing import List, Optional

# Default paths
DEFAULT_DOWNLOAD_DIR = Path.home() / "Downloads"
DEFAULT_COOKIE_FILE = Path.home() / "bilibili-cookies.txt"
CONFIG_FILE = Path(__file__).parent / "config.json"


def check_yt_dlp() -> bool:
    """Check if yt-dlp is installed"""
    try:
        subprocess.run(['yt-dlp', '--version'], capture_output=True)
        return True
    except FileNotFoundError:
        return False


def update_yt_dlp() -> bool:
    """Update yt-dlp to latest version"""
    print("\n🔄 检查 yt-dlp 更新...")
    try:
        result = subprocess.run(
            ['yt-dlp', '-U'],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            print(f"   {result.stdout.strip()}")
            return True
        else:
            print(f"   ⚠️ 更新检查失败: {result.stderr}")
            return False
    except Exception as e:
        print(f"   ⚠️ 更新检查失败: {e}")
        return False


def read_urls_from_file(file_path: Path) -> List[str]:
    """Read URLs from txt file"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return [line.strip() for line in f if line.strip()]


def load_config() -> dict:
    """Load configuration from config.json"""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def download_video(
    url: str,
    output_dir: Path,
    quality: str = "best",
    use_aria2: bool = False,
    quicktime: bool = False,
    cookie_file: Optional[Path] = None
) -> Optional[Path]:
    """
    下载单个视频

    Args:
        url: 视频URL
        output_dir: 输出目录
        quality: 视频质量 (best/worst)
        use_aria2: 是否使用aria2加速
        quicktime: 是否QuickTime兼容格式
        cookie_file: Cookie文件路径

    Returns:
        下载的视频文件路径，失败返回None
    """
    import subprocess
    import re

    print(f"\n📥 下载视频: {url}")

    # 构建命令
    cmd = [
        'yt-dlp',
        '--no-warnings',
        '-o', str(output_dir / '%(title)s.%(ext)s'),
    ]

    # Cookie
    if cookie_file and cookie_file.exists():
        cmd.extend(['--cookies', str(cookie_file)])

    # 质量
    if quality == "best":
        cmd.extend(['-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'])
    elif quality == "worst":
        cmd.extend(['-f', 'worst'])

    # QuickTime 兼容
    if quicktime:
        cmd.extend([
            '--format-sort', 'vcodec:h264,acodec:aac',
            '--merge-output-format', 'mp4'
        ])

    # aria2 加速
    if use_aria2:
        cmd.extend([
            '--external-downloader', 'aria2c',
            '--external-downloader-args', '-x 16 -s 16 -k 1M'
        ])

    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0:
            # 查找下载的文件
            for line in result.stderr.split('\n'):
                if '[download] Destination:' in line or '[Merger]' in line:
                    match = re.search(r'(?:Destination:|Merging into)\s*["\']?(.+?)["\']?\s*$', line)
                    if match:
                        video_path = Path(match.group(1).strip())
                        if video_path.exists():
                            print(f"✅ 下载完成: {video_path}")
                            print(f"   文件大小: {video_path.stat().st_size / 1024 / 1024:.1f} MB")
                            return video_path

            # 备用：查找最新文件
            mp4_files = list(output_dir.glob("*.mp4"))
            if mp4_files:
                video_path = max(mp4_files, key=lambda p: p.stat().st_mtime)
                print(f"✅ 下载完成: {video_path}")
                return video_path

        print(f"❌ 下载失败")
        return None

    except FileNotFoundError:
        print("❌ yt-dlp 未安装!")
        print("   安装: pip install yt-dlp")
        print("   或者: brew install yt-dlp")
        return None
    except Exception as e:
        print(f"❌ 下载失败: {e}")
        return None


def download_multiple_videos(
    urls: List[str],
    output_dir: Path,
    quality: str = "best",
    use_aria2: bool = False,
    quicktime: bool = False,
    cookie_file: Optional[Path] = None
) -> List[Path]:
    """
    批量下载视频

    Args:
        urls: 视频URL列表
        output_dir: 输出目录
        quality: 视频质量
        use_aria2: 是否使用aria2
        quicktime: 是否QuickTime格式
        cookie_file: Cookie文件路径

    Returns:
        成功下载的视频路径列表
    """
    print(f"\n{'='*60}")
    print(f"📦 批量下载 {len(urls)} 个视频")
    print(f"{'='*60}")

    downloaded = []
    failed = []

    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}] 处理: {url}")

        video_path = download_video(
            url,
            output_dir,
            quality=quality,
            use_aria2=use_aria2,
            quicktime=quicktime,
            cookie_file=cookie_file
        )

        if video_path:
            downloaded.append(video_path)
        else:
            failed.append(url)

    # 总结
    print(f"\n{'='*60}")
    print(f"📊 下载完成")
    print(f"   ✅ 成功: {len(downloaded)}/{len(urls)}")
    if failed:
        print(f"   ❌ 失败: {len(failed)}/{len(urls)}")
    print(f"📁 输出目录: {output_dir}")

    return downloaded


def main():
    """主入口"""
    config = load_config()

    parser = argparse.ArgumentParser(
        description='Bilibili 视频下载器',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 下载单个视频
  %(prog)s "https://www.bilibili.com/video/BV1xx411c7mD"

  # 批量下载
  %(prog)s --file urls.txt

  # QuickTime 兼容格式
  %(prog)s --quicktime "URL"

  # 使用 aria2 加速
  %(prog)s --aria2 "URL"
        """
    )

    parser.add_argument('urls', nargs='*', help='视频URL（支持多个）')
    parser.add_argument('--file', '-f', help='从文件读取URL列表（txt或xlsx）')
    parser.add_argument('--cookies', '-c', help='Cookie文件路径')
    parser.add_argument('--output', '-o',
                       default=config.get('download', {}).get('output_dir', str(DEFAULT_DOWNLOAD_DIR)),
                       help='输出目录（默认: ~/Downloads）')
    parser.add_argument('--aria2', action='store_true',
                       help='使用aria2加速下载')
    parser.add_argument('--quality', '-q', choices=['best', 'worst'],
                       default=config.get('download', {}).get('quality', 'best'),
                       help='视频质量（默认: best）')
    parser.add_argument('--quicktime', action='store_true',
                       help='QuickTime兼容格式（H.264 + AAC）')

    args = parser.parse_args()

    # 检查 yt-dlp
    if not check_yt_dlp():
        print("❌ yt-dlp 未安装!")
        print("   安装: pip install yt-dlp")
        print("   或者: brew install yt-dlp")
        sys.exit(1)

    # 自动检查更新
    update_yt_dlp()

    # 收集 URLs
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

    # 准备输出目录
    output_dir = Path(args.output).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    # Cookie 文件
    cookie_file = None
    if args.cookies:
        cookie_file = Path(args.cookies).expanduser()
    elif DEFAULT_COOKIE_FILE.exists():
        cookie_file = DEFAULT_COOKIE_FILE

    # 显示配置
    print(f"\n{'='*60}")
    print(f"🎬 Bilibili 视频下载器")
    print(f"{'='*60}")
    print(f"📁 输出目录: {output_dir}")
    print(f"🎞️  质量: {args.quality}")
    print(f"📦 视频数量: {len(urls)}")
    if args.aria2:
        print(f"⚡ 加速: aria2")
    if args.quicktime:
        print(f"🎬 格式: QuickTime")
    if cookie_file:
        print(f"🍪 Cookie: {cookie_file}")

    # 批量下载
    download_multiple_videos(
        urls,
        output_dir,
        quality=args.quality,
        use_aria2=args.aria2,
        quicktime=args.quicktime,
        cookie_file=cookie_file
    )

    print(f"\n✅ 全部完成!")


if __name__ == '__main__':
    main()