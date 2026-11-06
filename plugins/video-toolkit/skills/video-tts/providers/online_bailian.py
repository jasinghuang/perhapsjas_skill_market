"""video-tts — 百炼在线 TTS provider（`bl` CLI / DashScope HTTP）。

在线 provider 优先走百炼官方 `bl` CLI：

- `bl auth status --output json` 检查登录态；
- 未登录时 `bl auth login --console --no-browser` 启动控制台登录流程，
  从输出中提取登录链接交给调用方（CLI 可打印/打开），轮询直到登录完成；
- 合成走 `bl speech synthesize`，输出 24 kHz 单声道 WAV 后读回 float32 PCM。

`bl` 不可用但提供了 API key 时，`prepare()` 切到 DashScope HTTP 兜底：
POST 合成请求，把 `output.audio.url` 指向的 WAV 下载到临时文件，再走同一套
解码逻辑。两条路径都返回 24 kHz 单声道 float32 PCM。

所有子进程 / HTTP 调用都集中在少数几个函数里，测试可整体 mock，不会真的
调用 `bl` 或访问网络。
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


def _read_wav(path: Path) -> np.ndarray:
    """读取合成结果，返回 24 kHz 单声道 float32 PCM。"""
    try:
        audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise ProviderError(f"failed to read synthesized wav: {exc}") from exc

    if sample_rate != SAMPLE_RATE:
        raise ProviderError(f"expected {SAMPLE_RATE} Hz audio, got {sample_rate} Hz")

    mono = audio.mean(axis=1) if audio.shape[1] > 1 else audio[:, 0]
    return np.ascontiguousarray(mono, dtype=np.float32)


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
        self._use_http = False

    def is_authenticated(self) -> bool:
        """检查当前 `bl_bin` 的登录态。"""
        return is_authenticated(self.bl_bin)

    def prepare(self) -> None:
        """选择合成路径：优先 `bl` CLI，否则用 DashScope HTTP 兜底。"""
        if shutil.which(self.bl_bin) is not None:
            self._use_http = False
            self.ensure_authenticated()
            return
        if self.api_key:
            if not self.endpoint:
                raise ProviderError("--tts-endpoint is required for HTTP fallback")
            self._use_http = True
            return
        raise ProviderError(
            f"bl not found: {self.bl_bin!r}. "
            "请安装百炼 bl CLI 并登录，或同时提供 --api-key 与 --tts-endpoint "
            "使用 HTTP 兜底。"
        )

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

    def _synthesize_bl(
        self,
        text: str,
        voice: Voice,
        instruct: str,
        out_path: Path,
    ) -> Path:
        """用 `bl speech synthesize` 合成到 out_path。"""
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
        return out_path

    def _synthesize_http(
        self,
        text: str,
        voice: Voice,
        instruct: str,
        lang: str,
        out_path: Path,
    ) -> Path:
        """通过 DashScope HTTP API 合成并把音频下载到 out_path。

        只负责请求与下载，不解码 WAV；解码统一交给 `synthesize`。
        `lang` 保留给 provider 接口一致性，DashScope 会从文本自动判断语言。
        """
        if not self.endpoint:
            raise ProviderError("--tts-endpoint is required for HTTP fallback")

        try:
            import requests
        except ImportError as exc:
            raise ProviderError(
                "requests is required for HTTP fallback: pip install requests"
            ) from exc

        payload = {
            "model": voice.model,
            "input": {
                "text": text,
                "voice": voice.voice_id,
                "format": "wav",
                "sample_rate": SAMPLE_RATE,
            },
        }
        if voice.model == FLAGSHIP_MODEL and instruct:
            payload["input"]["instruction"] = instruct

        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            response = requests.post(
                self.endpoint, json=payload, headers=headers, timeout=60
            )
            response.raise_for_status()
            audio_url = response.json()["output"]["audio"]["url"]
        except Exception as exc:
            raise ProviderError(
                f"DashScope HTTP TTS request failed: {exc}"
            ) from exc

        try:
            download = requests.get(audio_url, timeout=60)
            download.raise_for_status()
        except Exception as exc:
            raise ProviderError(
                f"failed to download synthesized audio: {exc}"
            ) from exc

        out_path.write_bytes(download.content)
        return out_path

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
            if self._use_http:
                self._synthesize_http(text, voice, instruct, lang, out_path)
            else:
                self._synthesize_bl(text, voice, instruct, out_path)
            return _read_wav(out_path)
