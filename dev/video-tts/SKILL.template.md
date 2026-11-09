---
name: video-tts
description: >
  文稿旁白与 SRT 时间轴配音。本地 Qwen3-TTS（Apple Silicon MLX / Windows NVIDIA PyTorch）
  或 ElevenLabs 在线；预设音色或参考音频克隆；输出独立音频、成片或字幕。
  当用户要视频配音、中文配音、SRT 配音、字幕转语音、文稿旁白、voiceover、dubbing、TTS 时触发。
  只支持本文件列出的两条路线；不提供文字设计音色、百炼或 Edge TTS。
---

# video-tts

把文稿或 SRT 做成配音：普通旁白按自然时长；对齐配音按 SRT 时间窗放置语段、补静音，必要时（仅段内）在 1.20 倍以内加速。支持本地 Qwen3-TTS（Mac MLX / Windows NVIDIA torch）与 ElevenLabs，预设音色或参考音频克隆。

**文件形态**：本 skill 目录只有两个文件——`SKILL.md`（本业务说明）和同级 `runner.py`（固定执行脚本）。只读本文件；`runner.py` 只在系统上执行，不需要进入对话、复制或重写。

**始终由当前 Agent 独立完成**：不创建子 Agent、不委派、不设置协作角色、不启用自动升级选项，也不建议用户切换协作模式。所有需要用户回答的事项必须使用 `AskUserQuestion`（其他宿主用等价的结构化输入控件）；普通消息只用于说明、试听和进度，不能用文字选项、编号或等待超时代替控件。已在本任务明确的选择不重复问；技术事实先通过检测、读取文档或验证解决。宿主没有控件时说明能力缺失，等待用户明确调整要求。

## 1. 先检测，再给选项

每次任务新建独立目录，只放 `task.json`、`work/` 和交付物；不要复制 `runner.py`。runner 固定在 skill 目录，与 `SKILL.md` 同级。

**runner 路径解析（必须相对 skill 目录，不依赖当前工作目录）：**

- Claude Code：`"${CLAUDE_PLUGIN_ROOT}/skills/video-tts/runner.py"`。
- ZCode / 其他插件宿主：使用本次加载到的 `SKILL.md` 的**父目录**，拼 `runner.py`（插件缓存路径也可，如 `.../skills/video-tts/runner.py`）。
- 宿主只给相对路径时，先按插件根或工作区解析成绝对路径；拿不到 skill 目录就停止并说明能力缺失，不要猜路径。
- 运行前确认 `runner.py` 与 `SKILL.md` 同级且存在；缺失说明插件包不完整，停止并告知用户，不要回退旧缓存、复制或重建 runner。

先运行只读检测：

```bash
python "<skill目录>/runner.py" --detect
```

`--detect` 只报告能力，不安装、不下载、不合成。状态：`ready`（已验证可执行）、`needs_setup`（适用但需装依赖/首次下载）、`unsupported`（硬件/平台不支持，不作为选项推荐）、`unknown`（探测失败，不能当作可用）。把结论转述给用户，不贴原始 JSON。

| 平台/路线 | 预设音色 | 参考克隆 | 验证重点 |
| --- | --- | --- | --- |
| Apple Silicon macOS | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16` | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` | arm64、Metal、`mlx_audio` API |
| Windows x64 + NVIDIA | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | CUDA wheel、真实张量运算、`qwen_tts` API |
| ElevenLabs | 账户可访问的 `voice_id` | 已有/新建的 `voice_id` | 鉴权、模型、音色、克隆能力 |

固定规则：

- 本地 CustomVoice 只做预设，Base 只做克隆，不能互相替代；不自动换 0.6B、量化、VoiceDesign 或在线。
- Mac 用 `mlx-audio`；不混用 `odiak/Qwen3-TTS-MLX` 的依赖、模型格式或参数名。
- Windows 用官方 `qwen_tts.Qwen3TTSModel`：预设 `generate_custom_voice`；克隆先 `create_voice_clone_prompt` 一次，再复用 `generate_voice_clone`；参数名是 `speaker`/`language`。
- ElevenLabs 的 `model_id` 与 `voice_id` 独立；在线模型只用 `eleven_multilingual_v2`（质量）或 `eleven_flash_v2_5`（低延迟；可用 `language_code`）。
- 密钥只从环境读 `ELEVENLABS_API_KEY`；不写入 task/脚本/日志/result，不打印，不因检测到密钥自动选在线。
- 只读检测和列音色用标准库 GET；合成/克隆用 `requests`，不引入 ElevenLabs SDK。

