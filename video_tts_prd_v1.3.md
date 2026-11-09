# 需求文档：跨平台单文件视频配音 Skill（video-tts）

| 版本 | 状态 | 日期 | 定位 |
| --- | --- | --- | --- |
| v1.3 | 单 Agent 修订稿，待实现验收 | 2026-11-09 | 本地千问 + 在线 ElevenLabs；task.json；始终单 Agent 执行 |

## 1. 目标与范围

用一个可分发的 `SKILL.md`，完成文稿旁白或 SRT 时间轴配音。支持用户在 macOS 与 Windows 之间使用；根据平台检测能力，准备用户选择的环境，并通过 AskUserQuestion 收集决策。

单文件指分发包只有 `SKILL.md`。执行时允许生成临时 Python 脚本、分段音频和必要的任务数据；依赖、模型与用户配置存放在各平台用户目录，不塞入 skill 分发包。

服务范围明确为：**本地使用 Qwen3-TTS，在线使用 ElevenLabs**。不接入 Edge TTS、百炼或其他云服务，不因环境中存在其他服务的密钥而增加或切换路线。

不以固定文件体积为目标，不承诺零依赖或所有系统表现完全一致。保留开发验收；发布时排除测试目录、编译缓存、`.pytest_cache`、`__MACOSX` 等内容。

### 1.1 明确保留

- 多平台、多后端自动探测与安装，包括本地路线的依赖和模型准备。
- 跨平台动态环境管理、环境隔离和安装后验证。
- provider、音色来源、具体音色及交付格式的用户选择。
- 所有需要用户决策的环节使用 AskUserQuestion；其他宿主须提供等价的结构化选择控件。
- 预设音色与参考音频克隆；能力按所选后端分别验证。
- LLM 语义分段，以及对齐配音所需的静音填充和适度变速。
- 统一以 UTF-8 `task.json` 传递任务；冷启动期间显示真实下载、加载和合成阶段。
- 始终由同一个 Agent 完成规划、执行与复核。

### 1.2 简化或取消

- 取消完整 Job Manifest 状态机、复杂恢复对账和多级配置修订历史。
- 取消为每次语义分组强制生成独立计划文件及全源 SRT 哈希校验。
- 取消正文修改的“双层授权字段 + CLI 开关”，改为本次任务明确选择是否允许润色。
- 取消无条件生成详细报告、逐段导出和多种内部交付文件。
- 取消固定条数和句末标点作为语义分段的强制门槛。
- 第一版不提供文字设计音色；保留预设音色与参考克隆。

## 2. 两种配音模式

| 模式 | 输入 | 时长处理 | 主要交付 |
| --- | --- | --- | --- |
| 普通旁白 | 文稿；也可从 SRT 提取正文 | 按自然朗读时长输出；不按视频强制补齐或变速 | 配音音频，按需生成字幕 |
| 对齐配音 | SRT；可同时提供视频 | 根据时间窗放置语段、补静音，必要时适度加速 | 对齐音轨，按需合成视频与字幕 |

模式已由用户明确指定时直接采用；含义不清时用 AskUserQuestion 选择。普通旁白即使提供视频，也不自动改成对齐配音。

普通旁白要求合成视频时：保留视频原时长，音频较短可仅在封装阶段补尾部静音，独立旁白音频仍保持自然时长；音频长于视频时，通过控件选择调整方案，不截断内容。

## 3. 跨平台环境管理

### 3.1 检测先于安装

先执行轻量检测，识别 OS、架构、Python、ffmpeg 与 ffprobe。探测已存在的后端依赖和模型，不为列出选项提前安装所有后端或加载所有模型。

能力状态至少区分：

- **ready**：依赖和必要能力已验证，可执行。
- **needs_setup**：硬件路线适用，仍需安装依赖或下载模型；允许用户选择后自动准备。
- **unsupported**：当前硬件或平台不支持，给出原因。
- **unknown**：探测失败，给出原因，不能当作已验证可用。

