# Video Toolkit

一站式视频字幕工作流 Claude Code 插件：**下载 → 转录 → 校准**

## 包含 Skills

| Skill | 功能 | 命令 |
|-------|------|------|
| **video-downloader** | Bilibili / YouTube 视频下载 | `/video-downloader` |
| **mlx-whisper** | Apple Silicon 加速音频转录 | `/mlx-whisper` |
| **text-refine** | Claude 直接校准字幕、翻译 | `/text-refine` |

---

## 安装

```bash
# 添加市场
/plugin marketplace add jasinghuang/Video_Toolkit

# 安装插件
/plugin install jas_Video_Toolkit@Video_Toolkit
```

## 依赖

```bash
# video-downloader
pip install yt-dlp
# 可选：aria2 加速
brew install aria2

# mlx-whisper
pip3 install --break-system-packages mlx-whisper zhconv
brew install ffmpeg

# text-refine
# 无需额外依赖，Claude 直接处理
```

---

## 工作流

```
视频 URL
  ↓ video-downloader → 下载视频文件
  ↓ mlx-whisper      → 转录为字幕 (SRT/MD)
  ↓ text-refine      → 校准错别字/翻译
  → 最终字幕文件
```

三个 skill 可以单独使用，也可以串联成完整工作流。

---

## video-downloader

Bilibili / YouTube 视频下载工具，底层使用 yt-dlp。

### 功能

- 支持 Bilibili、YouTube 等平台
- 批量下载（多个 URL 或从文件读取）
- Cookie 登录下载会员视频
- 画质预设 + 自定义分辨率/编码
- 只下载音频（适合转录场景）
- aria2 多线程加速

### 画质控制

| 预设 | 含义 |
|------|------|
| `best`（默认） | 最高画质 |
| `high` | 1080p |
| `medium` | 720p |
| `low` | 480p |
| `audio-only` | 只要音频（m4a） |

也可通过 `--resolution 720`、`--codec h265` 精细控制。

### 示例

```
用户: 下载这个视频 https://www.bilibili.com/video/BV1xx411c7mD
用户: 下载 YouTube 视频 https://youtube.com/watch?v=xxx
用户: 下载视频，720p 就行
用户: 下载这个视频，只要音频
用户: 批量下载这些视频: [URL1, URL2, URL3]
```

### 命令行

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py "URL"
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --quality high "URL"
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --audio-only "URL"
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --file urls.txt
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies ~/video-cookies.txt "URL"
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --aria2 "URL"
```

---

## mlx-whisper

音频/视频转录工具，使用 MLX-Whisper（Apple Silicon 原生加速），替代 openai-whisper。

### 功能

- Apple Silicon GPU 加速，转录速度显著提升
- 每次使用前询问模型和输出格式
- 自动语言检测
- 繁体中文自动转简体中文
- Markdown 输出自动合并为自然段落（非逐句分行）
- 多种输出格式（Markdown / SRT / Markdown + 时间码）

### 模型选择

每次转录前会询问选择模型：

| 模型 | 大小 | 速度 | 准确率 | 适合场景 |
|------|------|------|--------|---------|
| small | ~459MB | 快 | 良好 | 快速预览 |
| **large-v3-turbo** | **~1.5GB** | **较快** | **优秀** | **推荐，速度与质量平衡** |
| large-v3 | ~2.9GB | 慢 | 最佳 | 最高准确率 |

### 输出格式

每次转录前会询问选择格式：

| 格式 | 说明 |
|------|------|
| **Markdown** | 合并为自然段落，适合阅读和 text-refine 校准 |
| **SRT** | 标准字幕格式，带时间轴，适合播放器加载 |
| **Markdown + 时间码** | 每段带时间戳，适合回看视频对照 |

### 示例

```
用户: 转录这个视频 video.mp4
用户: 把这个音频转成字幕
用户: whisper 转录 audio.mp3，用 SRT 格式
用户: 用 large-v3 模型转录这个文件
```

### 命令行

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --format srt
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --model large-v3
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --language zh
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --keep-timestamps
```

---

## text-refine

字幕/文本校准与翻译工具。**无需 Python 脚本或外部 API**，Claude 直接作为校准引擎。

### 功能

- 修正 ASR 错别字、同音字错误
- 删除 Whisper 冗余词（"叫做"、"所谓的"）
- 自动检测语言，非中文翻译为中文后再校准
- 自动识别视频类型（科技/医疗/财经/通用），使用对应术语策略
- 基于全文语义校准，不孤立纠错
- 支持 SRT / Markdown / 纯文本输入

### 处理流程

```
输入文件 → 检测语言
  ├─ 中文   → 直接校准
  └─ 非中文 → 翻译为中文 → 校准
→ 输出 {原文件名}_refined.md
```

### 示例

```
用户: 校准这个字幕 video.srt
用户: 帮我校对一下这段文字
用户: 翻译并校准 audio.srt
用户: refine 一下这个 md 文件
```

---

## 首次使用

| Skill | 首次配置 |
|-------|---------|
| **video-downloader** | 自动检查 `yt-dlp`，缺少会提示安装命令 |
| **mlx-whisper** | 每次运行询问模型和输出格式，自动检查依赖 |
| **text-refine** | 无需配置，直接使用 |

## 更新

用户开启自动更新后，推送到 GitHub 即可。记得更新 `.claude-plugin/marketplace.json` 中的 `version` 字段。
