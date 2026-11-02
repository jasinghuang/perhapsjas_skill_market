#!/usr/bin/env python3
"""
Video Downloader - 视频下载 Skill 入口
支持 Bilibili、YouTube 等平台，使用 yt-dlp Python API 下载
"""

import sys
import os
import json
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

_INSPECT_MODE = '--inspect' in sys.argv


def _log(*args, **kwargs):
    """inspect 模式下日志走 stderr，保证 stdout 的 JSON 可解析。"""
    kwargs.setdefault('file', sys.stderr if _INSPECT_MODE else sys.stdout)
    print(*args, **kwargs)

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
        _log("⚠ 独立环境已损坏（基础 Python 可能已升级），正在重建...")
        shutil.rmtree(venv, ignore_errors=True)

    if not venv_py.exists():
        _log(f"📦 首次运行：创建独立 Python 环境（{venv}）...")
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'venv', str(venv)],
                timeout=300,
                stdout=sys.stderr if _INSPECT_MODE else None,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            _log(f"⚠ 创建独立环境失败: {e}")
            _log("  继续使用系统 Python；自动更新将不可用")
            return

    try:
        os.execv(
            str(venv_py),
            [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]],
        )
    except OSError as e:
        _log(f"⚠ 无法进入独立环境: {e}")
        _log("  继续使用系统 Python；自动更新将不可用")


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
        subprocess.check_call(
            cmd, timeout=timeout,
            stdout=sys.stderr if _INSPECT_MODE else None,
        )
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
            _log("⚠ 未使用独立环境，已跳过自动更新")
            return True
        except ImportError:
            _log("❌ 未找到 yt-dlp，且独立环境不可用")
            _log("  请修复 Python venv 后重试，或手动安装 yt-dlp")
            return False

    try:
        import yt_dlp
    except ImportError:
        _log("📦 正在安装 yt-dlp...")
        if not _pip_install(sys.executable, ['yt-dlp[default]'], quiet=False):
            _log("❌ 安装失败，请检查网络后重试")
            return False
        if not _import_yt_dlp():
            _log("❌ 安装后仍无法导入 yt-dlp")
            return False
        import yt_dlp  # noqa: F811

    current = getattr(getattr(yt_dlp, 'version', None), '__version__', '') or '未知'
    _log(f"🔄 检查 yt-dlp 更新（当前 {current}）...")
    if _pip_install(sys.executable, ['yt-dlp[default]'],
                    quiet=True, timeout=300):
        latest = _fresh_yt_dlp_version()
        if latest and latest != current:
            _log(f"✅ yt-dlp 已更新: {current} → {latest}（下次运行生效）")
        else:
            _log("✅ yt-dlp 已是最新")
    else:
        _log("⚠ 更新失败（网络问题），继续使用当前版本")
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
            _log(f"⚠ Node.js v{major} 版本过低（yt-dlp EJS 需要 ≥20），已跳过")
        else:
            runtimes['node'] = {}
    if not runtimes:
        _log("⚠ 未检测到可用的 JS runtime (deno/node ≥20)")
        _log("  YouTube 等站点可能下载失败")
        _log("  请安装 Node.js ≥20 或 Deno")
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


def _fmt_duration(seconds) -> str:
    try:
        total = int(seconds)
    except (TypeError, ValueError):
        return "未知"
    if total <= 0:
        return "未知"
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _fmt_size(size) -> str:
    if not size:
        return "未知"
    value = float(size)
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if value < 1024 or unit == 'TiB':
            return f"{value:.1f} {unit}"
        value /= 1024
    return "未知"


CODEC_RANK = {'h264': 0, 'h265': 1, 'vp9': 2, 'av1': 3}


def _codec_family(vcodec) -> str:
    v = (vcodec or '').lower()
    if v.startswith(('avc1', 'avc3')):
        return 'h264'
    if v.startswith(('hev1', 'hvc1')):
        return 'h265'
    if v.startswith(('vp9', 'vp09')):
        return 'vp9'
    if v.startswith('av01'):
        return 'av1'
    return v or 'unknown'


def _format_size(fmt: dict):
    return fmt.get('filesize') or fmt.get('filesize_approx')


def _estimate_size(fmt: dict, duration=None):
    """返回 (size_bytes, estimated)。缺少 filesize 时用 tbr/abr × 时长估算。"""
    size = _format_size(fmt)
    if size:
        return size, False
    try:
        tbr = float(fmt.get('tbr') or fmt.get('abr') or 0)
        seconds = float(duration or 0)
    except (TypeError, ValueError):
        return None, False
    if tbr > 0 and seconds > 0:
        return int(tbr * 1000 / 8 * seconds), True
    return None, False


