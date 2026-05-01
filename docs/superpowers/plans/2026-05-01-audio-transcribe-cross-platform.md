# Audio Transcribe Cross-Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `mlx-whisper` to `audio-transcribe` and add Windows support via `faster-whisper` with CUDA acceleration.

**Architecture:** Multi-file backend pattern — `skill_main.py` dispatches to platform-specific backends via a factory function. Mac uses `mlx_whisper`, Windows uses `faster_whisper`. Output formatting (SRT/MD/JSON) stays in the unified entry point.

**Tech Stack:** Python 3.9+, mlx-whisper (Mac), faster-whisper (Windows), zhconv

---

## File Structure

```
skills/audio-transcribe/                  ← renamed from mlx-whisper via git mv
  SKILL.md                                ← REWRITE: platform detection + dual model options
  skill_main.py                           ← REFACTOR: backend dispatch, keep formatting
  backends/
    __init__.py                           ← NEW: TranscriptionBackend ABC + get_backend() factory
    mlx_backend.py                        ← NEW: extract mlx_whisper logic from old skill_main.py
    faster_whisper_backend.py             ← NEW: faster-whisper with CUDA auto-detect
```

**Files to update (references only):**
- `.claude-plugin/marketplace.json` — skill path
- `skills/video-downloader/SKILL.md` — pipeline reference
- `skills/text-refine/SKILL.md` — pipeline reference
- `README.md` — all mentions

---

### Task 1: Rename directory and create backend structure

**Files:**
- Rename: `skills/mlx-whisper/` → `skills/audio-transcribe/`
- Create: `skills/audio-transcribe/backends/`

- [ ] **Step 1: Rename skill directory**

```bash
cd "E:/Claude Code/Video_Toolkit"
git mv skills/mlx-whisper skills/audio-transcribe
```

- [ ] **Step 2: Create backends directory**

```bash
mkdir -p "E:/Claude Code/Video_Toolkit/skills/audio-transcribe/backends"
```

- [ ] **Step 3: Verify structure**

```bash
ls -la "E:/Claude Code/Video_Toolkit/skills/audio-transcribe/"
ls -la "E:/Claude Code/Video_Toolkit/skills/audio-transcribe/backends/"
```

Expected: `SKILL.md`, `skill_main.py`, `config.json` (if existed), and empty `backends/` directory.

---

### Task 2: Create backends/\_\_init\_\_.py

**Files:**
- Create: `skills/audio-transcribe/backends/__init__.py`

- [ ] **Step 1: Write the backend ABC and factory**

Write `skills/audio-transcribe/backends/__init__.py`:

```python
"""Audio transcription backends — auto-select based on platform."""

from abc import ABC, abstractmethod
from typing import Dict, Optional


class TranscriptionBackend(ABC):
    """Common interface for transcription backends."""

    @abstractmethod
    def load_model(self, model_name: str) -> None:
        """Load the transcription model. Must be called before transcribe()."""

    @abstractmethod
    def transcribe(self, audio_path: str, language: Optional[str] = None) -> Dict:
        """Transcribe audio and return unified result.

        Returns:
            {"segments": [{"start": float, "end": float, "text": str}],
             "language": str}
        """

    def check_dependencies(self) -> bool:
        """Verify runtime dependencies. Return True if OK, print error if not."""
        return True


def get_backend() -> TranscriptionBackend:
    """Return the appropriate backend for the current platform."""
    import platform
    system = platform.system()
    if system == "Darwin":
        from .mlx_backend import MLXBackend
        return MLXBackend()
    else:
        from .faster_whisper_backend import FasterWhisperBackend
        return FasterWhisperBackend()
```

- [ ] **Step 2: Verify import works**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "from backends import TranscriptionBackend, get_backend; print('OK')"
```

Expected: `OK`

---

### Task 3: Create backends/mlx\_backend.py

**Files:**
- Create: `skills/audio-transcribe/backends/mlx_backend.py`

This extracts the mlx-whisper logic from the existing `skill_main.py` (lines 14-18, 80-148).

- [ ] **Step 1: Write the MLX backend**

Write `skills/audio-transcribe/backends/mlx_backend.py`:

```python
"""Mac backend — MLX-Whisper (Apple Silicon native acceleration)."""

