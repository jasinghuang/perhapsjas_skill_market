# perhapsjas_skill_market

内容创作者的 Claude Code 插件集。视频处理、文案创作、图文排版，三个插件覆盖从小白到发布的完整链路。

## 插件一览

| 插件 | 干什么的 | 包含 Skill |
|------|---------|-----------|
| **video-toolkit** | 下载、转录、校准字幕，配音，再把文章/口播稿做成可录屏的网页视频 | `video-downloader` `audio-transcribe` `text-refine` `bailian-tts` `web-video-presentation` |
| **xiaohongshu-card** | 小红书图文卡片 + 封面概念图提示词 | `make-html-card` `cover-image-prompt`（`ian-xiaohei-illustrations` 即将推出） |
| **writting-assistant** | 说出主题，全自动写小红书文案（研究→撰写→质检→存档） | `writting-assistant` |

## 安装

### 安装整个市场（推荐）

所有插件一次性装好，按需使用。

```bash
# 方式一：npx
npx skills add jasinghuang/perhapsjas_skill_market -g

# 方式二：市场命令
/plugin marketplace add jasinghuang/perhapsjas_skill_market
/plugin install perhapsjas_skill_market@perhapsjas_skill_market
```

### 单独安装某个插件

```bash
# 只要 video-toolkit
npx skills add jasinghuang/perhapsjas_skill_market -g --plugin video-toolkit

# 只要 xiaohongshu-card
npx skills add jasinghuang/perhapsjas_skill_market -g --plugin xiaohongshu-card

# 只要 writting-assistant
npx skills add jasinghuang/perhapsjas_skill_market -g --plugin writting-assistant
```

## 使用方法

装好之后直接跟 Claude 说话就行，不需要记命令。

### video-toolkit：视频 → 字幕

```
下载这个视频 https://www.bilibili.com/video/BV1xx411c7mD
转录这个视频 video.mp4
帮我校准这个字幕，有错别字
翻译并校准 audio.srt
```

**串起来用：** 下载视频 → 转录字幕 → 校准翻译，一口气跑完。

### web-video-presentation：文章/口播稿 → 可录屏的网页视频

```
把这篇文章做成一个视频
帮我用这个口播稿做一个网页演示，可以录屏发 B 站
/web-video-presentation
```

产出 = Vite + React + TS 项目：16:9 舞台、点击推进节拍、每步独占整屏、内容驱动的动画。流程：文章/口播稿 → 一次产出脚本+开发计划 → 对齐（稿子/计划/主题/素材/模式）→ 逐章开发（24 套主题可选）→ 可选合成口播音频（provider 无关，内置 MiniMax + OpenAI TTS）→ 录屏成片。沉淀的是设计方法论 + 协作流程，不绑定具体样式。

**依赖：** Node.js ≥ 20；合成音频可选 MiniMax `mmx-cli` 或 `OPENAI_API_KEY`（也可换 ElevenLabs / edge-tts 等）。

### bailian-tts：文本/字幕 → AI 配音（阿里云百炼 CosyVoice）

```
把这段口播稿配成音：大家好，欢迎来到...
给这个字幕配音 subtitle.srt
复刻我的声音（用这段样本 sample.wav）
设计一个沉稳的男播音员音色
/bailian-tts
```

能力 = 单段/批量/ SRT 逐条配音 + 64 个系统音色 + 声音复刻（10-20s 样本克隆）+ 声音设计（文本描述生成）+ 自定义音色库 CRUD。合成走 `bl` CLI，音色复刻/设计直连 DashScope API。`bailian.sh` 可复制进 web-video-presentation 的 `tts-providers/`，让网页视频用 CosyVoice 配音（`PRESENTATION_TTS=bailian`）。

**依赖：** [bailian-cli](https://bailian.aliyun.com/cli/install.md)（`npm install -g bailian-cli` + `bl auth login --api-key`）+ Python `requests`。

### xiaohongshu-card：文案 → 图文卡片 + 封面提示词

```
把这段文案排版成小红书图文卡片
/make-html-card
```

```
帮我生成一个封面概念图提示词
/cover-image-prompt
```

**联动使用：** 先用 xiaohongshu-card 生成卡片，再用 cover-image-prompt 自动从文案中提取变量生成封面图提示词。

### ian-xiaohei-illustrations：文章 → 罐罐暖萌配图（即将推出）

```
帮这篇短文配几张罐罐暖萌的正文配图
为这段方法论画一张手绘解释图
/ian-xiaohei-illustrations
```

**出图方式：** 默认输出英文提示词（零依赖，复制到 ChatGPT / 即梦 / Midjourney 即可）。装了图像 MCP 或配好 API key 后，可经 MCP 或 `scripts/generate.py` 直接出图——三种后端共用同一套风格定义，换后端不换画风。

### writting-assistant：主题 → 完整文案

```
帮我写一篇关于 ETF 定投的小红书文案
写一篇 AI 工具推荐的小红书
以这篇参考文章为素材写一篇小红书文案
```

全自动流程：需求分析 → 联网搜索资料 → 学习爆款风格 → 撰写文案 → 质量检测 → 存档。内置金融/科技/投资/保险四大分类，每类有独立文风标准。

## 依赖

| 插件 | 需要额外装的东西 |
|------|---------------|
| video-downloader | 自动装 yt-dlp；可选：Node.js ≥ 20（YouTube）、ffmpeg、aria2 |
| audio-transcribe | Mac: `pip3 install mlx-whisper zhconv` + `brew install ffmpeg`；Windows: `pip install faster-whisper zhconv` |
| text-refine | 无 |
| web-video-presentation | Node.js ≥ 20；合成音频可选 `mmx-cli`（MiniMax）或 `OPENAI_API_KEY`（也可换 ElevenLabs / edge-tts 等） |
| make-html-card | 无 |
| cover-image-prompt | 无 |
| writting-assistant | 无（Python 3 用于存档脚本） |

## 目录结构

```
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    ├── video-toolkit/
    │   └── skills/
    │       ├── video-downloader/
    │       ├── audio-transcribe/
    │       ├── text-refine/
    │       └── web-video-presentation/
    │           ├── references/
    │           ├── scripts/
    │           ├── templates/
    │           └── themes/
    ├── xiaohongshu-card/
    │   └── skills/
    │       ├── make-html-card/
    │       │   ├── assets/layouts/
    │       │   └── references/
    │       └── cover-image-prompt/
    └── writting-assistant/
        └── skills/
            └── writting-assistant/
                ├── references/
                ├── scripts/
                └── examples/
```
