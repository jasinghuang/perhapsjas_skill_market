# audio-transcribe 改造交付说明：Qwen3-ASR-1.7B 本地 + Scribe V2 在线

> 此文为早期交付记录。后续已改为按用户选择交付单行 SRT 或 Markdown；Mac 固定
> `mlx-community/Qwen3-ASR-1.7B-8bit`＋`Qwen/Qwen3-ForcedAligner-0.6B`，已移除 `--precision`。
> 下文的多精度选项与待验收表为历史记录。当前约定及 Mac 实测记录见
> [SKILL.md](../plugins/video-toolkit/skills/audio-transcribe/SKILL.md) 和
> [mac-mlx.md](../plugins/video-toolkit/skills/audio-transcribe/references/mac-mlx.md)。

日期：2026-11-08
依据：`ASR_Skill_技术需求文档.md` v1.0
范围：`plugins/video-toolkit/skills/audio-transcribe/`

## 1. 变更总览

skill 从 Whisper 单一路线改造为**双 provider 统一转写**：先检测环境 → 用户选择
`qwen`（本地 Qwen3-ASR-1.7B，推荐）或 `scribe`（ElevenLabs Scribe V2 在线）→
统一产出 TXT + JSON + SRT。Whisper 后端按用户决策**彻底移除**。

### 新旧入口映射

| 旧（Whisper 版） | 新（本次交付） |
| --- | --- |
| `run.py <input>` （无 provider 概念） | `run.py <input> --provider qwen\|scribe`（必填，缺失退出码 2，绝不默认在线） |
| `--model tiny..large-v3` | 移除。模型固定：Mac `mlx-community/Qwen3-ASR-1.7B-8bit`；Windows `Qwen/Qwen3-ASR-1.7B`。Mac 高级 `--precision 8bit/bf16/6bit` |
| `--format srt/md/json`（单文件） | `--formats txt,json,srt`（三件套，可子集） |
| `-o result.srt`（文件） | `-o <目录>`（三件套同目录同名） |
| `--keep-timestamps` / `--keep-context` | 移除（无 Whisper 窗口上下文问题） |
| 无 | `--detect-env`（只读环境检测）、`--device`、`--diarize`、`--audio-track` |
| 无 provider 询问 | SKILL.md 规定 agent 用 AskUserQuestion 两选项询问；指定时不重复问 |

### 文件结构

```
audio-transcribe/
├─ SKILL.md                  触发、环境检测→询问→调用→交付流程
├─ run.py                    按 provider 探测/安装解释器（scribe 零安装）
├─ skill_main.py             CLI、阶段编排、原子写、校验
├─ env_check.py              detect_environment / probe_backend
├─ media.py                  ffprobe、16k mono WAV、静音吸附分块(≤290s)
├─ results.py                统一 JSON schema v1（doc §9）
├─ subtitles.py              分句/换行(中20/英42、≤2行、≤6s)/SRT/回验/标点回映射
├─ progress.py               保留（chunk 级进度复用）
├─ backends/
│  ├─ qwen_mlx_backend.py    Mac：mlx-qwen3-asr Python API
│  ├─ qwen_torch_backend.py  Windows/Linux：官方 qwen-asr + ForcedAligner
│  └─ scribe_backend.py      ElevenLabs HTTP（stdlib，零依赖）
├─ references/{mac-mlx,windows-torch,scribe}.md
└─ tests/                    141 个离线单测（全通过）
```

## 2. 路线选择与锁定版本

**采用官方 `qwen-asr` 包（Transformers 后端），未采用 `-hf` 原生 Transformers 路线**；
两套接口未混用。实测 API 与 README 的差异已适配：`Qwen3ASRModel.from_pretrained(
forced_aligner=...)` 在初始化时集成对齐器，`transcribe(return_time_stamps=True)`
直接返回词级时间戳（qwen-asr 0.0.6）。

| 项 | 锁定版本/标识 | 实测 revision |
| --- | --- | --- |
| qwen-asr | 0.0.6（pip） | — |
| torch | 2.14.1+cu130（Windows CUDA）/ CPU 构建亦可 | — |
| transformers | 4.57.6（随 qwen-asr） | — |
| 识别模型 | `Qwen/Qwen3-ASR-1.7B` | `7278e1e70fe206f11671096ffdd38061171dd6e5` |
| 对齐模型 | `Qwen/Qwen3-ForcedAligner-0.6B`（初始化集成） | 已缓存 |
| Mac 识别权重 | `mlx-community/Qwen3-ASR-1.7B-8bit`（默认；bf16/6bit 高级选项） | 未实测（无 Mac 设备） |
| Scribe | `scribe_v2`，`timestamps_granularity=word` | API 版本无关 |
| zhconv | 简体转换（可缺失，缺失时原文透传） | — |

