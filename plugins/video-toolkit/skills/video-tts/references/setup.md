# 环境准备与排障（video-tts）

## 环境策略（run.py 自动执行）

`run.py` 按以下顺序解析解释器，**只在专用 venv 里安装依赖**，绝不修改系统
Python / Homebrew / 其他 skill 的环境，也不使用 `--break-system-packages`：

1. `VIDEO_TTS_PYTHON` 显式指定的解释器（缺依赖 / 能力不足时给出准确报错）；
2. 缓存里上次选中的解释器（仍会重新 import 校验）；
3. 任何**已经**能 import 所需依赖的现有解释器（只复用、不安装）；
4. 创建 / 补装专用 venv（`~/.cache/video-tts/venv`，Windows 在
   `%LOCALAPPDATA%\video-tts\venv`），按锁定文件安装。

锁定依赖（随 skill 分发，本地 / 在线分开）：

| 文件 | 内容 | 适用 |
| --- | --- | --- |
| `requirements-base.txt` | numpy、soundfile | 所有路线 |
| `requirements-local.txt` | base + `mlx-audio>=0.6.4,<0.7` | 仅 Apple Silicon 本地 |
| `requirements-online.txt` | base + `requests` | 在线（含 Windows） |

测试基线：Python 3.14 + mlx-audio 0.6.4（macOS arm64）。

## 能力检测（本地路线）

本地路线不止 `import mlx_audio`，run.py 会在子解释器里验证：

- `platform.machine() == "arm64"`（排除 Rosetta / Intel Python）；
- `mlx.core.metal.is_available()`（Metal 运算可用）；
- `mlx_audio.tts.utils.load_model` 存在（TTS API 可用）。

不满足时的提示：Intel Python → 装 arm64 Python（`brew install python@3.14`）
或改在线；Metal 不可用（虚拟机 / 远程会话）→ 改在线。Windows 一律拒绝本地
路线并提示 `--provider online`。

模型下载延迟到真正执行本地路线时（首次约 3.4 GB，缓存在
`~/.cache/huggingface/hub`）；缓存齐全后支持离线运行。

## FFmpeg

重采样 / 变速 / 混流都需要 ffmpeg + ffprobe。缺失提示按平台：

- macOS：`brew install ffmpeg`
- Windows：`winget install ffmpeg`（不要在 Windows 上输出 brew 命令）

## 在线登录（百炼 bl）

```bash
command -v bl
bl auth status --output json    # 期望 {"authenticated": true, ...}
```

- 缺 `bl`：`npm install -g bailian-cli`（需 Node.js ≥ 18.17）或
  `curl -fsSL https://bailian.aliyun.com/cli/install.sh | bash`；
  已有 `DASHSCOPE_API_KEY` 时可改走 HTTP 兜底（加 `--tts-endpoint`）。
- 未登录：CLI 自动后台运行 `bl auth login --console --no-browser` 并打印
  `请点击登录：https://...`——**一看到 URL 就作为可点击链接转给用户**，说明
  「登录完成后我会继续等待」；每 2 秒轮询，最长 300 秒。超时后让用户选：
  重新获取链接 / 重新登录 / 切本地。
- API key 兜底只在 `bl` 缺失时生效；skill 不接收、不保存、不打印任何明文 key，
  不要让用户把 key 发进对话。

## 常见错误对照

| 现象 | 处理 |
| --- | --- |
| `bl not found` / 未登录 | 见上文登录流程；或切本地 |
| 401 / 403 | 立即停止（fatal，不重试）；提示 `bl auth login` 或切本地 |
| 429 / 5xx | 统一调度层在总预算内退避重试（遵守 Retry-After）；耗尽后报告 |
| 额度不足 / Throttling | fatal；给[百炼控制台](https://bailian.console.aliyun.com/)链接 |
| timeout（提交后状态不明） | `submission_unknown`：不自动重提，等用户核对后决定 |
| 模型下载失败 | 检查网络或 `huggingface-cli download <model-id>`（错误信息自带命令） |
| 输出已存在 | 默认拒绝覆盖；换 `--out` 或显式 `--overwrite` |
| overflow（放不下） | 见主文档「时间适配」；调整合并边界 / `--max-speed` 后 `--resume` |

## bl 版本说明

`bl speech synthesize` / `auth status` 按**当前可验证版本**的 CLI 行为实现
（wav 输出、`--instruction`、`--sample-rate` 等参数）。若 `bl` 大版本更新导致
参数不兼容，会以非零退出码失败——把 CLI 的 stderr 原样带给用户并提示升级 /
降级 bl，不要自行全局升级。
