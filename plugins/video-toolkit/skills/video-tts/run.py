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

# 每条路线一个锁定文件；base 由 -r 引入。本地路线按平台拆分：
# Apple Silicon → mlx-audio；Windows x64 → 官方 qwen-tts + CUDA torch
# （torch 本体由安装器按驱动从 cuXXX 索引装，不在 requirements 里）。
REQUIREMENTS = {
    "local_mlx": SKILL_DIR / "requirements-local.txt",
    "local_torch": SKILL_DIR / "requirements-torch.txt",
    "online": SKILL_DIR / "requirements-online.txt",
    "base": SKILL_DIR / "requirements-base.txt",
}

# Windows 本地 venv 与 audio-transcribe 的环境约定一致（video-toolkit/envs）。
TORCH_VENV_NAME = "video-tts-torch"

# Windows torch 路线锁定组合（实测基线；CUDA wheel 由安装器按驱动选索引）。
TORCH_TORCH_PIN = "torch==2.10.0"
TORCH_TORCHAUDIO_PIN = "torchaudio==2.10.0"

# 本地能力检测片段（macOS / mlx）：解释器架构 + Metal + TTS API 一次查完。
LOCAL_CAPABILITY_PROBE = (
    "import platform,sys;"
    "assert platform.machine()=='arm64', 'not arm64: '+platform.machine();"
    "import mlx.core as mx;"
    "assert mx.metal.is_available(), 'Metal unavailable';"
    "from mlx_audio.tts.utils import load_model;"
    "print('ok')"
)

# 本地能力检测片段（Windows / torch）：x64 + torch CUDA 构建 + 真实张量
# 运算 + qwen-tts API（spec §5.2：不靠 nvidia-smi 单独判定）。
TORCH_CAPABILITY_PROBE = (
    "import platform;"
    "assert platform.machine() in ('AMD64','x86_64'), "
    "'not x64: '+platform.machine();"
    "import torch;"
    "assert torch.cuda.is_available(), 'CUDA unavailable';"
    "x=(torch.ones(8,device='cuda')*2).sum().item();"
    "assert x==16.0, 'cuda tensor op failed';"
    "from qwen_tts import Qwen3TTSModel;"
    "print('ok')"
)

# 驱动报告的 CUDA 版本 → 官方 wheel 索引（spec §5.2：按目标机实际选择，
# 不把某个 cuXXX 当通用解；未知版本给出指引而不是硬猜）。
CUDA_INDEXES = {
    (13,): "cu130",
    (12, 8): "cu128",
    (12, 6): "cu126",
    (12, 4): "cu124",
}


def local_route() -> str:
    """`--provider local` 在当前平台的依赖路线：local_mlx / local_torch。"""
    if IS_MAC:
        return "local_mlx"
    if IS_WIN:
        return "local_torch"
    return "local_mlx"  # 非 Win 平台按 mlx 探测失败并给出修复步骤


def driver_cuda_index() -> str | None:
    """读 nvidia-smi 头部的 CUDA Version，映射到官方 wheel 索引名。

    nvidia-smi 的输出编码随系统区域设置（中文 Windows 是 GBK），
    `text=True` 按 UTF-8 解码会抛 UnicodeDecodeError——按字节捕获后
    用 errors="replace" 解码，"CUDA Version: X.Y" 本身是 ASCII 不受影响。
    """
    try:
        result = subprocess.run(
            ["nvidia-smi"], capture_output=True, timeout=15,
        )
    except Exception:
        return None
    output = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
    # 经典 Linux 格式是 "CUDA Version: 13.3"；新版 Windows 驱动的
    # nvidia-smi 头部是 "CUDA UMD Version: 13.3"——两种都认。
    match = re.search(
        r"CUDA(?:\s+UMD)?\s+Version:\s*(\d+)\.(\d+)", output,
    )
    if not match:
        return None
    major, minor = int(match.group(1)), int(match.group(2))
    if (major,) in CUDA_INDEXES:
        return CUDA_INDEXES[(major,)]
    return CUDA_INDEXES.get((major, minor))


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
    """返回本次运行的依赖路线：`base` / `local_mlx` / `local_torch` / `online`。"""
    if _is_preview(argv):
        return "base"
    provider = _provider_from_argv(argv)
    if provider == "local":
        return local_route()
    if provider == "online":
        return "online"
    return "base"


def route_imports(route: str) -> list[str]:
    """返回路线所需的顶层 import 名（能力探测用）。"""
    base = ["soundfile", "numpy"]
    if route == "local_mlx":
        return base + ["mlx_audio"]
    if route == "local_torch":
        return base + ["torch", "qwen_tts"]
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


def venv_python(route: str = "base") -> Path:
    """本 skill 专用 venv 的解释器路径（本地路线按后端分目录）。"""
    if IS_WIN:
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        if route == "local_torch":
            # 与 audio-transcribe 的环境约定一致（video-toolkit/envs/）。
            return (
                base / "video-toolkit" / "envs" / TORCH_VENV_NAME
                / "Scripts" / "python.exe"
            )
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


def candidates(route: str = "base") -> list[str]:
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
    _add(found, seen, venv_python(route))

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
    """跑一次 `python -c`；超时 / 无法启动返回 None。

    解码用 errors="replace"：子进程输出可能带任意区域设置的警告文本
    （中文 Windows 控制台是 GBK），探测只关心 ASCII 的断言信息。
    """
    try:
        return subprocess.run(
            [python, "-c", code],
            capture_output=True, timeout=timeout,
        )
    except Exception:
        return None


