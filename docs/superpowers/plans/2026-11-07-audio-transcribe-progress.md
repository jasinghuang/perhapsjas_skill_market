# audio-transcribe Progress Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 转录过程中每 2 秒输出一行真实进度（百分比 + 当前/总时长），默认开启、可用 `--no-progress` 关闭。

**Architecture:** 新增 `ProgressReporter` 负责节流和格式化；两个 backend 通过 `on_progress(fraction, elapsed, total)` 回调上报真实解码进度——MLX 后端临时包装 `mlx_whisper` 内部的 tqdm 帧计数器（100 帧 = 1 秒），Faster-Whisper 后端遍历 segment 生成器按 `segment.end / info.duration` 上报。`skill_main.transcribe()` 创建 reporter 并接线，CLI 增加开关。

**Tech Stack:** Python 3.9+、mlx-whisper（Mac）、faster-whisper（Windows）、pytest。

**Spec:** `docs/superpowers/specs/2026-11-07-audio-transcribe-progress-design.md`

## Global Constraints

- 不新增第三方依赖。
- 不修改已安装的 `mlx_whisper` 源码；只在本 skill 内适配。
- 进度默认开启；`--no-progress` 关闭。
- 进度行格式固定为 `  {pct:5.1f}%  {elapsed} / {total}`，时钟格式为 `H:MM:SS`（≥1 小时）或 `M:SS`。
- 现有 SRT / Markdown / JSON 输出内容和格式不变。
- 保持 Python 3.9 语法：用 `Optional` / `Callable`，不要用 `X | None`。
- 进度显示绝不能影响转录：回调、tqdm 包装、恢复失败都必须被吞掉。
- 除非用户明确要求，不要 commit / push。
- 验证从仓库路径运行；已安装的插件缓存要等仓库提交、推送并更新插件后才会生效，不在本计划范围内。

## Review Focus

- **`total` 缺失或为 0**：不得除零或崩溃；不打印进度，转录照常完成。
- **`tqdm` 导入/包装失败**（库升级、环境异常）：hook 安装失败时静默回退为无进度，转录照常完成。
- **`--no-progress`**：输出中不出现任何进度行，SRT 内容与开启时一致。
- **回调抛异常**（stdout 关闭、BrokenPipe 等）：异常不得冒泡到转录流程。
- **极短音频 / 0 时长**：`finish()` 不崩溃、不重复打印、不产生除零。

---

### Task 1: ProgressReporter 与时钟格式化

**Files:**
- Create: `plugins/video-toolkit/skills/audio-transcribe/progress.py`
- Create: `plugins/video-toolkit/skills/audio-transcribe/tests/conftest.py`
- Create: `plugins/video-toolkit/skills/audio-transcribe/tests/test_progress.py`

**Interfaces:**
- Produces:
  - `format_clock(seconds: float) -> str`
  - `ProgressReporter(stream=None, clock=None, interval: float = 2.0)`
  - `ProgressReporter.update(fraction: float, elapsed_seconds: float, total_seconds: Optional[float]) -> None`
  - `ProgressReporter.finish() -> None`
- 回调契约（后续任务依赖）：`on_progress(fraction: float, elapsed_seconds: float, total_seconds: float) -> None`

- [ ] **Step 1: 写失败测试**

`tests/conftest.py`：

```python
import sys
from pathlib import Path

# 让 tests/ 能 import 上级目录的 skill 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

`tests/test_progress.py`：

```python
import pytest

from progress import ProgressReporter, format_clock


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_format_clock_under_one_hour():
    assert format_clock(0) == "0:00"
    assert format_clock(150) == "2:30"


def test_format_clock_with_hours():
    assert format_clock(3661) == "1:01:01"


def test_update_prints_percentage_and_clocks(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.421, 553.0, 1325.0)
    out = capsys.readouterr().out
    assert " 42.1%  9:13 / 22:05" in out


