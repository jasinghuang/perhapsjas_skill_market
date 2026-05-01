# Video Downloader Skill Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite video-downloader skill to use yt-dlp Python API, fix Windows bugs (encoding, JS runtime, python3).

**Architecture:** Single-file rewrite of `skill_main.py` replacing all subprocess calls with yt-dlp's Python API (`from yt_dlp import YoutubeDL`). Auto-detect JS runtimes (deno/node). Auto-install yt-dlp on first run. Delete unused `config.json`.

**Tech Stack:** Python 3, yt-dlp Python API, argparse, shutil

**Spec:** `docs/superpowers/specs/2026-05-01-video-downloader-rewrite-design.md`

---

## File Structure

```
skills/video-downloader/
├── skill_main.py    # REWRITE (273 lines → ~180 lines)
├── SKILL.md         # REWRITE (remove config.json section, update deps)
└── config.json      # DELETE
```

---

### Task 1: Rewrite skill_main.py

**Files:**
- Rewrite: `skills/video-downloader/skill_main.py`

- [ ] **Step 1: Write the complete new skill_main.py**

Replace the entire file content with:

```python
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
```

- [ ] **Step 2: Verify --help output**

Run: `python "skills/video-downloader/skill_main.py" --help`
Expected: argparse help output with all options listed, no errors

- [ ] **Step 3: Verify JS runtime detection**

Run: `python -c "from skills.video_downloader.skill_main import detect_js_runtimes; print(detect_js_runtimes())"`
Expected: prints detected runtimes (e.g. `['node']`) or warning message

- [ ] **Step 4: Commit**

```bash
git add skills/video-downloader/skill_main.py
git commit -m "refactor: rewrite video-downloader to use yt-dlp Python API

- Replace all subprocess calls with YoutubeDL Python API
- Auto-detect JS runtimes (deno/node) for YouTube support
- Auto-install yt-dlp with yt-dlp-ejs on first run
- Fix Windows GBK encoding crash with sys.stdout.reconfigure
- Use sys.executable instead of hardcoded python3
- Remove dead code: update_yt_dlp(), config.json loading
- Remove unreliable iterdir() file detection
- Simplify format selection with yt-dlp format strings"
```

---

### Task 2: Rewrite SKILL.md

**Files:**
- Rewrite: `skills/video-downloader/SKILL.md`

- [ ] **Step 1: Write the new SKILL.md**

Replace entire file content with:

```markdown
---
name: video-downloader
description: >
  视频下载工具，支持 Bilibili 和 YouTube，使用 yt-dlp 下载视频到本地。
  当用户要下载视频、保存视频、离线观看、批量下载、bilibili下载、youtube下载、
  B站下载、油管下载、bili下载时触发此 skill。
  支持 B站/Bilibili/YouTube/油管链接，支持批量下载、aria2加速、Cookie登录下载。
  只负责视频下载，字幕转录和校准请使用 audio-transcribe 和 text-refine skill。
---

# Video Downloader

下载 Bilibili / YouTube 视频到本地。

## 首次依赖检查

脚本自动检测并安装 yt-dlp（包含 yt-dlp-ejs YouTube 支持）。以下为可选依赖：

### 可选：JS runtime（YouTube 等站点需要）

YouTube 下载需要 JavaScript runtime，脚本自动检测：

- **Node.js** ≥20（推荐）：`winget install OpenJS.NodeJS` 或 https://nodejs.org
- **Deno**：`winget install DenoLand.Deno` 或 `brew install deno`

安装后无需额外配置，脚本自动检测。

### 可选：ffmpeg（合并音视频）

- Mac: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg`

### 可选：aria2（加速下载）

- Mac: `brew install aria2`
- Windows: `winget install aria2.aria2`

## 使用方法

```bash
# 下载单个视频（默认最高画质）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py "URL"

# 批量下载
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py "URL1" "URL2" "URL3"

# 从文件读取 URL 列表
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --file urls.txt

# 只下载音频（适合转录场景）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --audio-only "URL"

# 指定画质
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --quality high "URL"
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --resolution 720 "URL"

# 使用 Cookie 下载会员视频
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies ~/video-cookies.txt "URL"

# aria2 加速
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --aria2 "URL"
```

## 参数

### 预设画质

