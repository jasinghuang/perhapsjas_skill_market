# Video Toolkit

一站式视频字幕工作流插件：下载 → 转录 → 校准

## 包含 Skills

| Skill | 功能 | 命令 |
|-------|------|------|
| **video-downloader** | Bilibili/YouTube 视频下载，支持批量/Cookie/画质控制 | `/video-downloader` |
| **mlx-whisper** | Apple Silicon 加速转录，首次引导选择模型 | `/mlx-whisper` |
| **text-refine** | Claude 直接校准字幕，修正错别字/翻译 | `/text-refine` |

## 工作流

```
视频 URL
  ↓ video-downloader → 下载视频文件
  ↓ mlx-whisper      → 转录为字幕 (SRT/MD)
  ↓ text-refine      → 校准错别字/翻译
  → 最终字幕文件
```

## 安装

```bash
# 添加市场
/plugin marketplace add jasinghuang/Video_Toolkit

# 安装插件
/plugin install video-toolkit@Video_Toolkit
```

## 首次使用

**video-downloader**：自动检查 `yt-dlp` 是否安装，缺少会提示。

**mlx-whisper**：首次运行自动引导选择模型（base/small/large-v3-turbo/large-v3/large-v2）。

**text-refine**：无需额外配置，Claude 直接校准。

## 依赖

```bash
# video-downloader
pip install yt-dlp
# 可选：aria2 加速
brew install aria2

# mlx-whisper
pip install mlx-whisper zhconv
brew install ffmpeg

# text-refine
# 无需额外依赖
```

## 更新

用户开启自动更新后，推送到 GitHub 即可。记得更新 `.claude-plugin/marketplace.json` 中的 `version` 字段。
