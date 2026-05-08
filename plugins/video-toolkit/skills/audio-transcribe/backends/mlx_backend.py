"""Mac backend — MLX-Whisper (Apple Silicon native acceleration)."""

import subprocess
from typing import Dict, Optional

from . import TranscriptionBackend

MODEL_REPOS = {
    "small": "mlx-community/whisper-small-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
}


class MLXBackend(TranscriptionBackend):
    def __init__(self):
        self._repo = None

    def check_dependencies(self) -> bool:
        ok = True
        try:
            import mlx_whisper  # noqa: F401
        except ImportError:
            print("mlx-whisper not installed. Install: pip3 install --break-system-packages mlx-whisper")
            ok = False
        try:
            subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError):
            print("ffmpeg not installed. Install: brew install ffmpeg")
            ok = False
        return ok

    def load_model(self, model_name: str) -> None:
        self._repo = MODEL_REPOS.get(model_name, MODEL_REPOS["large-v3-turbo"])
        print(f"Loading MLX-Whisper model ({model_name})...")
        print(f"  Repo: {self._repo}")

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