## 2. 需要用户决定的事项

未在本任务明确的事项用控件收集；互不依赖的可同批，依赖前一项的分批展示。

1. **mode**：普通旁白（文稿/从 SRT 提取正文，自然时长）或对齐配音（SRT/视频时间轴）。用户已明确就直接用；含义不清才问。普通旁白即使有视频，也不自动改成对齐配音。
2. **provider**：展示 ready 和可安装路线，说明联网/鉴权/本地资源；unsupported 不作为可选。只有一条路时也用二选一确认（执行/暂不执行）。已装环境、API Key、历史偏好只作推荐值，不能代替本次选择。
3. **音色来源**：预设或克隆，只展示所选后端支持的。
4. **声音设置**：
   - 本地预设：从 `--list-voices --provider local` 选 `speaker`（缓存时读模型配置，未缓存时用模型卡列表；加载时仍按真实 `supported_speakers` 校验）；语气用 `parameters.instruct`（仅预设）。
   - 本地克隆：参考音频 + **与录音对应的准确参考文本**；参考音频必须可解码且有人声。
   - 在线预设/已有克隆：选账户可访问的 `voice_id`；`--list-voices --provider elevenlabs` 可列出（GET，不合成、不计费）。音色多时先筛选，再给 2–4 个候选。
   - 在线新建克隆：提供参考录音，`reference_text` 不强制；创建前说明会上传录音并可能计费。
   - 在线模型：`eleven_multilingual_v2` 或 `eleven_flash_v2_5`；不可用用控件改选，不自动换。
5. **交付格式**（多选）：独立音频、成片、字幕。没有视频不提供成片；只提供音频时不声称会生成视频。成片默认替换原声（本版不做原声压低混入）。
6. **在线授权**：说明文本/参考音频会上传 ElevenLabs、按账户费率计费；同一批已授权不重复确认，改变服务/模型/范围时重新收集。
7. **是否允许润色**：对齐超长时默认不允许；允许时最多额外合成两次，只改溢出语段。
8. **覆盖已有文件**：默认自动编号；要覆盖用控件确认，同一任务不重复问。
9. **失败后的处理**：重试、修复环境、改参数、换音色/模型或停止；按控件执行，不自行换 provider。

试听：用户要求时做只含一句的 preview 任务，`output.deliver=["audio"]`。preview 与正式任务尽量放同一任务目录（不同 `task.json` 文件名），复用 `clone.json`；分目录则把 preview 的 `voice_id` 写入正式任务，正式任务用 `voice.source="clone"` + 该 `voice_id`、`reference_audio=null`，不重复创建。

## 3. 读取与语义分段

### 3.1 普通旁白

- 输入可以是文稿或 SRT 正文；先读完再分段。
- 按句意、段落和朗读节奏组织；不要求固定条数、固定时长或先补句末标点。
- 保留原文：不遗漏、不重复、不重排；不借分段改写/精简/纠错。字幕纠错/翻译先交给 `text-refine`，除非用户明确授权。
- 段间停顿由 `timing.pause_between_sec` 控制（默认 0.30s）；runner 只对超长文本做引擎级切块（本地 280 字符、在线 2000 字符），不改文字。

### 3.2 对齐配音

- 读完整条 SRT，把碎片字幕合并为自然语段；语段可以不同于最终字幕的分段。
- 每段保留来源：`source_indices` 写原始 SRT 序号（可选但推荐）；`start_sec` 取首条起点，`end_sec` 取末条终点。
- 覆盖全部条目、顺序递增、恰好一次；语义完整优先，句末标点/时长/条数只作辅助；无标点字幕也能工作。
- 中文直接拼接；ASCII 单词边界需要时补空格；不凭空加标点。
- 组内文本与源字幕不一致（授权润色除外）必须先说明；runner 不检查语义覆盖。
- 时间轴重叠、零/负窗口、起点不递增：先修正或让 runner 在合成前报错；不要靠截断或重叠解决。
- 读取 SRT 兼容 UTF-8 BOM；其他编码先识别转换或询问，不能静默丢字/换编码。task.json 统一 UTF-8。

