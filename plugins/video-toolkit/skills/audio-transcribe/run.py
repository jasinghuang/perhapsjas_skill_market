#!/usr/bin/env python3
"""Provider-aware launcher with a dedicated, pinned local inference venv.

Read-only detection/help never installs. Scribe uses stdlib only. Qwen
installs into the application cache, never a global/Homebrew Python.
"""

import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent
MAIN_SCRIPT = SKILL_DIR / "skill_main.py"

SYSTEM = platform.system()
IS_MAC = SYSTEM == "Darwin"
IS_WIN = SYSTEM == "Windows"

DEFAULT_TORCH_INDEX = "cu130"
PYTHON_VERSIONS = ["3.16", "3.15", "3.14", "3.13", "3.12", "3.11", "3.10", "3.9"]

PROVIDER_ALIASES = {
    "qwen": "qwen", "qwen-local": "qwen", "qwen_local": "qwen", "local": "qwen", "qwen3": "qwen",
    "scribe": "scribe", "scribe-v2": "scribe", "scribe_v2": "scribe",
    "elevenlabs": "scribe", "online": "scribe",
}


def parse_provider(argv):
    """Minimal --provider scan; never imports argparse (skill_main owns parsing)."""
    for i, arg in enumerate(argv):
        if arg == "--provider" and i + 1 < len(argv):
            return PROVIDER_ALIASES.get(argv[i + 1].strip().lower(), argv[i + 1])
        if arg.startswith("--provider="):
            value = arg.split("=", 1)[1]
            return PROVIDER_ALIASES.get(value.strip().lower(), value)
    return None


def _add(out, seen, path):
    if not path:
        return
    path = os.path.abspath(os.path.expanduser(str(path)))
    if path in seen or not os.path.isfile(path) or not os.access(path, os.X_OK):
        return
    seen.add(path)
    out.append(path)


def _version_key(path):
    parts = re.findall(r"\d+", Path(path).name)
    return tuple(int(p) for p in parts) or (0,)


def candidates():
    out, seen = [], set()
    _add(out, seen, sys.executable)
    if IS_WIN:
        for name in ("python", "python3"):
            _add(out, seen, shutil.which(name))
        local = Path(os.environ.get("LOCALAPPDATA") or "")
        if local:
            for exe in sorted((local / "Programs" / "Python").glob("Python3*/python.exe"),
                              key=_version_key, reverse=True):
                _add(out, seen, exe)
    else:
        _add(out, seen, shutil.which("python3"))
        for base in ("/opt/homebrew/bin", "/usr/local/bin"):
            for version in PYTHON_VERSIONS:
                _add(out, seen, os.path.join(base, "python" + version))
        pyenv = Path.home() / ".pyenv" / "versions"
        if pyenv.is_dir():
            for version_dir in sorted(pyenv.iterdir(), key=_version_key, reverse=True):
                _add(out, seen, version_dir / "bin" / "python3")
                _add(out, seen, version_dir / "bin" / "python")
        _add(out, seen, "/usr/bin/python3")
    return out


