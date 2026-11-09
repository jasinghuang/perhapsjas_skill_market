---
name: video-tts
description: >
  文稿旁白与 SRT 时间轴配音。本地 Qwen3-TTS（Apple Silicon MLX / Windows NVIDIA PyTorch）
  或 ElevenLabs 在线；预设音色或参考音频克隆；输出独立音频、成片或字幕。
  当用户要视频配音、中文配音、SRT 配音、字幕转语音、文稿旁白、voiceover、dubbing、TTS 时触发。
  只支持本文件列出的两条路线；不提供文字设计音色、百炼或 Edge TTS。
---

# video-tts

把文稿或 SRT 字幕做成配音：普通旁白按自然朗读时长输出；对齐配音按 SRT 时间窗放置语段、补静音，必要时在 1.20 倍以内加速。支持本地 Qwen3-TTS（Mac MLX / Windows NVIDIA torch）与 ElevenLabs 在线，支持预设音色和参考音频克隆。

**始终由当前 Agent 独立完成**：不创建子 Agent、不委派、不设置协作角色、不启用自动升级选项，也不建议用户切换协作模式。所有需要用户回答的事项必须使用 `AskUserQuestion`（其他宿主用等价的结构化输入控件）；普通消息只用于说明、展示试听和报告进度，**不能**用文字列选项、回复编号或自由文本问答代替控件，也不能用猜测、推荐值或等待超时代替答案。已在本任务明确指定的选择视为已决定，不重复询问；未明确的必须问。技术事实优先通过检测、读取文档或验证解决，只有确需用户回答的部分才提问。宿主没有控件时说明能力缺失，等待用户明确调整要求，不擅自替用户选择。

## 1. 先检测，再给选项

每次任务先新建独立目录（例如 `video-tts-task-20261109-2130/`），把 `runner.py` 和 `task.json` 放进去。用本文件路径提取 runner（见 §5），然后运行只读检测：

```bash
python "<任务目录>/runner.py" --detect
```

`--detect` 输出 JSON，只报告能力，不安装、不下载、不合成。把其中文结论转述给用户，不要贴原始 JSON。状态含义：

- `ready`：依赖、硬件和后端 API 已验证，可执行。
- `needs_setup`：路线适用，但还需要安装依赖或首次下载模型；用户选定后可以自动准备。
- `unsupported`：当前硬件/平台不支持，说明原因，不作为可选项推荐。
- `unknown`：探测失败，说明原因；**不能**当作已验证可用。

平台与固定模型：

