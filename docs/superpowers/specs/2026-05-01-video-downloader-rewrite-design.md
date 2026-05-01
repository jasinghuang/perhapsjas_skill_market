# Video Downloader Skill Rewrite Design

日期：2026-05-01

## 背景

当前 `video-downloader` skill 存在以下问题：

1. **JS runtime 缺失**：yt-dlp 默认只启用 deno，未显式启用 node，导致 Windows 上只有 node 时报 `No supported JavaScript runtime could be found`，然后 403 Forbidden
2. **Windows 编码崩溃**：`sys.stdout` 使用 GBK 编码，遇到 emoji/Unicode 直接 `UnicodeEncodeError`
3. **subprocess 调用 yt-dlp**：容易丢失错误信息、编码问题、命令路径问题
4. **`python3` 不存在于 Windows**：错误提示中硬编码 `python3`
5. **死代码**：`update_yt_dlp()` 从未被调用，`config.json` 的 `use_aria2` 从未读取
6. **文件检测竞态**：`iterdir()` diff 检测已下载文件，不可靠

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 重写范围 | 全量重写 | 问题太多，修补不如重写 |
| yt-dlp 调用方式 | Python API (`from yt_dlp import YoutubeDL`) | 避免 subprocess 编码/路径问题，直接获取错误信息 |
| JS runtime | 自动检测 deno/node | 用户无需手动传 `--js-runtimes` |
| 依赖安装 | 自动安装 yt-dlp | `sys.executable -m pip install`，macOS 回退 `--break-system-packages` |
| 配置文件 | 删除 config.json | 所有参数通过命令行传入 |

## 文件结构

```
skills/video-downloader/
├── skill_main.py    # 重写（全部逻辑）
├── SKILL.md         # 重写（跨平台适配）
└── config.json      # 删除
```

## Section 1：Python API 集成

### yt-dlp 调用

所有下载通过 Python API 完成：

```python
from yt_dlp import YoutubeDL

with YoutubeDL(opts) as ydl:
    ret = ydl.download(urls)  # 0 = 成功
```

### JS Runtime 自动检测

```python
import shutil

def detect_js_runtimes():
    runtimes = []
    for rt in ['deno', 'node']:
        if shutil.which(rt):
            runtimes.append(rt)
    if not runtimes:
        print("⚠ 未检测到 JS runtime (deno/node)")
        print("  YouTube 等站点可能下载失败")
        print("  请安装 Node.js ≥20 或 Deno")
    return runtimes
```

传入 yt-dlp options：
```python
runtimes = detect_js_runtimes()
if runtimes:
    opts['js_runtimes'] = runtimes
```

### Format 选择映射

| 预设 | format string |
|------|--------------|
| `best` | `bv*+ba/b` (yt-dlp 默认行为) |
| `high` | `bv*[height<=1080]+ba/b[height<=1080]` |
| `medium` | `bv*[height<=720]+ba/b[height<=720]` |
| `low` | `bv*[height<=480]+ba/b[height<=480]` |
| `audio-only` | `ba/b` + postprocessor `FFmpegExtractAudio` |

`--resolution` + `--codec` 动态构建：
```python
f"bv*[height<={res}][vcodec^={codec}]+ba/b[height<={res}]"
```

`--format` 直接传，优先级最高。

### Windows 编码修复

```python
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
```

## Section 2：依赖检查与自动安装

### yt-dlp 自动安装

```python
import sys, subprocess

def ensure_yt_dlp():
    try:
        import yt_dlp
        return True
    except ImportError:
        pass

    print("📦 正在安装 yt-dlp...")
    try:
        subprocess.check_call([
            sys.executable, '-m', 'pip', 'install', '-U', 'yt-dlp[default]'
        ])
        return True
    except subprocess.CalledProcessError:
        try:
            subprocess.check_call([
                sys.executable, '-m', 'pip', 'install', '-U',
                '--break-system-packages', 'yt-dlp[default]'
            ])
            return True
        except subprocess.CalledProcessError:
            print("❌ 自动安装失败，请手动运行:")
            print(f"  {sys.executable} -m pip install -U \"yt-dlp[default]\"")
            return False
```

