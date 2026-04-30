---
name: llm-refine
description: LLM 文本校准与翻译工具。自动检测语言，中文直接校准，非中文翻译后校准。触发词：校准、refine、翻译、校对、LLM校准、字幕校对
---

# LLM Refine

> 文本校准 + 翻译，支持多种视频类型的专业术语识别

## 功能

- **自动语言检测**：识别输入文本语言
- **智能流程**：中文直接校准，非中文翻译后校准
- **视频类型检测**：自动识别科技/医疗/财经/通用类型
- **专业术语纠正**：根据视频类型使用专业提示词

## 处理流程

```
输入文本 → 检测语言 → 中文? → 直接校准
                        → 非中文? → 翻译→中文 → 校准
```

## 使用方法

### 基本用法
```bash
# 校准字幕文件
python ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/skill_main.py input.srt

# 指定输出文件
python ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/skill_main.py input.srt --output refined.md

# 强制翻译（即使检测为中文）
python ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/skill_main.py input.txt --translate

# 禁用校准
python ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/skill_main.py input.srt --no-refine

# 指定批处理大小
python ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/skill_main.py input.srt --batch-size 30
```

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `input` | 输入文件 (SRT/MD/TXT) | 必需 |
| `--output, -o` | 输出文件路径 | 同目录 `_refined.md` |
| `--refine` | 启用校准 | True |
| `--no-refine` | 禁用校准 | - |
| `--translate, -t` | 强制翻译为中文 | False |
| `--no-translate` | 禁用自动翻译 | - |
| `--batch-size, -b` | 批处理大小 | 45 |

### 翻译行为

| 配置值 | 行为 |
|--------|------|
| `translate: false`（默认） | 中文直接校准，非中文翻译后校准 |
| `translate: true` | 强制翻译所有文本为中文 |
| `--translate` 命令行参数 | 强制翻译（覆盖配置） |
| `--no-translate` 命令行参数 | 保留原文不翻译 |

## 视频类型检测

自动检测以下类型并使用对应提示词：

| 类型 | 关键词示例 | 专业术语 |
|------|----------|---------|
| **医疗** | 膈肌、骨盆、体态、康复 | 腹内压、骶骨、胸骨角 |
| **科技** | 代码、编程、API、Cursor | Cursor、Google Flights |
| **财经** | 股票、基金、投资、K线 | 涨停板、市盈率 |
| **通用** | 其他 | 常见ASR错误纠正 |

## 配置文件

首次使用前，复制配置模板并填入你的 API 密钥：

```bash
cp ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/config.example.json ${CLAUDE_PLUGIN_ROOT}/skills/llm-refine/config.json
```

然后编辑 `config.json` 填入你的 API key。

配置模板：

```json
{
  "model": "qwen3.5-plus",
  "api_key": "YOUR_API_KEY_HERE",
  "base_url": "https://api.openai.com/v1",
  "temperature": 0.3,
  "max_tokens": 4000,
  "batch_max_tokens": 8000,
  "batch_size": 45,
  "translate": false,
  "parallel_batches": 3
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `model` | LLM 模型 | qwen3.5-plus |
| `api_key` | API 密钥 | - |
| `base_url` | API 端点 | OpenAI API |
| `temperature` | 生成温度 | 0.3 |
| `max_tokens` | 单次请求最大 token | 4000 |
| `batch_max_tokens` | 批处理最大 token | 8000 |
| `batch_size` | 每批处理字幕条数 | 45 |
| `translate` | 是否翻译非中文 | false |
| `parallel_batches` | 并行处理批次数 | 3 |

## 输入格式

支持 SRT、Markdown、纯文本格式。

## 依赖

```bash
pip install openai
```

## 示例

```
用户: 校准这个字幕 @video.srt
用户: 帮我校对一下这段文字
用户: translate and refine @audio.srt
```
