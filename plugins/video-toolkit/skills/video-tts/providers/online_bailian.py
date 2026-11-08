"""video-tts — 百炼在线 TTS provider（`bl` CLI / DashScope HTTP）。

在线 provider 优先走百炼官方 `bl` CLI：

- `bl auth status --output json` 检查登录态；
- 未登录时 `bl auth login --console --no-browser` 启动控制台登录流程，
  从输出中提取登录链接交给调用方（CLI 可打印/打开），轮询直到登录完成；
- 合成走 `bl speech synthesize`，输出 WAV 后读回 float32 PCM。

`bl` 不可用但提供了 API key 时，`prepare()` 切到 DashScope HTTP 兜底：
POST 合成请求，把 `output.audio.url` 指向的 WAV 下载到临时文件，再走同一
套解码逻辑。

重试契约（spec §10）：本 provider **不做合成重试**——失败统一抛带分类的
`SynthesisError`，由 engine 的统一调度层在总预算内决定重试。唯一例外是
「合成成功、音频下载失败」：下载有独立的重试预算（不重新提交合成）。
采样率以实际 WAV 元数据为准，不假定 24000。

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

from . import CANTONESE_VOICE_IDS, FLAGSHIP_MODEL
from .base import SynthesisResult, Voice
from .errors import (
    FATAL,
    RETRYABLE,
    SUBMISSION_UNKNOWN,
    SynthesisError,
)

SAMPLE_RATE = 24000  # 在线请求的采样率；实际结果仍以 WAV 元数据为准。

# 音频下载的独立重试预算（合成提交预算由 engine 统一控制，与此分开）。
DOWNLOAD_ATTEMPTS = 3
DOWNLOAD_RETRY_DELAYS = (1.0, 2.0)

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

BAILIAN_CONSOLE_URL = "https://bailian.console.aliyun.com/"
URL_READ_TIMEOUT = 10.0
LOGIN_WAIT_TIMEOUT = 5.0

_LOGIN_URL_RE = re.compile(r"https?://\S+")
_QUOTA_RE = re.compile(r"quota|额度|throttling", re.IGNORECASE)
_AUTH_RE = re.compile(
    r"\b401\b|\b403\b|unauthori[sz]ed|forbidden|not logged in|未登录|登录已过期",
    re.IGNORECASE,
)
_RATE_LIMIT_RE = re.compile(r"\b429\b|too many requests|rate.?limit", re.IGNORECASE)
_SERVER_ERROR_RE = re.compile(r"\b5\d\d\b|internal server error|bad gateway|"
                              r"service unavailable|temporar", re.IGNORECASE)
_TIMEOUT_RE = re.compile(r"timeout|timed out|deadline exceeded|超时", re.IGNORECASE)
_RETRY_AFTER_RE = re.compile(r"retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)", re.IGNORECASE)


class ProviderError(SynthesisError):
    """provider 准备或合成失败（历史名；现在携带错误分类）。"""


def find_login_url(text: str) -> str | None:
    """返回文本中第一个 http(s) URL；没有则返回 None。"""
    match = _LOGIN_URL_RE.search(text)
    return match.group(0) if match else None


def _language_code(lang: str) -> str:
    """把 `--lang` 映射成 `bl --language` 代码；未知值原样透传。"""
    return LANG_CODES.get(lang, lang)


def _wrap_ssml(text: str) -> str:
    """SSML 文本必须以 <speak>...</speak> 包裹；已包裹则原样返回。"""
    stripped = text.strip()
    if stripped.startswith("<speak") and stripped.endswith("</speak>"):
        return stripped
    return f"<speak>{text}</speak>"


def _language_type(lang: str) -> str:
    """把 `--lang` 映射成 DashScope 的 `language_type`（语言名首字母大写）。"""
    name = lang.strip().lower()
    if name in LANG_CODES:
        return name.capitalize()
    for full_name, code in LANG_CODES.items():
        if code == name:
            return full_name.capitalize()
    return lang.strip().capitalize()


def _classify_failure(detail: str) -> SynthesisError | None:
    """把百炼错误文本归类成可直接展示的致命 `SynthesisError`。

    额度 / 限流优先（即使同时带 429，额度类也按 fatal 处理——重试无意义），
    其次是登录态；其余返回 `None` 交给调用方按可重试 / 状态不明分类。
    """
    if _QUOTA_RE.search(detail):
        return SynthesisError(
            "百炼在线合成额度不足或被限流（quota / Throttling）；"
            f"请到百炼控制台检查额度与限流设置：{BAILIAN_CONSOLE_URL} ，"
            "或改用本地 provider。",
            kind=FATAL,
        )
    if _AUTH_RE.search(detail):
        return SynthesisError(
            "bl 登录态无效或已过期（401/403）；"
            "请运行 `bl auth login` 重新登录后重试，或改用本地 provider。",
            kind=FATAL,
        )
    return None


def _retry_after_from(detail: str) -> float | None:
    """从错误文本里解析 Retry-After 秒数；没有则 None。"""
    match = _RETRY_AFTER_RE.search(detail)
    return float(match.group(1)) if match else None


def _classify_transport_failure(detail: str) -> SynthesisError:
    """把 CLI 非零退出归类为可重试 / 状态不明（`_classify_failure` 之后）。

    timeout 一律按 `submission_unknown` 处理：CLI 只给退出码时无法确认
    服务端是否已受理，宁可让用户决定也不重复提交（可能重复计费）。
    """
    if _TIMEOUT_RE.search(detail):
        return SynthesisError(
            f"bl synthesize timed out; submission state unknown: {detail}",
            kind=SUBMISSION_UNKNOWN,
        )
    if _RATE_LIMIT_RE.search(detail) or _SERVER_ERROR_RE.search(detail):
        return SynthesisError(
            f"bl synthesize temporarily rejected: {detail}",
            kind=RETRYABLE,
            retry_after=_retry_after_from(detail),
        )
    return SynthesisError(f"bl synthesize failed: {detail}", kind=RETRYABLE)


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


def _read_wav(path: Path) -> tuple[np.ndarray, int]:
    """读取合成结果，返回 (单声道 float32 PCM, 实际采样率)。

    采样率以 WAV 元数据为准——服务端未来若返回其他采样率也能正确处理。
    """
    try:
        audio, sample_rate = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise SynthesisError(
            f"failed to read synthesized wav: {exc}", kind=RETRYABLE
        ) from exc
    if sample_rate <= 0:
        raise SynthesisError(
            f"synthesized wav reports invalid sample rate {sample_rate}",
            kind=RETRYABLE,
        )
    mono = audio.mean(axis=1) if audio.shape[1] > 1 else audio[:, 0]
    return np.ascontiguousarray(mono, dtype=np.float32), int(sample_rate)


class OnlineBailianProvider:
    """通过 `bl` CLI 调用百炼在线 TTS。"""

    def __init__(
        self,
        bl_bin: str = "bl",
        api_key: str | None = None,
        endpoint: str | None = None,
        poll_interval: float = 2.0,
        login_timeout: float = 300.0,
        force_http: bool = False,
        download_attempts: int = DOWNLOAD_ATTEMPTS,
    ) -> None:
        self.bl_bin = bl_bin
        self.api_key = api_key
        self.endpoint = endpoint
        self.poll_interval = poll_interval
        self.login_timeout = login_timeout
        self.force_http = force_http
        self.download_attempts = max(1, download_attempts)
        self._use_http = False
        self._last_request_id: str | None = None

    def is_authenticated(self) -> bool:
        """检查当前 `bl_bin` 的登录态。"""
        return is_authenticated(self.bl_bin)

    def prepare(self) -> None:
        """选择合成路径：优先 `bl` CLI，否则用 DashScope HTTP 兜底。"""
        if self.force_http:
            if not self.api_key:
                raise ProviderError(
                    "hot_fix requires the HTTP fallback: set DASHSCOPE_API_KEY",
                    kind=FATAL,
                )
            if not self.endpoint:
                raise ProviderError(
                    "hot_fix requires the HTTP fallback: provide --tts-endpoint",
                    kind=FATAL,
                )
            self._use_http = True
            return
        if shutil.which(self.bl_bin) is not None:
            self._use_http = False
            self.ensure_authenticated()
            return
        if self.api_key:
            if not self.endpoint:
                raise ProviderError(
                    "--tts-endpoint is required for HTTP fallback", kind=FATAL
                )
            self._use_http = True
            return
        raise ProviderError(
            f"bl not found: {self.bl_bin!r}. "
            "请安装百炼 bl CLI 并登录；或设置环境变量 DASHSCOPE_API_KEY "
            "并同时提供 --tts-endpoint 使用 HTTP 兜底。",
            kind=FATAL,
        )

    def describe(self) -> dict:
        """返回 provider 的自描述信息（engine 用它生成稳定的缓存 key）。"""
        return {
            "provider": "online",
            "model": FLAGSHIP_MODEL,
            "model_revision": None,
            "backend": "bailian",
            "backend_version": "",
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
                    f"bl 登录失败或超时；请重试。登录链接：{last_url}",
                    kind=FATAL,
                )
            raise ProviderError(
                "bl 登录失败或超时；未从输出中捕获到登录链接", kind=FATAL
            )
        finally:
            _stop_process(proc)

    def build_bl_command(
        self,
        text: str,
        voice: Voice,
        out_path: Path,
        instruct: str = "",
        lang: str = DEFAULT_LANG,
        rate: float | None = None,
        pitch: float | None = None,
        volume: int | None = None,
        seed: int | None = None,
        enable_ssml: bool = False,
    ) -> list[str]:
        """构造 `bl speech synthesize` 命令行。"""
        payload_text = _wrap_ssml(text) if enable_ssml else text
        cmd = [
            self.bl_bin,
            "speech",
            "synthesize",
            "--text",
            payload_text,
            "--model",
            voice.model,
            "--voice",
            voice.voice_id,
            "--format",
            "wav",
        ]
        # 粤语音色由 voice 本身决定语种；再传 --language zh 可能被误判为普通话。
        if voice.voice_id not in CANTONESE_VOICE_IDS:
            cmd.extend(["--language", _language_code(lang)])
        cmd.extend(["--sample-rate", str(SAMPLE_RATE), "--out", str(out_path)])
        if voice.model == FLAGSHIP_MODEL and instruct:
            cmd.extend(["--instruction", instruct])
        if rate is not None:
            cmd.extend(["--rate", str(rate)])
        if pitch is not None:
            cmd.extend(["--pitch", str(pitch)])
        if volume is not None:
            cmd.extend(["--volume", str(volume)])
        if seed is not None:
            cmd.extend(["--seed", str(seed)])
        if enable_ssml:
            cmd.append("--enable-ssml")
        return cmd

    def _synthesize_bl(
        self,
        text: str,
        voice: Voice,
        instruct: str,
        lang: str,
        out_path: Path,
        rate: float | None = None,
        pitch: float | None = None,
        volume: int | None = None,
        seed: int | None = None,
        enable_ssml: bool = False,
    ) -> Path:
        """用 `bl speech synthesize` 合成到 out_path（单次提交，不内部重试）。

        401/403 与额度问题立即给出可操作错误；429/5xx 归类为可重试交给
        统一调度层；timeout 归类为 `submission_unknown`（不自动重提）。
        """
        cmd = self.build_bl_command(
            text,
            voice,
            out_path,
            instruct,
            lang,
            rate=rate,
            pitch=pitch,
            volume=volume,
            seed=seed,
            enable_ssml=enable_ssml,
        )
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
            raise _classify_transport_failure(detail or str(exc)) from exc
        except OSError as exc:
            raise ProviderError(
                f"bl not found or not executable: {self.bl_bin!r}",
                kind=RETRYABLE,
            ) from exc

    def _download_audio(self, audio_url: str, out_path: Path) -> None:
        """下载已合成的音频；这是独立于合成提交的重试预算。

        下载失败不会重新提交合成（音频已经生成、可能已计费），只重试拉取。
        """
        import requests

        delays = DOWNLOAD_RETRY_DELAYS[: self.download_attempts - 1]
        for attempt in range(self.download_attempts):
            try:
                download = requests.get(audio_url, timeout=60)
                download.raise_for_status()
            except Exception as exc:
                if attempt < len(delays):
                    time.sleep(delays[attempt])
                    continue
                raise SynthesisError(
                    f"failed to download synthesized audio after "
                    f"{self.download_attempts} attempts: {exc}",
                    kind=RETRYABLE,
                    audio_url=audio_url,
                ) from exc
            out_path.write_bytes(download.content)
            return

    def _synthesize_http(
        self,
        text: str,
        voice: Voice,
        instruct: str,
        lang: str,
        out_path: Path,
        rate: float | None = None,
        pitch: float | None = None,
        volume: int | None = None,
        seed: int | None = None,
        enable_ssml: bool = False,
        hot_fix: dict | None = None,
    ) -> Path:
        """通过 DashScope HTTP API 合成并把音频下载到 out_path。

        单次提交；连接失败（未提交）→ retryable，提交后超时 →
        submission_unknown，429/5xx → retryable（带 Retry-After），
        401/403/4xx 参数错误 → fatal。下载失败走独立预算（见
        `_download_audio`）。3.1 Plus 使用 `language_hints` 数组；
        Qwen3-TTS 使用 `language_type`。粤语音色不发送语言字段。
        """
        if not self.endpoint:
            raise ProviderError(
                "--tts-endpoint is required for HTTP fallback", kind=FATAL
            )

        try:
            import requests
        except ImportError as exc:
            raise ProviderError(
                "requests is required for HTTP fallback: pip install requests",
                kind=FATAL,
            ) from exc

        payload = {
            "model": voice.model,
            "input": {
                "text": _wrap_ssml(text) if enable_ssml else text,
                "voice": voice.voice_id,
                "format": "wav",
                "sample_rate": SAMPLE_RATE,
            },
        }
        if voice.voice_id not in CANTONESE_VOICE_IDS:
            if voice.model == FLAGSHIP_MODEL:
                payload["input"]["language_hints"] = [_language_code(lang)]
            else:
                payload["input"]["language_type"] = _language_type(lang)
        if voice.model == FLAGSHIP_MODEL and instruct:
            payload["input"]["instruction"] = instruct
        if rate is not None:
            payload["input"]["rate"] = rate
        if pitch is not None:
            payload["input"]["pitch"] = pitch
        if volume is not None:
            payload["input"]["volume"] = volume
        if seed is not None:
            payload["input"]["seed"] = seed
        if enable_ssml:
            payload["input"]["enable_ssml"] = True
        if hot_fix is not None:
            payload["input"]["hot_fix"] = hot_fix

        headers = {"Authorization": f"Bearer {self.api_key}"}
        request_id: str | None = None
        try:
            response = requests.post(
                self.endpoint, json=payload, headers=headers, timeout=60
            )
        except requests.Timeout as exc:
            raise SynthesisError(
                "DashScope HTTP TTS request timed out; submission state "
                "unknown — refusing to auto-resubmit",
                kind=SUBMISSION_UNKNOWN,
            ) from exc
        except requests.ConnectionError as exc:
            raise SynthesisError(
                f"DashScope HTTP TTS connection failed before submit: {exc}",
                kind=RETRYABLE,
            ) from exc
        except Exception as exc:
            raise ProviderError(
                f"DashScope HTTP TTS request failed: {exc}", kind=RETRYABLE
            ) from exc

        try:
            response.raise_for_status()
            body = response.json()
            audio_url = body["output"]["audio"]["url"]
            request_id = body.get("request_id")
        except requests.Timeout as exc:
            raise SynthesisError(
                "DashScope response read timed out; submission state "
                "unknown — refusing to auto-resubmit",
                kind=SUBMISSION_UNKNOWN,
            ) from exc
        except Exception as exc:
            detail = f"{getattr(response, 'status_code', '')} {exc}"
            classified = _classify_failure(str(detail))
            if classified is not None:
                raise classified from exc
            status = getattr(response, "status_code", None)
            if status is not None and 500 <= status < 600:
                retry_after = None
                raw = response.headers.get("Retry-After") if hasattr(
                    response, "headers"
                ) else None
                if raw is not None:
                    try:
                        retry_after = float(raw)
                    except ValueError:
                        retry_after = None
                raise SynthesisError(
                    f"DashScope server error {status}: {exc}",
                    kind=RETRYABLE,
                    retry_after=retry_after,
                    request_id=str(request_id) if request_id else None,
                ) from exc
            raise ProviderError(
                f"DashScope HTTP TTS request failed: {detail}", kind=FATAL
            ) from exc

        self._download_audio(audio_url, out_path)
        self._last_request_id = request_id  # 诊断用；报告不携带敏感信息。
        return out_path

    def synthesize(
        self,
        text: str,
        voice: Voice,
        instruct: str = "",
        lang: str = "chinese",
        **style,
    ) -> SynthesisResult:
        """合成一段文本，返回带真实采样率的 `SynthesisResult`。

        可选 style：rate / pitch / volume / seed / enable_ssml / hot_fix。
        """
        rate = style.get("rate")
        pitch = style.get("pitch")
        volume = style.get("volume")
        seed = style.get("seed")
        enable_ssml = bool(style.get("enable_ssml", False))
        hot_fix = style.get("hot_fix")
        if hot_fix is not None and (not self.api_key or not self.endpoint):
            raise ProviderError(
                "hot_fix requires the HTTP fallback: set DASHSCOPE_API_KEY "
                "and provide --tts-endpoint",
                kind=FATAL,
            )
        with tempfile.TemporaryDirectory(prefix="video-tts-online-") as tmp:
            out_path = Path(tmp) / "segment.wav"
            if self._use_http or hot_fix is not None:
                self._synthesize_http(
                    text,
                    voice,
                    instruct,
                    lang,
                    out_path,
                    rate=rate,
                    pitch=pitch,
                    volume=volume,
                    seed=seed,
                    enable_ssml=enable_ssml,
                    hot_fix=hot_fix,
                )
            else:
                self._synthesize_bl(
                    text,
                    voice,
                    instruct,
                    lang,
                    out_path,
                    rate=rate,
                    pitch=pitch,
                    volume=volume,
                    seed=seed,
                    enable_ssml=enable_ssml,
                )
            pcm, sample_rate = _read_wav(out_path)
        return SynthesisResult(
            audio=pcm,
            sample_rate=sample_rate,
            channels=1,
            provider="online",
            model_id=voice.model,
            model_revision=None,
            request_id=getattr(self, "_last_request_id", None),
        )
