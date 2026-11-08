#!/usr/bin/env python3
"""video-tts launcher — 隔离环境、锁定依赖、能力检测后交接 skill_main.py。

环境策略（spec §11）：

1. `VIDEO_TTS_PYTHON` 显式指定的解释器（用户对兼容环境负责）；
2. 本 skill 的专用 venv（`<cache>/video-tts/venv`，缺依赖时只往这个 venv
   里补装，绝不碰系统 / Homebrew / 其他 skill 的解释器，也不用
   `--break-system-packages`）；
3. 任何**已经**能 import 所需依赖的现有解释器（只复用、不安装）；
4. 都不行才创建专用 venv 并按锁定文件（`requirements-local.txt` /
   `requirements-online.txt`）安装。

能力检测不止 `import mlx_audio`：本地路线还要求解释器是 Apple Silicon
原生（arm64，排除 Rosetta / Intel Python）且 Metal 运算可用；Windows 一律
拒绝本地路线（本期只支持在线），也不安装 mlx-audio。安装 / 登录 / 下载 /
加载分别提示，不把全部初始化都表现成「卡住」。

`--dry-run` / `--help` 只需要基础依赖，绝不触发模型依赖安装。

用法与 skill_main.py 一致：

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

# 每条路线一个锁定文件；base 由 -r 引入。
REQUIREMENTS = {
    "local": SKILL_DIR / "requirements-local.txt",
    "online": SKILL_DIR / "requirements-online.txt",
    "base": SKILL_DIR / "requirements-base.txt",
}

# 本地能力检测片段：解释器架构 + Metal + TTS API 一次查完。
LOCAL_CAPABILITY_PROBE = (
    "import platform,sys;"
    "assert platform.machine()=='arm64', 'not arm64: '+platform.machine();"
    "import mlx.core as mx;"
    "assert mx.metal.is_available(), 'Metal unavailable';"
    "from mlx_audio.tts.utils import load_model;"
    "print('ok')"
)


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
PREVIEW_FLAGS = ("--dry-run", "--help", "--write-plan")


def _is_preview(argv: list[str]) -> bool:
    """`--dry-run` / `--help` / `--write-plan` 只需要解析与基础依赖。

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


def required_route(argv: list[str]) -> str:
    """返回本次运行的依赖路线：`base` / `local` / `online`。"""
    if _is_preview(argv):
        return "base"
    provider = _provider_from_argv(argv)
    if provider == "local":
        return "local"
    if provider == "online":
        return "online"
    return "base"


def route_imports(route: str) -> list[str]:
    """返回路线所需的顶层 import 名（能力探测用）。"""
    base = ["soundfile", "numpy"]
    if route == "local":
        return base + ["mlx_audio"]
    if route == "online":
        return base + ["requests"]
    return base


def cache_path() -> Path:
    """解释器缓存位置：`~/.cache/video-tts/env.json`（尊重 XDG）。"""
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "video-tts" / "env.json"


def venv_python() -> Path:
    """本 skill 专用 venv 的解释器路径。"""
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        return base / "video-tts" / "venv" / "Scripts" / "python.exe"
    base = Path(os.environ.get("XDG_CACHE_HOME") or (Path.home() / ".cache"))
    return base / "video-tts" / "venv" / "bin" / "python"


def requirements_file(route: str) -> Path:
    """路线对应的锁定依赖文件。"""
    return REQUIREMENTS.get(route) or REQUIREMENTS["base"]


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
    """返回待复用的解释器路径（只复用、不安装），最可能在前。"""
    found: list[str] = []
    seen: set[str] = set()

    # 上次选中的解释器是最佳猜测——使用前仍会真正 import 校验。
    try:
        cached = json.loads(cache_path().read_text(encoding="utf-8")).get("interpreter")
        _add(found, seen, cached)
    except Exception:
        pass

    _add(found, seen, sys.executable)
    _add(found, seen, venv_python())

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
            for match in sorted(Path(base).glob("python3.*"), key=_version_key, reverse=True):
                _add(found, seen, match)
        pyenv = Path.home() / ".pyenv" / "versions"
        if pyenv.is_dir():
            for version_dir in sorted(pyenv.iterdir(), key=_version_key, reverse=True):
                _add(found, seen, version_dir / "bin" / "python3")
                _add(found, seen, version_dir / "bin" / "python")
        _add(found, seen, "/usr/bin/python3")

    return found


def _run_probe(python: str, code: str, timeout: int = 180) -> subprocess.CompletedProcess | None:
    """跑一次 `python -c`；超时 / 无法启动返回 None。"""
    try:
        return subprocess.run(
            [python, "-c", code],
            capture_output=True, text=True, timeout=timeout,
        )
    except Exception:
        return None


def has_imports(python: str, imports: list[str]) -> bool:
    """检查解释器能否 import 全部依赖。"""
    result = _run_probe(python, "import " + ", ".join(imports))
    return result is not None and result.returncode == 0


