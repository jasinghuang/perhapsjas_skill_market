"""Audio transcription backends — auto-select based on platform."""

from abc import ABC, abstractmethod
from typing import Dict, Optional


class TranscriptionBackend(ABC):
    """Common interface for transcription backends."""

    @abstractmethod
    def load_model(self, model_name: str) -> None:
        """Load the transcription model. Must be called before transcribe()."""

    @abstractmethod
    def transcribe(self, audio_path: str, language: Optional[str] = None) -> Dict:
        """Transcribe audio and return unified result.

        Returns:
            {"segments": [{"start": float, "end": float, "text": str}],
             "language": str}
        """

    def check_dependencies(self) -> bool:
        """Verify runtime dependencies. Return True if OK, print error if not."""
        return True


def get_backend() -> TranscriptionBackend:
    """Return the appropriate backend for the current platform."""
    import platform
    system = platform.system()
    if system == "Darwin":
        from .mlx_backend import MLXBackend
        return MLXBackend()
    else:
        from .faster_whisper_backend import FasterWhisperBackend
        return FasterWhisperBackend()