def test_first_update_prints_even_at_zero(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.0, 0.0, 10.0)
    assert "  0.0%  0:00 / 0:10" in capsys.readouterr().out


def test_updates_are_throttled(capsys):
    clock = FakeClock()
    reporter = ProgressReporter(stream=None, clock=clock, interval=2.0)
    reporter.update(0.10, 10.0, 100.0)
    reporter.update(0.20, 20.0, 100.0)
    clock.now = 2.1
    reporter.update(0.30, 30.0, 100.0)
    out = capsys.readouterr().out
    assert out.count("%") == 2
    assert "10.0%" in out
    assert "30.0%" in out


def test_finish_prints_100_percent(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.5, 50.0, 100.0)
    reporter.finish()
    out = capsys.readouterr().out
    assert "100.0%  1:40 / 1:40" in out


def test_finish_does_not_duplicate_100_percent(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(1.0, 100.0, 100.0)
    reporter.finish()
    assert capsys.readouterr().out.count("100.0%") == 1


@pytest.mark.parametrize("total", [None, 0, 0.0])
def test_unknown_or_zero_total_prints_nothing(capsys, total):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.5, 50.0, total)
    reporter.finish()
    assert capsys.readouterr().out == ""
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_progress.py -v
```

Expected: FAIL / collection error，`ModuleNotFoundError: No module named 'progress'`。

- [ ] **Step 3: 实现 `progress.py`**

要点：

- `format_clock` 把秒向下取整；`h > 0` 时输出 `h:MM:SS`，否则 `M:SS`。
- `ProgressReporter.__init__` 保存 `stream`（`None` 时在构造时解析为 `sys.stdout`）、`clock`（`None` 时为 `time.monotonic`）、`interval`。
- `update`：
  - `total` 为 `None` 或 `<= 0` → 直接返回（不打印）。
  - `fraction` 夹到 `[0, 1]`。
  - 首次调用、距上次打印 ≥ `interval`、或 `fraction >= 1.0` 时打印一行并记录本次时间与 fraction。
  - 行格式：`f"  {fraction * 100:5.1f}%  {format_clock(elapsed)} / {format_clock(total)}"`。
- `finish`：若最后打印的 fraction 已 ≥ 1.0 或 total 未知 → 不打印；否则用 `elapsed = total` 强制打印 100% 行。
- 所有输出带 `flush=True`。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_progress.py -v
```

Expected: 全部 PASS。

---

### Task 2: MLX 后端真实帧进度

**Files:**
- Modify: `plugins/video-toolkit/skills/audio-transcribe/backends/mlx_backend.py`
- Test: `plugins/video-toolkit/skills/audio-transcribe/tests/test_mlx_progress.py`

**Interfaces:**
- Consumes: Task 1 的回调契约 `on_progress(fraction, elapsed_seconds, total_seconds)`。
- Produces:
  - `_ProgressTqdm(total, callback)`
  - `_install_progress_hook(callback) -> object`（返回原始 `tqdm.tqdm`）
  - `_restore_progress_hook(original) -> None`
  - `MLXBackend.transcribe(audio_path: str, language: Optional[str] = None, on_progress: Optional[Callable[[float, float, float], None]] = None) -> Dict`

- [ ] **Step 1: 写失败测试**

`tests/test_mlx_progress.py`：

