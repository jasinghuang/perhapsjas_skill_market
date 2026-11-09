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
```python
#!/usr/bin/env python3
"""video-tts single-file runner.

This file is the executable template embedded verbatim in SKILL.md.  Stage 0
uses only the Python standard library so it can start on a bare system
interpreter, inspect the machine, validate task.json, and bootstrap a dedicated
user-local virtual environment.  Only after the selected route is available are
numpy/soundfile/the TTS backend imported.

Public entry points (nothing else is a task entry point):

    python runner.py --task task.json
    python runner.py --check --task task.json
    python runner.py --detect
    python runner.py --list-voices --provider local|elevenlabs

Exit codes:
    0  completed
    1  runtime failure (completed segments are kept for a retry)
    2  invalid task or input
    3  a user decision is required (overflow / polish / video length / clone)

The file is intentionally larger than the 200-300 line "core loop" target:
it also owns cross-platform bootstrap, Hugging Face download progress, the
three backends, online clone reuse, time fitting, track assembly, muxing and
output verification.  Those branches are kept explicit and readable rather
than compressed into a one-file trick.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as _dt
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1
EXIT_OK = 0
EXIT_FAIL = 1
EXIT_INVALID = 2
EXIT_ACTION = 3

SAMPLE_RATE = 48000
AUDIO_FORMAT = "wav"

MLX_PRESET_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
MLX_CLONE_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
TORCH_PRESET_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
TORCH_CLONE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
ONLINE_MODELS = ("eleven_multilingual_v2", "eleven_flash_v2_5")

EXPECTED_MODELS = {
    ("mlx_audio", "preset"): MLX_PRESET_MODEL,
    ("mlx_audio", "clone"): MLX_CLONE_MODEL,
    ("qwen_tts", "preset"): TORCH_PRESET_MODEL,
    ("qwen_tts", "clone"): TORCH_CLONE_MODEL,
}

LANGUAGE_ALIASES = {
    "auto": "auto",
    "zh": "chinese",
    "zh-cn": "chinese",
    "zh-hans": "chinese",
    "chinese": "chinese",
    "mandarin": "chinese",
    "en": "english",
    "en-us": "english",
    "english": "english",
    "ja": "japanese",
    "jp": "japanese",
    "japanese": "japanese",
    "ko": "korean",
    "korean": "korean",
    "de": "german",
    "german": "german",
    "fr": "french",
    "french": "french",
    "ru": "russian",
    "russian": "russian",
    "pt": "portuguese",
    "portuguese": "portuguese",
    "es": "spanish",
    "spanish": "spanish",
    "it": "italian",
    "italian": "italian",
    "beijing_dialect": "beijing_dialect",
    "sichuan_dialect": "sichuan_dialect",
}
LANGUAGE_ISO = {
    "chinese": "zh",
    "english": "en",
    "japanese": "ja",
    "korean": "ko",
    "german": "de",
    "french": "fr",
    "russian": "ru",
    "portuguese": "pt",
    "spanish": "es",
    "italian": "it",
}
LOCAL_LANGUAGES = (
    "auto",
    "chinese",
    "english",
    "japanese",
    "korean",
    "german",
    "french",
    "russian",
    "portuguese",
    "spanish",
    "italian",
    "beijing_dialect",
    "sichuan_dialect",
)

LOCAL_VOICES = [
    {"speaker": "serena", "name": "Serena", "gender": "女", "description": "温暖、温柔的年轻女声"},
    {"speaker": "vivian", "name": "Vivian", "gender": "女", "description": "明亮、略带锋利感的年轻女声"},
    {"speaker": "uncle_fu", "name": "Uncle_Fu", "gender": "男", "description": "低沉醇厚的成熟男声"},
    {"speaker": "ryan", "name": "Ryan", "gender": "男", "description": "节奏感强的男声"},
    {"speaker": "aiden", "name": "Aiden", "gender": "男", "description": "阳光美式男声，中频清晰"},
    {"speaker": "ono_anna", "name": "Ono_Anna", "gender": "女", "description": "活泼轻盈的日语女声"},
    {"speaker": "sohee", "name": "Sohee", "gender": "女", "description": "温暖、情感丰富的韩语女声"},
    {"speaker": "eric", "name": "Eric", "gender": "男", "description": "活泼成都男声，略带沙哑亮度"},
    {"speaker": "dylan", "name": "Dylan", "gender": "男", "description": "年轻北京男声，清晰自然"},
]

ONLINE_OUTPUT_FORMATS = (
    "wav_16000",
    "wav_22050",
    "wav_24000",
    "wav_32000",
    "wav_44100",
    "wav_48000",
)

LOCAL_PARAMS = {"instruct", "temperature", "top_p", "top_k", "repetition_penalty", "seed"}
TORCH_PARAMS = {"instruct", "temperature", "top_p", "top_k", "seed"}
ONLINE_PARAMS = {
    "voice_settings",
    "seed",
    "output_format",
    "online_concurrency",
    "remove_background_noise",
    "apply_text_normalization",
}

TIMING_KEYS = {"max_speed", "safety_gap_sec", "pause_between_sec"}
POLISH_KEYS = {"attempt", "max_attempts"}
VOICE_KEYS = {"source", "speaker", "voice_id", "reference_audio", "reference_text", "name"}
INPUT_KEYS = {"srt", "video"}
OUTPUT_KEYS = {
    "directory",
    "deliver",
    "audio_format",
    "sample_rate",
    "overwrite",
    "narration_video_policy",
    "mix_original",
}
MIX_KEYS = {"enabled", "volume_db"}
SEGMENT_KEYS = {"id", "text", "start_sec", "end_sec", "source_indices", "original_text"}
TASK_KEYS = {
    "schema_version",
    "mode",
    "provider",
    "backend",
    "model_id",
    "language",
    "voice",
    "parameters",
    "timing",
    "allow_text_edits",
    "polish",
    "input",
    "output",
    "segments",
}

IO_CHUNK_SAMPLES = 1 << 18
RETRY_ATTEMPTS = 3
RETRY_DELAYS = (1.0, 2.0)

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
FFMPEG_VERSION = ""
FFPROBE_VERSION = ""

_NP = None
_SF = None


# ---------------------------------------------------------------------------
# Logging, errors, small utilities
# ---------------------------------------------------------------------------


def log(stage: str, message: str) -> None:
    print(f"[{stage}] {message}", flush=True)


def warn(message: str) -> None:
    print(f"[warning] {message}", flush=True)


class RunnerError(Exception):
    """A stage failure with a machine-readable classification."""

    def __init__(
        self,
        message: str,
        *,
        stage: str = "run",
        exit_code: int = EXIT_FAIL,
        retryable: bool = False,
        retry_after: Optional[float] = None,
        submission_unknown: bool = False,
        segment_id: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.exit_code = exit_code
        self.retryable = retryable
        self.retry_after = retry_after
        self.submission_unknown = submission_unknown
        self.segment_id = segment_id
        self.details = details or {}

    def payload(self, status: Optional[str] = None) -> Dict[str, Any]:
        return {
            "status": status,
            "stage": self.stage,
            "message": self.message,
            "exit_code": self.exit_code,
            "retryable": self.retryable,
            "submission_unknown": self.submission_unknown,
            "segment_id": self.segment_id,
            "details": self.details,
        }


class TaskError(RunnerError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("stage", "task")
        kwargs.setdefault("exit_code", EXIT_INVALID)
        super().__init__(message, **kwargs)


class SetupError(RunnerError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("stage", "setup")
        kwargs.setdefault("exit_code", EXIT_FAIL)
        super().__init__(message, **kwargs)


class ActionRequired(RunnerError):
    def __init__(self, message: str, *, status: str = "needs_action", **kwargs: Any) -> None:
        kwargs.setdefault("stage", "action")
        kwargs.setdefault("exit_code", EXIT_ACTION)
        super().__init__(message, **kwargs)
        self.status = status


class Heartbeat:
    """Print the current stage and elapsed time every 10 seconds."""

    def __init__(self, stage: str, detail: str = "", interval: float = 10.0) -> None:
        self.stage = stage
        self.detail = detail
        self.interval = interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._started = 0.0

    def __enter__(self) -> "Heartbeat":
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            elapsed = time.monotonic() - self._started
            suffix = f" {self.detail}" if self.detail else ""
            print(
                f"[heartbeat] {self.stage}{suffix}; elapsed {elapsed:.0f}s",
                file=sys.stderr,
                flush=True,
            )

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def atomic_write_text(path: Path, text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    os.close(fd)
    try:
        with open(tmp_name, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp_name, path)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json_dumps(data))


def _unlink_quietly(path: Any) -> None:
    if path is None:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def _np():
    global _NP
    if _NP is None:
        import numpy as _numpy

        _NP = _numpy
    return _NP


def _sf():
    global _SF
    if _SF is None:
        import soundfile as _soundfile

        _SF = _soundfile
    return _SF


def _decode_bytes(raw: Optional[bytes]) -> str:
    if not raw:
        return ""
    return raw.decode("utf-8", errors="replace")


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"invalid JSON constant: {value}")


def _read_json(path: Path) -> Any:
    text = Path(path).read_text(encoding="utf-8-sig")
    return json.loads(text, parse_constant=_reject_json_constant)


# ---------------------------------------------------------------------------
# Paths and environment bootstrap
# ---------------------------------------------------------------------------


def app_envs_root() -> Path:
    override = os.environ.get("VIDEO_TTS_ENV_DIR")
    if override:
        return Path(override).expanduser()
    system = platform.system()
    if system == "Windows":
        base = Path(
            os.environ.get("LOCALAPPDATA")
            or (Path.home() / "AppData" / "Local")
        )
        return base / "video-toolkit" / "envs"
    if system == "Darwin":
        return Path.home() / "Library" / "Caches" / "video-toolkit" / "envs"
    base = os.environ.get("XDG_CACHE_HOME")
    root = Path(base).expanduser() if base else Path.home() / ".cache"
    return root / "video-toolkit" / "envs"


def venv_dir(route: str) -> Path:
    return app_envs_root() / f"video-tts-{route}"


def venv_python(route: str) -> Path:
    root = venv_dir(route)
    if platform.system() == "Windows":
        return root / "Scripts" / "python.exe"
    return root / "bin" / "python"


def _real(path: str) -> str:
    try:
        return os.path.realpath(path)
    except OSError:
        return path


def _same_executable(left: str, right: str) -> bool:
    # Do not use realpath here: a venv python is a symlink to its base
    # interpreter, but running the venv path activates the venv while running
    # the base path does not.
    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(
        os.path.abspath(right)
    )


def _version_key(path: Path) -> Tuple[int, ...]:
    parts = re.findall(r"\d+", path.name)
    return tuple(int(part) for part in parts) or (0,)


def candidate_interpreters(route: str) -> List[str]:
    found: List[str] = []
    seen: set = set()

    def add(value: Optional[Any]) -> None:
        if not value:
            return
        # Keep the invoked path, not its realpath: a venv python is a symlink
        # to its base interpreter and must stay distinct so that its venv
        # site-packages are used.
        path = os.path.abspath(os.path.expanduser(str(value)))
        if path in seen:
            return
        if not os.path.isfile(path) or not os.access(path, os.X_OK):
            return
        seen.add(path)
        found.append(path)

    add(os.environ.get("VIDEO_TTS_PYTHON"))
    add(str(venv_python(route)))
    add(sys.executable)

    for name in ("python3", "python"):
        add(shutil.which(name))

    system = platform.system()
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            base = Path(local) / "Programs" / "Python"
            if base.is_dir():
                for item in sorted(base.glob("Python3*/python.exe"), key=_version_key, reverse=True):
                    add(str(item))
        add(shutil.which("py"))
    else:
        for base in ("/opt/homebrew/bin", "/usr/local/bin"):
            directory = Path(base)
            if directory.is_dir():
                for item in sorted(directory.glob("python3.*"), key=_version_key, reverse=True):
                    if re.fullmatch(r"python3\.\d+", item.name):
                        add(str(item))
        pyenv = Path.home() / ".pyenv" / "versions"
        if pyenv.is_dir():
            for version_dir in sorted(pyenv.iterdir(), key=_version_key, reverse=True):
                add(str(version_dir / "bin" / "python3"))
                add(str(version_dir / "bin" / "python"))
        add("/usr/bin/python3")

    return found[:10]


def run_probe(python: str, code: str, timeout: float = 60.0) -> Optional[subprocess.CompletedProcess]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        return subprocess.run(
            [python, "-c", code],
            capture_output=True,
            timeout=timeout,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def python_version(python: str) -> Optional[Tuple[int, int, int]]:
    result = run_probe(
        python,
        "import sys;print('%d.%d.%d' % sys.version_info[:3])",
        timeout=15,
    )
    if result is None or result.returncode != 0:
        return None
    try:
        parts = _decode_bytes(result.stdout).strip().split(".")
        return int(parts[0]), int(parts[1]), int(parts[2])
    except (ValueError, IndexError):
        return None


def has_imports(python: str, names: Sequence[str], timeout: float = 60.0) -> bool:
    code = "import " + ", ".join(names)
    result = run_probe(python, code, timeout)
    return result is not None and result.returncode == 0


def route_imports(route: str) -> List[str]:
    if route == "mlx":
        return ["numpy", "soundfile", "mlx.core", "mlx_audio"]
    if route == "torch":
        return ["numpy", "soundfile", "torch", "qwen_tts"]
    return ["numpy", "soundfile", "requests"]


MLX_CAPABILITY = (
    "import platform;"
    "assert platform.machine().lower() in ('arm64','aarch64'), "
    "'arch=' + platform.machine();"
    "import mlx.core as mx;"
    "assert mx.metal.is_available(), 'metal unavailable';"
    "from mlx_audio.tts.utils import load_model;"
    "print('ok')"
)

TORCH_CAPABILITY = (
    "import platform;"
    "assert platform.machine().lower() in ('amd64','x86_64'), "
    "'arch=' + platform.machine();"
    "import torch;"
    "assert torch.cuda.is_available(), 'cuda unavailable';"
    "x=(torch.ones(8, device='cuda') * 2).sum().item();"
    "assert x == 16.0, 'cuda tensor op failed';"
    "from qwen_tts import Qwen3TTSModel;"
    "print('ok')"
)


def capability_problems(python: str, route: str, timeout: float = 60.0) -> List[str]:
    if route == "online":
        return []
    code = MLX_CAPABILITY if route == "mlx" else TORCH_CAPABILITY
    result = run_probe(python, code, timeout)
    if result is None:
        return [f"{python}: capability probe failed or timed out"]
    if result.returncode == 0:
        return []
    detail = _decode_bytes(result.stderr).strip().splitlines()
    last = detail[-1] if detail else f"exit {result.returncode}"
    if "arch=" in last:
        return [f"{python}: wrong architecture ({last})"]
    if "metal unavailable" in last:
        return [f"{python}: Metal is unavailable"]
    if "cuda unavailable" in last:
        return [f"{python}: torch.cuda is unavailable"]
    if "cuda tensor op failed" in last:
        return [f"{python}: CUDA tensor operation failed"]
    return [f"{python}: capability probe failed ({last})"]


def find_working_interpreter(
    route: str, timeout: float = 60.0
) -> Tuple[Optional[str], List[str]]:
    problems: List[str] = []
    for python in candidate_interpreters(route):
        if not has_imports(python, route_imports(route), timeout):
            problems.append(f"{python}: required imports are missing")
            continue
        caps = capability_problems(python, route, timeout)
        if caps:
            problems.extend(caps)
            continue
        return python, problems
    return None, problems


def interpreter_ok(python: str, route: str) -> bool:
    if not has_imports(python, route_imports(route), timeout=30):
        return False
    return not capability_problems(python, route, timeout=60)


def base_python_for_venv() -> str:
    candidates = [sys.executable] + candidate_interpreters("online")
    for candidate in candidates:
        version = python_version(candidate)
        if version is None or version < (3, 9):
            continue
        result = run_probe(candidate, "import venv;print('ok')", timeout=15)
        if result is not None and result.returncode == 0:
            return candidate
    raise SetupError(
        "No Python 3.9+ with the venv module was found. Install Python 3 first "
        "(macOS: brew install python; Windows: winget install Python.Python.3)."
    )


def _installer_prefix(python: str) -> List[str]:
    uv = shutil.which("uv")
    if uv:
        return [uv, "pip", "install", "--python", python]
    return [python, "-m", "pip", "install", "--disable-pip-version-check", "--no-input"]


def driver_cuda_index() -> Optional[str]:
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    output = _decode_bytes(result.stdout)
    match = re.search(r"CUDA(?:\s+UMD)?\s+Version:\s*(\d+)\.(\d+)", output)
    if not match:
        return None
    major, minor = int(match.group(1)), int(match.group(2))
    if major >= 13:
        return "cu130"
    if major == 12 and minor >= 8:
        return "cu128"
    if major == 12 and minor >= 6:
        return "cu126"
    if major == 12 and minor >= 4:
        return "cu124"
    return None


def _run_install(args: List[str], stage_detail: str) -> None:
    log("setup", stage_detail)
    try:
        with Heartbeat("setup", stage_detail):
            subprocess.run(args, check=True)
    except subprocess.CalledProcessError as exc:
        raise SetupError(
            f"dependency installation failed (exit {exc.returncode}). "
            "Fix the install error above and retry; the dedicated environment "
            "was kept for inspection."
        ) from exc


def install_route(route: str, python: str) -> None:
    base = [
        "numpy>=1.26,<3",
        "soundfile>=0.12,<1",
    ]
    if route == "torch":
        index = driver_cuda_index()
        if index is None:
            raise SetupError(
                "Could not determine the CUDA version from nvidia-smi. "
                "Update the NVIDIA driver and retry, or use the ElevenLabs route. "
                "This runner does not install an unavailable CUDA build."
            )
        _run_install(
            _installer_prefix(python)
            + [
                "torch==2.10.0",
                "torchaudio==2.10.0",
                "--index-url",
                f"https://download.pytorch.org/whl/{index}",
            ],
            f"installing CUDA torch ({index})",
        )
        packages = base + [
            "huggingface_hub>=0.25,<3",
            "qwen-tts==0.1.1",
            "transformers==4.57.3",
            "accelerate==1.12.0",
        ]
    elif route == "mlx":
        packages = base + [
            "huggingface_hub>=0.25,<3",
            "mlx-audio==0.6.4",
        ]
    else:
        packages = base + ["requests>=2.31,<3"]

    _run_install(
        _installer_prefix(python) + packages,
        f"installing {route} dependencies into the isolated environment",
    )


def ensure_environment(route: str, allow_install: bool = True) -> str:
    log("setup", f"Checking existing environments for route: {route}")
    with Heartbeat("setup", f"checking {route} environment"):
        python, problems = find_working_interpreter(route)
    if python is not None:
        log("setup", f"Using existing environment: {python}")
        return python
    if not allow_install:
        raise SetupError(
            "The selected route is not ready and automatic installation is disabled.\n"
            + ("\n".join(problems[:5]) if problems else "No usable interpreter found.")
        )

    system = platform.system()
    machine = platform.machine().lower()
    if route == "mlx" and not (system == "Darwin" and machine in ("arm64", "aarch64")):
        raise SetupError(
            f"The MLX route requires Apple Silicon macOS; this machine is "
            f"{system}/{machine}. Use the ElevenLabs route or a supported Mac."
        )
    if route == "torch" and not (system == "Windows" and machine in ("amd64", "x86_64")):
        raise SetupError(
            f"The PyTorch/CUDA route requires native Windows x64; this machine is "
            f"{system}/{machine}. Use the MLX route on Apple Silicon or ElevenLabs."
        )

    base = base_python_for_venv()
    directory = venv_dir(route)
    python = venv_python(route)
    if not python.is_file():
        log("setup", f"Creating isolated environment: {directory}")
        try:
            subprocess.run([base, "-m", "venv", str(directory)], check=True)
        except subprocess.CalledProcessError as exc:
            raise SetupError(
                f"Could not create the dedicated environment at {directory} "
                f"(exit {exc.returncode})."
            ) from exc

    install_route(route, str(python))

    if not interpreter_ok(str(python), route):
        problems = capability_problems(str(python), route)
        raise SetupError(
            "The dedicated environment was installed but still fails verification:\n"
            + ("\n".join(problems) if problems else "required imports are missing.")
        )
    log("setup", f"Environment ready: {python}")
    return str(python)


# ---------------------------------------------------------------------------
# Detection and voice listing
# ---------------------------------------------------------------------------


def hf_hub_cache() -> Path:
    for name in ("HUGGINGFACE_HUB_CACHE", "HF_HUB_CACHE"):
        value = os.environ.get(name)
        if value:
            return Path(value).expanduser()
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg:
        return Path(xdg).expanduser() / "huggingface" / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def model_cache_path(model_id: str) -> Optional[Path]:
    folder = "models--" + model_id.replace("/", "--")
    root = hf_hub_cache() / folder
    snapshots = root / "snapshots"
    if not snapshots.is_dir():
        return None
    for snapshot in sorted(snapshots.iterdir(), key=lambda item: item.name):
        if not (snapshot / "config.json").is_file():
            continue
        weights = list(snapshot.glob("*.safetensors")) + list(snapshot.glob("*.bin"))
        if weights:
            return snapshot
    return None


def tool_info(name: str) -> Dict[str, Any]:
    path = shutil.which(name)
    if not path:
        return {"path": None, "version": None}
    try:
        result = subprocess.run([path, "-version"], capture_output=True, timeout=10)
        first = _decode_bytes(result.stdout).splitlines()
        version = first[0].strip() if first else None
    except (OSError, subprocess.TimeoutExpired):
        version = None
    return {"path": path, "version": version}


def _local_route_for_platform() -> Tuple[Optional[str], List[str]]:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        return "mlx", []
    if system == "Windows" and machine in ("amd64", "x86_64"):
        return "torch", []
    return None, [
        f"Local Qwen3-TTS is supported on Apple Silicon macOS (MLX) or "
        f"Windows x64 with NVIDIA (PyTorch); this machine is {system}/{machine}."
    ]


def detect_local() -> Dict[str, Any]:
    route, reasons = _local_route_for_platform()
    if route is None:
        return {
            "backend": None,
            "status": "unsupported",
            "reason": reasons,
            "models": {},
            "python": None,
        }

    backend = "mlx_audio" if route == "mlx" else "qwen_tts"
    preset_model = MLX_PRESET_MODEL if route == "mlx" else TORCH_PRESET_MODEL
    clone_model = MLX_CLONE_MODEL if route == "mlx" else TORCH_CLONE_MODEL
    models = {
        "preset": {"model_id": preset_model, "cached": model_cache_path(preset_model) is not None},
        "clone": {"model_id": clone_model, "cached": model_cache_path(clone_model) is not None},
    }

    if route == "torch":
        try:
            nvidia = subprocess.run(["nvidia-smi"], capture_output=True, timeout=10)
            nvidia_present = nvidia.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            nvidia_present = False
        if not nvidia_present:
            return {
                "backend": "qwen_tts",
                "status": "unsupported",
                "reason": ["No usable NVIDIA GPU/driver detected (nvidia-smi failed)."],
                "models": models,
                "python": None,
            }

    python, problems = find_working_interpreter(route, timeout=45)
    if python is not None:
        missing = [name for name, item in models.items() if not item["cached"]]
        if missing:
            return {
                "backend": backend,
                "status": "needs_setup",
                "reason": [f"{name} model is not cached; first run will download it" for name in missing],
                "models": models,
                "python": python,
            }
        return {
            "backend": backend,
            "status": "ready",
            "reason": [],
            "models": models,
            "python": python,
        }

    unsupported = [item for item in problems if "Metal is unavailable" in item or "torch.cuda is unavailable" in item]
    if unsupported:
        return {
            "backend": backend,
            "status": "unsupported",
            "reason": unsupported,
            "models": models,
            "python": None,
        }
    if any("probe failed or timed out" in item for item in problems):
        return {
            "backend": backend,
            "status": "unknown",
            "reason": problems,
            "models": models,
            "python": None,
        }
    reason = [
        "Dependencies are not installed; selecting this route will create a "
        "dedicated environment and download the selected model on first use."
    ]
    if problems:
        reason.extend(problems[:3])
    return {
        "backend": backend,
        "status": "needs_setup",
        "reason": reason,
        "models": models,
        "python": None,
    }


def _http_json(url: str, api_key: str, timeout: float = 10.0) -> Any:
    request = urllib.request.Request(
        url,
        headers={"xi-api-key": api_key, "accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def detect_online() -> Dict[str, Any]:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    result: Dict[str, Any] = {
        "status": "needs_setup",
        "api_key_present": bool(api_key),
        "models": list(ONLINE_MODELS),
        "models_available": [],
        "reason": [],
    }
    if not api_key:
        result["reason"] = ["ELEVENLABS_API_KEY is not set."]
        return result

    python, _ = find_working_interpreter("online", timeout=30)
    if python is None:
        result["reason"] = [
            "The online runtime dependencies (requests/numpy/soundfile) are not installed."
        ]
        return result

    try:
        payload = _http_json("https://api.elevenlabs.io/v1/models", api_key)
        available = [
            item.get("model_id")
            for item in payload
            if isinstance(item, dict) and item.get("model_id")
        ]
        result["models_available"] = [item for item in available if item in ONLINE_MODELS]
        missing = [item for item in ONLINE_MODELS if item not in available]
        if missing:
            result["status"] = "needs_setup"
            result["reason"] = [f"Model not available on this account: {', '.join(missing)}"]
        else:
            result["status"] = "ready"
        result["python"] = python
    except urllib.error.HTTPError as exc:
        body = _decode_bytes(exc.read())[:400]
        if exc.code in (401, 403):
            result["reason"] = ["ELEVENLABS_API_KEY was rejected (401/403)."]
        else:
            result["reason"] = [f"ElevenLabs returned HTTP {exc.code}: {body}"]
        result["status"] = "needs_setup"
    except Exception as exc:
        result["status"] = "unknown"
        result["reason"] = [f"Could not verify ElevenLabs access: {exc}"]
    return result


def detect_environment() -> Dict[str, Any]:
    return {
        "os": platform.system(),
        "arch": platform.machine(),
        "python": {"executable": sys.executable, "version": platform.python_version()},
        "ffmpeg": tool_info("ffmpeg"),
        "ffprobe": tool_info("ffprobe"),
        "routes": {
            "local": detect_local(),
            "elevenlabs": detect_online(),
        },
    }


def list_local_voices() -> Dict[str, Any]:
    cached = model_cache_path(MLX_PRESET_MODEL)
    speakers = [item["speaker"] for item in LOCAL_VOICES]
    if cached is not None:
        try:
            config = _read_json(cached / "config.json")
            talker = config.get("talker_config") or {}
            listed = talker.get("spk_id") or {}
            if isinstance(listed, dict) and listed:
                order = list(listed.keys())
                lookup = {item["speaker"].lower(): item for item in LOCAL_VOICES}
                voices = []
                for key in order:
                    item = lookup.get(key.lower())
                    if item is None:
                        voices.append({"speaker": key, "name": key, "gender": "未知", "description": ""})
                    else:
                        voices.append(item)
                return {"provider": "local", "source": "cached model config", "voices": voices}
        except Exception:
            pass
    return {
        "provider": "local",
        "source": "model card catalog" if cached is None else "static catalog",
        "voices": LOCAL_VOICES,
    }


def list_online_voices() -> Dict[str, Any]:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SetupError("ELEVENLABS_API_KEY is not set.")
    try:
        payload = _http_json("https://api.elevenlabs.io/v1/voices?page_size=100", api_key)
    except urllib.error.HTTPError as exc:
        body = _decode_bytes(exc.read())[:400]
        raise SetupError(f"ElevenLabs voice listing failed (HTTP {exc.code}): {body}") from exc
    except Exception as exc:
        raise SetupError(f"Could not list ElevenLabs voices: {exc}") from exc
    voices = []
    for item in payload.get("voices", []):
        if not isinstance(item, dict):
            continue
        voices.append(
            {
                "voice_id": item.get("voice_id"),
                "name": item.get("name"),
                "category": item.get("category"),
                "labels": item.get("labels") or {},
            }
        )
    return {"provider": "elevenlabs", "voices": voices}


# ---------------------------------------------------------------------------
# Task schema
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class VoiceSpec:
    source: str
    speaker: Optional[str]
    voice_id: Optional[str]
    reference_audio: Optional[Path]
    reference_text: Optional[str]
    name: Optional[str]


@dataclasses.dataclass
class TimingSpec:
    max_speed: float
    safety_gap_sec: float
    pause_between_sec: float


@dataclasses.dataclass
class PolishSpec:
    attempt: int
    max_attempts: int


@dataclasses.dataclass
class InputSpec:
    srt: Optional[Path]
    video: Optional[Path]


@dataclasses.dataclass
class OutputSpec:
    directory: Path
    deliver: List[str]
    audio_format: str
    sample_rate: int
    overwrite: bool
    narration_video_policy: str
    mix_original: Dict[str, Any]


@dataclasses.dataclass
class Segment:
    id: int
    text: str
    start_sec: Optional[float]
    end_sec: Optional[float]
    source_indices: Optional[List[Any]] = None
    original_text: Optional[str] = None
    window_sec: Optional[float] = None


@dataclasses.dataclass
class Task:
    path: Path
    base: Path
    raw: Dict[str, Any]
    mode: str
    provider: str
    backend: str
    model_id: str
    language: str
    voice: VoiceSpec
    parameters: Dict[str, Any]
    timing: TimingSpec
    allow_text_edits: bool
    polish: PolishSpec
    input: InputSpec
    output: OutputSpec
    segments: List[Segment]
    video_info: Optional[Dict[str, Any]]
    video_duration: Optional[float]
    warnings: List[str]

    @property
    def work_dir(self) -> Path:
        return self.base / "work"


def _check_keys(obj: Any, allowed: set, where: str) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise TaskError(f"{where} must be a JSON object.")
    unknown = sorted(set(obj) - allowed)
    if unknown:
        raise TaskError(
            f"{where} contains unknown field(s): {', '.join(unknown)}; "
            f"allowed: {', '.join(sorted(allowed))}"
        )
    return obj


def _as_object(value: Any, where: str) -> Dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TaskError(f"{where} must be a JSON object.")
    return value


def _number(
    value: Any,
    where: str,
    *,
    default: Optional[float] = None,
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
    integer: bool = False,
) -> Any:
    if value is None:
        if default is None:
            raise TaskError(f"{where} is required.")
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TaskError(f"{where} must be a number.")
    number = int(value) if integer else float(value)
    if not math.isfinite(float(number)):
        raise TaskError(f"{where} must be finite.")
    if minimum is not None and number < minimum:
        raise TaskError(f"{where} must be >= {minimum}.")
    if maximum is not None and number > maximum:
        raise TaskError(f"{where} must be <= {maximum}.")
    return number


def _string(
    value: Any,
    where: str,
    *,
    required: bool = True,
    default: Optional[str] = None,
    allow_empty: bool = False,
) -> Optional[str]:
    if value is None:
        if required:
            raise TaskError(f"{where} is required.")
        return default
    if not isinstance(value, str):
        raise TaskError(f"{where} must be a string.")
    if not allow_empty and not value.strip():
        raise TaskError(f"{where} must not be empty.")
    return value


def _bool(value: Any, where: str, default: bool = False) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise TaskError(f"{where} must be true or false.")
    return value


def _resolve_path(base: Path, value: Any, where: str, *, must_exist: bool) -> Optional[Path]:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise TaskError(f"{where} must be a non-empty path string or null.")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    path = path.resolve()
    if must_exist and not path.is_file():
        raise TaskError(f"{where} does not exist or is not a file: {path}")
    return path


def _canonical_language(value: Any) -> str:
    text = _string(value, "language", required=True)
    assert text is not None
    key = text.strip().lower().replace("_", "-")
    canonical = LANGUAGE_ALIASES.get(key)
    if canonical is None:
        raise TaskError(
            f"language {text!r} is not supported; supported: "
            + ", ".join(LOCAL_LANGUAGES)
        )
    return canonical


def _probe_video_info(path: Path) -> Dict[str, Any]:
    probe = ffprobe_json(path)
    streams = probe.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    if video is None:
        raise TaskError(f"No video stream found in {path}.")
    duration = _stream_duration(video, probe)
    if duration is None:
        raise TaskError(f"Could not determine video duration for {path}.")
    return {
        "duration": duration,
        "codec_name": str(video.get("codec_name") or ""),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "fps": str(video.get("r_frame_rate") or ""),
        "has_audio": any(item.get("codec_type") == "audio" for item in streams),
    }


def _stream_duration(stream: Dict[str, Any], probe: Dict[str, Any]) -> Optional[float]:
    for raw in (stream.get("duration"), (probe.get("format") or {}).get("duration")):
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            return value
    return None


def _validate_local_voice(voice: Dict[str, Any], source: str, base: Path) -> VoiceSpec:
    speaker = _string(voice.get("speaker"), "voice.speaker", required=False)
    voice_id = _string(voice.get("voice_id"), "voice.voice_id", required=False)
    reference_text = _string(voice.get("reference_text"), "voice.reference_text", required=False)
    name = _string(voice.get("name"), "voice.name", required=False)
    reference_audio = voice.get("reference_audio")

    if source == "preset":
        if not speaker:
            raise TaskError("voice.speaker is required for a local preset voice.")
        if voice_id:
            raise TaskError("voice.voice_id is only for ElevenLabs; local preset uses voice.speaker.")
        if reference_audio:
            raise TaskError("voice.reference_audio is only for a clone voice.")
        if reference_text:
            raise TaskError("voice.reference_text is only for a clone voice.")
        if name:
            raise TaskError("voice.name is only for an online clone voice.")
        return VoiceSpec("preset", speaker, None, None, None, None)

    if source == "clone":
        if speaker:
            raise TaskError("voice.speaker is not used for a local clone; use reference_audio + reference_text.")
        if voice_id:
            raise TaskError("voice.voice_id is only for ElevenLabs; local clone uses a reference recording.")
        audio = _resolve_path(base, reference_audio, "voice.reference_audio", must_exist=True)
        if audio is None:
            raise TaskError("voice.reference_audio is required for a local clone.")
        if not reference_text or not reference_text.strip():
            raise TaskError("voice.reference_text is required for a local clone.")
        if name:
            raise TaskError("voice.name is only for an online clone voice.")
        return VoiceSpec("clone", None, None, audio, reference_text.strip(), None)

    raise TaskError("voice.source must be 'preset' or 'clone'.")


def _validate_online_voice(
    voice: Dict[str, Any], source: str, base: Path, warnings: List[str]
) -> VoiceSpec:
    speaker = _string(voice.get("speaker"), "voice.speaker", required=False)
    voice_id = _string(voice.get("voice_id"), "voice.voice_id", required=False)
    reference_text = _string(voice.get("reference_text"), "voice.reference_text", required=False)
    name = _string(voice.get("name"), "voice.name", required=False)
    reference_audio = voice.get("reference_audio")

    if speaker:
        raise TaskError("voice.speaker is for local Qwen3-TTS only; ElevenLabs uses voice_id.")
    if name and len(name) > 100:
        raise TaskError("voice.name must be at most 100 characters.")
    if source == "preset":
        if not voice_id:
            raise TaskError("voice.voice_id is required for an ElevenLabs preset voice.")
        if reference_audio or reference_text:
            raise TaskError("A preset ElevenLabs voice does not take reference_audio/reference_text.")
        if name:
            raise TaskError("voice.name is only used when creating a new clone.")
        return VoiceSpec("preset", None, voice_id, None, None, None)

    if source == "clone":
        if voice_id:
            if reference_audio or reference_text:
                warnings.append(
                    "Existing ElevenLabs voice_id supplied with reference audio/text; "
                    "the existing voice is used and no upload is performed."
                )
            return VoiceSpec("clone", None, voice_id, None, None, name)
        audio = _resolve_path(base, reference_audio, "voice.reference_audio", must_exist=True)
        if audio is None:
            raise TaskError("voice.reference_audio is required to create an ElevenLabs clone.")
        return VoiceSpec("clone", None, None, audio, reference_text, name)

    raise TaskError("voice.source must be 'preset' or 'clone'.")


def _validate_parameters(provider: str, backend: str, params: Any, source: str) -> Dict[str, Any]:
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise TaskError("parameters must be a JSON object.")
    allowed = LOCAL_PARAMS if provider == "local" else ONLINE_PARAMS
    if backend == "qwen_tts":
        allowed = TORCH_PARAMS
    _check_keys(params, allowed, "parameters")

    if provider == "local":
        instruct = params.get("instruct")
        if instruct is not None:
            instruct = _string(instruct, "parameters.instruct", required=False, allow_empty=True)
            if source == "clone" and instruct and instruct.strip():
                raise TaskError("parameters.instruct is only supported for preset voices.")
        cleaned: Dict[str, Any] = {}
        if instruct is not None:
            cleaned["instruct"] = instruct
        if params.get("temperature") is not None:
            cleaned["temperature"] = _number(params["temperature"], "parameters.temperature", minimum=0.0, maximum=2.0)
        if params.get("top_p") is not None:
            cleaned["top_p"] = _number(params["top_p"], "parameters.top_p", minimum=0.0, maximum=1.0)
        if params.get("top_k") is not None:
            cleaned["top_k"] = _number(params["top_k"], "parameters.top_k", integer=True, minimum=0, maximum=1000)
        if params.get("repetition_penalty") is not None:
            if backend != "mlx_audio":
                raise TaskError("parameters.repetition_penalty is not supported by the Windows torch adapter.")
            cleaned["repetition_penalty"] = _number(
                params["repetition_penalty"], "parameters.repetition_penalty", minimum=0.5, maximum=2.0
            )
        if params.get("seed") is not None:
            cleaned["seed"] = _number(params["seed"], "parameters.seed", integer=True, minimum=0)
        return cleaned

    cleaned = {}
    settings = params.get("voice_settings")
    if settings is not None:
        if not isinstance(settings, dict):
            raise TaskError("parameters.voice_settings must be a JSON object.")
        allowed_settings = {"stability", "similarity_boost", "style", "use_speaker_boost", "speed"}
        _check_keys(settings, allowed_settings, "parameters.voice_settings")
        cleaned_settings: Dict[str, Any] = {}
        for key in ("stability", "similarity_boost", "style"):
            if settings.get(key) is not None:
                cleaned_settings[key] = _number(
                    settings[key], f"parameters.voice_settings.{key}", minimum=0.0, maximum=1.0
                )
        if settings.get("use_speaker_boost") is not None:
            cleaned_settings["use_speaker_boost"] = _bool(
                settings["use_speaker_boost"], "parameters.voice_settings.use_speaker_boost"
            )
        if settings.get("speed") is not None:
            cleaned_settings["speed"] = _number(
                settings["speed"], "parameters.voice_settings.speed", minimum=0.5, maximum=2.0
            )
        cleaned["voice_settings"] = cleaned_settings
    if params.get("seed") is not None:
        cleaned["seed"] = _number(
            params["seed"], "parameters.seed", integer=True, minimum=0, maximum=4294967295
        )
    if params.get("output_format") is not None:
        value = _string(params["output_format"], "parameters.output_format")
        if value not in ONLINE_OUTPUT_FORMATS:
            raise TaskError(
                f"parameters.output_format must be one of {', '.join(ONLINE_OUTPUT_FORMATS)}."
            )
        cleaned["output_format"] = value
    if params.get("online_concurrency") is not None:
        cleaned["online_concurrency"] = _number(
            params["online_concurrency"], "parameters.online_concurrency", integer=True, minimum=1, maximum=3
        )
    if params.get("remove_background_noise") is not None:
        cleaned["remove_background_noise"] = _bool(
            params["remove_background_noise"], "parameters.remove_background_noise"
        )
    if params.get("apply_text_normalization") is not None:
        value = _string(params["apply_text_normalization"], "parameters.apply_text_normalization")
        if value not in ("auto", "on", "off"):
            raise TaskError("parameters.apply_text_normalization must be auto, on, or off.")
        cleaned["apply_text_normalization"] = value
    return cleaned


def load_task(path: Any, *, require_media_tools: bool = False) -> Task:
    task_path = Path(path).expanduser().resolve()
    if not task_path.is_file():
        raise TaskError(f"task.json not found: {task_path}")
    try:
        raw = _read_json(task_path)
    except json.JSONDecodeError as exc:
        raise TaskError(f"task.json is not valid JSON: {exc}") from exc
    except ValueError as exc:
        raise TaskError(f"task.json contains an invalid value: {exc}") from exc

    _check_keys(raw, TASK_KEYS, "task")
    base = task_path.parent
    warnings: List[str] = []

    if raw.get("schema_version") != SCHEMA_VERSION:
        raise TaskError(f"schema_version must be {SCHEMA_VERSION}.")
    mode = _string(raw.get("mode"), "mode")
    if mode not in ("narration", "aligned"):
        raise TaskError("mode must be 'narration' or 'aligned'.")
    assert mode is not None

    provider = _string(raw.get("provider"), "provider")
    if provider not in ("local", "elevenlabs"):
        raise TaskError("provider must be 'local' or 'elevenlabs'.")
    assert provider is not None

    backend = _string(raw.get("backend"), "backend")
    assert backend is not None
    if provider == "local":
        if backend not in ("mlx_audio", "qwen_tts"):
            raise TaskError("Local provider backend must be 'mlx_audio' or 'qwen_tts'.")
        system = platform.system()
        machine = platform.machine().lower()
        if backend == "mlx_audio" and not (system == "Darwin" and machine in ("arm64", "aarch64")):
            raise TaskError(
                "backend 'mlx_audio' requires Apple Silicon macOS; this machine is "
                f"{system}/{machine}. Regenerate task.json on this machine."
            )
        if backend == "qwen_tts" and not (system == "Windows" and machine in ("amd64", "x86_64")):
            raise TaskError(
                "backend 'qwen_tts' requires native Windows x64; this machine is "
                f"{system}/{machine}. Regenerate task.json on this machine."
            )
    else:
        if backend != "elevenlabs_http":
            raise TaskError("ElevenLabs provider backend must be 'elevenlabs_http'.")

    voice_raw = _check_keys(raw.get("voice"), VOICE_KEYS, "voice")
    source = _string(voice_raw.get("source"), "voice.source")
    if source not in ("preset", "clone"):
        raise TaskError("voice.source must be 'preset' or 'clone'.")
    assert source is not None

    if provider == "local":
        voice = _validate_local_voice(voice_raw, source, base)
    else:
        voice = _validate_online_voice(voice_raw, source, base, warnings)

    model_id = _string(raw.get("model_id"), "model_id")
    assert model_id is not None
    if provider == "local":
        expected = EXPECTED_MODELS.get((backend, source))
        if expected is None or model_id != expected:
            raise TaskError(
                f"model_id for {backend}/{source} must be exactly {expected!r}; "
                f"got {model_id!r}. The model is fixed by backend and voice source."
            )
    elif model_id not in ONLINE_MODELS:
        raise TaskError(
            f"model_id for ElevenLabs must be one of {', '.join(ONLINE_MODELS)}; got {model_id!r}."
        )

    language = _canonical_language(raw.get("language"))
    if provider == "local" and language not in LOCAL_LANGUAGES:
        raise TaskError(
            f"language {language!r} is not supported by local Qwen3-TTS; "
            f"supported: {', '.join(LOCAL_LANGUAGES)}"
        )

    parameters = _validate_parameters(provider, backend, raw.get("parameters"), source)

    timing_raw = _check_keys(_as_object(raw.get("timing"), "timing"), TIMING_KEYS, "timing")
    max_speed = _number(timing_raw.get("max_speed"), "timing.max_speed", default=1.2, minimum=1.0, maximum=1.2)
    safety_gap = _number(
        timing_raw.get("safety_gap_sec"), "timing.safety_gap_sec", default=0.1, minimum=0.0, maximum=2.0
    )
    pause = _number(
        timing_raw.get("pause_between_sec"), "timing.pause_between_sec", default=0.3, minimum=0.0, maximum=2.0
    )

    allow_text_edits = _bool(raw.get("allow_text_edits"), "allow_text_edits", default=False)
    polish_raw = _check_keys(_as_object(raw.get("polish"), "polish"), POLISH_KEYS, "polish")
    attempt = _number(polish_raw.get("attempt"), "polish.attempt", default=0, integer=True, minimum=0, maximum=2)
    max_attempts = _number(
        polish_raw.get("max_attempts"), "polish.max_attempts", default=2, integer=True, minimum=0, maximum=2
    )
    if attempt > max_attempts:
        raise TaskError("polish.attempt must not exceed polish.max_attempts.")
    if attempt > 0 and not allow_text_edits:
        raise TaskError("polish.attempt > 0 requires allow_text_edits=true.")

    input_raw = _check_keys(_as_object(raw.get("input"), "input"), INPUT_KEYS, "input")
    srt_path = _resolve_path(base, input_raw.get("srt"), "input.srt", must_exist=True)
    video_path = _resolve_path(base, input_raw.get("video"), "input.video", must_exist=True)
    if mode == "aligned" and srt_path is None:
        raise TaskError("input.srt is required for aligned mode.")

    video_info: Optional[Dict[str, Any]] = None
    video_duration: Optional[float] = None
    if video_path is not None:
        ffprobe_path = shutil.which("ffprobe")
        if ffprobe_path:
            global FFPROBE
            FFPROBE = ffprobe_path
            video_info = _probe_video_info(video_path)
            video_duration = float(video_info["duration"])
        elif require_media_tools:
            raise TaskError("ffprobe is required to inspect input.video.")
        else:
            warnings.append("ffprobe is not available; video duration was not checked.")

    output_raw = _check_keys(_as_object(raw.get("output"), "output"), OUTPUT_KEYS, "output")
    directory = _resolve_path(base, output_raw.get("directory") or "output", "output.directory", must_exist=False)
    assert directory is not None
    if directory.exists() and not directory.is_dir():
        raise TaskError(f"output.directory is not a directory: {directory}")

    deliver_raw = output_raw.get("deliver")
    if deliver_raw is None:
        deliver = ["audio"]
    else:
        if not isinstance(deliver_raw, list) or not deliver_raw:
            raise TaskError("output.deliver must be a non-empty array.")
        deliver = []
        for item in deliver_raw:
            value = _string(item, "output.deliver item")
            if value not in ("audio", "video", "subtitle"):
                raise TaskError("output.deliver items must be audio, video, or subtitle.")
            if value not in deliver:
                deliver.append(value)
    if "video" in deliver and video_path is None:
        raise TaskError("output.deliver includes video but input.video is missing.")

    audio_format = _string(output_raw.get("audio_format"), "output.audio_format", required=False, default="wav")
    if audio_format != AUDIO_FORMAT:
        raise TaskError("First version exports WAV audio only; output.audio_format must be 'wav'.")
    sample_rate = _number(
        output_raw.get("sample_rate"), "output.sample_rate", default=SAMPLE_RATE, integer=True, minimum=1, maximum=384000
    )
    if sample_rate != SAMPLE_RATE:
        raise TaskError("First version exports 48 kHz audio only; output.sample_rate must be 48000.")
    overwrite = _bool(output_raw.get("overwrite"), "output.overwrite", default=False)
    narration_policy = _string(
        output_raw.get("narration_video_policy"),
        "output.narration_video_policy",
        required=False,
        default="ask",
    )
    if narration_policy not in ("ask", "accelerate", "audio_only"):
        raise TaskError("output.narration_video_policy must be ask, accelerate, or audio_only.")

    mix_raw = _check_keys(_as_object(output_raw.get("mix_original"), "output.mix_original"), MIX_KEYS, "output.mix_original")
    mix_enabled = _bool(mix_raw.get("enabled"), "output.mix_original.enabled", default=False)
    mix_volume = _number(
        mix_raw.get("volume_db"), "output.mix_original.volume_db", default=-18.0, minimum=-60.0, maximum=0.0
    )
    if mix_enabled and video_path is None:
        raise TaskError("output.mix_original.enabled requires input.video.")
    mix_original = {"enabled": mix_enabled, "volume_db": mix_volume}

    segments_raw = raw.get("segments")
    if not isinstance(segments_raw, list) or not segments_raw:
        raise TaskError("segments must be a non-empty array.")
    segments: List[Segment] = []
    seen_ids: set = set()
    for index, item in enumerate(segments_raw):
        where = f"segments[{index}]"
        _check_keys(item, SEGMENT_KEYS, where)
        seg_id = _number(item.get("id"), f"{where}.id", integer=True, minimum=0)
        if seg_id in seen_ids:
            raise TaskError(f"{where}.id duplicates another segment id: {seg_id}")
        seen_ids.add(seg_id)
        text = _string(item.get("text"), f"{where}.text", required=True, allow_empty=False)
        assert text is not None
        if "\x00" in text:
            raise TaskError(f"{where}.text contains a NUL character.")
        original_text = _string(item.get("original_text"), f"{where}.original_text", required=False)
        source_indices = item.get("source_indices")
        if source_indices is not None:
            if not isinstance(source_indices, list) or not all(
                isinstance(value, (int, str)) and not isinstance(value, bool) for value in source_indices
            ):
                raise TaskError(f"{where}.source_indices must be an array of integers or strings.")
        if mode == "narration":
            if item.get("start_sec") is not None or item.get("end_sec") is not None:
                raise TaskError(f"{where}: narration segments must have start_sec/end_sec = null.")
            start = None
            end = None
            window = None
        else:
            start = _number(item.get("start_sec"), f"{where}.start_sec", minimum=0.0)
            end = _number(item.get("end_sec"), f"{where}.end_sec", minimum=0.0)
            if end <= start:
                raise TaskError(f"{where}: end_sec must be greater than start_sec.")
            window = None
        segments.append(
            Segment(
                id=int(seg_id),
                text=text,
                start_sec=start,
                end_sec=end,
                source_indices=source_indices,
                original_text=original_text,
                window_sec=window,
            )
        )

    if mode == "aligned":
        for index, segment in enumerate(segments):
            assert segment.start_sec is not None and segment.end_sec is not None
            if index > 0:
                previous = segments[index - 1]
                assert previous.start_sec is not None
                if segment.start_sec <= previous.start_sec:
                    raise TaskError(
                        f"segments[{index}]: start_sec must be strictly greater than the previous segment's start_sec."
                    )
                if previous.end_sec is not None and previous.end_sec > segment.start_sec:
                    warnings.append(
                        f"segment {previous.id}: source end {previous.end_sec:.3f}s overlaps "
                        f"next start {segment.start_sec:.3f}s; the alignment window uses the next start."
                    )
            if video_duration is not None and segment.start_sec >= video_duration:
                raise TaskError(
                    f"segment {segment.id}: start_sec {segment.start_sec:.3f}s is at or beyond "
                    f"video duration {video_duration:.3f}s."
                )

        for index, segment in enumerate(segments):
            assert segment.start_sec is not None and segment.end_sec is not None
            if index + 1 < len(segments):
                next_start = segments[index + 1].start_sec
                assert next_start is not None
                window = next_start - segment.start_sec - safety_gap
                if window <= 0:
                    raise TaskError(
                        f"segment {segment.id}: no usable window before the next segment "
                        f"(window {window:.3f}s); fix the segment boundaries or safety gap."
                    )
            elif video_duration is not None:
                window = video_duration - segment.start_sec
                if window <= 0:
                    raise TaskError(
                        f"segment {segment.id}: no usable window before the end of the video."
                    )
                if segment.end_sec > video_duration:
                    warnings.append(
                        f"segment {segment.id}: source end {segment.end_sec:.3f}s exceeds "
                        f"video duration; the final window ends at {video_duration:.3f}s."
                    )
            else:
                window = segment.end_sec - segment.start_sec
                if window <= 0:
                    raise TaskError(f"segment {segment.id}: no usable window.")
            segment.window_sec = float(window)

    return Task(
        path=task_path,
        base=base,
        raw=raw,
        mode=mode,
        provider=provider,
        backend=backend,
        model_id=model_id,
        language=language,
        voice=voice,
        parameters=parameters,
        timing=TimingSpec(max_speed=float(max_speed), safety_gap_sec=float(safety_gap), pause_between_sec=float(pause)),
        allow_text_edits=allow_text_edits,
        polish=PolishSpec(attempt=int(attempt), max_attempts=int(max_attempts)),
        input=InputSpec(srt=srt_path, video=video_path),
        output=OutputSpec(
            directory=directory,
            deliver=deliver,
            audio_format=audio_format,
            sample_rate=int(sample_rate),
            overwrite=overwrite,
            narration_video_policy=narration_policy,
            mix_original=mix_original,
        ),
        segments=segments,
        video_info=video_info,
        video_duration=video_duration,
        warnings=warnings,
    )


def task_route(task: Task) -> str:
    if task.provider == "elevenlabs":
        return "online"
    return "mlx" if task.backend == "mlx_audio" else "torch"


def task_summary(task: Task) -> Dict[str, Any]:
    return {
        "path": str(task.path),
        "mode": task.mode,
        "provider": task.provider,
        "backend": task.backend,
        "model_id": task.model_id,
        "language": task.language,
        "voice": {
            "source": task.voice.source,
            "speaker": task.voice.speaker,
            "voice_id": task.voice.voice_id,
            "reference_audio": str(task.voice.reference_audio) if task.voice.reference_audio else None,
            "reference_text_present": bool(task.voice.reference_text),
        },
        "segments": len(task.segments),
        "input": {
            "srt": str(task.input.srt) if task.input.srt else None,
            "video": str(task.input.video) if task.input.video else None,
            "video_duration": task.video_duration,
        },
        "output": {
            "directory": str(task.output.directory),
            "deliver": task.output.deliver,
            "audio_format": task.output.audio_format,
            "sample_rate": task.output.sample_rate,
            "overwrite": task.output.overwrite,
            "narration_video_policy": task.output.narration_video_policy,
            "mix_original": task.output.mix_original,
        },
        "allow_text_edits": task.allow_text_edits,
        "polish": {"attempt": task.polish.attempt, "max_attempts": task.polish.max_attempts},
        "timing": {
            "max_speed": task.timing.max_speed,
            "safety_gap_sec": task.timing.safety_gap_sec,
            "pause_between_sec": task.timing.pause_between_sec,
        },
        "warnings": list(task.warnings),
    }


# ---------------------------------------------------------------------------
# Tools, media probing, audio processing
# ---------------------------------------------------------------------------


def check_tools() -> None:
    global FFMPEG, FFPROBE, FFMPEG_VERSION, FFPROBE_VERSION
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        missing = [name for name, value in (("ffmpeg", ffmpeg), ("ffprobe", ffprobe)) if not value]
        system = platform.system()
        if system == "Darwin":
            hint = "brew install ffmpeg"
        elif system == "Windows":
            hint = "winget install ffmpeg"
        else:
            hint = "install ffmpeg and ffprobe with your package manager"
        raise SetupError(
            f"Missing required tool(s): {', '.join(missing)}. Install both ffmpeg and "
            f"ffprobe ({hint}) and retry. A package with only ffmpeg is not sufficient."
        )
    FFMPEG = ffmpeg
    FFPROBE = ffprobe
    try:
        result = subprocess.run([FFMPEG, "-version"], capture_output=True, timeout=10)
        FFMPEG_VERSION = _decode_bytes(result.stdout).splitlines()[0].strip() if result.stdout else ""
    except (OSError, subprocess.TimeoutExpired):
        FFMPEG_VERSION = ""
    try:
        result = subprocess.run([FFPROBE, "-version"], capture_output=True, timeout=10)
        FFPROBE_VERSION = _decode_bytes(result.stdout).splitlines()[0].strip() if result.stdout else ""
    except (OSError, subprocess.TimeoutExpired):
        FFPROBE_VERSION = ""


def ffprobe_json(path: Path) -> Dict[str, Any]:
    command = [
        FFPROBE,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RunnerError(f"ffprobe could not inspect {path}: {exc}", stage="probe") from exc
    if result.returncode != 0:
        detail = _decode_bytes(result.stderr).strip()
        raise RunnerError(f"ffprobe failed for {path}: {detail}", stage="probe")
    try:
        return json.loads(_decode_bytes(result.stdout))
    except json.JSONDecodeError as exc:
        raise RunnerError(f"ffprobe returned invalid JSON for {path}: {exc}", stage="probe") from exc


def _mono(pcm: Any):
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32)
    if samples.ndim == 1:
        return np.ascontiguousarray(samples)
    if samples.ndim == 2:
        if samples.shape[1] == 1:
            return np.ascontiguousarray(samples[:, 0])
        return np.ascontiguousarray(samples.mean(axis=1, dtype=np.float32))
    raise ValueError(f"audio must be 1-D or 2-D, got shape {samples.shape}")


def read_wav(path: Path) -> Tuple[Any, int]:
    samples, sample_rate = _sf().read(str(path), dtype="float32", always_2d=False)
    return _mono(samples), int(sample_rate)


def wav_info(path: Path) -> Tuple[int, int, float]:
    info = _sf().info(str(path))
    sample_rate = int(info.samplerate)
    samples = int(info.frames)
    return samples, sample_rate, samples / sample_rate if sample_rate else 0.0


def write_wav_float(path: Path, pcm: Any, sample_rate: int) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = _mono(pcm)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        _sf().write(tmp_name, samples, sample_rate, subtype="FLOAT")
        os.replace(tmp_name, path)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def write_wav_pcm16(path: Path, pcm: Any, sample_rate: int) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = _mono(pcm)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        _sf().write(tmp_name, samples, sample_rate, subtype="PCM_16")
        os.replace(tmp_name, path)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def validate_pcm(pcm: Any, sample_rate: int, *, min_seconds: float = 0.05, min_rms: float = 1e-4) -> float:
    np = _np()
    if sample_rate <= 0:
        raise RunnerError(f"invalid sample rate {sample_rate}", stage="audio")
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise RunnerError("synthesized audio is empty", stage="audio")
    if not np.isfinite(samples).all():
        raise RunnerError("synthesized audio contains NaN or Inf", stage="audio")
    duration = samples.size / sample_rate
    if duration < min_seconds:
        raise RunnerError(
            f"synthesized audio is too short ({duration:.3f}s < {min_seconds:.3f}s)",
            stage="audio",
        )
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    if rms < min_rms:
        raise RunnerError(
            f"synthesized audio is effectively silent (RMS {rms:.2e})",
            stage="audio",
        )
    return duration


def trim_silence(pcm: Any, sample_rate: int) -> Any:
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise RunnerError("cannot trim empty audio", stage="audio")
    frame = max(1, int(sample_rate * 0.01))
    frame_count = (samples.size + frame - 1) // frame
    padded = np.zeros(frame_count * frame, dtype=np.float32)
    padded[: samples.size] = samples
    rms = np.sqrt(np.mean(padded.reshape(frame_count, frame) ** 2, axis=1))
    peak = float(rms.max())
    threshold = max(1e-4, min(0.01, peak * 0.1))
    active = np.flatnonzero(rms > threshold)
    if active.size == 0:
        raise RunnerError("synthesized audio contains only silence", stage="audio")
    first = max(0, (int(active[0]) - 1) * frame)
    last = min(samples.size, (int(active[-1]) + 2) * frame)
    trimmed = np.array(samples[first:last], dtype=np.float32, copy=True)
    fade = min(int(sample_rate * 0.01), trimmed.size // 2)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        trimmed[:fade] *= ramp
        trimmed[-fade:] *= ramp[::-1]
    return trimmed


def resample_audio(pcm: Any, from_rate: int, to_rate: int) -> Any:
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if from_rate == to_rate:
        return np.ascontiguousarray(samples)
    if from_rate <= 0 or to_rate <= 0:
        raise RunnerError(f"invalid resample rates {from_rate} -> {to_rate}", stage="audio")
    with tempfile.TemporaryDirectory(prefix="video-tts-resample-") as tmp:
        source = Path(tmp) / "in.wav"
        target = Path(tmp) / "out.wav"
        _sf().write(source, samples, from_rate, subtype="FLOAT")
        command = [
            FFMPEG,
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-filter:a",
            "aresample=resampler=swr:dither_method=0",
            "-ar",
            str(to_rate),
            str(target),
        ]
        try:
            result = subprocess.run(command, capture_output=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RunnerError(f"ffmpeg resample failed: {exc}", stage="audio") from exc
        if result.returncode != 0:
            raise RunnerError(
                f"ffmpeg resample failed: {_decode_bytes(result.stderr).strip()}",
                stage="audio",
            )
        output, actual_rate = read_wav(target)
    if int(actual_rate) != to_rate:
        raise RunnerError(
            f"resampler produced {actual_rate} Hz, expected {to_rate} Hz",
            stage="audio",
        )
    expected = samples.size * to_rate / from_rate
    if abs(output.size - expected) > expected * 0.02:
        raise RunnerError(
            f"resampler produced {output.size} samples, expected about {expected:.0f}",
            stage="audio",
        )
    return output


def _atempo_chain(speed: float) -> str:
    factors: List[float] = []
    remaining = float(speed)
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    factors.append(remaining)
    return ",".join(f"atempo={factor:.6f}" for factor in factors)


def change_speed(pcm: Any, speed: float, sample_rate: int) -> Any:
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if speed <= 0 or not math.isfinite(speed):
        raise RunnerError(f"invalid speed factor: {speed}", stage="audio")
    if abs(speed - 1.0) < 1e-6 or samples.size == 0:
        return np.ascontiguousarray(samples)
    with tempfile.TemporaryDirectory(prefix="video-tts-atempo-") as tmp:
        source = Path(tmp) / "in.wav"
        target = Path(tmp) / "out.wav"
        _sf().write(source, samples, sample_rate, subtype="FLOAT")
        command = [
            FFMPEG,
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-filter:a",
            _atempo_chain(speed),
            str(target),
        ]
        try:
            result = subprocess.run(command, capture_output=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RunnerError(f"ffmpeg atempo failed: {exc}", stage="audio") from exc
        if result.returncode != 0:
            raise RunnerError(
                f"ffmpeg atempo failed: {_decode_bytes(result.stderr).strip()}",
                stage="audio",
            )
        output, actual_rate = read_wav(target)
    if int(actual_rate) != sample_rate:
        raise RunnerError(
            f"atempo changed the sample rate ({sample_rate} -> {actual_rate})",
            stage="audio",
        )
    expected = samples.size / speed
    if abs(output.size - expected) > expected * 0.03:
        raise RunnerError(
            f"atempo produced {output.size} samples, expected about {expected:.0f}",
            stage="audio",
        )
    return output


def concat_wavs(paths: Sequence[Path], target: Path, pause_seconds: float, sample_rate: int) -> None:
    paths = [Path(path) for path in paths]
    if not paths:
        raise RunnerError("no audio pieces to concatenate", stage="audio")
    infos = [wav_info(path) for path in paths]
    for frames, rate, _duration in infos:
        if rate != sample_rate:
            raise RunnerError(
                f"cannot concatenate mixed sample rates ({sample_rate} vs {rate})",
                stage="audio",
            )
    total = sum(frames for frames, _rate, _duration in infos)
    pause_samples = int(round(pause_seconds * sample_rate))
    if len(paths) > 1:
        total += pause_samples * (len(paths) - 1)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".wav"
    )
    os.close(fd)
    zero = None
    try:
        with _sf().SoundFile(
            tmp_name, mode="w", samplerate=sample_rate, channels=1, subtype="FLOAT"
        ) as dst:
            zero = _np().zeros(min(IO_CHUNK_SAMPLES, max(1, pause_samples)), dtype="float32") if pause_samples else None
            for index, path in enumerate(paths):
                with _sf().SoundFile(str(path)) as src:
                    for block in src.blocks(blocksize=IO_CHUNK_SAMPLES, dtype="float32", always_2d=False):
                        dst.write(_mono(block))
                if index + 1 < len(paths) and pause_samples:
                    remaining = pause_samples
                    while remaining > 0:
                        count = min(zero.size, remaining)
                        dst.write(zero[:count])
                        remaining -= count
        os.replace(tmp_name, target)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def write_track(path: Path, placements: Sequence[Tuple[float, Path, int]], total_seconds: float, sample_rate: int) -> None:
    if total_seconds <= 0:
        raise RunnerError("track duration must be positive", stage="track")
    if sample_rate <= 0:
        raise RunnerError("track sample rate must be positive", stage="track")
    total_samples = int(math.ceil(total_seconds * sample_rate))
    ordered = sorted(placements, key=lambda item: item[0])
    validated: List[Tuple[int, int, Path]] = []
    previous_end = 0
    for index, (start, source_path, samples) in enumerate(ordered):
        if start < 0:
            raise RunnerError(f"placement {index}: negative start {start}", stage="track")
        if samples <= 0:
            raise RunnerError(f"placement {index}: no samples in {source_path}", stage="track")
        start_sample = int(round(start * sample_rate))
        end_sample = start_sample + samples
        if end_sample > total_samples:
            if end_sample - total_samples <= 2:
                end_sample = total_samples
            else:
                raise RunnerError(
                    f"placement {index} ends at {end_sample / sample_rate:.3f}s, "
                    f"beyond track duration {total_seconds:.3f}s",
                    stage="track",
                )
        if start_sample < previous_end:
            raise RunnerError(
                f"placement {index} starts at {start_sample / sample_rate:.3f}s, "
                f"overlapping the previous segment ending at {previous_end / sample_rate:.3f}s",
                stage="track",
            )
        validated.append((start_sample, end_sample, Path(source_path)))
        previous_end = end_sample

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        with _sf().SoundFile(
            tmp_name, mode="w", samplerate=sample_rate, channels=1, subtype="FLOAT"
        ) as dst:
            cursor = 0
            zeros = _np().zeros(IO_CHUNK_SAMPLES, dtype="float32")
            for start_sample, end_sample, source in validated:
                _write_zeros(dst, start_sample - cursor, zeros)
                _copy_segment(dst, source, end_sample - start_sample)
                cursor = end_sample
            _write_zeros(dst, total_samples - cursor, zeros)
        os.replace(tmp_name, target)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def _write_zeros(handle: Any, count: int, zero: Any) -> None:
    remaining = count
    while remaining > 0:
        chunk = min(zero.size, remaining)
        handle.write(zero[:chunk])
        remaining -= chunk


def _copy_segment(handle: Any, path: Path, expected: int) -> None:
    copied = 0
    with _sf().SoundFile(str(path)) as src:
        for block in src.blocks(blocksize=IO_CHUNK_SAMPLES, dtype="float32", always_2d=False):
            block = _mono(block)
            remaining = expected - copied
            if remaining <= 0:
                break
            if block.size > remaining:
                block = block[:remaining]
            handle.write(block)
            copied += block.size
    if copied != expected:
        raise RunnerError(
            f"segment {path} contains {copied} samples, expected {expected}; "
            "the cached part was modified or truncated",
            stage="track",
        )


def pad_track(source: Path, target: Path, target_seconds: float, sample_rate: int) -> None:
    samples, rate, duration = wav_info(source)
    if rate != sample_rate:
        pcm, actual = read_wav(source)
        pcm = resample_audio(pcm, actual, sample_rate)
        write_wav_float(target, pcm, sample_rate)
        source = target
        samples, rate, duration = wav_info(source)
    if duration > target_seconds + 1e-6:
        raise RunnerError(
            f"cannot pad a {duration:.3f}s track down to {target_seconds:.3f}s",
            stage="track",
        )
    write_track(target, [(0.0, source, samples)], target_seconds, sample_rate)


def export_pcm16(source: Path, target: Path, sample_rate: int) -> float:
    pcm, rate = read_wav(source)
    if rate != sample_rate:
        pcm = resample_audio(pcm, rate, sample_rate)
    write_wav_pcm16(target, pcm, sample_rate)
    duration = validate_pcm(pcm, sample_rate)
    return duration


def write_srt(path: Path, entries: Sequence[Tuple[float, float, str]]) -> None:
    def stamp(seconds: float) -> str:
        total_ms = int(round(max(0.0, seconds) * 1000))
        hours, total_ms = divmod(total_ms, 3_600_000)
        minutes, total_ms = divmod(total_ms, 60_000)
        secs, millis = divmod(total_ms, 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    blocks = []
    for number, (start, end, text) in enumerate(entries, start=1):
        if end <= start:
            end = start + 0.001
        body = text.replace("\r\n", "\n").replace("\r", "\n").strip()
        blocks.append(f"{number}\n{stamp(start)} --> {stamp(end)}\n{body}\n")
    atomic_write_text(Path(path), "\n".join(blocks))


def probe_video(path: Path) -> Dict[str, Any]:
    probe = ffprobe_json(path)
    streams = probe.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    if video is None:
        raise RunnerError(f"no video stream in {path}", stage="probe")
    duration = _stream_duration(video, probe)
    if duration is None:
        raise RunnerError(f"could not determine video duration for {path}", stage="probe")
    return {
        "duration": duration,
        "codec_name": str(video.get("codec_name") or ""),
        "has_audio": any(item.get("codec_type") == "audio" for item in streams),
    }


def mux_video(
    video: Path,
    track: Path,
    target: Path,
    video_info: Dict[str, Any],
    *,
    sample_rate: int = SAMPLE_RATE,
    mix_original: Optional[Dict[str, Any]] = None,
) -> List[str]:
    warnings: List[str] = []
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".mp4"
    )
    os.close(fd)
    Path(tmp_name).unlink()

    command = [
        FFMPEG,
        "-y",
        "-v",
        "error",
        "-i",
        str(video),
        "-i",
        str(track),
        "-map",
        "0:v:0",
        "-map_metadata",
        "0",
    ]
    mix = bool(mix_original and mix_original.get("enabled"))
    if mix:
        if not video_info.get("has_audio"):
            warnings.append("mix_original was requested but the video has no original audio; replacing it instead.")
            mix = False
        else:
            volume = float(mix_original.get("volume_db", -18.0))
            command += [
                "-filter_complex",
                f"[0:a:0]volume={volume}dB[orig];[1:a:0][orig]"
                "amix=inputs=2:duration=first:normalize=0[aout]",
                "-map",
                "[aout]",
            ]
    if not mix:
        command += ["-map", "1:a:0"]

    codec = str(video_info.get("codec_name") or "")
    if codec in ("h264", "hevc"):
        command += ["-c:v", "copy"]
        if codec == "hevc":
            command += ["-tag:v", "hvc1"]
    else:
        warnings.append(
            f"video codec {codec or 'unknown'} cannot be copied into MP4; re-encoding with H.264."
        )
        command += [
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
        ]
    command += [
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        str(sample_rate),
        "-movflags",
        "+faststart",
        tmp_name,
    ]
    try:
        with Heartbeat("mux", target.name):
            result = subprocess.run(command, capture_output=True, timeout=1800)
        if result.returncode != 0:
            raise RunnerError(
                f"ffmpeg mux failed: {_decode_bytes(result.stderr).strip()}",
                stage="mux",
            )
        warnings.extend(verify_mux(Path(tmp_name), video_info["duration"]))
        os.replace(tmp_name, target)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise
    return warnings


def verify_mux(path: Path, expected_duration: float, tolerance: float = 0.3) -> List[str]:
    warnings: List[str] = []
    probe = ffprobe_json(path)
    streams = probe.get("streams") or []
    videos = [item for item in streams if item.get("codec_type") == "video"]
    audios = [item for item in streams if item.get("codec_type") == "audio"]
    if len(videos) != 1:
        raise RunnerError(f"output has {len(videos)} video streams, expected 1", stage="verify")
    if len(audios) != 1:
        raise RunnerError(f"output has {len(audios)} audio streams, expected 1", stage="verify")
    if audios[0].get("codec_name") != "aac":
        raise RunnerError(
            f"output audio codec is {audios[0].get('codec_name')!r}, expected 'aac'",
            stage="verify",
        )
    video_duration = _stream_duration(videos[0], probe)
    if video_duration is None:
        raise RunnerError("output video duration is missing", stage="verify")
    if abs(video_duration - expected_duration) > tolerance:
        raise RunnerError(
            f"output video duration {video_duration:.3f}s differs from input "
            f"{expected_duration:.3f}s by more than {tolerance:.3f}s",
            stage="verify",
        )
    audio_duration = _stream_duration(audios[0], probe)
    if audio_duration is None:
        warnings.append("output audio stream has no duration metadata; only the video duration was verified.")
    elif abs(audio_duration - expected_duration) > tolerance:
        raise RunnerError(
            f"output audio duration {audio_duration:.3f}s differs from input video "
            f"{expected_duration:.3f}s by more than {tolerance:.3f}s",
            stage="verify",
        )
    return warnings


# ---------------------------------------------------------------------------
# Model download
# ---------------------------------------------------------------------------


def ensure_model_cached(model_id: str) -> Path:
    try:
        from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    except ImportError as exc:
        raise SetupError(
            "huggingface_hub is missing from the dedicated environment; reinstall the route."
        ) from exc

    log("setup", f"Checking model cache: {model_id}")
    try:
        cached = snapshot_download(model_id, local_files_only=True)
        path = Path(cached)
        has_weights = any(path.glob("*.safetensors")) or any(path.glob("*.bin"))
        if (path / "config.json").is_file() and has_weights:
            log("setup", f"Model cache found: {path}")
            return path
    except Exception:
        pass

    log("download", f"Downloading model weights... {model_id}")
    with Heartbeat("download", model_id):
        try:
            api = HfApi()
            info = api.model_info(model_id, files_metadata=True)
            siblings = [item for item in (info.siblings or []) if item.rfilename]
            total_bytes = sum(int(item.size or 0) for item in siblings)
            if total_bytes:
                log(
                    "download",
                    f"{len(siblings)} files, {total_bytes / 1_000_000_000:.2f} GB total "
                    "(actual progress follows from Hugging Face)",
                )
            else:
                log("download", f"{len(siblings)} files; total size unknown")
            if not siblings:
                snapshot_download(model_id)
            else:
                for index, item in enumerate(siblings, start=1):
                    hf_hub_download(model_id, item.rfilename)
                    log("download", f"{index}/{len(siblings)} files ready")
        except Exception as exc:
            # Fall back to the standard snapshot call; its cache and progress
            # behavior is still real, and the error remains actionable.
            try:
                snapshot_download(model_id)
            except Exception as fallback:
                raise RunnerError(
                    f"model download failed for {model_id}: {fallback}. "
                    "If this is a gated repository, set HF_TOKEN or run "
                    "`huggingface-cli login` first.",
                    stage="download",
                ) from exc

    try:
        path = Path(snapshot_download(model_id, local_files_only=True))
    except Exception as exc:
        raise RunnerError(
            f"model files are still incomplete after download: {model_id}",
            stage="download",
        ) from exc
    if not (path / "config.json").is_file():
        raise RunnerError(
            f"model snapshot is missing config.json: {path}",
            stage="download",
        )
    if not (any(path.glob("*.safetensors")) or any(path.glob("*.bin"))):
        raise RunnerError(
            f"model snapshot has no weight files: {path}",
            stage="download",
        )
    log("download", f"Download complete: {path}")
    return path


# ---------------------------------------------------------------------------
# Result file
# ---------------------------------------------------------------------------


class Result:
    def __init__(self, task: Task) -> None:
        self.task = task
        self.path = task.base / "result.json"
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.data: Dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "status": "running",
            "exit_code": None,
            "started_at": now_iso(),
            "finished_at": None,
            "elapsed_sec": None,
            "task": task_summary(task),
            "environment": {
                "os": platform.system(),
                "arch": platform.machine(),
                "python": sys.executable,
                "python_version": platform.python_version(),
                "ffmpeg": {"path": FFMPEG, "version": FFMPEG_VERSION},
                "ffprobe": {"path": FFPROBE, "version": FFPROBE_VERSION},
                "api_key_present": bool(os.environ.get("ELEVENLABS_API_KEY")),
            },
            "voice": {
                "source": task.voice.source,
                "speaker": task.voice.speaker,
                "voice_id": task.voice.voice_id,
                "reference_audio": str(task.voice.reference_audio) if task.voice.reference_audio else None,
                "reference_text": task.voice.reference_text,
                "name": task.voice.name,
            },
            "clone": None,
            "srt_granularity": "segment",
            "segments": [
                {
                    "index": index,
                    "id": segment.id,
                    "text": segment.text,
                    "original_text": segment.original_text,
                    "status": "pending",
                }
                for index, segment in enumerate(task.segments)
            ],
            "outputs": [],
            "warnings": list(task.warnings),
            "error": None,
        }
        self.save()

    def _save_locked(self) -> None:
        self.data["elapsed_sec"] = round(time.monotonic() - self.started, 3)
        atomic_write_json(self.path, self.data)

    def save(self) -> None:
        with self.lock:
            self._save_locked()

    def set(self, key: str, value: Any) -> None:
        with self.lock:
            self.data[key] = value
            self._save_locked()

    def update_environment(self, values: Dict[str, Any]) -> None:
        with self.lock:
            self.data["environment"].update(values)
            self._save_locked()

    def add_warning(self, message: str) -> None:
        with self.lock:
            if message not in self.data["warnings"]:
                self.data["warnings"].append(message)
                self._save_locked()

    def set_voice(self, **values: Any) -> None:
        with self.lock:
            self.data["voice"].update(values)
            if any(
                self.data["voice"].get(key) is not None
                for key in ("voice_id", "requires_verification", "name")
            ):
                self.data["clone"] = {
                    "voice_id": self.data["voice"].get("voice_id"),
                    "requires_verification": self.data["voice"].get("requires_verification"),
                    "name": self.data["voice"].get("name"),
                }
            self._save_locked()

    def set_segment(self, index: int, **values: Any) -> None:
        with self.lock:
            if 0 <= index < len(self.data["segments"]):
                self.data["segments"][index].update(values)
                self._save_locked()

    def add_output(self, kind: str, path: Path, duration: float, *, sample_rate: Optional[int] = None, note: Optional[str] = None) -> None:
        with self.lock:
            item = {
                "kind": kind,
                "path": str(Path(path).resolve()),
                "duration_sec": round(float(duration), 3),
            }
            if sample_rate is not None:
                item["sample_rate"] = int(sample_rate)
            if note:
                item["note"] = note
            self.data["outputs"].append(item)
            self._save_locked()

    def set_status(self, status: str, exit_code: int, error: Optional[Dict[str, Any]] = None) -> None:
        with self.lock:
            self.data["status"] = status
            self.data["exit_code"] = exit_code
            self.data["error"] = error
            self.data["finished_at"] = now_iso()
            self._save_locked()


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------


class Adapter:
    name = "base"

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        raise NotImplementedError

    def synthesize(self, text: str, output_path: Path) -> int:
        raise NotImplementedError

    def close(self) -> None:
        pass

    def voice_identity(self) -> Dict[str, Any]:
        return {}

    def environment(self) -> Dict[str, Any]:
        return {}


class MLXAdapter(Adapter):
    name = "mlx_audio"

    def __init__(self, task: Task, result: Result, model_loader: Optional[Any] = None) -> None:
        self.task = task
        self.result = result
        self.model_loader = model_loader
        self.model = None
        self.model_path: Optional[Path] = None
        self.speaker: Optional[str] = None
        self.reference_audio: Optional[Path] = None
        self.reference_text: Optional[str] = None

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        if task is not None:
            self.task = task
        if self.model_loader is None:
            from mlx_audio.tts.utils import load_model

            self.model_loader = load_model
        if self.task.voice.source == "clone":
            source = self.task.voice.reference_audio
            text = self.task.voice.reference_text
            if source is None or not text:
                raise TaskError("Local cloning requires reference_audio and reference_text.")
            self.reference_text = text
            self.reference_audio = self.task.work_dir / "reference_local.wav"
            normalize_reference_audio(source, self.reference_audio, 24000)
        self.model_path = ensure_model_cached(self.task.model_id)
        log("load", f"Loading model into memory... {self.task.model_id}")
        try:
            with Heartbeat("load", self.task.model_id):
                self.model = self.model_loader(self.model_path)
        except Exception as exc:
            raise RunnerError(
                f"failed to load MLX model {self.task.model_id}: {exc}. "
                "Check available memory and that the model cache is complete.",
                stage="load",
            ) from exc
        log("load", "Model ready")

        config = getattr(self.model, "config", None)
        model_type = getattr(config, "tts_model_type", None)
        if self.task.voice.source == "preset":
            if model_type != "custom_voice":
                raise TaskError(
                    f"model {self.task.model_id} is not a CustomVoice model; "
                    "preset voices require the CustomVoice model."
                )
            speakers = [str(item) for item in (getattr(self.model, "supported_speakers", []) or [])]
            if not speakers:
                raise TaskError("The model exposes no supported speaker list; preset voices cannot be verified.")
            match = next((item for item in speakers if item.lower() == (self.task.voice.speaker or "").lower()), None)
            if match is None:
                raise TaskError(
                    f"speaker {self.task.voice.speaker!r} is not supported by {self.task.model_id}; "
                    f"supported: {', '.join(speakers)}"
                )
            self.speaker = match
        else:
            if model_type != "base":
                raise TaskError(
                    f"model {self.task.model_id} is not a Base model; cloning requires the Base model."
                )

        languages = [str(item) for item in (getattr(self.model, "supported_languages", []) or [])]
        if languages and self.task.language.lower() not in [item.lower() for item in languages]:
            raise TaskError(
                f"language {self.task.language!r} is not supported by {self.task.model_id}; "
                f"supported: {', '.join(languages)}"
            )
        if not languages:
            warn("model exposes no language list; the backend will validate the language at synthesis time.")
        self.result.update_environment(
            {
                "route": "mlx_audio",
                "model_path": str(self.model_path),
                "model_type": model_type,
                "model_sample_rate": getattr(self.model, "sample_rate", None),
            }
        )

    def synthesize(self, text: str, output_path: Path) -> int:
        np = _np()
        if self.model is None:
            raise RunnerError("MLX model is not loaded", stage="synthesis")
        kwargs: Dict[str, Any] = {
            "text": text,
            "voice": self.speaker,
            "instruct": self.task.parameters.get("instruct") or None,
            "lang_code": self.task.language,
            "split_pattern": None,
        }
        for key in ("temperature", "top_p", "top_k", "repetition_penalty"):
            if self.task.parameters.get(key) is not None:
                kwargs[key] = self.task.parameters[key]
        if self.task.voice.source == "clone":
            kwargs["voice"] = None
            kwargs["instruct"] = None
            kwargs["ref_audio"] = str(self.reference_audio)
            kwargs["ref_text"] = self.reference_text
        seed = self.task.parameters.get("seed")
        if seed is not None:
            try:
                import mlx.core as mx

                mx.random.seed(int(seed))
            except Exception as exc:
                warn(f"could not set MLX random seed: {exc}")

        try:
            results = self.model.generate(**kwargs)
            pieces = []
            sample_rate: Optional[int] = None
            for item in results:
                audio = getattr(item, "audio", None)
                if audio is None:
                    continue
                piece = np.asarray(audio, dtype=np.float32)
                if piece.ndim == 1:
                    pass
                elif piece.ndim == 2:
                    if piece.shape[1] == 1:
                        piece = piece[:, 0]
                    else:
                        piece = piece.mean(axis=1, dtype=np.float32)
                else:
                    raise RunnerError(
                        f"unexpected audio shape from MLX model: {piece.shape}",
                        stage="synthesis",
                    )
                rate = getattr(item, "sample_rate", None) or getattr(self.model, "sample_rate", None)
                if rate is None:
                    raise RunnerError(
                        "MLX model returned audio without a sample rate; refusing to guess.",
                        stage="synthesis",
                    )
                if sample_rate is None:
                    sample_rate = int(rate)
                elif int(rate) != sample_rate:
                    raise RunnerError(
                        f"MLX model returned mixed sample rates ({sample_rate} and {rate})",
                        stage="synthesis",
                    )
                pieces.append(piece)
        except RunnerError:
            raise
        except Exception as exc:
            message = str(exc)
            if "out of memory" in message.lower() or isinstance(exc, MemoryError):
                raise RunnerError(
                    f"MLX ran out of memory: {message}. Close other memory-heavy "
                    "applications and retry; this runner does not switch models.",
                    stage="synthesis",
                ) from exc
            raise RunnerError(
                f"MLX synthesis failed: {message}",
                stage="synthesis",
                retryable=True,
            ) from exc
        if not pieces or sample_rate is None:
            raise RunnerError("MLX model returned no audio", stage="synthesis")
        audio = pieces[0] if len(pieces) == 1 else np.concatenate(pieces, axis=0)
        write_wav_float(output_path, audio, sample_rate)
        return sample_rate

    def close(self) -> None:
        self.model = None
        try:
            import gc

            gc.collect()
        except Exception:
            pass

    def voice_identity(self) -> Dict[str, Any]:
        if self.task.voice.source == "preset":
            return {"speaker": self.speaker}
        assert self.reference_audio is not None
        return {
            "reference_sha256": sha256_file(self.reference_audio),
            "reference_text": self.reference_text,
        }

    def environment(self) -> Dict[str, Any]:
        return {
            "route": "mlx_audio",
            "model_id": self.task.model_id,
            "model_path": str(self.model_path) if self.model_path else None,
            "sample_rate": getattr(self.model, "sample_rate", None) if self.model else None,
        }


class QwenTorchAdapter(Adapter):
    name = "qwen_tts"

    def __init__(
        self,
        task: Task,
        result: Result,
        *,
        torch_module: Optional[Any] = None,
        model_factory: Optional[Any] = None,
    ) -> None:
        self.task = task
        self.result = result
        self.torch_module = torch_module
        self.model_factory = model_factory
        self.model = None
        self.model_path: Optional[Path] = None
        self.speaker: Optional[str] = None
        self.clone_prompt = None
        self.reference_audio: Optional[Path] = None
        self.reference_text: Optional[str] = None
        self.dtype_name = "bfloat16"

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        if task is not None:
            self.task = task
        if self.torch_module is None:
            import torch as torch_module

            self.torch_module = torch_module
        if not self.torch_module.cuda.is_available():
            raise SetupError(
                "torch.cuda is unavailable. Check the NVIDIA driver, the CUDA "
                "wheel build, and nvidia-smi; this runner will not fall back to CPU."
            )
        dtype = self.torch_module.bfloat16
        if hasattr(self.torch_module.cuda, "is_bf16_supported") and not self.torch_module.cuda.is_bf16_supported():
            dtype = self.torch_module.float16
            self.dtype_name = "float16"
            warn("GPU does not support bfloat16; using float16 for this run.")
        else:
            self.dtype_name = "bfloat16"

        if self.task.voice.source == "clone":
            source = self.task.voice.reference_audio
            text = self.task.voice.reference_text
            if source is None or not text:
                raise TaskError("Local cloning requires reference_audio and reference_text.")
            self.reference_text = text
            self.reference_audio = self.task.work_dir / "reference_local.wav"
            normalize_reference_audio(source, self.reference_audio, 24000)

        self.model_path = ensure_model_cached(self.task.model_id)
        log("load", f"Loading model into memory... {self.task.model_id}")
        try:
            with Heartbeat("load", self.task.model_id):
                if self.model_factory is not None:
                    self.model = self.model_factory(
                        self.model_path,
                        dtype=dtype,
                        attn_implementation="sdpa",
                        device_map="cuda",
                    )
                else:
                    try:
                        from qwen_tts import Qwen3TTSModel
                    except ImportError:
                        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel

                    self.model = Qwen3TTSModel.from_pretrained(
                        str(self.model_path),
                        dtype=dtype,
                        attn_implementation="sdpa",
                        device_map="cuda",
                    )
        except Exception as exc:
            message = str(exc)
            if "out of memory" in message.lower():
                raise RunnerError(
                    f"CUDA ran out of memory while loading {self.task.model_id}: {message}. "
                    "Close other GPU applications and retry; this runner does not "
                    "switch to a smaller model or CPU.",
                    stage="load",
                ) from exc
            raise RunnerError(
                f"failed to load qwen-tts model {self.task.model_id}: {message}",
                stage="load",
            ) from exc
        log("load", "Model ready")

        if self.task.voice.source == "preset":
            check = getattr(self.model, "get_supported_speakers", None)
            speakers = check() if callable(check) else None
            if speakers:
                match = next((item for item in speakers if str(item).lower() == (self.task.voice.speaker or "").lower()), None)
                if match is None:
                    raise TaskError(
                        f"speaker {self.task.voice.speaker!r} is not supported by {self.task.model_id}; "
                        f"supported: {', '.join(str(item) for item in speakers)}"
                    )
                self.speaker = str(match)
            else:
                self.speaker = self.task.voice.speaker
        else:
            if self.reference_audio is None or not self.reference_text:
                raise TaskError("Local cloning requires reference_audio and reference_text.")
            try:
                self.clone_prompt = self.model.create_voice_clone_prompt(
                    str(self.reference_audio),
                    ref_text=self.reference_text,
                    x_vector_only_mode=False,
                )
            except Exception as exc:
                raise RunnerError(
                    f"failed to build the voice-clone prompt: {exc}",
                    stage="load",
                ) from exc

        check_lang = getattr(self.model, "get_supported_languages", None)
        languages = check_lang() if callable(check_lang) else None
        if languages and self.task.language.lower() not in [str(item).lower() for item in languages]:
            raise TaskError(
                f"language {self.task.language!r} is not supported by {self.task.model_id}; "
                f"supported: {', '.join(str(item) for item in languages)}"
            )
        if not languages:
            warn("qwen-tts exposes no language list; the backend will validate the language at synthesis time.")

        self.result.update_environment(
            {
                "route": "qwen_tts",
                "model_path": str(self.model_path),
                "dtype": self.dtype_name,
                "device": "cuda",
            }
        )

    def synthesize(self, text: str, output_path: Path) -> int:
        np = _np()
        if self.model is None:
            raise RunnerError("qwen-tts model is not loaded", stage="synthesis")
        seed = self.task.parameters.get("seed")
        if seed is not None:
            self.torch_module.manual_seed(int(seed))
        sampling: Dict[str, Any] = {}
        for key in ("temperature", "top_p", "top_k"):
            if self.task.parameters.get(key) is not None:
                sampling[key] = self.task.parameters[key]
        try:
            if self.task.voice.source == "preset":
                audios, rate = self.model.generate_custom_voice(
                    text,
                    speaker=self.speaker,
                    language=self.task.language,
                    instruct=self.task.parameters.get("instruct") or None,
                    **sampling,
                )
            else:
                audios, rate = self.model.generate_voice_clone(
                    text,
                    language=self.task.language,
                    voice_clone_prompt=self.clone_prompt,
                    **sampling,
                )
        except Exception as exc:
            message = str(exc)
            if "out of memory" in message.lower():
                raise RunnerError(
                    f"CUDA ran out of memory during synthesis: {message}. Close other "
                    "GPU applications and retry; this runner does not switch models.",
                    stage="synthesis",
                ) from exc
            raise RunnerError(
                f"qwen-tts synthesis failed: {message}",
                stage="synthesis",
                retryable=True,
            ) from exc
        if not isinstance(audios, list) or len(audios) != 1:
            raise RunnerError(
                f"qwen-tts returned {len(audios) if isinstance(audios, list) else type(audios)} "
                "audio results for one text; expected exactly one.",
                stage="synthesis",
            )
        audio = np.asarray(audios[0], dtype=np.float32)
        if audio.ndim == 2:
            audio = audio.mean(axis=1, dtype=np.float32) if audio.shape[1] > 1 else audio[:, 0]
        if audio.ndim != 1:
            raise RunnerError(f"unexpected qwen-tts audio shape: {audio.shape}", stage="synthesis")
        write_wav_float(output_path, audio, int(rate))
        return int(rate)

    def close(self) -> None:
        self.model = None
        self.clone_prompt = None
        try:
            import gc

            gc.collect()
            if self.torch_module is not None and self.torch_module.cuda.is_available():
                self.torch_module.cuda.empty_cache()
        except Exception:
            pass

    def voice_identity(self) -> Dict[str, Any]:
        if self.task.voice.source == "preset":
            return {"speaker": self.speaker}
        assert self.reference_audio is not None
        return {
            "reference_sha256": sha256_file(self.reference_audio),
            "reference_text": self.reference_text,
        }

    def environment(self) -> Dict[str, Any]:
        return {
            "route": "qwen_tts",
            "model_id": self.task.model_id,
            "model_path": str(self.model_path) if self.model_path else None,
            "dtype": self.dtype_name,
            "device": "cuda",
        }


class ElevenLabsAdapter(Adapter):
    name = "elevenlabs_http"

    def __init__(
        self,
        task: Task,
        result: Result,
        *,
        session_factory: Optional[Any] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        self.task = task
        self.result = result
        self.session_factory = session_factory
        self.api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
        self.base_url = (base_url or os.environ.get("ELEVENLABS_API_BASE") or "https://api.elevenlabs.io").rstrip("/")
        self.sessions: Dict[int, Any] = {}
        self.lock = threading.Lock()
        self.voice_id: Optional[str] = None
        self.voice_name: Optional[str] = None
        self.requires_verification: Optional[bool] = None
        self.output_format = self.task.parameters.get("output_format", "wav_44100")

    def _requests(self):
        try:
            import requests
        except ImportError as exc:
            raise SetupError(
                "requests is missing from the online environment; reinstall the online route."
            ) from exc
        return requests

    def _session(self):
        requests = self._requests()
        thread_id = threading.get_ident()
        with self.lock:
            session = self.sessions.get(thread_id)
            if session is None:
                if self.session_factory is not None:
                    session = self.session_factory()
                else:
                    session = requests.Session()
                session.headers.update(
                    {
                        "xi-api-key": self.api_key or "",
                        "accept": "application/json",
                    }
                )
                self.sessions[thread_id] = session
            return session

    def _sanitize(self, text: str) -> str:
        if self.api_key:
            text = text.replace(self.api_key, "***")
        return text[:1000]

    def _request(self, method: str, path: str, **kwargs: Any):
        requests = self._requests()
        url = f"{self.base_url}{path}"
        session = self._session()
        try:
            response = session.request(method, url, timeout=(15, 300), **kwargs)
        except requests.exceptions.ConnectTimeout as exc:
            raise RunnerError(
                f"ElevenLabs connection timed out: {self._sanitize(str(exc))}",
                stage="online",
                retryable=True,
            ) from exc
        except requests.exceptions.ReadTimeout as exc:
            raise RunnerError(
                f"ElevenLabs read timed out after the request was sent; submission state "
                f"is unknown: {self._sanitize(str(exc))}. Not retrying to avoid duplicate billing.",
                stage="online",
                submission_unknown=True,
            ) from exc
        except requests.exceptions.SSLError as exc:
            raise RunnerError(
                f"ElevenLabs TLS error: {self._sanitize(str(exc))}",
                stage="online",
            ) from exc
        except requests.exceptions.ConnectionError as exc:
            raise RunnerError(
                f"ElevenLabs connection failed; submission state is unknown: "
                f"{self._sanitize(str(exc))}. Not retrying to avoid duplicate billing.",
                stage="online",
                submission_unknown=True,
            ) from exc
        except (
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ContentDecodingError,
        ) as exc:
            raise RunnerError(
                f"ElevenLabs response was interrupted after the request was sent; "
                f"submission state is unknown: {self._sanitize(str(exc))}. "
                "Not retrying to avoid duplicate billing.",
                stage="online",
                submission_unknown=True,
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise RunnerError(
                f"ElevenLabs request failed: {self._sanitize(str(exc))}",
                stage="online",
                retryable=True,
            ) from exc

        if response.status_code in (200, 201):
            return response
        detail = self._sanitize(getattr(response, "text", "") or "")
        if response.status_code in (401, 403):
            raise RunnerError(
                "ElevenLabs rejected the API key (401/403). Set a valid "
                "ELEVENLABS_API_KEY and retry; no automatic provider or model switch.",
                stage="online",
                details={"http_status": response.status_code},
            )
        if response.status_code == 402:
            raise RunnerError(
                "ElevenLabs reports a quota/payment problem (402). Check the account "
                "plan and billing, then retry.",
                stage="online",
                details={"http_status": response.status_code},
            )
        if response.status_code == 404:
            raise ActionRequired(
                "ElevenLabs could not find the requested model or voice (404). "
                "Choose an available voice/model with the control flow.",
                status="needs_action",
                details={"http_status": 404, "body": detail},
            )
        if response.status_code == 422:
            raise RunnerError(
                f"ElevenLabs rejected the request (422): {detail}",
                stage="online",
                details={"http_status": 422, "body": detail},
            )
        if response.status_code in (408, 409, 429):
            retry_after = None
            raw = response.headers.get("Retry-After") if hasattr(response, "headers") else None
            if raw:
                try:
                    retry_after = float(raw)
                except (TypeError, ValueError):
                    retry_after = None
            raise RunnerError(
                f"ElevenLabs temporarily rejected the request "
                f"({response.status_code}): {detail}",
                stage="online",
                retryable=True,
                retry_after=retry_after,
                details={"http_status": response.status_code},
            )
        if 500 <= response.status_code < 600:
            raise RunnerError(
                f"ElevenLabs server error ({response.status_code}): {detail}",
                stage="online",
                retryable=True,
                details={"http_status": response.status_code},
            )
        raise RunnerError(
            f"ElevenLabs returned unexpected HTTP {response.status_code}: {detail}",
            stage="online",
            details={"http_status": response.status_code},
        )

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        if task is not None:
            self.task = task
        if not self.api_key:
            raise SetupError(
                "ELEVENLABS_API_KEY is not set. Set it in the environment and retry; "
                "do not paste the key into task.json or chat."
            )
        payload = self._request("GET", "/v1/models").json()
        available = [
            item.get("model_id")
            for item in payload
            if isinstance(item, dict) and item.get("model_id")
        ]
        if self.task.model_id not in available:
            raise ActionRequired(
                f"ElevenLabs model {self.task.model_id!r} is not available on this account. "
                "Choose one of the available models with the control flow.",
                status="needs_action",
                details={"available_models": available, "requested_model": self.task.model_id},
            )
        log("setup", f"ElevenLabs model available: {self.task.model_id}")

        if self.task.voice.voice_id:
            self.voice_id = self.task.voice.voice_id
            response = self._request("GET", f"/v1/voices/{self.voice_id}")
            info = response.json()
            self.voice_name = info.get("name")
            if info.get("requires_verification"):
                self.requires_verification = True
                self.result.set_voice(
                    voice_id=self.voice_id,
                    requires_verification=True,
                    name=self.voice_name,
                )
            log("setup", f"ElevenLabs voice available: {self.voice_name or self.voice_id} ({self.voice_id})")
        elif self.task.voice.source == "clone":
            self._create_clone()
        else:
            raise TaskError("ElevenLabs preset voice requires voice.voice_id.")

        if self.requires_verification:
            raise ActionRequired(
                f"The ElevenLabs voice (voice_id {self.voice_id}) requires verification "
                "before it can be used. Complete verification in the ElevenLabs "
                "dashboard, then rerun this task with the saved voice_id.",
                status="needs_action",
                details={
                    "voice_id": self.voice_id,
                    "requires_verification": True,
                    "next": "verify the voice, set voice.voice_id, and set voice.reference_audio to null",
                },
            )

        self.result.update_environment(
            {
                "route": "elevenlabs_http",
                "base_url": self.base_url,
                "model_id": self.task.model_id,
                "voice_id": self.voice_id,
                "voice_name": self.voice_name,
                "requires_verification": self.requires_verification,
            }
        )

    def _create_clone(self) -> None:
        assert self.task.voice.reference_audio is not None
        source = self.task.voice.reference_audio
        # Upload a decoded mono WAV so a video/container reference is accepted.
        path = self.task.work_dir / "reference_upload.wav"
        normalize_reference_audio(source, path, 44100)
        reference_sha = sha256_file(path)
        name = self.task.voice.name or f"video-tts-{reference_sha[:8]}"

        saved = read_clone_state(self.task)
        if (
            saved is not None
            and saved.get("reference_sha256") == reference_sha
            and saved.get("name") == name
            and saved.get("voice_id")
        ):
            self.voice_id = str(saved["voice_id"])
            self.voice_name = name
            self.requires_verification = bool(saved.get("requires_verification"))
            self.result.set_voice(
                voice_id=self.voice_id,
                requires_verification=self.requires_verification,
                name=name,
            )
            log(
                "clone",
                f"Reusing saved clone voice_id {self.voice_id}; no duplicate creation",
            )
            return

        log("clone", f"Creating ElevenLabs voice clone once: {name}")
        data = {
            "name": name,
            "remove_background_noise": "true" if self.task.parameters.get("remove_background_noise") else "false",
        }
        try:
            with open(path, "rb") as handle:
                files = {"files": (path.name, handle, "audio/wav")}
                response = self._request("POST", "/v1/voices/add", data=data, files=files)
        except RunnerError as exc:
            if exc.submission_unknown:
                raise RunnerError(
                    "The clone creation request state is unknown. Do not retry blindly: "
                    "check the ElevenLabs voice list first, because a duplicate clone may "
                    "already exist.",
                    stage="clone",
                    submission_unknown=True,
                ) from exc
            raise
        try:
            payload = response.json()
        except Exception as exc:
            raise RunnerError(
                f"ElevenLabs clone response was not valid JSON: {exc}",
                stage="clone",
            ) from exc
        voice_id = payload.get("voice_id")
        if not voice_id:
            raise RunnerError(
                f"ElevenLabs clone response did not include voice_id: {payload}",
                stage="clone",
            )
        self.voice_id = str(voice_id)
        self.voice_name = name
        self.requires_verification = bool(payload.get("requires_verification"))
        self.result.set_voice(
            voice_id=self.voice_id,
            requires_verification=self.requires_verification,
            name=name,
        )
        write_clone_state(
            self.task,
            {
                "provider": "elevenlabs",
                "reference_sha256": reference_sha,
                "name": name,
                "voice_id": self.voice_id,
                "requires_verification": self.requires_verification,
                "created_at": now_iso(),
            },
        )
        log(
            "clone",
            f"Created voice_id {self.voice_id}; requires_verification={self.requires_verification}",
        )

    def synthesize(self, text: str, output_path: Path) -> int:
        if not self.voice_id:
            raise RunnerError("ElevenLabs voice_id is not ready", stage="synthesis")
        payload: Dict[str, Any] = {
            "text": text,
            "model_id": self.task.model_id,
        }
        settings = self.task.parameters.get("voice_settings")
        if settings:
            payload["voice_settings"] = settings
        if self.task.parameters.get("seed") is not None:
            payload["seed"] = self.task.parameters["seed"]
        if self.task.parameters.get("apply_text_normalization"):
            payload["apply_text_normalization"] = self.task.parameters["apply_text_normalization"]
        if self.task.model_id == "eleven_flash_v2_5" and self.task.language != "auto":
            iso = LANGUAGE_ISO.get(self.task.language)
            if iso:
                payload["language_code"] = iso
        params = {"output_format": self.output_format}
        response = self._request(
            "POST",
            f"/v1/text-to-speech/{self.voice_id}",
            params=params,
            json=payload,
            headers={"accept": "audio/wav"},
        )
        content = response.content
        if len(content) < 44 or content[:4] != b"RIFF":
            raise RunnerError(
                "ElevenLabs returned a response that is not a RIFF/WAV file; "
                "not retrying automatically because the request may already be billed.",
                stage="synthesis",
            )
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            dir=str(output_path.parent), prefix=f".{output_path.name}.", suffix=".wav"
        )
        os.close(fd)
        try:
            with open(tmp_name, "wb") as handle:
                handle.write(content)
            samples, rate = read_wav(Path(tmp_name))
            validate_pcm(samples, rate)
            os.replace(tmp_name, output_path)
        except RunnerError:
            _unlink_quietly(tmp_name)
            raise
        except Exception as exc:
            _unlink_quietly(tmp_name)
            raise RunnerError(
                f"ElevenLabs returned an unreadable WAV: {exc}",
                stage="synthesis",
            ) from exc
        return int(rate)

    def close(self) -> None:
        with self.lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for session in sessions:
            try:
                session.close()
            except Exception:
                pass

    def voice_identity(self) -> Dict[str, Any]:
        return {"voice_id": self.voice_id, "model_id": self.task.model_id}

    def environment(self) -> Dict[str, Any]:
        return {
            "route": "elevenlabs_http",
            "base_url": self.base_url,
            "model_id": self.task.model_id,
            "voice_id": self.voice_id,
            "voice_name": self.voice_name,
            "requires_verification": self.requires_verification,
            "output_format": self.output_format,
        }


def build_adapter(task: Task, result: Result) -> Adapter:
    if task.provider == "local":
        if task.backend == "mlx_audio":
            return MLXAdapter(task, result)
        return QwenTorchAdapter(task, result)
    return ElevenLabsAdapter(task, result)


def clone_state_path(task: Task) -> Path:
    return task.base / "clone.json"


def read_clone_state(task: Task) -> Optional[Dict[str, Any]]:
    path = clone_state_path(task)
    if not path.is_file():
        return None
    try:
        data = _read_json(path)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def write_clone_state(task: Task, data: Dict[str, Any]) -> None:
    atomic_write_json(clone_state_path(task), data)


def normalize_reference_audio(path: Path, target: Path, sample_rate: int = 24000) -> float:
    """Decode any media containing audio into a mono WAV used for cloning.

    The upload/generation path should not depend on the container the user
    supplied.  Validation and normalization happen before a model is loaded or
    an online clone is created, so a bad reference fails fast.
    """
    path = Path(path)
    if not path.is_file():
        raise TaskError(f"reference audio does not exist: {path}")
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        FFMPEG,
        "-y",
        "-v",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(target),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise TaskError(f"reference audio could not be decoded: {path}: {exc}") from exc
    if result.returncode != 0:
        raise TaskError(
            f"reference audio could not be decoded: {path}: "
            f"{_decode_bytes(result.stderr).strip()}"
        )
    pcm, actual_rate = read_wav(target)
    if int(actual_rate) != sample_rate:
        raise TaskError(
            f"reference decoder produced {actual_rate} Hz instead of {sample_rate} Hz"
        )
    duration = validate_pcm(pcm, actual_rate, min_seconds=0.5)
    return duration


# ---------------------------------------------------------------------------
# Synthesis, fitting, track building, delivery
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class NativeSegment:
    segment: Segment
    path: Path
    sample_rate: int
    duration: float
    cache_hits: int
    chunks: int


@dataclasses.dataclass
class ProcessedSegment:
    segment: Segment
    path: Path
    duration: float
    native_duration: float
    native_rate: int
    speed: float
    overflow: Optional[Dict[str, Any]] = None
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None


@dataclasses.dataclass
class TrackInfo:
    path: Path
    duration: float
    sample_rate: int


def split_text(text: str, backend: str) -> List[str]:
    limit = 2000 if backend == "elevenlabs_http" else 280
    parts = re.split(r"(?<=[。！？!?；;\n])", text)
    chunks: List[str] = []
    current = ""
    for part in parts:
        if not part:
            continue
        if len(current) + len(part) <= limit:
            current += part
            continue
        if current:
            chunks.append(current)
            current = ""
        while len(part) > limit:
            chunks.append(part[:limit])
            part = part[limit:]
        current = part
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if chunk.strip()]


def cache_key(task: Task, voice_identity: Dict[str, Any], text: str) -> str:
    parameters = {
        key: value
        for key, value in task.parameters.items()
        if key != "online_concurrency"
    }
    material = {
        "schema": SCHEMA_VERSION,
        "provider": task.provider,
        "backend": task.backend,
        "model_id": task.model_id,
        "language": task.language,
        "voice": voice_identity,
        "parameters": parameters,
        "text": text,
    }
    payload = json.dumps(material, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _load_cached_audio(path: Path) -> Optional[Tuple[Any, int]]:
    if not path.is_file():
        return None
    try:
        pcm, sample_rate = read_wav(path)
        validate_pcm(pcm, sample_rate)
        return pcm, sample_rate
    except Exception:
        _unlink_quietly(path)
        return None


def with_retry(fn: Any, *, attempts: int = RETRY_ATTEMPTS) -> Any:
    last: Optional[RunnerError] = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except RunnerError as exc:
            last = exc
            if exc.submission_unknown or not exc.retryable or attempt >= attempts:
                raise
            delay = exc.retry_after if exc.retry_after is not None else RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
            log("retry", f"attempt {attempt}/{attempts} failed: {exc.message}; retrying in {delay:.1f}s")
            time.sleep(delay)
    if last is not None:
        raise last
    raise RunnerError("retry helper called without a result", stage="internal")


def synthesize_segment(
    task: Task,
    adapter: Adapter,
    result: Result,
    index: int,
    segment: Segment,
    stop: threading.Event,
) -> NativeSegment:
    chunks = split_text(segment.text, task.backend)
    if not chunks:
        raise TaskError(f"segment {segment.id} contains no speakable text.")
    identity = adapter.voice_identity()
    paths: List[Path] = []
    cache_hits = 0
    for chunk_index, chunk in enumerate(chunks, start=1):
        if stop.is_set():
            raise RunnerError("synthesis cancelled", stage="synthesis", segment_id=segment.id)
        key = cache_key(task, identity, chunk)
        cache_path = task.work_dir / "segments" / f"{key}.wav"
        cached = _load_cached_audio(cache_path)
        if cached is not None:
            cache_hits += 1
            log("cache", f"segment {segment.id} chunk {chunk_index}/{len(chunks)}: cache hit")
            paths.append(cache_path)
            continue

        log(
            "synthesis",
            f"Generating segment {segment.id} chunk {chunk_index}/{len(chunks)}...",
        )

        def do_synthesis() -> None:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(
                dir=str(cache_path.parent), prefix=f".{cache_path.name}.", suffix=".wav"
            )
            os.close(fd)
            try:
                adapter.synthesize(chunk, Path(tmp_name))
                pcm, sample_rate = read_wav(Path(tmp_name))
                validate_pcm(pcm, sample_rate)
                os.replace(tmp_name, cache_path)
            except RunnerError:
                _unlink_quietly(tmp_name)
                raise
            except Exception as exc:
                _unlink_quietly(tmp_name)
                raise RunnerError(
                    f"invalid synthesized audio for segment {segment.id}: {exc}",
                    stage="synthesis",
                    segment_id=segment.id,
                ) from exc

        try:
            with_retry(do_synthesis)
        except RunnerError as exc:
            exc.segment_id = segment.id
            raise
        log("synthesis", f"segment {segment.id} chunk {chunk_index}/{len(chunks)} done")
        paths.append(cache_path)

    rates = {wav_info(path)[1] for path in paths}
    if len(rates) != 1:
        raise RunnerError(
            f"segment {segment.id} produced mixed sample rates: {sorted(rates)}",
            stage="synthesis",
            segment_id=segment.id,
        )
    sample_rate = rates.pop()
    if len(paths) == 1:
        native_path = paths[0]
    else:
        native_path = task.work_dir / "native" / f"seg_{segment.id:04d}.wav"
        concat_wavs(paths, native_path, 0.0, sample_rate)
    pcm, actual_rate = read_wav(native_path)
    duration = validate_pcm(pcm, actual_rate)
    result.set_segment(
        index,
        status="synthesized",
        native_path=str(native_path),
        native_duration=round(duration, 3),
        native_sample_rate=actual_rate,
        cache_hits=cache_hits,
        chunks=len(chunks),
    )
    return NativeSegment(
        segment=segment,
        path=native_path,
        sample_rate=actual_rate,
        duration=duration,
        cache_hits=cache_hits,
        chunks=len(chunks),
    )


def synthesize_all(task: Task, adapter: Adapter, result: Result) -> List[NativeSegment]:
    segments = task.segments
    results: List[Optional[NativeSegment]] = [None] * len(segments)
    stop = threading.Event()

    def work(index: int, segment: Segment) -> NativeSegment:
        return synthesize_segment(task, adapter, result, index, segment, stop)

    if task.provider == "elevenlabs":
        workers = min(int(task.parameters.get("online_concurrency", 2)), len(segments))
    else:
        workers = 1
    if workers <= 1:
        for index, segment in enumerate(segments):
            results[index] = work(index, segment)
    else:
        first_error: Optional[Tuple[int, BaseException]] = None
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(work, index, segment): index
                for index, segment in enumerate(segments)
            }
            for future in concurrent.futures.as_completed(futures):
                index = futures[future]
                try:
                    results[index] = future.result()
                except BaseException as exc:
                    stop.set()
                    if first_error is None or index < first_error[0]:
                        first_error = (index, exc)
        if first_error is not None:
            raise first_error[1]
    returned = [item for item in results if item is not None]
    if len(returned) != len(segments):
        raise RunnerError("not all segments were synthesized", stage="synthesis")
    return [item for item in returned if item is not None]


def fit_to_window(
    pcm: Any,
    sample_rate: int,
    window: float,
    max_speed: float,
    target: Path,
) -> Tuple[Any, float, float, Optional[Dict[str, Any]]]:
    np = _np()
    duration = np.asarray(pcm).size / sample_rate
    if window <= 0:
        return pcm, duration, 1.0, {
            "reason": "no_window",
            "synth_duration": duration,
            "window": window,
            "required_speed": None,
        }
    if duration <= window:
        write_wav_float(target, pcm, sample_rate)
        return pcm, duration, 1.0, None
    required = duration / window
    if required > max_speed:
        return pcm, duration, 1.0, {
            "reason": "overflow",
            "synth_duration": duration,
            "window": window,
            "required_speed": required,
            "max_speed": max_speed,
        }
    speed = min(required * 1.001, max_speed)
    output = change_speed(pcm, speed, sample_rate)
    actual = np.asarray(output).size / sample_rate
    if actual > window:
        correction = actual / window
        combined = speed * correction
        if combined > max_speed:
            return pcm, duration, 1.0, {
                "reason": "overflow_after_measure",
                "synth_duration": duration,
                "window": window,
                "required_speed": combined,
                "max_speed": max_speed,
            }
        speed = combined
        output = change_speed(pcm, speed, sample_rate)
        actual = np.asarray(output).size / sample_rate
        if actual > window:
            return pcm, duration, 1.0, {
                "reason": "overflow_after_remeasure",
                "synth_duration": duration,
                "window": window,
                "required_speed": speed,
                "max_speed": max_speed,
            }
    write_wav_float(target, output, sample_rate)
    return output, actual, speed, None


def process_all(task: Task, native: Sequence[NativeSegment], result: Result) -> List[ProcessedSegment]:
    processed: List[ProcessedSegment] = []
    for index, item in enumerate(native):
        pcm, sample_rate = read_wav(item.path)
        validate_pcm(pcm, sample_rate)
        trimmed = trim_silence(pcm, sample_rate)
        master = resample_audio(trimmed, sample_rate, SAMPLE_RATE)
        processed_path = task.work_dir / "processed" / f"seg_{item.segment.id:04d}.wav"
        write_wav_float(processed_path, master, SAMPLE_RATE)
        duration = validate_pcm(master, SAMPLE_RATE)
        record = ProcessedSegment(
            segment=item.segment,
            path=processed_path,
            duration=duration,
            native_duration=item.duration,
            native_rate=item.sample_rate,
            speed=1.0,
        )
        if task.mode == "aligned":
            assert item.segment.window_sec is not None
            fitted_path = task.work_dir / "fitted" / f"seg_{item.segment.id:04d}.wav"
            output, actual, speed, overflow = fit_to_window(
                master,
                SAMPLE_RATE,
                item.segment.window_sec,
                task.timing.max_speed,
                fitted_path,
            )
            record.duration = actual
            record.speed = speed
            if overflow is not None:
                record.overflow = overflow
                record.path = processed_path
                result.set_segment(
                    index,
                    status="overflow",
                    window_sec=round(item.segment.window_sec, 3),
                    synth_duration=round(overflow.get("synth_duration", duration), 3),
                    required_speed=overflow.get("required_speed"),
                    max_speed=task.timing.max_speed,
                    speed=1.0,
                )
            else:
                record.path = fitted_path
                result.set_segment(
                    index,
                    status="fit",
                    window_sec=round(item.segment.window_sec, 3),
                    duration=round(actual, 3),
                    speed=round(speed, 4),
                )
        else:
            result.set_segment(
                index,
                status="processed",
                duration=round(duration, 3),
                speed=1.0,
            )
        result.save()
        processed.append(record)
    return processed


def build_narration_track(
    task: Task, processed: Sequence[ProcessedSegment], result: Result
) -> TrackInfo:
    placements: List[Tuple[float, Path, int]] = []
    cursor = 0.0
    for index, item in enumerate(processed):
        samples, sample_rate, duration = wav_info(item.path)
        if sample_rate != SAMPLE_RATE:
            raise RunnerError(
                f"processed segment {item.segment.id} is {sample_rate} Hz, expected {SAMPLE_RATE}",
                stage="track",
            )
        item.start_sec = cursor
        item.end_sec = cursor + duration
        item.duration = duration
        placements.append((cursor, item.path, samples))
        cursor += duration
        if index + 1 < len(processed):
            cursor += task.timing.pause_between_sec
        result.set_segment(
            index,
            start_sec=round(item.start_sec, 3),
            end_sec=round(item.end_sec, 3),
            duration=round(duration, 3),
        )
    total = processed[-1].end_sec if processed else 0.0
    assert total is not None
    track_path = task.work_dir / "track.wav"
    write_track(track_path, placements, total, SAMPLE_RATE)
    if len(processed) > 1 and task.timing.pause_between_sec > 0:
        result.add_warning(f"narration pause between segments: {task.timing.pause_between_sec:.2f}s")
    log("track", f"Built narration track: {total:.3f}s @ {SAMPLE_RATE} Hz")
    return TrackInfo(track_path, total, SAMPLE_RATE)


def build_aligned_track(
    task: Task, processed: Sequence[ProcessedSegment], result: Result
) -> TrackInfo:
    overflows = [item for item in processed if item.overflow is not None]
    if overflows:
        details = []
        for item in overflows:
            assert item.overflow is not None
            details.append(
                {
                    "segment_id": item.segment.id,
                    "text": item.segment.text,
                    "original_text": item.segment.original_text,
                    "synth_duration": round(item.overflow.get("synth_duration", item.duration), 3),
                    "window_sec": round(float(item.segment.window_sec or 0.0), 3),
                    "required_speed": item.overflow.get("required_speed"),
                    "max_speed": task.timing.max_speed,
                    "reason": item.overflow.get("reason"),
                    "processed_path": str(item.path),
                }
            )
        status = (
            "needs_polish"
            if task.allow_text_edits and task.polish.attempt < task.polish.max_attempts
            else "overflow"
        )
        if status == "needs_polish":
            message = (
                "Some segments do not fit their windows even at the configured maximum speed. "
                "Polishing is authorized: shorten only the listed segments, keep numbers, "
                "proper nouns, conditions and key steps, set original_text, increment "
                "polish.attempt, and rerun. Unchanged segments will reuse cached audio."
            )
        else:
            message = (
                "Some segments do not fit their windows and no more automatic polishing "
                "is available. Choose a new segmentation/timing, allow polishing, or adjust "
                "the task with the user; this runner will not truncate speech."
            )
        raise ActionRequired(
            message,
            status=status,
            stage="fit",
            details={
                "overflow": details,
                "polish_attempt": task.polish.attempt,
                "max_attempts": task.polish.max_attempts,
                "allow_text_edits": task.allow_text_edits,
            },
        )

    placements: List[Tuple[float, Path, int]] = []
    previous_end = -1.0
    for index, item in enumerate(processed):
        assert item.segment.start_sec is not None
        samples, sample_rate, duration = wav_info(item.path)
        if sample_rate != SAMPLE_RATE:
            raise RunnerError(
                f"processed segment {item.segment.id} is {sample_rate} Hz, expected {SAMPLE_RATE}",
                stage="track",
            )
        start = item.segment.start_sec
        end = start + duration
        if index + 1 < len(processed):
            next_start = processed[index + 1].segment.start_sec
            assert next_start is not None
            allowed = next_start - task.timing.safety_gap_sec
            if end > allowed + 0.005:
                raise RunnerError(
                    f"segment {item.segment.id} ends at {end:.3f}s, crossing the allowed "
                    f"boundary {allowed:.3f}s; refusing to overlap the next segment.",
                    stage="fit",
                    segment_id=item.segment.id,
                )
        elif task.video_duration is not None and end > task.video_duration + 0.005:
            raise RunnerError(
                f"final segment {item.segment.id} ends at {end:.3f}s, beyond the video "
                f"duration {task.video_duration:.3f}s; refusing to mux a truncated track.",
                stage="fit",
                segment_id=item.segment.id,
            )
        if start < previous_end - 0.005:
            raise RunnerError(
                f"segment {item.segment.id} starts at {start:.3f}s, overlapping the "
                f"previous segment ending at {previous_end:.3f}s.",
                stage="fit",
                segment_id=item.segment.id,
            )
        placements.append((start, item.path, samples))
        item.start_sec = start
        item.end_sec = end
        item.duration = duration
        previous_end = end
        result.set_segment(
            index,
            start_sec=round(start, 3),
            end_sec=round(end, 3),
            duration=round(duration, 3),
        )

    if task.video_duration is not None:
        total = task.video_duration
    else:
        # SRT-only delivery ends at the source's last subtitle end, not at the
        # actual speech end; the remaining space is silence.
        total = processed[-1].segment.end_sec
        assert total is not None
    track_path = task.work_dir / "track.wav"
    write_track(track_path, placements, total, SAMPLE_RATE)
    log("track", f"Built aligned track: {total:.3f}s @ {SAMPLE_RATE} Hz")
    return TrackInfo(track_path, total, SAMPLE_RATE)


def _output_stem(task: Task) -> str:
    if task.input.video is not None:
        return task.input.video.stem
    if task.input.srt is not None:
        return task.input.srt.stem
    return "narration"


def choose_output_names(task: Task, deliver: Sequence[str]) -> Dict[str, Path]:
    directory = task.output.directory
    directory.mkdir(parents=True, exist_ok=True)
    stem = _output_stem(task) + ".dub"
    extensions = {"audio": ".wav", "video": ".mp4", "subtitle": ".srt"}
    suffix = ""
    if not task.output.overwrite:
        counter = 1
        while True:
            candidate = f"{stem}{suffix}"
            if not any((directory / (candidate + extensions[kind])).exists() for kind in deliver):
                break
            counter += 1
            suffix = f"_{counter}"
    names = {kind: directory / (f"{stem}{suffix}" + extensions[kind]) for kind in deliver}
    protected = [task.path]
    if task.input.srt is not None:
        protected.append(task.input.srt)
    if task.input.video is not None:
        protected.append(task.input.video)
    if task.voice.reference_audio is not None:
        protected.append(task.voice.reference_audio)
    protected_real = {_real(str(path)) for path in protected}
    for path in names.values():
        if _real(str(path.resolve())) in protected_real:
            raise TaskError(f"output path would overwrite an input file: {path}")
    return names


def _subtitle_entries(
    track: TrackInfo, processed: Sequence[ProcessedSegment]
) -> List[Tuple[float, float, str]]:
    entries: List[Tuple[float, float, str]] = []
    for item in processed:
        if item.start_sec is None or item.end_sec is None:
            raise RunnerError(
                f"segment {item.segment.id} has no final placement",
                stage="subtitle",
            )
        start = max(0.0, float(item.start_sec))
        end = min(float(item.end_sec), track.duration)
        if end <= start:
            raise RunnerError(
                f"segment {item.segment.id} has a non-positive subtitle interval",
                stage="subtitle",
            )
        entries.append((start, end, item.segment.text))
    return entries


def accelerate_track(task: Task, track: TrackInfo, target: float, result: Result) -> TrackInfo:
    required = track.duration / target if target > 0 else float("inf")
    if required > task.timing.max_speed:
        raise ActionRequired(
            f"Narration audio is {track.duration:.3f}s but the video is {target:.3f}s; "
            f"fitting would require {required:.2f}x, above the configured "
            f"{task.timing.max_speed:.2f}x limit. Choose a different option with the user.",
            status="needs_action",
            stage="video",
            details={
                "audio_duration": track.duration,
                "video_duration": target,
                "required_speed": required,
                "max_speed": task.timing.max_speed,
            },
        )
    pcm, sample_rate = read_wav(track.path)
    # A small margin makes the measured output fit instead of landing a few
    # milliseconds over the target; it is still capped by max_speed.
    speed = min(max(required * 1.005, required + 0.001), task.timing.max_speed)
    output = change_speed(pcm, speed, sample_rate)
    actual = _np().asarray(output).size / sample_rate
    # Sample rounding can leave a few milliseconds; do not call that a failure.
    if actual > target + 0.02:
        raise ActionRequired(
            f"Narration audio still exceeds the video after acceleration "
            f"({actual:.3f}s > {target:.3f}s). Choose another option with the user.",
            status="needs_action",
            stage="video",
            details={
                "audio_duration": track.duration,
                "video_duration": target,
                "measured_duration": actual,
                "required_speed": required,
                "applied_speed": speed,
                "max_speed": task.timing.max_speed,
            },
        )
    target_path = task.work_dir / "track_accelerated.wav"
    write_wav_float(target_path, output, sample_rate)
    result.add_warning(
        f"narration accelerated by {speed:.3f}x to fit the video duration; "
        "the standalone audio uses this accelerated track"
    )
    log("fit", f"Narration accelerated {speed:.3f}x: {track.duration:.3f}s -> {actual:.3f}s")
    return TrackInfo(target_path, actual, sample_rate)


def deliver(
    task: Task, track: TrackInfo, processed: Sequence[ProcessedSegment], result: Result
) -> None:
    deliver_kinds = list(task.output.deliver)
    video_info = task.video_info
    video_target = task.video_duration

    if "video" in deliver_kinds and task.mode == "narration":
        assert video_target is not None
        if track.duration > video_target + 0.005:
            policy = task.output.narration_video_policy
            required = track.duration / video_target
            if policy == "ask":
                raise ActionRequired(
                    f"Narration audio is {track.duration:.3f}s but the video is "
                    f"{video_target:.3f}s. Choose with the user: accelerate to fit "
                    f"(requires {required:.2f}x, limit {task.timing.max_speed:.2f}x) "
                    "or deliver audio only. The runner does not truncate content.",
                    status="needs_action",
                    stage="video",
                    details={
                        "audio_duration": track.duration,
                        "video_duration": video_target,
                        "required_speed": required,
                        "max_speed": task.timing.max_speed,
                        "track_path": str(track.path),
                    },
                )
            if policy == "accelerate":
                track = accelerate_track(task, track, video_target, result)
            elif policy == "audio_only":
                deliver_kinds = [kind for kind in deliver_kinds if kind != "video"]
                if not deliver_kinds:
                    raise TaskError(
                        "narration_video_policy=audio_only removed the only selected "
                        "deliverable; add audio or subtitle to output.deliver."
                    )
                result.add_warning(
                    "video delivery skipped by narration_video_policy=audio_only; "
                    "audio and/or subtitle are delivered instead"
                )
            else:
                raise TaskError(f"unknown narration_video_policy: {policy!r}")

    names = choose_output_names(task, deliver_kinds)

    if "video" in deliver_kinds:
        assert task.input.video is not None and video_info is not None and video_target is not None
        mux_source = track.path
        if task.mode == "narration" and track.duration < video_target - 0.001:
            padded = task.work_dir / "track_padded.wav"
            pad_track(track.path, padded, video_target, SAMPLE_RATE)
            mux_source = padded
            log("video", f"Padding narration tail by {video_target - track.duration:.3f}s for muxing")
        if task.mode == "aligned" and abs(track.duration - video_target) > 0.05:
            raise RunnerError(
                f"aligned track is {track.duration:.3f}s but video is {video_target:.3f}s; "
                "refusing to mux a mismatched track.",
                stage="video",
            )
        log("mux", f"Muxing {mux_source.name} into {names['video'].name}")
        if task.output.mix_original.get("enabled") and video_info.get("has_audio"):
            result.add_warning(
                "original video audio was mixed in at "
                f"{task.output.mix_original.get('volume_db')} dB; original voices "
                "remain audible (this is not vocal separation)"
            )
        mux_warnings = mux_video(
            task.input.video,
            mux_source,
            names["video"],
            video_info,
            sample_rate=SAMPLE_RATE,
            mix_original=task.output.mix_original,
        )
        for message in mux_warnings:
            result.add_warning(message)
        result.add_output("video", names["video"], video_target, sample_rate=None)
        log("verify", f"Video verified: {names['video']}")

    if "audio" in deliver_kinds:
        duration = export_pcm16(track.path, names["audio"], SAMPLE_RATE)
        result.add_output("audio", names["audio"], duration, sample_rate=SAMPLE_RATE)
        log("deliver", f"Audio -> {names['audio']} ({duration:.3f}s)")

    if "subtitle" in deliver_kinds:
        entries = _subtitle_entries(track, processed)
        write_srt(names["subtitle"], entries)
        result.add_output(
            "subtitle",
            names["subtitle"],
            track.duration,
            note="segment-level timestamps from actual synthesized audio",
        )
        log("deliver", f"Subtitle -> {names['subtitle']} ({len(entries)} cues, segment-level)")


# ---------------------------------------------------------------------------
# Task execution
# ---------------------------------------------------------------------------


def _ensure_work_dirs(task: Task) -> None:
    for name in ("segments", "native", "processed", "fitted"):
        (task.work_dir / name).mkdir(parents=True, exist_ok=True)


def _voice_label(task: Task) -> str:
    if task.voice.source == "preset":
        if task.provider == "local":
            return f"preset:{task.voice.speaker}"
        return f"preset:{task.voice.voice_id}"
    if task.voice.voice_id:
        return f"clone:{task.voice.voice_id}"
    return f"clone:new({task.voice.reference_audio})"


def run_task(task: Task) -> int:
    check_tools()
    result = Result(task)
    adapter: Optional[Adapter] = None
    try:
        _ensure_work_dirs(task)
        log(
            "task",
            f"mode={task.mode} provider={task.provider} backend={task.backend} "
            f"model={task.model_id} voice={_voice_label(task)} "
            f"segments={len(task.segments)} deliver={','.join(task.output.deliver)}",
        )
        for message in task.warnings:
            warn(message)
        adapter = build_adapter(task, result)
        adapter.prepare(task, lambda stage, message: log(stage, message))
        result.update_environment(adapter.environment())
        native = synthesize_all(task, adapter, result)
        processed = process_all(task, native, result)
        if task.mode == "aligned":
            track = build_aligned_track(task, processed, result)
        else:
            track = build_narration_track(task, processed, result)
        deliver(task, track, processed, result)
        result.set_status("completed", EXIT_OK)
        log("done", f"status=completed elapsed={result.data['elapsed_sec']:.1f}s")
        return EXIT_OK
    except ActionRequired as exc:
        status = exc.status
        payload = exc.payload(status=status)
        result.set_status(status, EXIT_ACTION, payload)
        print(f"[action] {exc.message}", file=sys.stderr, flush=True)
        print(f"[action] details written to {result.path}", file=sys.stderr, flush=True)
        return EXIT_ACTION
    except RunnerError as exc:
        status = "invalid_task" if exc.exit_code == EXIT_INVALID else "failed"
        payload = exc.payload(status=status)
        result.set_status(status, exc.exit_code, payload)
        print(f"[error] stage={exc.stage}: {exc.message}", file=sys.stderr, flush=True)
        print(f"[error] details written to {result.path}", file=sys.stderr, flush=True)
        if os.environ.get("VIDEO_TTS_DEBUG"):
            import traceback

            traceback.print_exc()
        return exc.exit_code
    except KeyboardInterrupt:
        result.set_status("cancelled", EXIT_FAIL, {"stage": "run", "message": "cancelled by user"})
        print("[error] cancelled by user", file=sys.stderr, flush=True)
        return EXIT_FAIL
    except Exception as exc:
        result.set_status(
            "failed",
            EXIT_FAIL,
            {"stage": "internal", "message": str(exc), "exit_code": EXIT_FAIL},
        )
        print(f"[error] internal failure: {exc}", file=sys.stderr, flush=True)
        if os.environ.get("VIDEO_TTS_DEBUG"):
            import traceback

            traceback.print_exc()
        return EXIT_FAIL
    finally:
        if adapter is not None:
            try:
                adapter.close()
            except Exception:
                pass


def check_summary(path: Any) -> Dict[str, Any]:
    try:
        task = load_task(path, require_media_tools=False)
        return {"ok": True, **task_summary(task)}
    except RunnerError as exc:
        return {"ok": False, "error": exc.payload()}
    except Exception as exc:
        return {
            "ok": False,
            "error": {"stage": "task", "message": str(exc), "exit_code": EXIT_INVALID},
        }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _reconfigure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _print_json(data: Any) -> None:
    print(json_dumps(data), end="")


def main(argv: Optional[Sequence[str]] = None) -> int:
    _reconfigure_stdio()
    parser = argparse.ArgumentParser(
        description="video-tts single-file runner. Task data is read only from task.json."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--task", help="path to task.json")
    group.add_argument("--detect", action="store_true", help="print capability detection JSON")
    group.add_argument("--list-voices", action="store_true", help="print available voices JSON")
    parser.add_argument("--check", action="store_true", help="validate task.json without synthesis")
    parser.add_argument("--provider", choices=["local", "elevenlabs"], help="provider for --list-voices")
    parser.add_argument("--no-install", action="store_true", help="do not create an environment")
    args = parser.parse_args(argv)

    if args.detect:
        _print_json(detect_environment())
        return EXIT_OK

    if args.list_voices:
        provider = args.provider
        if provider is None:
            _print_json({"ok": False, "error": "--provider is required with --list-voices"})
            return EXIT_INVALID
        try:
            payload = list_local_voices() if provider == "local" else list_online_voices()
            _print_json({"ok": True, **payload})
            return EXIT_OK
        except RunnerError as exc:
            _print_json({"ok": False, "error": exc.payload()})
            return exc.exit_code

    if args.task is None:
        _print_json({"ok": False, "error": "--task is required"})
        return EXIT_INVALID

    if args.check:
        summary = check_summary(args.task)
        _print_json(summary)
        return EXIT_OK if summary.get("ok") else EXIT_INVALID

    try:
        check_tools()
        task = load_task(args.task, require_media_tools=True)
    except RunnerError as exc:
        print(f"[error] stage={exc.stage}: {exc.message}", file=sys.stderr, flush=True)
        return exc.exit_code

    route = task_route(task)
    log("setup", f"Checking current interpreter for route: {route}")
    with Heartbeat("setup", "checking current interpreter"):
        current_ok = interpreter_ok(sys.executable, route)
    if not current_ok:
        try:
            python = ensure_environment(route, allow_install=not args.no_install)
        except RunnerError as exc:
            print(f"[error] stage={exc.stage}: {exc.message}", file=sys.stderr, flush=True)
            return exc.exit_code
        if not _same_executable(python, sys.executable):
            log("setup", f"Re-running task in {python}")
            command = [python, os.path.abspath(__file__), "--task", str(task.path)]
            if args.no_install:
                command.append("--no-install")
            completed = subprocess.run(command)
            return int(completed.returncode)

    return run_task(task)


if __name__ == "__main__":
    sys.exit(main())
```
<!-- runner:end -->