## 3. 安装与可重复运行命令

```powershell
# 环境/路线探测（只读，不安装）
python run.py --detect-env [--provider qwen|scribe]

# 本地转写（首次自动装依赖+下载模型；产物三件套）
python run.py video.mp4 --provider qwen --output <目录>
python run.py video.mp4 --provider qwen --language zh --formats srt

# 在线转写（需 ELEVENLABS_API_KEY；零本地依赖）
python run.py meeting.m4a --provider scribe

# 强制 CPU（慢速兼容）
python run.py video.mp4 --provider qwen --device cpu
```

依赖安装细节：torch CUDA 需 `--index-url https://download.pytorch.org/whl/cu130`
（可用 `AUDIO_TRANSCRIBE_TORCH_INDEX` 覆盖）；已有 CPU torch 时必须
`--force-reinstall` 才会换成 CUDA wheel（run.py 已内置）。

## 4. 验收结果（实机平台：Windows 11 x64，RTX 4070 Ti 12GB，驱动 610.88，Python 3.14.2）

| 编号 | 场景 | 结果 |
| --- | --- | --- |
| **P04** | 原生 NVIDIA CUDA 全链路 | ✅ **通过**：BF16@cuda:0；中文 34.9s 样本 39.3s（含 27.8s 首次加载）；英文 27.7s 样本 2.7s；中英混合 ✅；**32.5 分钟长样本分 8 块 197.7s（RTF≈0.10）**；7 个分块边界时间戳抽查全部无缝无漂移；SRT 420 条 `validate_srt` 零问题 |
| **P05** | 无 CUDA | ✅ 短样本通过：`--device cpu` FP32，中文 10s→41.5s、英文 10s→38.7s 全链路；长音频 CPU 未实测（预计数小时）；状态 `ready`（附慢速提示） |
| P01-P03 | Mac MLX 8bit/bf16/6bit | ⏳ 待实机验收（本机无 Mac）。逻辑由 12 个离线单测覆盖（默认 8bit、绝不落到 0.6B、字段映射、partial 降级） |
| P06 | Intel Mac 拒绝 MLX | ⏳ 单测覆盖（unsupported + Rosetta 检测），待实机抽查 |
| P07 | Scribe 真实调用 | ⏳ 无凭证环境仅验证：缺 key 前置失败、不联网、不泄 key。请求/重试/过滤逻辑 13 个单测覆盖。**真实计费调用待有凭证时验收** |
| P08 | 断网缓存 | ✅ 模型缓存后不再联网（HuggingFace 本地快照读取 revision）；分块缓存命中时不重算 |
| **P09** | 真实 YouTube 音频实跑 + 安装引导 | ✅ 2026-11-08 复盘：687s 媒体 224s（约 3 倍速）完整交付；前两次失败（缺 uv 发现途径、Git Bash PATH 坑）驱动 §7 优化，已复验 `python -m uv` 自动发现 |

### 功能与异常验收

| 项 | 结果 |
| --- | --- |
| 缺 provider 不执行（退出码 2、不默认在线） | ✅ 实测 |
| 损坏文件推理前失败、原因明确、退出码 1 | ✅ 实测 |
| 纯静音 → no_speech + 空转写、不产虚构 SRT | ✅ 实测 |
| 中文/空格/括号路径全链路 | ✅ 实测（`测试 音频 (中文).mp3`） |
| 同名不同扩展名输入不互相覆盖（自动加 `-2` 后缀） | ✅ 单测 |
| 长音频中断续传（缓存复用，不重复计费/计算） | ✅ 实测：杀进程后重跑，2/8 块命中缓存 |
| 对齐失败 → partial，TXT/JSON 保留、SRT 不产出 | ✅ 单测（降级重试拿回文本） |
| 429/5xx 重试≤3 退避；401/参数错立即停；超时 submission_unknown 不盲目重传 | ✅ 单测 |
| 批量失败汇总、单文件失败不中断其余 | ✅ 实测+单测 |
| JSON 结构校验 / SRT 解析回验 / 序号连续 / end>start / 不重叠 | ✅ 内置于导出流程 |
| 同批任务复用 provider 选择 | ✅ SKILL.md 规定（agent 行为） |

