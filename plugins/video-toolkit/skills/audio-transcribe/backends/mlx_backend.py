"""Mac backend — MLX-Whisper (Apple Silicon native acceleration)."""

import subprocess
from pathlib import Path
from typing import Dict, Optional

from . import TranscriptionBackend

MODEL_REPOS = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


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

    def transcribe(self, audio_path: str, language: Optional[str] = None) -> Dict:
        import mlx_whisper

        whisper_language = None if language in ("auto", None) else language
        result = mlx_whisper.transcribe(
            str(audio_path),
            path_or_hf_repo=self._repo,
            language=whisper_language,
            verbose=False,
        )

        detected_lang = result.get("language", "unknown")
        print(f"  Detected language: {detected_lang}")

        segments = []
        for seg in result["segments"]:
            text = seg["text"].strip()
            if text:
                segments.append({"start": seg["start"], "end": seg["end"], "text": text})

        return {"segments": segments, "language": detected_lang}
