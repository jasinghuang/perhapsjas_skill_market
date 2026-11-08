# Windows / Linux — PyTorch 本地路线（官方 qwen-asr）

识别模型固定 `Qwen/Qwen3-ASR-1.7B`，对齐模型 `Qwen/Qwen3-ForcedAligner-0.6B`
（词级时间戳，单次 ≤ 约 5 分钟 → 适配器按 ≤290s 静音吸附分块）。
首版不依赖 vLLM、FlashAttention、torch.compile。官方未明示 Windows 支持承诺，
因此本路线以实机验收为准。

## CUDA 检查（选定本地后自动执行）

1. 锁定版本 PyTorch 可导入
2. PyTorch 是否 CUDA 构建（`torch.version.cuda`）
3. `torch.cuda.is_available()`
4. GPU 型号 / 计算能力 / 显存
5. 小型 GPU 张量运算冒烟
6. 识别 + 对齐模型加载与短音频冒烟（首次真实转写时）

nvidia-smi 只是诊断信息，不单独作为成功条件。计算精度：CUDA + 算力 ≥8 → BF16；
CUDA + 老卡 → FP16；无 CUDA → FP32（慢速兼容模式）。

## 安装

通过 `run.py` 自动进行；手动等价命令：

```powershell
# 有 NVIDIA GPU（驱动 ≥ 580，CUDA 13 路线）：
python -m pip install torch --index-url https://download.pytorch.org/whl/cu130
python -m pip install qwen-asr zhconv

# 老驱动可换索引：set AUDIO_TRANSCRIBE_TORCH_INDEX=cu128 （或 cu126）
# 无 NVIDIA GPU：
python -m pip install qwen-asr zhconv   # 带入 CPU 版 torch
```

PyPI 默认的 Windows torch wheel 是 CPU 构建，有 NVIDIA GPU 必须显式用 CUDA 索引。
本项目默认 cu130，可用环境变量 `AUDIO_TRANSCRIBE_TORCH_INDEX` 覆盖。
不需要完整 CUDA Toolkit，除非自行编译。应用不安装/修改显卡驱动——缺驱动时按
[NVIDIA 官网](https://www.nvidia.com/drivers) 更新后重试。

## CPU 模式（无 CUDA）

FP32 慢速兼容路径。**已于 2026-11-08 通过中文+英文短样本（各 10s）端到端验证**
（识别→对齐→TXT/JSON/SRT 全链路，RTF ≈ 2-4x，即比 CUDA 慢一个数量级）。
长音频（>30 分钟）在 CPU 上可能需要数小时，建议改用 Scribe。
用户选择本地但探测到无 CUDA 时，应提示"CPU 可能显著较慢"，由用户决定
继续 `--device cpu` 还是改选 Scribe。显存/内存不足时先降块长，仍失败则报告
具体错误与替代方案——不自动换模型、不自动换 provider。

## WSL

WSL 被单独识别为 Linux 环境（`--detect-env` 标 `is_wsl: true`），可复用 PyTorch
路线，但属于扩展验证：WSL 下的通过结果不能当作原生 Windows 验收。

## Python 版本注意

torch 的 Windows wheel 对最新 Python 版本支持有滞后。若 `run.py` 报"装完仍 import
失败"，安装一个已受支持的 Python（如 3.12/3.13）后重试——`run.py` 会扫描本机全部
解释器。本机验证环境：Windows 11 + RTX 4070 Ti + 驱动 610.88 + Python 3.14 + torch cu130。

## 排障

- **`Could not locate cudnn` / CUDA 加载失败**：升级 NVIDIA 驱动；确认装的是 CUDA 索引
  的 torch（`python -c "import torch;print(torch.version.cuda)"` 应输出如 `13.0`）。
- **显存不足（12GB 卡同时跑其他 GPU 应用）**：关闭其他 GPU 程序；适配器已按需顺序
  加载识别与对齐模型。
- **长音频中断**：直接重跑同一命令，已完成分块缓存（`<输出目录>/.<stem>.chunks/`）
  会按"输入+模型+语言+参数指纹"匹配复用，不重复计算。

## 验收状态

| 场景 | 状态 |
| --- | --- |
| P04 原生 NVIDIA：CUDA 实际执行 + 识别/对齐/导出 | **已实机验收**（RTX 4070 Ti / 驱动 610.88 / torch 2.14.1+cu130 / BF16；中/英/混合/32.5min 长样本全通过，见交付说明） |
| P05 无 CUDA：正确报告状态；CPU 全链路 | **短样本已验证**（zh+en 各 10s 全链路）；长音频 CPU 未实测 |
