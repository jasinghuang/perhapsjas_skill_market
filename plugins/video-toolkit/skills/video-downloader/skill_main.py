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

try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    pass

DEFAULT_DOWNLOAD_DIR = Path.home() / "Downloads"
DEFAULT_COOKIE_FILE = Path.home() / "video-cookies.txt"

QUALITY_FORMATS = {
    # 合并流优先：b 是单文件（视频+音频已封装）。站点没有合并流时才回退分离流。
    "best": "b/bv*+ba",
    "high": "b[height<=1080]/bv*[height<=1080]+ba",
    "medium": "b[height<=720]/bv*[height<=720]+ba",
    "low": "b[height<=480]/bv*[height<=480]+ba",
    "audio-only": "ba/b",
}

# yt-dlp 的 vcodec 值是 avc1 / hev1|hvc1 / vp0?9 / av01；
# format_sort 原生支持 h264/h265/vp9/av1 别名，因此编码只作为
# 同分辨率下的排序偏好，不做硬过滤（避免为了编码牺牲分辨率）。

# yt-dlp 发版频繁，每次运行都在独立 venv 内自动更新。
YT_DLP_PIP_TIMEOUT = 10


def _venv_dir() -> Path:
    if sys.platform == 'win32':
        base = Path(os.environ.get('LOCALAPPDATA') or (Path.home() / 'AppData' / 'Local'))
    else:
        base = Path(os.environ.get('XDG_DATA_HOME') or (Path.home() / '.local' / 'share'))
    return base / 'video-downloader' / 'venv'


def _venv_python(venv: Path) -> Path:
    return venv / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')


def _venv_python_works(venv_py: Path) -> bool:
    try:
        subprocess.check_output(
            [str(venv_py), '--version'],
            timeout=10, stderr=subprocess.DEVNULL,
        )
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def _in_skill_venv() -> bool:
    """用 sys.prefix 判断（不能比较 executable，venv 的 python 是符号链接）。"""
    try:
        return Path(sys.prefix).resolve() == _venv_dir().resolve()
    except OSError:
        return False


def _ensure_isolated_env() -> None:
    """首次运行创建独立 venv，并用 venv 的 Python 重新执行本脚本。"""
    venv = _venv_dir()
    venv_py = _venv_python(venv)
    if _in_skill_venv():
        return

    if venv.exists() and (venv / 'pyvenv.cfg').exists() and not _venv_python_works(venv_py):
        print("⚠ 独立环境已损坏（基础 Python 可能已升级），正在重建...")
        shutil.rmtree(venv, ignore_errors=True)

    if not venv_py.exists():
        print(f"📦 首次运行：创建独立 Python 环境（{venv}）...")
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'venv', str(venv)],
                timeout=300,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            print(f"⚠ 创建独立环境失败: {e}")
            print("  继续使用系统 Python；自动更新将不可用")
            return

    try:
        os.execv(
            str(venv_py),
            [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]],
        )
    except OSError as e:
        print(f"⚠ 无法进入独立环境: {e}")
        print("  继续使用系统 Python；自动更新将不可用")


def _pip_install(python: str, packages: List[str], quiet: bool = False,
                 timeout: int = 600) -> bool:
    cmd = [
        python, '-m', 'pip', 'install', '-U',
        '--disable-pip-version-check', '--no-input',
        '--retries', '1', '--timeout', str(YT_DLP_PIP_TIMEOUT),
    ]
    if quiet:
        cmd.append('--quiet')
    cmd.extend(packages)
    try:
        subprocess.check_call(cmd, timeout=timeout)
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        return False


def _fresh_yt_dlp_version() -> Optional[str]:
    """用当前环境的新进程读取磁盘上的 yt-dlp 版本。"""
    try:
        out = subprocess.check_output(
            [sys.executable, '-c',
             'import yt_dlp.version; print(yt_dlp.version.__version__)'],
            text=True, timeout=30, stderr=subprocess.DEVNULL,
        )
        return out.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _import_yt_dlp() -> bool:
    try:
        import importlib
        importlib.invalidate_caches()
        import yt_dlp  # noqa: F401
        return True
    except ImportError:
        return False