### 3.2 后端范围

| 平台或路线 | 初始支持范围 | 验证重点 |
| --- | --- | --- |
| Apple Silicon macOS | 本地 MLX；在线服务 | 原生 arm64 Python、Metal、TTS API |
| Intel macOS / Rosetta | 在线服务 | 在线依赖、网络和鉴权；不默认提供 MLX 本地路线 |
| Windows x64 + NVIDIA | 本地 PyTorch/CUDA；在线服务 | 驱动与 wheel 兼容性、CUDA 构建、真实张量运算、TTS API |
| Windows 无可用 NVIDIA GPU | 在线服务 | 不自动安装不可用的 CUDA 路线 |
| 在线服务 | ElevenLabs | 模型可用性、账户可访问音色、鉴权和克隆能力 |

### 3.2.1 固定的模型与用途

| 环境 | 用途 | 后端 | 精确模型 ID |
| --- | --- | --- | --- |
| macOS Apple Silicon | 预设音色 | mlx-audio | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16` |
| macOS Apple Silicon | 参考克隆 | mlx-audio | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` |
| Windows x64 + NVIDIA | 预设音色 | 官方 qwen-tts | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` |
| Windows x64 + NVIDIA | 参考克隆 | 官方 qwen-tts | `Qwen/Qwen3-TTS-12Hz-1.7B-Base` |
| 在线 ElevenLabs | 所选声音的语音合成 | ElevenLabs HTTP API | `eleven_multilingual_v2` |
| 在线 ElevenLabs | 所选声音的快速语音合成 | ElevenLabs HTTP API | `eleven_flash_v2_5` |

模型由环境、音色来源和用户选择确定并写入任务，不暗中切换 0.6B、量化版本或其他模型。具体库版本与安装组合经过目标平台验收后固定，不在每次运行时无条件升级。

CustomVoice 用于预设音色，Base 用于参考克隆，不能互相替代。即使模型卡自动示例包含参考参数，也以模型能力和实际后端 API 为准。预设音色名称从实际模型的支持列表核对，不能把 ElevenLabs voice_id 当成本地 speaker。

### 3.2.2 Mac 路线与参考项目

Mac 主实现使用 **mlx-audio**；上述两个 MLX 模型卡明确提供该库的用法。Adapter 通过 `mlx_audio.tts.utils.load_model` 加载模型，以 `generate(text, voice, instruct, lang_code, ref_audio, ref_text, ...)` 对应能力传参；消费完整生成迭代器，不能仅取第一块音频。采样率以实际结果为准。

用户提供的 [odiak/Qwen3-TTS-MLX](https://github.com/odiak/Qwen3-TTS-MLX#mlx-on-apple-silicon-experimental) 是另一个实验性实现，应作为技术参考，不能混用它与 mlx-audio 的依赖、模型格式或参数名。其 README 使用 `Qwen3TTSMLXModel`，标注 `instruct` 暂不支持，完整克隆提示提取可能涉及 PyTorch。这些限制不能被当作 mlx-audio 的限制，反之亦然。

首版不自动安装或降级到该实验分支；更换 Mac 运行时需独立适配和验收。

### 3.2.3 Windows 与 ElevenLabs 的接口边界

- Windows 使用官方 `qwen_tts.Qwen3TTSModel`。预设音色调用 `generate_custom_voice`；克隆可先用 `create_voice_clone_prompt` 提取一次参考条件，再在全片复用并调用 `generate_voice_clone`。参数采用官方的 `speaker`、`language`，不直接照搬 MLX 的参数名。
- ElevenLabs 的 `model_id` 与 `voice_id` 是独立字段。现有音色和已创建的克隆音色都通过可访问的 `voice_id` 合成；克隆声音不是一个额外的 TTS 模型 ID。
- 新建在线克隆：使用 `POST /v1/voices/add` 上传参考录音，保存返回的 `voice_id` 和 `requires_verification`。需要验证时完成前不声称音色可用；未返回可用结果时不盲目重复创建。
- 在线合成：使用 `POST /v1/text-to-speech/{voice_id}`，JSON 请求体传递正文及选定的 `model_id`。创建克隆只做一次，后续语段复用 voice_id，不逐句创建音色。
- 首版统一用 `requests` 实现 HTTPS 调用，不同时维护 requests 与 elevenlabs SDK 两套调用逻辑。`requests` 是网络库，`elevenlabs` 是可替代的官方 SDK，它们都不是模型名称。
- `eleven_multilingual_v2` 与 `eleven_flash_v2_5` 按用户要求列为首版支持范围，不称它们为最新旗舰。运行前核对服务返回的模型与音色可用性；不可用时通过控件选择，不自动改型号。
- 在线克隆不强制索取本地 Qwen 克隆所需的 `ref_text`；具体必需字段按各后端分别校验。

### 3.3 自动安装规则

1. 用户选定 provider 后，只准备这条路线需要的环境。
2. 优先复用已经验证可用的环境；缺依赖则在用户目录的专用隔离环境自动安装，不向系统 Python 安装。
3. 缺少 Python、ffmpeg 或 ffprobe 时，按本机可用包管理器或用户目录便携方案准备；实际权限请求交给宿主处理，不绕过限制。
4. 本地路线允许自动安装依赖和下载模型。执行摘要说明首次下载与磁盘需求；不重复询问已明确选择的路线。体积未知时如实说明，不编造估计。
5. Windows 根据实际驱动兼容性选择经验证的 CUDA 安装组合；不固定一个 cuXXX 适用于全部机器。
6. 安装结束重新验证二进制、后端 API 和硬件运算。失败时指出阶段及原因，由控件选择重试、修复或换路线。
7. 不因为安装失败、网络错误或检测到 API Key 自动更换 provider，不擅自降模型或改音色来源。

ffmpeg 与 ffprobe 必须分别验证。若采用只提供 ffmpeg 的便携包，还需补齐 ffprobe 或实现等价探测，并传递实际可执行路径。

### 3.3.1 首次下载与模型加载体验

冷启动须区分缓存检查、权重下载、模型加载与首段推理。不能在所有阶段只显示一个“处理中”，也不能缓存已经齐全时仍声称在下载。

示例日志（按实际阶段输出）：

```text
[setup] Checking model cache: <model_id>
[download] Downloading model weights... <model_id>
[download] <实际文件数或字节进度；仅在可取得时显示>
[load] Loading model into memory... <model_id>
[synthesis] Generating segment 1/24...
```

下载优先使用 Hugging Face Hub 的缓存和进度能力；下载后明确加载已准备好的目录，避免第二次隐式下载。下载、加载前立即打印阶段日志并 flush，长时间没有底层输出时约每 10 秒显示一次阶段及已耗时心跳。底层能提供真实字节、速度或文件进度时转发；无法取得时不伪造百分比或剩余时间。

进度不能只依赖 TTY 动态进度条，应能在宿主捕获 stdout/stderr 的情况下显示；宿主转述当前阶段，用户不必打开终端寻找信息。失败日志区分下载、加载、内存不足和推理错误，并保留已完成的库缓存或任务片段。

### 3.4 路径与编码

- 使用 `pathlib.Path` 处理路径；任务工作目录使用独立目录，避免不同素材的 `seg_001` 相互覆盖。
- 正文、参考文本和任务参数全部写入 `task.json`，不通过 `--text` 等命令行选项传递，也不插入 Python 源码。
- 调用 runner 和 ffmpeg 等工具仍须使用子进程参数列表及 `shell=False`；JSON 本身不能防止后续把数据重新拼成 shell 或源码。
- Python 文本文件明确使用 UTF-8；SRT 可兼容 UTF-8 BOM，其他编码在识别后转换或请求确认。
- Python 子进程可设置 UTF-8 输出；外部工具输出按实际编码处理，必要时以字节捕获并容错解码。不能假定环境变量会把所有外部程序都变成 UTF-8。

## 4. 控件交互契约

所有需要用户选择或决策的环节必须使用 AskUserQuestion 或等价控件。普通消息用于说明、展示试听和报告进度。

凡无法从用户明确要求、当前任务已确认选择或输入材料确定，且需要用户提供答案才能继续的事项，也必须通过 AskUserQuestion 收集，包括缺失信息、偏好、歧义澄清和失败后的处理选择。不能在普通消息中附带问题，不能通过猜测、推荐值或等待超时替代答案。

工具名按宿主映射到等价的结构化用户输入控件；仍须满足上述决策方式。技术事实的不确定性优先通过检测、读取文档或验证解决；只有确需用户回答的部分才提问，不能把可自行核查的常规技术工作转交给用户。

每次任务保留以下选择；当前任务中用户已明确指定的内容视为已作决定，不再重复询问：

1. **provider**：展示 ready 和可安装路线，并区分联网、鉴权与本地资源需求。
2. **音色来源**：预设音色或参考克隆；只展示该后端支持的选项。
3. **声音设置**：预设路线选择音色；本地克隆指定参考音频及准确参考文本；在线克隆选择已有 voice_id 或提供创建所需参考录音。在线模型也保留用户选择。语气等设置按能力展示。
4. **交付格式**：独立音频、视频、字幕可多选；不提供当前输入无法生成的成品。

模式、是否允许润色、试听后的采用或调整、在线费用授权、失败处理、覆盖已有文件等决策，同样通过控件完成。可把互不依赖的问题放在同一批控件中；后续选项依赖前一选择时分批展示。

已有偏好可以作为控件推荐值，不能以检测到的 API Key、已安装环境或偏好记录代替本次尚未明确的 provider 选择。密钥存在只说明可能可配置；不打印密钥，不因密钥存在切换服务。

选中在线服务后说明文本或参考音频的上传范围和费用条件；已明确授权的同一批次不重复确认。改变服务或扩大处理范围时重新收集对应决定。

宿主没有可用决策控件时，说明该交互要求无法满足，等待用户明确调整要求，不用普通文本问答绕过。

## 5. 执行流程

### 5.1 读取与语义分段

普通旁白按句意、段落和朗读节奏组织语段。对齐配音读取 SRT，将碎片字幕合并为自然语段，保留来源条目和起止时间。

以完整语义为优先；句末标点、语段时长和字幕条数用于辅助判断，不要求每组必须包含固定数量条目，也不要求无标点字幕先补齐标点才能工作。

默认保留正文信息。不遗漏、重复或重排字幕内容。合并后的配音语段可以不同于最终显示字幕的分段。

### 5.2 准备声音并合成

预设音色和参考克隆都可按用户要求试听；选定后使用同一组声音设置生成全片。仅在确有必要时加载对应模型。

新建克隆前检查参考音频可解码、具有有效人声。本地 Qwen 克隆要求参考文本与参考音频对应；ElevenLabs 根据 IVC 接口校验录音和字段。直接使用已有在线 voice_id 时不要求重新上传参考音频。所选账户或后端无法提供克隆时明确显示原因，不能把预设音色当作克隆结果。

每段先写临时音频，完成并验证可解码、非空、非明显静音后再记录成功。本地默认顺序合成以控制内存；在线并发使用后端允许的有限数量，不无限展开请求。

### 5.3 普通旁白

按原速拼接语段，保留合理的句间或段间停顿。音频按自然时长结束；不读取 SRT 时间窗强行对齐，不为了凑视频长度默认加速、减速或改文。

### 5.4 对齐配音

- 使用语段起点放置音频；可用窗口到下一语段起点之前，并保留适当安全间隔。
- 有视频时最后一组窗口截至视频结尾；无视频时最后一组窗口使用其 SRT 结束时间。
- 重叠、零或负时间窗先处理或报明问题，不能直接除零或让语音互相覆盖。
- 放得下时原速朗读，空余部分静音。
- 放不下时可适度加速，首版上限 1.20 倍；处理后重新测量，不能仅以倍率封顶推断已经对齐。
- 仍超长时保留已完成片段，指出具体语段。用户已选择允许润色时，可精简该段并最多额外合成两次；仍失败则通过控件选择处理方式。
- 润色需保留数字、专名、条件和关键步骤；保留修改前后文本，并同步交付字幕。未允许润色时不自动改文，不默认截断。
- 视频对齐主轨补齐到视频时长；只提供 SRT 时对齐主轨截至 SRT 最后结束时间，不声称与未知视频等长。

### 5.5 混流与交付

用户只选择音频时不生成视频；只选择成片时主轨可作为内部中间产物。制作和默认音频导出采用 48 kHz，必须真实重采样，不能只改文件头。

默认成片模式为替换原声。原声压低混合仅在用户通过控件选择时执行，并明确原有人声也会保留；它不等于人声分离或仅保留背景音乐。独立 BGM 可另行混入，本版不内置人声分离。

容器兼容时复制视频流；需重编码时说明原因和处理方式。对齐配音不能靠 `-shortest` 截掉视频以掩盖主轨过短。成片须验证视频与音轨时长，失败不标记完成。

字幕按实际音频时间输出；合并组级时间不能冒充句内或字级精确对齐。后端提供可靠边界时可生成更细分字幕，否则说明字幕粒度。

默认同名成品自动编号，不覆盖素材；用户要求覆盖时通过控件确认，已明确的同次指令不重复询问。

## 6. 最小状态与错误处理

每次任务使用独立目录。可以用一个简短 JSON 记录本次配置和已验证成功片段，无需复杂状态机或数据库。

任务输入固定为 `task.json`；运行结果可简短记录到 `result.json`。在线新建克隆成功后立即保存 voice_id 与状态，即使后续合成失败，也能复用已创建音色，避免重复创建。

首次实现可不做跨任务缓存。如果支持片段复用，必须以文本、provider/模型、声音参数及克隆参考内容等判断身份，并验证音频可解码；不能只凭文件存在且非空复用。时间窗或输出采样率变化可以重新加工原始音频。

暂时网络失败允许有限重试；鉴权、额度、硬件不支持等错误立即给出明确原因。在线提交结果未知时不盲目重交；已取得音频下载地址时优先重新下载，避免重复计费。

正常交付只显示所选成品、实际时长和需关注的加速或改写。失败显示具体阶段、受影响语段和已完成文件位置，保留本次任务数据供修复；不输出伪完整成品。

## 7. 单文件实现约束

- `SKILL.md` 包含简洁 frontmatter、交互流程、平台分支及足够执行的代码模板。
- LLM 负责语义分段、理解用户设置和已授权润色；脚本负责调用引擎、测量、变速、放置与验证音频。
- 任务数据必须使用下述标准 `task.json` 契约，不能换回命令行正文或动态拼接源码。
- 模板覆盖实际承诺的本地、在线、预设和克隆分支；不能用 `...` 省略合成、对齐或拼轨后仍声称可直接运行。
- 开发与验收可使用单独测试材料，最终用户分发包仍只有一个 `SKILL.md`。不因为追求单文件而让模型每次重新发明完整执行代码。

### 7.1 task.json：唯一的任务数据入口

LLM 在任务目录生成有效 UTF-8 JSON，runner 解析并校验后执行。标准示例（Mac 本地预设音色、普通旁白）：

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
    "reference_text": null
  },
  "parameters": {},
  "timing": {"max_speed": 1.2, "safety_gap_sec": 0.1},
  "allow_text_edits": false,
  "input": {"srt": null, "video": null},
  "output": {
    "directory": "output",
    "deliver": ["audio"],
    "audio_format": "wav",
    "sample_rate": 48000
  },
  "segments": [
    {
      "id": 1,
      "text": "她说：\"开始吧。\"\n下一段继续。",
      "start_sec": null,
      "end_sec": null
    }
  ]
}
```

