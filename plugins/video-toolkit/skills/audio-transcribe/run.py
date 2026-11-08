#!/usr/bin/env python3
"""Provider-aware launcher with a dedicated, pinned local inference venv.

Read-only detection/help never installs. Scribe uses stdlib only. Qwen
installs into the application cache, never a global/Homebrew Python.
"""

import os
import platform
import subprocess
import sys
from pathlib import Path

from bootstrap import candidates, find_uv, managed_interpreter, usable_system_python

SKILL_DIR = Path(__file__).resolve().parent
MAIN_SCRIPT = SKILL_DIR / "skill_main.py"

IS_MAC = platform.system() == "Darwin"

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


def parse_uv_path(argv):
    """Extract --uv-path VALUE / --uv-path=VALUE; returns (override, remaining).

    The flag is launcher-only, so it is stripped before skill_main sees argv.
    """
    override, remaining = None, []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--uv-path" and i + 1 < len(argv):
            override = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--uv-path="):
            override = arg.split("=", 1)[1]
            i += 1
            continue
        remaining.append(arg)
        i += 1
    return override, remaining


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


def prepare_venv(found, uv_override=None):
    python = managed_interpreter()
    if python.is_file():
        return str(python)
    python.parent.parent.mkdir(parents=True, exist_ok=True)
    uv = find_uv(uv_override)
    if uv:
        # Windows dependency wheels target Python 3.12. uv obtains that runtime
        # if absent; this never installs packages into a global interpreter.
        version = (found[0] if found else "3.12") if IS_MAC else "3.12"
        subprocess.run(uv + ["venv", "--python", version, str(python.parent.parent)], check=True)
    else:
        fallback = usable_system_python()
        if not fallback:
            sys.exit(
                "未找到 uv，且未发现 Python 3.10–3.12，无法创建专属环境。任选其一，无需手动改 PATH：\n"
                "  1. pip install uv          # run.py 会通过 python -m uv 自动发现并调用\n"
                "  2. 用官方脚本安装 uv：https://docs.astral.sh/uv/getting-started/installation/\n"
                "  3. 安装 Python 3.12 后重试\n"
                "uv 会自动下载并管理 Python 3.12，无需单独安装 Python；全局环境不会被修改。"
            )
        subprocess.run([fallback, "-m", "venv", str(python.parent.parent)], check=True)
    return str(python)


def ensure_qwen_interpreter(found, uv_override=None):
    """Only install into the skill-owned venv; do not mutate discovered Pythons."""
    if IS_MAC and platform.machine() != "arm64":
        sys.exit("Qwen MLX requires Apple Silicon with native ARM64 Python.")
    python = prepare_venv(found, uv_override)
    module = "mlx_qwen3_asr" if IS_MAC else "qwen_asr"
    requirement = "mlx-qwen3-asr==0.4.4" if IS_MAC else "qwen-asr==0.0.6"
    uv = find_uv(uv_override)
    installer = uv + ["pip", "install", "--python", python] if uv else [python, "-m", "pip", "install"]
    if not IS_MAC:
        index = os.environ.get("AUDIO_TRANSCRIBE_TORCH_INDEX", "cu130" if nvidia_gpu_present() else "cpu")
        torch_version = subprocess.run(
            [python, "-c", "import importlib.metadata as m; print(m.version('torch').split('+')[0]); print(m.version('torchaudio').split('+')[0])"],
            capture_output=True, text=True,
        ).stdout.strip().splitlines()
        cpu_to_cuda = index != "cpu" and not torch_cuda_build(python)
        # Do not accept an importable CPU-only torch as a CUDA installation.
        if torch_version != ["2.10.0", "2.10.0"] or not has_module(python, "torch") or cpu_to_cuda:
            if index == "cpu":
                print("[audio-transcribe] No NVIDIA GPU detected — installing the smaller CPU "
                      "torch build (inference will be several times slower).", flush=True)
            else:
                print(f"[audio-transcribe] First-time setup: downloading torch==2.10.0 {index} build "
                      "(~1.7 GiB). One-time only; later runs reuse the managed venv.", flush=True)
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
    uv_override, args = parse_uv_path(args)

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

    chosen = ensure_qwen_interpreter(candidates(), uv_override)
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT)] + args)


if __name__ == "__main__":
    sys.exit(main())
