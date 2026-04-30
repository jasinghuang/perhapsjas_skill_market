# Claude Media Toolkit

一站式视频字幕工作流插件：下载 → 转录 → 校准

## 包含 Skills

| Skill | 功能 | 命令 |
|-------|------|------|
| **bili-download** | B站视频下载，支持批量/会员/QuickTime格式 | `/bili-download` |
| **whisper-transcribe** | 音频/视频转录为字幕 (SRT/MD/JSON) | `/whisper-transcribe` |
| **llm-refine** | LLM 文本校准与翻译 | `/llm-refine` |

## 工作流

```
B站视频 URL
  ↓ bili-download    → 下载视频文件
  ↓ whisper-transcribe → 转录为字幕 (SRT/MD)
  ↓ llm-refine       → 校准错别字/翻译
  → 最终字幕文件
```

## 安装

```bash
# 添加市场
/plugin marketplace add your-github-username/claude-media-toolkit

# 安装插件
/plugin install media-toolkit@claude-media-toolkit
```

## 首次使用

llm-refine 需要 API 密钥，首次使用前配置：

```bash
cp skills/llm-refine/config.example.json skills/llm-refine/config.json
# 编辑 config.json，填入你的 API key
```

## 依赖

```bash
# bili-download
pip install yt-dlp

# whisper-transcribe
pip install openai-whisper zhconv
brew install ffmpeg

# llm-refine
pip install openai
```

## 更新

用户开启自动更新后，推送到 GitHub 即可。记得更新 `.claude-plugin/marketplace.json` 中的 `version` 字段。