字段规则：

- `mode` 为 `narration` 或 `aligned`；`provider` 为 `local` 或 `elevenlabs`。本地 backend 为 `mlx_audio` 或 `qwen_tts`，由本机路由解析后写入；在线 backend 固定为 `elevenlabs_http`。
- `voice.source` 为 `preset` 或 `clone`。本地 preset 使用 `speaker`；本地 clone 使用 `reference_audio` 与 `reference_text`。在线使用账户可访问的 `voice_id`；新建在线 clone 时可先为空，并提供参考录音，创建结果写入 result.json。
- `parameters` 只接受所选 Adapter 明确支持的参数，不能将未知字段无差别透传到 SDK、子进程或解释器。
- `segments` 顺序固定，id 唯一且 text 非空。对齐模式的起止时间必须是有限非负数且 end 大于 start；runner 根据下一段与媒体末尾计算可用窗口，不盲信 LLM 自报的音频时长。
- 普通旁白的时间字段为空，对齐参数不生效。对齐模式补充来源条目索引时仍放在段数据中，无需另建强制合并计划文件。
- 相对路径统一相对于 task.json 所在目录解析，跨平台不依赖启动时的工作目录。
- 用 JSON 序列化处理双引号、换行、反斜杠等转义；JSON 中不允许注释、尾逗号、NaN 或 Infinity。需要生成源码的固定模板不得包含插入的用户正文。
- 密钥只从环境或现有凭据读取，约定 ElevenLabs 使用 `ELEVENLABS_API_KEY`；不在 task.json、脚本、日志或 result.json 中写入明文密钥。

