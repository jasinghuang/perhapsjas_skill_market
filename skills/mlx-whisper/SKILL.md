---

name: mlx-whisper
description: >
  音频/视频转录工具，使用 MLX-Whisper 将视频或音频文件转录为字幕。
  Apple Silicon 原生加速。当用户要转录、转文字、提取字幕、语音识别、
  whisper转录、音频转文字、视频转字幕、transcribe 时触发此 skill。
  输出 SRT 或 Markdown 格式。每次使用会询问模型和输出格式。
  接受 mp4、mp3、wav、m4a 等常见音视频格式。

---


# MLX Whisper

使用 MLX-Whisper（Apple Silicon 原生加速）将视频/音频转录为字幕。

## 首次依赖检查

使用前，检查以下依赖是否已安装。缺少则自动安装（不需要用户干预）：

```bash
pip3 install --break-system-packages mlx-whisper
brew install ffmpeg
pip3 install --break-system-packages zhconv    # 繁简转换（可选但推荐）
```

> macOS Homebrew Python 有 PEP 668 保护，直接 `pip install` 会报错，需要加 `--break-system-packages`。

检查方法：

- `python3 -c "import mlx_whisper"` — 失败则执行 `pip3 install --break-system-packages mlx-whisper`
- `ffmpeg -version` — 失败则执行 `brew install ffmpeg`

## 每次使用前的选择

**每次转录前，必须使用 AskUserQuestion 工具询问以下两个问题。** 不要静默使用默认值或读取 config.json 跳过询问。

### 1. 模型选择


| #   | 模型             | 大小     | 速度  | 准确率 | 适合场景           |
| --- | -------------- | ------ | --- | --- | -------------- |
| 1   | small          | ~459MB | 快   | 良好  | 快速预览，准确率要求不高   |
| 2   | large-v3-turbo | ~1.5GB | 较快  | 优秀  | **推荐**，速度和质量平衡 |
| 3   | large-v3       | ~2.9GB | 慢   | 最佳  | 最终版，最高准确率      |


用户选择后通过 `--model` 参数传给脚本。

### 2. 输出格式

选项如下：


| #   | 格式                 | 说明                                        |
| --- | ------------------ | ----------------------------------------- |
| 1   | **Markdown**       | 纯文本段落（非逐句分行），合并为自然段落，适合阅读和 text-refine 校准 |
| 2   | **SRT**            | 标准字幕格式，带时间轴，适合加载到播放器                      |
| 3   | **Markdown + 时间码** | 每段带时间戳，兼顾可读性和定位，适合回看视频对照                  |


- 用户选择后通过 `--format` 参数传给脚本
- 选 Markdown + 时间码时传 `--format md --keep-timestamps`
- Markdown 格式必须将 Whisper 逐句输出合并为自然段落，不要一行一句

## 使用方法

```bash
# 转录视频（默认 Markdown 格式）
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4

# 指定输出文件
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --output result.srt

# 指定模型
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --model large-v3

# 指定语言
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --language zh

# 输出 SRT 格式
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --format srt

# 保留时间码
python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py video.mp4 --keep-timestamps
```

## 命令行参数


| 参数                      | 说明                                | 默认值            |
| ----------------------- | --------------------------------- | -------------- |
| `input`                 | 视频/音频文件路径                         | 必需             |
| `--output, -o`          | 输出文件路径                            | 同目录，同文件名换后缀    |
| `--model, -m`           | 模型（small/large-v3-turbo/large-v3） | 读取 config.json |
| `--language, -l`        | 语言代码（auto/zh/en/ko/ja 等）          | auto           |
| `--format, -f`          | 输出格式（srt/md/json）                 | md             |
| `--keep-timestamps, -t` | Markdown 保留时间码                    | false          |


## 配置文件

首次使用时自动生成 `${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/config.json`：

```json
{
  "model": "large-v3-turbo",
  "language": "auto",
  "output_format": "md",
  "keep_timestamps": false
}
```

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

