"""Bootstrap facts shared by run.py (launcher) and env_check (detection).

How to find uv and a venv-capable Python on this machine — a single source
of truth so --detect-env can predict exactly what run.py would do, before
the user spends time downloading media (2026-11-08 Windows postmortem).
"""

import os
import platform
import re
import shutil
import site
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

IS_WIN = platform.system() == "Windows"
IS_MAC = platform.system() == "Darwin"

UV_ENV_VAR = "AUDIO_TRANSCRIBE_UV"
PYTHON_VERSIONS = ["3.16", "3.15", "3.14", "3.13", "3.12", "3.11", "3.10", "3.9"]


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
    """Python interpreters worth considering, best first."""
    out, seen = [], set()
    _add(out, seen, sys.executable)
    if IS_WIN:
        for name in ("python", "python3"):
            _add(out, seen, shutil.which(name))
        try:  # py launcher: enumerate every install, newest first (paths may contain spaces)
            listed = subprocess.run(["py", "-0p"], capture_output=True, text=True, timeout=10)
            if listed.returncode == 0:
                found = []
                for line in listed.stdout.splitlines():
                    tag = re.match(r"\s*-V:([\d.]+)\s+(.+?)\s*$", line)
                    if tag and tag.group(2).lower().endswith(".exe"):
                        found.append((tag.group(1), tag.group(2)))
                for _, exe in sorted(found, key=lambda item: _version_key(item[0]), reverse=True):
                    _add(out, seen, exe)
        except Exception:
            pass
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


def supported_python(python):
    """True when the interpreter may host the managed venv (3.10-3.12)."""
    try:
        result = subprocess.run([python, "-c", "import sys; print(int((3,10) <= sys.version_info[:2] <= (3,12)))"],
                                capture_output=True, text=True, timeout=10)
        return result.stdout.strip() == "1"
    except Exception:
        return False


def usable_system_python():
    """First discovered interpreter that can build the venv without uv, or None."""
    for python in candidates():
        if supported_python(python):
            return python
    return None


def managed_interpreter():
    from job_cache import cache_root
    route = "mlx" if IS_MAC else "torch"
    env = cache_root().parent / "envs" / f"audio-transcribe-{route}-v2"
    return env / ("Scripts/python.exe" if IS_WIN else "bin/python")


def _uv_exes():
    """uv executable candidates outside PATH (pip user install, etc.)."""
    import sysconfig

    exe = "uv.exe" if IS_WIN else "uv"
    scripts = "Scripts" if IS_WIN else "bin"
    bases = [Path(site.USER_BASE) / scripts]
    if site.USER_SITE:  # e.g. .../Python/Python314/site-packages -> sibling Scripts/
        bases.append(Path(site.USER_SITE).parent / scripts)
    for key in ("userscripts", "scripts"):  # 'userscripts' may not exist per scheme/py ver
        try:
            path = sysconfig.get_path(key)
        except KeyError:
            continue
        if path:
            bases.append(Path(path))
    return [base / exe for base in bases if (base / exe).is_file()]


def _uv_version_ok(command: List[str]) -> bool:
    try:
        result = subprocess.run(
            command + ["--version"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
        )
        return result.returncode == 0
    except Exception:
        return False


def _module_uv_commands() -> List[List[str]]:
    """`python -m uv` invocations: current interpreter first, then PATH python.

    Detection often runs inside the managed venv while uv was pip-installed
    into the system interpreter — both must be probed.
    """
    commands = [[sys.executable, "-m", "uv"]]
    path_python = shutil.which("python")
    if path_python:
        try:
            same = Path(path_python).resolve() == Path(sys.executable).resolve()
        except OSError:
            same = False
        if not same:
            commands.append([path_python, "-m", "uv"])
    return commands


def find_uv(override: Optional[str] = None) -> Optional[List[str]]:
    """uv as an argv prefix (["uv.exe"] or [python, "-m", "uv"]), or None.

    Priority: --uv-path / AUDIO_TRANSCRIBE_UV, PATH, pip user Scripts dirs,
    then `python -m uv` — so `pip install uv` works with no PATH changes.
    """
    explicit = override or os.environ.get(UV_ENV_VAR)
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_file():
            return [str(path)]
    which = shutil.which("uv")
    if which:
        return [which]
    for candidate in _uv_exes():
        return [str(candidate)]  # first hit; broken ones surface via uv's own error
    for command in _module_uv_commands():
        if _uv_version_ok(command):
            return command
    return None


def bootstrap_blockers() -> List[str]:
    """Actionable reasons run.py cannot prepare the managed venv (empty = ok)."""
    if managed_interpreter().is_file():
        return []  # venv already built; missing packages go in via its own pip
    if find_uv() or usable_system_python():
        return []
    return [
        "no uv and no Python 3.10-3.12 discovered — run.py cannot create its managed venv",
        "fix: `pip install uv` is enough (invoked via `python -m uv`, no PATH change "
        "needed); uv downloads Python 3.12 itself. Alternatives: the installer at "
        "https://docs.astral.sh/uv/ or install Python 3.12",
    ]