def capability_problems(python: str, route: str) -> list[str]:
    """返回该解释器在本路线上的能力问题（空列表 = 可用）。

    本地路线不止 import：还要 arm64 原生（排除 Rosetta 里的 Intel
    Python）+ Metal 可用 + mlx_audio 的 TTS API 存在。
    """
    if route != "local":
        return []
    if not IS_MAC:
        return [
            "本地 MLX 路线仅支持 Apple Silicon macOS；当前系统 "
            f"{SYSTEM or 'unknown'}，请使用 --provider online"
        ]
    result = _run_probe(python, LOCAL_CAPABILITY_PROBE)
    if result is None:
        return [f"无法在 {python} 上运行本地能力检测（启动 / 超时）"]
    if result.returncode == 0:
        return []
    detail = (result.stderr or "").strip().splitlines()
    last = detail[-1] if detail else f"exit {result.returncode}"
    if "not arm64" in last:
        return [
            f"{python} 不是 Apple Silicon 原生解释器（{last}）；"
            "Rosetta / Intel Python 无法运行 MLX。请安装 arm64 版 Python "
            "（如 `brew install python@3.14`）或改用 --provider online"
        ]
    if "Metal unavailable" in last:
        return [
            f"{python} 上 Metal 不可用（{last}）；MLX 需要 Metal。"
            "请检查是否运行在虚拟机 / 远程会话，或改用 --provider online"
        ]
    return [
        f"{python} 本地能力检测未通过：{last}；"
        "请确认 mlx-audio 已正确安装，或改用 --provider online"
    ]


def save_cache(python: str, route: str) -> None:
    """缓存选中的解释器；缓存失败不影响主流程。"""
    try:
        path = cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"interpreter": python, "route": route},
                ensure_ascii=False, indent=2,
            ) + "\n",
            encoding="utf-8",
        )
    except Exception:
        pass


def _ensure_venv() -> str:
    """创建（如需）专用 venv，返回其解释器路径。"""
    python = venv_python()
    if not python.is_file():
        base = shutil.which("python3") or shutil.which("python")
        if not base:
            sys.exit(
                "No Python 3 found to create the video-tts venv.\n"
                "Install Python 3 first (macOS: brew install python; "
                "Windows: winget install Python.Python.3), then retry."
            )
        print(f"[video-tts] creating dedicated venv at {python.parent.parent} …", flush=True)
        subprocess.run([base, "-m", "venv", str(python.parent.parent)], check=True)
    return str(python)


def install_into_venv(route: str) -> str:
    """把锁定依赖装进专用 venv（只装这一处，绝不装进全局解释器）。"""
    python = _ensure_venv()
    requirements = requirements_file(route)
    print(
        f"[video-tts] installing locked dependencies into the skill venv "
        f"({requirements.name}) …",
        flush=True,
    )
    try:
        subprocess.run(
            [python, "-m", "pip", "install", "-r", str(requirements)],
            check=True,
        )
    except Exception as exc:
        sys.exit(
            "Could not install video-tts dependencies into the dedicated "
            f"venv.\nManual fallback:\n  {python} -m pip install -r "
            f"{requirements}\nLast error: {exc}"
        )
    return python


def resolve_interpreter(route: str) -> str:
    """选出可复用 / 可创建的解释器；路线不可用时给出修复步骤退出。"""
    imports = route_imports(route)

    # 显式指定的环境优先（用户对它负责，仍做能力检测给出准确报错）。
    explicit = os.environ.get("VIDEO_TTS_PYTHON")
    if explicit:
        found: list[str] = []
        _add(found, set(), explicit)
        if not found:
            sys.exit(
                f"VIDEO_TTS_PYTHON is set but not an executable file: "
                f"{explicit!r}; fix the path or unset the variable."
            )
        problems = capability_problems(found[0], route)
        if problems:
            sys.exit("VIDEO_TTS_PYTHON unusable:\n  " + "\n  ".join(problems))
        if not has_imports(found[0], imports):
            sys.exit(
                f"VIDEO_TTS_PYTHON ({found[0]}) lacks required imports "
                f"({', '.join(imports)}); install them into that "
                "environment or unset the variable."
            )
        return found[0]

    # 本地路线在非 Apple Silicon 上先给出明确结论，不做无谓尝试。
    if route == "local":
        problems = capability_problems(sys.executable, route)
        if problems and not IS_MAC:
            sys.exit("\n".join(problems))

    # 只复用「已经能跑」的解释器；不在多个全局解释器间循环安装。
    for python in candidates():
        if not has_imports(python, imports):
            continue
        problems = capability_problems(python, route)
        if problems:
            continue
        return python

    # 都不行：创建 / 补装专用 venv（隔离且锁定，不用 break-system-packages）。
    python = venv_python()
    if python.is_file():
        target = str(python)
        problems = capability_problems(target, route)
        if problems and route == "local" and not IS_MAC:
            sys.exit("\n".join(problems))
    python = install_into_venv(route)
    problems = capability_problems(python, route)
    if problems:
        sys.exit("\n".join(problems))
    if not has_imports(python, imports):
        sys.exit(
            f"dependency installation into the venv succeeded but imports "
            f"still fail ({', '.join(imports)}); see messages above"
        )
    return python


def main(argv: list[str] | None = None) -> int:
    """选择解释器后把 argv 原样交给 skill_main.py。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    if not MAIN_SCRIPT.is_file():
        sys.exit(f"skill_main.py not found next to run.py: {MAIN_SCRIPT}")

    route = required_route(argv)
    if route == "local" and IS_WIN:
        sys.exit(
            "本地 MLX 配音仅支持 Apple Silicon macOS；Windows 请使用 "
            "--provider online（百炼在线路线）。"
        )

    chosen = resolve_interpreter(route)
    print(f"[video-tts] Using {chosen} (route: {route})", flush=True)
    save_cache(chosen, route)
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT), *argv])


if __name__ == "__main__":
    sys.exit(main())
