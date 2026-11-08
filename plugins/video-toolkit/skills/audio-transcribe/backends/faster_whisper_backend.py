"""Windows backend — Faster-Whisper with CUDA auto-detection and CPU fallback."""

from typing import Callable, Dict, Optional

from . import TranscriptionBackend

SUPPORTED_MODELS = ["small", "medium", "large-v3"]


def _nvidia_smi_gpu_name() -> str:
    """GPU name via nvidia-smi, or "" if unavailable (no driver / not on PATH)."""
    import subprocess

    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return ""
    if result.returncode != 0:
        return ""
    lines = result.stdout.strip().splitlines()
    return lines[0].strip() if lines else ""


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

    @staticmethod
    def _cuda_status():
        """Ask ctranslate2 directly whether a usable CUDA device exists.

        Returns (available, reason). get_cuda_device_count() returns 0 both when
        CTranslate2 was built without CUDA and when no device/driver is visible,
        so the reason string keeps those apart for troubleshooting.
        """
        try:
            import ctranslate2
        except Exception as exc:
            return False, f"ctranslate2 import failed: {exc}"
        try:
            count = ctranslate2.get_cuda_device_count()
        except Exception as exc:
            return False, f"get_cuda_device_count() failed: {exc}"
        if count <= 0:
            return False, "no CUDA device visible (no NVIDIA GPU, driver missing, or CPU-only ctranslate2 build)"
        try:
            name = ctranslate2.get_device_property(0).get("name", "CUDA GPU")
        except Exception:
            # ctranslate2 4.7.x has no get_device_property; nvidia-smi ships
            # with every NVIDIA driver, so use it for the display name.
            name = _nvidia_smi_gpu_name() or "CUDA GPU"
        return True, f"found {count} CUDA device(s), primary: {name}"

    def load_model(self, model_name: str) -> None:
        from faster_whisper import WhisperModel

        print(f"Loading Faster-Whisper model ({model_name})...")

        has_cuda, cuda_reason = self._cuda_status()
        if has_cuda:
            try:
                self._model = WhisperModel(model_name, device="cuda", compute_type="float16")
                print(f"  Using CUDA GPU acceleration (float16) — {cuda_reason}")
                return
            except Exception as exc:
                # Typical causes on Windows: missing cuDNN DLLs or a GPU below
                # CTranslate2's minimum compute capability. Show the real error
                # so the user can fix the driver side instead of wondering.
                print(f"  CUDA device present but load failed: {exc}")
                print("  (common fix: install/update NVIDIA driver and cuDNN, e.g. pip install nvidia-cudnn-cu12)")
        else:
            print(f"  CUDA unavailable: {cuda_reason}")

        self._model = WhisperModel(model_name, device="cpu", compute_type="int8")
        print("  Using CPU with int8 quantization")

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
            word_timestamps=True,
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

        # Same rationale as the MLX backend: word-level boundaries keep the first
        # segment of a window that opens on music/silence from starting early.
        segments = []
        for seg in raw_segments:
            text = seg.text.strip()
            if not text:
                continue
            words = getattr(seg, "words", None) or []
            if words:
                start, end = words[0].start, words[-1].end
            else:
                start, end = seg.start, seg.end
            segments.append({"start": start, "end": end, "text": text})

        return {"segments": segments, "language": detected_lang}
