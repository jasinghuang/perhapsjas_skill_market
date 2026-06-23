"""DashScope voice-enrollment RESTful 客户端。"""
from __future__ import annotations
import base64
import json
import time
from dataclasses import dataclass
from pathlib import Path
import requests

_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"


class PollTimeoutError(RuntimeError):
    pass


class ApiError(RuntimeError):
    pass


@dataclass
class DesignResult:
    voice_id: str
    preview_path: Path


class VoiceEnrollmentClient:
    def __init__(self, api_key: str, cache_dir: Path | str = Path.cwd()):
        self.api_key = api_key
        self.cache_dir = Path(cache_dir)

    def _post(self, action: str, **input_fields) -> dict:
        payload = {"model": "voice-enrollment", "input": {"action": action, **input_fields}}
        resp = requests.post(
            _ENDPOINT,
            headers={"Authorization": f"Bearer {self.api_key}",
                     "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=60,
        )
        if resp.status_code >= 400:
            raise ApiError(f"HTTP {resp.status_code}: {resp.text}")
        return resp.json()

    # —— 创建(复刻 / 设计)——
    def create_clone(self, *, url: str, prefix: str, target_model: str,
                     language: str = "zh", preprocess: bool = False,
                     max_length: float = 20.0) -> str:
        input_fields = {
            "target_model": target_model, "prefix": prefix, "url": url,
            "language_hints": [language],
        }
        if preprocess:
            input_fields["enable_preprocess"] = True
            input_fields["max_prompt_audio_length"] = max_length
        data = self._post("create_voice", **input_fields)
        return data["output"]["voice_id"]

    def create_design(self, *, prompt: str, preview_text: str, prefix: str,
                      target_model: str, language: str = "zh") -> DesignResult:
        data = self._post("create_voice",
                          target_model=target_model, prefix=prefix,
                          voice_prompt=prompt, preview_text=preview_text,
                          language_hints=[language])
        out = data["output"]
        voice_id = out["voice_id"]
        b64 = out["preview_audio"]["data"]
        preview_path = self.cache_dir / f"{voice_id}_preview.wav"
        preview_path.write_bytes(base64.b64decode(b64))
        return DesignResult(voice_id=voice_id, preview_path=preview_path)

    # —— 查询 / 轮询 ——
    def query(self, voice_id: str) -> dict:
        return self._post("query_voice", voice_id=voice_id)["output"]

    def poll_until_ready(self, voice_id: str, timeout: float = 300,
                         interval: float = 10) -> str:
        """轮询直到 status 为 OK 或 UNDEPLOYED,或超时。返回最终 status。"""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            out = self.query(voice_id)
            status = out.get("status", "DEPLOYING")
            if status in ("OK", "UNDEPLOYED"):
                return status
            time.sleep(interval)
        raise PollTimeoutError(f"轮询超时(>{timeout}s),voice_id={voice_id}")

    def list_voices(self, prefix: str | None = None,
                    page_size: int = 50) -> list[dict]:
        input_fields = {"page_size": page_size, "page_index": 0}
        if prefix:
            input_fields["prefix"] = prefix
        data = self._post("list_voice", **input_fields)
        return data["output"].get("voice_list", [])

    def update(self, voice_id: str, url: str) -> None:
        self._post("update_voice", voice_id=voice_id, url=url)

    def delete(self, voice_id: str) -> None:
        self._post("delete_voice", voice_id=voice_id)