```python
import sys

import tqdm

from backends.mlx_backend import (
    _ProgressTqdm,
    _install_progress_hook,
    _restore_progress_hook,
)


def test_proxy_reports_fraction_elapsed_and_total():
    seen = []
    bar = _ProgressTqdm(total=1000, callback=lambda f, e, t: seen.append((f, e, t)))
    bar.update(250)
    bar.update(250)
    assert seen == [(0.0, 0.0, 10.0), (0.25, 2.5, 10.0), (0.5, 5.0, 10.0)]


def test_proxy_ignores_unknown_total():
    seen = []
    bar = _ProgressTqdm(total=None, callback=lambda f, e, t: seen.append((f, e, t)))
    bar.update(10)
    assert seen == []


def test_proxy_swallows_callback_errors():
    def boom(*args):
        raise RuntimeError("boom")

    bar = _ProgressTqdm(total=100, callback=boom)
    bar.update(50)  # must not raise


def test_hook_replaces_and_restores_tqdm():
    original = tqdm.tqdm
    seen = []
    restore = _install_progress_hook(lambda f, e, t: seen.append((f, e, t)))
    assert tqdm.tqdm is not original
    with tqdm.tqdm(total=100) as bar:
        bar.update(50)
    _restore_progress_hook(restore)
    assert tqdm.tqdm is original
    assert seen == [(0.0, 0.0, 1.0), (0.5, 0.5, 1.0)]


def test_transcribe_survives_hook_install_failure(monkeypatch):
    class FakeWhisper:
        @staticmethod
        def transcribe(path, **kwargs):
            return {
                "language": "en",
                "segments": [{"start": 0.0, "end": 1.0, "text": " hi"}],
            }

    monkeypatch.setitem(sys.modules, "mlx_whisper", FakeWhisper)
    monkeypatch.setitem(sys.modules, "tqdm", None)  # import tqdm -> ImportError

    from backends.mlx_backend import MLXBackend

    backend = MLXBackend()
    backend._repo = "fake"
    result = backend.transcribe("x.mp4", on_progress=lambda *args: None)
    assert result["segments"][0]["text"] == "hi"
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_mlx_progress.py -v
```

Expected: FAIL，`ImportError` / `AttributeError`（`_ProgressTqdm` 等不存在）。

- [ ] **Step 3: 实现 MLX 进度适配**

要点：

- `_ProgressTqdm.__init__(total, callback)`：
  - `self.total = total or 0`，`self.n = 0`，`self._total_seconds = self.total / 100.0`（库内 HOP_LENGTH=160、SAMPLE_RATE=16000，即 100 帧/秒）。
  - total 有效时先 `_emit(0.0, 0.0)`。
- `_emit(fraction, elapsed)`：`try: callback(...)` / `except Exception: pass`。
- `update(n=1)`：累加 `n`；total 有效时 `_emit(min(n/total, 1.0), min(n/100.0, total_seconds))`。
- `__enter__` 返回 self，`__exit__` 返回 `False`。
- `_install_progress_hook(callback)`：
  - `import tqdm as tqdm_module`；保存 `original = tqdm_module.tqdm`。
  - 用工厂函数替换 `tqdm_module.tqdm`：从 kwargs 或第一个位置参数取 `total`，返回 `_ProgressTqdm(total, callback)`。
  - 返回 `original`。
- `_restore_progress_hook(original)`：重新 `import tqdm` 并赋回。
- `MLXBackend.transcribe` 增加 `on_progress` 参数：
  - `original = None`；`on_progress` 非空时 `try: original = _install_progress_hook(on_progress)` / `except Exception: original = None`。
  - `try: result = mlx_whisper.transcribe(...)`；`finally:` 若 original 非空则 `try: _restore_progress_hook(original)` / `except Exception: pass`。
  - 其余逻辑（语言检测、segment 清洗）不变。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_mlx_progress.py tests/test_progress.py -v
```

Expected: 全部 PASS。

---

### Task 3: Faster-Whisper 后端逐段进度

**Files:**
- Modify: `plugins/video-toolkit/skills/audio-transcribe/backends/faster_whisper_backend.py`
- Test: `plugins/video-toolkit/skills/audio-transcribe/tests/test_faster_whisper_progress.py`

**Interfaces:**
- Consumes: Task 1 的回调契约。
- Produces: `FasterWhisperBackend.transcribe(audio_path: str, language: Optional[str] = None, on_progress: Optional[Callable[[float, float, float], None]] = None) -> Dict`

- [ ] **Step 1: 写失败测试**

`tests/test_faster_whisper_progress.py`：

```python
from types import SimpleNamespace

