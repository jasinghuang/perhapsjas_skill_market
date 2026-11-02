#!/usr/bin/env python3
"""audio-transcribe launcher — reuse an existing Python environment.

Why this exists: Homebrew and pyenv can move the `python3` symlink to a
newer minor version while the transcription packages stay installed under
the older version's site-packages. Running skill_main.py with the new
interpreter then looks like "dependencies are missing" and triggers a
needless multi-GB reinstall. This launcher scans for an interpreter that
already imports the backend, and installs only when none does.

Usage is identical to skill_main.py:

    python3 run.py video.mp4 --model large-v3-turbo --format srt
    python3 run.py a.mp4 b.mp4 c.mp4 --format srt
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

if IS_MAC:
    IMPORT_NAME = "mlx_whisper"
    PIP_DEPS = ["mlx-whisper", "zhconv"]
    PIP_FLAGS = ["--break-system-packages"]
    MANUAL_HINT = "python3 -m pip install --break-system-packages mlx-whisper zhconv"
else:
    IMPORT_NAME = "faster_whisper"
    PIP_DEPS = ["faster-whisper", "zhconv"]
    PIP_FLAGS = []
    MANUAL_HINT = "python -m pip install faster-whisper zhconv"

# Newest first. Keep in sync with the Python versions Homebrew ships.
PYTHON_VERSIONS = ["3.16", "3.15", "3.14", "3.13", "3.12", "3.11", "3.10", "3.9"]


def cache_path():
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "video-toolkit" / "audio-transcribe-env.json"


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
    """Return interpreter paths to try, most likely / newest first."""
    out, seen = [], set()

    # A previously chosen interpreter is the best guess — it is validated
    # by importing the backend before use.
    try:
        cached = json.loads(cache_path().read_text(encoding="utf-8")).get("interpreter")
        _add(out, seen, cached)
    except Exception:
        pass

    _add(out, seen, sys.executable)

    if IS_WIN:
        for name in ("python", "python3"):
            _add(out, seen, shutil.which(name))
        local = Path(os.environ.get("LOCALAPPDATA") or "")
        if local:
            for exe in sorted((local / "Programs" / "Python").glob("Python3*/python.exe"), key=_version_key, reverse=True):
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


def has_backend(python):
    try:
        result = subprocess.run(
            [python, "-c", "import " + IMPORT_NAME],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )
        return result.returncode == 0
    except Exception:
        return False


def save_cache(python):
    try:
        path = cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"interpreter": python, "backend": IMPORT_NAME}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass  # the cache is a convenience; never fail because of it


def install_backend(found):
    """Install into the first interpreter that accepts the packages."""
    installable = [p for p in found if not p.startswith("/usr/bin/")] or found
    if not installable:
        sys.exit(
            "No usable Python interpreter found.\n"
            "Install Python 3 first, then run this skill again."
        )

    last_error = None
    for python in installable:
        print(f"[audio-transcribe] {IMPORT_NAME} is not installed in any interpreter. Trying {python} ...", flush=True)
        try:
            subprocess.run([python, "-m", "pip", "install"] + PIP_FLAGS + PIP_DEPS, check=True)
        except Exception as exc:
            last_error = exc
            print(f"  install failed: {exc}")
            continue
        if has_backend(python):
            return python

    sys.exit(
        f"Could not find or install {IMPORT_NAME}.\n"
        f"Install it manually, then run this skill again:\n"
        f"  {MANUAL_HINT}\n"
        f"Last error: {last_error}"
    )


def main():
    if not MAIN_SCRIPT.is_file():
        sys.exit(f"skill_main.py not found next to run.py: {MAIN_SCRIPT}")

    found = candidates()
    chosen = next((python for python in found if has_backend(python)), None)

    if chosen:
        print(f"[audio-transcribe] Using {chosen} (transcription backend already installed)", flush=True)
    else:
        chosen = install_backend(found)

    save_cache(chosen)
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT)] + sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