### 已知瑕疵（如实记录）

- 对齐器对**中英混合句中的部分英文词**时间戳异常（零时长或拉伸数秒）：
  零时长已修复为最小显示 0.08s；拉伸导致 <1% 字幕（4/420）在重叠消解中被丢弃并记录
  warning——内容缺失可从 TXT 找回。
- 中文一行末尾偶发"单字+句号"换行（宽度边界），显示瑕疵不影响时间轴。
- TTS 自产混合样本中 "Qwen3/Scribe" 被识别为 "Quan 3 ASR/Scrub"，属模型发音
  歧义，非管线缺陷；需要时可经 text-refine 校准。

## 5. 可人工检查的样例

`docs/audio-transcribe-samples/`（输入 audio/ + 输出 output/）：

- `zh-short.mp3`（35s 中文）→ `zh-short.srt / .txt / .json`（9 条字幕，按句号分句带标点）
- `en-short.mp3`（28s 英文）→ `en-short.srt`（按句分句、两行换行）
- `mixed-short.mp3`（42s 中英混合）→ `mixed-short.srt`
- `zh-long-32min.srt`（420 条，含 8 个分块边界，供边界漂移抽查）
- 输入全部由 edge-tts（zh-CN-XiaoxiaoNeural / en-US-GuyNeural）于 2026-11-08 生成，
  无授权问题。

## 6. 承诺边界

- 未提交任何 API key、模型权重或用户录音；`ELEVENLABS_API_KEY` 仅从环境读取，
  全链路（probe/错误/日志/产物）不回显。
- Mac 全路线（P01-P03/P06）与 Scribe 真实计费调用（P07）**未实机验证**，
  状态在 `references/` 中如实标注，不写成已支持。
- Mac 6bit 权重未实测，不因体积小而承诺开放（doc §14）。

## 7. 2026-11-08 Windows 实跑复盘：安装引导优化

来源：`audio-transcribe-skill-优化建议.md`（Windows 11 + Git Bash + RTX 4070 Ti，
系统仅 Python 3.14.2，无 uv／无 3.12）。三次尝试中前两次失败的根因与修复：

| 复盘问题 | 修复 |
| --- | --- |
| `--detect-env` 不预检 uv／Python 前置，正式转录才 bail out（用户已投入下载成本） | detect（指定 qwen）新增 `uv_available`／`setup_blockers` 输出；冷机状态置 `blocked_missing_uv` 并附修复方法 |
| uv 只认 PATH；`pip install uv` 落在用户 Scripts 目录必然漏判 | 新增 `bootstrap.py`：`--uv-path`／`AUDIO_TRANSCRIBE_UV` → PATH → userscripts 目录 → `python -m uv`（当前解释器 + PATH python 双探测，检测跑在专属 venv 内也能发现） |
| 报错 `Install Python 3.12 or uv` 说重了（实测只装 uv 即可） | 阻塞报错改为可操作文案：`pip install uv` 无需改 PATH、uv 自管 Python 3.12，附官方脚本与装 3.12 两条替代路径 |
| 首跑 torch cu130 约 1.7 GiB 无提示 | 安装前打印一次性下载体量提示；无 N 卡自动装 CPU 小体积版并说明推理更慢 |
| Git Bash 中 `$APPDATA` 直拼 PATH 因反斜杠＋`C:` 冒号失效 | references/windows-torch.md 记录 POSIX 形式写法（`/c/Users/...`） |

实现：新增 `bootstrap.py`（uv／Python 发现与阻塞判定单一事实源，run.py 与 env_check 共用）；
run.py 拆出 `parse_uv_path`（launcher 专用参数，转发前剥离）；Windows 候选 Python 补充
`py -0p` 枚举（兼容含空格路径，如 `C:\Program Files\Python312`）。
测试 183 个全过（新增 bootstrap 12 个、launcher/env_check 阻塞态若干；顺手修复
`test_multipart_sanitizes_filename` 在 NTFS 上因文件名含引号无法创建的存量失败）。
本机复验：`find_uv` 正确返回 `['C:\\Python314\\python.exe', '-m', 'uv']`，
`--detect-env --provider qwen` 在专属 venv 内报告 `uv_available: true`。
仍待 Mac／Scribe 实机；本轮全部未 commit。