## 4. task.json：唯一任务入口

runner 只接受 `task.json` 路径；正文、参数、路径全部走 JSON，不从命令行读正文，不插入源码。用 JSON 序列化生成，正文中的引号/换行/反斜杠由序列化器转义。文件 UTF-8，不允许注释、尾逗号、NaN/Infinity。相对路径相对 task.json 所在目录。

### 4.1 完整示例（Mac 本地预设、普通旁白）

```json
{
  "schema_version": 1,
  "mode": "narration",
  "provider": "local",
  "backend": "mlx_audio",
  "model_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
  "language": "Chinese",
  "voice": {
    "source": "preset",
    "speaker": "Serena",
    "voice_id": null,
    "reference_audio": null,
    "reference_text": null,
    "name": null
  },
  "parameters": {"instruct": "温暖、自然"},
  "timing": {"max_speed": 1.2, "safety_gap_sec": 0.1, "pause_between_sec": 0.3},
  "allow_text_edits": false,
  "polish": {"attempt": 0, "max_attempts": 2},
  "input": {"srt": null, "video": null},
  "output": {
    "directory": "output",
    "deliver": ["audio", "subtitle"],
    "audio_format": "wav",
    "sample_rate": 48000,
    "overwrite": false
  },
  "segments": [
    {"id": 1, "text": "第一段旁白。", "start_sec": null, "end_sec": null},
    {"id": 2, "text": "第二段旁白。", "start_sec": null, "end_sec": null}
  ]
}
```

### 4.2 路线差异

- **对齐配音**：`mode="aligned"`；`input.srt` 必填，`input.video` 可选；`segments` 的 `start_sec`/`end_sec` 必填，`source_indices` 可选。
- **本地克隆**：`model_id` 换成 Base；`voice.source="clone"`，填 `reference_audio` + `reference_text`，`speaker`/`voice_id` 为 `null`；`parameters` 置 `{}`。
- **Windows**：`backend="qwen_tts"`；模型 ID 换 `Qwen/...-CustomVoice` 或 `Qwen/...-Base`；其余相同。
- **ElevenLabs**：`provider="elevenlabs"`、`backend="elevenlabs_http"`；`voice.voice_id` 必填（新建克隆时为 `null` + `reference_audio`）；`parameters` 可用 `voice_settings`/`output_format`/`remove_background_noise`；`voice_id` 与 `model_id` 分开。

### 4.3 字段规则

- `mode`：`narration`/`aligned`。`provider`：`local`/`elevenlabs`。`backend`：本地 `mlx_audio`/`qwen_tts`；在线固定 `elevenlabs_http`。
- `model_id` 必须与后端和音色来源精确匹配（见 §1）；不写 0.6B、量化、VoiceDesign、百炼模型。
- `language`：本地用 Qwen3-TTS 语言名（`Chinese`…`Italian`、`Beijing_dialect`、`Sichuan_dialect`、`auto`）；在线用语言名或 `auto`。runner 规范化为小写，不支持则在合成前报错。
- `voice.source`：
  - 本地预设：`speaker` 必填，`voice_id`/`reference_*` 为 `null`。
  - 本地克隆：`reference_audio` + `reference_text` 必填，`speaker`/`voice_id` 为 `null`。
  - 在线预设/已有克隆：`voice_id` 必填，`reference_*` 为 `null`；已有克隆带参考音频会警告且不上传。
  - 在线新建克隆：`voice_id=null`，`reference_audio` 必填，`reference_text` 可为 `null`，`name` 可选；runner 写 `clone.json`，重跑按参考内容哈希 + 名称复用，避免重复创建。
