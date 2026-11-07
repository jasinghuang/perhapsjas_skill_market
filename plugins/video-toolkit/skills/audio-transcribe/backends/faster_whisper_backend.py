"""Windows backend — Faster-Whisper with CUDA auto-detection and CPU fallback."""

from typing import Callable, Dict, Optional

from . import TranscriptionBackend

SUPPORTED_MODELS = ["small", "medium", "large-v3"]


class FasterWhisperBackend(TranscriptionBackend):
    def __init__(self):
        self._model = None

    def check_dependencies(self) -> bool:
        try:
            from faster_whisper import WhisperModel  # noqa: F401
            return True
        except ImportError:
            print("faster-whisper not installed. Install: pip install faster-whisper zhconv")
            return False

    def load_model(self, model_name: str) -> None:
        from faster_whisper import WhisperModel

        print(f"Loading Faster-Whisper model ({model_name})...")

        # Try CUDA first, fall back to CPU
        try:
            self._model = WhisperModel(model_name, device="cuda", compute_type="float16")
            print("  Using CUDA GPU acceleration")
        except Exception:
            print("  CUDA not available, using CPU with int8 quantization")
            self._model = WhisperModel(model_name, device="cpu", compute_type="int8")

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> Dict:
        whisper_language = None if language in ("auto", None) else language

        segments_gen, info = self._model.transcribe(
            str(audio_path),
            language=whisper_language,
            beam_size=5,
        )

        duration = getattr(info, "duration", None)

        # Generator must be consumed — transcription runs here
        raw_segments = []
        for seg in segments_gen:
            raw_segments.append(seg)
            if on_progress and duration:
                try:
                    on_progress(min(seg.end / duration, 1.0), seg.end, duration)
                except Exception:
                    pass

        detected_lang = info.language

        segments = []
        for seg in raw_segments:
            text = seg.text.strip()
            if text:
                segments.append({"start": seg.start, "end": seg.end, "text": text})

        return {"segments": segments, "language": detected_lang}