def ensure_yt_dlp() -> bool:
    if not _in_skill_venv():
        try:
            import yt_dlp  # noqa: F401
            print("⚠ 未使用独立环境，已跳过自动更新")
            return True
        except ImportError:
            print("❌ 未找到 yt-dlp，且独立环境不可用")
            print("  请修复 Python venv 后重试，或手动安装 yt-dlp")
            return False

    try:
        import yt_dlp
    except ImportError:
        print("📦 正在安装 yt-dlp...")
        if not _pip_install(sys.executable, ['yt-dlp[default]'], quiet=False):
            print("❌ 安装失败，请检查网络后重试")
            return False
        if not _import_yt_dlp():
            print("❌ 安装后仍无法导入 yt-dlp")
            return False
        import yt_dlp  # noqa: F811

    current = getattr(getattr(yt_dlp, 'version', None), '__version__', '') or '未知'
    print(f"🔄 检查 yt-dlp 更新（当前 {current}）...")
    if _pip_install(sys.executable, ['yt-dlp[default]'],
                    quiet=True, timeout=300):
        latest = _fresh_yt_dlp_version()
        if latest and latest != current:
            print(f"✅ yt-dlp 已更新: {current} → {latest}（下次运行生效）")
        else:
            print("✅ yt-dlp 已是最新")
    else:
        print("⚠ 更新失败（网络问题），继续使用当前版本")
    return True


def _node_major_version() -> Optional[int]:
    try:
        out = subprocess.check_output(
            ['node', '--version'],
            text=True, timeout=5, stderr=subprocess.DEVNULL,
        )
        return int(out.strip().lstrip('v').split('.')[0])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def detect_js_runtimes() -> dict:
    runtimes = {}
    if shutil.which('deno'):
        runtimes['deno'] = {}
    if shutil.which('node'):
        major = _node_major_version()
        if major is not None and major < 20:
            print(f"⚠ Node.js v{major} 版本过低（yt-dlp EJS 需要 ≥20），已跳过")
        else:
            runtimes['node'] = {}
    if not runtimes:
        print("⚠ 未检测到可用的 JS runtime (deno/node ≥20)")
        print("  YouTube 等站点可能下载失败")
        print("  请安装 Node.js ≥20 或 Deno")
    return runtimes


def read_urls_from_file(file_path: Path) -> List[str]:
    with open(file_path, 'r', encoding='utf-8') as f:
        return [line.strip() for line in f
                if line.strip() and not line.strip().startswith(('#', ';'))]


def build_format_string(quality: str, resolution: Optional[int], codec: str,
                        custom_format: Optional[str], audio_only: bool) -> str:
    if custom_format:
        return custom_format

    if audio_only or quality == 'audio-only':
        return QUALITY_FORMATS['audio-only']

    if resolution:
        return f"b[height<={resolution}]/bv*[height<={resolution}]+ba"

    return QUALITY_FORMATS.get(quality, QUALITY_FORMATS['best'])


