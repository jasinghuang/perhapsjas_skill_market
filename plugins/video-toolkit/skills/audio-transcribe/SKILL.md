---
name: audio-transcribe
description: >
  将音频或视频忠实转录为原语言字幕或文字稿。用户选择 Qwen3-ASR-1.7B 本地
  （Apple Silicon 用 MLX、Windows 用官方 PyTorch）或 ElevenLabs Scribe V2 在线，
  支持标准单行 SRT、带时间码 Markdown、无时间码且分段的 Markdown。适用于转录、
  提取字幕、录音转文字、视频转字幕及 speech to text；不负责翻译或配音。
---

# Audio Transcribe

忠于原声，不翻译、不摘要、不补写、不根据常识修正专有名词，不默认转换繁简。
时间戳来自模型对齐估计；格式校验通过不代表已逐句听辨或逐帧核实。

## 交互与执行

**每次需要用户作选择，都必须使用 AskUserQuestion 控件**（Codex 中用等价的用户输入控件），
包括路线、交付格式、切换后端、音轨歧义和失败后的替代方案。不能在普通消息里列选项代替控件。
已明确的偏好和本次授权继续生效，不重复询问。没有控件时说明能力缺失，等待用户明确指令。

1. 只读检测系统和媒体，不安装未选后端的依赖：
   `python <skill目录>/run.py --detect-env`。
   告知检测到的系统；Apple Silicon 推荐 MLX，Windows 推荐实际可用的 CUDA。
   Intel Mac / Rosetta 不支持 MLX；Windows ARM、WSL 属于待验证环境。
2. 路线未明确时，用 AskUserQuestion 选择：
   - **Qwen3-ASR-1.7B 本地（推荐）**：Mac 用 MLX／Metal，Windows 用官方 qwen-asr／PyTorch；首次准备独立环境并下载模型。无 CUDA 时注明 CPU 会慢。
   - **Scribe V2 在线**：上传音频至 ElevenLabs，需 API key，按账号费率计费。
   选择本地不授权在线上传，失败不得自动换后端；普通选择不展开量化精度。
3. 格式未明确时，用 AskUserQuestion 多选：
   - **标准 SRT（推荐）**：每条正文一行。
   - **带时间码 Markdown**：按段落标记真实起止时间。
   - **无时间码 Markdown**：保留原文，按标点、停顿和合理段长分段。
   用户明确“只要 SRT”后直接执行，不能默认多交付 TXT／JSON。
4. 执行所选路线和格式，同批任务复用选择：

```bash
python <skill目录>/run.py "输入视频.mp4" --provider qwen --formats srt
python <skill目录>/run.py "录音.m4a" --provider scribe --formats md-timed,md --language zh
python <skill目录>/run.py "a.mp4" "b.mp4" --provider qwen --formats srt --output "输出目录"
```

5. 汇报实际产物链接、模型／后端、媒体时长、总耗时和影响结果的警告。区分完整成功、
   部分交付、无语音与失败；未生成所选格式不能描述为全部完成。
   不把程序结构检查说成识别准确率或翻译质量审核。

## 参数与交付

| 参数 | 约定 |
| --- | --- |
| `--provider` | 必填：`qwen` 或 `scribe`；不自动选择在线 |
| `--formats` | `srt,md-timed,md` 可组合；CLI 默认仅 `srt`。`txt,json` 仅兼容高级显式请求 |
| `--language / -l` | 默认 `auto`，可 `en/zh/ja/...`；混合语音用 auto，不翻译 |
| `--output / -o` | 输出目录，默认素材同目录；只写所选成品 |
| `--audio-track` | ffprobe 的实际 stream index；默认第一条音轨。用户语种/声道意图有歧义时用控件选 |
| `--device` | Windows/Torch：auto、cpu、cuda:0；无 CUDA 为 FP32 慢速兼容路线 |
| `--diarize` | Scribe 可选说话人分离，不默认开启；可能影响费用 |
| `--detect-env` | 只读检测，不安装；指定 qwen 时优先检查已有专属解释器 |
| `--no-progress` | 关闭动态进度行，仍报告阶段 |

- `<stem>.srt`：UTF-8 无 BOM，序号连续，`HH:MM:SS,mmm`，正文单行，时间合法且不重叠。
- `<stem>.timed.md`：每个自然段带开始／结束时间。
- `<stem>.md`：无时间码文字稿，不增加总结或小标题。
- 同名任一相关产物已存在时，整组递增为 `<stem>_2`、`<stem>_3`；不会覆盖已有文件。
- 单行字幕按标点、词组、停顿与实际时间单位拆分，目标显示宽度 42（约 21 汉字）、时长 6 秒。
  缺少更细时间依据时允许超宽并告警，不能截字或按字数伪造词级时间。
- 候选在发布前校验时序、毫秒舍入和原始转写的文字覆盖。严重对齐冲突拒绝发布时间格式；
  无时间 MD 仍可交付。仅交付用户所选格式，不自动追加其他文件。
- 退出码：0 完成（无语音会明确报告）、1 执行失败、2 参数错误、3 部分交付、130 用户取消。

## 环境、缓存与排障

`run.py` 仅在应用缓存中的专属 venv 安装固定版本；不修改系统 Python，不自动安装驱动。
Mac 固定 `mlx-community/Qwen3-ASR-1.7B-8bit` 识别，使用独立的
`Qwen/Qwen3-ForcedAligner-0.6B` 对齐时间；不提供识别权重精度切换。
Scribe 使用标准库，不安装 MLX／Torch。首次下载耗时应与常规推理耗时区分。
素材目录不创建工作文件夹；成功清理临时音频，原始结果缓存供重新导出复用。
缓存包含源内容摘要、音轨、模型版本、语言及推理参数。失败保留内部进度：
Torch 可恢复已完成分块；MLX 仅完整结果可复用，中断的推理需重跑，不能承诺分块续传。

按实际路线读取，勿一次加载全部：

- [Mac MLX](references/mac-mlx.md)：环境、模型和真实 API 契约。
- [Windows Torch](references/windows-torch.md)：CUDA／CPU、版本与恢复边界。
- [Scribe V2](references/scribe.md)：凭证、音频上传和避免重复计费。

本 skill 不提供时间范围转录，不向 text-refine 增加词级时间接口。
需要翻译、润色时另行调用 text-refine；本阶段保留原声表达。
