---
name: video-tts
description: >
  中文视频配音工具：把 SRT 字幕按语义分组合成中文配音，按时间轴对齐后替换视频原声，
  输出与视频等长的配音轨或配音成片。当用户要视频配音、中文配音、SRT 配音、
  把字幕读成声音、外语视频转中文配音、给视频配旁白、dubbing、voiceover、TTS 时触发。
  **不是通用 TTS**：输入必须是 SRT 字幕；纯文本转语音、长文朗读不在本 skill 范围内。
  支持本地 Apple Silicon（免费离线，mlx-audio）与百炼在线（付费，bl）两种 provider。
---

# video-tts

把中文 SRT 按语义分组合成配音，natural 模式优先原速对齐（放不下先加速、再放不下默认停下保存恢复信息），输出「与视频等长的配音轨（默认 48 kHz）」或「替换原声的成片」。

> **不是通用 TTS。** 输入必须是一条中文 SRT。没有字幕先做 `audio-transcribe`；字幕不是中文或有错别字，先做 `text-refine`（时间轴保持不变）。上游链路：`video-downloader → audio-transcribe → text-refine → video-tts`。

## 平台能力（先检测，再展示选项）

| 环境 | 可用路线 |
| --- | --- |
| Apple Silicon Mac | 本地 MLX（推荐）或 在线 |
| Windows x64 + NVIDIA GPU | 本地 torch（官方 qwen-tts + CUDA，run.py 自动准备专用 venv）或 在线 |
| Intel Mac / Rosetta | 仅在线（本地 MLX 不可用） |
| Windows 无 NVIDIA GPU | 仅在线（本地 torch 需 CUDA；缺依赖时显示 needs_setup，不隐藏路线） |
| 其它 / 未知 | 按实际检测能力展示，不按系统名称猜测 |

`--provider local` 由 `run.py` 按平台解析后端：Apple Silicon 在专用 venv 验证 arm64 + Metal + mlx-audio；Windows x64 在 `%LOCALAPPDATA%\video-toolkit\envs\video-tts-torch` 验证 x64 + CUDA 构建 + 真实张量运算 + qwen-tts API，CUDA wheel 按驱动实际版本从官方 cuXXX 索引安装（缺什么给对应修复步骤，详见 [references/setup.md](references/setup.md)）。**检测通过前不要把「本地 / 原声克隆」作为选项推荐**；本地三用途（预设音色 / 文字设计 / 参考克隆）都用 1.7B 官方模型，不自动降 0.6B 或改在线。

