---

name: audio-transcribe
description: >
  音频/视频转录工具，自动检测平台选择最优后端。
  Mac 使用 MLX-Whisper（Apple Silicon 原生加速），Windows 使用 Faster-Whisper（CUDA GPU 加速 / CPU 回退）。
  当用户要转录、转文字、提取字幕、语音识别、whisper转录、音频转文字、视频转字幕、transcribe 时触发。
  输出 SRT 或 Markdown 格式。每次使用会询问模型和输出格式。
  接受 mp4、mp3、wav、m4a 等常见音视频格式。

---

# Audio Transcribe

音频/视频转录工具，自动检测平台选择最优后端：
- **Mac**：MLX-Whisper（Apple Silicon 原生加速）
- **Windows**：Faster-Whisper（CUDA GPU 加速 / CPU int8 回退）

## 步骤 0：检测平台

运行以下命令检测当前平台：

```bash
python -c "import platform; print(platform.system())"
```

- 结果为 `Darwin` → Mac（使用 MLX-Whisper 后端）
- 结果为 `Windows` → Windows（使用 Faster-Whisper 后端）

记住检测结果，后续步骤根据平台分支。

## 首次依赖检查

根据平台检查依赖，缺少则自动安装（不需要用户干预）：

### Mac (Darwin)

检查方法：
- `python3 -c "import mlx_whisper"` — 失败则执行安装
- `ffmpeg -version` — 失败则执行安装

安装命令：

```bash
pip3 install --break-system-packages mlx-whisper zhconv
brew install ffmpeg
```

> macOS Homebrew Python 有 PEP 668 保护，需要加 `--break-system-packages`。

### Windows

检查方法：
- `python -c "from faster_whisper import WhisperModel"` — 失败则执行安装

安装命令：

```bash
pip install faster-whisper zhconv
```

- 不需要外部 ffmpeg（Faster-Whisper 内置 PyAV 解码）
- CUDA 自动检测：有 NVIDIA GPU → GPU 加速（float16）；无 GPU → CPU（int8 量化）

## 每次使用前的选择

**每次转录前，必须使用 AskUserQuestion 工具询问以下两个问题。不要静默使用默认值或读取 config.json 跳过询问。**

注意：AskUserQuestion 的每个 question 必须包含 `header` 字段。两个问题的 header 分别为 `"模型选择"` 和 `"输出格式"`。

### 1. 模型选择（根据步骤 0 的平台检测结果展示对应选项）

**Mac 模型选项：**

| # | 模型             | 大小     | 速度  | 准确率 | 适合场景           |
|---|----------------|--------|-----|-----|----------------|
| 1 | small          | ~459MB | 快   | 良好  | 快速预览，准确率要求不高   |
| 2 | large-v3-turbo | ~1.5GB | 较快  | 优秀  | **推荐**，速度和质量平衡 |
| 3 | large-v3       | ~2.9GB | 慢   | 最佳  | 最终版，最高准确率      |

**Windows 模型选项：**

| # | 模型     | 大小     | 速度  | 准确率 | 适合场景         |
|---|--------|--------|-----|-----|--------------|
| 1 | small  | ~461MB | 快   | 良好  | 快速预览         |
| 2 | medium | ~1.5GB | 中等  | 优秀  | **推荐**，速度和质量平衡 |
| 3 | large-v3 | ~2.9GB | 慢   | 最佳  | 最高准确率        |

用户选择后通过 `--model` 参数传给脚本。

### 2. 输出格式（所有平台通用）

| # | 格式                 | 说明                                        |
|---|--------------------|-------------------------------------------|
| 1 | **Markdown**       | 纯文本段落（非逐句分行），合并为自然段落，适合阅读和 text-refine 校准 |
| 2 | **SRT**            | 标准字幕格式，带时间轴，适合加载到播放器                      |
| 3 | **Markdown + 时间码** | 每段带时间戳，兼顾可读性和定位，适合回看视频对照                  |

- 用户选择后通过 `--format` 参数传给脚本
- 选 Markdown + 时间码时传 `--format md --keep-timestamps`
- Markdown 格式必须将 Whisper 逐句输出合并为自然段落，不要一行一句

## 使用方法

```bash
# 转录视频（默认 Markdown 格式）
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4

# 指定输出文件
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --output result.srt

# 指定模型
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --model large-v3

# 指定语言
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --language zh

# 输出 SRT 格式
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --format srt

# 保留时间码
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --keep-timestamps
```

## 命令行参数

| 参数                      | 说明                                | 默认值                      |
| ----------------------- | --------------------------------- | ------------------------ |
| `input`                 | 视频/音频文件路径                         | 必需                       |
| `--output, -o`          | 输出文件路径                            | 同目录，同文件名换后缀              |
| `--model, -m`           | 模型名称                              | large-v3-turbo (Mac) / medium (Win) |
| `--language, -l`        | 语言代码（auto/zh/en/ko/ja 等）          | auto                     |
| `--format, -f`          | 输出格式（srt/md/json）                 | md                       |
| `--keep-timestamps, -t` | Markdown 保留时间码                    | false                    |

## 输出格式

### Markdown（默认）

带元信息头部，段落按时间顺序排列。不带时间码时为纯文本段落，适合阅读和后续校准。

### SRT

标准字幕格式，带时间轴，适合播放器加载。

## 示例

```
用户: 转录这个视频 video.mp4
用户: 把这个音频转成字幕
用户: whisper 转录 audio.mp3，用 SRT 格式
用户: 用 large-v3 模型转录这个文件
```
