# Windows：官方 qwen-asr／PyTorch

识别固定 `Qwen/Qwen3-ASR-1.7B`，对齐固定 `Qwen/Qwen3-ForcedAligner-0.6B`。
使用 Transformers 路线，不需要 vLLM、FlashAttention 或完整 CUDA Toolkit。

## 独立环境

`run.py` 创建应用缓存下 `video-toolkit/envs/audio-transcribe-torch-v2`，
通过 uv 优先使用 Python 3.12；没有 uv 时选兼容的 Python 创建标准 venv。
本轮直接依赖固定 `qwen-asr==0.0.6`、`torch==2.10.0`、`torchaudio==2.10.0`。
这是新启动器的安装组合；本轮在 Mac 修改并做离线逻辑回归，**尚未在原生 Windows 重做实机验收**。
仓库此前 Windows 测试属于历史不同环境记录，不能等同本轮新安装组合已验证。

有 NVIDIA GPU 时默认从 `https://download.pytorch.org/whl/cu130` 安装，
可用 `AUDIO_TRANSCRIBE_TORCH_INDEX` 指定兼容索引；无 NVIDIA 时用 CPU 索引。
若驱动不支持所选构建，明确报告，由用户选继续兼容路线或调整环境，不自动修改驱动。
安装失败不修改全局 Python，可在专属环境重试；需要 uv 或已有兼容 Python。

## CUDA、CPU 与时间轴

nvidia-smi 仅用于安装候选选择；实际就绪需检查 torch 导入、CUDA 构建、
`torch.cuda.is_available()`、GPU 属性和小型 CUDA 张量运算，模型加载仍可能显存不足。
GPU 算力 >=8 使用 BF16，否则 FP16；`--device cpu` 使用 FP32，显著较慢。
不要把仅有 CPU wheel 当成 CUDA 可用，也不因 qwen_asr 可导入就跳过 CUDA 构建检查。

长音频先提取指定音轨为 16kHz 单声道 WAV，按静音切成目标 240 秒、上限 290 秒的块，
调用官方 `return_time_stamps=True`，实际对齐单位转换为原媒体时间。
对齐失败保留原始识别文字，返回 partial；时间格式不伪造时间轴，无时间 MD 可交付。

工作目录在应用缓存，不在素材旁；已完成块使用源内容／音轨／模型／语言等指纹和原子 JSON 写入。
重跑可复用已完成块，但预处理和模型加载仍可能需要时间。完整结果可直接重新导出。
WSL 标识为 Linux 扩展路线，其成功不代表原生 Windows 成功；Windows ARM 仍需实机验证。