| 平台/路线 | 预设音色 | 参考克隆 | 验证重点 |
| --- | --- | --- | --- |
| Apple Silicon macOS | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16` | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` | 原生 arm64 Python、Metal、`mlx_audio` API |
| Windows x64 + NVIDIA | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` | 驱动/CUDA wheel、真实张量运算、`qwen_tts` API |
| ElevenLabs | 所选声音的 `voice_id` | 所选/新建的 `voice_id` | 鉴权、模型可用性、账户音色、克隆能力 |

固定规则：

- 本地 **CustomVoice 只做预设音色，Base 只做参考克隆**，不能互相替代；不自动换 0.6B、量化版本、VoiceDesign 或在线。
- Mac 主实现使用 `mlx-audio`；不要混用 `odiak/Qwen3-TTS-MLX` 的依赖、模型格式或参数名，也不自动安装该实验分支。
- Windows 使用官方 `qwen_tts.Qwen3TTSModel`：预设用 `generate_custom_voice`，克隆用 `create_voice_clone_prompt` 一次并复用 `generate_voice_clone`；参数名是 `speaker`/`language`，不是 MLX 的 `voice`/`lang_code`。
- ElevenLabs 的 `model_id` 与 `voice_id` 是独立字段；已有音色和已创建的克隆都通过可访问的 `voice_id` 合成。克隆不是一个额外的 TTS 模型 ID。
- 在线模型只列 `eleven_multilingual_v2`（质量优先）与 `eleven_flash_v2_5`（低延迟；可使用 `language_code`）。不把它们称作“最新旗舰”，运行前核对账户是否可用。
- 密钥只从环境读取：ElevenLabs 用 `ELEVENLABS_API_KEY`。不把密钥写入 `task.json`、脚本、日志、`result.json` 或聊天；不因为检测到密钥就自动选择在线。
- 只读检测与列音色用标准库 GET（避免为展示选项先安装依赖）；正式的在线合成/克隆统一用 `requests`，不引入 ElevenLabs SDK。

## 2. 需要用户决定的事项

以下内容只要未在本任务明确，就必须用控件收集；互相不依赖的可以放在同一批，后续选项依赖前一项时分批展示：

1. **mode**：普通旁白（文稿/从 SRT 提取正文，按自然时长）或对齐配音（SRT/视频时间轴）。用户已明确指定时直接采用；含义不清才问。普通旁白即使提供视频，也不自动改成对齐配音。
2. **provider**：展示 ready 和可安装路线，区分联网、鉴权、本地资源需求；unsupported 不展示为可选。只有一条可用路线时，也用一个二选一控件确认（执行 / 暂不执行）。已安装环境、检测到的 API Key 或历史偏好只能作为推荐值，不能代替本次 provider 选择。
3. **音色来源**：预设音色或参考克隆；只展示所选后端支持的来源。
4. **声音设置**：
   - 本地预设：从 `--list-voices --provider local` 的音色目录选 `speaker`（缓存时读模型配置，未缓存时用模型卡列表；加载模型时 runner 仍会按真实 `supported_speakers` 校验）；语气/风格用 `parameters.instruct`（仅预设）。
   - 本地克隆：指定参考音频，并提供**与录音对应的准确参考文本**；参考音频必须可解码且有人声。
   - 在线预设/已有克隆：选择账户可访问的 `voice_id`；可用 `--list-voices --provider elevenlabs` 列出（GET，不合成、不计费）。音色很多时先按名称/类别筛选，再给 2–4 个候选；控件自动提供“其他”输入，不要把十几个音色塞进一次问答。
   - 在线新建克隆：提供参考录音；`reference_text` 不强制。创建前说明会上传录音并可能产生账户费用。
   - 在线模型：`eleven_multilingual_v2` 或 `eleven_flash_v2_5`；不可用时用控件改选，不自动换。
   - 语气/voice settings 按能力展示；不支持的参数不要放进 `task.json`。
5. **交付格式**（多选）：独立音频、成片、字幕。不能提供当前输入无法生成的成品：没有视频就不提供成片；只提供音频时不要声称会生成视频。成片的音轨默认替换原声；如果用户要保留原视频声音，再用控件确认是否压低混入（说明原有人声也会保留，不是人声分离）。
6. **在线授权**：选定在线后，说明文本/参考音频会上传到 ElevenLabs、按账户费率计费；同一批已明确授权不重复确认。改变服务、模型或扩大处理范围时重新收集授权。
7. **是否允许润色**：对齐配音在超长时可能需要精简；默认不允许。允许时最多额外合成两次，且只改溢出的语段。
8. **覆盖已有文件**：默认同名自动编号，不覆盖素材；用户要求覆盖时用控件确认，同一任务已明确的不重复问。
9. **失败后的处理**：重试、修复环境、改参数、换音色/模型、停止；按控件选择执行，不自行换 provider。

试听：用户要求时，做一个只含一句试听文本的 preview 任务，`output.deliver=["audio"]`，输出到独立目录；试听后用控件选择采用、换音色/语气或重试。preview 任务与正式任务尽量放在**同一任务目录**（不同 `task.json` 文件名），这样 `clone.json` 会自动复用；如果分目录，必须读取 preview 的 `result.json`/`clone.json`，把 `voice_id` 写入正式任务，正式任务用 `voice.source="clone"` + 该 `voice_id`、`reference_audio=null`，**绝不重复创建**。

## 3. 读取与语义分段

### 3.1 普通旁白

- 输入可以是文稿，也可以从 SRT 提取正文；先完整读完再分段。
- 按句意、段落和朗读节奏组织语段；不要求固定条数、固定时长或必须先补齐句末标点。
- 默认保留原文信息：不遗漏、不重复、不重排。不要借“分段”改写、精简或纠正内容；字幕纠错/翻译先交给 `text-refine`，除非用户明确要求并授权。
- 段间停顿由 `timing.pause_between_sec` 控制（默认 0.30 秒）；runner 内部只对超长文本做引擎级切块（本地 280 字符、在线 2000 字符），不改文字。

### 3.2 对齐配音

- 读完整条 SRT，把碎片字幕合并为自然语段；语段可以不同于最终显示字幕的分段。
- 每条语段保留来源条目：`source_indices` 写原始 SRT 序号（可选但推荐）；`start_sec` 取该组第一条的起点，`end_sec` 取该组最后一条的终点。
- 覆盖全部条目、顺序递增、恰好一次；不遗漏、不重复、不重排。
- 合并以完整语义优先；句末标点、组时长、条目数量只作辅助，不设固定门槛。无标点字幕可以工作，不要为了凑格式先补标点。
- 中文直接拼接；ASCII 单词边界需要空格时补一个空格；不要凭空加原文没有的标点。
- 组内文本与源字幕不一致（授权润色除外）必须先说明；runner 不会替你检查语义覆盖。
- 时间轴重叠、零/负窗口、起点不递增：在 `--check` 前修正，或让 runner 在合成前报错。不要靠截断或让语音互相覆盖“解决”。
- 读取 SRT 时兼容 UTF-8 BOM；遇到其他编码，先识别并转换，或向用户确认，不能静默丢字或换编码。任务里的正文统一写 UTF-8 `task.json`。

## 4. task.json：唯一任务入口

runner 只接受 `task.json` 路径；正文、参数、路径全部通过 JSON 传递，不从命令行读正文，不把正文插入 Python 源码。用宿主语言的 JSON 序列化生成文件：正文里的双引号、换行、反斜杠由序列化器转义，不要手写拼接。文件使用 UTF-8；不允许注释、尾逗号、NaN 或 Infinity。相对路径一律相对 `task.json` 所在目录。

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
    "overwrite": false,
    "narration_video_policy": "ask",
    "mix_original": {"enabled": false, "volume_db": -18}
  },
  "segments": [
    {"id": 1, "text": "第一段旁白。", "start_sec": null, "end_sec": null},
    {"id": 2, "text": "第二段旁白。", "start_sec": null, "end_sec": null}
  ]
}
```