## 入口与调用约定

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py --srt <字幕> --provider <local|online> [参数]
```

- `run.py` 负责隔离环境：复用已装好依赖的解释器，或装入专用 venv（锁定依赖，绝不碰系统 Python；安装器优先 uv——多 venv 同 wheel 硬链接共享磁盘）。它打印 `[video-tts] Using <python> (route: …)`，转述给用户即可。
- CLI 完全非交互：provider、音色、语气、费用确认等选择由宿主在调用前收集，以显式参数传入。
- `--dry-run` 只解析校验并打印计划——不联网、不合成、**不写任何文件**；保存预览用 `--write-plan`。
- **交付只出用户选择的成品**（`--deliver audio,video,subtitle,report`，多选；默认 audio+video+subtitle，无视频自动省略 video；`--track-only` = `--deliver audio`）。只要成片时整轨是内部中间产物；`report` 只有明确选择才复制到交付目录。内部完整报告与任务清单（`--resume` 入口，支持目录或 job ID）保存在应用任务目录（Windows `%LOCALAPPDATA%\video-toolkit\video-tts\jobs\<job_id>\`，mac `~/Library/Caches/...`），不污染素材目录。
- 同名成品默认**整组自动编号** `name_2`、`name_3`（不覆盖）；`--overwrite` 显式替换；输出永不覆盖输入素材。
- SRT 默认**严格解析**：格式坏块在合成前报错阻塞（带块号与原因）；用户确认要跳过坏块时才加 `--lenient-srt`（跳过会记 warning，内容缺失由用户负责）。
- **设计后克隆（长片设计音色推荐流程）**：① `--design "描述" --preview-text "试听句"` 只生成 `<out>.preview.wav`（不执行整片）；② 用户试听后用控件选定/调整描述重试/换来源；③ 选定后整片用 `--ref-audio <试听文件> --ref-text <试听句>`（Base 模型克隆）——同一声音贯穿全片，设计模型与克隆模型天然分进程，切换显存由进程退出完整归还。

## 交互原则

1. **所有选择必须用控件**：凡需用户选择或决策，一律使用 AskUserQuestion（其他宿主使用等价的结构化用户输入控件）。包括 provider、音色来源、音色、语气、交付格式、付费授权、覆盖／另存和失败后的处理方式。普通消息只用于解释、展示和进度，不能用文字选项、回复编号或自由文本问答代替决策控件。宿主没有可用控件时说明能力缺失，等待用户明确指令，不擅自替用户选择。
2. **不重复问**：用户对话里已明确的内容（「用本地」「用 Serena」「语气平静」）等同于已传参，跳过对应问题。路径等非决策信息可以接收用户直接提供；仍需用户作出选择时遵守上一条。
3. **合并确认**：SRT 解析后把「开始合成 / 只预览」合并进一次执行摘要；在线摘要同时包含上传与付费信息——一次明确授权覆盖本次已指定批次，不再分两轮确认。用户直接说「开始」且信息齐全时直接执行。
4. **只问必要的**：缺 provider → 问；缺音色（本地三选一：`--voice` / `--design` / `--ref-audio+--ref-text`）→ 问；缺语气且所选组支持 → 问。输出已存在 → 覆盖 / 另存。

标准顺序：检测平台与能力 → 读取已有选择 → 只展示可行路线 → 补齐缺失设置 → 解析 SRT 并生成/复用语义合并计划（展示组数、时长、超长组风险）→ 执行摘要 → 准备所选路线环境并运行 → 交付产物与报告（突出未解决的超长组 / 失败组 / 显式裁剪）。

## 语义合并计划（默认必做）

逐条合成会让每个条目独立起调、句尾收束，短条目多时卡顿；**默认必须**由宿主读完整 SRT，按语义分组成完整语义单元，写显式计划交给 CLI。**不要按时间间隙或字数机械合并**——机械规则不懂语义，断错位置比逐条更伤质量。

分组规则：

- 组必须在语义完整处结束（句末标点 `。！？；`）；**绝不把半句留在一组末尾**；人物介绍、步骤标题、新话题单独起组。
- 长停顿（> 0.8s）且语义另起一段时断开；每组建议 3–8 条、约 ≤ 18s；过长在最近句末标点拆开。
- 计划覆盖全部条目、恰好一次、顺序递增、组内连续（CLI 会校验，非法退出 2）。
- 无句末标点的拆词条目（「这个模」+「型很好」）直接拼接，**不补标点**。
- 计划必须绑定源 SRT：`"srt_sha256"` **必填**（读文件算 SHA-256 写入）；缺失或与当前 SRT 不一致时 CLI 拒绝加载，SRT 改动后旧计划作废。

```json
{"groups": [[1, 2, 3], [4, 5]],
 "srt_sha256": "<源 SRT 的 SHA-256>"}
