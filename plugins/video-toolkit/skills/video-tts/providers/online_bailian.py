"""video-tts — 百炼在线 TTS provider（`bl` CLI）。

在线 provider 走百炼官方 `bl` CLI：

- `bl auth status --output json` 检查登录态；
- 未登录时 `bl auth login --console --no-browser` 启动控制台登录流程，
  从输出中提取登录链接交给调用方（CLI 可打印/打开），轮询直到登录完成；
- 合成走 `bl speech synthesize`，输出 24 kHz 单声道 WAV 后读回 float32 PCM。

所有子进程调用都集中在少数几个函数里，测试可整体 mock，不会真的调用
`bl` 或访问网络。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

from .base import Voice

FLAGSHIP_MODEL = "qwen-audio-3.1-tts-plus"
SAMPLE_RATE = 24000

_LOGIN_URL_RE = re.compile(r"https?://\S+")


class ProviderError(RuntimeError):
    """provider 准备或合成失败。"""


def find_login_url(text: str) -> str | None:
    """返回文本中第一个 http(s) URL；没有则返回 None。"""
    match = _LOGIN_URL_RE.search(text)
    return match.group(0) if match else None


def is_authenticated(bl_bin: str = "bl") -> bool:
    """调用 `bl auth status --output json`；任何错误都视为未登录。"""
    try:
        result = subprocess.run(
            [bl_bin, "auth", "status", "--output", "json"],
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)
        return payload.get("authenticated") is True
    except Exception:
        return False


class OnlineBailianProvider:
    """通过 `bl` CLI 调用百炼在线 TTS。"""

    def __init__(
        self,
        bl_bin: str = "bl",
        api_key: str | None = None,
        endpoint: str | None = None,
        poll_interval: float = 2.0,
        login_timeout: float = 300.0,
    ) -> None:
        self.bl_bin = bl_bin
        self.api_key = api_key
        self.endpoint = endpoint
        self.poll_interval = poll_interval
        self.login_timeout = login_timeout

    def is_authenticated(self) -> bool:
        """检查当前 `bl_bin` 的登录态。"""
        return is_authenticated(self.bl_bin)

    def prepare(self) -> None:
        """确认 `bl` 可用并已登录。"""
        if shutil.which(self.bl_bin) is None:
            if self.api_key:
                # Task 6 会在这里接入 DashScope HTTP 兜底。
                raise ProviderError(
                    "bl not found; the DashScope HTTP fallback is not available yet"
                )
            raise ProviderError(
                f"bl not found: {self.bl_bin!r}. "
                "请安装百炼 bl CLI 并登录，或稍后使用 API key。"
            )
        self.ensure_authenticated()

    def ensure_authenticated(
        self, on_url: Callable[[str], None] | None = None
    ) -> None:
        """确保已登录；未登录时启动控制台登录并等待完成。"""
        if self.is_authenticated():
            return

        proc = subprocess.Popen(
            [self.bl_bin, "auth", "login", "--console", "--no-browser"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        last_url: str | None = None
        if proc.stdout is not None:
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                url = find_login_url(line)
                if url:
                    last_url = url
                    if on_url is not None:
                        on_url(url)
                    print(f"请点击登录：{url}", flush=True)
                    break

        deadline = time.monotonic() + self.login_timeout
        while time.monotonic() < deadline:
            if self.is_authenticated():
                return
            if proc.poll() is not None:
                break
            time.sleep(self.poll_interval)

        proc.terminate()
        if last_url:
            raise ProviderError(f"bl 登录失败或超时；请重试。登录链接：{last_url}")
        raise ProviderError("bl 登录失败或超时；未从输出中捕获到登录链接")

    def build_bl_command(
        self,
        text: str,
        voice: Voice,
        out_path: Path,
        instruct: str = "",
    ) -> list[str]:
        """构造 `bl speech synthesize` 命令行。"""
        cmd = [
            self.bl_bin,
            "speech",
            "synthesize",
            "--text",
            text,
            "--model",
            voice.model,
            "--voice",
            voice.voice_id,
            "--format",
            "wav",
            "--sample-rate",
            str(SAMPLE_RATE),
            "--out",
            str(out_path),
        ]
        if voice.model == FLAGSHIP_MODEL and instruct:
            cmd.extend(["--instruction", instruct])
        return cmd

    def synthesize(
        self,
        text: str,
        voice: Voice,
        instruct: str = "",
        lang: str = "chinese",
    ) -> np.ndarray:
        """合成一段文本，返回 24 kHz 单声道 float32 PCM。"""
        with tempfile.TemporaryDirectory(prefix="video-tts-online-") as tmp:
            out_path = Path(tmp) / "segment.wav"
            cmd = self.build_bl_command(text, voice, out_path, instruct)
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as exc:
                detail = (exc.stderr or "").strip()
                raise ProviderError(f"bl synthesize failed: {detail or exc}") from exc
            except OSError as exc:
                raise ProviderError(
                    f"bl not found or not executable: {self.bl_bin!r}"
                ) from exc

            try:
                audio, sample_rate = sf.read(
                    str(out_path), dtype="float32", always_2d=True
                )
            except Exception as exc:
                raise ProviderError(f"failed to read synthesized wav: {exc}") from exc

        if sample_rate != SAMPLE_RATE:
            raise ProviderError(
                f"expected {SAMPLE_RATE} Hz audio from bl, got {sample_rate} Hz"
            )

        mono = audio.mean(axis=1) if audio.shape[1] > 1 else audio[:, 0]
        return np.ascontiguousarray(mono, dtype=np.float32)