- `sys.executable` 自动适配 `python`/`python3`/`py`
- `yt-dlp[default]` 包含 `yt-dlp-ejs`（YouTube JS 支持）
- macOS 需要时加 `--break-system-packages`
- JS runtime（deno/node）不自动安装（系统级软件，pip 装不了）

### 可选依赖检查

| 依赖 | 检查方式 | 缺失处理 |
|------|---------|---------|
| ffmpeg | `shutil.which('ffmpeg')` | 警告：合并音视频可能失败 |
| aria2 | `shutil.which('aria2c')` | 仅当用户传 `--aria2` 时检查 |

## Section 3：错误处理

### 下载错误捕获

```python
from yt_dlp.utils import DownloadError

try:
    with YoutubeDL(opts) as ydl:
        ret = ydl.download(urls)
        if ret:
            print(f"❌ 部分视频下载失败 (错误码: {ret})")
except DownloadError as e:
    print(f"❌ 下载失败: {e}")
```

### 常见错误映射

| 错误场景 | 处理方式 |
|---------|---------|
| JS runtime 缺失 → 403 | 下载前检测并警告，失败后再次提示安装 node/deno |
| Cookie 无效/过期 | 捕获 `DownloadError`，提示重新导出 Cookie |
| 格式不可用 | 回退到 `best` 格式重试 |
| 网络超时 | yt-dlp 内置重试（默认 10 次） |
| 输出路径不存在 | `os.makedirs(output_dir, exist_ok=True)` |

### 返回值

`sys.exit(ret)` 透传 yt-dlp 错误码，Claude 根据退出码判断成功/失败。

## Section 4：SKILL.md 改写

### 变化

| 旧版 | 新版 |
|------|------|
| 依赖检查在 SKILL.md 里写死步骤 | 脚本自动安装 yt-dlp，SKILL.md 只写可选依赖 |
| `python3` 硬编码 | 用 `sys.executable` 适配 |
| 无 JS runtime 说明 | 新增 JS runtime 检测说明 |
| config.json 配置 | 删除，所有参数命令行传入 |

### 新 SKILL.md 结构

```markdown
---
name: video-downloader
description: >
  视频下载工具，支持 Bilibili 和 YouTube...
---

# Video Downloader

## 首次依赖检查

脚本自动检测并安装 yt-dlp。以下为可选依赖：

### 可选：JS runtime（YouTube 等站点需要）
- 安装 Node.js ≥20 或 Deno
- 脚本自动检测，无需配置

### 可选：ffmpeg（合并音视频）
- Mac: `brew install ffmpeg`
- Windows: `winget install ffmpeg`

### 可选：aria2（加速下载）
- Mac: `brew install aria2`
- Windows: `winget install aria2`

## 使用方法
（保持现有命令示例）

## 参数
（保持不变）

## 完整工作流
...
```

## Section 5：删除的内容

| 内容 | 原因 |
|------|------|
| `config.json` | 从未有效使用，命令行参数替代 |
| `update_yt_dlp()` | 死代码，从未被调用 |
| `iterdir()` 文件检测 | yt-dlp 自行处理已存在文件 |
| subprocess 调用 yt-dlp CLI | Python API 替代 |
| `use_aria2` 配置字段 | 改为 `--aria2` 命令行参数 |

## Section 6：入口文件

```python
#!/usr/bin/env python3
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

def main():
    if not ensure_yt_dlp():
        sys.exit(1)

    runtimes = detect_js_runtimes()
    args = parse_args()
    opts = build_opts(args, runtimes)

    try:
        with YoutubeDL(opts) as ydl:
            ret = ydl.download(args.urls)
            sys.exit(ret)
    except DownloadError as e:
        print(f"❌ 下载失败: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
```
