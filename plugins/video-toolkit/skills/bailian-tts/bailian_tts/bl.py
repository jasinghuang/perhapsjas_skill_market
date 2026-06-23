"""bl CLI 封装(subprocess)。"""
from __future__ import annotations
import json
import re
import subprocess


class BlError(RuntimeError):
    pass


def _run(args: list[str], capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["bl", *args], capture_output=capture, text=True)


def auth_ok() -> bool:
    """bl 是否已鉴权。"""
    try:
        r = _run(["auth", "status", "--output", "json"])
    except FileNotFoundError:
        return False
    if r.returncode != 0:
        return False
    try:
        return bool(json.loads(r.stdout).get("authenticated"))
    except json.JSONDecodeError:
        return False


def list_system_voices(model: str = "cosyvoice-v3-flash") -> list[dict]:
    """返回 [{id, name, desc, lang}, ...]。

    bl 的 --list-voices 不支持 --output json,输出固定列表格,按 2+ 空格分列。
    """
    r = _run(["speech", "synthesize", "--list-voices", "--model", model])
    if r.returncode != 0:
        raise BlError(r.stderr or "bl --list-voices failed")
    voices: list[dict] = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("System voices") \
           or line.startswith("VOICE") or line.startswith("---") \
           or line.startswith("Total:"):
            continue
        parts = re.split(r"\s{2,}", line)
        if len(parts) < 2:
            continue
        # id 取首列、lang 取末列(最可靠);中间尽力还原 name/desc
        vid = parts[0]
        lang = parts[-1]
        mid = parts[1:-1]
        name = mid[0] if mid else ""
        desc = " ".join(mid[1:]) if len(mid) > 1 else ""
        voices.append({"id": vid, "name": name, "desc": desc, "lang": lang})
    return voices


def synth(text: str, voice: str, out: str, model: str = "cosyvoice-v3-flash",
          fmt: str = "mp3", rate: float | None = None, pitch: float | None = None,
          volume: int | None = None, instruction: str | None = None,
          language: str | None = None) -> None:
    """合成一段。失败 raise BlError(含 stderr)。"""
    args = ["speech", "synthesize", "--text", text, "--voice", voice,
            "--out", out, "--model", model, "--format", fmt]
    if rate is not None:
        args += ["--rate", str(rate)]
    if pitch is not None:
        args += ["--pitch", str(pitch)]
    if volume is not None:
        args += ["--volume", str(volume)]
    if instruction:
        args += ["--instruction", instruction]
    if language:
        args += ["--language", language]
    r = _run(args)
    if r.returncode != 0:
        raise BlError(r.stderr or f"bl speech synthesize failed (rc={r.returncode})")


def file_upload(path: str, model: str) -> str:
    """上传本地文件到 DashScope 临时存储(48h),返回公网 URL。

    bl file upload --file <path> --model <model>。输出格式不保证,用正则提取 URL。
    """
    r = _run(["file", "upload", "--file", path, "--model", model, "--output", "json"])
    if r.returncode != 0:
        raise BlError(r.stderr or "bl file upload failed")
    # 1) 先试 JSON 解析
    url = None
    try:
        data = json.loads(r.stdout)
        url = (data.get("url") or data.get("output", {}).get("url")
               or data.get("data", {}).get("url"))
    except (json.JSONDecodeError, AttributeError):
        pass
    # 2) 回退:从文本里正则提 URL
    if not url:
        m = re.search(r"https?://\S+", r.stdout + r.stderr)
        url = m.group(0) if m else None
    if not url:
        raise BlError(f"无法从 bl file upload 输出提取 URL: {r.stdout!r}")
    return url
