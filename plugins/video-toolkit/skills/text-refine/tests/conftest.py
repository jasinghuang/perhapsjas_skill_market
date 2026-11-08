import sys
import subprocess
from pathlib import Path

# 让 tests/ 可以 import 上级目录的 skill 模块（srt_struct 等）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SKILL_MAIN = Path(__file__).resolve().parent.parent / "skill_main.py"


def run_cli(*args: str, timeout: float = 30.0) -> tuple[int, str, str]:
    """以子进程运行 skill_main.py，返回 (returncode, stdout, stderr)。

    超时返回 124——把"挂死"变成可断言的失败而不是卡住测试进程。
    """
    try:
        proc = subprocess.run(
            [sys.executable, str(SKILL_MAIN), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return 124, "", f"TIMEOUT after {timeout}s: skill_main.py {' '.join(args)}"
    return proc.returncode, proc.stdout, proc.stderr