runner 只接受 task.json 的路径作为任务入口，例如以下参数列表的语义；宿主执行时使用参数 API 或正确处理路径，不把它拼成带业务正文的 shell 字符串：

```python
subprocess.run([python_exe, runner_path, "--task", task_path], shell=False, check=True)
```

runner 通过 JSON 解析取得 text，然后直接调用库方法或 HTTP 的 JSON 编码接口；不得使用 `eval`、`exec`，不得把读入数据重新插入命令或 Python 源码。

### 7.2 内嵌 runner 与 Adapter

SKILL.md 内保存一份稳定、完整、自包含的 runner.py 模板，执行时原样写入任务目录。任务变化只改变 task.json，不让 LLM 每次重写引擎分支。

runner 内使用三个简洁 Adapter：

| Adapter | 职责 |
| --- | --- |
| `MLXAdapter` | 加载 MLX 格式的 CustomVoice 或 Base；完整收集生成音频 |
| `QwenTorchAdapter` | 加载官方模型；预设生成或任务内复用克隆参考条件 |
| `ElevenLabsAdapter` | 校验模型/音色；按需创建一次克隆；HTTP 合成与保存结果 |

统一接口为 `prepare(task, progress)`、`synthesize(text, output_path)`、`close()`。prepare 在合成循环外执行一次，复用模型、HTTP 会话及克隆条件；仅导入选定路线依赖。每次合成返回实际音频路径与采样率，之后由共享代码负责验证、时间适配、拼轨和交付。

