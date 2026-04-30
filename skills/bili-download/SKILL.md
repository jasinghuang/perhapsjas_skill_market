---
name: bili-download
description: B站视频下载器。只负责视频下载，字幕功能已拆分到 whisper-transcribe 和 llm-refine。触发词：bilibili、b站、下载b站、bilibili下载、b站下载、bili、视频下载
---

# Bilibili 视频下载器

> 一键下载 Bilibili 视频，支持多平台、批量下载

## 功能

- 单个视频下载
- 批量下载多个视频
- 从 txt/xlsx 文件读取 URL
- QuickTime 兼容格式（H.264 + 无损音频）
- 使用 Cookie 下载会员视频
- aria2 多线程加速

## 使用方法

### 基本用法
```bash
# 下载单个视频
python ${CLAUDE_PLUGIN_ROOT}/skills/bili-download/skill_main.py "https://www.bilibili.com/video/BV1xx411c7mD"

# 批量下载
python ${CLAUDE_PLUGIN_ROOT}/skills/bili-download/skill_main.py "URL1" "URL2" "URL3"

# 从文件读取URL
python ${CLAUDE_PLUGIN_ROOT}/skills/bili-download/skill_main.py --file urls.txt

# QuickTime 兼容格式
python ${CLAUDE_PLUGIN_ROOT}/skills/bili-download/skill_main.py --quicktime "URL"

# 使用 aria2 加速
python ${CLAUDE_PLUGIN_ROOT}/skills/bili-download/skill_main.py --aria2 "URL"
```

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `urls` | 视频 URL（支持多个） | 必需 |
| `--file, -f` | 从文件读取 URL 列表 | - |
| `--cookies, -c` | Cookie 文件路径 | - |
| `--output, -o` | 输出目录 | ~/Downloads |
| `--aria2` | 使用 aria2 加速下载 | false |
| `--quality, -q` | 视频质量 (best/worst) | best |
| `--quicktime` | QuickTime 兼容格式 | false |

## 配置文件

配置文件位于 `${CLAUDE_PLUGIN_ROOT}/skills/bili-download/config.json`：

```json
{
  "download": {
    "output_dir": "~/Downloads",
    "quality": "best",
    "use_aria2": false,
    "quicktime": false
  }
}
```

## Cookie 文件

下载会员视频需要 Cookie：

1. 浏览器登录 Bilibili
2. 导出 Cookie 到 `~/bilibili-cookies.txt`
3. 使用 `--cookies` 参数指定

## 依赖

```bash
pip install yt-dlp
brew install yt-dlp  # 或使用 brew

# 可选：aria2 加速
brew install aria2
```

## 完整工作流

如果需要字幕，配合其他 skills 使用：

```
1. bili-download    → 下载视频
2. whisper-transcribe → 转录字幕 (SRT/MD)
3. llm-refine       → 校准/翻译字幕
```

### 示例工作流

```bash
# Step 1: 下载视频
python ${CLAUDE_PLUGIN_ROOT}/skills/bili-download/skill_main.py "URL"

# Step 2: 转录字幕
python ${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/skill_main.py video.mp4

# Step 3: 校准字幕
python ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/skill_main.py video.srt
```

## 示例

```
用户: 下载 B站视频 https://www.bilibili.com/video/BV1xx411c7mD
用户: 批量下载这些视频: [URL1, URL2, URL3]
用户: 下载这个视频，QuickTime 兼容格式
```