def _probe_text(result: subprocess.CompletedProcess) -> str:
    """把探测输出的字节按 UTF-8 宽松解码成文本（GBK 环境不崩溃）。"""
    raw = result.stderr or b""
    try:
        return raw.decode("utf-8", errors="replace")
    except Exception:  # pragma: no cover - decode with replace 不会抛
        return ""


def has_imports(python: str, imports: list[str]) -> bool:
    """检查解释器能否 import 全部依赖。"""
    result = _run_probe(python, "import " + ", ".join(imports))
    return result is not None and result.returncode == 0


def capability_problems(python: str, route: str) -> list[str]:
    """返回该解释器在本路线上的能力问题（空列表 = 可用）。

    本地路线不止 import：mlx 要 arm64 原生 + Metal + TTS API；torch 要
    x64 + CUDA 构建 + 真实张量运算 + qwen-tts API（spec §5.2）。
    """
    if route == "local_mlx":
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
        detail = _probe_text(result).strip().splitlines()
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

    if route == "local_torch":
        if not IS_WIN:
            return [
                "本地 torch 路线面向原生 Windows x64 + NVIDIA GPU；当前系统 "
                f"{SYSTEM or 'unknown'}。macOS 请用 MLX 路线，其他环境可用 "
                "--provider online"
            ]
        result = _run_probe(python, TORCH_CAPABILITY_PROBE, timeout=120)
        if result is None:
            return [f"无法在 {python} 上运行本地能力检测（启动 / 超时）"]
        if result.returncode == 0:
            return []
        detail = _probe_text(result).strip().splitlines()
        last = detail[-1] if detail else f"exit {result.returncode}"
        if "not x64" in last:
            return [
                f"{python} 不是 x64 解释器（{last}）；torch CUDA 路线需要 "
                "原生 x64 Python"
            ]
        if "CUDA unavailable" in last:
            return [
                f"{python} 上 torch.cuda 不可用（{last}）：无 NVIDIA GPU / "
                "驱动不匹配 / 装到 CPU 版 torch。检查 nvidia-smi 与 "
                "torch.version.cuda；本机无 NVIDIA 显卡时请用 "
                "--provider online"
            ]
        if "cuda tensor op failed" in last:
            return [
                f"{python} 上 CUDA 张量运算失败（{last}）；请更新显卡驱动 "
                "后重试，或改用 --provider online"
            ]
        return [
            f"{python} 本地能力检测未通过：{last}；"
            "请确认 qwen-tts 与 CUDA 版 torch 已正确安装，或改用 "
            "--provider online"
        ]

    return []


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


def _ensure_venv(route: str) -> str:
    """创建（如需）专用 venv，返回其解释器路径。"""
    python = venv_python(route)
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


def _installer(python: str) -> list[str]:
    """安装命令前缀：优先 uv（多 venv 同 wheel 硬链接共享磁盘），无则 pip。"""
    uv = shutil.which("uv")
    if uv:
        return [uv, "pip", "install", "--python", python]
    return [python, "-m", "pip", "install"]


def install_into_venv(route: str) -> str:
    """把锁定依赖装进专用 venv（只装这一处，绝不装进全局解释器）。

    torch 路线两阶段安装：先按驱动实际支持的 CUDA 版本从官方 cuXXX
    索引装 torch / torchaudio（PyPI 默认源在 Windows 是 CPU wheel），
    再装 qwen-tts 锁定组合。uv 存在时全程用 uv（硬链接去重）。
    """
    python = _ensure_venv(route)
    requirements = requirements_file(route)
    try:
        if route == "local_torch":
            index = driver_cuda_index()
            if index is None:
                sys.exit(
                    "无法从 nvidia-smi 判断驱动支持的 CUDA 版本（无 NVIDIA "
                    "显卡或驱动异常）。确认 `nvidia-smi` 可用后重试；无 "
                    "NVIDIA GPU 的机器请使用 --provider online。"
                )
            print(
                f"[video-tts] installing CUDA torch ({TORCH_TORCH_PIN}, "
                f"{index} build) into {python.parent.parent} …",
                flush=True,
            )
            subprocess.run(
                _installer(python) + [
                    TORCH_TORCH_PIN, TORCH_TORCHAUDIO_PIN,
                    "--index-url", f"https://download.pytorch.org/whl/{index}",
                ],
                check=True,
            )
        print(
            f"[video-tts] installing locked dependencies into the skill venv "
            f"({requirements.name}) …",
            flush=True,
        )
        subprocess.run(
            _installer(python) + ["-r", str(requirements)],
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

    # 本地路线在明确不支持的平台上先给出结论，不做无谓尝试。
    if route in ("local_mlx", "local_torch"):
        unsupported = capability_problems(sys.executable, route)
        if unsupported and (
            (route == "local_mlx" and not IS_MAC)
            or (route == "local_torch" and not IS_WIN)
        ):
            sys.exit("\n".join(unsupported))

    # 只复用「已经能跑」的解释器；不在多个全局解释器间循环安装。
    for python in candidates(route):
        if not has_imports(python, imports):
            continue
        problems = capability_problems(python, route)
        if problems:
            continue
        return python

    # 都不行：创建 / 补装专用 venv（隔离且锁定，不用 break-system-packages）。
    python = venv_python(route)
    if python.is_file():
        problems = capability_problems(str(python), route)
        if problems and (
            (route == "local_mlx" and not IS_MAC)
            or (route == "local_torch" and not IS_WIN)
        ):
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
    chosen = resolve_interpreter(route)
    print(f"[video-tts] Using {chosen} (route: {route})", flush=True)
    save_cache(chosen, route)
    sys.stdout.flush()
    return subprocess.call([chosen, str(MAIN_SCRIPT), *argv])


if __name__ == "__main__":
    sys.exit(main())