- `parameters`：本地只允许 `instruct`（仅预设）；在线只允许 `voice_settings`（`stability`/`similarity_boost`/`style`/`use_speaker_boost`）、`output_format`（默认 `mp3_44100_128`；也可 `mp3_22050_32`…`mp3_44100_192` 或 `wav_16000`…`wav_48000`；44.1kHz WAV/高码率格式可能需要 Pro+，被拒时用控件改选）、`remove_background_noise`。未知字段在合成前报错；采样参数用内部默认值。
- `timing.max_speed`≤`1.20`（仅对齐段内加速）；`safety_gap_sec` 默认 `0.10`；`pause_between_sec` 仅普通旁白，默认 `0.30`。
- `allow_text_edits`：只有用户明确允许润色时为 `true`。`polish.attempt` 从 0 开始，每次重跑 +1，`max_attempts`≤2。
- `input.srt`：对齐必填；普通旁白可选（命名/追溯）。`input.video`：出成片或对齐要按视频结尾算最后窗口时必填。
- `output.deliver`：`audio`/`video`/`subtitle` 多选；`video` 需要 `input.video`。`audio_format` 只能 `wav`，`sample_rate` 只能 `48000`；`overwrite` 默认 false。
- `segments`：顺序固定、`id` 唯一、`text` 非空。普通旁白时间字段为 `null`；对齐必须有限、非负、`end>start`、起点严格递增。runner 按下一段起点/媒体末尾算窗口，不盲信自报时长。`source_indices`/`original_text` 可选。
- 对齐窗口：非最后一段到“下一段起点 − safety_gap”；有视频时最后一段到视频结尾；只给 SRT 时到最后一段 `end_sec`。源 `end` 越过下一段起点记 warning；零/负窗口合成前报错。

## 5. 执行 runner

`runner.py` 与 `SKILL.md` 同级；先按 §1 解析出 skill 目录的绝对路径，再调用。**不要阅读、手抄、改写或复制到任务目录**：

```bash
# Claude Code 可直接用插件根环境变量
python "${CLAUDE_PLUGIN_ROOT}/skills/video-tts/runner.py" --check --task "<任务目录>/task.json"
python "${CLAUDE_PLUGIN_ROOT}/skills/video-tts/runner.py" --task "<任务目录>/task.json"

# 其他宿主：<skill目录> 是本次加载的 SKILL.md 所在目录的绝对路径
python "<skill目录>/runner.py" --check --task "<任务目录>/task.json"
python "<skill目录>/runner.py" --task "<任务目录>/task.json"
```

- 不要用当前工作目录拼 `runner.py`；`<skill目录>` 必须来自 skill 加载路径或插件根。
- 把命令里的 `python` 换成本机可用的 `python3`/`py -3`；路径带空格保留引号。不要复制多份 runner。
- 运行前先确认 `<skill目录>/runner.py` 存在；缺失就是插件包不完整，停止并报告，不要找旧缓存或重建。
- `--check` 只校验结构/输入，不加载模型、不联网、不合成；通过后再 `--task`。
- runner 只检查 `VIDEO_TTS_PYTHON`、专用 venv、当前解释器和 PATH；不广泛扫描其他环境。可用 `VIDEO_TTS_PYTHON` 指定已验证解释器。缺依赖时在用户目录（macOS `~/Library/Caches/video-toolkit/envs/`，Windows `%LOCALAPPDATA%\video-toolkit\envs/`）建专用 venv，绝不影响系统 Python；安装只发生在选定 provider 后。
- 阶段日志：`[setup]`、`[download]`、`[load]`、`[synthesis]`、`[cache]`、`[fit]`、`[track]`、`[mux]`、`[verify]`、`[deliver]`、`[done]`；约 10 秒一次 `[heartbeat]`。转述当前阶段，不笼统说“处理中”。
- 首次本地下载显示 HF 真实文件数/字节总量（拿不到写“体积未知”，不编造）；缓存齐全跳过下载。缓存完整性按权重索引核对全部分片和 tokenizer/speech_tokenizer 必要文件，缺片重新下载。
- 在线合成串行提交（不启用并发），相同正文/音色/参数命中任务内缓存；不引入线程池或并发参数。
- 退出码：`0` 完成；`1` 运行失败（已完成片段保留）；`2` task/输入非法；`3` 需要用户决策（读 `result.json` 的 `error.details`，用控件选择后改 task 重跑）。

## 6. 处理退出码 3

