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
        self._session = None
        self._aligner = None
        self._model_revision = None

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

        def _progress(event):
            if on_progress and isinstance(event, dict) and "progress" in event:
                on_progress(float(event["progress"]), float(event.get("processed_audio_sec", 0)), duration)
            if event.get("event") == "chunk_completed":
                on_stage(f"MLX 转写+对齐 {event.get('chunk_index')}/{event.get('total_chunks')}")

        # Pinned 0.4.4 contract: segments are ForcedAligner word units;
        # chunks are ASR windows and must NEVER be treated as word timestamps.
        from job_cache import job_directory
        work_dir = Path(options["work_dir"]) if options.get("work_dir") else job_directory(media_path, self, language, options) / "work"
        work_dir.mkdir(parents=True, exist_ok=True)
        audio = media_mod.to_wav16k_mono(media_path, work_dir / "selected16k.wav",
                                        stream_index=options.get("audio_track"))
        if self._session is None:
            self._session = mlx_qwen.Session(model=self.model_id)
            resolved = getattr(getattr(self._session, "model", None), "_resolved_model_path", None)
            self._model_revision = Path(resolved).name if resolved and Path(resolved).parent.name == "snapshots" else None
            from mlx_qwen3_asr.forced_aligner import ForcedAligner
            self._aligner = ForcedAligner()
        result = self._session.transcribe(
            audio=str(audio),
            language=qwen_language,
            return_timestamps=True,
            return_chunks=True,
            forced_aligner=self._aligner,
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
        warnings = []
        status = "complete"
        if self._field(result, "truncated", default=False):
            status = "partial"
            warnings.append("recognition hit token limit; complete subtitles unavailable")
        if text and not words:
            status = "partial"
            warnings.append("alignment produced no time units; text kept, SRT unavailable")
        if not text:
            warnings.append("no_speech: no transcribable speech detected")

        return build_result(
            provider=self.provider,
            backend=self.backend,
            model_id=self.model_id,
            model_revision=self._model_revision or self._cached_revision(self.model_id),
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
        for name in ("segments",):
            units = self._field(result, name)
            if isinstance(units, list):
                flat = []
                for seg in units:
                    inner = self._field(seg, "words", default=seg)
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
        from .qwen_torch_backend import cached_revision
        return cached_revision(model_id)