from backends.faster_whisper_backend import FasterWhisperBackend


class FakeModel:
    def transcribe(self, path, language=None, beam_size=5):
        segments = iter([
            SimpleNamespace(start=0.0, end=2.0, text=" hello"),
            SimpleNamespace(start=2.0, end=4.0, text=" world"),
        ])
        return segments, SimpleNamespace(language="en", duration=4.0)


def test_reports_progress_per_segment():
    backend = FasterWhisperBackend()
    backend._model = FakeModel()
    seen = []
    result = backend.transcribe("x.mp4", on_progress=lambda f, e, t: seen.append((f, e, t)))
    assert seen == [(0.5, 2.0, 4.0), (1.0, 4.0, 4.0)]
    assert [s["text"] for s in result["segments"]] == ["hello", "world"]


def test_callback_error_does_not_break_transcription():
    backend = FasterWhisperBackend()
    backend._model = FakeModel()

    def boom(*args):
        raise RuntimeError("boom")

    result = backend.transcribe("x.mp4", on_progress=boom)
    assert len(result["segments"]) == 2
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_faster_whisper_progress.py -v
```

Expected: FAIL，`TypeError: transcribe() got an unexpected keyword argument 'on_progress'`。

- [ ] **Step 3: 实现逐段进度**

要点：

- `transcribe` 增加 `on_progress` 参数。
- `duration = getattr(info, "duration", None)`。
- 把 `raw_segments = list(segments_gen)` 改为循环消费生成器，逐段追加到 `raw_segments`；每段之后若 `on_progress` 且 `duration` 有效，`try: on_progress(min(seg.end / duration, 1.0), seg.end, duration)` / `except Exception: pass`。
- 其余清清洗逻辑不变。

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_faster_whisper_progress.py -v
```

Expected: 全部 PASS。

---

### Task 4: skill_main 接线与 `--no-progress`

**Files:**
- Modify: `plugins/video-toolkit/skills/audio-transcribe/skill_main.py:124-188`（`transcribe` 函数）和 `:191-244`（argparse）
- Modify: `plugins/video-toolkit/skills/audio-transcribe/backends/__init__.py:7-21`（ABC 签名）
- Test: `plugins/video-toolkit/skills/audio-transcribe/tests/test_transcribe_progress.py`

**Interfaces:**
- Consumes: Task 1 的 `ProgressReporter`；Task 2/3 的 `on_progress` 参数。
- Produces: `skill_main.transcribe(..., show_progress: bool = True) -> Path`

- [ ] **Step 1: 写失败测试**

`tests/test_transcribe_progress.py`：

```python
import skill_main


class FakeBackend:
    def __init__(self):
        self.on_progress = "unset"

    def load_model(self, model_name):
        pass

    def transcribe(self, audio_path, language=None, on_progress=None):
        self.on_progress = on_progress
        if on_progress:
            on_progress(0.5, 5.0, 10.0)
        return {"segments": [{"start": 0.0, "end": 1.0, "text": "hi"}], "language": "en"}


def _run(tmp_path, monkeypatch, show_progress):
    backend = FakeBackend()
    monkeypatch.setattr(skill_main, "get_backend", lambda: backend)
    video = tmp_path / "a.mp4"
    video.write_bytes(b"")
    output = tmp_path / "a.srt"
    skill_main.transcribe(
        video_path=video,
        output_path=output,
        show_progress=show_progress,
    )
    return backend, output


def test_progress_callback_is_wired(tmp_path, monkeypatch, capsys):
    backend, output = _run(tmp_path, monkeypatch, True)
    assert callable(backend.on_progress)
    out = capsys.readouterr().out
    assert "50.0%  0:05 / 0:10" in out
    assert output.exists()


def test_no_progress_disables_callback(tmp_path, monkeypatch, capsys):
    backend, output = _run(tmp_path, monkeypatch, False)
    assert backend.on_progress is None
    assert "%" not in capsys.readouterr().out
    assert output.exists()
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/test_transcribe_progress.py -v
```

