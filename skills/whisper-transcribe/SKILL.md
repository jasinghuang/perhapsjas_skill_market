---
name: whisper-transcribe
description: 通用音频转录工具，使用 OpenAI Whisper 将视频/音频转录为字幕。触发词：转录、转文字、字幕提取、whisper、transcribe、语音识别
---

# Whisper Transcribe

> 将视频/音频文件转录为字幕文件

## 功能

- 支持多种视频/音频格式 (mp4, mp3, wav, etc.)
- 支持多种 Whisper 模型大小 (tiny/base/small/medium/large)
- 自动语言检测
- 多种输出格式 (SRT, Markdown, JSON)
- **默认 Markdown 格式带时间码和元信息**

## 使用方法

### 基本用法
```bash
# 转录视频（默认输出 Markdown）
python ${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/skill_main.py video.mp4

# 指定输出文件
python ${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/skill_main.py video.mp4 --output result.srt

# 指定模型大小
python ${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/skill_main.py video.mp4 --model large

# 指定语言
python ${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/skill_main.py video.mp4 --language zh

# 输出 SRT 格式
python ${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/skill_main.py video.mp4 --format srt
```

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `input` | 视频/音频文件路径 | 必需 |
| `--output, -o` | 输出文件路径 | 同目录 |
| `--model, -m` | Whisper 模型大小 | medium |
| `--language, -l` | 语言代码 | auto |
| `--format, -f` | 输出格式 (srt/md/json) | **md** |
| `--keep-timestamps, -t` | 保留时间码 | **false** |

## Whisper 模型选择

| 模型 | 大小 | 速度 | 准确率 | 推荐场景 |
|------|------|------|--------|----------|
| tiny | ~40MB | 最快 | 中等 | 快速预览 |
| base | ~140MB | 快 | 良好 | 日常使用 |
| small | ~460MB | 中等 | 很好 | 平衡性能 |
| **medium** | **~1.5GB** | **慢** | **优秀** | **高质量需求** |
| large | ~3GB | 最慢 | 最佳 | 专业制作 |

## 配置文件

配置文件位于 `${CLAUDE_PLUGIN_ROOT}/skills/whisper-transcribe/config.json`：

```json
{
  "model_size": "medium",
  "language": "auto",
  "output_format": "md",
  "keep_timestamps": false
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `model_size` | Whisper 模型大小 | medium |
| `language` | 语言代码 | auto |
| `output_format` | 输出格式 | md |
| `keep_timestamps` | Markdown 是否保留时间码 | false |

## 依赖

```bash
pip install openai-whisper zhconv
brew install ffmpeg
```

> **注**: `zhconv` 用于将繁体中文自动转换为简体中文

## 输出格式

### Markdown 格式（默认）

**不带时间码**（`keep_timestamps: false`，默认）：
```markdown
# 视频标题
---
## 元信息
- **转录工具**: OpenAI Whisper
- **模型大小**: medium
- **语言**: zh
- **转录时间**: 2024-01-15 10:30:00
- **段落数量**: 100
- **时间码**: 已移除
- **校准状态**: 未经过 LLM 校准（可能有错别字、同音字错误）

> 建议使用 `llm-refine` skill 进行校准

---

大家好

欢迎来到我的频道
```

### SRT 格式
```
1
00:00:01,000 --> 00:00:03,000
大家好

2
00:00:03,000 --> 00:00:05,000
欢迎来到我的频道
```

## 示例

```
用户: 转录这个视频 @video.mp4
用户: 把这个音频转成字幕
用户: whisper 转录 audio.mp3
```