import subprocess
from typing import Dict, Optional

from . import TranscriptionBackend

MODEL_REPOS = {
    "small": "mlx-community/whisper-small-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
}


class MLXBackend(TranscriptionBackend):
    def __init__(self):
        self._repo = None

    def check_dependencies(self) -> bool:
        ok = True
        try:
            import mlx_whisper  # noqa: F401
        except ImportError:
            print("mlx-whisper not installed. Install: pip3 install --break-system-packages mlx-whisper")
            ok = False
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            print("ffmpeg not installed. Install: brew install ffmpeg")
            ok = False
        return ok

    def load_model(self, model_name: str) -> None:
        self._repo = MODEL_REPOS.get(model_name, MODEL_REPOS["large-v3-turbo"])
        print(f"Loading MLX-Whisper model ({model_name})...")
        print(f"  Repo: {self._repo}")

    def transcribe(self, audio_path: str, language: Optional[str] = None) -> Dict:
        import mlx_whisper

        whisper_language = None if language in ("auto", None) else language
        result = mlx_whisper.transcribe(
            str(audio_path),
            path_or_hf_repo=self._repo,
            language=whisper_language,
            verbose=False,
        )

        detected_lang = result.get("language", "unknown")
        print(f"  Detected language: {detected_lang}")

        segments = []
        for seg in result["segments"]:
            text = seg["text"].strip()
            if text:
                segments.append({"start": seg["start"], "end": seg["end"], "text": text})

        return {"segments": segments, "language": detected_lang}
```

- [ ] **Step 2: Verify import (Mac only; on Windows, expect ImportError for mlx_whisper itself)**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "from backends.mlx_backend import MLXBackend; print('OK')"
```

Expected on Windows: `OK` (the import of MLXBackend works; mlx_whisper itself is only imported at runtime in `transcribe`).

---

### Task 4: Create backends/faster\_whisper\_backend.py

**Files:**
- Create: `skills/audio-transcribe/backends/faster_whisper_backend.py`

- [ ] **Step 1: Write the Faster-Whisper backend**

Write `skills/audio-transcribe/backends/faster_whisper_backend.py`:

```python
"""Windows backend — Faster-Whisper with CUDA auto-detection and CPU fallback."""

from typing import Dict, Optional

from . import TranscriptionBackend

SUPPORTED_MODELS = ["small", "medium", "large-v3"]


class FasterWhisperBackend(TranscriptionBackend):
    def __init__(self):
        self._model = None

    def check_dependencies(self) -> bool:
        try:
            from faster_whisper import WhisperModel  # noqa: F401
            return True
        except ImportError:
            print("faster-whisper not installed. Install: pip install faster-whisper zhconv")
            return False

    def load_model(self, model_name: str) -> None:
        from faster_whisper import WhisperModel

        print(f"Loading Faster-Whisper model ({model_name})...")

        # Try CUDA first, fall back to CPU
        try:
            self._model = WhisperModel(model_name, device="cuda", compute_type="float16")
            print("  Using CUDA GPU acceleration")
        except Exception:
            print("  CUDA not available, using CPU with int8 quantization")
            self._model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def transcribe(self, audio_path: str, language: Optional[str] = None) -> Dict:
        whisper_language = None if language in ("auto", None) else language

        segments_gen, info = self._model.transcribe(
            str(audio_path),
            language=whisper_language,
            beam_size=5,
        )

        # Generator must be consumed — transcription runs here
        raw_segments = list(segments_gen)

        detected_lang = info.language
        print(f"  Detected language: {detected_lang}")

        segments = []
        for seg in raw_segments:
            text = seg.text.strip()
            if text:
                segments.append({"start": seg.start, "end": seg.end, "text": text})

        return {"segments": segments, "language": detected_lang}
```

