"""voices.json 读写 + target_model 自动配对。"""
from __future__ import annotations
import json
import re
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "voices.json"
_SYSTEM_MODEL = "cosyvoice-v3-flash"

_PREFIX_RE = re.compile(r"^[a-z0-9]{1,10}$")


def validate_prefix(prefix: str) -> str:
    """校验 prefix:仅数字+小写字母,<10 字符。不合法 raise ValueError。"""
    if not _PREFIX_RE.match(prefix):
        raise ValueError(
            f"prefix 必须仅含数字和小写字母且不超过 10 字符,收到: {prefix!r}"
        )
    return prefix


class VoicesDB:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else DEFAULT_PATH
        self.data = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            self.data = {
                "version": 1,
                "system_voices": {_SYSTEM_MODEL: []},
                "custom_voices": [],
                "defaults": {
                    "system_voice": "longxiaochun_v3",
                    "target_model_for_custom": "cosyvoice-v3.5-plus",
                },
            }
            self._save()
            return self.data
        with self.path.open(encoding="utf-8") as f:
            return json.load(f)

    def _save(self) -> None:
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # —— 自定义音色 CRUD ——
    def add_custom(self, entry: dict) -> None:
        # 去重:同 voice_id 覆盖
        self.data["custom_voices"] = [
            v for v in self.data["custom_voices"] if v["voice_id"] != entry["voice_id"]
        ]
        self.data["custom_voices"].append(entry)
        self._save()

    def remove_custom(self, voice_id: str) -> None:
        self.data["custom_voices"] = [
            v for v in self.data["custom_voices"] if v["voice_id"] != voice_id
        ]
        self._save()

    def set_system_voices(self, model: str, voices: list[dict]) -> None:
        self.data["system_voices"][model] = voices
        self._save()

    # —— target_model 配对(核心)——
    def target_model_for(self, voice_id: str) -> str | None:
        """命中自定义音色 → 其 target_model;命中系统音色 → cosyvoice-v3-flash;未知 → None。"""
        for v in self.data["custom_voices"]:
            if v["voice_id"] == voice_id:
                return v["target_model"]
        for model, voices in self.data["system_voices"].items():
            if any(v["id"] == voice_id for v in voices):
                return model
        # 系统音色库里没缓存也按命名约定认为是系统音色(bl 能合成即合法)
        return None