def has_module(python, module):
    try:
        result = subprocess.run(
            [python, "-c", f"import {module}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120,
        )
        return result.returncode == 0
    except Exception:
        return False


def torch_cuda_build(python):
    """''=missing/CPU build, '13.0'=CUDA build, None=check failed."""
    try:
        result = subprocess.run(
            [python, "-c", "import torch;print(torch.version.cuda or '')"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            return ""
        return result.stdout.strip()
    except Exception:
        return None


def nvidia_gpu_present():
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    except Exception:
        return False


def managed_interpreter():
    from job_cache import cache_root
    route = "mlx" if IS_MAC else "torch"
    env = cache_root().parent / "envs" / f"audio-transcribe-{route}-v2"
    return env / ("Scripts/python.exe" if IS_WIN else "bin/python")


def prepare_venv(found):
    python = managed_interpreter()
    if python.is_file():
        return str(python)
    python.parent.parent.mkdir(parents=True, exist_ok=True)
    uv = shutil.which("uv")
    if uv:
        # Windows dependency wheels target Python 3.12. uv obtains that runtime
        # if absent; this never installs packages into a global interpreter.
        version = "3.12" if not IS_MAC else (found[0] if found else "3.12")
        subprocess.run([uv, "venv", "--python", version, str(python.parent.parent)], check=True)
    else:
        usable = [p for p in found if supported_python(p)]
        if not usable:
            sys.exit("Install Python 3.12 or uv, then rerun; global environments will not be modified.")
        subprocess.run([usable[0], "-m", "venv", str(python.parent.parent)], check=True)
    return str(python)


def supported_python(python):
    try:
        result = subprocess.run([python, "-c", "import sys; print(int((3,10) <= sys.version_info[:2] <= (3,12)))"],
                                capture_output=True, text=True, timeout=10)
        return result.stdout.strip() == "1"
    except Exception:
        return False


def ensure_qwen_interpreter(found):
    """Only install into the skill-owned venv; do not mutate discovered Pythons."""
    if IS_MAC and platform.machine() != "arm64":
        sys.exit("Qwen MLX requires Apple Silicon with native ARM64 Python.")
    python = prepare_venv(found)
    module = "mlx_qwen3_asr" if IS_MAC else "qwen_asr"
    requirement = "mlx-qwen3-asr==0.4.4" if IS_MAC else "qwen-asr==0.0.6"
    uv = shutil.which("uv")
    installer = [uv, "pip", "install", "--python", python] if uv else [python, "-m", "pip", "install"]
    if not IS_MAC:
        index = os.environ.get("AUDIO_TRANSCRIBE_TORCH_INDEX", "cu130" if nvidia_gpu_present() else "cpu")
        torch_version = subprocess.run(
            [python, "-c", "import importlib.metadata as m; print(m.version('torch').split('+')[0]); print(m.version('torchaudio').split('+')[0])"],
            capture_output=True, text=True,
        ).stdout.strip().splitlines()
        cpu_to_cuda = index != "cpu" and not torch_cuda_build(python)
        # Do not accept an importable CPU-only torch as a CUDA installation.
        if torch_version != ["2.10.0", "2.10.0"] or not has_module(python, "torch") or cpu_to_cuda:
            reinstall = (["--reinstall-package", "torch", "--reinstall-package", "torchaudio"] if uv else ["--force-reinstall"]) if cpu_to_cuda else []
            subprocess.run(installer + reinstall + ["torch==2.10.0", "torchaudio==2.10.0", "--index-url",
                                        f"https://download.pytorch.org/whl/{index}"], check=True)
    version_code = f"import importlib.metadata as m; print(m.version({requirement.split('==')[0]!r}))"
    installed = subprocess.run([python, "-c", version_code], capture_output=True, text=True).stdout.strip()
    if installed != requirement.split("==")[1] or not has_module(python, module):
        subprocess.run(installer + [requirement], check=True)
    if not has_module(python, module):
        sys.exit(f"Managed environment import failed: {module}. See references/ for troubleshooting.")
    print(f"[audio-transcribe] Managed runtime: {python}", flush=True)
    return python


def main(argv=None):
    if not MAIN_SCRIPT.is_file():
        sys.exit(f"skill_main.py not found next to run.py: {MAIN_SCRIPT}")

    args = list(sys.argv[1:]) if argv is None else list(argv)
    provider = parse_provider(args)

    # Read-only detection or a missing provider: current interpreter, no installs.
    if "--detect-env" in args or "--help" in args or "-h" in args or provider is None:
        if provider is None and "--detect-env" not in args:
            print("[audio-transcribe] no --provider given; skill_main will ask for one", flush=True)
        runtime = managed_interpreter() if provider == "qwen" else Path(sys.executable)
        return subprocess.call([str(runtime) if runtime.is_file() else sys.executable, str(MAIN_SCRIPT)] + args)

    if provider == "scribe":
        # stdlib-only route — any Python works, nothing to install (doc §4).
        print(f"[audio-transcribe] Using {sys.executable} (scribe route, no local deps)", flush=True)
        return subprocess.call([sys.executable, str(MAIN_SCRIPT)] + args)

    if provider not in ("qwen",):
        # Unknown value — let skill_main print the proper error and exit 2.
        return subprocess.call([sys.executable, str(MAIN_SCRIPT)] + args)

    chosen = ensure_qwen_interpreter(candidates())
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT)] + args)


if __name__ == "__main__":
    sys.exit(main())