- [ ] **Step 2: Verify import**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "from backends.faster_whisper_backend import FasterWhisperBackend; print('OK')"
```

Expected on Windows (with faster-whisper installed): `OK`

---

### Task 5: Refactor skill\_main.py to use backend abstraction

**Files:**
- Rewrite: `skills/audio-transcribe/skill_main.py`

**What stays:** `convert_to_simplified_chinese`, `format_timestamp`, `segments_to_srt`, `merge_segments_to_paragraphs`, `segments_to_md` (updated tool name), `transcribe` (uses backend), CLI parser.

**What's removed:** `MODEL_REPOS`, `MODEL_INFO`, `ensure_config`, `load_config`, `check_mlx_whisper`, `check_ffmpeg`, `extract_subtitles` — all moved to backends or no longer needed.

- [ ] **Step 1: Write the refactored skill\_main.py**

Write the complete `skills/audio-transcribe/skill_main.py`:

```python
#!/usr/bin/env python3
"""
Audio Transcriber — cross-platform
Mac: MLX-Whisper (Apple Silicon) | Windows: Faster-Whisper (CUDA / CPU)
"""

import json
import platform
import sys
from pathlib import Path
from typing import List, Dict, Optional

from backends import get_backend

CONFIG_FILE = Path(__file__).parent / "config.json"

DEFAULT_MODEL = "large-v3-turbo" if platform.system() == "Darwin" else "medium"


def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "model": DEFAULT_MODEL,
        "language": "auto",
        "output_format": "md",
        "keep_timestamps": False,
    }


def convert_to_simplified_chinese(text: str) -> str:
    try:
        import zhconv
        return zhconv.convert(text, "zh-cn")
    except ImportError:
        return text


def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    milliseconds = int((secs - int(secs)) * 1000)
    return f"{hours:02d}:{minutes:02d}:{int(secs):02d},{milliseconds:03d}"


