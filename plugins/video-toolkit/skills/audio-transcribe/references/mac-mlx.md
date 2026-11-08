# Mac (Apple Silicon) — MLX 本地路线

主后端：[moona3k/mlx-qwen3-asr](https://github.com/moona3k/mlx-qwen3-asr/)（安装包 `mlx-qwen3-asr`，
Python 模块 `mlx_qwen3_asr`）。它内建长音频分块（30 秒低能量切点）、原生 MLX 对齐器和 SRT 导出，
核心转写无需 PyTorch。注意不要与另一套包 `qwen3-asr-mlx`（模块 `qwen3_asr_mlx`）混淆，本项目不用后者。

## 权重配置

| 配置 | 仓库 | 体积 | 策略 |
| --- | --- | --- | --- |
| 8bit | `mlx-community/Qwen3-ASR-1.7B-8bit` | ~2.46 GB | **默认** |
| bf16 | `mlx-community/Qwen3-ASR-1.7B-bf16` | ~4.08 GB | 质量对照，`--precision bf16` |
| 6bit | `mlx-community/Qwen3-ASR-1.7B-6bit` | ~2.03 GB | 较低资源，`--precision 6bit`（未经本项目实机验证） |

要点：

- 文件体积 ≠ 内存门槛；运行峰值还含缓存、激活、音频和对齐。
- 适配器**每次显式传模型名**——该工具自身默认是 `Qwen/Qwen3-ASR-0.6B`，本项目固定 1.7B。
- moona3k 加载器会把浮点参数转成 FP16 推理，因此 bf16 仓库名不代表全程 BF16 计算；
  结果 JSON 中 `weight_precision`（权重）与 `compute_dtype`（推理）分开记录。
- 8bit 为默认配置；6bit 的速度/质量需同设备同音频实测后才能对用户开放承诺。

## 安装

```bash
python3 -m pip install --break-system-packages mlx-qwen3-asr zhconv
brew install ffmpeg   # 非 WAV 输入需要
```

通过 `run.py` 调用时自动完成：优先复用已装好依赖的解释器（缓存于
`~/.cache/video-toolkit/audio-transcribe-env-qwen.json`），全都没有才安装。

## 排障

- **`mlx` 导入失败 / 提示架构不符**：确认是 Apple Silicon + 原生 ARM64 Python
  （Intel Python / Rosetta 下 MLX 不可用，`--detect-env` 会标 unsupported 并建议
  切原生 Python 或改用 Scribe）。
- **Homebrew 升级 Python 后提示依赖缺失**：旧包在新解释器里。`run.py` 会扫描
  Homebrew/pyenv 各版本解释器并复用，不要手动重复安装几 GB 依赖。
- **首次运行慢**：在下载权重（~2.5-4GB），缓存于 `~/.cache/huggingface/hub/`，跨次复用。

## 验收状态

| 场景 | 状态 |
| --- | --- |
| P01 Apple Silicon 8bit（中/英 TXT+JSON+SRT） | 待实机验收 |
| P02 BF16 加载/对齐、记录实际 dtype | 待实机验收 |
| P03 6bit 全链路 | 待实机验收（未开放承诺） |
| P06 Intel Mac 拒绝 MLX 并给出选项 | 逻辑已实现（单测覆盖），待实机抽查 |
