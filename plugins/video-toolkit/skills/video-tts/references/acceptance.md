# video-tts Windows torch 路线实机验收记录

环境：RTX 4070 Ti（12GB）/ 驱动 610.88（nvidia-smi 报 `CUDA UMD Version: 13.3`）/
Windows 10 x64 / ffmpeg 8.0.1。专用 venv：`%LOCALAPPDATA%\video-toolkit\envs\video-tts-torch`。

## 锁定组合（实测安装通过）

| 组件 | 版本 |
| --- | --- |
| Python | 3.14.2（官方基线候选为 3.12；实测 3.14 可用，无需另装解释器，且与 ASR 环境同 Python tag） |
| torch / torchaudio | 2.10.0+cu130（按驱动报告的 CUDA 13.x 选 cu130 索引安装） |
| qwen-tts | 0.1.1（`from qwen_tts import Qwen3TTSModel`） |
| transformers / accelerate | 4.57.3 / 1.12.0（随 qwen-tts 0.1.1 声明） |
| 模型 | `Qwen/Qwen3-TTS-12Hz-1.7B-{CustomVoice,Base,VoiceDesign}`（HF snapshot 缓存） |

注意（实机发现，实施时必须保留的处理）：

- **nvidia-smi 编码与格式**：中文 Windows 输出 GBK 且新驱动头部是
  `CUDA UMD Version: 13.3`（非经典 `CUDA Version:`）——按字节捕获 +
  双格式正则，`text=True` 直接解码会抛 UnicodeDecodeError。
- **language 参数取语言全名**：`'chinese'` 而非 `'zh'`（实测报
  `Unsupported languages: ['zh']`，supported 列表为全名 + `auto`）。
- **SoX 缺失仅告警**：qwen-tts import 时提示 SoX not found，但不影响
  加载与合成；不把系统 SoX 列为前置（spec §5.1）。
- flash-attn 缺失仅告警；默认 SDPA。

## 实机验收（2026-11-08/09）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| launcher 路由 local→torch venv + 能力探测 | ✅ | `[video-tts] Using …envs\video-tts-torch\Scripts\python.exe (route: local_torch)`；探测含 x64 + cuda.is_available + 真实张量运算 + qwen_tts API |
| CustomVoice 预设音色（Serena，2 组中文） | ✅ | 2/2 组 `fit` 1.00x；整轨 7.00s@48kHz、RMS 0.048、峰值 0.436（真实语音电平）；原生 24k→48k 真实重采样；prepare 16.2s、合成 26.5s |
| Base 参考克隆（参考=上一步 CustomVoice 产物 2.2s + 准确 ref_text） | ✅ | 2/2 组 `fit`；克隆链路 CLI→engine（ref_audio/ref_text 真实穿透、voice=None）→create_voice_clone_prompt→generate_voice_clone |
| resume 恢复（Base 模型下载中断后 `--resume <job 目录>`） | ✅ | 同一 job（20261108-223308-848e2c）从 failed 恢复为 complete |
| 内部状态目录 / 交付分离 | ✅ | report/job 落 `state/jobs/<job_id>/`；素材目录只有 `smoke.dub.wav` |
| VoiceDesign（`generate_voice_design` + `--preview-text` 试听入口） | ✅ | `preview.preview.wav` 2.54s@48k、RMS 0.130（真实语音）；试听文本与克隆指引按预期输出 |
| 设计后克隆全流程（预览→选定→Base 克隆整片） | ✅ | 以 preview.wav + 试听文本作参考：`designed.dub.wav` 7.00s、2/2 组 `fit`、RMS 0.088——同一设计声音贯穿整片 |

## 待补验收项

- `release_model` 同进程切换显存峰值证据（`max_memory_allocated` 双阶段）；
  预览/整片分进程路径天然无此问题。
- 长片（≥10min SRT）低内存证据（F07 内存上界）与批量（P2）。
- 听审：三模式输出与克隆跨段音色一致性目前以电平/时长/峰值客观指标验证，
  人耳听审样本待用户复核（音频在 `%TEMP%\vtts-accept\`，重启后清理）。
- Mac 侧：mlx-audio 克隆参数契约（`generate(ref_audio=…)`）实机核对、
  设计后克隆、F10 真实 model_revision。