Expected: FAIL，`TypeError: transcribe() got an unexpected keyword argument 'show_progress'`。

- [ ] **Step 3: 实现接线**

要点：

- `skill_main.py` 顶部 `from progress import ProgressReporter`。
- `transcribe(...)` 增加 `show_progress: bool = True` 参数。
- 在 `backend = get_backend()` 后创建 `reporter = ProgressReporter() if show_progress else None`。
- 调用改为 `backend.transcribe(str(video_path), language=language, on_progress=reporter.update if reporter else None)`。
- 在 `backend.transcribe(...)` 返回后**立即**调用 `reporter.finish()`（若 reporter 非空），再处理 `result["segments"]`。
- 文件头保持现有 `[i/N] 文件名`；总时长由 backend 的首行进度立即给出（MLX 在初始化时回调 0.0，Faster-Whisper 在第一段结束后给出），不额外调用 ffprobe。
- argparse 增加：

```python
parser.add_argument(
    "--no-progress",
    action="store_true",
    help="Disable live transcription progress lines",
)
```

- 调用 `transcribe(...)` 时传 `show_progress=not args.no_progress`。
- `backends/__init__.py`：`from typing import Callable, Dict, Optional`；抽象方法签名改为
  `def transcribe(self, audio_path: str, language: Optional[str] = None, on_progress: Optional[Callable[[float, float, float], None]] = None) -> Dict:`

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 -m pytest tests/ -v
```

Expected: 全部 PASS（Task 1–4 的所有测试）。

---

### Task 5: 文档与冒烟验证

**Files:**
- Modify: `plugins/video-toolkit/skills/audio-transcribe/SKILL.md`（参数表、推荐用法）

**Interfaces:**
- 无新增代码接口；验证前四个任务的组合行为。

- [ ] **Step 1: 更新 SKILL.md**

- 在参数表中 `--keep-timestamps` 之后新增一行：

```markdown
| `--no-progress` | 关闭实时转录进度输出 | 进度开启 |
```

- 在「推荐用法」中新增一条：

```markdown
- **进度显示**：转录时默认每 ~2 秒打印一行 `42.1% 12:30 / 29:13`；重定向到日志时同样可见。`--no-progress` 可关闭。
```

- [ ] **Step 2: 生成 5 秒测试音频**

Run:

```bash
SMOKE=/tmp/audio-transcribe-smoke
mkdir -p "$SMOKE"
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=5" -ar 16000 "$SMOKE/tone.wav" >/dev/null 2>&1
ls -l "$SMOKE/tone.wav"
```

Expected: 命令退出码 0，`/tmp/audio-transcribe-smoke/tone.wav` 存在。

- [ ] **Step 3: 冒烟验证进度输出**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 run.py /tmp/audio-transcribe-smoke/tone.wav --model large-v3-turbo --format srt 2>&1 | tee /tmp/audio-progress-smoke.log
grep -E "[0-9]+\.[0-9]%  [0-9]+:[0-9]{2} / [0-9]+:[0-9]{2}" /tmp/audio-progress-smoke.log
```

Expected: 至少匹配到一行进度（例如 `0.0%  0:00 / 0:05` 和 `100.0%  0:05 / 0:05`），并生成 `.srt`。

- [ ] **Step 4: 冒烟验证 `--no-progress`**

Run:

```bash
cd /Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/audio-transcribe
/opt/homebrew/bin/python3.14 run.py /tmp/audio-transcribe-smoke/tone.wav --model large-v3-turbo --format srt --no-progress 2>&1 | grep -Ec "[0-9]+\.[0-9]%  [0-9]+:[0-9]{2} / [0-9]+:[0-9]{2}"
```

Expected: 输出 `0`。

- [ ] **Step 5: 清理临时文件**

Run:

```bash
rm -rf /tmp/audio-transcribe-smoke /tmp/audio-progress-smoke.log
```

Expected: 临时目录和日志被删除。