- `needs_polish`：只精简 `details.overflow` 列出的语段；保留数字/专名/条件/关键步骤；原句写 `original_text`，改 `text`，`polish.attempt += 1` 重跑；未变语段复用缓存。达到 `max_attempts` 后不再自动润色。
- `overflow`：不能再自动润色；用控件选调整合并/时间轴、允许润色、改 `max_speed`（≤1.20）、换音色/路线或停止。**不截断语音凑时长。**
- `needs_action`（普通旁白长于视频）：runner 保留自然音轨，不自动加速/截断；让用户选“只交付音频/字幕（从 deliver 去掉 video）”或“精简/重新分段旁白文本”。不得用截断或重叠掩盖。
- 在线克隆 `requires_verification=true`：`voice_id` 已写入 `result.json`/`clone.json`；完成 ElevenLabs 验证后用该 `voice_id`、`reference_audio=null`，不重复创建；要新建克隆改 `voice.name` 或删 `clone.json`。
- 模型/音色不可用：用 `--list-voices` 或 `result.json` 的 `available_models` 让用户改选；不自动改模型或换 provider。

## 7. 交付与复核

- 只交付所选产物；内部 `work/`/逐段音频/中间轨不展示。默认同名自动编号 `_2`/`_3`；`overwrite=true` 才覆盖，且永不覆盖输入。
- 独立音频 48kHz WAV（真实重采样）；成片 MP4 替换原声。H.264/HEVC 直接复制，其他编码重编码 H.264 时说明；成片验证视频流、音轨和两条流时长，失败不标记完成。
- 字幕按实际合成音频时间输出，粒度是**语段级**，不冒充句内/字级；合并组时间不等于原字幕每条时间。
- 复核正文覆盖/顺序、时间边界、实际音频时长、超长加速/改写、视频/音频流。**听感（发音、断句、跨段音色、音量）必须基于真实音频**；结构/时长/电平合格不能替代试听。把成品路径交给用户，调整用控件确认后重跑。
- 报告所选产物、模型/后端、音色来源、总时长、加速段、润色前后文本（若有）、克隆 `voice_id`/验证状态和警告；不生成无关报告文件。

## 8. 常见失败与排障

- **缺依赖/首次安装**：只在选定路线后建专用 venv；失败保留环境并给实际命令；不装系统 Python，不用 `--break-system-packages`。
- **模型下载/缓存**：检查网络；gated 仓库需 `HF_TOKEN`/`huggingface-cli login`；保留缓存续用。下载、加载、显存、推理错误分阶段报告；缓存按索引分片校验，缺片重新下载。
- **Windows NVIDIA**：有 NVIDIA 但当前是 CPU 版 torch → `needs_setup`，选中本地会准备 CUDA 环境；wheel 只用 `cu126`/`cu128`/`cu130`（torch 2.10.0 无 cu124），驱动低于 12.6 用 cu126 的 minor-version compatibility，失败则更新驱动。显存不足关闭占显存程序；不自动换 0.6B/CPU/在线。
- **缺 Python 3.9+**：先控件确认再按平台安装（macOS `brew install python`，Windows `winget install Python.Python.3`）；不用旧系统 Python 硬装。
- **ffmpeg/ffprobe**：两者都要；macOS `brew install ffmpeg`，Windows `winget install ffmpeg`；缺时控件确认后安装，不伪造 ffprobe。
- **ElevenLabs**：401/403 修 key；402 查额度/账单；422 看字段（也可能是 WAV 格式超出套餐，默认 `mp3_44100_128`）；429/5xx 有限退避重试；读超时/连接中断按提交状态未知处理，不盲目重交；克隆超时先查音色列表。
- **对齐超长**：先 ≤1.20 加速，再润色（最多 2 次），仍不行由用户选调整分段/时间轴/停止；不默认截断。
- **普通旁白长于视频**：按 §6 保留自然音轨，让用户选只交付音频或精简/重分段；不自动加速。
- **输出已存在**：默认自动编号；覆盖需控件确认，runner 拒绝覆盖输入。

## 9. 边界与自检

- 不做 VoiceDesign、百炼、Edge TTS、跨任务缓存、人声分离、BGM 混入、词级字幕、复杂 Job Manifest；不创建子 Agent/协作模式。
- Windows/在线实机验收状态以本次交付说明为准；未实测组合不描述为已验证。
- 执行前：已 `--detect`；mode/provider/音色/交付/在线授权/润色/覆盖已明确；task.json UTF-8 且模型 ID/路径有效；对齐覆盖全 SRT、窗口为正；`--check` 通过。
- 执行后：只展示所选产物；音频 48kHz、视频音轨有效、字幕段级；退出码 0 才说完成；退出码 3 的 details 已用控件处理且未截断；克隆只建一次、key 未泄露；听感结论有真实音频依据。
