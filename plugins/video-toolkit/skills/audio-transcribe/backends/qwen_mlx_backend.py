"""Apple Silicon local backend — mlx-qwen3-asr (moona3k).

The library handles long-audio chunking (30 s at low-energy points) and word
timestamps through its native MLX forced aligner, so global time offsets need
no post-processing here — that fact is recorded in the result warnings-free,
per doc §8 ("the adapter must state whether the backend already chunks").

Recognition stays at the 1.7B family; the package default is 0.6B, so the
model id is ALWAYS passed explicitly. Default weight is the 8bit repo;
bf16/6bit exist only as advanced `--precision` choices (doc §5).
"""

from pathlib import Path
from typing import Callable, Optional

from results import build_result, make_word

MLX_MODELS = {
    "8bit": "mlx-community/Qwen3-ASR-1.7B-8bit",
    "bf16": "mlx-community/Qwen3-ASR-1.7B-bf16",
    "6bit": "mlx-community/Qwen3-ASR-1.7B-6bit",
}
DEFAULT_PRECISION = "8bit"

# moona3k's loader converts float params to FP16 on load, regardless of the
# weight repo's bf16 name — compute dtype is recorded separately (doc §5).
COMPUTE_DTYPE = "float16"


class MLXBackendError(Exception):
    pass


class QwenMLXBackend:
    provider = "qwen"
    backend = "mlx"

    def __init__(self, precision: str = DEFAULT_PRECISION):
        if precision not in MLX_MODELS:
            raise MLXBackendError(
                f"Unknown precision '{precision}'. Available: {', '.join(MLX_MODELS)}"
            )
        self.precision = precision
        self.model_id = MLX_MODELS[precision]

    def probe(self) -> dict:
        import platform
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            return {
                "provider": "qwen", "route": "mlx", "status": "unsupported",
                "checks": ["MLX requires an Apple Silicon Mac with a native ARM64 Python"],
            }
        try:
            import mlx_qwen3_asr  # noqa: F401
        except Exception as exc:
            return {
                "provider": "qwen", "route": "mlx", "status": "needs_setup",
                "checks": [f"import mlx_qwen3_asr failed: {exc}"],
            }
        return {"provider": "qwen", "route": "mlx", "status": "ready",
                "model": self.model_id, "checks": [f"mlx_qwen3_asr ready, model {self.model_id}"]}

    def transcribe(
        self,
        media_path: str,
        language: Optional[str] = None,
        options: Optional[dict] = None,
        on_stage: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> dict:
        import media as media_mod

        on_stage = on_stage or (lambda stage: None)
        options = options or {}
        import mlx_qwen3_asr as mlx_qwen

        info = options.get("media_info") or media_mod.probe_media(media_path)
        duration = info["duration"]

        qwen_language = None
        if language and language not in ("auto", None):
            from . import QWEN_LANGUAGE_NAMES
            qwen_language = QWEN_LANGUAGE_NAMES.get(language.lower(), language.capitalize())

        on_stage(f"本地转写（MLX，{self.model_id}）")
        t0 = __import__("time").monotonic()

        def _progress(*args):
            if on_progress and len(args) >= 3:
                try:
                    on_progress(args[0], args[1], args[2])
                except Exception:
                    pass

        result = mlx_qwen.transcribe(
            audio=str(media_path),
            model=self.model_id,          # never rely on the 0.6B default
            language=qwen_language,
            return_timestamps=True,
            return_chunks=True,
            on_progress=_progress,
            verbose=False,
        )

        text = str(self._field(result, "text", default="") or "").strip()
        raw_lang = self._field(result, "language")
        language_code = self._lang_code(raw_lang)

        words = []
        for unit in self._word_units(result):
            unit_text = str(self._field(unit, "text", "word", default="") or "").strip()
            start = self._field(unit, "start", "start_time")
            end = self._field(unit, "end", "end_time")
            if unit_text and isinstance(start, (int, float)) and isinstance(end, (int, float)) and end >= start:
                words.append(make_word(start, end, unit_text))
        if words and text:
            from subtitles import attach_punctuation
            attached = attach_punctuation(words, text)
            if attached:
                words = attached

        warnings = []
        status = "complete"
        if text and not words:
            status = "partial"
            warnings.append("alignment produced no time units; text kept, SRT unavailable")
        if not text:
            warnings.append("no_speech: no transcribable speech detected")

        return build_result(
            provider=self.provider,
            backend=self.backend,
            model_id=self.model_id,
            model_revision=self._cached_revision(self.model_id),
            weight_precision=self.precision,
            compute_dtype=COMPUTE_DTYPE,
            language=language_code,
            duration=duration,
            text=text,
            words=words,
            status=status,
            warnings=warnings,
        )

    # --- helpers -------------------------------------------------------------

    @staticmethod
    def _field(obj, *names, default=None):
        for name in names:
            if isinstance(obj, dict):
                if name in obj:
                    return obj[name]
            else:
                value = getattr(obj, name, None)
                if value is not None:
                    return value
        return default

    def _word_units(self, result) -> list:
        """The TranscriptionResult exposes word-level units under one of a few
        names across versions; chunks/segments hold them after grouping."""
        for name in ("words", "timestamps", "word_timestamps"):
            units = self._field(result, name)
            if isinstance(units, list) and units:
                return units
        for name in ("segments", "chunks"):
            units = self._field(result, name)
            if isinstance(units, list):
                flat = []
                for seg in units:
                    inner = self._field(seg, "words", "tokens", default=seg)
                    if isinstance(inner, list):
                        flat.extend(inner)
                    else:
                        flat.append(seg)
                if flat:
                    return flat
        return []

    @staticmethod
    def _lang_code(raw) -> Optional[str]:
        from . import QWEN_NAME_TO_CODE
        if not raw or not isinstance(raw, str):
            return None
        if raw.lower() in QWEN_NAME_TO_CODE:
            return QWEN_NAME_TO_CODE[raw.lower()]
        return raw.lower()[:2]

    @staticmethod
    def _cached_revision(model_id: str) -> Optional[str]:
        repo_dir = Path.home() / ".cache" / "huggingface" / "hub" / f"models--{model_id.replace('/', '--')}"
        snapshots = repo_dir / "snapshots"
        if not snapshots.is_dir():
            return None
        entries = [p for p in snapshots.iterdir() if p.is_dir()]
        return entries[0].name if entries else None
