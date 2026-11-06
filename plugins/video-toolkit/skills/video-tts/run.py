#!/usr/bin/env python3
"""video-tts launcher — reuse an existing Python environment.

Why this exists: Homebrew and pyenv can move the `python3` symlink to a
newer minor version while the TTS packages stay installed under the older
version's site-packages. Running skill_main.py with the new interpreter then
looks like "dependencies are missing" and triggers a reinstall that may not
even provide the Apple Silicon MLX build. This launcher scans for an
interpreter that already imports the imports needed by the chosen provider,
and installs only when none does.

`required_imports()` is pure and import-safe so tests can call it; interpreter
selection, dependency installation and the subprocess hand-off only run under
`if __name__ == "__main__"`.

Usage is identical to skill_main.py:

    python3 run.py --srt a.srt --provider local --voice Serena --video a.mp4
    python3 run.py --srt a.srt --provider online --voice Cherry --yes
"""

from __future__ import annotations

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

BASE_IMPORTS = ["soundfile", "numpy"]
LOCAL_IMPORTS = ["mlx_audio"]
ONLINE_IMPORTS = ["requests"]

# 顶层 import 名与 pip 包名不一致的映射。
PIP_NAMES = {"mlx_audio": "mlx-audio"}

PIP_FLAGS = ["--break-system-packages"] if IS_MAC else []

# Newest first. Keep in sync with the Python versions Homebrew ships.
PYTHON_VERSIONS = ["3.16", "3.15", "3.14", "3.13", "3.12", "3.11", "3.10", "3.9"]


def _provider_from_argv(argv: list[str]) -> str | None:
    """从 argv 里读出 `--provider` 的值（兼容 `--provider=local`）。"""
    provider = None
    for position, argument in enumerate(argv):
        if argument == "--provider":
            if position + 1 < len(argv):
                provider = argv[position + 1]
        elif argument.startswith("--provider="):
            provider = argument.split("=", 1)[1]
    return provider


# `--help` 的任意非空前缀（argparse 允许时）与短选项 `-h`。
PREVIEW_FLAGS = ("--dry-run", "--help")


def _is_preview(argv: list[str]) -> bool:
    """`--dry-run` / `--help` 只需要解析，不需要 provider 依赖。

    认 `--dry` / `--hel` 这类前缀：即使 argparse 因 `allow_abbrev=False`
    最终拒绝该参数，也不应在解析前先触发模型依赖安装。
    """
    for argument in argv:
        if argument == "-h":
            return True
        if not argument.startswith("--"):
            continue
        name = argument.split("=", 1)[0]
        if name == "--":
            continue
        if any(flag.startswith(name) for flag in PREVIEW_FLAGS):
            return True
    return False


def required_imports(argv: list[str]) -> list[str]:
    """返回本次运行需要的顶层 import 名。

    `soundfile` / `numpy` 永远需要；本地 provider 额外需要 `mlx_audio`，
    在线 provider 的 HTTP 兜底额外需要 `requests`。`--dry-run` 与
    `--help` 不创建 provider、不发起请求，因此永远只要求基础依赖——
    预览绝不应触发模型依赖的安装。
    """
    imports = list(BASE_IMPORTS)
    if _is_preview(argv):
        return imports
    provider = _provider_from_argv(argv)
    if provider == "local":
        imports.extend(LOCAL_IMPORTS)
    elif provider == "online":
        imports.extend(ONLINE_IMPORTS)
    return imports


def pip_packages(imports: list[str]) -> list[str]:
    """把 import 名映射成 pip 包名。"""
    return [PIP_NAMES.get(name, name) for name in imports]


def cache_path() -> Path:
    """解释器缓存位置：`~/.cache/video-tts/env.json`（尊重 XDG）。"""
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "video-tts" / "env.json"