def segments_to_srt(segments: List[Dict]) -> str:
    lines = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{format_timestamp(seg['start'])} --> {format_timestamp(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def merge_segments_to_paragraphs(segments: List[Dict], gap_threshold: float = 2.0) -> List[Dict]:
    paragraphs = []
    current_texts = []
    current_start = None
    current_end = None

    for seg in segments:
        if current_end is not None and seg["start"] - current_end >= gap_threshold:
            paragraphs.append(
                {"start": current_start, "end": current_end, "text": "".join(current_texts)}
            )
            current_texts = []
            current_start = None

        if current_start is None:
            current_start = seg["start"]
        current_end = seg["end"]
        current_texts.append(seg["text"])

    if current_texts:
        paragraphs.append(
            {"start": current_start, "end": current_end, "text": "".join(current_texts)}
        )

    return paragraphs


def segments_to_md(
    segments: List[Dict],
    title: str,
    model_size: str,
    language: str,
    keep_timestamps: bool,
    backend_name: str,
) -> str:
    from datetime import datetime

    if not keep_timestamps:
        segments = merge_segments_to_paragraphs(segments)

    md = [f"# {title}\n"]
    md.append("---\n")
    md.append("## Meta\n")
    md.append(f"- **Transcriber**: {backend_name}")
    md.append(f"- **Model**: {model_size}")
    md.append(f"- **Language**: {language}")
    md.append(f"- **Time**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    md.append(f"- **Segments**: {len(segments)}")
    md.append(f"- **Timestamps**: {'kept' if keep_timestamps else 'removed'}")
    md.append("- **Calibration**: uncalibrated (may contain ASR errors)\n")
    md.append("> Suggest using `text-refine` skill for calibration.\n")
    md.append("---\n")

    for seg in segments:
        if keep_timestamps:
            md.append(f"**[{format_timestamp(seg['start'])} - {format_timestamp(seg['end'])}]**\n")
        md.append(f"{seg['text']}\n")
        if keep_timestamps:
            md.append("---\n")

    return "\n".join(md)


def transcribe(
    video_path: Path,
    output_dir: Optional[Path] = None,
    model_size: str = None,
    language: str = "auto",
    output_format: str = "md",
    keep_timestamps: bool = False,
) -> Path:
    if model_size is None:
        model_size = DEFAULT_MODEL

    video_path = Path(video_path).expanduser()
    if not video_path.exists():
        raise FileNotFoundError(f"File not found: {video_path}")

    if output_dir is None:
        output_dir = video_path.parent
    else:
        output_dir = Path(output_dir).expanduser()
    output_dir.mkdir(parents=True, exist_ok=True)

    backend = get_backend()
    backend.load_model(model_size)

    print(f"Transcribing: {video_path.name}")
    result = backend.transcribe(str(video_path), language=language)

    segments = result["segments"]
    detected_lang = result["language"]

    # Apply zhconv for Chinese
    if detected_lang in ("zh", "chinese"):
        for seg in segments:
            seg["text"] = convert_to_simplified_chinese(seg["text"])

    base_name = video_path.stem
    backend_name = type(backend).__name__

    if output_format == "srt":
        output_path = output_dir / f"{base_name}.srt"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(segments_to_srt(segments))
    elif output_format == "md":
        output_path = output_dir / f"{base_name}.md"
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(
                segments_to_md(segments, base_name, model_size, language, keep_timestamps, backend_name)
            )
    elif output_format == "json":
        output_path = output_dir / f"{base_name}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    else:
        raise ValueError(f"Unknown format: {output_format}")

    print(f"  Saved: {output_path}")
    return output_path


if __name__ == "__main__":
    import argparse

    config = load_config()

    parser = argparse.ArgumentParser(
        description="Transcribe audio/video (auto-detect Mac/Windows backend)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skill_main.py video.mp4
  python skill_main.py audio.mp3 --output result.srt
  python skill_main.py video.mp4 --model large-v3 --language zh
  python skill_main.py video.mp4 --format srt
        """,
    )

    parser.add_argument("input", type=str, help="Video or audio file path")
    parser.add_argument("--output", "-o", type=str, help="Output file path")
    parser.add_argument(
        "--model",
        "-m",
        default=config.get("model", DEFAULT_MODEL),
        help=f"Model name (default: {config.get('model', DEFAULT_MODEL)})",
    )
    parser.add_argument(
        "--language",
        "-l",
        type=str,
        default=config.get("language", "auto"),
        help="Language code (auto/zh/en/ko/ja/etc)",
    )
    parser.add_argument(
        "--format",
        "-f",
        choices=["srt", "md", "json"],
        default=config.get("output_format", "md"),
        help="Output format (default: md)",
    )
    parser.add_argument(
        "--keep-timestamps",
        "-t",
        action="store_true",
        default=config.get("keep_timestamps", False),
        help="Keep timestamps in markdown output",
    )

    args = parser.parse_args()

    # Check dependencies via backend
    backend = get_backend()
    if not backend.check_dependencies():
        sys.exit(1)

    output_dir = Path(args.output).parent if args.output else Path(args.input).expanduser().parent

    print(f"\n{'=' * 60}")
    print(f"Audio Transcriber ({'Mac / MLX-Whisper' if platform.system() == 'Darwin' else 'Win / Faster-Whisper'})")
    print(f"{'=' * 60}")
    print(f"  Input: {args.input}")
    print(f"  Model: {args.model}")
    print(f"  Language: {args.language}")
    print(f"  Format: {args.format}")
    print(f"  Timestamps: {'Yes' if args.keep_timestamps else 'No'}")
    print(f"{'=' * 60}\n")

    try:
        output_path = transcribe(
            video_path=args.input,
            output_dir=output_dir,
            model_size=args.model,
            language=args.language,
            output_format=args.format,
            keep_timestamps=args.keep_timestamps,
        )
        print(f"\n{'=' * 60}")
        print(f"Done! Output: {output_path}")
        print(f"{'=' * 60}\n")
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)
```

- [ ] **Step 2: Verify syntax**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "import py_compile; py_compile.compile('skill_main.py', doraise=True); print('Syntax OK')"
```

Expected: `Syntax OK`

- [ ] **Step 3: Verify imports resolve**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "from backends import get_backend; b = get_backend(); print(type(b).__name__)"
```

Expected on Windows: `FasterWhisperBackend`

---

### Task 6: Rewrite SKILL.md for cross-platform support

**Files:**
- Rewrite: `skills/audio-transcribe/SKILL.md`

- [ ] **Step 1: Write the new SKILL.md**

Write the complete `skills/audio-transcribe/SKILL.md`:

```markdown
---

name: audio-transcribe
description: >
  音频/视频转录工具，自动检测平台选择最优后端。
  Mac 使用 MLX-Whisper（Apple Silicon 原生加速），Windows 使用 Faster-Whisper（CUDA GPU 加速 / CPU 回退）。
  当用户要转录、转文字、提取字幕、语音识别、whisper转录、音频转文字、视频转字幕、transcribe 时触发。
  输出 SRT 或 Markdown 格式。每次使用会询问模型和输出格式。
  接受 mp4、mp3、wav、m4a 等常见音视频格式。

---

# Audio Transcribe

音频/视频转录工具，自动检测平台选择最优后端：
- **Mac**：MLX-Whisper（Apple Silicon 原生加速）
- **Windows**：Faster-Whisper（CUDA GPU 加速 / CPU int8 回退）

## 步骤 0：检测平台

运行以下命令检测当前平台：

```bash
python -c "import platform; print(platform.system())"
```

- 结果为 `Darwin` → Mac（使用 MLX-Whisper 后端）
- 结果为 `Windows` → Windows（使用 Faster-Whisper 后端）

记住检测结果，后续步骤根据平台分支。

## 首次依赖检查

根据平台检查依赖，缺少则自动安装（不需要用户干预）：

### Mac (Darwin)

检查方法：
- `python3 -c "import mlx_whisper"` — 失败则执行安装
- `ffmpeg -version` — 失败则执行安装

安装命令：

```bash
pip3 install --break-system-packages mlx-whisper zhconv
brew install ffmpeg
```

> macOS Homebrew Python 有 PEP 668 保护，需要加 `--break-system-packages`。

### Windows

检查方法：
- `python -c "from faster_whisper import WhisperModel"` — 失败则执行安装

安装命令：

```bash
pip install faster-whisper zhconv
```

- 不需要外部 ffmpeg（Faster-Whisper 内置 PyAV 解码）
- CUDA 自动检测：有 NVIDIA GPU → GPU 加速（float16）；无 GPU → CPU（int8 量化）

## 每次使用前的选择

**每次转录前，必须使用 AskUserQuestion 工具询问以下两个问题。不要静默使用默认值或读取 config.json 跳过询问。**

注意：AskUserQuestion 的每个 question 必须包含 `header` 字段。两个问题的 header 分别为 `"模型选择"` 和 `"输出格式"`。

### 1. 模型选择（根据步骤 0 的平台检测结果展示对应选项）

**Mac 模型选项：**

| # | 模型             | 大小     | 速度  | 准确率 | 适合场景           |
|---|----------------|--------|-----|-----|----------------|
| 1 | small          | ~459MB | 快   | 良好  | 快速预览，准确率要求不高   |
| 2 | large-v3-turbo | ~1.5GB | 较快  | 优秀  | **推荐**，速度和质量平衡 |
| 3 | large-v3       | ~2.9GB | 慢   | 最佳  | 最终版，最高准确率      |

**Windows 模型选项：**

| # | 模型     | 大小     | 速度  | 准确率 | 适合场景         |
|---|--------|--------|-----|-----|--------------|
| 1 | small  | ~461MB | 快   | 良好  | 快速预览         |
| 2 | medium | ~1.5GB | 中等  | 优秀  | **推荐**，速度和质量平衡 |
| 3 | large-v3 | ~2.9GB | 慢   | 最佳  | 最高准确率        |

用户选择后通过 `--model` 参数传给脚本。

### 2. 输出格式（所有平台通用）

| # | 格式                 | 说明                                        |
|---|--------------------|-------------------------------------------|
| 1 | **Markdown**       | 纯文本段落（非逐句分行），合并为自然段落，适合阅读和 text-refine 校准 |
| 2 | **SRT**            | 标准字幕格式，带时间轴，适合加载到播放器                      |
| 3 | **Markdown + 时间码** | 每段带时间戳，兼顾可读性和定位，适合回看视频对照                  |

- 用户选择后通过 `--format` 参数传给脚本
- 选 Markdown + 时间码时传 `--format md --keep-timestamps`
- Markdown 格式必须将 Whisper 逐句输出合并为自然段落，不要一行一句

## 使用方法

```bash
# 转录视频（默认 Markdown 格式）
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4

# 指定输出文件
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --output result.srt

# 指定模型
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --model large-v3

# 指定语言
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --language zh

# 输出 SRT 格式
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --format srt

# 保留时间码
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py video.mp4 --keep-timestamps
```

## 命令行参数

| 参数                      | 说明                                | 默认值                      |
| ----------------------- | --------------------------------- | ------------------------ |
| `input`                 | 视频/音频文件路径                         | 必需                       |
| `--output, -o`          | 输出文件路径                            | 同目录，同文件名换后缀              |
| `--model, -m`           | 模型名称                              | large-v3-turbo (Mac) / medium (Win) |
| `--language, -l`        | 语言代码（auto/zh/en/ko/ja 等）          | auto                     |
| `--format, -f`          | 输出格式（srt/md/json）                 | md                       |
| `--keep-timestamps, -t` | Markdown 保留时间码                    | false                    |

## 输出格式

### Markdown（默认）

带元信息头部，段落按时间顺序排列。不带时间码时为纯文本段落，适合阅读和后续校准。

### SRT

标准字幕格式，带时间轴，适合播放器加载。

## 示例

```
用户: 转录这个视频 video.mp4
用户: 把这个音频转成字幕
用户: whisper 转录 audio.mp3，用 SRT 格式
用户: 用 large-v3 模型转录这个文件
```
```

- [ ] **Step 2: Verify YAML frontmatter parses**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "
import yaml
with open('SKILL.md', encoding='utf-8') as f:
    content = f.read()
parts = content.split('---', 2)
meta = yaml.safe_load(parts[1])
print(f'name: {meta[\"name\"]}')
print(f'description length: {len(meta[\"description\"])} chars')
"
```

Expected: `name: audio-transcribe` and a description length > 0.

---

### Task 7: Update all references

**Files:**
- Modify: `.claude-plugin/marketplace.json` — line 19
- Modify: `skills/video-downloader/SKILL.md` — lines 8, 113
- Modify: `skills/text-refine/SKILL.md` — line 208
- Modify: `README.md` — multiple lines

- [ ] **Step 1: Update marketplace.json**

In `.claude-plugin/marketplace.json`, change the skill path:

```
Old: "./skills/mlx-whisper"
New: "./skills/audio-transcribe"
```

Also update the description to reflect cross-platform support:

```
Old: "视频字幕一站式工具：video-downloader (Bilibili/YouTube下载) + mlx-whisper (Apple Silicon转录) + text-refine (Claude校准翻译)"
New: "视频字幕一站式工具：video-downloader (Bilibili/YouTube下载) + audio-transcribe (跨平台转录) + text-refine (Claude校准翻译)"
```

And the metadata description:

```
Old: "视频下载、MLX-Whisper转录、Claude文本校准——一站式视频字幕工作流"
New: "视频下载、跨平台转录、Claude文本校准——一站式视频字幕工作流"
```

- [ ] **Step 2: Update video-downloader/SKILL.md**

In `skills/video-downloader/SKILL.md`, update two references:

Line 8 — description:
```
Old: "只负责视频下载，字幕转录和校准请使用 mlx-whisper 和 text-refine skill。"
New: "只负责视频下载，字幕转录和校准请使用 audio-transcribe 和 text-refine skill。"
```

Lines 112-114 — pipeline section:
```
Old:
1. video-downloader → 下载视频
2. mlx-whisper      → 转录为字幕 (SRT/MD)
3. text-refine      → 校准/翻译字幕

New:
1. video-downloader → 下载视频
2. audio-transcribe → 转录为字幕 (SRT/MD)
3. text-refine      → 校准/翻译字幕
```

- [ ] **Step 3: Update text-refine/SKILL.md**

In `skills/text-refine/SKILL.md`, line 208:
```
Old:
video-downloader → mlx-whisper → text-refine
    下载视频        转录字幕       校准字幕

New:
video-downloader → audio-transcribe → text-refine
    下载视频           转录字幕          校准字幕
```

- [ ] **Step 4: Update README.md**

Apply these changes to `README.md`:

1. Skills table (line 10): `**mlx-whisper** | Apple Silicon 加速音频转录 | /mlx-whisper` → `**audio-transcribe** | 跨平台音频转录 (Mac/Win) | /audio-transcribe`

2. Dependencies section (lines 33-36):
```
Old:
# mlx-whisper
pip3 install --break-system-packages mlx-whisper zhconv
brew install ffmpeg

New:
# audio-transcribe (Mac)
pip3 install --break-system-packages mlx-whisper zhconv
brew install ffmpeg
# audio-transcribe (Windows)
pip install faster-whisper zhconv
```

3. Workflow diagram (lines 47-49):
```
Old:
  ↓ mlx-whisper      → 转录为字幕 (SRT/MD)

New:
  ↓ audio-transcribe → 转录为字幕 (SRT/MD)
```

4. Section header `## mlx-whisper` (line 105) → `## audio-transcribe`

5. Section description (line 107):
```
Old: "音频/视频转录工具，使用 MLX-Whisper（Apple Silicon 原生加速），替代 openai-whisper。"
New: "音频/视频转录工具，自动检测平台选择最优后端：Mac 用 MLX-Whisper，Windows 用 Faster-Whisper + CUDA。"
```

6. Feature list (lines 110-116):
```
Old:
- Apple Silicon GPU 加速，转录速度显著提升

New:
- 自动检测平台：Mac 用 MLX-Whisper，Windows 用 Faster-Whisper
- Windows CUDA GPU 加速 / CPU int8 回退
```

7. Model selection table (lines 122-127): Add a note that Windows models differ:
```
After the Mac model table, add:

> Windows 模型选项：small / medium / large-v3（无 large-v3-turbo）
```

8. All command examples (lines 150-155): replace `mlx-whisper` with `audio-transcribe` in paths:
```
Old: python ${CLAUDE_PLUGIN_ROOT}/skills/mlx-whisper/skill_main.py
New: python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py
```

9. First-use table (line 197):
```
Old: | **mlx-whisper** | 每次运行询问模型和输出格式，自动检查依赖 |
New: | **audio-transcribe** | 每次运行询问模型和输出格式，自动检查依赖 |
```

- [ ] **Step 5: Verify all references updated**

```bash
cd "E:/Claude Code/Video_Toolkit"
grep -r "mlx-whisper" --include="*.md" --include="*.json" .
```

Expected: No results (or only in `docs/superpowers/specs/` which is design history, not runtime code).

---

### Task 8: Verify and commit

- [ ] **Step 1: Verify complete file structure**

```bash
cd "E:/Claude Code/Video_Toolkit"
find skills/audio-transcribe -type f | sort
```

Expected:
```
skills/audio-transcribe/SKILL.md
skills/audio-transcribe/backends/__init__.py
skills/audio-transcribe/backends/faster_whisper_backend.py
skills/audio-transcribe/backends/mlx_backend.py
skills/audio-transcribe/skill_main.py
```

- [ ] **Step 2: Run a dry import test**

```bash
cd "E:/Claude Code/Video_Toolkit/skills/audio-transcribe"
python -c "
from backends import get_backend
from skill_main import load_config, format_timestamp, segments_to_srt
b = get_backend()
print(f'Backend: {type(b).__name__}')
print(f'Config model: {load_config()[\"model\"]}')
print(f'Timestamp: {format_timestamp(3661.5)}')
print('All imports OK')
"
```

Expected on Windows:
```
Backend: FasterWhisperBackend
Config model: medium
Timestamp: 01:01:01,500
All imports OK
```

- [ ] **Step 3: Verify no mlx-whisper references remain in runtime files**

```bash
cd "E:/Claude Code/Video_Toolkit"
grep -r "mlx-whisper" --include="*.md" skills/ .claude-plugin/
```

Expected: No results.

- [ ] **Step 4: Verify git status and commit**

```bash
cd "E:/Claude Code/Video_Toolkit"
git status
```

Expected: All changes staged or visible, including the rename, new files, and modified references.

```bash
cd "E:/Claude Code/Video_Toolkit"
git add skills/audio-transcribe/ .claude-plugin/marketplace.json skills/video-downloader/SKILL.md skills/text-refine/SKILL.md README.md docs/superpowers/
git commit -m "$(cat <<'EOF'
refactor: rename mlx-whisper to audio-transcribe, add Windows/faster-whisper support

- Rename skill directory mlx-whisper → audio-transcribe
- Add multi-file backend architecture (backends/__init__.py, mlx_backend.py, faster_whisper_backend.py)
- Mac: MLX-Whisper (Apple Silicon) unchanged
- Windows: Faster-Whisper with CUDA auto-detect and CPU int8 fallback
- Platform-specific model options in SKILL.md
- Update all references (marketplace.json, video-downloader, text-refine, README)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