### 4.2 对齐配音示例

```json
{
  "schema_version": 1,
  "mode": "aligned",
  "provider": "local",
  "backend": "mlx_audio",
  "model_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
  "language": "Chinese",
  "voice": {
    "source": "clone",
    "speaker": null,
    "voice_id": null,
    "reference_audio": "reference/voice.wav",
    "reference_text": "参考录音里实际说出的文字。",
    "name": null
  },
  "parameters": {},
  "timing": {"max_speed": 1.2, "safety_gap_sec": 0.1, "pause_between_sec": 0.3},
  "allow_text_edits": false,
  "polish": {"attempt": 0, "max_attempts": 2},
  "input": {"srt": "input.srt", "video": "input.mp4"},
  "output": {
    "directory": "output",
    "deliver": ["audio", "video", "subtitle"],
    "audio_format": "wav",
    "sample_rate": 48000,
    "overwrite": false,
    "narration_video_policy": "ask",
    "mix_original": {"enabled": false, "volume_db": -18}
  },
  "segments": [
    {"id": 1, "text": "第一组完整语意。", "start_sec": 0.5, "end_sec": 3.2, "source_indices": [1, 2, 3]},
    {"id": 2, "text": "第二组完整语意。", "start_sec": 3.5, "end_sec": 7.0, "source_indices": [4, 5]}
  ]
}
```

### 4.3 在线示例

```json
{
  "schema_version": 1,
  "mode": "narration",
  "provider": "elevenlabs",
  "backend": "elevenlabs_http",
  "model_id": "eleven_multilingual_v2",
  "language": "Chinese",
  "voice": {
    "source": "preset",
    "speaker": null,
    "voice_id": "<账户中可访问的 voice_id>",
    "reference_audio": null,
    "reference_text": null,
    "name": null
  },
  "parameters": {
    "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": true},
    "output_format": "wav_44100",
    "online_concurrency": 2
  },
  "timing": {"max_speed": 1.2, "safety_gap_sec": 0.1, "pause_between_sec": 0.3},
  "allow_text_edits": false,
  "polish": {"attempt": 0, "max_attempts": 2},
  "input": {"srt": null, "video": null},
  "output": {
    "directory": "output",
    "deliver": ["audio"],
    "audio_format": "wav",
    "sample_rate": 48000,
    "overwrite": false,
    "narration_video_policy": "ask",
    "mix_original": {"enabled": false, "volume_db": -18}
  },
  "segments": [{"id": 1, "text": "在线旁白测试。", "start_sec": null, "end_sec": null}]
}
```

