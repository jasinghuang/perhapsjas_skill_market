# perhapsjas_skill_market

内容创作者的 Claude Code 插件集。视频处理、文案创作、图文排版，三个插件覆盖从小白到发布的完整链路。

## 插件一览

| 插件 | 干什么的 | 包含 Skill |
|------|---------|-----------|
| **video-toolkit** | 粘贴链接，拿到干净字幕。下载、转录、校准一条龙 | `video-downloader` `audio-transcribe` `text-refine` |
| **xiaohongshu-card** | 小红书图文卡片 + 封面概念图提示词 | `make-html-card` `cover-image-prompt` |
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
    │       └── text-refine/
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
