# audio-transcribe Skill 优化建议

> 来源：2026-11-08 在 Windows 11 + Git Bash 环境下，使用本地 Qwen 路线转录 YouTube 视频的一次实跑复盘。
> 硬件：RTX 4070 Ti（12GB，算力 8.9）；系统 Python 仅有 3.14.2（`C:\Python314`）。

## 一、问题时间线

### 失败① 缺 Python 3.12 / uv（退出码 1）

- 环境：无 uv、无 Python 3.12，`py -0` 仅列出 3.14。
- 执行：`python run.py "xxx.m4a" --provider qwen --formats srt --language en`
- 输出（仅一行后退出）：

```
Install Python 3.12 or uv, then rerun; global environments will not be modified.
```

- 根因：run.py 建专属 venv 只接受 uv 或现成 Python 3.12，两者皆无即 bail out。

### 中间过程：装了 uv 却"找不到"

```bash
pip install uv        # 成功，uv 0.13.7
uv --version          # bash: uv: command not found
where.exe uv          # 同样找不到
```

- 根因：pip 将 uv 装到**用户站点目录**（`%APPDATA%\Python\Python314\site-packages`），exe 落在 `%APPDATA%\Python\Python314\Scripts\`，该目录不在 PATH。
- `python -m uv --version` 可正常调起——pip 安装的 uv 必然支持模块调用，但 run.py 只认 PATH 上的 `uv`。

### 失败② PATH 格式错误（退出码 127）

```bash
export PATH="$APPDATA/Python/Python314/Scripts:$PATH" && uv --version && python run.py ...
```

```
/usr/bin/bash: line 3: uv: command not found
```

- 根因：Git Bash 中 `$APPDATA` 为 Windows 反斜杠格式（`C:\Users\...\Roaming`），`C:` 中的冒号将 PATH 条目截断为乱码。必须用 POSIX 形式 `/c/Users/jasing/AppData/Roaming/Python/Python314/Scripts`。
- 定性：属用户侧 shell 操作失误，但暴露了 skill 对 uv 的发现途径过于单一（见优化点 2）。

### 第三次启动成功

```bash
export PATH="/c/Users/jasing/AppData/Roaming/Python/Python314/Scripts:$PATH"
```

- uv 使用自管理的 CPython 3.12.9 建 venv → 安装 `torch 2.10.0+cu130`（1.7 GiB，4m55s）→ 84 个依赖 → cuda:0 bfloat16 推理。
- 媒体 687s，转录阶段 224s（约 3 倍速实时），结果完整。

## 二、优化建议（按收益排序）

### 1. `--detect-env` 应预检 uv / Python 3.12 前置条件

现状：检测报告 `local_support_status: "not_checked"`，对"既无 uv 也无 Python 3.12"无任何提示，直到正式转录才 bail out，用户此时已投入下载媒体等前置成本。

建议：检测阶段加入 `shutil.which("uv")`、`python -m uv --version`、py launcher 版本枚举，把阻塞项在 detect-env 就报出来（例如 `local_support_status: "blocked_missing_uv"` 附原因）。

### 2. uv 发现逻辑太窄（消灭失败①②的复现场景）

现状：只认 PATH 上的 `uv`，pip 用户安装（不在 PATH）必然失败。

建议按优先级探测：

1. `shutil.which("uv")`
2. `python -m uv`（pip 安装必然可用）
3. `site.USER_BASE + "/Scripts"`、`sysconfig.get_path("scripts")` 下的 `uv.exe`

或提供 `AUDIO_TRANSCRIBE_UV` 环境变量 / `--uv-path` 参数（与现有 `AUDIO_TRANSCRIBE_TORCH_INDEX` 同一套路）。

### 3. 报错信息应更可操作

现状：`Install Python 3.12 or uv, then rerun` 说重了——实测**只装 uv 即可**（uv 自动拉取管理版 CPython 3.12.9，无需单独装 Python 3.12）。

建议：

- 文案改为"未找到 uv。可 `pip install uv` 或使用官方安装脚本；uv 会自动管理 Python 3.12，无需单独安装"；
- 按 skill 交互约定用 AskUserQuestion 提供选项：自动 bootstrap uv / 用户自行安装后重试。

### 4. 文档补充 Git Bash 的 PATH 坑（如文档指导用户改 PATH）

Windows 环境变量进 Git Bash PATH 必须写 POSIX 形式（`/c/...`），`$APPDATA` 直拼会因反斜杠与 `C:` 冒号失效。

### 5. 首跑体验：torch 下载占准备时间大头

- torch cu130 版 1.7 GiB，占一次性准备约 5 分钟。
- 建议检测到无 NVIDIA 时装 CPU 版（体积小得多）；有 N 卡时提前提示"首次需下载约 1.7GB CUDA 版 torch"。