| 参数值 | 含义 |
|--------|------|
| `best`（默认） | 最高画质 |
| `high` | 1080p |
| `medium` | 720p |
| `low` | 480p |
| `audio-only` | 只要音频（m4a） |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `urls` | 视频 URL（支持多个） | 必需 |
| `--file, -f` | 从文件读取 URL 列表（txt） | - |
| `--cookies, -c` | Cookie 文件路径 | 自动检测 `~/video-cookies.txt` |
| `--output, -o` | 输出目录 | ~/Downloads |
| `--quality, -q` | 画质预设（best/high/medium/low/audio-only） | best |
| `--resolution, -r` | 指定分辨率（720/1080/2160） | 无（用预设） |
| `--codec` | 视频编码（h264/h265/vp9/av1） | h264 |
| `--audio-only` | 只下载音频 | false |
| `--format` | 直接传 yt-dlp format string | 无 |
| `--aria2` | 使用 aria2 加速下载 | false |

优先级：`--format` > `--resolution` + `--codec` > `--quality` 预设

## Cookie 文件

下载会员视频需要 Cookie：

1. 浏览器登录 Bilibili 或 YouTube
2. 使用浏览器扩展导出 Cookie 到 `~/video-cookies.txt`
3. 使用 `--cookies` 参数指定（或自动检测默认路径）

## 完整工作流

下载视频后，配合其他 skills 使用：

```
1. video-downloader → 下载视频
2. audio-transcribe → 转录为字幕 (SRT/MD)
3. text-refine      → 校准/翻译字幕
```

## 示例

```
用户: 下载这个视频 https://www.bilibili.com/video/BV1xx411c7mD
用户: 下载 YouTube 视频 https://youtube.com/watch?v=xxx
用户: 批量下载这些视频: [URL1, URL2, URL3]
用户: 下载这个视频，只要音频
用户: 下载视频 720p 的就行
```
```

- [ ] **Step 2: Commit**

```bash
git add skills/video-downloader/SKILL.md
git commit -m "docs: rewrite video-downloader SKILL.md for cross-platform

- Remove python3 hardcoded commands, use python
- Add JS runtime (Node.js/Deno) optional dependency section
- Remove config.json section
- Add Windows install commands (winget)"
```

---

### Task 3: Cleanup and update README

**Files:**
- Delete: `skills/video-downloader/config.json`
- Modify: `README.md` (remove config.json reference)

- [ ] **Step 1: Delete config.json**

```bash
git rm skills/video-downloader/config.json
```

- [ ] **Step 2: Update README.md**

In `README.md`, remove the `brew install aria2` line under video-downloader deps, and update the video-downloader section to remove any reference to config.json. The README currently has no config.json reference in the video-downloader section, so only verify no stale references remain.

Read `README.md` and confirm no references to:
- `config.json` in video-downloader section
- `python3` commands (should be `python`)

If found, fix them.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete unused config.json from video-downloader"
```

---

### Task 4: Smoke test

**Files:** None (testing only)

- [ ] **Step 1: Test --help**

Run: `python "E:\Claude Code\Video_Toolkit\skills\video-downloader\skill_main.py" --help`
Expected: Clean help output, no encoding errors

- [ ] **Step 2: Test JS runtime detection**

Run: `python -c "import sys; sys.path.insert(0, r'E:\Claude Code\Video_Toolkit\skills\video-downloader'); from skill_main import detect_js_runtimes; print(detect_js_runtimes())"`
Expected: `['node']` or `['deno', 'node']` on this Windows machine

- [ ] **Step 3: Test format string building**

Run: `python -c "import sys; sys.path.insert(0, r'E:\Claude Code\Video_Toolkit\skills\video-downloader'); from skill_main import build_format_string; print(build_format_string('high', None, 'h264', None, False)); print(build_format_string('best', None, 'h264', None, False)); print(build_format_string('audio-only', None, 'h264', None, True))"`
Expected:
```
bv*[height<=1080]+ba/b[height<=1080]
bv*+ba/b
ba/b
```

- [ ] **Step 4: Test real download (if network available)**

Run: `python "E:\Claude Code\Video_Toolkit\skills\video-downloader\skill_main.py" "https://www.youtube.com/watch?v=jNQXAC9IVRw"` (first YouTube video ever, short)
Expected: Downloads successfully with JS runtime detected, no 403 error

---

## Self-Review

**1. Spec coverage:**
- Section 1 (Python API): Task 1 implements `YoutubeDL` API, `build_opts()`, `build_format_string()` ✓
- Section 2 (Dependencies): Task 1 implements `ensure_yt_dlp()` and `detect_js_runtimes()` ✓
- Section 3 (Error handling): Task 1 implements `DownloadError` catch in `download_videos()` ✓
- Section 4 (SKILL.md): Task 2 rewrites SKILL.md ✓
- Section 5 (Deletions): Task 3 deletes config.json ✓
- Section 6 (Entry point): Task 1 implements `main()` with correct flow ✓

**2. Placeholder scan:** No TBD/TODO/placeholders found ✓

**3. Type consistency:** All function signatures match between definition and call sites ✓
