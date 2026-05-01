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

使用前，检查以下依赖是否已安装。缺少则提示用户安装后重试：

```bash
# 必需
python3 -m pip install -U "yt-dlp[default]"    # 或 brew install yt-dlp

# 可选（加速下载）
brew install aria2
```

检查方法：运行 `yt-dlp --version`，失败则提示安装。

## 使用方法

```bash
# 下载单个视频（默认最高画质）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py "URL"

# 批量下载
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py "URL1" "URL2" "URL3"

# 从文件读取 URL 列表
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --file urls.txt

# 只下载音频（适合转录场景）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --audio-only "URL"

# 指定画质
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --quality high "URL"
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --resolution 720 "URL"

# 使用 Cookie 下载会员视频
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies ~/video-cookies.txt "URL"

# aria2 加速
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --aria2 "URL"
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

## 配置文件

配置文件位于 `${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/config.json`：

```json
{
  "download": {
    "output_dir": "~/Downloads",
    "quality": "best",
    "codec": "h264",
    "use_aria2": false
  }
}
```

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