环境安装作为独立执行阶段，可放在同一个 runner 内的准备函数，不塞进各语段合成循环。用户选定 provider 后才自动准备该路线。

约 200～300 行可作为核心 runner 的精简目标，不能作为完整功能的硬上限。若包含跨平台安装、下载进度、三后端、在线克隆与成片验证后需要更多代码，应保留可读的完整实现，不通过省略核心功能或压成难维护的单行来凑行数。

### 7.3 单 Agent 执行

始终由同一个 Agent 负责用户交互、环境准备、语义规划、task.json 生成、runner 调用、结果复核与交付。长任务可在同一流程内分批处理，并检查跨批次遗漏与重复。

不创建或委派子 Agent，不设置协作角色、启用选项或自动升级机制，也不向用户建议切换协作模式。所有需要用户回答的事项仍通过 AskUserQuestion 收集。

runner 统一复用选定模型、HTTP 会话和克隆条件。复核覆盖正文完整性与时间边界；发音、音色和听感评价须有真实音频依据，不能把文本检查或时长指标当作完成听审。

## 8. 验收重点

1. macOS Apple Silicon 与 Windows NVIDIA 各自验证本地预设和参考克隆；在线路线在 Mac 与 Windows 验证。
2. 缺依赖、首次下载和安装失败场景得到准确状态；只安装用户选择的路线，不静默改服务。
3. 环境中存在多个 API Key 时，provider 仍按控件选择执行。
4. provider、音色来源及交付选择均通过控件；已明确的同任务选择不重复询问。
5. 普通旁白保持自然时长；对齐配音测试原速、轻度超长、严重超长、最后一句及重叠窗口。
6. 中文、空格、引号及 shell 特殊字符不破坏调用；不同任务片段不串用，非空损坏文件不被复用。
7. task.json 能往返保存含单双引号、换行、反斜杠和特殊符号的正文；runner 不从业务命令行或动态源码读取这些内容，字段错误在合成前报告。
8. 无缓存时清楚显示下载、加载和首段推理；有缓存时跳过下载；宿主捕获日志时仍有阶段和心跳。
9. 四个本地模型按平台与声音来源准确分派；在线两个模型与 voice_id 分开处理。新建在线克隆只创建一次，失败恢复不重复创建；已有 voice_id 不重复要求上传参考录音。
10. 真实音频试听检查发音、断句、跨段音色和音量；时长或电平合格不能替代听审。
11. 只交付用户选中的产物；视频完整，音轨有效，未授权时不改文、不截断、不覆盖输入。
12. 全流程始终单 Agent，不创建子 Agent，不出现协作模式选项；所有需要用户回答的事项均通过 AskUserQuestion 收集。