### 4.4 字段规则

- `mode`：`narration` 或 `aligned`。
- `provider`：`local` 或 `elevenlabs`。`backend`：本地 `mlx_audio` / `qwen_tts`（由平台路由写入）；在线固定 `elevenlabs_http`。
- `model_id` 必须与后端和音色来源精确匹配的固定 ID（见 §1）；不要写 0.6B、量化、VoiceDesign、百炼模型。
- `language`：本地用 Qwen3-TTS 语言名（`Chinese`、`English`、`Japanese`、`Korean`、`German`、`French`、`Russian`、`Portuguese`、`Spanish`、`Italian`、`Beijing_dialect`、`Sichuan_dialect` 或 `auto`）；在线写语言名或 `auto`。runner 规范化为小写；不支持的值在合成前报错。
- `voice.source`：`preset` 或 `clone`。
  - 本地预设：`speaker` 必填；`voice_id`/`reference_*` 必须为 `null`。
  - 本地克隆：`reference_audio` + `reference_text` 必填；`speaker`/`voice_id` 必须为 `null`。
  - 在线预设/已有克隆：`voice_id` 必填；`reference_*` 为 `null`。已有克隆可带 `reference_audio`，runner 会警告并**不上传**。
  - 在线新建克隆：`voice_id` 为 `null`，`reference_audio` 必填，`reference_text` 可为 `null`；可给 `name`（否则默认按参考音频内容生成稳定名称）。runner 会在任务目录写 `clone.json`，重跑时按参考音频内容哈希 + 名称复用同一 `voice_id`，避免重复创建。
- `parameters` 只接受所选 adapter 支持的字段，未知字段合成前报错：
  - 本地 MLX：`instruct`（仅预设）、`temperature`、`top_p`、`top_k`、`repetition_penalty`、`seed`。
  - 本地 torch：`instruct`（仅预设）、`temperature`、`top_p`、`top_k`、`seed`。
  - 在线：`voice_settings`（`stability`、`similarity_boost`、`style`、`use_speaker_boost`、`speed`）、`seed`、`output_format`（`wav_16000`…`wav_48000`）、`online_concurrency`（1–3）、`remove_background_noise`、`apply_text_normalization`（`auto`/`on`/`off`）。
- `timing.max_speed`：首版不超过 `1.20`；`safety_gap_sec` 默认 `0.10`；`pause_between_sec` 仅普通旁白使用，默认 `0.30`。
- `allow_text_edits`：只有用户明确允许润色时为 `true`。`polish.attempt` 从 0 开始，每次润色重跑 +1，`max_attempts` 最多 `2`。
- `input.srt`：对齐模式必填；普通旁白可选（用于命名/追溯）。`input.video`：要出成片、或对齐模式要按视频结尾计算最后窗口时必填。
- `output.deliver`：`audio`/`video`/`subtitle` 多选；`video` 需要 `input.video`。首版 `audio_format` 只能是 `wav`，`sample_rate` 只能是 `48000`。
- `output.narration_video_policy`：普通旁白音频长于视频时使用；`ask`（默认，先停下让用户选）、`accelerate`（整轨加速到视频长度，超过 `max_speed` 仍停下）、`audio_only`（只交付音频/字幕）。
- `output.mix_original`：默认关闭；开启时把原视频声音压低后混入，**原有人声也会保留**，不是人声分离。没有视频时不能开启。
- `segments`：顺序固定，`id` 唯一，`text` 非空。普通旁白的时间字段必须为 `null`；对齐必须 `start_sec`/`end_sec` 有限、非负、`end > start`、起点严格递增。runner 根据下一段起点和媒体末尾计算窗口，不盲信自报时长。`source_indices` 和 `original_text` 可选。
- 对齐模式窗口：非最后一段到“下一段起点 − `safety_gap_sec`”；有视频时最后一段到视频结尾；只给 SRT 时最后一段到自身 `end_sec`。源 `end` 越过下一段起点会记 warning，但窗口仍按下一段起点；零/负窗口在合成前报错。

## 5. 提取 runner 并执行

`SKILL.md` 末尾包含完整、自包含的 runner。**不要手抄、不要改写、不要省略**；每次用下面这条标准库命令原样提取到任务目录：

