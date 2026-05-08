# perhapsjas_skill_market

实用内容创作工具集，一个市场包含两个插件。

## 插件

### video-toolkit
粘贴链接，拿到字幕。下载、转录、校准，一条龙。

| Skill | 一句话说清 | 命令 |
|-------|-----------|------|
| **video-downloader** | B站、YouTube 视频随下随用，批量、选画质、只要音频都行 | `/video-downloader` |
| **audio-transcribe** | 视频/音频丢进来，字幕带时间轴出来，Mac Windows 都行 | `/audio-transcribe` |
| **text-refine** | 错别字、同音字、外语翻译，说一句就帮你搞定 | `/text-refine` |

### xiaohongshu-html-card
小红书文案转精美 HTML 图文卡片（1242×1660），支持封面/正文/结尾多卡片自动拆分。

| Skill | 一句话说清 | 命令 |
|-------|-----------|------|
| **xiaohongshu-html-card** | 小红书文案自动排版成图文卡片 | `/xiaohongshu-html-card` |

## 安装

```bash
# 方式一：npx（推荐）
npx skills add jasinghuang/perhapsjas_skill_market -g

# 方式二：市场安装
/plugin marketplace add jasinghuang/perhapsjas_skill_market
/plugin install perhapsjas_skill_market@perhapsjas_skill_market
```

## 怎么串起来

```
粘贴视频链接
  ↓ video-downloader 下载视频
  ↓ audio-transcribe 转成字幕
  ↓ text-refine 校准 + 翻译
  → 拿到干净的字幕文件
```

```
写好小红书文案
  ↓ xiaohongshu-html-card 自动排版
  → 拿到精美图文卡片 HTML
```

所有 skill 各自独立，也能一口气跑完。

## 依赖

**video-downloader** — 自动安装 yt-dlp，可选：
- Node.js ≥ 20 或 Deno（YouTube 需要）
- ffmpeg（合并音视频）
- aria2（多线程加速）

**audio-transcribe：**

```bash
# Mac
pip3 install --break-system-packages mlx-whisper zhconv
brew install ffmpeg

# Windows
pip install faster-whisper zhconv
```

**text-refine** — 无需额外依赖。

**xiaohongshu-html-card** — 无需额外依赖。

---

## 目录结构

```
├── .claude-plugin/
│   └── marketplace.json
├── plugins/
│   ├── video-toolkit/
│   │   └── skills/
│   │       ├── video-downloader/
│   │       ├── audio-transcribe/
│   │       └── text-refine/
│   └── xiaohongshu-html-card/
│       └── skills/
│           └── xiaohongshu-html-card/
│               ├── assets/layouts/
│               └── references/
└── README.md
```

---

## video-downloader

丢一个链接，视频到手。支持 Bilibili、YouTube，批量下载也没问题。

- 批量下载（多 URL 或从文件读取）
- Cookie 登录下载会员视频
- 画质预设 + 自定义分辨率/编码
- 只要音频也行，转字幕正好用得上
- aria2 多线程加速

### 画质

| 预设 | 含义 |
|------|------|
| `best`（默认） | 最高画质 |
| `high` | 1080p |
| `medium` | 720p |
| `low` | 480p |
| `audio-only` | 只要音频（m4a） |

也可 `--resolution 720`、`--codec h265` 精细控制。

### 怎么说它就懂

```
下载这个视频 https://www.bilibili.com/video/BV1xx411c7mD
下载这个 YouTube 视频 https://youtube.com/watch?v=xxx
720p 就行
只要音频
批量下载这些视频: [URL1, URL2, URL3]
```

### 命令行

```bash
python skill_main.py "URL"
python skill_main.py --quality high "URL"
python skill_main.py --audio-only "URL"
python skill_main.py --file urls.txt
python skill_main.py --cookies ~/video-cookies.txt "URL"
python skill_main.py --aria2 "URL"
```

---

## audio-transcribe

扔进来一个视频或音频，拿到带时间轴的字幕。Mac 自动用 MLX-Whisper，Windows 自动用 Faster-Whisper + CUDA，你不用管后端。

- 每次转录前让你选模型和输出格式
- 自动识别语言
- 繁体自动转简体
- Markdown 输出是自然段落，不是逐句碎片

### 模型

**Mac（MLX-Whisper）：**

| 模型 | 大小 | 速度 | 适合 |
|------|------|------|------|
| small | ~459MB | 快 | 快速预览 |
| **large-v3-turbo** | **~1.5GB** | **较快** | **推荐** |
| large-v3 | ~2.9GB | 慢 | 最高准确率 |

**Windows（Faster-Whisper）：**

| 模型 | 大小 | 速度 | 适合 |
|------|------|------|------|
| small | ~461MB | 快 | 快速预览 |
| **medium** | **~1.5GB** | **中等** | **推荐** |
| large-v3 | ~2.9GB | 慢 | 最高准确率 |

### 输出格式

| 格式 | 说明 |
|------|------|
| **Markdown** | 自然段落，适合阅读和 text-refine |
| **SRT** | 带时间轴，适合播放器加载 |
| **Markdown + 时间码** | 每段带时间戳，适合回看对照 |

### 怎么说它就懂

```
转录这个视频 video.mp4
把这个音频转成字幕
whisper 转录 audio.mp3，用 SRT 格式
用 large-v3 模型转录这个文件
```

### 命令行

```bash
python skill_main.py video.mp4
python skill_main.py video.mp4 --format srt
python skill_main.py video.mp4 --model large-v3
python skill_main.py video.mp4 --language zh
python skill_main.py video.mp4 --keep-timestamps
```

---

## text-refine

转出来的字幕有错别字？外语想翻成中文？直接说一句就行，不用装任何东西。

- 修正 ASR 错别字、同音字
- 删除 Whisper 冗余词（「叫做」「所谓的」）
- 外语字幕自动翻译成中文再校准
- 自动识别视频类型（科技/医疗/财经/通用），术语不会翻错
- 基于全文语义校准，不是逐句硬替
- 支持 SRT / Markdown / 纯文本

### 流程

```
输入文件 → 检测语言
  ├─ 中文   → 直接校准
  └─ 非中文 → 翻译 → 校准
→ 输出 {原文件名}_refined.md
```

### 怎么说它就懂

```
校准这个字幕 video.srt
帮我校对一下这段文字
翻译并校准 audio.srt
refine 一下这个 md 文件
```
