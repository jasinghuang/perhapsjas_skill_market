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
| Intel Mac / Rosetta | 仅在线（本地 MLX 不可用） |
| Windows | 仅在线（不装 mlx-audio） |
| 其它 / 未知 | 按实际检测能力展示，不按系统名称猜测 |

本地路线由 `run.py` 在专用 venv 里验证 arm64 + Metal + mlx-audio API，缺什么给对应修复步骤（详见 [references/setup.md](references/setup.md)）。**检测通过前不要把「本地 / 原声克隆」作为选项推荐**。

## 入口与调用约定

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py --srt <字幕> --provider <local|online> [参数]
```

- `run.py` 负责隔离环境：复用已装好依赖的解释器，或装入专用 venv（锁定依赖，绝不碰系统 Python）。它打印 `[video-tts] Using <python> (route: …)`，转述给用户即可。
- CLI 完全非交互：provider、音色、语气、费用确认等选择由宿主在调用前收集，以显式参数传入。
- `--dry-run` 只解析校验并打印计划——不联网、不合成、**不写任何文件**；保存预览用 `--write-plan`。
- 默认产物：`<out>.dub.wav`、`<out>.dub.mp4`（有视频且未 `--track-only`）、`<out>.dub.srt`（实际配音时间的块级字幕）、`<out>.report.json`、`<out>.job.json`。已有成品默认**拒绝覆盖**（`--overwrite` 显式放行）。

## 交互原则

1. **宿主无关**：宿主有结构化选择工具（如 Claude 的 AskUserQuestion）就用它；没有就用简短文本提问。不要硬编码某个工具名、schema 或选项数量到通用流程里。
2. **不重复问**：用户对话里已明确的内容（「用本地」「用 Serena」「语气平静」）等同于已传参，跳过对应问题；路径类信息可用文本补充。
3. **合并确认**：SRT 解析后把「开始合成 / 只预览」合并进一次执行摘要；在线摘要同时包含上传与付费信息——一次明确授权覆盖本次已指定批次，不再分两轮确认。用户直接说「开始」且信息齐全时直接执行。
4. **只问必要的**：缺 provider → 问；缺音色（本地三选一：`--voice` / `--design` / `--ref-audio+--ref-text`）→ 问；缺语气且所选组支持 → 问。输出已存在 → 覆盖 / 另存。

标准顺序：检测平台与能力 → 读取已有选择 → 只展示可行路线 → 补齐缺失设置 → 解析 SRT 并生成/复用语义合并计划（展示组数、时长、超长组风险）→ 执行摘要 → 准备所选路线环境并运行 → 交付产物与报告（突出未解决的超长组 / 失败组 / 显式裁剪）。

## 语义合并计划（默认必做）

逐条合成会让每个条目独立起调、句尾收束，短条目多时卡顿；**默认必须**由宿主读完整 SRT，按语义分组成完整语义单元，写显式计划交给 CLI。**不要按时间间隙或字数机械合并**——机械规则不懂语义，断错位置比逐条更伤质量。

分组规则：

- 组必须在语义完整处结束（句末标点 `。！？；`）；**绝不把半句留在一组末尾**；人物介绍、步骤标题、新话题单独起组。
- 长停顿（> 0.8s）且语义另起一段时断开；每组建议 3–8 条、约 ≤ 18s；过长在最近句末标点拆开。
- 计划覆盖全部条目、恰好一次、顺序递增、组内连续（CLI 会校验，非法退出 2）。
- 无句末标点的拆词条目（「这个模」+「型很好」）直接拼接，**不补标点**；需要分隔符时用该组的 `text` 显式写整句。
- SRT 改动后旧计划作废：生成时带上 `"srt_sha256"`（读文件算 SHA-256 写入），CLI 校验不一致即拒绝。

```json
{"groups": [[1, 2, 3], [4, 5], {"indices": [6, 7], "text": "精简后的整句。"}],
 "srt_sha256": "<源 SRT 的 SHA-256>"}
```

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
| `--resume` / `--overwrite` | 不启用 | 从 job.json 恢复 / 显式覆盖已有成品 |
| `--dry-run` / `--write-plan` | false | 预览（不写文件）/ 保存 plan.json+plan.srt |
| `--track-only` / `--keep-segments` / `--no-cache` | false | 只出音轨 / 保留逐组 wav / 禁用缓存 |
| `--continue-on-error` | false | 单组失败继续（产物标记 partial，退出码 1） |
| `--rate/--pitch/--volume/--seed/--enable-ssml/--hotfix-file` | 无 | 仅在线；`--temperature/--top-p/--top-k/--seed` 本地采样稳定 |
| `--lang` / `--model` / `--tts-endpoint` / `--bl-bin` / `--skip-bracketed` / `--json-report` | — | 语言 / 模型覆盖 / HTTP 兜底 / bl 路径 / 跳过音效条目 / 报告路径 |

完整参数表与用法示例：[references/examples.md](references/examples.md)；模型互斥规则与配音优化：[references/models.md](references/models.md)。

## 输出、状态与退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 完整成功（含无内容裁剪的加速警告） |
| 1 | 失败 / partial / needs_attention / submission_unknown / cancelled |
| 2 | 参数、输入或计划错误（含输出已存在且未 `--overwrite`） |
| 3 | 显式允许裁剪且实际裁剪了内容（有损成品，**不能当普通成功**） |

报告（`<out>.report.json`，schema v2）包含任务与环境信息、模型与音色、三层采样率、每组计划/实际起止与倍率、重试与缓存命中、异常明细、耗时与已验证产物路径。任务清单（`<out>.job.json`）记录输入指纹与逐组状态，供 `--resume`。提交状态不明（在线超时）不自动重提，等用户核对。

## 错误处理要点

- 在线费用：一次 `--yes` 授权覆盖本次批次；变更 provider 或扩大范围再收集新确认。
- 登录：未登录时自动展示 `bl auth login` 链接并轮询（见 setup.md 流程）；一看到 URL 立刻转给用户。skill 不接收、不保存、不打印明文 key。
- 合成失败：统一预算内重试；401/403/额度不足立即停止；提交后超时标记 submission_unknown。
- overflow：不截断、不出伪完整成片；按报告提示调整计划 / 上限 / 文本后 `--resume`。
- 缺 ffmpeg：macOS 提示 `brew install ffmpeg`，Windows 提示 `winget install ffmpeg`。

详细排障：[references/setup.md](references/setup.md)；本次行为变化与迁移：[references/migration.md](references/migration.md)。