def _format_brief(fmt: dict, duration=None) -> dict:
    size, estimated = _estimate_size(fmt, duration)
    vcodec = fmt.get('vcodec')
    return {
        'format_id': fmt.get('format_id'),
        'ext': fmt.get('ext'),
        'resolution': fmt.get('resolution'),
        'height': fmt.get('height'),
        'fps': fmt.get('fps'),
        'vcodec': vcodec,
        'acodec': fmt.get('acodec'),
        'codec': _codec_family(vcodec) if vcodec not in (None, 'none') else None,
        'abr': fmt.get('abr'),
        'tbr': fmt.get('tbr'),
        'dynamic_range': fmt.get('dynamic_range'),
        'size_bytes': size,
        'size': _fmt_size(size),
        'size_estimated': estimated,
        'note': fmt.get('format_note') or '',
    }


def _extract_formats(info: dict) -> dict:
    formats = [
        f for f in (info.get('formats') or [])
        if f.get('format_id') and not f.get('has_drm')
    ]
    muxed, video_only, audio_only = [], [], []
    for f in formats:
        vcodec = f.get('vcodec')
        acodec = f.get('acodec')
        has_v = bool(vcodec and vcodec != 'none')
        has_a = bool(acodec and acodec != 'none')
        if has_v and has_a:
            muxed.append(f)
        elif has_v:
            video_only.append(f)
        elif has_a:
            audio_only.append(f)

    muxed.sort(key=lambda f: (f.get('height') or 0, f.get('tbr') or 0), reverse=True)

    best_video = {}
    for f in video_only:
        key = (f.get('height') or 0, _codec_family(f.get('vcodec')))
        cur = best_video.get(key)
        if cur is None or (
            (f.get('fps') or 0, f.get('tbr') or 0)
            > (cur.get('fps') or 0, cur.get('tbr') or 0)
        ):
            best_video[key] = f

    video_sorted = sorted(
        best_video.values(),
        key=lambda f: (
            -(f.get('height') or 0),
            CODEC_RANK.get(_codec_family(f.get('vcodec')), 99),
            -(f.get('fps') or 0),
            -(f.get('tbr') or 0),
        ),
    )

    audio_only.sort(
        key=lambda f: (
            f.get('ext') == 'm4a' or (f.get('acodec') or '').startswith('mp4a'),
            f.get('abr') or f.get('tbr') or 0,
        ),
        reverse=True,
    )

    return {
        'muxed_raw': muxed,
        'video_raw': video_sorted,
        'audio_raw': audio_only,
        'muxed': [_format_brief(f, info.get('duration')) for f in muxed[:8]],
        'video_only': [_format_brief(f, info.get('duration')) for f in video_sorted[:16]],
        'audio_only': [_format_brief(f, info.get('duration')) for f in audio_only[:6]],
    }


def _choice_for_muxed(fmt: dict, duration=None) -> dict:
    height = fmt.get('height')
    codec = _codec_family(fmt.get('vcodec'))
    size, estimated = _estimate_size(fmt, duration)
    size_text = f"约 {_fmt_size(size)}" if estimated else _fmt_size(size)
    return {
        'label': f"合并流 {height or '?'}p {codec}",
        'description': f"{size_text} · 单文件，无需合并",
        'format': fmt.get('format_id'),
        'kind': 'muxed',
        'needs_merge': False,
        'size_bytes': size,
        'size': _fmt_size(size),
        'size_estimated': estimated,
        'resolution': fmt.get('resolution'),
        'codec': codec,
    }


def _choice_for_separate(video: dict, audio: dict, duration=None) -> dict:
    height = video.get('height')
    codec = _codec_family(video.get('vcodec'))
    vsize, v_est = _estimate_size(video, duration)
    asize, a_est = _estimate_size(audio, duration)
    total = (vsize + asize) if (vsize and asize) else None
    estimated = v_est or a_est

    def size_text(value, est):
        return f"约 {_fmt_size(value)}" if (est and value) else _fmt_size(value)

    total_note = "（估算）" if estimated and total else ""
    return {
        'label': f"分离流 {height or '?'}p {codec}",
        'description': (f"视频 {size_text(vsize, v_est)} + 音频 {size_text(asize, a_est)}"
                        f" ≈ {_fmt_size(total)}{total_note} · 需 ffmpeg 合并"),
        'format': f"{video.get('format_id')}+{audio.get('format_id')}",
        'kind': 'separate',
        'needs_merge': True,
        'video_format': video.get('format_id'),
        'audio_format': audio.get('format_id'),
        'size_bytes': total,
        'size': _fmt_size(total),
        'size_estimated': estimated,
        'resolution': video.get('resolution'),
        'codec': codec,
    }