```bash
python -c "import pathlib,sys; t=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'); b=t.rsplit('<!-- runner:start -->',1)[1].rsplit('<!-- runner:end -->',1)[0]; lines=b.strip().splitlines(); code='\n'.join(lines[1:-1])+'\n'; f=open(sys.argv[2],'w',encoding='utf-8',newline='\n'); f.write(code); f.close()" "<本 SKILL.md 的实际路径>" "<任务目录>/runner.py"
```

- 命令中的 `python` 换成本机可用的 `python3` 或 `py -3`；路径带空格时保留引号。不要把 runner 复制成多个版本。
- 提取后先跑 `--check --task task.json`，只做结构与输入校验，不加载模型、不联网、不合成。字段错误必须在合成前修正。
- 再跑 `--task task.json`。runner 按所选路线复用已有环境，或在用户目录（macOS `~/Library/Caches/video-toolkit/envs/`，Windows `%LOCALAPPDATA%\video-toolkit\envs/`）创建专用 venv 安装；**绝不影响系统 Python**。安装只发生在用户已选定 provider 之后。
- runner 代码较长，是因为它包含跨平台自举、下载/加载阶段、三条 adapter、克隆复用、时间适配、拼轨、混流与成片校验；不要因为长度删减分支或改成省略核心逻辑的“精简版”。
- 下载/加载/合成阶段会打印 `[setup]`、`[download]`、`[load]`、`[synthesis]`、`[cache]`、`[fit]`、`[track]`、`[mux]`、`[verify]`、`[deliver]`、`[done]`；约每 10 秒一次 `[heartbeat]`。把当前阶段转述给用户，不要把所有阶段笼统说成“处理中”。
- 首次本地模型下载会显示 HF 真实文件数/字节总量（拿不到时写“体积未知”，不编造百分比或磁盘估算）；缓存齐全时跳过下载，不能仍声称在下载。
- 退出码：
  - `0`：完成（含已记录的加速/补静音警告）。
  - `1`：运行失败；已完成片段保留在任务目录，按错误阶段修复后可重跑。
  - `2`：task/输入非法；看 stderr 或 `--check` 的错误字段。
  - `3`：需要用户决策；读 `result.json` 的 `error.details`，用控件选择后改 `task.json` 重跑。

## 6. 处理退出码 3

`result.json` 的 `status` 与 `error.details` 是决策依据；不要自行猜测或截断：

- `needs_polish`：只精简 `details.overflow` 列出的语段；保留数字、专名、条件和关键步骤；把原句写入该段 `original_text`，改 `text`，`polish.attempt += 1`，重跑。未变语段会复用缓存。`polish.attempt` 达到 `max_attempts` 后不能再自动润色。
- `overflow`：不能再自动润色；用控件让用户选：调整合并/时间轴、允许润色、改 `max_speed`（仍 ≤1.20）、换音色/路线或停止。**任何情况下都不截断语音凑时长。**
- `needs_action`（普通旁白长于视频）：让用户选“加速到视频长度（若所需倍率 ≤ `max_speed`）”或“只交付音频/字幕”。选加速后把 `output.narration_video_policy` 改为 `accelerate` 重跑；选只交付改 `audio_only`（若 `deliver` 只有 `video`，先补 `audio`/`subtitle`）。不默认截断。
- 在线克隆 `requires_verification=true`：`voice_id` 已写入 `result.json` 和任务目录的 `clone.json`；让用户完成 ElevenLabs 验证，然后正式任务用该 `voice_id`、`reference_audio=null`，不要重复创建。任务目录的 `clone.json` 按参考音频内容哈希 + 名称复用已创建克隆；要新建克隆请改 `voice.name` 或删除该文件，不要盲目重跑。
- 模型/音色不可用：用 `--list-voices` 或 `result.json` 的 `available_models` 让用户改选；不自动改模型或换 provider。

## 7. 交付与复核

