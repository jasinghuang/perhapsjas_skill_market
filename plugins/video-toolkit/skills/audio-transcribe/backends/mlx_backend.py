"""Mac backend — MLX-Whisper (Apple Silicon native acceleration)."""

import subprocess
from pathlib import Path
from typing import Callable, Dict, Optional

from . import TranscriptionBackend

MODEL_REPOS = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


class _SilentTqdm:
    """No-op tqdm replacement used when progress output is disabled."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def update(self, n=1):
        return None

    def __getattr__(self, name):
        def _noop(*args, **kwargs):
            return None

        return _noop


class _ProgressTqdm:
    """Minimal tqdm replacement that reports decode progress in seconds."""

    def __init__(self, total, callback):
        self.total = total or 0
        self.n = 0
        self._callback = callback
        self._total_seconds = self.total / 100.0 if self.total else 0.0
        if self._total_seconds:
            self._emit(0.0, 0.0)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __getattr__(self, name):
        def _noop(*args, **kwargs):
            return None

        return _noop

    def update(self, n=1):
        self.n += n
        if not self._total_seconds:
            return
        fraction = min(self.n / self.total, 1.0)
        elapsed = min(self.n / 100.0, self._total_seconds)
        self._emit(fraction, elapsed)

    def _emit(self, fraction, elapsed):
        if self._callback is None:
            return
        try:
            self._callback(fraction, elapsed, self._total_seconds)
        except Exception:
            pass


def _install_progress_hook(callback):
    import tqdm as tqdm_module

    original = tqdm_module.tqdm

    def factory(*args, **kwargs):
        if callback is None:
            return _SilentTqdm()

        total = kwargs.get("total")
        if total is None and args and isinstance(args[0], (int, float)):
            total = args[0]
        if not isinstance(total, (int, float)) or total <= 0:
            return original(*args, **kwargs)
        try:
            return _ProgressTqdm(total, callback)
        except Exception:
            return original(*args, **kwargs)

    tqdm_module.tqdm = factory
    return original


def _restore_progress_hook(original):
    import tqdm as tqdm_module

    tqdm_module.tqdm = original


class MLXBackend(TranscriptionBackend):
    def __init__(self):
        self._repo = None

    def check_dependencies(self) -> bool:
        ok = True
        try:
            import mlx_whisper  # noqa: F401
        except ImportError:
            print(
                "mlx-whisper not installed in this interpreter.\n"
                "Run the skill through run.py — it finds an interpreter that has mlx-whisper "
                "(or installs it once). Manual install: "
                "python3 -m pip install --break-system-packages mlx-whisper zhconv"
            )
            ok = False
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            print("ffmpeg not installed. Install: brew install ffmpeg")
            ok = False
        return ok

    def load_model(self, model_name: str) -> None:
        if model_name not in MODEL_REPOS:
            raise ValueError(
                f"Unknown MLX model '{model_name}'. Available: {', '.join(MODEL_REPOS)}"
            )
        self._repo = MODEL_REPOS[model_name]
        print(f"Loading MLX-Whisper model ({model_name})...")
        print(f"  Repo: {self._repo}")

        hub = Path.home() / ".cache" / "huggingface" / "hub"
        cached = hub / f"models--{self._repo.replace('/', '--')}"
        print(f"  Cached: {'yes' if cached.exists() else 'no (first run will download)'}")

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> Dict:
        import mlx_whisper

        whisper_language = None if language in ("auto", None) else language

        original_tqdm = None
        try:
            original_tqdm = _install_progress_hook(on_progress)
        except Exception:
            original_tqdm = None

        try:
            result = mlx_whisper.transcribe(
                str(audio_path),
                path_or_hf_repo=self._repo,
                language=whisper_language,
                verbose=False,
            )
        finally:
            if original_tqdm is not None:
                try:
                    _restore_progress_hook(original_tqdm)
                except Exception:
                    pass

        detected_lang = result.get("language", "unknown")
        print(f"  Detected language: {detected_lang}")

        segments = []
        for seg in result["segments"]:
            text = seg["text"].strip()
            if text:
                segments.append({"start": seg["start"], "end": seg["end"], "text": text})

        return {"segments": segments, "language": detected_lang}