def _build_choices(info: dict, fmt_data: dict) -> list:
    duration = info.get('duration')
    choices = []
    if fmt_data['muxed_raw']:
        choices.append(_choice_for_muxed(fmt_data['muxed_raw'][0], duration))
    if fmt_data['video_raw'] and fmt_data['audio_raw']:
        audio = fmt_data['audio_raw'][0]
        for video in fmt_data['video_raw']:
            choices.append(_choice_for_separate(video, audio, duration))
            if len(choices) >= 8:
                break

    default_id = info.get('format_id')
    matched = False
    for choice in choices:
        if choice['format'] == default_id:
            choice['default'] = True
            matched = True
            break
    if choices and not matched:
        choices[0]['default'] = True
    if choices:
        default_idx = next(
            (i for i, c in enumerate(choices) if c.get('default')), 0
        )
        choices.insert(0, choices.pop(default_idx))
    return choices


def _probe_item(url: str, info: dict) -> dict:
    if info.get('_type') == 'playlist':
        entries = list(info.get('entries') or [])
        count = info.get('playlist_count') or len(entries)
        duration = sum(e.get('duration') or 0 for e in entries)
        return {
            'url': url,
            'title': info.get('title') or '播放列表',
            'is_playlist': True,
            'playlist_count': count,
            'duration_seconds': duration or None,
            'duration': _fmt_duration(duration),
            'size_bytes': None,
            'size': '未知（播放列表）',
            'entries_preview': [e.get('title') for e in entries[:5] if e.get('title')],
            'resolution': None,
            'vcodec': None,
            'ext': None,
            'format_id': None,
            'is_live': False,
            'formats': {'muxed': [], 'video_only': [], 'audio_only': []},
            'choices': [],
        }

    size = info.get('filesize') or info.get('filesize_approx')
    if not size:
        size = sum((f.get('filesize') or f.get('filesize_approx') or 0)
                   for f in (info.get('requested_formats') or [])) or None

    fmt_data = _extract_formats(info)
    choices = _build_choices(info, fmt_data)

    return {
        'url': url,
        'title': info.get('title') or '未知标题',
        'is_playlist': False,
        'playlist_count': None,
        'duration_seconds': info.get('duration'),
        'duration': _fmt_duration(info.get('duration')),
        'size_bytes': size,
        'size': _fmt_size(size),
        'resolution': info.get('resolution'),
        'height': info.get('height'),
        'vcodec': info.get('vcodec'),
        'acodec': info.get('acodec'),
        'ext': info.get('ext'),
        'format_id': info.get('format_id'),
        'is_live': bool(info.get('is_live')),
        'formats': {
            'muxed': fmt_data['muxed'],
            'video_only': fmt_data['video_only'],
            'audio_only': fmt_data['audio_only'],
        },
        'choices': choices,
    }


