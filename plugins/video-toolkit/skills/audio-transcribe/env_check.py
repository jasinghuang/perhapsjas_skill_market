"""Execution-environment detection (doc §4).

System facts come from Python's own platform/sysconfig/sys modules — never
from directory names, the shell, or the user's language. Dependency probes
run `import` checks in subprocesses so a missing package can never crash the
detector itself.
"""

import ctypes
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

from bootstrap import bootstrap_blockers, find_uv
from media import has_ffmpeg

QWEN_MLX_IMPORT = "mlx_qwen3_asr"
QWEN_TORCH_IMPORT = "qwen_asr"


def _blocked_or(default: str) -> str:
    """'blocked_missing_uv' when run.py cannot even build its venv (doc §4)."""
    return "blocked_missing_uv" if bootstrap_blockers() else default


def _import_ok(module: str, python: Optional[str] = None) -> bool:
    """True if `module` imports in the given (or current) interpreter."""
    exe = python or sys.executable
    try:
        result = subprocess.run(
            [exe, "-c", f"import {module}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
        )
        return result.returncode == 0
    except Exception:
        return False


def _torch_cuda_ok(python: Optional[str] = None) -> Optional[bool]:
    """None = torch not importable; True/False = CUDA usable or not."""
    exe = python or sys.executable
    code = (
        "import torch\n"
        "ok = bool(torch.version.cuda and torch.cuda.is_available())\n"
        "if ok: (torch.ones(8, device='cuda') * 2).sum().item()\n"
        "print('1' if ok else '0')"
    )
    try:
        result = subprocess.run(
            [exe, "-c", code], capture_output=True, text=True, timeout=120
        )
    except Exception:
        return False
    if result.returncode != 0:
        return None
    return result.stdout.strip() == "1"


def _is_wsl() -> bool:
    if platform.system() != "Linux":
        return False
    if "microsoft" in platform.release().lower():
        return True
    try:
        return "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="replace").lower()
    except OSError:
        return False


def _is_rosetta() -> bool:
    """True when an Intel Python runs under Rosetta on Apple Silicon."""
    if platform.system() != "Darwin" or platform.machine() != "x86_64":
        return False
    try:
        result = subprocess.run(
            ["sysctl", "-n", "sysctl.proc_translated"],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0 and result.stdout.strip() == "1"
    except Exception:
        return False


def _available_memory() -> Optional[float]:
    """Available RAM in GB, or None when the OS API is unavailable."""
    try:
        if platform.system() == "Windows":
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return round(stat.ullAvailPhys / 1024 ** 3, 2)
        import resource  # POSIX rusage fallback is RSS, not available memory
        del resource
    except Exception:
        pass
    try:
        pages = os.sysconf("SC_AVPHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        return round(pages * page_size / 1024 ** 3, 2)
    except (ValueError, OSError, AttributeError):
        return None


def _free_disk_gb() -> Optional[float]:
    try:
        usage = shutil.disk_usage(str(Path.home()))
        return round(usage.free / 1024 ** 3, 2)
    except Exception:
        return None


def _local_support_status(system: str, machine: str, python: Optional[str] = None) -> str:
    """ready / needs_setup / unsupported / unverified for the local Qwen route."""
    if system == "Darwin":
        if machine == "arm64":
            return "ready" if _import_ok(QWEN_MLX_IMPORT, python) else _blocked_or("needs_setup")
        return "unsupported"  # Intel Mac: no MLX, no CUDA (doc §2)

    if system == "Windows":
        if machine == "AMD64":
            cuda = _torch_cuda_ok(python)
            if cuda is None or not _import_ok(QWEN_TORCH_IMPORT, python):
                return _blocked_or("needs_setup")  # torch/qwen_asr not installed yet
            # CPU FP32 mode passed end-to-end validation (zh+en short samples,
            # 2026-11-08, RTX 4070 Ti machine forced to cpu) — slow but open.
            return "ready"
        return "unverified"  # Windows ARM or other GPU (doc §2)

    if system == "Linux":
        # Includes WSL — flagged separately; extension validation, not native Windows.
        cuda = _torch_cuda_ok(python)
        if cuda is None or not _import_ok(QWEN_TORCH_IMPORT, python):
            return _blocked_or("needs_setup")
        return "ready"

    return "unverified"


def detect_environment(python: Optional[str] = None, check_local: bool = False) -> dict:
    system = platform.system()
    machine = platform.machine()
    memory = _available_memory()
    env = {
        "os": system,
        "architecture": machine,
        "python_version": platform.python_version(),
        "python_executable": python or sys.executable,
        "python_architecture": platform.architecture()[0],
        "is_wsl": _is_wsl(),
        "is_rosetta": _is_rosetta(),
        "ffmpeg_available": has_ffmpeg(),
        "ffprobe_available": shutil.which("ffprobe") is not None,
        "available_memory_gb": memory if memory is not None else "unknown",
        "free_disk_gb": _free_disk_gb(),
        "local_support_status": _local_support_status(system, machine, python) if check_local else (
            "unsupported" if system == "Darwin" and machine != "arm64" else "not_checked"),
    }
    if check_local:
        # Bootstrap preflight so blockers surface before media is downloaded.
        env["uv_available"] = bool(find_uv())
        env["setup_blockers"] = bootstrap_blockers()
    return env


def _mark_setup(report: dict, *checks: str) -> dict:
    """needs_setup, or blocked_missing_uv with actionable fixes, for a cold machine."""
    report["status"] = _blocked_or("needs_setup")
    report["checks"].extend(checks)
    report["checks"].extend(bootstrap_blockers())
    return report


def probe_backend(provider: str, python: Optional[str] = None) -> dict:
    """Deep probe of ONE chosen route. Never installs anything (doc §3/§4)."""
    if provider == "qwen":
        system, machine = platform.system(), platform.machine()
        report = {
            "provider": "qwen",
            "route": "mlx" if (system == "Darwin" and machine == "arm64") else "torch",
            "checks": [],
        }
        if system == "Darwin" and machine != "arm64":
            report["status"] = "unsupported"
            report["checks"].append(
                "MLX requires Apple Silicon. Switch to a native ARM64 Python or use the Scribe online route."
            )
            return report

        if report["route"] == "mlx":
            ok = _import_ok(QWEN_MLX_IMPORT, python)
            if ok:
                report["status"] = "ready"
                report["checks"].append(f"import {QWEN_MLX_IMPORT}: ok")
            else:
                _mark_setup(report, f"import {QWEN_MLX_IMPORT}: missing (run.py will install mlx-qwen3-asr)")
            return report

        # torch route (Windows/Linux/WSL): doc §6 steps 1–5.
        if not _import_ok(QWEN_TORCH_IMPORT, python):
            return _mark_setup(report, "import qwen_asr: missing (run.py will install it)")
        torch_cuda = _torch_cuda_ok(python)
        if torch_cuda is None:
            return _mark_setup(report, "import torch: missing (run.py will install it)")
        report["checks"].append("import torch + qwen_asr: ok")
        if torch_cuda:
            report["status"] = "ready"
            report["checks"].append("torch.cuda.is_available(): True (CUDA build in use)")
            name = _gpu_name()
            if name:
                report["checks"].append(f"GPU: {name}")
        else:
            report["status"] = "ready"
            report["checks"].append(
                "CUDA unavailable — CPU FP32 fallback (validated on zh+en short samples; "
                "several times slower than CUDA; Scribe online remains an alternative)"
            )
        return report

    if provider == "scribe":
        has_key = bool(os.environ.get("ELEVENLABS_API_KEY"))
        return {
            "provider": "scribe",
            "status": "ready" if has_key else "needs_setup",
            "checks": [
                "no local model or GPU required",
                (
                    "ELEVENLABS_API_KEY: present"
                    if has_key
                    else "ELEVENLABS_API_KEY: missing — set it in the environment "
                         "(never write it into files or logs)"
                ),
            ],
        }

    raise ValueError(f"Unknown provider '{provider}' (expected qwen or scribe)")


def _gpu_name() -> str:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip().splitlines()[0].strip()
    except Exception:
        pass
    return ""


STATUS_LABELS = {
    "blocked_missing_uv": "缺少前置（无 uv 且无 Python 3.10–3.12；pip install uv 即可，uv 会自行管理 Python 3.12）",
}


def format_env_line(env: dict) -> str:
    """One-line summary for the agent to relay to the user (doc §3)."""
    os_name = {"Darwin": "macOS", "Windows": "Windows", "Linux": "Linux"}.get(env["os"], env["os"])
    arch = "Apple Silicon" if env["is_rosetta"] is False and env["os"] == "Darwin" and env["architecture"] == "arm64" else env["architecture"]
    if env["is_rosetta"]:
        arch = "Apple Silicon (Rosetta / Intel Python)"
    if env["is_wsl"]:
        os_name += " (WSL)"
    status = STATUS_LABELS.get(env["local_support_status"], env["local_support_status"])
    return f"检测到当前环境为 {os_name}，{arch}，本地 Qwen 路线状态：{status}"


if __name__ == "__main__":
    provider = None
    if len(sys.argv) > 1 and sys.argv[1] in ("qwen", "scribe"):
        provider = sys.argv[1]
    env = detect_environment()
    print(json.dumps(env, ensure_ascii=False, indent=2))
    if provider:
        print(json.dumps(probe_backend(provider), ensure_ascii=False, indent=2))