def build_opts(output_dir: Path, quality: str, resolution: Optional[int],
               codec: str, custom_format: Optional[str], audio_only: bool,
               cookie_file: Optional[Path], cookies_from_browser: Optional[str],
               playlist: bool, use_aria2: bool, runtimes: dict) -> dict:
    opts = {
        'outtmpl': str(output_dir / '%(title)s [%(id)s].%(ext)s'),
        'no_warnings': True,
        'noplaylist': not playlist,
    }

    fmt = build_format_string(quality, resolution, codec, custom_format, audio_only)
    opts['format'] = fmt

    if resolution and not custom_format and not (audio_only or quality == 'audio-only'):
        # 分辨率优先；编码只是同分辨率下的排序偏好（不牺牲分辨率）
        opts['format_sort'] = ['res', f'vcodec:{codec}']

    if audio_only or quality == 'audio-only':
        opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'm4a',
        }]
    else:
        opts['merge_output_format'] = 'mp4'

    if cookies_from_browser:
        opts['cookiesfrombrowser'] = (cookies_from_browser, None, None, None)
    elif cookie_file and cookie_file.exists():
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
  %(prog)s --cookies-from-browser chrome "URL"
  %(prog)s --playlist "https://youtube.com/playlist?list=xxx"
  %(prog)s --aria2 "URL"
        """
    )

    parser.add_argument('urls', nargs='*', help='视频URL（支持多个）')
    parser.add_argument('--file', '-f', help='从文件读取URL列表')
    cookie_group = parser.add_mutually_exclusive_group()
    cookie_group.add_argument('--cookies', '-c', help='Cookie文件路径')
    cookie_group.add_argument(
        '--cookies-from-browser', metavar='BROWSER',
        choices=['brave', 'chrome', 'chromium', 'edge', 'firefox',
                 'opera', 'safari', 'vivaldi', 'whale'],
        help='直接从浏览器读取 Cookie（macOS 首次使用 Chrome 会弹 Keychain 授权）',
    )
    parser.add_argument('--output', '-o',
                        default=str(DEFAULT_DOWNLOAD_DIR),
                        help='输出目录（默认: ~/Downloads）')
    parser.add_argument('--quality', '-q',
                        choices=['best', 'high', 'medium', 'low', 'audio-only'],
                        default='best',
                        help='画质预设（默认: best）')
    parser.add_argument('--resolution', '-r', type=int,
                        help='指定分辨率上限（720/1080/2160）')
    parser.add_argument('--codec',
                        choices=['h264', 'h265', 'vp9', 'av1'],
                        default='h264',
                        help='视频编码偏好，同分辨率下优先，需配合 --resolution（默认: h264）')
    parser.add_argument('--audio-only', action='store_true',
                        help='只下载音频')
    parser.add_argument('--format', help='直接传 yt-dlp format string')
    parser.add_argument('--playlist', action='store_true',
                        help='下载整个播放列表（默认忽略 URL 中的 list=，只下载单个视频）')
    parser.add_argument('--aria2', action='store_true',
                        help='使用aria2加速下载')

    return parser.parse_args()


def main():
    if '--help' in sys.argv or '-h' in sys.argv:
        parse_args()
        return

    _ensure_isolated_env()

    args = parse_args()

    if not ensure_yt_dlp():
        sys.exit(1)

    runtimes = detect_js_runtimes()

    if not shutil.which('ffmpeg'):
        print("⚠ 未检测到 ffmpeg：音视频合并与 --audio-only 音频提取可能失败")

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
    elif not args.cookies_from_browser and DEFAULT_COOKIE_FILE.exists():
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
        cookies_from_browser=args.cookies_from_browser,
        playlist=args.playlist,
        use_aria2=args.aria2,
        runtimes=runtimes,
    )

    print(f"\n{'='*60}")
    print(f"🎬 Video Downloader")
    print(f"{'='*60}")
    print(f"📁 输出目录: {output_dir}")
    print(f"🎞️  质量: {args.quality}")
    print(f"📦 输入链接: {len(urls)}")
    if args.resolution:
        print(f"📐 分辨率: {args.resolution}p")
        print(f"🎥 编码偏好: {args.codec}")
    if args.playlist:
        print(f"📃 播放列表: 已启用")
    if audio_only:
        print(f"🔊 仅音频")
    if args.aria2:
        print(f"⚡ 加速: aria2")
    if args.cookies_from_browser:
        print(f"🍪 Cookie: 浏览器 {args.cookies_from_browser}")
    elif cookie_file:
        print(f"🍪 Cookie: {cookie_file}")
    if runtimes:
        print(f"🔧 JS Runtime: {', '.join(runtimes.keys())}")

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