- 只交付用户选中的产物；内部 `work/`、逐段音频、中间轨不作为成品展示。默认同名自动编号 `_2`、`_3`；`overwrite=true` 才覆盖，且永不覆盖输入素材。
- 独立音频是 48 kHz WAV，经过真实重采样；成片 MP4 默认替换原声。只有显式开启 `mix_original` 才压低混入原声，并提示原人声仍保留。H.264/HEVC 视频流直接复制；其他编码重编码 H.264 时说明原因。成片必须验证视频流、音轨和两条流的时长，失败不标记完成。
- 字幕按实际合成音频时间输出，粒度是**语段级**，不是句内或字级；不要声称逐字对齐。合并组的时间不等于原字幕每一条的时间。
- 复核至少覆盖：正文覆盖/顺序、时间边界、实际音频时长、超长加速/改写、视频/音频流是否有效。**听感（发音、断句、跨段音色、音量）必须基于真实音频**；结构检查、时长或电平合格不能替代试听。把成品路径和试听建议交给用户，用户要求调整时用控件确认音色/参数/文本，再重跑。
- 报告实际产物、模型/后端、音色来源、总时长、加速段、润色前后文本（若有）、克隆 `voice_id`/验证状态和仍存在的警告；不要生成无关的详细报告文件。

## 8. 常见失败与排障

- **缺依赖/首次安装**：runner 只在用户选定路线后创建专用 venv；失败时保留环境并给出实际命令。不要把包装进系统 Python，不使用 `--break-system-packages`。
- **模型下载失败**：检查网络；gated 仓库需要 `HF_TOKEN` 或 `huggingface-cli login`；保留已下载缓存，重跑续用。下载、加载、显存、推理错误是不同阶段，分别报告。
- **CUDA/显存**：`torch.cuda` 不可用或显存不足时，关闭占显存程序后重试；不自动换 0.6B、CPU 或在线。
- **缺 Python 3.9+**：runner 需要能运行 `venv` 的 Python；缺时先用控件确认，再按平台安装（macOS `brew install python`，Windows `winget install Python.Python.3`），不要用系统旧 Python 硬装，也不要绕过权限。
- **ffmpeg/ffprobe**：两者都要有；macOS `brew install ffmpeg`，Windows `winget install ffmpeg`。只有 ffmpeg 不够。缺工具时先用控件向用户确认，再按平台安装；不要绕过权限，也不要伪造 ffprobe。
- **ElevenLabs**：401/403 修 key；402 查额度/账单；422 看请求字段；429/5xx 在有限预算内退避重试；读超时/连接中断按“提交状态未知”处理，不盲目重交（可能重复计费）；克隆创建超时先查音色列表，避免重复创建。
- **对齐超长**：先加速（≤1.20），再润色（最多 2 次），仍不行由用户选调整分段/时间轴/停止；不默认截断。
- **普通旁白长于视频**：按 §6 让用户选加速或只交付音频；独立音频默认保持自然时长，只有用户选择加速时才使用加速轨。
- **输出已存在**：默认自动编号；要覆盖必须经控件确认，且 runner 会拒绝覆盖输入。

## 9. 首版边界

- 不做文字描述设计音色（VoiceDesign）；不接入百炼、Edge TTS 或其他云服务；不因环境里有别的密钥而切换路线。
- 不做跨任务音频缓存、人声分离、独立 BGM 混入、词级/字级字幕、复杂 Job Manifest 状态机或多级报告。
- 不创建子 Agent，不设置协作角色，不建议用户切换协作模式。
- 模型与库版本的 Windows/在线实机验收状态以本次交付说明为准；未实测的组合不得描述为已验证。

## 10. 自检清单

执行前：

- [ ] 已用 `--detect` 检测，未安装未选路线的依赖。
- [ ] mode、provider、音色来源、具体音色/参考、交付格式、在线授权、是否允许润色、覆盖策略都已明确；未明确的用控件问过。
- [ ] `task.json` 是 UTF-8、无注释/尾逗号/NaN；模型 ID 与后端/来源匹配；相对路径相对任务目录。
- [ ] 对齐段落覆盖全部 SRT 条目、顺序正确、窗口为正；普通旁白时间字段为 null。
- [ ] `--check` 通过。

执行后：

- [ ] 只展示所选产物；音频 48 kHz、视频音轨有效；字幕是段级。
- [ ] 退出码 0 才说完成；退出码 3 的 details 已用控件处理，未截断内容。
- [ ] 克隆只创建一次；已有 `voice_id` 不重复上传；密钥未出现在任何文件/日志。
- [ ] 听感结论有真实音频依据；结构/时长检查没有被说成听审。

<!-- runner:start -->
@@RUNNER_BLOCK@@
<!-- runner:end -->
