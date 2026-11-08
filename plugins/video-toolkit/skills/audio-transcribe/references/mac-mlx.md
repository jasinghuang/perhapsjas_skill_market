# Apple Silicon：MLX／Metal

本路线使用 [moona3k/mlx-qwen3-asr](https://github.com/moona3k/mlx-qwen3-asr/)，
包固定 `mlx-qwen3-asr==0.4.4`，模块 `mlx_qwen3_asr`。不要混装另一项目 `qwen3-asr-mlx`。
识别和强制对齐均采用 MLX，不需要安装 PyTorch。

固定使用两个各司其职的模型，不提供权重精度切换：

| 工作 | 模型 | 用途 |
| --- | --- | --- |
| 语音识别 | `mlx-community/Qwen3-ASR-1.7B-8bit` | 识别原语言文字，已在本机完整视频实测 |
| 时间对齐 | `Qwen/Qwen3-ForcedAligner-0.6B` | 由原生 MLX 对齐器为识别文字提供时间戳 |

两个模型分别显式指定；0.6B 对齐器不会替代 1.7B 识别模型。
8bit 是识别权重精度，Session 的浮点计算 dtype 为 float16，二者分开记录。

## 环境与 API 契约

- 只支持 Apple Silicon + 原生 ARM64 Python，Intel／Rosetta 不自动改用 Torch。
- `run.py` 创建 `~/Library/Caches/video-toolkit/envs/audio-transcribe-mlx-v2`，
  仅在该 venv 安装依赖；可用 uv 或标准库 venv，不修改 Homebrew／系统包。
- 需 ffmpeg／ffprobe。预先提取明确音轨为 16kHz 单声道 WAV，保留原媒体零点。
- 复用 `Session(model="mlx-community/Qwen3-ASR-1.7B-8bit")` 和
  `ForcedAligner(model_path="Qwen/Qwen3-ForcedAligner-0.6B")`，调用
  `Session.transcribe(audio=..., return_timestamps=True, return_chunks=True, forced_aligner=...)`。
- **0.4.4 的 `segments` 是强制对齐词单位，`chunks` 是识别窗口。** 适配器只接受前者为词级时间；
  不能因字段名相似把 chunks 当词级时间戳。内层 words 可展平，但不猜其他未知版本结构。
- `on_progress` 收到事件字典，使用 `event/progress/processed_audio_sec/chunk_index/total_chunks`。
- `truncated=True` 表示触及生成长度上限，不能当完整转写发布 SRT。
- 上游自行在低能量处切识别窗口；本层不再二次切整部音频、不重复增加全局偏移。

## 缓存与验收

模型走 Hugging Face 缓存（尊重 HF_HOME／HF_HUB_CACHE）；音频和工作材料走应用缓存。
完整推理结果可用于重新导出；中断中的 MLX 推理不承诺分块恢复。成功后清理临时音频。

本轮在 Apple Silicon、Python 3.14.3、mlx-qwen3-asr 0.4.4、MLX 0.32.4 下，
对用户指定 997.2 秒英文视频完成真实识别、对齐及单行 SRT 导出。
首次任务共约 151.4 秒，包含首次权重下载／加载；不能把该数字当纯推理基准或其他设备承诺。
没有做逐句人工听辨，结构和覆盖校验不等于零识别错误。