def _add(found: list[str], seen: set[str], path) -> None:
    """把存在且可执行的解释器追加进候选列表。"""
    if not path:
        return
    path = os.path.abspath(os.path.expanduser(str(path)))
    if path in seen or not os.path.isfile(path) or not os.access(path, os.X_OK):
        return
    seen.add(path)
    found.append(path)


def _version_key(path) -> tuple:
    parts = re.findall(r"\d+", Path(path).name)
    return tuple(int(part) for part in parts) or (0,)


def candidates() -> list[str]:
    """返回待尝试的解释器路径，最可能 / 最新在前。"""
    found: list[str] = []
    seen: set[str] = set()

    # 上次选中的解释器是最佳猜测——使用前仍会真正 import 校验。
    try:
        cached = json.loads(cache_path().read_text(encoding="utf-8")).get("interpreter")
        _add(found, seen, cached)
    except Exception:
        pass

    _add(found, seen, sys.executable)

    if IS_WIN:
        for name in ("python", "python3"):
            _add(found, seen, shutil.which(name))
        local = Path(os.environ.get("LOCALAPPDATA") or "")
        if local:
            for exe in sorted(
                (local / "Programs" / "Python").glob("Python3*/python.exe"),
                key=_version_key,
                reverse=True,
            ):
                _add(found, seen, exe)
    else:
        _add(found, seen, shutil.which("python3"))
        for base in ("/opt/homebrew/bin", "/usr/local/bin"):
            for version in PYTHON_VERSIONS:
                _add(found, seen, os.path.join(base, "python" + version))
        pyenv = Path.home() / ".pyenv" / "versions"
        if pyenv.is_dir():
            for version_dir in sorted(pyenv.iterdir(), key=_version_key, reverse=True):
                _add(found, seen, version_dir / "bin" / "python3")
                _add(found, seen, version_dir / "bin" / "python")
        _add(found, seen, "/usr/bin/python3")

    return found


def has_imports(python: str, imports: list[str]) -> bool:
    """检查解释器能否 import 全部依赖。"""
    code = "import " + ", ".join(imports)
    try:
        result = subprocess.run(
            [python, "-c", code],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=120,
        )
        return result.returncode == 0
    except Exception:
        return False


def save_cache(python: str, imports: list[str]) -> None:
    """缓存选中的解释器；缓存失败不影响主流程。"""
    try:
        path = cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"interpreter": python, "imports": imports},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass


def install_dependencies(found: list[str], imports: list[str]) -> str:
    """把缺失依赖装进第一个接受它们的解释器并返回该解释器。"""
    installable = [python for python in found if not python.startswith("/usr/bin/")] or found
    if not installable:
        sys.exit(
            "No usable Python interpreter found.\n"
            "Install Python 3 first, then run this skill again."
        )

    packages = pip_packages(imports)
    last_error = None
    for python in installable:
        print(f"[video-tts] dependencies missing; trying {python} ...", flush=True)
        try:
            subprocess.run(
                [python, "-m", "pip", "install", *PIP_FLAGS, *packages],
                check=True,
            )
        except Exception as exc:
            last_error = exc
            print(f"  install failed: {exc}")
            continue
        if has_imports(python, imports):
            return python

    manual = " ".join(packages)
    sys.exit(
        "Could not find or install video-tts dependencies.\n"
        "Install them manually, then run this skill again:\n"
        f"  {sys.executable} -m pip install {manual}\n"
        f"Last error: {last_error}"
    )


def main(argv: list[str] | None = None) -> int:
    """选择解释器后把 argv 原样交给 skill_main.py。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    if not MAIN_SCRIPT.is_file():
        sys.exit(f"skill_main.py not found next to run.py: {MAIN_SCRIPT}")

    imports = required_imports(argv)
    found = candidates()
    chosen = next((python for python in found if has_imports(python, imports)), None)
    if chosen:
        print(f"[video-tts] Using {chosen}", flush=True)
    else:
        chosen = install_dependencies(found, imports)

    save_cache(chosen, imports)
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT), *argv])


if __name__ == "__main__":
    sys.exit(main())
