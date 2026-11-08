---
name: audio-transcribe
description: >
  音频/视频转写工具：先检测环境，再由用户选择 Qwen3-ASR-1.7B 本地转写（推荐，Mac 用 MLX /
  Windows 用 PyTorch CUDA）或 ElevenLabs Scribe V2 在线转写，统一输出 TXT / JSON / SRT。
  当用户要转录、转文字、提取字幕、语音识别、音频转文字、视频转字幕、录音转文字、
  语音转文字、转写、听写、把视频变成文字稿、transcribe、speech to text 时触发。
  支持单个或批量文件（WAV/MP3/M4A/FLAC/MP4/MOV），Qwen 路线用 ForcedAligner
  获得真实词级时间戳，SRT 分句符合字幕规范（≤2 行、中文 ≤20 字/行、单条 ≤6 秒）。

---

# Audio Transcribe

两条路线，一次选择，统一产物（TXT + JSON + SRT）：

| 路线 | 模型 | 运行方式 |
| --- | --- | --- |
| **qwen（本地，推荐）** | Qwen3-ASR-1.7B + ForcedAligner-0.6B | Mac: mlx-qwen3-asr / Windows: 官方 qwen-asr + PyTorch CUDA |
| **scribe（在线）** | ElevenLabs scribe_v2 | 上传音频，需 `ELEVENLABS_API_KEY`，按量计费 |

## Agent 使用流程

### 1. 检测环境（只读，不安装）

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py --detect-env
# Windows 写法：python ${CLAUDE_PLUGIN_ROOT}\skills\audio-transcribe\run.py --detect-env
```

向用户转述第一行（如"检测到当前环境为 Windows，AMD64，本地 Qwen 路线状态：ready"）。
带 `--provider qwen|scribe` 会追加该路线的深度探测。

### 2. 询问转写方式（用户未明确指定时）

**必须先问，不得默认采用"推荐"，也不得自动走在线上传。** 用 AskUserQuestion：

```text
AskUserQuestion({
  questions: [{
    question: "请选择转写方式：",
    header: "转写方式",
    multiSelect: false,
    options: [
      {"label": "Qwen3-ASR-1.7B（推荐）", "description": "本地转写。<按环境填一句：Mac 用 MLX 8bit / Windows 检测到 CUDA 加速 / 无 CUDA 时注明 CPU 慢速>。首次使用需下载模型（约 2.5-4GB）"},
      {"label": "Scribe V2（在线）", "description": "将音频上传至 ElevenLabs 转写，需要 API 凭证，按用量计费"}
    ]
  }]
})
```

规则（务必遵守）：

- 用户已明确指定方式（如"用本地"/"用 scribe 转录"）→ 不再询问
- 本地路线不受支持（Intel Mac / Windows ARM）→ 在选项 description 中注明限制，不能标为可用
- 同一批任务复用本次选择；用户选择本地失败后**不自动切在线**，切换需用户重新明确选择
- 只准备所选路线的依赖：选 scribe 不安装/检查 PyTorch、MLX；选本地不要求 ElevenLabs 凭证
- 询问只有上面两个选项，不把 8bit/bf16/6bit 作为普通用户选项

### 3. 执行转写

```bash
# Mac
python3 ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/run.py <输入...> --provider qwen
# Windows
python ${CLAUDE_PLUGIN_ROOT}\skills\audio-transcribe\run.py <输入...> --provider scribe --language zh
```

`run.py` 按所选路线寻找/准备解释器（首次会安装依赖，打印实际使用的 Python），
然后调用 `skill_main.py`。阶段输出：`[环境检查] [准备] [转写] [对齐] [导出] [校验]`。

### 4. 汇报

最终输出包含每个文件的：产物路径、provider/模型/后端、媒体时长与总耗时、
警告（如对齐失败 → partial，SRT 未产出）。把这些转述给用户；
部分失败时明确哪些产物可用。

## 参数

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `input` | 一个或多个音视频文件（wav/mp3/m4a/flac/mp4/mov…） | 必需 |
| `--provider` | `qwen`（别名 local/qwen-local）或 `scribe`（别名 elevenlabs/online） | **必填**；缺失时退出码 2 |
| `--language, -l` | auto / zh / en / ja / ko 等；中英混合用 auto | auto |
| `--formats` | 逗号分隔：txt,json,srt | 三件套全出 |
| `--output, -o` | 输出目录 | 与输入同目录 |
| `--device` | auto / cpu / cuda:0（qwen Windows 路线） | auto |
| `--precision` | 8bit / bf16 / 6bit（**仅 Mac**，高级选项） | 8bit |
| `--diarize` | 说话人分离（仅 scribe，可能计费上浮） | 关 |
| `--audio-track` | 多音轨时指定音轨序号 | 主音轨 |
| `--no-progress` | 关闭进度行 | 进度开启 |

## 输出

每个输入在同目录产出同名三件套（原子写入，UTF-8 无 BOM）：

- `<stem>.txt` — 纯文本，按停顿分段
- `<stem>.json` — 统一 schema（provider/model/revision/dtype/language/words/segments/warnings）
- `<stem>.srt` — 标准 SRT：1..N 序号、`HH:MM:SS,mmm`、≤2 行、中文 ≤20 字/行（英文 ≤42 字符）、单条 ≤6 秒、时间轴以媒体 0 秒为原点、不重叠

对齐失败时状态为 **partial**：TXT/JSON 保留，SRT 不产出（绝不伪造时间轴）。
无语音时返回 no_speech + 空转写。长音频自动静音吸附分块（≤290s/块，低于对齐器 5 分钟上限），
中断后重新运行会复用已完成分块缓存。

## 行为变化（相对旧版）

- **Whisper 后端已移除**（MLX-Whisper / Faster-Whisper 及 `--model/--format/--keep-timestamps/--keep-context`、MD 输出不再存在）。需要 Whisper 时请显式说明，本 skill 不再提供。
- `--provider` 必填；产物从单文件变为 TXT+JSON+SRT 三件套；SRT 分句显著变细。
- 下游 `add-subtitle` / `video-tts` 兼容性不变（仍消费标准 SRT）；
  但 SRT 分句已较细，叠字幕前通常**不再需要** text-refine 断句（校准错别字仍可用）。

## 平台细节与排障（按需读取，勿在对话中展开）

- Mac / Apple Silicon：安装、8bit/bf16/6bit 权重表、dtype 说明 → [references/mac-mlx.md](references/mac-mlx.md)
- Windows / CUDA / CPU 模式 / WSL → [references/windows-torch.md](references/windows-torch.md)
- Scribe 凭证、参数、重试与计费 → [references/scribe.md](references/scribe.md)

## 与其它 skill 串联

```text
video-downloader → audio-transcribe → text-refine（可选校准）→ add-subtitle / video-tts
```

## 示例

```text
用户: 转录这个视频 video.mp4
用户: 把这三个视频都转成字幕（本地）
用户: 用 scribe 在线转写 meeting.m4a，中文
用户: --detect-env 看下我这台机器能不能跑本地
```
