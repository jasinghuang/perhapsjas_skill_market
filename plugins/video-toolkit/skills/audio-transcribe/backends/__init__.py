"""Audio transcription backends — auto-select based on platform."""

from abc import ABC, abstractmethod
from typing import Callable, Dict, Optional


class TranscriptionBackend(ABC):
    """Common interface for transcription backends."""

    @abstractmethod
    def load_model(self, model_name: str) -> None:
        """Load the transcription model. Must be called before transcribe()."""

    @abstractmethod
    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
        condition_on_previous_text: bool = False,
    ) -> Dict:
        """Transcribe audio and return unified result.

        Args:
            audio_path: Input audio/video path.
            language: Language code, or None/"auto" to auto-detect.
            on_progress: Optional callback invoked as
                ``(fraction, elapsed_seconds, total_seconds)`` with
                ``fraction`` in [0, 1]. Implementations must swallow
                callback errors so progress can never abort transcription.
            condition_on_previous_text: Whether each 30s window conditions on
                the previous window's text. Defaults to False — context from a
                hallucination over music/silence otherwise cascades into later
                windows (repetition loops, degrading quality).

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
