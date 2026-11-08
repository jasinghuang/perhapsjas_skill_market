# Apple Silicon：MLX／Metal

本路线使用 [moona3k/mlx-qwen3-asr](https://github.com/moona3k/mlx-qwen3-asr/)，
包固定 `mlx-qwen3-asr==0.4.4`，模块 `mlx_qwen3_asr`。不要混装另一项目 `qwen3-asr-mlx`。
识别和强制对齐均采用 MLX，不需要安装 PyTorch。

| 权重配置 | 识别模型 | 用途 |
| --- | --- | --- |
| 8bit | mlx-community/Qwen3-ASR-1.7B-8bit | 默认，已在本机完整视频实测 |
| bf16 | mlx-community/Qwen3-ASR-1.7B-bf16 | 高级质量对照，未在本轮验收 |
| 6bit | mlx-community/Qwen3-ASR-1.7B-6bit | 高级低资源选项，未在本轮验收 |

对齐模型为 `Qwen/Qwen3-ForcedAligner-0.6B`，由原生 MLX 对齐器加载。
识别始终显式指定 1.7B；上游默认 0.6B 不可依赖。权重量化位数与计算 dtype 分开记录，
Session 默认 float16。仓库名 bf16 不等于实际全程 BF16。

## 环境与 API 契约

- 只支持 Apple Silicon + 原生 ARM64 Python，Intel／Rosetta 不自动改用 Torch。
- `run.py` 创建 `~/Library/Caches/video-toolkit/envs/audio-transcribe-mlx-v2`，
  仅在该 venv 安装依赖；可用 uv 或标准库 venv，不修改 Homebrew／系统包。
- 需 ffmpeg／ffprobe。预先提取明确音轨为 16kHz 单声道 WAV，保留原媒体零点。
- 复用 `Session(model=明确的1.7B模型)` 和 `ForcedAligner()`，调用
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
