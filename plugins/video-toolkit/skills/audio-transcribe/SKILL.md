---
name: audio-transcribe
description: >
  音频/视频转录工具，自动检测平台选择最优后端。
  Mac 使用 MLX-Whisper（Apple Silicon 原生加速），Windows 使用 Faster-Whisper（CUDA GPU 加速 / CPU 回退）。
  当用户要转录、转文字、提取字幕、语音识别、whisper转录、音频转文字、视频转字幕、
  录音转文字、语音转文字、转写、听写、把视频变成文字稿、transcribe、speech to text 时触发。
  支持单个或批量转录多个文件，输出 SRT / Markdown / JSON。每次使用会询问模型和输出格式。
  接受 mp4、mp3、wav、m4a 等常见音视频格式。

---

# Audio Transcribe

音频/视频转录：Mac 走 MLX-Whisper（Apple Silicon 原生加速），Windows 走 Faster-Whisper（CUDA / CPU）。

## 入口：始终通过 run.py 调用

```bash
# Mac
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py <输入...> [参数...]

# Windows
python ${CLAUDE_PLUGIN_ROOT}\skills\audio-transcribe\run.py <输入...> [参数...]
```

`run.py` 负责选解释器，然后执行 `skill_main.py`。它解决的核心问题：

> Homebrew / pyenv 升级 Python 后，`python3` 会指向新版本（例如 3.15），
> 而 `mlx-whisper` 仍装在旧版本（例如 3.14）的 site-packages 里。
> 这时直接跑 `skill_main.py` 会误判“依赖缺失”，触发一次几 GB 的重复安装。

查找顺序：上次成功使用的解释器 → 当前解释器 → PATH 上的 python3 → Homebrew 版本化 Python（3.16→3.9）→ pyenv → `/usr/bin/python3`。逐个用 `import mlx_whisper`（Windows 为 `faster_whisper`）验证，**有就复用，全都找不到才安装**。

运行时会打印实际使用的解释器：

```text
[audio-transcribe] Using /opt/homebrew/bin/python3.14 (transcription backend already installed)
```

看到这行说明命中了已有环境，没有重新安装任何东西。把它转述给用户，让用户知道用的是哪个 Python。

安装只在所有候选都没有依赖时发生，且会跳过 `/usr/bin/python3`（系统 Python 需要 sudo）。

## 平台与后端

| 平台 | 后端 | 加速 |
| --- | --- | --- |
| macOS (Apple Silicon) | MLX-Whisper | Metal / MLX |
| Windows + NVIDIA | Faster-Whisper | CUDA float16 |
| Windows 无 GPU | Faster-Whisper | CPU int8 |

Mac 需要外部 ffmpeg；Windows 不需要（Faster-Whisper 内置 PyAV 解码）。

## 每次使用前的选择

**每次转录前用 AskUserQuestion 询问模型和输出格式**，不要静默使用默认值。若用户已明确指定（如“用 large-v3 转成 SRT”），可跳过询问。

注意 AskUserQuestion 的真实 schema：每个选项是 `{label, description}`（不是 `value`），必须提供 `multiSelect`，`header` 控制在 12 字符以内。

### Mac 选项

```text
AskUserQuestion({
  questions: [
    {
      question: "选择转录模型：",
      header: "模型",
      multiSelect: false,
      options: [
        {"label": "large-v3-turbo (推荐)", "description": "~1.5GB，准确率接近 large-v3，速度快 3-4 倍"},
        {"label": "large-v3 (最高准确率)", "description": "~2.9GB，最慢但最准，适合术语密集内容"},
        {"label": "small (快速预览)", "description": "~459MB，最快，错误率明显更高"}
      ]
    },
    {
      question: "选择输出格式：",
      header: "输出格式",
      multiSelect: false,
      options: [
        {"label": "SRT (标准字幕)", "description": "带时间轴，播放器 / 视频平台可直接加载"},
        {"label": "Markdown (纯文本段落)", "description": "合并成自然段落，适合阅读和二次编辑"},
        {"label": "Markdown + 时间码", "description": "段落形式但保留时间码，兼顾可读性与定位"}
      ]
    }
  ]
})
```

### Windows 选项

模型选项把 large-v3-turbo 换成 `medium`（约 1.5GB，兼顾速度和准确率），其余相同。

参数映射：

- `srt` → `--format srt`
- `md` → `--format md`
- `md-timestamps` → `--format md --keep-timestamps`

## 使用方法