```

**改写正文（text override）不是默认能力**：默认语音正文必须与源字幕对应。只有用户经 AskUserQuestion 明确授权改文（精简、发音纠正等）后，才在计划顶层加 `"text_edit_authorized": true` 并用组级 `text` 写改后整句，同时 CLI 必须带 `--allow-text-edits`——双层授权缺一不可，被改写的组会记录在报告与任务清单里。与原文拼接一致的 `text` 不算改写。

逐条合成仅当用户明确要求（严格同步场景）才省略 `--merge-plan`。

## 时间适配与完整性

- `--timing-mode natural`（默认）：优先原速。允许结束时间延伸到下一组实际边界之前（安全间隔 `--safety-gap`，默认 0.1s），不穿硬边界。合成 5s、槽位 3s、下一句前可用 10s → 必须 1.0 倍速。
- `--timing-mode strict_slot`：以本组自身有效结束为硬边界，不借空档；口型 / 快节奏场景用。
- 放不下时：先按实际窗口变速（`--warn-speed` 1.15 起记警告，上限 `--max-speed` 1.30，只加速不减速）；**超过上限默认不截断**——`--overflow-policy error`（默认）标记 needs_attention、保存完整原生音频与恢复清单、退出码 1。用户可调整合并边界 / 上限后 `--resume <out>.job.json` 恢复（已完成组从缓存复用）。显式 `--overflow-policy truncate` 才裁剪并淡出，记录裁剪秒数，任务为 completed_with_warnings、退出码 3。
- 不默认改写字幕内容，不随机重生成“碰运气”缩短音频。

## 采样率

三层：source（provider 原生，Qwen3-TTS 为 24000）→ master（拼轨制作，默认 48000）→ export（默认同 master）。重采样由 ffmpeg aresample 真实完成，禁止改文件头假装转换。`--master-sample-rate` 可选 24000 / 44100 / 48000；模型原生输出不受该参数影响。缓存保存原生音频：改制作采样率 / 时间窗 / 倍率只重加工，不重复合成（尤其在线）。

## 核心参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--srt` / `--video` / `--audio` | 必需 srt | 输入；video 混流、audio 只取时长，两者互斥 |
| `--provider` | 必需 | `local`（Apple Silicon）/ `online`（百炼，真实运行需 `--yes`） |
| `--voice` / `--design` / `--ref-audio`+`--ref-text` | 交互决定 | 音色来源；本地三选一，在线必须 `--voice`。全表见 [references/voices.md](references/voices.md) |
| `--instruct` | 空 | 语气指令（本地 CustomVoice / 在线旗舰） |
| `--merge-plan` | 无 | 语义合并计划 JSON（默认必做） |
| `--timing-mode` / `--overflow-policy` | natural / error | 见「时间适配」 |
| `--max-speed` / `--warn-speed` / `--safety-gap` | 1.30 / 1.15 / 0.10 | 变速上限 / 警告阈值 / natural 安全间隔 |
| `--master-sample-rate` | 48000 | 制作与导出采样率（24000/44100/48000） |
| `--max-attempts` | 3 | 每组合成提交总预算（统一重试；429/5xx 退避，401/额度类立即停） |
| `--resume` / `--overwrite` | 不启用 | 从 job.json 恢复 / 显式覆盖已有成品（默认同名整组自动编号 `name_2`） |
| `--dry-run` / `--write-plan` | false | 预览（不写文件）/ 保存 plan.json+plan.srt |
| `--lenient-srt` / `--allow-text-edits` | false | 跳过 SRT 坏块（默认严格报错）/ 接受已授权改文 |
| `--track-only` / `--keep-segments` / `--no-cache` | false | 只出音轨（= `--deliver audio`）/ 保留逐组 wav / 禁用缓存 |
| `--deliver` | audio,video,subtitle | 交付成品多选（`audio,video,subtitle,report`）；video 需 `--video` |
| `--preview-text` | 无 | 设计后克隆第一步：配合 `--design` 只出 `<out>.preview.wav` 试听 |
| `--continue-on-error` | false | 单组失败继续（产物标记 partial，退出码 1） |
| `--rate/--pitch/--volume/--seed/--enable-ssml/--hotfix-file` | 无 | 仅在线；`--temperature/--top-p/--top-k/--seed` 本地采样稳定 |
| `--lang` / `--model` / `--tts-endpoint` / `--bl-bin` / `--skip-bracketed` / `--json-report` | — | 语言 / 模型覆盖 / HTTP 兜底 / bl 路径 / 跳过音效条目 / 报告路径 |

完整参数表与用法示例：[references/examples.md](references/examples.md)；模型互斥规则与配音优化：[references/models.md](references/models.md)。

## 输出、状态与退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 完整成功（含无内容裁剪的加速警告） |
| 1 | 失败 / partial / needs_attention / submission_unknown / download_failed / cancelled |
| 2 | 参数、输入或计划错误（含输出会覆盖输入、非法 / 越权计划） |
| 3 | 显式允许裁剪且实际裁剪了内容（有损成品，**不能当普通成功**） |

报告（`<out>.report.json`，schema v2）包含任务与环境信息、模型与音色、三层采样率、每组计划/实际起止与倍率、重试与缓存命中、异常明细、耗时与已验证产物路径。任务清单（`<out>.job.json`）记录输入指纹、配置快照与**逐组原子状态**（每组完成即落盘，崩溃不丢进度），供 `--resume`。

恢复对账规则：SRT 内容、克隆参考（含**移除**参考参数）、音色 / 模型 / 语气 / 语言 / 采样参数任一变化 → 拒绝 resume（开新任务，未变内容仍经缓存复用）；merge plan 修订、时间窗 / 制作采样率 / 倍率变化 → 允许 resume 并记录修订历史。上次 `download_failed` 的组凭收据（audio_url）**只重新下载、不重新提交**；提交状态不明（在线超时 / bl 超时）不自动重提，等用户核对。

## 错误处理要点

- 在线费用：一次 `--yes` 授权覆盖本次批次；变更 provider 或扩大范围再收集新确认。
- 登录：未登录时自动展示 `bl auth login` 链接并轮询（见 setup.md 流程）；一看到 URL 立刻转给用户。skill 不接收、不保存、不打印明文 key。
- 合成失败：统一预算内重试；401/403/额度不足立即停止；提交后超时标记 submission_unknown。
- **下载失败 ≠ 重新合成**：服务端已生成音频（可能已计费）后下载持续失败 → 任务标记 `download_failed` 并保存收据，`--resume` 只重新下载，绝不重新提交计费。
- overflow：不截断、不出伪完整成片；按报告提示调整计划 / 上限 / 文本后 `--resume`。
- 缺 ffmpeg：macOS 提示 `brew install ffmpeg`，Windows 提示 `winget install ffmpeg`。

详细排障：[references/setup.md](references/setup.md)；本次行为变化与迁移：[references/migration.md](references/migration.md)。
