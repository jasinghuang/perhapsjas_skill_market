#!/usr/bin/env python3
"""audio-transcribe launcher — pick the interpreter for the CHOSEN provider.

Provider rules (doc §3/§4):
- --detect-env        passthrough, read-only, never installs anything
- provider missing    exec skill_main in the current interpreter; it exits with
                      code 2 and a choose-provider message (no default, no auto online)
- scribe              stdlib only — current interpreter, zero installs
- qwen (Apple Silicon) probe/import mlx_qwen3_asr, else install mlx-qwen3-asr
- qwen (Windows/Linux) probe/import qwen_asr, else install qwen-asr; with an
                      NVIDIA GPU the CUDA PyTorch build is installed first
                      (override the index with AUDIO_TRANSCRIBE_TORCH_INDEX)

Interpreter discovery is kept from the previous version: a cached
interpreter is tried first, then the current one, PATH, Homebrew/pyenv
versions, and per-user Python installs. Packages are installed only when no
candidate has the dependency.
"""

import json
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


def route_for(provider):
    """(import_name, pip_specs) for the local qwen route on this platform."""
    if IS_MAC:
        return "mlx_qwen3_asr", (["mlx-qwen3-asr", "zhconv"], ["--break-system-packages"])
    return "qwen_asr", (["qwen-asr", "zhconv"], [])


def cache_path(provider):
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "video-toolkit" / f"audio-transcribe-env-{provider or 'default'}.json"


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
    try:
        cached = json.loads(cache_path(parse_provider(sys.argv[1:])).read_text(encoding="utf-8"))
        _add(out, seen, cached.get("interpreter"))
    except Exception:
        pass
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


def save_cache(python, provider):
    try:
        path = cache_path(provider)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"interpreter": python}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass


def pip_install(python, packages, flags=()):
    subprocess.run([python, "-m", "pip", "install", *flags, *packages], check=True)


def ensure_qwen_interpreter(found):
    """Find or build an interpreter that can import the local qwen stack."""
    import_name, (pip_specs, flags) = route_for("qwen")
    chosen = next((python for python in found if has_module(python, import_name)), None)
    if chosen:
        print(f"[audio-transcribe] Using {chosen} (qwen route already installed)", flush=True)
        return chosen

    # Pick an installable interpreter (never /usr/bin — needs sudo).
    installable = [p for p in found if not p.startswith("/usr/bin/")] or found
    if not installable:
        sys.exit("No usable Python interpreter found. Install Python 3 first, then rerun.")
    python = installable[0]
    print(f"[audio-transcribe] {import_name} not found in any interpreter. Preparing {python} ...", flush=True)

    if not IS_MAC and nvidia_gpu_present():
        index = os.environ.get("AUDIO_TRANSCRIBE_TORCH_INDEX", DEFAULT_TORCH_INDEX)
        cuda_build = torch_cuda_build(python)
        if not cuda_build:
            print(f"[audio-transcribe] Installing CUDA PyTorch ({index}) into {python} ...", flush=True)
            # --force-reinstall: a CPU-only torch already satisfies plain `torch`,
            # and pip would silently keep it instead of pulling the CUDA wheel.
            subprocess.run(
                [python, "-m", "pip", "install", "--force-reinstall", "--no-deps",
                 "torch", "--index-url", f"https://download.pytorch.org/whl/{index}"],
                check=True,
            )
    elif not IS_MAC:
        print("[audio-transcribe] No NVIDIA GPU detected — installing CPU PyTorch (slow, unverified mode).", flush=True)

    try:
        pip_install(python, pip_specs, flags)
    except Exception as exc:
        manual = (
            f"python3 -m pip install --break-system-packages {' '.join(pip_specs)}"
            if IS_MAC else f"python -m pip install {' '.join(pip_specs)}"
        )
        sys.exit(
            f"Could not install {' '.join(pip_specs)} into {python}:\n  {exc}\n"
            f"Manual install: {manual}\nSee references/ for platform details."
        )
    if not has_module(python, import_name):
        sys.exit(
            f"Install finished but `import {import_name}` still fails in {python}.\n"
            "See references/windows-torch.md (or mac-mlx.md) for troubleshooting."
        )
    return python


def main(argv=None):
    if not MAIN_SCRIPT.is_file():
        sys.exit(f"skill_main.py not found next to run.py: {MAIN_SCRIPT}")

    args = list(sys.argv[1:]) if argv is None else list(argv)
    provider = parse_provider(args)

    # Read-only detection or a missing provider: current interpreter, no installs.
    if "--detect-env" in args or provider is None:
        if provider is None and "--detect-env" not in args:
            print("[audio-transcribe] no --provider given; skill_main will ask for one", flush=True)
        return subprocess.call([sys.executable, str(MAIN_SCRIPT)] + args)

    if provider == "scribe":
        # stdlib-only route — any Python works, nothing to install (doc §4).
        print(f"[audio-transcribe] Using {sys.executable} (scribe route, no local deps)", flush=True)
        return subprocess.call([sys.executable, str(MAIN_SCRIPT)] + args)

    if provider not in ("qwen",):
        # Unknown value — let skill_main print the proper error and exit 2.
        return subprocess.call([sys.executable, str(MAIN_SCRIPT)] + args)

    chosen = ensure_qwen_interpreter(candidates())
    save_cache(chosen, provider)
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT)] + args)


if __name__ == "__main__":
    sys.exit(main())