## 9. 核对依据

模型和接口于 2026-11-09 查阅下列项目及官方文档；这是文档核对，不表示本版已经完成真实合成或跨平台验收。

- [MLX 社区 Qwen3-TTS 模型集合](https://huggingface.co/collections/mlx-community/qwen3-tts)
- [MLX CustomVoice 模型卡](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16)
- [MLX Base 模型卡](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16)
- [mlx-audio 项目（原 Blaizzy 地址会重定向）](https://github.com/Neywa-Labs/mlx-audio)
- [mlx-audio Qwen3-TTS 实现及生成参数](https://github.com/Neywa-Labs/mlx-audio/blob/main/mlx_audio/tts/models/qwen3_tts/qwen3_tts.py)
- [Qwen 官方项目：预设和克隆 API](https://github.com/QwenLM/Qwen3-TTS)
- [odiak 实验性 MLX 路线及限制](https://github.com/odiak/Qwen3-TTS-MLX#mlx-on-apple-silicon-experimental)
- [Hugging Face Hub 下载与缓存](https://huggingface.co/docs/huggingface_hub/guides/download)
- [ElevenLabs 模型说明](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs 可用模型列表](https://elevenlabs.io/docs/api-reference/models/list)
- [ElevenLabs 账户音色列表](https://elevenlabs.io/docs/api-reference/voices/search)
- [ElevenLabs Instant Voice Cloning](https://elevenlabs.io/docs/api-reference/voices/ivc/create)
- [ElevenLabs 语音合成 API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
