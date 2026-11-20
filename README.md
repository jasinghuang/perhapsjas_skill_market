# perhapsjas Skill Market

面向视频内容创作的 AI Agent 插件市场，支持 Codex 和 Claude Code。

当前提供 **`video-toolkit`** 插件，包含视频下载、音视频转录、字幕校对翻译、配音与视频表演提示词五个 skill。可以按任务单独使用，也可以串联完成下载 → 转录 → 校对 → 配音。

## 安装

### Codex 桌面端

在“添加插件市场”窗口填写：

| 字段 | 填写内容 |
| --- | --- |
| 来源 | `https://github.com/jasinghuang/perhapsjas_skill_market.git` |
| Git 引用 | 留空，使用仓库默认分支；新添加时也可明确填写 `main` |
| 稀疏路径 | **留空** |

来源填写仓库根地址即可，不带 `.git` 的 `https://github.com/jasinghuang/perhapsjas_skill_market` 也支持。GitHub 简写 `jasinghuang/perhapsjas_skill_market` 也是受支持的来源格式。

本仓库的市场清单位于根目录下的 `.claude-plugin/marketplace.json`，插件位于 `plugins/video-toolkit/`，无需设置稀疏路径。窗口里灰色的 `plugins/codex` 是占位示例，不是本仓库的路径。

添加后，选择 **`perhapsjas_skill_market`** 市场，安装 **`video-toolkit`**，然后在新聊天中使用 skill。

**添加市场、安装插件、调用 skill 是三个步骤。** `oscar-performance` 等 skill 包含在 `video-toolkit` 中，不是单独的市场安装条目。

来源格式、Git 引用与稀疏路径的说明见 [OpenAI 官方插件文档](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)。

### Codex CLI

```bash
codex plugin marketplace add https://github.com/jasinghuang/perhapsjas_skill_market.git
codex plugin add video-toolkit@perhapsjas_skill_market
```

### Claude Code

在 Claude Code 中执行：

```text
/plugin marketplace add jasinghuang/perhapsjas_skill_market
/plugin install video-toolkit@perhapsjas_skill_market
```

安装后重启 Claude Code，使插件在新会话中加载。

## 包含的 skills

| Skill | 用途 | 主要交付 |
| --- | --- | --- |
| [video-downloader](plugins/video-toolkit/skills/video-downloader/SKILL.md) | 下载 Bilibili、YouTube 视频，支持指定画质、批量和播放列表 | 本地视频、音频或站点已有字幕 |
| [audio-transcribe](plugins/video-toolkit/skills/audio-transcribe/SKILL.md) | 将音频或视频忠实转录为原语言文字，支持本地 Qwen3-ASR 或在线 ElevenLabs Scribe V2 | 单行 SRT、带时间码或无时间码的 Markdown |
| [text-refine](plugins/video-toolkit/skills/text-refine/SKILL.md) | 校对转录文本、修正术语与标点；明确要求时翻译 | 保持输入格式的 SRT、Markdown 或 TXT；SRT 默认保留时间轴和条目数 |
| [video-tts](plugins/video-toolkit/skills/video-tts/SKILL.md) | 文稿旁白或按 SRT 时间窗配音，支持本地 Qwen3-TTS、ElevenLabs 及预设音色或参考录音克隆 | 独立音频、配音成片或字幕，按所选任务交付 |
| [oscar-performance](plugins/video-toolkit/skills/oscar-performance/SKILL.md) | 从剧本、分镜或已有提示词设计、修订、诊断人物表演，并编译视频生成提示词 | 表演节拍、逐拍证据检查、可复制的视频提示词；不执行视频生成 |

## 使用示例

安装后，直接向 Agent 说明要使用的 skill、输入素材及输出要求：

```text
使用 video-downloader 下载这个视频，先查看可选画质：
[视频链接]
```

```text
使用 audio-transcribe 将这个视频转成原语言 SRT，使用本地模型：
[本地视频路径]
```

```text
使用 text-refine 校对这份 SRT，保留原语言、全部时间轴和条目数，修正错字与术语。
[字幕文件路径]
```

```text
使用 video-tts 将这份文稿做成普通旁白，输出独立音频。
[文稿文件路径]
```

```text
使用 oscar-performance 优化下面的提示词，保留剧情、台词、镜头和时长，
重点补足人物感知、处理、行动选择与状态承接，并独立验收最终可复制正文。
[现有提示词]
```

## 运行环境

安装插件只安装 skill 和随附脚本。下载、转录、配音任务运行时再检测所需环境，并按选择的路线准备依赖：

- **视频下载**：使用独立环境中的 `yt-dlp`；音视频合并、音频提取需要 `ffmpeg`；YouTube 下载还需要可用的 JavaScript runtime。
- **本地转录、配音**：Apple Silicon Mac 使用 MLX；Windows 的本地路线按硬件检测使用 PyTorch，具体支持范围见对应 skill。首次使用需要下载模型。
- **在线转录、配音**：需要 ElevenLabs API Key，并按账户费率计费；相关文本或音频会上传至该服务。
- **文本校对、表演提示词**：由当前 Agent 执行文字处理，无需运行本地音视频推理模型。

各任务的后端、音色与交付格式以实际环境检测和用户选择为准；详细操作见对应 `SKILL.md`。

## 更新

### Codex

先刷新市场副本，再更新已安装插件：

```bash
codex plugin marketplace upgrade perhapsjas_skill_market
codex plugin add video-toolkit@perhapsjas_skill_market
```

查看市场与安装状态：

```bash
codex plugin marketplace list
codex plugin list --marketplace perhapsjas_skill_market --available --json
```

### Claude Code

```bash
claude plugin marketplace update perhapsjas_skill_market
claude plugin update video-toolkit@perhapsjas_skill_market
```

更新后，Codex 使用新聊天加载新版；Claude Code 重启后应用更新。两者分别维护市场副本和安装缓存，在一个客户端更新不会自动更新另一个。

如果市场里没有单独的 `oscar-performance` 条目，安装 `video-toolkit` 即可。如果已安装但仍是旧内容，依次刷新市场、更新插件，再重新加载会话。已添加的市场保持原来的 Git 引用设置；刷新时直接使用更新命令。

## 仓库结构

```text
.claude-plugin/marketplace.json    # Marketplace catalog
plugins/video-toolkit/skills/
├── video-downloader/
├── audio-transcribe/
├── text-refine/
├── video-tts/
└── oscar-performance/
```

表演方法与文件导航见 [oscar-performance 说明](plugins/video-toolkit/skills/oscar-performance/README.md)。
