"""Provider registry — qwen (local) or scribe (online)."""

import platform
from abc import ABC, abstractmethod
from typing import Callable, Dict, Optional

PROVIDER_ALIASES = {
    "qwen": "qwen",
    "qwen-local": "qwen",
    "qwen_local": "qwen",
    "local": "qwen",
    "qwen3": "qwen",
    "scribe": "scribe",
    "scribe-v2": "scribe",
    "scribe_v2": "scribe",
    "elevenlabs": "scribe",
    "online": "scribe",
}

# The Qwen stack uses full language names ("Chinese"); Scribe wants ISO codes.
QWEN_LANGUAGE_NAMES = {
    "zh": "Chinese", "en": "English", "ja": "Japanese", "ko": "Korean",
    "de": "German", "fr": "French", "es": "Spanish", "ru": "Russian",
    "it": "Italian", "pt": "Portuguese", "vi": "Vietnamese",
}
QWEN_NAME_TO_CODE = {name.lower(): code for code, name in QWEN_LANGUAGE_NAMES.items()}


def normalize_provider(name: str) -> str:
    key = str(name).strip().lower()
    if key not in PROVIDER_ALIASES:
        raise ValueError(
            f"Unknown provider '{name}'. Choose one of: qwen (local Qwen3-ASR-1.7B) / scribe (ElevenLabs Scribe V2 online)"
        )
    return PROVIDER_ALIASES[key]


class ProviderBackend(ABC):
    """Common interface for transcription providers."""

    provider: str = ""
    backend: str = ""
    model_id: str = ""

    @abstractmethod
    def probe(self) -> dict:
        """Report this route's readiness without side effects."""

    @abstractmethod
    def transcribe(
        self,
        media_path: str,
        language: Optional[str] = None,
        options: Optional[dict] = None,
        on_stage: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> dict:
        """Transcribe one file into the unified result schema (results.build_result).

        on_stage(name) marks processing phases (环境检查/转写/对齐/导出…);
        on_progress(fraction, elapsed_seconds, total_seconds) is optional —
        backends without reliable progress only report stages (doc §12).
        """


def get_provider_backend(provider: str, options: Optional[dict] = None) -> ProviderBackend:
    provider = normalize_provider(provider)
    options = options or {}
    if provider == "qwen":
        if platform.system() == "Darwin" and platform.machine() != "arm64":
            raise RuntimeError("本地 MLX 需要 Apple Silicon 和原生 ARM64 Python；Intel / Rosetta 不自动改走其他后端")
        if platform.system() == "Darwin" and platform.machine() == "arm64":
            from .qwen_mlx_backend import QwenMLXBackend
            return QwenMLXBackend(precision=options.get("precision", "8bit"))
        from .qwen_torch_backend import QwenTorchBackend
        return QwenTorchBackend(device=options.get("device", "auto"))
    from .scribe_backend import ScribeBackend
    return ScribeBackend()
