#!/usr/bin/env python3
"""video-tts single-file runner.

This file is the executable template embedded verbatim in SKILL.md.  Stage 0
uses only the Python standard library so it can start on a bare system
interpreter, inspect the machine, validate task.json, and bootstrap a dedicated
user-local virtual environment.  Only after the selected route is available are
numpy/soundfile/the TTS backend imported.

Public entry points (nothing else is a task entry point):

    python runner.py --task task.json
    python runner.py --check --task task.json
    python runner.py --detect
    python runner.py --list-voices --provider local|elevenlabs

Exit codes:
    0  completed
    1  runtime failure (completed segments are kept for a retry)
    2  invalid task or input
    3  a user decision is required (overflow / polish / video length / clone)

The file is intentionally larger than the 200-300 line "core loop" target:
it also owns cross-platform bootstrap, Hugging Face download progress, the
three backends, online clone reuse, time fitting, track assembly, muxing and
output verification.  Those branches are kept explicit and readable rather
than compressed into a one-file trick.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as _dt
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1
EXIT_OK = 0
EXIT_FAIL = 1
EXIT_INVALID = 2
EXIT_ACTION = 3

SAMPLE_RATE = 48000
AUDIO_FORMAT = "wav"

MLX_PRESET_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"
MLX_CLONE_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
TORCH_PRESET_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
TORCH_CLONE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
ONLINE_MODELS = ("eleven_multilingual_v2", "eleven_flash_v2_5")

EXPECTED_MODELS = {
    ("mlx_audio", "preset"): MLX_PRESET_MODEL,
    ("mlx_audio", "clone"): MLX_CLONE_MODEL,
    ("qwen_tts", "preset"): TORCH_PRESET_MODEL,
    ("qwen_tts", "clone"): TORCH_CLONE_MODEL,
}

LANGUAGE_ALIASES = {
    "auto": "auto",
    "zh": "chinese",
    "zh-cn": "chinese",
    "zh-hans": "chinese",
    "chinese": "chinese",
    "mandarin": "chinese",
    "en": "english",
    "en-us": "english",
    "english": "english",
    "ja": "japanese",
    "jp": "japanese",
    "japanese": "japanese",
    "ko": "korean",
    "korean": "korean",
    "de": "german",
    "german": "german",
    "fr": "french",
    "french": "french",
    "ru": "russian",
    "russian": "russian",
    "pt": "portuguese",
    "portuguese": "portuguese",
    "es": "spanish",
    "spanish": "spanish",
    "it": "italian",
    "italian": "italian",
    "beijing_dialect": "beijing_dialect",
    "sichuan_dialect": "sichuan_dialect",
}
LANGUAGE_ISO = {
    "chinese": "zh",
    "english": "en",
    "japanese": "ja",
    "korean": "ko",
    "german": "de",
    "french": "fr",
    "russian": "ru",
    "portuguese": "pt",
    "spanish": "es",
    "italian": "it",
}
LOCAL_LANGUAGES = (
    "auto",
    "chinese",
    "english",
    "japanese",
    "korean",
    "german",
    "french",
    "russian",
    "portuguese",
    "spanish",
    "italian",
    "beijing_dialect",
    "sichuan_dialect",
)

LOCAL_VOICES = [
    {"speaker": "serena", "name": "Serena", "gender": "女", "description": "温暖、温柔的年轻女声"},
    {"speaker": "vivian", "name": "Vivian", "gender": "女", "description": "明亮、略带锋利感的年轻女声"},
    {"speaker": "uncle_fu", "name": "Uncle_Fu", "gender": "男", "description": "低沉醇厚的成熟男声"},
    {"speaker": "ryan", "name": "Ryan", "gender": "男", "description": "节奏感强的男声"},
    {"speaker": "aiden", "name": "Aiden", "gender": "男", "description": "阳光美式男声，中频清晰"},
    {"speaker": "ono_anna", "name": "Ono_Anna", "gender": "女", "description": "活泼轻盈的日语女声"},
    {"speaker": "sohee", "name": "Sohee", "gender": "女", "description": "温暖、情感丰富的韩语女声"},
    {"speaker": "eric", "name": "Eric", "gender": "男", "description": "活泼成都男声，略带沙哑亮度"},
    {"speaker": "dylan", "name": "Dylan", "gender": "男", "description": "年轻北京男声，清晰自然"},
]

ONLINE_OUTPUT_FORMATS = (
    "mp3_22050_32",
    "mp3_24000_48",
    "mp3_44100_32",
    "mp3_44100_64",
    "mp3_44100_96",
    "mp3_44100_128",
    "mp3_44100_192",
    "wav_16000",
    "wav_22050",
    "wav_24000",
    "wav_32000",
    "wav_44100",
    "wav_48000",
)

LOCAL_PARAMS = {"instruct"}
TORCH_PARAMS = {"instruct"}
ONLINE_PARAMS = {
    "voice_settings",
    "output_format",
    "remove_background_noise",
}

TIMING_KEYS = {"max_speed", "safety_gap_sec", "pause_between_sec"}
POLISH_KEYS = {"attempt", "max_attempts"}
VOICE_KEYS = {"source", "speaker", "voice_id", "reference_audio", "reference_text", "name"}
INPUT_KEYS = {"srt", "video"}
OUTPUT_KEYS = {
    "directory",
    "deliver",
    "audio_format",
    "sample_rate",
    "overwrite",
}
SEGMENT_KEYS = {"id", "text", "start_sec", "end_sec", "source_indices", "original_text"}
TASK_KEYS = {
    "schema_version",
    "mode",
    "provider",
    "backend",
    "model_id",
    "language",
    "voice",
    "parameters",
    "timing",
    "allow_text_edits",
    "polish",
    "input",
    "output",
    "segments",
}

IO_CHUNK_SAMPLES = 1 << 18
RETRY_ATTEMPTS = 3
RETRY_DELAYS = (1.0, 2.0)
# atempo/sample rounding may leave a few milliseconds; the alignment builder
# and mux verifier already tolerate this amount.
FIT_TOLERANCE = 0.005

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
FFMPEG_VERSION = ""
FFPROBE_VERSION = ""

_NP = None
_SF = None


# ---------------------------------------------------------------------------
# Logging, errors, small utilities
# ---------------------------------------------------------------------------


def log(stage: str, message: str) -> None:
    print(f"[{stage}] {message}", flush=True)


def warn(message: str) -> None:
    print(f"[warning] {message}", flush=True)


class RunnerError(Exception):
    """A stage failure with a machine-readable classification."""

    def __init__(
        self,
        message: str,
        *,
        stage: str = "run",
        exit_code: int = EXIT_FAIL,
        retryable: bool = False,
        retry_after: Optional[float] = None,
        submission_unknown: bool = False,
        segment_id: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.stage = stage
        self.exit_code = exit_code
        self.retryable = retryable
        self.retry_after = retry_after
        self.submission_unknown = submission_unknown
        self.segment_id = segment_id
        self.details = details or {}

    def payload(self, status: Optional[str] = None) -> Dict[str, Any]:
        return {
            "status": status,
            "stage": self.stage,
            "message": self.message,
            "exit_code": self.exit_code,
            "retryable": self.retryable,
            "submission_unknown": self.submission_unknown,
            "segment_id": self.segment_id,
            "details": self.details,
        }


class TaskError(RunnerError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("stage", "task")
        kwargs.setdefault("exit_code", EXIT_INVALID)
        super().__init__(message, **kwargs)


class SetupError(RunnerError):
    def __init__(self, message: str, **kwargs: Any) -> None:
        kwargs.setdefault("stage", "setup")
        kwargs.setdefault("exit_code", EXIT_FAIL)
        super().__init__(message, **kwargs)


class ActionRequired(RunnerError):
    def __init__(self, message: str, *, status: str = "needs_action", **kwargs: Any) -> None:
        kwargs.setdefault("stage", "action")
        kwargs.setdefault("exit_code", EXIT_ACTION)
        super().__init__(message, **kwargs)
        self.status = status


class Heartbeat:
    """Print the current stage and elapsed time every 10 seconds."""

    def __init__(self, stage: str, detail: str = "", interval: float = 10.0) -> None:
        self.stage = stage
        self.detail = detail
        self.interval = interval
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._started = 0.0

    def __enter__(self) -> "Heartbeat":
        self._started = time.monotonic()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        return self

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            elapsed = time.monotonic() - self._started
            suffix = f" {self.detail}" if self.detail else ""
            print(
                f"[heartbeat] {self.stage}{suffix}; elapsed {elapsed:.0f}s",
                file=sys.stderr,
                flush=True,
            )

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            block = handle.read(chunk_size)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def atomic_write_text(path: Path, text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    os.close(fd)
    try:
        with open(tmp_name, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp_name, path)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json_dumps(data))


def _unlink_quietly(path: Any) -> None:
    if path is None:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def _np():
    global _NP
    if _NP is None:
        import numpy as _numpy

        _NP = _numpy
    return _NP


def _sf():
    global _SF
    if _SF is None:
        import soundfile as _soundfile

        _SF = _soundfile
    return _SF


def _decode_bytes(raw: Optional[bytes]) -> str:
    if not raw:
        return ""
    return raw.decode("utf-8", errors="replace")


def _reject_json_constant(value: str) -> Any:
    raise ValueError(f"invalid JSON constant: {value}")


def _read_json(path: Path) -> Any:
    text = Path(path).read_text(encoding="utf-8-sig")
    return json.loads(text, parse_constant=_reject_json_constant)


# ---------------------------------------------------------------------------
# Paths and environment bootstrap
# ---------------------------------------------------------------------------


def app_envs_root() -> Path:
    override = os.environ.get("VIDEO_TTS_ENV_DIR")
    if override:
        return Path(override).expanduser()
    system = platform.system()
    if system == "Windows":
        base = Path(
            os.environ.get("LOCALAPPDATA")
            or (Path.home() / "AppData" / "Local")
        )
        return base / "video-toolkit" / "envs"
    if system == "Darwin":
        return Path.home() / "Library" / "Caches" / "video-toolkit" / "envs"
    base = os.environ.get("XDG_CACHE_HOME")
    root = Path(base).expanduser() if base else Path.home() / ".cache"
    return root / "video-toolkit" / "envs"


def venv_dir(route: str) -> Path:
    return app_envs_root() / f"video-tts-{route}"


def venv_python(route: str) -> Path:
    root = venv_dir(route)
    if platform.system() == "Windows":
        return root / "Scripts" / "python.exe"
    return root / "bin" / "python"


def _real(path: str) -> str:
    try:
        return os.path.realpath(path)
    except OSError:
        return path


def _same_executable(left: str, right: str) -> bool:
    # Do not use realpath here: a venv python is a symlink to its base
    # interpreter, but running the venv path activates the venv while running
    # the base path does not.
    return os.path.normcase(os.path.abspath(left)) == os.path.normcase(
        os.path.abspath(right)
    )


def candidate_interpreters(route: str) -> List[str]:
    found: List[str] = []
    seen: set = set()

    def add(value: Optional[Any]) -> None:
        if not value:
            return
        # Keep the invoked path, not its realpath: a venv python is a symlink
        # to its base interpreter and must stay distinct so that its venv
        # site-packages are used.
        path = os.path.abspath(os.path.expanduser(str(value)))
        if path in seen:
            return
        if not os.path.isfile(path) or not os.access(path, os.X_OK):
            return
        seen.add(path)
        found.append(path)

    # Deliberately small: explicit override, dedicated venv, current
    # interpreter, then PATH.  Broadly scanning Homebrew/pyenv/Program Files
    # made behavior unpredictable and could silently pick an unrelated env.
    add(os.environ.get("VIDEO_TTS_PYTHON"))
    add(str(venv_python(route)))
    add(sys.executable)
    add(shutil.which("python3"))
    add(shutil.which("python"))
    return found


def run_probe(python: str, code: str, timeout: float = 60.0) -> Optional[subprocess.CompletedProcess]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        return subprocess.run(
            [python, "-c", code],
            capture_output=True,
            timeout=timeout,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


def python_version(python: str) -> Optional[Tuple[int, int, int]]:
    result = run_probe(
        python,
        "import sys;print('%d.%d.%d' % sys.version_info[:3])",
        timeout=15,
    )
    if result is None or result.returncode != 0:
        return None
    try:
        parts = _decode_bytes(result.stdout).strip().split(".")
        return int(parts[0]), int(parts[1]), int(parts[2])
    except (ValueError, IndexError):
        return None


def has_imports(python: str, names: Sequence[str], timeout: float = 60.0) -> bool:
    code = "import " + ", ".join(names)
    result = run_probe(python, code, timeout)
    return result is not None and result.returncode == 0


def route_imports(route: str) -> List[str]:
    if route == "mlx":
        return ["numpy", "soundfile", "mlx.core", "mlx_audio"]
    if route == "torch":
        return ["numpy", "soundfile", "torch", "qwen_tts"]
    return ["numpy", "soundfile", "requests"]


MLX_CAPABILITY = (
    "import platform;"
    "assert platform.machine().lower() in ('arm64','aarch64'), "
    "'arch=' + platform.machine();"
    "import mlx.core as mx;"
    "assert mx.metal.is_available(), 'metal unavailable';"
    "from mlx_audio.tts.utils import load_model;"
    "print('ok')"
)

TORCH_CAPABILITY = (
    "import platform;"
    "assert platform.machine().lower() in ('amd64','x86_64'), "
    "'arch=' + platform.machine();"
    "import torch;"
    "assert torch.cuda.is_available(), 'cuda unavailable';"
    "x=(torch.ones(8, device='cuda') * 2).sum().item();"
    "assert x == 16.0, 'cuda tensor op failed';"
    "from qwen_tts import Qwen3TTSModel;"
    "print('ok')"
)


def capability_problems(python: str, route: str, timeout: float = 60.0) -> List[str]:
    if route == "online":
        return []
    code = MLX_CAPABILITY if route == "mlx" else TORCH_CAPABILITY
    result = run_probe(python, code, timeout)
    if result is None:
        return [f"{python}: capability probe failed or timed out"]
    if result.returncode == 0:
        return []
    detail = _decode_bytes(result.stderr).strip().splitlines()
    last = detail[-1] if detail else f"exit {result.returncode}"
    if "arch=" in last:
        return [f"{python}: wrong architecture ({last})"]
    if "metal unavailable" in last:
        return [f"{python}: Metal is unavailable"]
    if "cuda unavailable" in last:
        return [f"{python}: torch.cuda is unavailable"]
    if "cuda tensor op failed" in last:
        return [f"{python}: CUDA tensor operation failed"]
    return [f"{python}: capability probe failed ({last})"]


def find_working_interpreter(
    route: str, timeout: float = 60.0
) -> Tuple[Optional[str], List[str]]:
    problems: List[str] = []
    for python in candidate_interpreters(route):
        if not has_imports(python, route_imports(route), timeout):
            problems.append(f"{python}: required imports are missing")
            continue
        caps = capability_problems(python, route, timeout)
        if caps:
            problems.extend(caps)
            continue
        return python, problems
    return None, problems


def interpreter_ok(python: str, route: str) -> bool:
    if not has_imports(python, route_imports(route), timeout=30):
        return False
    return not capability_problems(python, route, timeout=60)


def base_python_for_venv() -> str:
    candidates = [sys.executable] + candidate_interpreters("online")
    for candidate in candidates:
        version = python_version(candidate)
        if version is None or version < (3, 9):
            continue
        result = run_probe(candidate, "import venv;print('ok')", timeout=15)
        if result is not None and result.returncode == 0:
            return candidate
    raise SetupError(
        "No Python 3.9+ with the venv module was found. Install Python 3 first "
        "(macOS: brew install python; Windows: winget install Python.Python.3)."
    )


def _installer_prefix(python: str) -> List[str]:
    uv = shutil.which("uv")
    if uv:
        return [uv, "pip", "install", "--python", python]
    return [python, "-m", "pip", "install", "--disable-pip-version-check", "--no-input"]


def nvidia_smi_info() -> Dict[str, Any]:
    """Return whether nvidia-smi exists, is usable, and its CUDA version."""
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {
            "present": False,
            "usable": False,
            "cuda_version": None,
            "reason": f"nvidia-smi is unavailable: {exc}",
        }
    output = _decode_bytes(result.stdout) + "\n" + _decode_bytes(result.stderr)
    if result.returncode != 0:
        return {
            "present": True,
            "usable": False,
            "cuda_version": None,
            "reason": f"nvidia-smi failed (exit {result.returncode}): {output.strip()[:300]}",
        }
    if re.search(r"No devices were found|no NVIDIA GPU|not found", output, re.IGNORECASE):
        return {
            "present": True,
            "usable": False,
            "cuda_version": None,
            "reason": "nvidia-smi reported no usable NVIDIA GPU.",
        }
    match = re.search(r"CUDA(?:\s+UMD)?\s+Version:\s*(\d+)\.(\d+)", output)
    version = (int(match.group(1)), int(match.group(2))) if match else None
    return {
        "present": True,
        "usable": True,
        "cuda_version": version,
        "reason": "",
    }


def driver_cuda_version() -> Optional[Tuple[int, int]]:
    info = nvidia_smi_info()
    return info.get("cuda_version") if info.get("usable") else None


def driver_cuda_index() -> Optional[str]:
    version = driver_cuda_version()
    if version is None:
        return None
    major, minor = version
    if major >= 13:
        return "cu130"
    if major == 12 and minor >= 8:
        return "cu128"
    if major == 12:
        # torch 2.10.0 ships cu126/cu128/cu130 (no cu124).  CUDA minor-version
        # compatibility lets a cu126 wheel run on a 12.0-12.7 driver.
        return "cu126"
    return None


def _run_install(args: List[str], stage_detail: str) -> None:
    log("setup", stage_detail)
    try:
        with Heartbeat("setup", stage_detail):
            subprocess.run(args, check=True)
    except subprocess.CalledProcessError as exc:
        raise SetupError(
            f"dependency installation failed (exit {exc.returncode}). "
            "Fix the install error above and retry; the dedicated environment "
            "was kept for inspection."
        ) from exc


def install_route(route: str, python: str) -> None:
    base = [
        "numpy>=1.26,<3",
        "soundfile>=0.12,<1",
    ]
    if route == "torch":
        info = nvidia_smi_info()
        index = driver_cuda_index()
        if index is None:
            detail = info.get("reason") or "unknown driver CUDA version"
            raise SetupError(
                f"Could not choose a supported CUDA torch build: {detail}. "
                "torch 2.10.0 provides cu126/cu128/cu130; update the NVIDIA "
                "driver to CUDA 12.6+ (or use the ElevenLabs route)."
            )
        version = info.get("cuda_version")
        if version is not None and version < (12, 6):
            log(
                "setup",
                f"Driver reports CUDA {version[0]}.{version[1]}; using cu126 via "
                "CUDA minor-version compatibility. If installation or CUDA "
                "verification fails, update the NVIDIA driver.",
            )
        _run_install(
            _installer_prefix(python)
            + [
                "torch==2.10.0",
                "torchaudio==2.10.0",
                "--index-url",
                f"https://download.pytorch.org/whl/{index}",
            ],
            f"installing CUDA torch ({index})",
        )
        packages = base + [
            "huggingface_hub>=0.25,<3",
            "qwen-tts==0.1.1",
            "transformers==4.57.3",
            "accelerate==1.12.0",
        ]
    elif route == "mlx":
        packages = base + [
            "huggingface_hub>=0.25,<3",
            "mlx-audio==0.6.4",
        ]
    else:
        packages = base + ["requests>=2.31,<3"]

    _run_install(
        _installer_prefix(python) + packages,
        f"installing {route} dependencies into the isolated environment",
    )


def ensure_environment(route: str, allow_install: bool = True) -> str:
    log("setup", f"Checking existing environments for route: {route}")
    with Heartbeat("setup", f"checking {route} environment"):
        python, problems = find_working_interpreter(route)
    if python is not None:
        log("setup", f"Using existing environment: {python}")
        return python
    if not allow_install:
        raise SetupError(
            "The selected route is not ready and automatic installation is disabled.\n"
            + ("\n".join(problems[:5]) if problems else "No usable interpreter found.")
        )

    system = platform.system()
    machine = platform.machine().lower()
    if route == "mlx" and not (system == "Darwin" and machine in ("arm64", "aarch64")):
        raise SetupError(
            f"The MLX route requires Apple Silicon macOS; this machine is "
            f"{system}/{machine}. Use the ElevenLabs route or a supported Mac."
        )
    if route == "torch" and not (system == "Windows" and machine in ("amd64", "x86_64")):
        raise SetupError(
            f"The PyTorch/CUDA route requires native Windows x64; this machine is "
            f"{system}/{machine}. Use the MLX route on Apple Silicon or ElevenLabs."
        )

    base = base_python_for_venv()
    directory = venv_dir(route)
    python = venv_python(route)
    if not python.is_file():
        log("setup", f"Creating isolated environment: {directory}")
        try:
            subprocess.run([base, "-m", "venv", str(directory)], check=True)
        except subprocess.CalledProcessError as exc:
            raise SetupError(
                f"Could not create the dedicated environment at {directory} "
                f"(exit {exc.returncode})."
            ) from exc

    install_route(route, str(python))

    if not interpreter_ok(str(python), route):
        problems = capability_problems(str(python), route)
        raise SetupError(
            "The dedicated environment was installed but still fails verification:\n"
            + ("\n".join(problems) if problems else "required imports are missing.")
        )
    log("setup", f"Environment ready: {python}")
    return str(python)


# ---------------------------------------------------------------------------
# Detection and voice listing
# ---------------------------------------------------------------------------


def hf_hub_cache() -> Path:
    for name in ("HUGGINGFACE_HUB_CACHE", "HF_HUB_CACHE"):
        value = os.environ.get(name)
        if value:
            return Path(value).expanduser()
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg:
        return Path(xdg).expanduser() / "huggingface" / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _file_ok(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def _weight_files_missing(directory: Path, prefix: str = "") -> List[str]:
    """Return missing/empty weight shards for one model directory.

    A `.index.json` is authoritative: every shard named by its `weight_map`
    must exist with non-zero size.  Without an index, at least one weight file
    must exist and every present weight file must be non-empty.
    """
    missing: List[str] = []
    indexes = sorted(
        list(directory.glob("*.safetensors.index.json"))
        + list(directory.glob("*.bin.index.json"))
    )
    if indexes:
        for index in indexes:
            label = f"{prefix}{index.name}"
            if not _file_ok(index):
                missing.append(label)
                continue
            try:
                data = _read_json(index)
            except Exception:
                missing.append(f"{label} (unreadable)")
                continue
            weight_map = data.get("weight_map") if isinstance(data, dict) else None
            if not isinstance(weight_map, dict) or not weight_map:
                missing.append(f"{label} (no weight_map)")
                continue
            for shard in sorted({str(value) for value in weight_map.values()}):
                if not _file_ok(directory / shard):
                    missing.append(f"{prefix}{shard}")
    else:
        weights = sorted(
            list(directory.glob("*.safetensors")) + list(directory.glob("*.bin"))
        )
        if not weights:
            missing.append(f"{prefix}weights/*.safetensors")
        else:
            for weight in weights:
                if not _file_ok(weight):
                    missing.append(f"{prefix}{weight.name}")
    return missing


def snapshot_complete(path: Path) -> Tuple[bool, List[str]]:
    """Check a Hugging Face snapshot, including index-referenced shards."""
    missing: List[str] = []
    if not path.is_dir():
        return False, [f"snapshot directory missing: {path}"]
    for name in (
        "config.json",
        "tokenizer_config.json",
        "preprocessor_config.json",
        "generation_config.json",
    ):
        if not _file_ok(path / name):
            missing.append(name)
    tokenizer_json = path / "tokenizer.json"
    if not _file_ok(tokenizer_json):
        for name in ("vocab.json", "merges.txt"):
            if not _file_ok(path / name):
                missing.append(name)
    missing.extend(_weight_files_missing(path))

    speech = path / "speech_tokenizer"
    if not speech.is_dir():
        missing.append("speech_tokenizer/")
    else:
        for name in ("config.json", "preprocessor_config.json"):
            if not _file_ok(speech / name):
                missing.append(f"speech_tokenizer/{name}")
        missing.extend(_weight_files_missing(speech, "speech_tokenizer/"))
    return len(missing) == 0, missing


def model_cache_path(model_id: str) -> Optional[Path]:
    folder = "models--" + model_id.replace("/", "--")
    root = hf_hub_cache() / folder
    snapshots = root / "snapshots"
    if not snapshots.is_dir():
        return None
    for snapshot in sorted(snapshots.iterdir(), key=lambda item: item.name):
        complete, _missing = snapshot_complete(snapshot)
        if complete:
            return snapshot
    return None


def tool_info(name: str) -> Dict[str, Any]:
    path = shutil.which(name)
    if not path:
        return {"path": None, "version": None}
    try:
        result = subprocess.run([path, "-version"], capture_output=True, timeout=10)
        first = _decode_bytes(result.stdout).splitlines()
        version = first[0].strip() if first else None
    except (OSError, subprocess.TimeoutExpired):
        version = None
    return {"path": path, "version": version}


def _local_route_for_platform() -> Tuple[Optional[str], List[str]]:
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin" and machine in ("arm64", "aarch64"):
        return "mlx", []
    if system == "Windows" and machine in ("amd64", "x86_64"):
        return "torch", []
    return None, [
        f"Local Qwen3-TTS is supported on Apple Silicon macOS (MLX) or "
        f"Windows x64 with NVIDIA (PyTorch); this machine is {system}/{machine}."
    ]


def detect_local() -> Dict[str, Any]:
    route, reasons = _local_route_for_platform()
    if route is None:
        return {
            "backend": None,
            "status": "unsupported",
            "reason": reasons,
            "models": {},
            "python": None,
        }

    backend = "mlx_audio" if route == "mlx" else "qwen_tts"
    preset_model = MLX_PRESET_MODEL if route == "mlx" else TORCH_PRESET_MODEL
    clone_model = MLX_CLONE_MODEL if route == "mlx" else TORCH_CLONE_MODEL
    models = {
        "preset": {"model_id": preset_model, "cached": model_cache_path(preset_model) is not None},
        "clone": {"model_id": clone_model, "cached": model_cache_path(clone_model) is not None},
    }

    nvidia_usable = False
    if route == "torch":
        info = nvidia_smi_info()
        nvidia_usable = bool(info.get("usable"))
        if not nvidia_usable:
            return {
                "backend": "qwen_tts",
                "status": "unsupported",
                "reason": [info.get("reason") or "No usable NVIDIA GPU/driver detected."],
                "models": models,
                "python": None,
            }

    python, problems = find_working_interpreter(route, timeout=45)
    if python is not None:
        missing = [name for name, item in models.items() if not item["cached"]]
        if missing:
            return {
                "backend": backend,
                "status": "needs_setup",
                "reason": [f"{name} model is not cached; first run will download it" for name in missing],
                "models": models,
                "python": python,
            }
        return {
            "backend": backend,
            "status": "ready",
            "reason": [],
            "models": models,
            "python": python,
        }

    unsupported = [item for item in problems if "Metal is unavailable" in item]
    if unsupported:
        return {
            "backend": backend,
            "status": "unsupported",
            "reason": unsupported,
            "models": models,
            "python": None,
        }
    cuda_problems = [
        item
        for item in problems
        if "torch.cuda is unavailable" in item or "CUDA tensor operation failed" in item
    ]
    if route == "torch" and nvidia_usable and cuda_problems:
        return {
            "backend": "qwen_tts",
            "status": "needs_setup",
            "reason": [
                "NVIDIA GPU detected, but the current torch environment cannot "
                "use CUDA (CPU build, wrong wheel, or driver mismatch). Selecting "
                "the local route will create/repair a dedicated CUDA environment."
            ]
            + cuda_problems[:3],
            "models": models,
            "python": None,
        }
    if any("probe failed or timed out" in item for item in problems):
        return {
            "backend": backend,
            "status": "unknown",
            "reason": problems,
            "models": models,
            "python": None,
        }
    reason = [
        "Dependencies are not installed; selecting this route will create a "
        "dedicated environment and download the selected model on first use."
    ]
    if problems:
        reason.extend(problems[:3])
    return {
        "backend": backend,
        "status": "needs_setup",
        "reason": reason,
        "models": models,
        "python": None,
    }


def _http_json(url: str, api_key: str, timeout: float = 10.0) -> Any:
    request = urllib.request.Request(
        url,
        headers={"xi-api-key": api_key, "accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def detect_online() -> Dict[str, Any]:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    result: Dict[str, Any] = {
        "status": "needs_setup",
        "api_key_present": bool(api_key),
        "models": list(ONLINE_MODELS),
        "models_available": [],
        "reason": [],
    }
    if not api_key:
        result["reason"] = ["ELEVENLABS_API_KEY is not set."]
        return result

    python, _ = find_working_interpreter("online", timeout=30)
    if python is None:
        result["reason"] = [
            "The online runtime dependencies (requests/numpy/soundfile) are not installed."
        ]
        return result

    try:
        payload = _http_json("https://api.elevenlabs.io/v1/models", api_key)
        available = [
            item.get("model_id")
            for item in payload
            if isinstance(item, dict) and item.get("model_id")
        ]
        result["models_available"] = [item for item in available if item in ONLINE_MODELS]
        missing = [item for item in ONLINE_MODELS if item not in available]
        if missing:
            result["status"] = "needs_setup"
            result["reason"] = [f"Model not available on this account: {', '.join(missing)}"]
        else:
            result["status"] = "ready"
        result["python"] = python
    except urllib.error.HTTPError as exc:
        body = _decode_bytes(exc.read())[:400]
        if exc.code in (401, 403):
            result["reason"] = ["ELEVENLABS_API_KEY was rejected (401/403)."]
        else:
            result["reason"] = [f"ElevenLabs returned HTTP {exc.code}: {body}"]
        result["status"] = "needs_setup"
    except Exception as exc:
        result["status"] = "unknown"
        result["reason"] = [f"Could not verify ElevenLabs access: {exc}"]
    return result


def detect_environment() -> Dict[str, Any]:
    return {
        "os": platform.system(),
        "arch": platform.machine(),
        "python": {"executable": sys.executable, "version": platform.python_version()},
        "ffmpeg": tool_info("ffmpeg"),
        "ffprobe": tool_info("ffprobe"),
        "routes": {
            "local": detect_local(),
            "elevenlabs": detect_online(),
        },
    }


def list_local_voices() -> Dict[str, Any]:
    cached = model_cache_path(MLX_PRESET_MODEL)
    speakers = [item["speaker"] for item in LOCAL_VOICES]
    if cached is not None:
        try:
            config = _read_json(cached / "config.json")
            talker = config.get("talker_config") or {}
            listed = talker.get("spk_id") or {}
            if isinstance(listed, dict) and listed:
                order = list(listed.keys())
                lookup = {item["speaker"].lower(): item for item in LOCAL_VOICES}
                voices = []
                for key in order:
                    item = lookup.get(key.lower())
                    if item is None:
                        voices.append({"speaker": key, "name": key, "gender": "未知", "description": ""})
                    else:
                        voices.append(item)
                return {"provider": "local", "source": "cached model config", "voices": voices}
        except Exception:
            pass
    return {
        "provider": "local",
        "source": "model card catalog" if cached is None else "static catalog",
        "voices": LOCAL_VOICES,
    }


def list_online_voices() -> Dict[str, Any]:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SetupError("ELEVENLABS_API_KEY is not set.")
    try:
        payload = _http_json("https://api.elevenlabs.io/v1/voices?page_size=100", api_key)
    except urllib.error.HTTPError as exc:
        body = _decode_bytes(exc.read())[:400]
        raise SetupError(f"ElevenLabs voice listing failed (HTTP {exc.code}): {body}") from exc
    except Exception as exc:
        raise SetupError(f"Could not list ElevenLabs voices: {exc}") from exc
    voices = []
    for item in payload.get("voices", []):
        if not isinstance(item, dict):
            continue
        voices.append(
            {
                "voice_id": item.get("voice_id"),
                "name": item.get("name"),
                "category": item.get("category"),
                "labels": item.get("labels") or {},
            }
        )
    return {"provider": "elevenlabs", "voices": voices}


# ---------------------------------------------------------------------------
# Task schema
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class VoiceSpec:
    source: str
    speaker: Optional[str]
    voice_id: Optional[str]
    reference_audio: Optional[Path]
    reference_text: Optional[str]
    name: Optional[str]


@dataclasses.dataclass
class TimingSpec:
    max_speed: float
    safety_gap_sec: float
    pause_between_sec: float


@dataclasses.dataclass
class PolishSpec:
    attempt: int
    max_attempts: int


@dataclasses.dataclass
class InputSpec:
    srt: Optional[Path]
    video: Optional[Path]


@dataclasses.dataclass
class OutputSpec:
    directory: Path
    deliver: List[str]
    audio_format: str
    sample_rate: int
    overwrite: bool


@dataclasses.dataclass
class Segment:
    id: int
    text: str
    start_sec: Optional[float]
    end_sec: Optional[float]
    source_indices: Optional[List[Any]] = None
    original_text: Optional[str] = None
    window_sec: Optional[float] = None


@dataclasses.dataclass
class Task:
    path: Path
    base: Path
    mode: str
    provider: str
    backend: str
    model_id: str
    language: str
    voice: VoiceSpec
    parameters: Dict[str, Any]
    timing: TimingSpec
    allow_text_edits: bool
    polish: PolishSpec
    input: InputSpec
    output: OutputSpec
    segments: List[Segment]
    video_info: Optional[Dict[str, Any]]
    video_duration: Optional[float]
    warnings: List[str]

    @property
    def work_dir(self) -> Path:
        return self.base / "work"


def _check_keys(obj: Any, allowed: set, where: str) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise TaskError(f"{where} must be a JSON object.")
    unknown = sorted(set(obj) - allowed)
    if unknown:
        raise TaskError(
            f"{where} contains unknown field(s): {', '.join(unknown)}; "
            f"allowed: {', '.join(sorted(allowed))}"
        )
    return obj


def _as_object(value: Any, where: str) -> Dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise TaskError(f"{where} must be a JSON object.")
    return value


def _number(
    value: Any,
    where: str,
    *,
    default: Optional[float] = None,
    minimum: Optional[float] = None,
    maximum: Optional[float] = None,
    integer: bool = False,
) -> Any:
    if value is None:
        if default is None:
            raise TaskError(f"{where} is required.")
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TaskError(f"{where} must be a number.")
    number = int(value) if integer else float(value)
    if not math.isfinite(float(number)):
        raise TaskError(f"{where} must be finite.")
    if minimum is not None and number < minimum:
        raise TaskError(f"{where} must be >= {minimum}.")
    if maximum is not None and number > maximum:
        raise TaskError(f"{where} must be <= {maximum}.")
    return number


def _string(
    value: Any,
    where: str,
    *,
    required: bool = True,
    default: Optional[str] = None,
    allow_empty: bool = False,
) -> Optional[str]:
    if value is None:
        if required:
            raise TaskError(f"{where} is required.")
        return default
    if not isinstance(value, str):
        raise TaskError(f"{where} must be a string.")
    if not allow_empty and not value.strip():
        raise TaskError(f"{where} must not be empty.")
    return value


def _bool(value: Any, where: str, default: bool = False) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise TaskError(f"{where} must be true or false.")
    return value


def _resolve_path(base: Path, value: Any, where: str, *, must_exist: bool) -> Optional[Path]:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise TaskError(f"{where} must be a non-empty path string or null.")
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    path = path.resolve()
    if must_exist and not path.is_file():
        raise TaskError(f"{where} does not exist or is not a file: {path}")
    return path


def _canonical_language(value: Any) -> str:
    text = _string(value, "language", required=True)
    assert text is not None
    key = text.strip().lower().replace("_", "-")
    canonical = LANGUAGE_ALIASES.get(key)
    if canonical is None:
        raise TaskError(
            f"language {text!r} is not supported; supported: "
            + ", ".join(LOCAL_LANGUAGES)
        )
    return canonical


def _stream_duration(stream: Dict[str, Any], probe: Dict[str, Any]) -> Optional[float]:
    for raw in (stream.get("duration"), (probe.get("format") or {}).get("duration")):
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            return value
    return None


def _validate_local_voice(voice: Dict[str, Any], source: str, base: Path) -> VoiceSpec:
    speaker = _string(voice.get("speaker"), "voice.speaker", required=False)
    voice_id = _string(voice.get("voice_id"), "voice.voice_id", required=False)
    reference_text = _string(voice.get("reference_text"), "voice.reference_text", required=False)
    name = _string(voice.get("name"), "voice.name", required=False)
    reference_audio = voice.get("reference_audio")

    if source == "preset":
        if not speaker:
            raise TaskError("voice.speaker is required for a local preset voice.")
        if voice_id:
            raise TaskError("voice.voice_id is only for ElevenLabs; local preset uses voice.speaker.")
        if reference_audio:
            raise TaskError("voice.reference_audio is only for a clone voice.")
        if reference_text:
            raise TaskError("voice.reference_text is only for a clone voice.")
        if name:
            raise TaskError("voice.name is only for an online clone voice.")
        return VoiceSpec("preset", speaker, None, None, None, None)

    if source == "clone":
        if speaker:
            raise TaskError("voice.speaker is not used for a local clone; use reference_audio + reference_text.")
        if voice_id:
            raise TaskError("voice.voice_id is only for ElevenLabs; local clone uses a reference recording.")
        audio = _resolve_path(base, reference_audio, "voice.reference_audio", must_exist=True)
        if audio is None:
            raise TaskError("voice.reference_audio is required for a local clone.")
        if not reference_text or not reference_text.strip():
            raise TaskError("voice.reference_text is required for a local clone.")
        if name:
            raise TaskError("voice.name is only for an online clone voice.")
        return VoiceSpec("clone", None, None, audio, reference_text.strip(), None)

    raise TaskError("voice.source must be 'preset' or 'clone'.")


def _validate_online_voice(
    voice: Dict[str, Any], source: str, base: Path, warnings: List[str]
) -> VoiceSpec:
    speaker = _string(voice.get("speaker"), "voice.speaker", required=False)
    voice_id = _string(voice.get("voice_id"), "voice.voice_id", required=False)
    reference_text = _string(voice.get("reference_text"), "voice.reference_text", required=False)
    name = _string(voice.get("name"), "voice.name", required=False)
    reference_audio = voice.get("reference_audio")

    if speaker:
        raise TaskError("voice.speaker is for local Qwen3-TTS only; ElevenLabs uses voice_id.")
    if name and len(name) > 100:
        raise TaskError("voice.name must be at most 100 characters.")
    if source == "preset":
        if not voice_id:
            raise TaskError("voice.voice_id is required for an ElevenLabs preset voice.")
        if reference_audio or reference_text:
            raise TaskError("A preset ElevenLabs voice does not take reference_audio/reference_text.")
        if name:
            raise TaskError("voice.name is only used when creating a new clone.")
        return VoiceSpec("preset", None, voice_id, None, None, None)

    if source == "clone":
        if voice_id:
            if reference_audio or reference_text:
                warnings.append(
                    "Existing ElevenLabs voice_id supplied with reference audio/text; "
                    "the existing voice is used and no upload is performed."
                )
            return VoiceSpec("clone", None, voice_id, None, None, name)
        audio = _resolve_path(base, reference_audio, "voice.reference_audio", must_exist=True)
        if audio is None:
            raise TaskError("voice.reference_audio is required to create an ElevenLabs clone.")
        return VoiceSpec("clone", None, None, audio, reference_text, name)

    raise TaskError("voice.source must be 'preset' or 'clone'.")


def _validate_parameters(provider: str, backend: str, params: Any, source: str) -> Dict[str, Any]:
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise TaskError("parameters must be a JSON object.")
    allowed = LOCAL_PARAMS if provider == "local" else ONLINE_PARAMS
    if backend == "qwen_tts":
        allowed = TORCH_PARAMS
    _check_keys(params, allowed, "parameters")

    if provider == "local":
        instruct = params.get("instruct")
        if instruct is not None:
            instruct = _string(instruct, "parameters.instruct", required=False, allow_empty=True)
            if source == "clone" and instruct and instruct.strip():
                raise TaskError("parameters.instruct is only supported for preset voices.")
        return {"instruct": instruct} if instruct is not None else {}

    cleaned: Dict[str, Any] = {}
    settings = params.get("voice_settings")
    if settings is not None:
        if not isinstance(settings, dict):
            raise TaskError("parameters.voice_settings must be a JSON object.")
        _check_keys(
            settings,
            {"stability", "similarity_boost", "style", "use_speaker_boost"},
            "parameters.voice_settings",
        )
        cleaned_settings: Dict[str, Any] = {}
        for key in ("stability", "similarity_boost", "style"):
            if settings.get(key) is not None:
                cleaned_settings[key] = _number(
                    settings[key], f"parameters.voice_settings.{key}", minimum=0.0, maximum=1.0
                )
        if settings.get("use_speaker_boost") is not None:
            cleaned_settings["use_speaker_boost"] = _bool(
                settings["use_speaker_boost"], "parameters.voice_settings.use_speaker_boost"
            )
        cleaned["voice_settings"] = cleaned_settings
    if params.get("output_format") is not None:
        value = _string(params["output_format"], "parameters.output_format")
        if value not in ONLINE_OUTPUT_FORMATS:
            raise TaskError(
                f"parameters.output_format must be one of {', '.join(ONLINE_OUTPUT_FORMATS)}."
            )
        cleaned["output_format"] = value
    if params.get("remove_background_noise") is not None:
        cleaned["remove_background_noise"] = _bool(
            params["remove_background_noise"], "parameters.remove_background_noise"
        )
    return cleaned


def load_task(path: Any, *, require_media_tools: bool = False) -> Task:
    task_path = Path(path).expanduser().resolve()
    if not task_path.is_file():
        raise TaskError(f"task.json not found: {task_path}")
    try:
        raw = _read_json(task_path)
    except json.JSONDecodeError as exc:
        raise TaskError(f"task.json is not valid JSON: {exc}") from exc
    except ValueError as exc:
        raise TaskError(f"task.json contains an invalid value: {exc}") from exc

    _check_keys(raw, TASK_KEYS, "task")
    base = task_path.parent
    warnings: List[str] = []

    if raw.get("schema_version") != SCHEMA_VERSION:
        raise TaskError(f"schema_version must be {SCHEMA_VERSION}.")
    mode = _string(raw.get("mode"), "mode")
    if mode not in ("narration", "aligned"):
        raise TaskError("mode must be 'narration' or 'aligned'.")
    assert mode is not None

    provider = _string(raw.get("provider"), "provider")
    if provider not in ("local", "elevenlabs"):
        raise TaskError("provider must be 'local' or 'elevenlabs'.")
    assert provider is not None

    backend = _string(raw.get("backend"), "backend")
    assert backend is not None
    if provider == "local":
        if backend not in ("mlx_audio", "qwen_tts"):
            raise TaskError("Local provider backend must be 'mlx_audio' or 'qwen_tts'.")
        system = platform.system()
        machine = platform.machine().lower()
        if backend == "mlx_audio" and not (system == "Darwin" and machine in ("arm64", "aarch64")):
            raise TaskError(
                "backend 'mlx_audio' requires Apple Silicon macOS; this machine is "
                f"{system}/{machine}. Regenerate task.json on this machine."
            )
        if backend == "qwen_tts" and not (system == "Windows" and machine in ("amd64", "x86_64")):
            raise TaskError(
                "backend 'qwen_tts' requires native Windows x64; this machine is "
                f"{system}/{machine}. Regenerate task.json on this machine."
            )
    else:
        if backend != "elevenlabs_http":
            raise TaskError("ElevenLabs provider backend must be 'elevenlabs_http'.")

    voice_raw = _check_keys(raw.get("voice"), VOICE_KEYS, "voice")
    source = _string(voice_raw.get("source"), "voice.source")
    if source not in ("preset", "clone"):
        raise TaskError("voice.source must be 'preset' or 'clone'.")
    assert source is not None

    if provider == "local":
        voice = _validate_local_voice(voice_raw, source, base)
    else:
        voice = _validate_online_voice(voice_raw, source, base, warnings)

    model_id = _string(raw.get("model_id"), "model_id")
    assert model_id is not None
    if provider == "local":
        expected = EXPECTED_MODELS.get((backend, source))
        if expected is None or model_id != expected:
            raise TaskError(
                f"model_id for {backend}/{source} must be exactly {expected!r}; "
                f"got {model_id!r}. The model is fixed by backend and voice source."
            )
    elif model_id not in ONLINE_MODELS:
        raise TaskError(
            f"model_id for ElevenLabs must be one of {', '.join(ONLINE_MODELS)}; got {model_id!r}."
        )

    language = _canonical_language(raw.get("language"))
    if provider == "local" and language not in LOCAL_LANGUAGES:
        raise TaskError(
            f"language {language!r} is not supported by local Qwen3-TTS; "
            f"supported: {', '.join(LOCAL_LANGUAGES)}"
        )

    parameters = _validate_parameters(provider, backend, raw.get("parameters"), source)

    timing_raw = _check_keys(_as_object(raw.get("timing"), "timing"), TIMING_KEYS, "timing")
    max_speed = _number(timing_raw.get("max_speed"), "timing.max_speed", default=1.2, minimum=1.0, maximum=1.2)
    safety_gap = _number(
        timing_raw.get("safety_gap_sec"), "timing.safety_gap_sec", default=0.1, minimum=0.0, maximum=2.0
    )
    pause = _number(
        timing_raw.get("pause_between_sec"), "timing.pause_between_sec", default=0.3, minimum=0.0, maximum=2.0
    )

    allow_text_edits = _bool(raw.get("allow_text_edits"), "allow_text_edits", default=False)
    polish_raw = _check_keys(_as_object(raw.get("polish"), "polish"), POLISH_KEYS, "polish")
    attempt = _number(polish_raw.get("attempt"), "polish.attempt", default=0, integer=True, minimum=0, maximum=2)
    max_attempts = _number(
        polish_raw.get("max_attempts"), "polish.max_attempts", default=2, integer=True, minimum=0, maximum=2
    )
    if attempt > max_attempts:
        raise TaskError("polish.attempt must not exceed polish.max_attempts.")
    if attempt > 0 and not allow_text_edits:
        raise TaskError("polish.attempt > 0 requires allow_text_edits=true.")

    input_raw = _check_keys(_as_object(raw.get("input"), "input"), INPUT_KEYS, "input")
    srt_path = _resolve_path(base, input_raw.get("srt"), "input.srt", must_exist=True)
    video_path = _resolve_path(base, input_raw.get("video"), "input.video", must_exist=True)
    if mode == "aligned" and srt_path is None:
        raise TaskError("input.srt is required for aligned mode.")

    video_info: Optional[Dict[str, Any]] = None
    video_duration: Optional[float] = None
    if video_path is not None:
        ffprobe_path = shutil.which("ffprobe")
        if ffprobe_path:
            global FFPROBE
            FFPROBE = ffprobe_path
            try:
                video_info = probe_video(video_path)
            except RunnerError as exc:
                raise TaskError(f"input.video is not usable: {exc.message}") from exc
            video_duration = float(video_info["duration"])
        elif require_media_tools:
            raise TaskError("ffprobe is required to inspect input.video.")
        else:
            warnings.append("ffprobe is not available; video duration was not checked.")

    output_raw = _check_keys(_as_object(raw.get("output"), "output"), OUTPUT_KEYS, "output")
    directory = _resolve_path(base, output_raw.get("directory") or "output", "output.directory", must_exist=False)
    assert directory is not None
    if directory.exists() and not directory.is_dir():
        raise TaskError(f"output.directory is not a directory: {directory}")

    deliver_raw = output_raw.get("deliver")
    if deliver_raw is None:
        deliver = ["audio"]
    else:
        if not isinstance(deliver_raw, list) or not deliver_raw:
            raise TaskError("output.deliver must be a non-empty array.")
        deliver = []
        for item in deliver_raw:
            value = _string(item, "output.deliver item")
            if value not in ("audio", "video", "subtitle"):
                raise TaskError("output.deliver items must be audio, video, or subtitle.")
            if value not in deliver:
                deliver.append(value)
    if "video" in deliver and video_path is None:
        raise TaskError("output.deliver includes video but input.video is missing.")

    audio_format = _string(output_raw.get("audio_format"), "output.audio_format", required=False, default="wav")
    if audio_format != AUDIO_FORMAT:
        raise TaskError("First version exports WAV audio only; output.audio_format must be 'wav'.")
    sample_rate = _number(
        output_raw.get("sample_rate"), "output.sample_rate", default=SAMPLE_RATE, integer=True, minimum=1, maximum=384000
    )
    if sample_rate != SAMPLE_RATE:
        raise TaskError("First version exports 48 kHz audio only; output.sample_rate must be 48000.")
    overwrite = _bool(output_raw.get("overwrite"), "output.overwrite", default=False)

    segments_raw = raw.get("segments")
    if not isinstance(segments_raw, list) or not segments_raw:
        raise TaskError("segments must be a non-empty array.")
    segments: List[Segment] = []
    seen_ids: set = set()
    for index, item in enumerate(segments_raw):
        where = f"segments[{index}]"
        _check_keys(item, SEGMENT_KEYS, where)
        seg_id = _number(item.get("id"), f"{where}.id", integer=True, minimum=0)
        if seg_id in seen_ids:
            raise TaskError(f"{where}.id duplicates another segment id: {seg_id}")
        seen_ids.add(seg_id)
        text = _string(item.get("text"), f"{where}.text", required=True, allow_empty=False)
        assert text is not None
        if "\x00" in text:
            raise TaskError(f"{where}.text contains a NUL character.")
        original_text = _string(item.get("original_text"), f"{where}.original_text", required=False)
        source_indices = item.get("source_indices")
        if source_indices is not None:
            if not isinstance(source_indices, list) or not all(
                isinstance(value, (int, str)) and not isinstance(value, bool) for value in source_indices
            ):
                raise TaskError(f"{where}.source_indices must be an array of integers or strings.")
        if mode == "narration":
            if item.get("start_sec") is not None or item.get("end_sec") is not None:
                raise TaskError(f"{where}: narration segments must have start_sec/end_sec = null.")
            start = None
            end = None
            window = None
        else:
            start = _number(item.get("start_sec"), f"{where}.start_sec", minimum=0.0)
            end = _number(item.get("end_sec"), f"{where}.end_sec", minimum=0.0)
            if end <= start:
                raise TaskError(f"{where}: end_sec must be greater than start_sec.")
            window = None
        segments.append(
            Segment(
                id=int(seg_id),
                text=text,
                start_sec=start,
                end_sec=end,
                source_indices=source_indices,
                original_text=original_text,
                window_sec=window,
            )
        )

    if mode == "aligned":
        for index, segment in enumerate(segments):
            assert segment.start_sec is not None and segment.end_sec is not None
            if index > 0:
                previous = segments[index - 1]
                assert previous.start_sec is not None
                if segment.start_sec <= previous.start_sec:
                    raise TaskError(
                        f"segments[{index}]: start_sec must be strictly greater than the previous segment's start_sec."
                    )
                if previous.end_sec is not None and previous.end_sec > segment.start_sec:
                    warnings.append(
                        f"segment {previous.id}: source end {previous.end_sec:.3f}s overlaps "
                        f"next start {segment.start_sec:.3f}s; the alignment window uses the next start."
                    )
            if video_duration is not None and segment.start_sec >= video_duration:
                raise TaskError(
                    f"segment {segment.id}: start_sec {segment.start_sec:.3f}s is at or beyond "
                    f"video duration {video_duration:.3f}s."
                )

        for index, segment in enumerate(segments):
            assert segment.start_sec is not None and segment.end_sec is not None
            if index + 1 < len(segments):
                next_start = segments[index + 1].start_sec
                assert next_start is not None
                window = next_start - segment.start_sec - safety_gap
                if window <= 0:
                    raise TaskError(
                        f"segment {segment.id}: no usable window before the next segment "
                        f"(window {window:.3f}s); fix the segment boundaries or safety gap."
                    )
            elif video_duration is not None:
                window = video_duration - segment.start_sec
                if window <= 0:
                    raise TaskError(
                        f"segment {segment.id}: no usable window before the end of the video."
                    )
                if segment.end_sec > video_duration:
                    warnings.append(
                        f"segment {segment.id}: source end {segment.end_sec:.3f}s exceeds "
                        f"video duration; the final window ends at {video_duration:.3f}s."
                    )
            else:
                window = segment.end_sec - segment.start_sec
                if window <= 0:
                    raise TaskError(f"segment {segment.id}: no usable window.")
            segment.window_sec = float(window)

    return Task(
        path=task_path,
        base=base,
        mode=mode,
        provider=provider,
        backend=backend,
        model_id=model_id,
        language=language,
        voice=voice,
        parameters=parameters,
        timing=TimingSpec(max_speed=float(max_speed), safety_gap_sec=float(safety_gap), pause_between_sec=float(pause)),
        allow_text_edits=allow_text_edits,
        polish=PolishSpec(attempt=int(attempt), max_attempts=int(max_attempts)),
        input=InputSpec(srt=srt_path, video=video_path),
        output=OutputSpec(
            directory=directory,
            deliver=deliver,
            audio_format=audio_format,
            sample_rate=int(sample_rate),
            overwrite=overwrite,
        ),
        segments=segments,
        video_info=video_info,
        video_duration=video_duration,
        warnings=warnings,
    )


def task_route(task: Task) -> str:
    if task.provider == "elevenlabs":
        return "online"
    return "mlx" if task.backend == "mlx_audio" else "torch"


def task_summary(task: Task) -> Dict[str, Any]:
    return {
        "path": str(task.path),
        "mode": task.mode,
        "provider": task.provider,
        "backend": task.backend,
        "model_id": task.model_id,
        "language": task.language,
        "voice": {
            "source": task.voice.source,
            "speaker": task.voice.speaker,
            "voice_id": task.voice.voice_id,
            "reference_audio": str(task.voice.reference_audio) if task.voice.reference_audio else None,
            "reference_text_present": bool(task.voice.reference_text),
        },
        "segments": len(task.segments),
        "input": {
            "srt": str(task.input.srt) if task.input.srt else None,
            "video": str(task.input.video) if task.input.video else None,
            "video_duration": task.video_duration,
        },
        "output": {
            "directory": str(task.output.directory),
            "deliver": task.output.deliver,
            "audio_format": task.output.audio_format,
            "sample_rate": task.output.sample_rate,
            "overwrite": task.output.overwrite,
        },
        "allow_text_edits": task.allow_text_edits,
        "polish": {"attempt": task.polish.attempt, "max_attempts": task.polish.max_attempts},
        "timing": {
            "max_speed": task.timing.max_speed,
            "safety_gap_sec": task.timing.safety_gap_sec,
            "pause_between_sec": task.timing.pause_between_sec,
        },
        "warnings": list(task.warnings),
    }


# ---------------------------------------------------------------------------
# Tools, media probing, audio processing
# ---------------------------------------------------------------------------


def check_tools() -> None:
    global FFMPEG, FFPROBE, FFMPEG_VERSION, FFPROBE_VERSION
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        missing = [name for name, value in (("ffmpeg", ffmpeg), ("ffprobe", ffprobe)) if not value]
        system = platform.system()
        if system == "Darwin":
            hint = "brew install ffmpeg"
        elif system == "Windows":
            hint = "winget install ffmpeg"
        else:
            hint = "install ffmpeg and ffprobe with your package manager"
        raise SetupError(
            f"Missing required tool(s): {', '.join(missing)}. Install both ffmpeg and "
            f"ffprobe ({hint}) and retry. A package with only ffmpeg is not sufficient."
        )
    FFMPEG = ffmpeg
    FFPROBE = ffprobe
    try:
        result = subprocess.run([FFMPEG, "-version"], capture_output=True, timeout=10)
        FFMPEG_VERSION = _decode_bytes(result.stdout).splitlines()[0].strip() if result.stdout else ""
    except (OSError, subprocess.TimeoutExpired):
        FFMPEG_VERSION = ""
    try:
        result = subprocess.run([FFPROBE, "-version"], capture_output=True, timeout=10)
        FFPROBE_VERSION = _decode_bytes(result.stdout).splitlines()[0].strip() if result.stdout else ""
    except (OSError, subprocess.TimeoutExpired):
        FFPROBE_VERSION = ""


def ffprobe_json(path: Path) -> Dict[str, Any]:
    command = [
        FFPROBE,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RunnerError(f"ffprobe could not inspect {path}: {exc}", stage="probe") from exc
    if result.returncode != 0:
        detail = _decode_bytes(result.stderr).strip()
        raise RunnerError(f"ffprobe failed for {path}: {detail}", stage="probe")
    try:
        return json.loads(_decode_bytes(result.stdout))
    except json.JSONDecodeError as exc:
        raise RunnerError(f"ffprobe returned invalid JSON for {path}: {exc}", stage="probe") from exc


def _mono(pcm: Any):
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32)
    if samples.ndim == 1:
        return np.ascontiguousarray(samples)
    if samples.ndim == 2:
        if samples.shape[1] == 1:
            return np.ascontiguousarray(samples[:, 0])
        return np.ascontiguousarray(samples.mean(axis=1, dtype=np.float32))
    raise ValueError(f"audio must be 1-D or 2-D, got shape {samples.shape}")


def read_wav(path: Path) -> Tuple[Any, int]:
    samples, sample_rate = _sf().read(str(path), dtype="float32", always_2d=False)
    return _mono(samples), int(sample_rate)


def wav_info(path: Path) -> Tuple[int, int, float]:
    info = _sf().info(str(path))
    sample_rate = int(info.samplerate)
    samples = int(info.frames)
    return samples, sample_rate, samples / sample_rate if sample_rate else 0.0


def write_wav_float(path: Path, pcm: Any, sample_rate: int) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = _mono(pcm)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        _sf().write(tmp_name, samples, sample_rate, subtype="FLOAT")
        os.replace(tmp_name, path)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def write_wav_pcm16(path: Path, pcm: Any, sample_rate: int) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    samples = _mono(pcm)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        _sf().write(tmp_name, samples, sample_rate, subtype="PCM_16")
        os.replace(tmp_name, path)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def validate_pcm(pcm: Any, sample_rate: int, *, min_seconds: float = 0.05, min_rms: float = 1e-4) -> float:
    np = _np()
    if sample_rate <= 0:
        raise RunnerError(f"invalid sample rate {sample_rate}", stage="audio")
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise RunnerError("synthesized audio is empty", stage="audio")
    if not np.isfinite(samples).all():
        raise RunnerError("synthesized audio contains NaN or Inf", stage="audio")
    duration = samples.size / sample_rate
    if duration < min_seconds:
        raise RunnerError(
            f"synthesized audio is too short ({duration:.3f}s < {min_seconds:.3f}s)",
            stage="audio",
        )
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    if rms < min_rms:
        raise RunnerError(
            f"synthesized audio is effectively silent (RMS {rms:.2e})",
            stage="audio",
        )
    return duration


def trim_silence(pcm: Any, sample_rate: int) -> Any:
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        raise RunnerError("cannot trim empty audio", stage="audio")
    frame = max(1, int(sample_rate * 0.01))
    frame_count = (samples.size + frame - 1) // frame
    padded = np.zeros(frame_count * frame, dtype=np.float32)
    padded[: samples.size] = samples
    rms = np.sqrt(np.mean(padded.reshape(frame_count, frame) ** 2, axis=1))
    peak = float(rms.max())
    threshold = max(1e-4, min(0.01, peak * 0.1))
    active = np.flatnonzero(rms > threshold)
    if active.size == 0:
        raise RunnerError("synthesized audio contains only silence", stage="audio")
    first = max(0, (int(active[0]) - 1) * frame)
    last = min(samples.size, (int(active[-1]) + 2) * frame)
    trimmed = np.array(samples[first:last], dtype=np.float32, copy=True)
    fade = min(int(sample_rate * 0.01), trimmed.size // 2)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        trimmed[:fade] *= ramp
        trimmed[-fade:] *= ramp[::-1]
    return trimmed


def resample_audio(pcm: Any, from_rate: int, to_rate: int) -> Any:
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if from_rate == to_rate:
        return np.ascontiguousarray(samples)
    if from_rate <= 0 or to_rate <= 0:
        raise RunnerError(f"invalid resample rates {from_rate} -> {to_rate}", stage="audio")
    with tempfile.TemporaryDirectory(prefix="video-tts-resample-") as tmp:
        source = Path(tmp) / "in.wav"
        target = Path(tmp) / "out.wav"
        _sf().write(source, samples, from_rate, subtype="FLOAT")
        command = [
            FFMPEG,
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-filter:a",
            "aresample=resampler=swr:dither_method=0",
            "-ar",
            str(to_rate),
            str(target),
        ]
        try:
            result = subprocess.run(command, capture_output=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RunnerError(f"ffmpeg resample failed: {exc}", stage="audio") from exc
        if result.returncode != 0:
            raise RunnerError(
                f"ffmpeg resample failed: {_decode_bytes(result.stderr).strip()}",
                stage="audio",
            )
        output, actual_rate = read_wav(target)
    if int(actual_rate) != to_rate:
        raise RunnerError(
            f"resampler produced {actual_rate} Hz, expected {to_rate} Hz",
            stage="audio",
        )
    expected = samples.size * to_rate / from_rate
    if abs(output.size - expected) > expected * 0.02:
        raise RunnerError(
            f"resampler produced {output.size} samples, expected about {expected:.0f}",
            stage="audio",
        )
    return output


def _atempo_chain(speed: float) -> str:
    factors: List[float] = []
    remaining = float(speed)
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    factors.append(remaining)
    return ",".join(f"atempo={factor:.6f}" for factor in factors)


def change_speed(pcm: Any, speed: float, sample_rate: int) -> Any:
    np = _np()
    samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
    if speed <= 0 or not math.isfinite(speed):
        raise RunnerError(f"invalid speed factor: {speed}", stage="audio")
    if abs(speed - 1.0) < 1e-6 or samples.size == 0:
        return np.ascontiguousarray(samples)
    with tempfile.TemporaryDirectory(prefix="video-tts-atempo-") as tmp:
        source = Path(tmp) / "in.wav"
        target = Path(tmp) / "out.wav"
        _sf().write(source, samples, sample_rate, subtype="FLOAT")
        command = [
            FFMPEG,
            "-y",
            "-v",
            "error",
            "-i",
            str(source),
            "-filter:a",
            _atempo_chain(speed),
            str(target),
        ]
        try:
            result = subprocess.run(command, capture_output=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RunnerError(f"ffmpeg atempo failed: {exc}", stage="audio") from exc
        if result.returncode != 0:
            raise RunnerError(
                f"ffmpeg atempo failed: {_decode_bytes(result.stderr).strip()}",
                stage="audio",
            )
        output, actual_rate = read_wav(target)
    if int(actual_rate) != sample_rate:
        raise RunnerError(
            f"atempo changed the sample rate ({sample_rate} -> {actual_rate})",
            stage="audio",
        )
    expected = samples.size / speed
    if abs(output.size - expected) > expected * 0.03:
        raise RunnerError(
            f"atempo produced {output.size} samples, expected about {expected:.0f}",
            stage="audio",
        )
    return output


def concat_wavs(paths: Sequence[Path], target: Path, pause_seconds: float, sample_rate: int) -> None:
    paths = [Path(path) for path in paths]
    if not paths:
        raise RunnerError("no audio pieces to concatenate", stage="audio")
    infos = [wav_info(path) for path in paths]
    for frames, rate, _duration in infos:
        if rate != sample_rate:
            raise RunnerError(
                f"cannot concatenate mixed sample rates ({sample_rate} vs {rate})",
                stage="audio",
            )
    total = sum(frames for frames, _rate, _duration in infos)
    pause_samples = int(round(pause_seconds * sample_rate))
    if len(paths) > 1:
        total += pause_samples * (len(paths) - 1)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".wav"
    )
    os.close(fd)
    zero = None
    try:
        with _sf().SoundFile(
            tmp_name, mode="w", samplerate=sample_rate, channels=1, subtype="FLOAT"
        ) as dst:
            zero = _np().zeros(min(IO_CHUNK_SAMPLES, max(1, pause_samples)), dtype="float32") if pause_samples else None
            for index, path in enumerate(paths):
                with _sf().SoundFile(str(path)) as src:
                    for block in src.blocks(blocksize=IO_CHUNK_SAMPLES, dtype="float32", always_2d=False):
                        dst.write(_mono(block))
                if index + 1 < len(paths) and pause_samples:
                    remaining = pause_samples
                    while remaining > 0:
                        count = min(zero.size, remaining)
                        dst.write(zero[:count])
                        remaining -= count
        os.replace(tmp_name, target)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def write_track(path: Path, placements: Sequence[Tuple[float, Path, int]], total_seconds: float, sample_rate: int) -> None:
    if total_seconds <= 0:
        raise RunnerError("track duration must be positive", stage="track")
    if sample_rate <= 0:
        raise RunnerError("track sample rate must be positive", stage="track")
    total_samples = int(math.ceil(total_seconds * sample_rate))
    ordered = sorted(placements, key=lambda item: item[0])
    validated: List[Tuple[int, int, Path]] = []
    previous_end = 0
    for index, (start, source_path, samples) in enumerate(ordered):
        if start < 0:
            raise RunnerError(f"placement {index}: negative start {start}", stage="track")
        if samples <= 0:
            raise RunnerError(f"placement {index}: no samples in {source_path}", stage="track")
        start_sample = int(round(start * sample_rate))
        end_sample = start_sample + samples
        if end_sample > total_samples:
            if end_sample - total_samples <= 2:
                end_sample = total_samples
            else:
                raise RunnerError(
                    f"placement {index} ends at {end_sample / sample_rate:.3f}s, "
                    f"beyond track duration {total_seconds:.3f}s",
                    stage="track",
                )
        if start_sample < previous_end:
            raise RunnerError(
                f"placement {index} starts at {start_sample / sample_rate:.3f}s, "
                f"overlapping the previous segment ending at {previous_end / sample_rate:.3f}s",
                stage="track",
            )
        validated.append((start_sample, end_sample, Path(source_path)))
        previous_end = end_sample

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".wav"
    )
    os.close(fd)
    try:
        with _sf().SoundFile(
            tmp_name, mode="w", samplerate=sample_rate, channels=1, subtype="FLOAT"
        ) as dst:
            cursor = 0
            zeros = _np().zeros(IO_CHUNK_SAMPLES, dtype="float32")
            for start_sample, end_sample, source in validated:
                _write_zeros(dst, start_sample - cursor, zeros)
                _copy_segment(dst, source, end_sample - start_sample)
                cursor = end_sample
            _write_zeros(dst, total_samples - cursor, zeros)
        os.replace(tmp_name, target)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise


def _write_zeros(handle: Any, count: int, zero: Any) -> None:
    remaining = count
    while remaining > 0:
        chunk = min(zero.size, remaining)
        handle.write(zero[:chunk])
        remaining -= chunk


def _copy_segment(handle: Any, path: Path, expected: int) -> None:
    copied = 0
    with _sf().SoundFile(str(path)) as src:
        for block in src.blocks(blocksize=IO_CHUNK_SAMPLES, dtype="float32", always_2d=False):
            block = _mono(block)
            remaining = expected - copied
            if remaining <= 0:
                break
            if block.size > remaining:
                block = block[:remaining]
            handle.write(block)
            copied += block.size
    if copied != expected:
        raise RunnerError(
            f"segment {path} contains {copied} samples, expected {expected}; "
            "the cached part was modified or truncated",
            stage="track",
        )


def pad_track(source: Path, target: Path, target_seconds: float, sample_rate: int) -> None:
    samples, rate, duration = wav_info(source)
    if rate != sample_rate:
        pcm, actual = read_wav(source)
        pcm = resample_audio(pcm, actual, sample_rate)
        write_wav_float(target, pcm, sample_rate)
        source = target
        samples, rate, duration = wav_info(source)
    if duration > target_seconds + 1e-6:
        raise RunnerError(
            f"cannot pad a {duration:.3f}s track down to {target_seconds:.3f}s",
            stage="track",
        )
    write_track(target, [(0.0, source, samples)], target_seconds, sample_rate)


def export_pcm16(source: Path, target: Path, sample_rate: int) -> float:
    pcm, rate = read_wav(source)
    if rate != sample_rate:
        pcm = resample_audio(pcm, rate, sample_rate)
    write_wav_pcm16(target, pcm, sample_rate)
    duration = validate_pcm(pcm, sample_rate)
    return duration


def write_srt(path: Path, entries: Sequence[Tuple[float, float, str]]) -> None:
    def stamp(seconds: float) -> str:
        total_ms = int(round(max(0.0, seconds) * 1000))
        hours, total_ms = divmod(total_ms, 3_600_000)
        minutes, total_ms = divmod(total_ms, 60_000)
        secs, millis = divmod(total_ms, 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    blocks = []
    for number, (start, end, text) in enumerate(entries, start=1):
        if end <= start:
            end = start + 0.001
        body = text.replace("\r\n", "\n").replace("\r", "\n").strip()
        blocks.append(f"{number}\n{stamp(start)} --> {stamp(end)}\n{body}\n")
    atomic_write_text(Path(path), "\n".join(blocks))


def probe_video(path: Path) -> Dict[str, Any]:
    probe = ffprobe_json(path)
    streams = probe.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), None)
    if video is None:
        raise RunnerError(f"no video stream in {path}", stage="probe")
    duration = _stream_duration(video, probe)
    if duration is None:
        raise RunnerError(f"could not determine video duration for {path}", stage="probe")
    return {
        "duration": duration,
        "codec_name": str(video.get("codec_name") or ""),
    }


def mux_video(
    video: Path,
    track: Path,
    target: Path,
    video_info: Dict[str, Any],
    *,
    sample_rate: int = SAMPLE_RATE,
) -> List[str]:
    warnings: List[str] = []
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".mp4"
    )
    os.close(fd)
    Path(tmp_name).unlink()

    command = [
        FFMPEG,
        "-y",
        "-v",
        "error",
        "-i",
        str(video),
        "-i",
        str(track),
        "-map",
        "0:v:0",
        "-map_metadata",
        "0",
        "-map",
        "1:a:0",
    ]

    codec = str(video_info.get("codec_name") or "")
    if codec in ("h264", "hevc"):
        command += ["-c:v", "copy"]
        if codec == "hevc":
            command += ["-tag:v", "hvc1"]
    else:
        warnings.append(
            f"video codec {codec or 'unknown'} cannot be copied into MP4; re-encoding with H.264."
        )
        command += [
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
        ]
    command += [
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        str(sample_rate),
        "-movflags",
        "+faststart",
        tmp_name,
    ]
    try:
        with Heartbeat("mux", target.name):
            result = subprocess.run(command, capture_output=True, timeout=1800)
        if result.returncode != 0:
            raise RunnerError(
                f"ffmpeg mux failed: {_decode_bytes(result.stderr).strip()}",
                stage="mux",
            )
        warnings.extend(verify_mux(Path(tmp_name), video_info["duration"]))
        os.replace(tmp_name, target)
    except BaseException:
        _unlink_quietly(tmp_name)
        raise
    return warnings


def verify_mux(path: Path, expected_duration: float, tolerance: float = 0.3) -> List[str]:
    warnings: List[str] = []
    probe = ffprobe_json(path)
    streams = probe.get("streams") or []
    videos = [item for item in streams if item.get("codec_type") == "video"]
    audios = [item for item in streams if item.get("codec_type") == "audio"]
    if len(videos) != 1:
        raise RunnerError(f"output has {len(videos)} video streams, expected 1", stage="verify")
    if len(audios) != 1:
        raise RunnerError(f"output has {len(audios)} audio streams, expected 1", stage="verify")
    if audios[0].get("codec_name") != "aac":
        raise RunnerError(
            f"output audio codec is {audios[0].get('codec_name')!r}, expected 'aac'",
            stage="verify",
        )
    video_duration = _stream_duration(videos[0], probe)
    if video_duration is None:
        raise RunnerError("output video duration is missing", stage="verify")
    if abs(video_duration - expected_duration) > tolerance:
        raise RunnerError(
            f"output video duration {video_duration:.3f}s differs from input "
            f"{expected_duration:.3f}s by more than {tolerance:.3f}s",
            stage="verify",
        )
    audio_duration = _stream_duration(audios[0], probe)
    if audio_duration is None:
        warnings.append("output audio stream has no duration metadata; only the video duration was verified.")
    elif abs(audio_duration - expected_duration) > tolerance:
        raise RunnerError(
            f"output audio duration {audio_duration:.3f}s differs from input video "
            f"{expected_duration:.3f}s by more than {tolerance:.3f}s",
            stage="verify",
        )
    return warnings


# ---------------------------------------------------------------------------
# Model download
# ---------------------------------------------------------------------------


def ensure_model_cached(model_id: str) -> Path:
    try:
        from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    except ImportError as exc:
        raise SetupError(
            "huggingface_hub is missing from the dedicated environment; reinstall the route."
        ) from exc

    log("setup", f"Checking model cache: {model_id}")
    try:
        cached = snapshot_download(model_id, local_files_only=True)
        path = Path(cached)
        complete, missing = snapshot_complete(path)
        if complete:
            log("setup", f"Model cache found: {path}")
            return path
        log(
            "setup",
            f"Model cache is incomplete ({len(missing)} missing/empty file(s)): "
            + ", ".join(missing[:5])
            + (" …" if len(missing) > 5 else ""),
        )
        fallback = model_cache_path(model_id)
        if fallback is not None:
            log("setup", f"Model cache found: {fallback}")
            return fallback
    except Exception:
        fallback = model_cache_path(model_id)
        if fallback is not None:
            log("setup", f"Model cache found: {fallback}")
            return fallback

    log("download", f"Downloading model weights... {model_id}")
    with Heartbeat("download", model_id):
        try:
            api = HfApi()
            info = api.model_info(model_id, files_metadata=True)
            siblings = [item for item in (info.siblings or []) if item.rfilename]
            total_bytes = sum(int(item.size or 0) for item in siblings)
            if total_bytes:
                log(
                    "download",
                    f"{len(siblings)} files, {total_bytes / 1_000_000_000:.2f} GB total "
                    "(actual progress follows from Hugging Face)",
                )
            else:
                log("download", f"{len(siblings)} files; total size unknown")
            if not siblings:
                snapshot_download(model_id)
            else:
                for index, item in enumerate(siblings, start=1):
                    hf_hub_download(model_id, item.rfilename)
                    log("download", f"{index}/{len(siblings)} files ready")
        except Exception as exc:
            # Fall back to the standard snapshot call; its cache and progress
            # behavior is still real, and the error remains actionable.
            try:
                snapshot_download(model_id)
            except Exception as fallback:
                raise RunnerError(
                    f"model download failed for {model_id}: {fallback}. "
                    "If this is a gated repository, set HF_TOKEN or run "
                    "`huggingface-cli login` first.",
                    stage="download",
                ) from exc

    try:
        path = Path(snapshot_download(model_id, local_files_only=True))
    except Exception as exc:
        raise RunnerError(
            f"model files are still incomplete after download: {model_id}",
            stage="download",
        ) from exc
    complete, missing = snapshot_complete(path)
    if not complete:
        raise RunnerError(
            f"model snapshot is still incomplete after download: {path}; "
            f"missing/empty: {', '.join(missing[:10])}",
            stage="download",
        )
    log("download", f"Download complete: {path}")
    return path


# ---------------------------------------------------------------------------
# Result file
# ---------------------------------------------------------------------------


class Result:
    def __init__(self, task: Task) -> None:
        self.path = task.base / "result.json"
        self.started = time.monotonic()
        self.data: Dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "status": "running",
            "exit_code": None,
            "started_at": now_iso(),
            "finished_at": None,
            "elapsed_sec": None,
            "task": task_summary(task),
            "environment": {
                "os": platform.system(),
                "arch": platform.machine(),
                "python": sys.executable,
                "python_version": platform.python_version(),
                "ffmpeg": {"path": FFMPEG, "version": FFMPEG_VERSION},
                "ffprobe": {"path": FFPROBE, "version": FFPROBE_VERSION},
                "api_key_present": bool(os.environ.get("ELEVENLABS_API_KEY")),
            },
            "voice": {
                "source": task.voice.source,
                "speaker": task.voice.speaker,
                "voice_id": task.voice.voice_id,
                "reference_audio": str(task.voice.reference_audio) if task.voice.reference_audio else None,
                "reference_text": task.voice.reference_text,
                "name": task.voice.name,
            },
            "clone": None,
            "srt_granularity": "segment",
            "segments": [
                {
                    "index": index,
                    "id": segment.id,
                    "text": segment.text,
                    "original_text": segment.original_text,
                    "status": "pending",
                }
                for index, segment in enumerate(task.segments)
            ],
            "outputs": [],
            "warnings": list(task.warnings),
            "error": None,
        }
        self.save()

    def save(self) -> None:
        self.data["elapsed_sec"] = round(time.monotonic() - self.started, 3)
        atomic_write_json(self.path, self.data)

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value
        self.save()

    def update_environment(self, values: Dict[str, Any]) -> None:
        self.data["environment"].update(values)
        self.save()

    def add_warning(self, message: str) -> None:
        if message not in self.data["warnings"]:
            self.data["warnings"].append(message)
            self.save()

    def set_voice(self, **values: Any) -> None:
        self.data["voice"].update(values)
        if any(
            self.data["voice"].get(key) is not None
            for key in ("voice_id", "requires_verification", "name")
        ):
            self.data["clone"] = {
                "voice_id": self.data["voice"].get("voice_id"),
                "requires_verification": self.data["voice"].get("requires_verification"),
                "name": self.data["voice"].get("name"),
            }
        self.save()

    def set_segment(self, index: int, **values: Any) -> None:
        if 0 <= index < len(self.data["segments"]):
            self.data["segments"][index].update(values)
            self.save()

    def add_output(self, kind: str, path: Path, duration: float, *, sample_rate: Optional[int] = None, note: Optional[str] = None) -> None:
        item = {
            "kind": kind,
            "path": str(Path(path).resolve()),
            "duration_sec": round(float(duration), 3),
        }
        if sample_rate is not None:
            item["sample_rate"] = int(sample_rate)
        if note:
            item["note"] = note
        self.data["outputs"].append(item)
        self.save()

    def set_status(self, status: str, exit_code: int, error: Optional[Dict[str, Any]] = None) -> None:
        self.data["status"] = status
        self.data["exit_code"] = exit_code
        self.data["error"] = error
        self.data["finished_at"] = now_iso()
        self.save()


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------


class Adapter:
    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        raise NotImplementedError

    def synthesize(self, text: str, output_path: Path) -> int:
        raise NotImplementedError

    def close(self) -> None:
        pass

    def voice_identity(self) -> Dict[str, Any]:
        return {}

    def environment(self) -> Dict[str, Any]:
        return {}


class MLXAdapter(Adapter):
    def __init__(self, task: Task, result: Result, model_loader: Optional[Any] = None) -> None:
        self.task = task
        self.result = result
        self.model_loader = model_loader
        self.model = None
        self.model_path: Optional[Path] = None
        self.speaker: Optional[str] = None
        self.reference_audio: Optional[Path] = None
        self.reference_text: Optional[str] = None

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        if task is not None:
            self.task = task
        if self.model_loader is None:
            from mlx_audio.tts.utils import load_model

            self.model_loader = load_model
        if self.task.voice.source == "clone":
            source = self.task.voice.reference_audio
            text = self.task.voice.reference_text
            if source is None or not text:
                raise TaskError("Local cloning requires reference_audio and reference_text.")
            self.reference_text = text
            self.reference_audio = self.task.work_dir / "reference_local.wav"
            normalize_reference_audio(source, self.reference_audio, 24000)
        self.model_path = ensure_model_cached(self.task.model_id)
        log("load", f"Loading model into memory... {self.task.model_id}")
        try:
            with Heartbeat("load", self.task.model_id):
                self.model = self.model_loader(self.model_path)
        except Exception as exc:
            raise RunnerError(
                f"failed to load MLX model {self.task.model_id}: {exc}. "
                "Check available memory and that the model cache is complete.",
                stage="load",
            ) from exc
        log("load", "Model ready")

        config = getattr(self.model, "config", None)
        model_type = getattr(config, "tts_model_type", None)
        if self.task.voice.source == "preset":
            if model_type != "custom_voice":
                raise TaskError(
                    f"model {self.task.model_id} is not a CustomVoice model; "
                    "preset voices require the CustomVoice model."
                )
            speakers = [str(item) for item in (getattr(self.model, "supported_speakers", []) or [])]
            if not speakers:
                raise TaskError("The model exposes no supported speaker list; preset voices cannot be verified.")
            match = next((item for item in speakers if item.lower() == (self.task.voice.speaker or "").lower()), None)
            if match is None:
                raise TaskError(
                    f"speaker {self.task.voice.speaker!r} is not supported by {self.task.model_id}; "
                    f"supported: {', '.join(speakers)}"
                )
            self.speaker = match
        else:
            if model_type != "base":
                raise TaskError(
                    f"model {self.task.model_id} is not a Base model; cloning requires the Base model."
                )

        languages = [str(item) for item in (getattr(self.model, "supported_languages", []) or [])]
        if languages and self.task.language.lower() not in [item.lower() for item in languages]:
            raise TaskError(
                f"language {self.task.language!r} is not supported by {self.task.model_id}; "
                f"supported: {', '.join(languages)}"
            )
        if not languages:
            warn("model exposes no language list; the backend will validate the language at synthesis time.")
        self.result.update_environment(
            {
                "route": "mlx_audio",
                "model_path": str(self.model_path),
                "model_type": model_type,
                "model_sample_rate": getattr(self.model, "sample_rate", None),
            }
        )

    def synthesize(self, text: str, output_path: Path) -> int:
        np = _np()
        if self.model is None:
            raise RunnerError("MLX model is not loaded", stage="synthesis")
        kwargs: Dict[str, Any] = {
            "text": text,
            "voice": self.speaker,
            "instruct": self.task.parameters.get("instruct") or None,
            "lang_code": self.task.language,
            "split_pattern": None,
            # Bound generation even if the model degenerates into a repetition
            # loop; ~5 tokens per input char is >2x the expected 12 Hz audio.
            "max_tokens": max(128, int(len(text) * 5)),
        }
        if self.task.voice.source == "clone":
            kwargs["voice"] = None
            kwargs["instruct"] = None
            kwargs["ref_audio"] = str(self.reference_audio)
            kwargs["ref_text"] = self.reference_text

        try:
            results = self.model.generate(**kwargs)
            pieces = []
            sample_rate: Optional[int] = None
            for item in results:
                audio = getattr(item, "audio", None)
                if audio is None:
                    continue
                piece = np.asarray(audio, dtype=np.float32)
                if piece.ndim == 1:
                    pass
                elif piece.ndim == 2:
                    if piece.shape[1] == 1:
                        piece = piece[:, 0]
                    else:
                        piece = piece.mean(axis=1, dtype=np.float32)
                else:
                    raise RunnerError(
                        f"unexpected audio shape from MLX model: {piece.shape}",
                        stage="synthesis",
                    )
                rate = getattr(item, "sample_rate", None) or getattr(self.model, "sample_rate", None)
                if rate is None:
                    raise RunnerError(
                        "MLX model returned audio without a sample rate; refusing to guess.",
                        stage="synthesis",
                    )
                if sample_rate is None:
                    sample_rate = int(rate)
                elif int(rate) != sample_rate:
                    raise RunnerError(
                        f"MLX model returned mixed sample rates ({sample_rate} and {rate})",
                        stage="synthesis",
                    )
                pieces.append(piece)
        except RunnerError:
            raise
        except Exception as exc:
            message = str(exc)
            if "out of memory" in message.lower() or isinstance(exc, MemoryError):
                raise RunnerError(
                    f"MLX ran out of memory: {message}. Close other memory-heavy "
                    "applications and retry; this runner does not switch models.",
                    stage="synthesis",
                ) from exc
            raise RunnerError(
                f"MLX synthesis failed: {message}",
                stage="synthesis",
                retryable=True,
            ) from exc
        if not pieces or sample_rate is None:
            raise RunnerError("MLX model returned no audio", stage="synthesis")
        audio = pieces[0] if len(pieces) == 1 else np.concatenate(pieces, axis=0)
        write_wav_float(output_path, audio, sample_rate)
        return sample_rate

    def close(self) -> None:
        self.model = None
        try:
            import gc

            gc.collect()
        except Exception:
            pass

    def voice_identity(self) -> Dict[str, Any]:
        if self.task.voice.source == "preset":
            return {"speaker": self.speaker}
        assert self.reference_audio is not None
        return {
            "reference_sha256": sha256_file(self.reference_audio),
            "reference_text": self.reference_text,
        }

    def environment(self) -> Dict[str, Any]:
        return {
            "route": "mlx_audio",
            "model_id": self.task.model_id,
            "model_path": str(self.model_path) if self.model_path else None,
            "sample_rate": getattr(self.model, "sample_rate", None) if self.model else None,
        }


class QwenTorchAdapter(Adapter):
    def __init__(
        self,
        task: Task,
        result: Result,
        *,
        torch_module: Optional[Any] = None,
        model_factory: Optional[Any] = None,
    ) -> None:
        self.task = task
        self.result = result
        self.torch_module = torch_module
        self.model_factory = model_factory
        self.model = None
        self.model_path: Optional[Path] = None
        self.speaker: Optional[str] = None
        self.clone_prompt = None
        self.reference_audio: Optional[Path] = None
        self.reference_text: Optional[str] = None
        self.dtype_name = "bfloat16"

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        if task is not None:
            self.task = task
        if self.torch_module is None:
            import torch as torch_module

            self.torch_module = torch_module
        if not self.torch_module.cuda.is_available():
            raise SetupError(
                "torch.cuda is unavailable. Check the NVIDIA driver, the CUDA "
                "wheel build, and nvidia-smi; this runner will not fall back to CPU."
            )
        dtype = self.torch_module.bfloat16
        if hasattr(self.torch_module.cuda, "is_bf16_supported") and not self.torch_module.cuda.is_bf16_supported():
            dtype = self.torch_module.float16
            self.dtype_name = "float16"
            warn("GPU does not support bfloat16; using float16 for this run.")
        else:
            self.dtype_name = "bfloat16"

        if self.task.voice.source == "clone":
            source = self.task.voice.reference_audio
            text = self.task.voice.reference_text
            if source is None or not text:
                raise TaskError("Local cloning requires reference_audio and reference_text.")
            self.reference_text = text
            self.reference_audio = self.task.work_dir / "reference_local.wav"
            normalize_reference_audio(source, self.reference_audio, 24000)

        self.model_path = ensure_model_cached(self.task.model_id)
        log("load", f"Loading model into memory... {self.task.model_id}")
        try:
            with Heartbeat("load", self.task.model_id):
                if self.model_factory is not None:
                    self.model = self.model_factory(
                        self.model_path,
                        dtype=dtype,
                        attn_implementation="sdpa",
                        device_map="cuda",
                    )
                else:
                    try:
                        from qwen_tts import Qwen3TTSModel
                    except ImportError:
                        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel

                    self.model = Qwen3TTSModel.from_pretrained(
                        str(self.model_path),
                        dtype=dtype,
                        attn_implementation="sdpa",
                        device_map="cuda",
                    )
        except Exception as exc:
            message = str(exc)
            if "out of memory" in message.lower():
                raise RunnerError(
                    f"CUDA ran out of memory while loading {self.task.model_id}: {message}. "
                    "Close other GPU applications and retry; this runner does not "
                    "switch to a smaller model or CPU.",
                    stage="load",
                ) from exc
            raise RunnerError(
                f"failed to load qwen-tts model {self.task.model_id}: {message}",
                stage="load",
            ) from exc
        log("load", "Model ready")

        if self.task.voice.source == "preset":
            check = getattr(self.model, "get_supported_speakers", None)
            speakers = check() if callable(check) else None
            if speakers:
                match = next((item for item in speakers if str(item).lower() == (self.task.voice.speaker or "").lower()), None)
                if match is None:
                    raise TaskError(
                        f"speaker {self.task.voice.speaker!r} is not supported by {self.task.model_id}; "
                        f"supported: {', '.join(str(item) for item in speakers)}"
                    )
                self.speaker = str(match)
            else:
                self.speaker = self.task.voice.speaker
        else:
            if self.reference_audio is None or not self.reference_text:
                raise TaskError("Local cloning requires reference_audio and reference_text.")
            try:
                self.clone_prompt = self.model.create_voice_clone_prompt(
                    str(self.reference_audio),
                    ref_text=self.reference_text,
                    x_vector_only_mode=False,
                )
            except Exception as exc:
                raise RunnerError(
                    f"failed to build the voice-clone prompt: {exc}",
                    stage="load",
                ) from exc

        check_lang = getattr(self.model, "get_supported_languages", None)
        languages = check_lang() if callable(check_lang) else None
        if languages and self.task.language.lower() not in [str(item).lower() for item in languages]:
            raise TaskError(
                f"language {self.task.language!r} is not supported by {self.task.model_id}; "
                f"supported: {', '.join(str(item) for item in languages)}"
            )
        if not languages:
            warn("qwen-tts exposes no language list; the backend will validate the language at synthesis time.")

        self.result.update_environment(
            {
                "route": "qwen_tts",
                "model_path": str(self.model_path),
                "dtype": self.dtype_name,
                "device": "cuda",
            }
        )

    def synthesize(self, text: str, output_path: Path) -> int:
        np = _np()
        if self.model is None:
            raise RunnerError("qwen-tts model is not loaded", stage="synthesis")
        try:
            if self.task.voice.source == "preset":
                audios, rate = self.model.generate_custom_voice(
                    text,
                    speaker=self.speaker,
                    language=self.task.language,
                    instruct=self.task.parameters.get("instruct") or None,
                )
            else:
                audios, rate = self.model.generate_voice_clone(
                    text,
                    language=self.task.language,
                    voice_clone_prompt=self.clone_prompt,
                )
        except Exception as exc:
            message = str(exc)
            if "out of memory" in message.lower():
                raise RunnerError(
                    f"CUDA ran out of memory during synthesis: {message}. Close other "
                    "GPU applications and retry; this runner does not switch models.",
                    stage="synthesis",
                ) from exc
            raise RunnerError(
                f"qwen-tts synthesis failed: {message}",
                stage="synthesis",
                retryable=True,
            ) from exc
        if not isinstance(audios, list) or len(audios) != 1:
            raise RunnerError(
                f"qwen-tts returned {len(audios) if isinstance(audios, list) else type(audios)} "
                "audio results for one text; expected exactly one.",
                stage="synthesis",
            )
        audio = np.asarray(audios[0], dtype=np.float32)
        if audio.ndim == 2:
            audio = audio.mean(axis=1, dtype=np.float32) if audio.shape[1] > 1 else audio[:, 0]
        if audio.ndim != 1:
            raise RunnerError(f"unexpected qwen-tts audio shape: {audio.shape}", stage="synthesis")
        write_wav_float(output_path, audio, int(rate))
        return int(rate)

    def close(self) -> None:
        self.model = None
        self.clone_prompt = None
        try:
            import gc

            gc.collect()
            if self.torch_module is not None and self.torch_module.cuda.is_available():
                self.torch_module.cuda.empty_cache()
        except Exception:
            pass

    def voice_identity(self) -> Dict[str, Any]:
        if self.task.voice.source == "preset":
            return {"speaker": self.speaker}
        assert self.reference_audio is not None
        return {
            "reference_sha256": sha256_file(self.reference_audio),
            "reference_text": self.reference_text,
        }

    def environment(self) -> Dict[str, Any]:
        return {
            "route": "qwen_tts",
            "model_id": self.task.model_id,
            "model_path": str(self.model_path) if self.model_path else None,
            "dtype": self.dtype_name,
            "device": "cuda",
        }


class ElevenLabsAdapter(Adapter):
    def __init__(
        self,
        task: Task,
        result: Result,
        *,
        session_factory: Optional[Any] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        self.task = task
        self.result = result
        self.session_factory = session_factory
        self.api_key = api_key or os.environ.get("ELEVENLABS_API_KEY")
        self.base_url = (base_url or os.environ.get("ELEVENLABS_API_BASE") or "https://api.elevenlabs.io").rstrip("/")
        self.session: Optional[Any] = None
        self.voice_id: Optional[str] = None
        self.voice_name: Optional[str] = None
        self.requires_verification: Optional[bool] = None
        # MP3 128kbps/44.1kHz is broadly available; 44.1kHz WAV may require a
        # Pro plan on ElevenLabs accounts.
        self.output_format = self.task.parameters.get("output_format", "mp3_44100_128")

    def _requests(self):
        try:
            import requests
        except ImportError as exc:
            raise SetupError(
                "requests is missing from the online environment; reinstall the online route."
            ) from exc
        return requests

    def _session(self):
        if self.session is None:
            requests = self._requests()
            self.session = (
                self.session_factory()
                if self.session_factory is not None
                else requests.Session()
            )
            self.session.headers.update(
                {
                    "xi-api-key": self.api_key or "",
                    "accept": "application/json",
                }
            )
        return self.session

    def _sanitize(self, text: str) -> str:
        if self.api_key:
            text = text.replace(self.api_key, "***")
        return text[:1000]

    def _request(self, method: str, path: str, **kwargs: Any):
        requests = self._requests()
        url = f"{self.base_url}{path}"
        session = self._session()
        try:
            response = session.request(method, url, timeout=(15, 300), **kwargs)
        except requests.exceptions.ConnectTimeout as exc:
            raise RunnerError(
                f"ElevenLabs connection timed out: {self._sanitize(str(exc))}",
                stage="online",
                retryable=True,
            ) from exc
        except requests.exceptions.ReadTimeout as exc:
            raise RunnerError(
                f"ElevenLabs read timed out after the request was sent; submission state "
                f"is unknown: {self._sanitize(str(exc))}. Not retrying to avoid duplicate billing.",
                stage="online",
                submission_unknown=True,
            ) from exc
        except requests.exceptions.SSLError as exc:
            raise RunnerError(
                f"ElevenLabs TLS error: {self._sanitize(str(exc))}",
                stage="online",
            ) from exc
        except requests.exceptions.ConnectionError as exc:
            raise RunnerError(
                f"ElevenLabs connection failed; submission state is unknown: "
                f"{self._sanitize(str(exc))}. Not retrying to avoid duplicate billing.",
                stage="online",
                submission_unknown=True,
            ) from exc
        except (
            requests.exceptions.ChunkedEncodingError,
            requests.exceptions.ContentDecodingError,
        ) as exc:
            raise RunnerError(
                f"ElevenLabs response was interrupted after the request was sent; "
                f"submission state is unknown: {self._sanitize(str(exc))}. "
                "Not retrying to avoid duplicate billing.",
                stage="online",
                submission_unknown=True,
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise RunnerError(
                f"ElevenLabs request failed: {self._sanitize(str(exc))}",
                stage="online",
                retryable=True,
            ) from exc

        if response.status_code in (200, 201):
            return response
        detail = self._sanitize(getattr(response, "text", "") or "")
        if response.status_code in (401, 403):
            raise RunnerError(
                "ElevenLabs rejected the API key (401/403). Set a valid "
                "ELEVENLABS_API_KEY and retry; no automatic provider or model switch.",
                stage="online",
                details={"http_status": response.status_code},
            )
        if response.status_code == 402:
            raise RunnerError(
                "ElevenLabs reports a quota/payment problem (402). Check the account "
                "plan and billing, then retry.",
                stage="online",
                details={"http_status": response.status_code},
            )
        if response.status_code == 404:
            raise ActionRequired(
                "ElevenLabs could not find the requested model or voice (404). "
                "Choose an available voice/model with the control flow.",
                status="needs_action",
                details={"http_status": 404, "body": detail},
            )
        if response.status_code == 422:
            raise RunnerError(
                f"ElevenLabs rejected the request (422): {detail}",
                stage="online",
                details={"http_status": 422, "body": detail},
            )
        if response.status_code in (408, 409, 429):
            retry_after = None
            raw = response.headers.get("Retry-After") if hasattr(response, "headers") else None
            if raw:
                try:
                    retry_after = float(raw)
                except (TypeError, ValueError):
                    retry_after = None
            raise RunnerError(
                f"ElevenLabs temporarily rejected the request "
                f"({response.status_code}): {detail}",
                stage="online",
                retryable=True,
                retry_after=retry_after,
                details={"http_status": response.status_code},
            )
        if 500 <= response.status_code < 600:
            raise RunnerError(
                f"ElevenLabs server error ({response.status_code}): {detail}",
                stage="online",
                retryable=True,
                details={"http_status": response.status_code},
            )
        raise RunnerError(
            f"ElevenLabs returned unexpected HTTP {response.status_code}: {detail}",
            stage="online",
            details={"http_status": response.status_code},
        )

    def prepare(self, task: Optional[Task] = None, progress: Optional[Any] = None) -> None:
        if task is not None:
            self.task = task
        if not self.api_key:
            raise SetupError(
                "ELEVENLABS_API_KEY is not set. Set it in the environment and retry; "
                "do not paste the key into task.json or chat."
            )
        payload = self._request("GET", "/v1/models").json()
        available = [
            item.get("model_id")
            for item in payload
            if isinstance(item, dict) and item.get("model_id")
        ]
        if self.task.model_id not in available:
            raise ActionRequired(
                f"ElevenLabs model {self.task.model_id!r} is not available on this account. "
                "Choose one of the available models with the control flow.",
                status="needs_action",
                details={"available_models": available, "requested_model": self.task.model_id},
            )
        log("setup", f"ElevenLabs model available: {self.task.model_id}")

        if self.task.voice.voice_id:
            self.voice_id = self.task.voice.voice_id
            response = self._request("GET", f"/v1/voices/{self.voice_id}")
            info = response.json()
            self.voice_name = info.get("name")
            if info.get("requires_verification"):
                self.requires_verification = True
                self.result.set_voice(
                    voice_id=self.voice_id,
                    requires_verification=True,
                    name=self.voice_name,
                )
            log("setup", f"ElevenLabs voice available: {self.voice_name or self.voice_id} ({self.voice_id})")
        elif self.task.voice.source == "clone":
            self._create_clone()
        else:
            raise TaskError("ElevenLabs preset voice requires voice.voice_id.")

        if self.requires_verification:
            raise ActionRequired(
                f"The ElevenLabs voice (voice_id {self.voice_id}) requires verification "
                "before it can be used. Complete verification in the ElevenLabs "
                "dashboard, then rerun this task with the saved voice_id.",
                status="needs_action",
                details={
                    "voice_id": self.voice_id,
                    "requires_verification": True,
                    "next": "verify the voice, set voice.voice_id, and set voice.reference_audio to null",
                },
            )

        self.result.update_environment(
            {
                "route": "elevenlabs_http",
                "base_url": self.base_url,
                "model_id": self.task.model_id,
                "voice_id": self.voice_id,
                "voice_name": self.voice_name,
                "requires_verification": self.requires_verification,
            }
        )

    def _create_clone(self) -> None:
        assert self.task.voice.reference_audio is not None
        source = self.task.voice.reference_audio
        # Upload a decoded mono WAV so a video/container reference is accepted.
        path = self.task.work_dir / "reference_upload.wav"
        normalize_reference_audio(source, path, 44100)
        reference_sha = sha256_file(path)
        name = self.task.voice.name or f"video-tts-{reference_sha[:8]}"

        saved = read_clone_state(self.task)
        if (
            saved is not None
            and saved.get("reference_sha256") == reference_sha
            and saved.get("name") == name
            and saved.get("voice_id")
        ):
            self.voice_id = str(saved["voice_id"])
            self.voice_name = name
            self.requires_verification = bool(saved.get("requires_verification"))
            self.result.set_voice(
                voice_id=self.voice_id,
                requires_verification=self.requires_verification,
                name=name,
            )
            log(
                "clone",
                f"Reusing saved clone voice_id {self.voice_id}; no duplicate creation",
            )
            return

        log("clone", f"Creating ElevenLabs voice clone once: {name}")
        data = {
            "name": name,
            "remove_background_noise": "true" if self.task.parameters.get("remove_background_noise") else "false",
        }
        try:
            with open(path, "rb") as handle:
                files = {"files": (path.name, handle, "audio/wav")}
                response = self._request("POST", "/v1/voices/add", data=data, files=files)
        except RunnerError as exc:
            if exc.submission_unknown:
                raise RunnerError(
                    "The clone creation request state is unknown. Do not retry blindly: "
                    "check the ElevenLabs voice list first, because a duplicate clone may "
                    "already exist.",
                    stage="clone",
                    submission_unknown=True,
                ) from exc
            raise
        try:
            payload = response.json()
        except Exception as exc:
            raise RunnerError(
                f"ElevenLabs clone response was not valid JSON: {exc}",
                stage="clone",
            ) from exc
        voice_id = payload.get("voice_id")
        if not voice_id:
            raise RunnerError(
                f"ElevenLabs clone response did not include voice_id: {payload}",
                stage="clone",
            )
        self.voice_id = str(voice_id)
        self.voice_name = name
        self.requires_verification = bool(payload.get("requires_verification"))
        self.result.set_voice(
            voice_id=self.voice_id,
            requires_verification=self.requires_verification,
            name=name,
        )
        write_clone_state(
            self.task,
            {
                "provider": "elevenlabs",
                "reference_sha256": reference_sha,
                "name": name,
                "voice_id": self.voice_id,
                "requires_verification": self.requires_verification,
                "created_at": now_iso(),
            },
        )
        log(
            "clone",
            f"Created voice_id {self.voice_id}; requires_verification={self.requires_verification}",
        )

    def synthesize(self, text: str, output_path: Path) -> int:
        if not self.voice_id:
            raise RunnerError("ElevenLabs voice_id is not ready", stage="synthesis")
        payload: Dict[str, Any] = {
            "text": text,
            "model_id": self.task.model_id,
        }
        settings = self.task.parameters.get("voice_settings")
        if settings:
            payload["voice_settings"] = settings
        if self.task.model_id == "eleven_flash_v2_5" and self.task.language != "auto":
            iso = LANGUAGE_ISO.get(self.task.language)
            if iso:
                payload["language_code"] = iso
        params = {"output_format": self.output_format}
        response = self._request(
            "POST",
            f"/v1/text-to-speech/{self.voice_id}",
            params=params,
            json=payload,
            headers={"accept": "audio/wav"},
        )
        content = response.content
        if not content:
            raise RunnerError(
                "ElevenLabs returned an empty response; not retrying automatically "
                "because the request may already be billed.",
                stage="synthesis",
            )
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        is_wav = content[:4] == b"RIFF"
        suffix = ".wav" if is_wav else ".mp3"
        fd, tmp_name = tempfile.mkstemp(
            dir=str(output_path.parent), prefix=f".{output_path.name}.", suffix=suffix
        )
        os.close(fd)
        decoded = Path(tmp_name + ".decoded.wav")
        try:
            with open(tmp_name, "wb") as handle:
                handle.write(content)
            if is_wav:
                samples, rate = read_wav(Path(tmp_name))
            else:
                command = [
                    FFMPEG,
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    tmp_name,
                    "-vn",
                    "-ac",
                    "1",
                    str(decoded),
                ]
                try:
                    result = subprocess.run(command, capture_output=True, timeout=300)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    raise RunnerError(
                        f"ElevenLabs audio could not be decoded: {exc}",
                        stage="synthesis",
                    ) from exc
                if result.returncode != 0:
                    raise RunnerError(
                        "ElevenLabs returned audio that ffmpeg could not decode: "
                        f"{_decode_bytes(result.stderr).strip()}",
                        stage="synthesis",
                    )
                samples, rate = read_wav(decoded)
            validate_pcm(samples, rate)
            write_wav_float(output_path, samples, rate)
        except RunnerError:
            raise
        except Exception as exc:
            raise RunnerError(
                f"ElevenLabs returned unreadable audio: {exc}",
                stage="synthesis",
            ) from exc
        finally:
            _unlink_quietly(tmp_name)
            _unlink_quietly(decoded)
        return int(rate)

    def close(self) -> None:
        if self.session is not None:
            try:
                self.session.close()
            except Exception:
                pass
            self.session = None

    def voice_identity(self) -> Dict[str, Any]:
        return {"voice_id": self.voice_id, "model_id": self.task.model_id}

    def environment(self) -> Dict[str, Any]:
        return {
            "route": "elevenlabs_http",
            "base_url": self.base_url,
            "model_id": self.task.model_id,
            "voice_id": self.voice_id,
            "voice_name": self.voice_name,
            "requires_verification": self.requires_verification,
            "output_format": self.output_format,
        }


def build_adapter(task: Task, result: Result) -> Adapter:
    if task.provider == "local":
        if task.backend == "mlx_audio":
            return MLXAdapter(task, result)
        return QwenTorchAdapter(task, result)
    return ElevenLabsAdapter(task, result)


def clone_state_path(task: Task) -> Path:
    return task.base / "clone.json"


def read_clone_state(task: Task) -> Optional[Dict[str, Any]]:
    path = clone_state_path(task)
    if not path.is_file():
        return None
    try:
        data = _read_json(path)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def write_clone_state(task: Task, data: Dict[str, Any]) -> None:
    atomic_write_json(clone_state_path(task), data)


def normalize_reference_audio(path: Path, target: Path, sample_rate: int = 24000) -> float:
    """Decode any media containing audio into a mono WAV used for cloning.

    The upload/generation path should not depend on the container the user
    supplied.  Validation and normalization happen before a model is loaded or
    an online clone is created, so a bad reference fails fast.
    """
    path = Path(path)
    if not path.is_file():
        raise TaskError(f"reference audio does not exist: {path}")
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        FFMPEG,
        "-y",
        "-v",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "-c:a",
        "pcm_s16le",
        str(target),
    ]
    try:
        result = subprocess.run(command, capture_output=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise TaskError(f"reference audio could not be decoded: {path}: {exc}") from exc
    if result.returncode != 0:
        raise TaskError(
            f"reference audio could not be decoded: {path}: "
            f"{_decode_bytes(result.stderr).strip()}"
        )
    pcm, actual_rate = read_wav(target)
    if int(actual_rate) != sample_rate:
        raise TaskError(
            f"reference decoder produced {actual_rate} Hz instead of {sample_rate} Hz"
        )
    duration = validate_pcm(pcm, actual_rate, min_seconds=0.5)
    return duration


# ---------------------------------------------------------------------------
# Synthesis, fitting, track building, delivery
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class NativeSegment:
    segment: Segment
    path: Path
    sample_rate: int
    duration: float
    cache_hits: int
    chunks: int


@dataclasses.dataclass
class ProcessedSegment:
    segment: Segment
    path: Path
    duration: float
    native_duration: float
    native_rate: int
    speed: float
    overflow: Optional[Dict[str, Any]] = None
    start_sec: Optional[float] = None
    end_sec: Optional[float] = None


@dataclasses.dataclass
class TrackInfo:
    path: Path
    duration: float
    sample_rate: int


def split_text(text: str, backend: str) -> List[str]:
    limit = 2000 if backend == "elevenlabs_http" else 280
    parts = re.split(r"(?<=[。！？!?；;\n])", text)
    chunks: List[str] = []
    current = ""
    for part in parts:
        if not part:
            continue
        if len(current) + len(part) <= limit:
            current += part
            continue
        if current:
            chunks.append(current)
            current = ""
        while len(part) > limit:
            chunks.append(part[:limit])
            part = part[limit:]
        current = part
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if chunk.strip()]


def cache_key(task: Task, voice_identity: Dict[str, Any], text: str) -> str:
    material = {
        "schema": SCHEMA_VERSION,
        "provider": task.provider,
        "backend": task.backend,
        "model_id": task.model_id,
        "language": task.language,
        "voice": voice_identity,
        "parameters": task.parameters,
        "text": text,
    }
    payload = json.dumps(material, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _load_cached_audio(path: Path) -> Optional[Tuple[Any, int]]:
    if not path.is_file():
        return None
    try:
        pcm, sample_rate = read_wav(path)
        validate_pcm(pcm, sample_rate)
        return pcm, sample_rate
    except Exception:
        _unlink_quietly(path)
        return None


def with_retry(fn: Any, *, attempts: int = RETRY_ATTEMPTS) -> Any:
    last: Optional[RunnerError] = None
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except RunnerError as exc:
            last = exc
            if exc.submission_unknown or not exc.retryable or attempt >= attempts:
                raise
            delay = exc.retry_after if exc.retry_after is not None else RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
            log("retry", f"attempt {attempt}/{attempts} failed: {exc.message}; retrying in {delay:.1f}s")
            time.sleep(delay)
    if last is not None:
        raise last
    raise RunnerError("retry helper called without a result", stage="internal")


def synthesize_segment(
    task: Task,
    adapter: Adapter,
    result: Result,
    index: int,
    segment: Segment,
) -> NativeSegment:
    chunks = split_text(segment.text, task.backend)
    if not chunks:
        raise TaskError(f"segment {segment.id} contains no speakable text.")
    identity = adapter.voice_identity()
    paths: List[Path] = []
    cache_hits = 0
    for chunk_index, chunk in enumerate(chunks, start=1):
        key = cache_key(task, identity, chunk)
        cache_path = task.work_dir / "segments" / f"{key}.wav"
        cached = _load_cached_audio(cache_path)
        if cached is not None:
            cache_hits += 1
            log("cache", f"segment {segment.id} chunk {chunk_index}/{len(chunks)}: cache hit")
        else:
            log(
                "synthesis",
                f"Generating segment {segment.id} chunk {chunk_index}/{len(chunks)}...",
            )

            def do_synthesis() -> None:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                fd, tmp_name = tempfile.mkstemp(
                    dir=str(cache_path.parent), prefix=f".{cache_path.name}.", suffix=".wav"
                )
                os.close(fd)
                try:
                    adapter.synthesize(chunk, Path(tmp_name))
                    pcm, sample_rate = read_wav(Path(tmp_name))
                    validate_pcm(pcm, sample_rate)
                    os.replace(tmp_name, cache_path)
                except RunnerError:
                    _unlink_quietly(tmp_name)
                    raise
                except Exception as exc:
                    _unlink_quietly(tmp_name)
                    raise RunnerError(
                        f"invalid synthesized audio for segment {segment.id}: {exc}",
                        stage="synthesis",
                        segment_id=segment.id,
                    ) from exc

            try:
                with Heartbeat("synthesis", f"segment {segment.id}"):
                    with_retry(do_synthesis)
            except RunnerError as exc:
                exc.segment_id = segment.id
                raise
            log("synthesis", f"segment {segment.id} chunk {chunk_index}/{len(chunks)} done")
        paths.append(cache_path)

    rates = {wav_info(path)[1] for path in paths}
    if len(rates) != 1:
        raise RunnerError(
            f"segment {segment.id} produced mixed sample rates: {sorted(rates)}",
            stage="synthesis",
            segment_id=segment.id,
        )
    sample_rate = rates.pop()
    if len(paths) == 1:
        native_path = paths[0]
    else:
        native_path = task.work_dir / "native" / f"seg_{segment.id:04d}.wav"
        concat_wavs(paths, native_path, 0.0, sample_rate)
    pcm, actual_rate = read_wav(native_path)
    duration = validate_pcm(pcm, actual_rate)
    result.set_segment(
        index,
        status="synthesized",
        native_path=str(native_path),
        native_duration=round(duration, 3),
        native_sample_rate=actual_rate,
        cache_hits=cache_hits,
        chunks=len(chunks),
    )
    return NativeSegment(
        segment=segment,
        path=native_path,
        sample_rate=actual_rate,
        duration=duration,
        cache_hits=cache_hits,
        chunks=len(chunks),
    )


def synthesize_all(task: Task, adapter: Adapter, result: Result) -> List[NativeSegment]:
    # Local models are sequential; online synthesis is intentionally serial too
    # (no thread pool, cancellation or in-flight cache races).
    return [
        synthesize_segment(task, adapter, result, index, segment)
        for index, segment in enumerate(task.segments)
    ]


def fit_to_window(
    pcm: Any,
    sample_rate: int,
    window: float,
    max_speed: float,
    target: Path,
) -> Tuple[Any, float, float, Optional[Dict[str, Any]]]:
    np = _np()
    duration = np.asarray(pcm).size / sample_rate
    if window <= 0:
        return pcm, duration, 1.0, {
            "reason": "no_window",
            "synth_duration": duration,
            "window": window,
            "required_speed": None,
        }
    if duration <= window + FIT_TOLERANCE:
        write_wav_float(target, pcm, sample_rate)
        return pcm, duration, 1.0, None
    required = duration / window
    if required > max_speed:
        return pcm, duration, 1.0, {
            "reason": "overflow",
            "synth_duration": duration,
            "window": window,
            "required_speed": required,
            "max_speed": max_speed,
        }
    speed = min(required * 1.001, max_speed)
    output = change_speed(pcm, speed, sample_rate)
    actual = np.asarray(output).size / sample_rate
    if actual > window + FIT_TOLERANCE:
        correction = actual / window
        combined = speed * correction
        if combined > max_speed:
            return pcm, duration, 1.0, {
                "reason": "overflow_after_measure",
                "synth_duration": duration,
                "window": window,
                "required_speed": combined,
                "max_speed": max_speed,
            }
        speed = combined
        output = change_speed(pcm, speed, sample_rate)
        actual = np.asarray(output).size / sample_rate
        if actual > window + FIT_TOLERANCE:
            return pcm, duration, 1.0, {
                "reason": "overflow_after_remeasure",
                "synth_duration": duration,
                "window": window,
                "required_speed": speed,
                "max_speed": max_speed,
            }
    write_wav_float(target, output, sample_rate)
    return output, actual, speed, None


def process_all(task: Task, native: Sequence[NativeSegment], result: Result) -> List[ProcessedSegment]:
    processed: List[ProcessedSegment] = []
    for index, item in enumerate(native):
        pcm, sample_rate = read_wav(item.path)
        validate_pcm(pcm, sample_rate)
        trimmed = trim_silence(pcm, sample_rate)
        master = resample_audio(trimmed, sample_rate, SAMPLE_RATE)
        processed_path = task.work_dir / "processed" / f"seg_{item.segment.id:04d}.wav"
        write_wav_float(processed_path, master, SAMPLE_RATE)
        duration = validate_pcm(master, SAMPLE_RATE)
        record = ProcessedSegment(
            segment=item.segment,
            path=processed_path,
            duration=duration,
            native_duration=item.duration,
            native_rate=item.sample_rate,
            speed=1.0,
        )
        if task.mode == "aligned":
            assert item.segment.window_sec is not None
            fitted_path = task.work_dir / "fitted" / f"seg_{item.segment.id:04d}.wav"
            output, actual, speed, overflow = fit_to_window(
                master,
                SAMPLE_RATE,
                item.segment.window_sec,
                task.timing.max_speed,
                fitted_path,
            )
            record.duration = actual
            record.speed = speed
            if overflow is not None:
                record.overflow = overflow
                record.path = processed_path
                result.set_segment(
                    index,
                    status="overflow",
                    window_sec=round(item.segment.window_sec, 3),
                    synth_duration=round(overflow.get("synth_duration", duration), 3),
                    required_speed=overflow.get("required_speed"),
                    max_speed=task.timing.max_speed,
                    speed=1.0,
                )
            else:
                record.path = fitted_path
                result.set_segment(
                    index,
                    status="fit",
                    window_sec=round(item.segment.window_sec, 3),
                    duration=round(actual, 3),
                    speed=round(speed, 4),
                )
        else:
            result.set_segment(
                index,
                status="processed",
                duration=round(duration, 3),
                speed=1.0,
            )
        result.save()
        processed.append(record)
    return processed


def build_narration_track(
    task: Task, processed: Sequence[ProcessedSegment], result: Result
) -> TrackInfo:
    placements: List[Tuple[float, Path, int]] = []
    cursor = 0.0
    for index, item in enumerate(processed):
        samples, sample_rate, duration = wav_info(item.path)
        if sample_rate != SAMPLE_RATE:
            raise RunnerError(
                f"processed segment {item.segment.id} is {sample_rate} Hz, expected {SAMPLE_RATE}",
                stage="track",
            )
        item.start_sec = cursor
        item.end_sec = cursor + duration
        item.duration = duration
        placements.append((cursor, item.path, samples))
        cursor += duration
        if index + 1 < len(processed):
            cursor += task.timing.pause_between_sec
        result.set_segment(
            index,
            start_sec=round(item.start_sec, 3),
            end_sec=round(item.end_sec, 3),
            duration=round(duration, 3),
        )
    total = processed[-1].end_sec if processed else 0.0
    assert total is not None
    track_path = task.work_dir / "track.wav"
    write_track(track_path, placements, total, SAMPLE_RATE)
    if len(processed) > 1 and task.timing.pause_between_sec > 0:
        result.add_warning(f"narration pause between segments: {task.timing.pause_between_sec:.2f}s")
    log("track", f"Built narration track: {total:.3f}s @ {SAMPLE_RATE} Hz")
    return TrackInfo(track_path, total, SAMPLE_RATE)


def build_aligned_track(
    task: Task, processed: Sequence[ProcessedSegment], result: Result
) -> TrackInfo:
    overflows = [item for item in processed if item.overflow is not None]
    if overflows:
        details = []
        for item in overflows:
            assert item.overflow is not None
            details.append(
                {
                    "segment_id": item.segment.id,
                    "text": item.segment.text,
                    "original_text": item.segment.original_text,
                    "synth_duration": round(item.overflow.get("synth_duration", item.duration), 3),
                    "window_sec": round(float(item.segment.window_sec or 0.0), 3),
                    "required_speed": item.overflow.get("required_speed"),
                    "max_speed": task.timing.max_speed,
                    "reason": item.overflow.get("reason"),
                    "processed_path": str(item.path),
                }
            )
        status = (
            "needs_polish"
            if task.allow_text_edits and task.polish.attempt < task.polish.max_attempts
            else "overflow"
        )
        if status == "needs_polish":
            message = (
                "Some segments do not fit their windows even at the configured maximum speed. "
                "Polishing is authorized: shorten only the listed segments, keep numbers, "
                "proper nouns, conditions and key steps, set original_text, increment "
                "polish.attempt, and rerun. Unchanged segments will reuse cached audio."
            )
        else:
            message = (
                "Some segments do not fit their windows and no more automatic polishing "
                "is available. Choose a new segmentation/timing, allow polishing, or adjust "
                "the task with the user; this runner will not truncate speech."
            )
        raise ActionRequired(
            message,
            status=status,
            stage="fit",
            details={
                "overflow": details,
                "polish_attempt": task.polish.attempt,
                "max_attempts": task.polish.max_attempts,
                "allow_text_edits": task.allow_text_edits,
            },
        )

    placements: List[Tuple[float, Path, int]] = []
    previous_end = -1.0
    for index, item in enumerate(processed):
        assert item.segment.start_sec is not None
        samples, sample_rate, duration = wav_info(item.path)
        if sample_rate != SAMPLE_RATE:
            raise RunnerError(
                f"processed segment {item.segment.id} is {sample_rate} Hz, expected {SAMPLE_RATE}",
                stage="track",
            )
        start = item.segment.start_sec
        end = start + duration
        if index + 1 < len(processed):
            next_start = processed[index + 1].segment.start_sec
            assert next_start is not None
            allowed = next_start - task.timing.safety_gap_sec
            if end > allowed + 0.005:
                raise RunnerError(
                    f"segment {item.segment.id} ends at {end:.3f}s, crossing the allowed "
                    f"boundary {allowed:.3f}s; refusing to overlap the next segment.",
                    stage="fit",
                    segment_id=item.segment.id,
                )
        elif task.video_duration is not None and end > task.video_duration + 0.005:
            raise RunnerError(
                f"final segment {item.segment.id} ends at {end:.3f}s, beyond the video "
                f"duration {task.video_duration:.3f}s; refusing to mux a truncated track.",
                stage="fit",
                segment_id=item.segment.id,
            )
        if start < previous_end - 0.005:
            raise RunnerError(
                f"segment {item.segment.id} starts at {start:.3f}s, overlapping the "
                f"previous segment ending at {previous_end:.3f}s.",
                stage="fit",
                segment_id=item.segment.id,
            )
        placements.append((start, item.path, samples))
        item.start_sec = start
        item.end_sec = end
        item.duration = duration
        previous_end = end
        result.set_segment(
            index,
            start_sec=round(start, 3),
            end_sec=round(end, 3),
            duration=round(duration, 3),
        )

    if task.video_duration is not None:
        total = task.video_duration
    else:
        # SRT-only delivery ends at the source's last subtitle end, not at the
        # actual speech end; the remaining space is silence.
        total = processed[-1].segment.end_sec
        assert total is not None
    track_path = task.work_dir / "track.wav"
    write_track(track_path, placements, total, SAMPLE_RATE)
    log("track", f"Built aligned track: {total:.3f}s @ {SAMPLE_RATE} Hz")
    return TrackInfo(track_path, total, SAMPLE_RATE)


def _output_stem(task: Task) -> str:
    if task.input.video is not None:
        return task.input.video.stem
    if task.input.srt is not None:
        return task.input.srt.stem
    return "narration"


def choose_output_names(task: Task, deliver: Sequence[str]) -> Dict[str, Path]:
    directory = task.output.directory
    directory.mkdir(parents=True, exist_ok=True)
    stem = _output_stem(task) + ".dub"
    extensions = {"audio": ".wav", "video": ".mp4", "subtitle": ".srt"}
    suffix = ""
    if not task.output.overwrite:
        counter = 1
        while True:
            candidate = f"{stem}{suffix}"
            if not any((directory / (candidate + extensions[kind])).exists() for kind in deliver):
                break
            counter += 1
            suffix = f"_{counter}"
    names = {kind: directory / (f"{stem}{suffix}" + extensions[kind]) for kind in deliver}
    protected = [task.path]
    if task.input.srt is not None:
        protected.append(task.input.srt)
    if task.input.video is not None:
        protected.append(task.input.video)
    if task.voice.reference_audio is not None:
        protected.append(task.voice.reference_audio)
    protected_real = {_real(str(path)) for path in protected}
    for path in names.values():
        if _real(str(path.resolve())) in protected_real:
            raise TaskError(f"output path would overwrite an input file: {path}")
    return names


def _subtitle_entries(
    track: TrackInfo, processed: Sequence[ProcessedSegment]
) -> List[Tuple[float, float, str]]:
    entries: List[Tuple[float, float, str]] = []
    previous_end = -1.0
    for item in processed:
        if item.start_sec is None or item.end_sec is None:
            raise RunnerError(
                f"segment {item.segment.id} has no final placement",
                stage="subtitle",
            )
        start = max(0.0, float(item.start_sec))
        end = min(float(item.end_sec), track.duration)
        if start >= track.duration - 1e-6:
            raise RunnerError(
                f"segment {item.segment.id} subtitle starts at {start:.3f}s, "
                f"beyond the delivered track {track.duration:.3f}s",
                stage="subtitle",
            )
        if end <= start:
            raise RunnerError(
                f"segment {item.segment.id} has a non-positive subtitle interval",
                stage="subtitle",
            )
        if start < previous_end - 0.001:
            raise RunnerError(
                f"segment {item.segment.id} subtitle starts at {start:.3f}s, "
                f"overlapping the previous cue ending at {previous_end:.3f}s",
                stage="subtitle",
            )
        entries.append((start, end, item.segment.text))
        previous_end = end
    return entries


def deliver(
    task: Task, track: TrackInfo, processed: Sequence[ProcessedSegment], result: Result
) -> None:
    deliver_kinds = list(task.output.deliver)
    video_info = task.video_info
    video_target = task.video_duration

    if "video" in deliver_kinds and task.mode == "narration":
        assert video_target is not None
        if track.duration > video_target + 0.005:
            raise ActionRequired(
                f"Narration audio is {track.duration:.3f}s but the video is "
                f"{video_target:.3f}s. The runner keeps the natural audio and does "
                "not accelerate or truncate it. Choose with the user: deliver "
                "audio/subtitle only, or shorten/re-segment the narration text.",
                status="needs_action",
                stage="video",
                details={
                    "audio_duration": track.duration,
                    "video_duration": video_target,
                    "options": [
                        "deliver audio/subtitle only (remove video from output.deliver)",
                        "shorten or re-segment the narration text",
                    ],
                    "track_path": str(track.path),
                },
            )

    names = choose_output_names(task, deliver_kinds)
    subtitle_entries: Optional[List[Tuple[float, float, str]]] = None
    if "subtitle" in deliver_kinds:
        # Validate the complete subtitle timeline before writing any output.
        subtitle_entries = _subtitle_entries(track, processed)

    if "video" in deliver_kinds:
        assert task.input.video is not None and video_info is not None and video_target is not None
        mux_source = track.path
        if task.mode == "narration" and track.duration < video_target - 0.001:
            padded = task.work_dir / "track_padded.wav"
            pad_track(track.path, padded, video_target, SAMPLE_RATE)
            mux_source = padded
            log("video", f"Padding narration tail by {video_target - track.duration:.3f}s for muxing")
        if task.mode == "aligned" and abs(track.duration - video_target) > 0.05:
            raise RunnerError(
                f"aligned track is {track.duration:.3f}s but video is {video_target:.3f}s; "
                "refusing to mux a mismatched track.",
                stage="video",
            )
        log("mux", f"Muxing {mux_source.name} into {names['video'].name}")
        mux_warnings = mux_video(
            task.input.video,
            mux_source,
            names["video"],
            video_info,
            sample_rate=SAMPLE_RATE,
        )
        for message in mux_warnings:
            result.add_warning(message)
        result.add_output("video", names["video"], video_target, sample_rate=None)
        log("verify", f"Video verified: {names['video']}")

    if "audio" in deliver_kinds:
        duration = export_pcm16(track.path, names["audio"], SAMPLE_RATE)
        result.add_output("audio", names["audio"], duration, sample_rate=SAMPLE_RATE)
        log("deliver", f"Audio -> {names['audio']} ({duration:.3f}s)")

    if "subtitle" in deliver_kinds:
        assert subtitle_entries is not None
        write_srt(names["subtitle"], subtitle_entries)
        result.add_output(
            "subtitle",
            names["subtitle"],
            track.duration,
            note="segment-level timestamps from actual synthesized audio",
        )
        log(
            "deliver",
            f"Subtitle -> {names['subtitle']} ({len(subtitle_entries)} cues, segment-level)",
        )


# ---------------------------------------------------------------------------
# Task execution
# ---------------------------------------------------------------------------


def _ensure_work_dirs(task: Task) -> None:
    for name in ("segments", "native", "processed", "fitted"):
        (task.work_dir / name).mkdir(parents=True, exist_ok=True)


def _voice_label(task: Task) -> str:
    if task.voice.source == "preset":
        if task.provider == "local":
            return f"preset:{task.voice.speaker}"
        return f"preset:{task.voice.voice_id}"
    if task.voice.voice_id:
        return f"clone:{task.voice.voice_id}"
    return f"clone:new({task.voice.reference_audio})"


def run_task(task: Task) -> int:
    check_tools()
    result = Result(task)
    adapter: Optional[Adapter] = None
    try:
        _ensure_work_dirs(task)
        log(
            "task",
            f"mode={task.mode} provider={task.provider} backend={task.backend} "
            f"model={task.model_id} voice={_voice_label(task)} "
            f"segments={len(task.segments)} deliver={','.join(task.output.deliver)}",
        )
        for message in task.warnings:
            warn(message)
        adapter = build_adapter(task, result)
        adapter.prepare(task, lambda stage, message: log(stage, message))
        result.update_environment(adapter.environment())
        native = synthesize_all(task, adapter, result)
        processed = process_all(task, native, result)
        if task.mode == "aligned":
            track = build_aligned_track(task, processed, result)
        else:
            track = build_narration_track(task, processed, result)
        deliver(task, track, processed, result)
        result.set_status("completed", EXIT_OK)
        log("done", f"status=completed elapsed={result.data['elapsed_sec']:.1f}s")
        return EXIT_OK
    except ActionRequired as exc:
        status = exc.status
        payload = exc.payload(status=status)
        result.set_status(status, EXIT_ACTION, payload)
        print(f"[action] {exc.message}", file=sys.stderr, flush=True)
        print(f"[action] details written to {result.path}", file=sys.stderr, flush=True)
        return EXIT_ACTION
    except RunnerError as exc:
        status = "invalid_task" if exc.exit_code == EXIT_INVALID else "failed"
        payload = exc.payload(status=status)
        result.set_status(status, exc.exit_code, payload)
        print(f"[error] stage={exc.stage}: {exc.message}", file=sys.stderr, flush=True)
        print(f"[error] details written to {result.path}", file=sys.stderr, flush=True)
        if os.environ.get("VIDEO_TTS_DEBUG"):
            import traceback

            traceback.print_exc()
        return exc.exit_code
    except KeyboardInterrupt:
        result.set_status("cancelled", EXIT_FAIL, {"stage": "run", "message": "cancelled by user"})
        print("[error] cancelled by user", file=sys.stderr, flush=True)
        return EXIT_FAIL
    except Exception as exc:
        result.set_status(
            "failed",
            EXIT_FAIL,
            {"stage": "internal", "message": str(exc), "exit_code": EXIT_FAIL},
        )
        print(f"[error] internal failure: {exc}", file=sys.stderr, flush=True)
        if os.environ.get("VIDEO_TTS_DEBUG"):
            import traceback

            traceback.print_exc()
        return EXIT_FAIL
    finally:
        if adapter is not None:
            try:
                adapter.close()
            except Exception:
                pass


def check_summary(path: Any) -> Dict[str, Any]:
    try:
        task = load_task(path, require_media_tools=False)
        return {"ok": True, **task_summary(task)}
    except RunnerError as exc:
        return {"ok": False, "error": exc.payload()}
    except Exception as exc:
        return {
            "ok": False,
            "error": {"stage": "task", "message": str(exc), "exit_code": EXIT_INVALID},
        }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _reconfigure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _print_json(data: Any) -> None:
    print(json_dumps(data), end="")


def main(argv: Optional[Sequence[str]] = None) -> int:
    _reconfigure_stdio()
    parser = argparse.ArgumentParser(
        description="video-tts single-file runner. Task data is read only from task.json."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--task", help="path to task.json")
    group.add_argument("--detect", action="store_true", help="print capability detection JSON")
    group.add_argument("--list-voices", action="store_true", help="print available voices JSON")
    parser.add_argument("--check", action="store_true", help="validate task.json without synthesis")
    parser.add_argument("--provider", choices=["local", "elevenlabs"], help="provider for --list-voices")
    parser.add_argument("--no-install", action="store_true", help="do not create an environment")
    args = parser.parse_args(argv)

    if args.detect:
        _print_json(detect_environment())
        return EXIT_OK

    if args.list_voices:
        provider = args.provider
        if provider is None:
            _print_json({"ok": False, "error": "--provider is required with --list-voices"})
            return EXIT_INVALID
        try:
            payload = list_local_voices() if provider == "local" else list_online_voices()
            _print_json({"ok": True, **payload})
            return EXIT_OK
        except RunnerError as exc:
            _print_json({"ok": False, "error": exc.payload()})
            return exc.exit_code

    if args.task is None:
        _print_json({"ok": False, "error": "--task is required"})
        return EXIT_INVALID

    if args.check:
        summary = check_summary(args.task)
        _print_json(summary)
        return EXIT_OK if summary.get("ok") else EXIT_INVALID

    try:
        check_tools()
        task = load_task(args.task, require_media_tools=True)
    except RunnerError as exc:
        print(f"[error] stage={exc.stage}: {exc.message}", file=sys.stderr, flush=True)
        return exc.exit_code

    route = task_route(task)
    log("setup", f"Checking current interpreter for route: {route}")
    with Heartbeat("setup", "checking current interpreter"):
        current_ok = interpreter_ok(sys.executable, route)
    if not current_ok:
        try:
            python = ensure_environment(route, allow_install=not args.no_install)
        except RunnerError as exc:
            print(f"[error] stage={exc.stage}: {exc.message}", file=sys.stderr, flush=True)
            return exc.exit_code
        if not _same_executable(python, sys.executable):
            log("setup", f"Re-running task in {python}")
            command = [python, os.path.abspath(__file__), "--task", str(task.path)]
            if args.no_install:
                command.append("--no-install")
            completed = subprocess.run(command)
            return int(completed.returncode)

    return run_task(task)


if __name__ == "__main__":
    sys.exit(main())