```bash
# 单个文件，输出同名 .md
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py video.mp4

# 指定输出文件（后缀同时决定格式）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py video.mp4 -o result.srt

# 批量：多个输入 + 输出目录
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py a.mp4 b.mp4 c.mp4 --format srt --output ~/subtitles

# 指定模型 / 语言
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py video.mp4 --model large-v3 --language zh

# Markdown 保留时间码
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py video.mp4 --format md --keep-timestamps
```

批量任务顺序执行，单个文件失败不会中断其余文件；结束时汇总失败项，并以非零退出码退出。

- **进度显示**：转录时默认每 ~2 秒打印一行 `42.1% 12:30 / 29:13`；重定向到日志时同样可见。`--no-progress` 可关闭。

## 参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `input` | 一个或多个音视频文件路径 | 必需 |
| `--output, -o` | 单个输入时为文件路径；多个输入时为目录。`.srt/.md/.json` 后缀会自动决定格式 | 同目录、同文件名 |
| `--model, -m` | 模型名（Mac：tiny / small / medium / large-v3 / large-v3-turbo） | large-v3-turbo (Mac) / medium (Win) |
| `--language, -l` | 语言代码（auto/zh/en/ko/ja 等） | auto |
| `--format, -f` | 输出格式（srt/md/json） | md，或由 `-o` 后缀推断 |
| `--keep-timestamps, -t` | Markdown 保留时间码 | false |
| `--keep-context` | 让每个 30s 窗口参考上一窗口的文本（见下方常见问题） | false（不参考上文） |
| `--no-progress` | 关闭实时转录进度输出 | 进度开启 |

模型名写错时 Mac 后端会直接报错并列出可用模型，不会静默回退到别的模型。

## 输出

- 每个输入生成一个文件，默认与输入同目录、同名
- **SRT**：标准字幕，带时间轴
- **Markdown**：带 Meta 头部（后端、模型、检测到的语言、时间、段数）
- **JSON**：`{"segments": [{"start": 0.0, "end": 1.0, "text": "..."}], "language": "en"}`

Whisper 的 SRT 分段可能较长（单条约 10-16 秒）。如果下游要用 `add-subtitle` 叠字幕（要求每行 ≤12 个中文字符），先跑 `text-refine` 做断句和校准。

## 依赖与故障排查

### Mac

- `mlx-whisper` + `zhconv`：`python3 -m pip install --break-system-packages mlx-whisper zhconv`
- `ffmpeg`：`brew install ffmpeg`

Homebrew Python 有 PEP 668 保护，安装时必须加 `--break-system-packages`。

### Windows

- `faster-whisper` + `zhconv`：`python -m pip install faster-whisper zhconv`
- 不需要外部 ffmpeg

### 常见问题

**“明明装过却提示缺失”**：通常是 Homebrew / pyenv 切换了 `python3` 版本，包还留在旧版本里。用 `run.py` 会自动复用旧环境；如果它选中的解释器不是预期的，再手动确认一次。

**模型会重复下载吗**：不会。模型缓存在 `~/.cache/huggingface/hub/models--mlx-community--whisper-*`，脚本会打印 `Cached: yes/no`。缓存跨 Python 版本共享，只要解释器选对就不会重下。

**确认当前用的是哪个 Python**：`run.py` 第一行会打印解释器路径；也可以手动 `python3.14 -c "import mlx_whisper"` 验证。

**音乐开头字幕提前/时间戳钉在 0:00**：Whisper 段级时间戳在窗口以非语音开头时会把首条 segment 起点钉在窗口起点。后端已默认开启 `word_timestamps` 并用词边界校正 segment 起止，无需额外操作。

**为什么默认不参考上文（condition_on_previous_text=False）**：Whisper 默认把上一窗口的解码文本喂回下一窗口当上下文；一旦音乐/静音段产生幻觉文本，会连锁污染后面所有窗口，表现为"复读机"循环或越转越差。默认关闭后每个窗口独立解码，幻觉不会扩散；代价是跨窗口边界的句子衔接和稀有术语一致性略降，正常语音内容差异极小（实测 11 分钟视频 ±8/1960 词）。确有需要（术语密集的长讲座）时加 `--keep-context` 打开。

## 与其它 skill 串联

```text
video-downloader → audio-transcribe → text-refine → add-subtitle
```

## 示例

```text
用户: 转录这个视频 video.mp4
用户: 把这三个视频都转成字幕
用户: whisper 转录 audio.mp3，用 SRT 格式
用户: 用 large-v3 模型转录这个文件，输出到 ~/subtitles
```