def probe_urls(urls: List[str], opts: dict, playlist: bool) -> dict:
    """探测标题/时长/预计大小，不下载。"""
    from yt_dlp import YoutubeDL

    probe_opts = dict(opts)
    probe_opts.update({
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'noprogress': True,
        'socket_timeout': 20,
        'noplaylist': not playlist,
    })
    if playlist:
        probe_opts['extract_flat'] = 'in_playlist'

    items = []
    total_size = 0
    total_duration = 0.0
    for url in urls:
        try:
            with YoutubeDL(probe_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if not isinstance(info, dict):
                raise ValueError('未获取到视频信息')
            item = _probe_item(url, info)
        except Exception as e:
            item = {'url': url, 'error': str(e)}
        items.append(item)
        total_size += item.get('size_bytes') or 0
        total_duration += item.get('duration_seconds') or 0

    return {
        'ok': any('error' not in item for item in items),
        'items': items,
        'total_size_bytes': total_size or None,
        'total_size': _fmt_size(total_size),
        'total_duration_seconds': total_duration or None,
        'total_duration': _fmt_duration(total_duration),
        'ffmpeg_available': bool(shutil.which('ffmpeg')),
        'merge_note': (
            "分离流会分别下载视频和音频，脚本自动用 ffmpeg 合并为一个 mp4，"
            "合并后删除原始分离文件。"
            if shutil.which('ffmpeg') else
            "未检测到 ffmpeg：选择分离流会导致合并失败，请先安装 ffmpeg。"
        ),
    }


def print_probe_result(result: dict) -> None:
    for item in result['items']:
        if item.get('error'):
            _log(f"❌ 检测失败: {item['url']}")
            _log(f"   {item['error']}")
            continue
        if item.get('is_playlist'):
            _log(f"📃 {item['title']}（播放列表，{item['playlist_count']} 个视频）")
            _log(f"   总时长: {item['duration']} | 预计大小: {item['size']}")
        else:
            live = "（直播）" if item.get('is_live') else ""
            _log(f"🎬 {item['title']}{live}")
            _log(f"   时长: {item['duration']} | 预计大小: {item['size']}")
            detail = ' | '.join(
                str(v) for v in (item.get('resolution'), item.get('vcodec'), item.get('ext'))
                if v
            )
            if detail:
                _log(f"   画质: {detail}")
            choices = item.get('choices') or []
            if choices:
                _log("   可选格式:")
                for idx, choice in enumerate(choices[:5], 1):
                    mark = "（默认）" if choice.get('default') else ""
                    _log(f"     {idx}. {choice['label']} — "
                         f"{choice['description']}{mark}")
                if len(choices) > 5:
                    _log(f"     ... 还有 {len(choices) - 5} 个格式，详见 --inspect JSON")
    if len(result['items']) > 1:
        _log(f"📦 合计 {len(result['items'])} 个链接 | 总时长: "
             f"{result['total_duration']} | 预计总大小: {result['total_size']}")
    if any(c.get('needs_merge') for item in result['items']
           for c in (item.get('choices') or [])):
        _log(f"ℹ {result.get('merge_note', '')}")


def download_videos(urls: List[str], opts: dict) -> int:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError

    try:
        with YoutubeDL(opts) as ydl:
            ret = ydl.download(urls)
            return ret
    except DownloadError as e:
        _log(f"❌ 下载失败: {e}")
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
  %(prog)s --inspect "URL"
  %(prog)s --yes "URL"
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
    parser.add_argument('--inspect', action='store_true',
                        help='仅检测元数据（标题/时长/预计大小），输出 JSON，不下载')
    parser.add_argument('--yes', '-y', action='store_true',
                        help='跳过确认直接下载（用户确认元数据后使用）')
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
        _log("⚠ 未检测到 ffmpeg：音视频合并与 --audio-only 音频提取可能失败")

    urls = args.urls or []
    if args.file:
        file_path = Path(args.file).expanduser()
        if file_path.exists():
            urls.extend(read_urls_from_file(file_path))
        else:
            _log(f"❌ 文件不存在: {file_path}")
            sys.exit(1)

    if not urls:
        _log("❌ 没有提供URL!")
        sys.exit(1)

    output_dir = Path(args.output).expanduser()

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

    result = probe_urls(urls, opts, args.playlist)

    if args.inspect:
        print('INSPECT_JSON: ' + json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result['ok'] else 1)

    print_probe_result(result)

    if not result['ok']:
        _log("❌ 没有可下载的视频。")
        sys.exit(1)

    if not args.yes:
        if not sys.stdin.isatty():
            _log("⚠ 非交互环境：请先运行 --inspect 查看元数据，"
                 "确认后加 --yes 下载。")
            sys.exit(2)
        try:
            answer = input("确认下载以上内容? [y/N] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            _log("\n已取消。")
            sys.exit(0)
        if answer not in ('y', 'yes', '是'):
            _log("已取消。")
            sys.exit(0)

    output_dir.mkdir(parents=True, exist_ok=True)

    _log(f"\n{'='*60}")
    _log(f"🎬 Video Downloader")
    _log(f"{'='*60}")
    _log(f"📁 输出目录: {output_dir}")
    _log(f"🎞️  质量: {args.quality}")
    _log(f"📦 输入链接: {len(urls)}")
    if args.resolution:
        _log(f"📐 分辨率: {args.resolution}p")
        _log(f"🎥 编码偏好: {args.codec}")
    if args.playlist:
        _log(f"📃 播放列表: 已启用")
    if audio_only:
        _log(f"🔊 仅音频")
    if args.aria2:
        _log(f"⚡ 加速: aria2")
    if args.cookies_from_browser:
        _log(f"🍪 Cookie: 浏览器 {args.cookies_from_browser}")
    elif cookie_file:
        _log(f"🍪 Cookie: {cookie_file}")
    if runtimes:
        _log(f"🔧 JS Runtime: {', '.join(runtimes.keys())}")

    ret = download_videos(urls, opts)

    if ret == 0:
        _log(f"\n✅ 全部下载完成")
        _log(f"📁 输出目录: {output_dir}")
    else:
        _log(f"\n❌ 部分视频下载失败 (错误码: {ret})")
        _log(f"   💡 提示：")
        _log(f"      - YouTube 403 错误：确保已安装 Node.js ≥20 或 Deno")
        _log(f'      - 尝试: {sys.executable} -m pip install -U "yt-dlp[default]"')

    sys.exit(ret)


if __name__ == '__main__':
    main()
