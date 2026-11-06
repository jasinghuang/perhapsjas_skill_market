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
import threading
import time
from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf

from . import FLAGSHIP_MODEL
from .base import Voice

SAMPLE_RATE = 24000

# `--lang` 的人类可读语言名 → `bl --language` / DashScope 语言代码。
LANG_CODES = {
    "chinese": "zh",
    "english": "en",
    "japanese": "ja",
    "korean": "ko",
    "german": "de",
    "french": "fr",
    "russian": "ru",
    "portuguese": "pt",
    "spanish": "es",
    "italian": "it",
}
DEFAULT_LANG = "chinese"

# 429 / 5xx 的有界指数退避：共 3 次尝试（首次 + 2 次重试）。
RETRY_DELAYS = (1.0, 2.0)
BAILIAN_CONSOLE_URL = "https://bailian.console.aliyun.com/"
URL_READ_TIMEOUT = 10.0
LOGIN_WAIT_TIMEOUT = 5.0

_LOGIN_URL_RE = re.compile(r"https?://\S+")
_QUOTA_RE = re.compile(r"quota|额度|throttling", re.IGNORECASE)
_AUTH_RE = re.compile(
    r"\b401\b|\b403\b|unauthori[sz]ed|forbidden|not logged in|未登录|登录已过期",
    re.IGNORECASE,
)
_RETRYABLE_RE = re.compile(
    r"\b429\b|\b5\d\d\b|too many requests|rate.?limit|timeout|temporar",
    re.IGNORECASE,
)


class ProviderError(RuntimeError):
    """provider 准备或合成失败。"""


def find_login_url(text: str) -> str | None:
    """返回文本中第一个 http(s) URL；没有则返回 None。"""
    match = _LOGIN_URL_RE.search(text)
    return match.group(0) if match else None


def _language_code(lang: str) -> str:
    """把 `--lang` 映射成 `bl --language` 代码；未知值原样透传。"""
    return LANG_CODES.get(lang, lang)


def _language_type(lang: str) -> str:
    """把 `--lang` 映射成 DashScope 的 `language_type`（语言名首字母大写）。"""
    name = lang.strip().lower()
    if name in LANG_CODES:
        return name.capitalize()
    for full_name, code in LANG_CODES.items():
        if code == name:
            return full_name.capitalize()
    return lang.strip().capitalize()


def _classify_failure(detail: str) -> ProviderError | None:
    """把百炼错误文本归类成可直接展示的 `ProviderError`。

    额度 / 限流优先（即使同时带 429），其次是登录态；其余返回 `None`
    交给调用方决定是否重试。
    """
    if _QUOTA_RE.search(detail):
        return ProviderError(
            "百炼在线合成额度不足或被限流（quota / Throttling）；"
            f"请到百炼控制台检查额度与限流设置：{BAILIAN_CONSOLE_URL} ，"
            "或改用本地 provider。"
        )
    if _AUTH_RE.search(detail):
        return ProviderError(
            "bl 登录态无效或已过期（401/403）；"
            "请运行 `bl auth login` 重新登录后重试，或改用本地 provider。"
        )
    return None


def _readline_with_timeout(stream, timeout: float) -> str:
    """在后台线程读一行；超时返回空串，避免无换行输出永久阻塞。

    超时后守护线程可能仍阻塞在 `readline()` 上；调用方随后会终止子进程，
    管道关闭后线程自然退出。
    """
    result: list[str] = []

    def _read() -> None:
        try:
            result.append(stream.readline())
        except Exception:
            result.append("")

    thread = threading.Thread(target=_read, daemon=True)
    thread.start()
    thread.join(timeout)
    return result[0] if result else ""


def _stop_process(proc) -> None:
    """尽力终止登录子进程并回收（成功、超时、异常路径共用）。"""
    try:
        if proc.poll() is None:
            proc.terminate()
        proc.wait(timeout=LOGIN_WAIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
            proc.wait(timeout=LOGIN_WAIT_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired):
            pass
    except OSError:
        pass


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
            "请安装百炼 bl CLI 并登录；或设置环境变量 DASHSCOPE_API_KEY "
            "并同时提供 --tts-endpoint 使用 HTTP 兜底。"
        )

    def describe(self) -> dict:
        """返回 provider 的自描述信息（engine 用它生成稳定的缓存 key）。"""
        return {
            "provider": "online",
            "model": FLAGSHIP_MODEL,
            "http_fallback": self._use_http,
        }

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
        try:
            if proc.stdout is not None:
                while True:
                    line = _readline_with_timeout(
                        proc.stdout, URL_READ_TIMEOUT
                    )
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

            if last_url:
                raise ProviderError(
                    f"bl 登录失败或超时；请重试。登录链接：{last_url}"
                )
            raise ProviderError("bl 登录失败或超时；未从输出中捕获到登录链接")
        finally:
            _stop_process(proc)

    def build_bl_command(
        self,
        text: str,
        voice: Voice,
        out_path: Path,
        instruct: str = "",
        lang: str = DEFAULT_LANG,
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
            "--language",
            _language_code(lang),
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
        lang: str,
        out_path: Path,
    ) -> Path:
        """用 `bl speech synthesize` 合成到 out_path。

        429 / 5xx 有界指数退避重试 2 次（1s / 2s）；401/403 与额度问题
        立即给出可操作错误，不重试。
        """
        cmd = self.build_bl_command(text, voice, out_path, instruct, lang)
        for attempt in range(len(RETRY_DELAYS) + 1):
            try:
                subprocess.run(cmd, check=True, capture_output=True, text=True)
                return out_path
            except subprocess.CalledProcessError as exc:
                detail = "\n".join(
                    part for part in (exc.stderr, exc.stdout) if part
                ).strip()
                classified = _classify_failure(detail)
                if classified is not None:
                    raise classified from exc
                if (
                    attempt < len(RETRY_DELAYS)
                    and _RETRYABLE_RE.search(detail)
                ):
                    time.sleep(RETRY_DELAYS[attempt])
                    continue
                raise ProviderError(
                    f"bl synthesize failed: {detail or exc}"
                ) from exc
            except OSError as exc:
                raise ProviderError(
                    f"bl not found or not executable: {self.bl_bin!r}"
                ) from exc
        raise AssertionError("retry loop exhausted")  # pragma: no cover

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
        `lang` 映射成 DashScope 的 `language_type`（首字母大写）。
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
                "language_type": _language_type(lang),
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
                self._synthesize_bl(text, voice, instruct, lang, out_path)
            return _read_wav(out_path)
