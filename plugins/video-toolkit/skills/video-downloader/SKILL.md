---
name: video-downloader
description: >
  Video downloader for Bilibili and YouTube using yt-dlp.
  视频下载工具，支持 Bilibili 和 YouTube，使用 yt-dlp 下载视频到本地。
  Trigger this skill when the user wants to: download video, save video offline,
  batch download videos, download playlist videos, download from Bilibili/B站/YouTube/油管,
  extract audio from video, use yt-dlp, save a video for later viewing, download with cookies,
  or download video in specific quality.
  当用户要下载视频、保存视频、离线观看、批量下载、下载播放列表、bilibili下载、youtube下载、
  B站下载、油管下载、提取音频、指定画质下载时触发此 skill。
  支持 B站/Bilibili/YouTube/油管链接，支持批量下载、播放列表、aria2加速、浏览器 Cookie 登录下载。
  只负责视频下载，字幕转录和校准请使用 audio-transcribe 和 text-refine skill。
  yt-dlp 会自动安装，无需手动预装。
---

# Video Downloader

下载 Bilibili / YouTube 视频到本地。

## 独立运行环境

脚本首次运行会在用户数据目录创建独立 venv，并在其中安装 yt-dlp（含 yt-dlp-ejs YouTube 支持）：

- macOS / Linux：`~/.local/share/video-downloader/venv`
- Windows：`%LOCALAPPDATA%\video-downloader\venv`

之后每次运行都会在该 venv 内静默检查并更新 yt-dlp，不会修改系统 Python 或 Homebrew。环境损坏时删除该目录即可自动重建。

### 需要：JS runtime（YouTube 等站点）

YouTube 下载需要 JavaScript runtime，脚本自动检测：

- **Node.js** ≥20（推荐）：`winget install OpenJS.NodeJS` 或 https://nodejs.org
- **Deno**：`winget install DenoLand.Deno` 或 `brew install deno`

脚本会校验 Node.js 主版本，低于 20 会被跳过并提示。安装后无需额外配置。

### 需要：ffmpeg（合并音视频 / 提取音频）

合并流（单文件）下载不需要 ffmpeg；当站点不提供合并流（如 B 站）回退到分离流时需要 ffmpeg 合并。`--audio-only` 的音频提取也需要 ffmpeg。

- Mac: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg`

### 可选：aria2（加速下载）

- Mac: `brew install aria2`
- Windows: `winget install aria2.aria2`

## 使用方法

```bash
# 下载单个视频（默认最高画质）
# Mac 用户用 python3，Windows 用户用 python
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

# 需要 1080p/4K 时显式走分离流（ffmpeg 合并）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --format "bv*[height<=2160]+ba" "URL"

# 使用 Cookie 下载会员视频
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies ~/video-cookies.txt "URL"

# 直接从浏览器读取 Cookie（推荐，B站大会员 / YouTube 登录态）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies-from-browser chrome "URL"

# 下载完整播放列表（默认忽略 URL 中的 list=，只下载单个视频）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --playlist "https://youtube.com/playlist?list=xxx"

# aria2 加速
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --aria2 "URL"
```

## 参数

### 预设画质

| 参数值 | 含义 |
|--------|------|
| `best`（默认） | 最高画质的合并流；无合并流时回退分离流 |
| `high` | 1080p 以内的最高合并流（无则分离流） |
| `medium` | 720p 以内的最高合并流（无则分离流） |
| `low` | 480p 以内的最高合并流（无则分离流） |
| `audio-only` | 只要音频（m4a） |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `urls` | 视频 URL（支持多个） | 必需 |
| `--file, -f` | 从文件读取 URL 列表（txt） | - |
| `--cookies, -c` | Cookie 文件路径（与 `--cookies-from-browser` 二选一） | 自动检测 `~/video-cookies.txt` |
| `--cookies-from-browser` | 直接读取浏览器 Cookie：chrome/firefox/safari/edge/brave 等 | 无 |
| `--output, -o` | 输出目录 | ~/Downloads |
| `--quality, -q` | 画质预设（best/high/medium/low/audio-only） | best |
| `--resolution, -r` | 指定分辨率上限（720/1080/2160） | 无（用预设） |
| `--codec` | 视频编码偏好（h264/h265/vp9/av1），仅在同分辨率下优先，需配合 `--resolution` | h264 |
| `--audio-only` | 只下载音频 | false |
| `--format` | 直接传 yt-dlp format string | 无 |
| `--playlist` | 下载完整播放列表（默认忽略 URL 中的 `list=`） | false |
| `--aria2` | 使用 aria2 加速下载 | false |

优先级：`--format` > `--resolution` + `--codec` > `--quality` 预设

`--codec` 是**同分辨率下的排序偏好**，不会为了编码牺牲分辨率：先在 `--resolution` 上限内选最高的视频流，同分辨率下再优先指定编码。yt-dlp 原生支持 h264/h265/vp9/av1 别名。

## 推荐用法

- **YouTube 合并流（默认）**：直接运行。`best` 只选单文件合并流（`b`），按画质取最高；站点没有合并流时才回退到分离流 + 合并。
- **YouTube 合并流的实际画质**：目前多数视频只提供 360p 合并流（format 18），少数有 720p（format 22）。`b` 会取该视频可用的最高合并流。
- **需要 1080p/4K**：合并流通常不提供，必须显式用分离流，例如 `--format "bv*[height<=2160]+ba"`（由 ffmpeg 合并）。
- **限制分辨率**：`--resolution 1080`。在合并流中取上限内的最高画质；`--codec` 只在同分辨率下优先。
- **编码兼容性**：YouTube 的 H.264 通常最高 1080p；4K 只能走 VP9/AV1。若播放器不支持 AV1/VP9，接受 1080p H.264，或用 `--format` 自定义。
- **B 站高画质 / 大会员**：`--cookies-from-browser chrome`（先在浏览器登录）。
- **只要音频 / 送转录**：`--audio-only`，输出 m4a。
- **批量**：`--file urls.txt`。默认忽略 URL 中的 `list=`，避免误下整个播放列表；需要整列表时加 `--playlist`。
- **指定目录**：`--output ~/Movies`。

## Cookie

下载会员 / 登录态视频需要 Cookie，两种方式二选一：

### 方式一：直接从浏览器读取（推荐）

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies-from-browser chrome "URL"
```

先在浏览器登录 Bilibili / YouTube。macOS 首次读取 Chrome Cookie 会弹出 Keychain 授权，点“始终允许”。

### 方式二：Cookie 文件

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
