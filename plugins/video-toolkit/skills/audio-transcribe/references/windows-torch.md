# Windows：官方 qwen-asr／PyTorch

识别固定 `Qwen/Qwen3-ASR-1.7B`，对齐固定 `Qwen/Qwen3-ForcedAligner-0.6B`。
使用 Transformers 路线，不需要 vLLM、FlashAttention 或完整 CUDA Toolkit。

## 独立环境

`run.py` 创建应用缓存下 `video-toolkit/envs/audio-transcribe-torch-v2`，
优先用 uv 以 Python 3.12 建 venv；没有 uv 时用本机兼容 Python 创建标准 venv。
本轮直接依赖固定 `qwen-asr==0.0.6`、`torch==2.10.0`、`torchaudio==2.10.0`。

### uv 发现顺序（2026-11-08 实跑复盘后加宽）

只认 PATH 上的 `uv` 曾导致 pip 用户安装（exe 落在用户 Scripts 目录、不在 PATH）被漏判。
现按以下顺序发现，`pip install uv` 后**无需改 PATH**：

1. `--uv-path` 参数或 `AUDIO_TRANSCRIBE_UV` 环境变量（显式指定，优先级最高）；
2. PATH 上的 `uv`；
3. 用户/系统 Scripts 目录（`sysconfig` 的 `userscripts`/`scripts`，即 pip 用户安装位置）；
4. `python -m uv`（先当前解释器，再 PATH 上的 python——检测跑在专属 venv 内也能发现系统级 pip 安装）。

没有 uv 时回退枚举本机 Python：`py -0p` 列表（含含空格路径）、PATH、
`%LOCALAPPDATA%\Programs\Python`、homebrew/pyenv（Mac/Linux），取第一个 3.10–3.12。
两者皆无才阻塞，报错给出上述修复路径（`pip install uv` 即可，uv 会自行下载管理 Python 3.12，
无需单独装 Python）。

### 首次下载体量提示

有 NVIDIA GPU 时默认从 `https://download.pytorch.org/whl/cu130` 安装，
安装前会提示这是一次性约 1.7 GiB 下载；无 NVIDIA 时自动用体积小得多的 CPU 索引并说明推理更慢。
可用 `AUDIO_TRANSCRIBE_TORCH_INDEX` 指定兼容索引；已有 CPU torch 换 CUDA 构建时自动
`--force-reinstall`。若驱动不支持所选构建，明确报告，由用户选继续兼容路线或调整环境，不自动修改驱动。
安装失败不修改全局 Python，可在专属环境重试。

### Git Bash 手动改 PATH 的坑（仅当确需手动加 PATH）

Windows 环境变量（如 `$APPDATA`）是反斜杠形式（`C:\Users\...`），直接拼进 PATH 时
`C:` 里的冒号会把条目截断成乱码。必须用 POSIX 形式：

```bash
export PATH="/c/Users/<用户名>/AppData/Roaming/Python/Python314/Scripts:$PATH"
```

## 实机记录

- 2026-11-08：RTX 4070 Ti（12GB）＋ uv 自管 CPython 3.12.9 ＋ torch 2.10.0+cu130，
  687s YouTube 音频 224s 完成（约 3 倍速实时），结果完整；首次准备约 5 分钟（torch 1.7 GiB 大头）。
  交付矩阵见 docs/audio-transcribe-qwen-scribe-delivery.md（P04/P05）。
- WSL 标识为 Linux 扩展路线，其成功不代表原生 Windows 成功；Windows ARM 仍需实机验证。

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
