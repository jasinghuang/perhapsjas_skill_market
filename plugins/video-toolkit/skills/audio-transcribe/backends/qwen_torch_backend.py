"""Windows/Linux local backend — official qwen-asr (PyTorch Transformers route).

Recognition model is fixed at Qwen/Qwen3-ASR-1.7B; alignment uses
Qwen/Qwen3-ForcedAligner-0.6B (word-level times, <= ~5 min per call — hence
silence-snapped chunking below that limit). CUDA -> BF16 (compute capability
>= 8) or FP16; CPU -> FP32 slow mode. No vLLM / FlashAttention / torch.compile
in the first version (doc §6).
"""

import hashlib
import json
import time
from pathlib import Path
from typing import Callable, List, Optional

from results import build_result, make_word
from subtitles import attach_punctuation, join_word_texts

ASR_MODEL_ID = "Qwen/Qwen3-ASR-1.7B"
ALIGNER_MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B"

# ForcedAligner accepts ~5 minutes per call (doc §8); stay safely under it.
CHUNK_TARGET = 240.0
CHUNK_HARD_CAP = 290.0
MAX_NEW_TOKENS = 2048


class BackendError(Exception):
    """Route cannot run (deps/CUDA/memory) with a user-actionable message."""


def _field(obj, *names, default=None):
    """Read the first present attribute/key — tolerant to API shape drift."""
    for name in names:
        if isinstance(obj, dict):
            if name in obj:
                return obj[name]
        else:
            value = getattr(obj, name, None)
            if value is not None:
                return value
    return default


def cached_revision(model_id: str) -> Optional[str]:
    """Resolve the model revision from the local HF cache (no network)."""
    repo_dir = Path.home() / ".cache" / "huggingface" / "hub" / f"models--{model_id.replace('/', '--')}"
    snapshots = repo_dir / "snapshots"
    if not snapshots.is_dir():
        return None
    entries = [p for p in snapshots.iterdir() if p.is_dir()]
    return entries[0].name if entries else None


class QwenTorchBackend:
    provider = "qwen"
    backend = "torch"

    def __init__(self, device: str = "auto", chunk_target: float = CHUNK_TARGET):
        self._requested_device = device
        self._chunk_target = min(chunk_target, CHUNK_HARD_CAP)
        self._asr = None
        self._device = None
        self._dtype_name = None

    # --- probing (doc §6 steps 1–5) ----------------------------------------

    def probe(self) -> dict:
        checks = []
        try:
            import torch  # step 1: importable at the locked version
        except Exception as exc:
            return {"provider": "qwen", "route": "torch", "status": "needs_setup",
                    "checks": [f"import torch failed: {exc}"]}
        checks.append(f"torch {torch.__version__} importable")

        try:
            import qwen_asr  # noqa: F401
            checks.append("qwen_asr importable")
        except Exception as exc:
            return {"provider": "qwen", "route": "torch", "status": "needs_setup",
                    "checks": checks + [f"import qwen_asr failed: {exc}"]}

        cuda_build = bool(getattr(torch.version, "cuda", None))  # step 2
        available = False
        if cuda_build:
            available = torch.cuda.is_available()  # step 3
        checks.append(
            f"PyTorch CUDA build: {'yes (' + torch.version.cuda + ')' if cuda_build else 'no (CPU build)'}"
        )

        if cuda_build and available:
            props = torch.cuda.get_device_properties(0)  # step 4
            vram_gb = props.total_memory / 1024 ** 3
            checks.append(
                f"GPU: {props.name}, compute capability {props.major}.{props.minor}, "
                f"VRAM {vram_gb:.1f} GB"
            )
            try:
                (torch.ones(8, device="cuda") * 2).sum().item()  # step 5: tiny op
                checks.append("GPU smoke tensor op: ok")
            except Exception as exc:
                return {"provider": "qwen", "route": "torch", "status": "needs_setup",
                        "checks": checks + [f"GPU smoke test failed: {exc}"]}
            return {"provider": "qwen", "route": "torch", "status": "ready",
                    "device": f"{props.name} (CUDA)", "checks": checks}

        checks.append(
            "CUDA unavailable — CPU FP32 mode is a slow compatibility path and is "
            "only opened after end-to-end validation (currently unverified)"
        )
        return {"provider": "qwen", "route": "torch", "status": "unverified", "checks": checks}

    # --- model loading ------------------------------------------------------

    def _resolve_device(self):
        import torch
        if self._requested_device and self._requested_device != "auto":
            return self._requested_device
        return "cuda:0" if torch.cuda.is_available() else "cpu"

    def _load_models(self, on_stage):
        import torch

        self._device = self._resolve_device()
        if self._device.startswith("cuda"):
            props = torch.cuda.get_device_properties(torch.device(self._device))
            bf16_ok = (props.major, props.minor) >= (8, 0)
            dtype, self._dtype_name = (torch.bfloat16, "bfloat16") if bf16_ok else (torch.float16, "float16")
        else:
            dtype, self._dtype_name = torch.float32, "float32"

        from qwen_asr import Qwen3ASRModel

        if self._asr is None:
            on_stage(f"加载识别+对齐模型 ({self._dtype_name} @ {self._device})")
            t0 = time.monotonic()
            try:
                # The official package integrates the aligner at init:
                # transcribe(..., return_time_stamps=True) then emits word-level
                # times directly (qwen-asr 0.0.6 API).
                self._asr = Qwen3ASRModel.from_pretrained(
                    ASR_MODEL_ID, dtype=dtype, device_map=self._device,
                    forced_aligner=ALIGNER_MODEL_ID,
                    forced_aligner_kwargs={"dtype": dtype, "device_map": self._device},
                    max_inference_batch_size=1, max_new_tokens=MAX_NEW_TOKENS,
                )
            except Exception as exc:
                raise BackendError(
                    f"Failed to load {ASR_MODEL_ID} + {ALIGNER_MODEL_ID} on {self._device} "
                    f"({self._dtype_name}): {exc}\n"
                    "Common fixes: update the NVIDIA driver; install the CUDA build of PyTorch "
                    "(see references/windows-torch.md); free VRAM by closing other GPU apps. "
                    "The provider is NOT switched automatically — pick Scribe explicitly if you want online."
                ) from exc
            print(f"  recognition + aligner models ready in {time.monotonic() - t0:.1f}s")

    # --- chunk cache ---------------------------------------------------------

    @staticmethod
    def _timestamp_items(time_stamps):
        """time_stamps is a ForcedAlignResult (list under .items) or already a list."""
        if isinstance(time_stamps, list):
            return time_stamps
        items = getattr(time_stamps, "items", None)
        return items if isinstance(items, list) else []

    def _fingerprint(self, media_path: Path, language: Optional[str], index: int, start: float, end: float) -> str:
        try:
            stat = media_path.stat()
            payload = json.dumps([
                str(media_path.resolve()), stat.st_size, int(stat.st_mtime),
                ASR_MODEL_ID, ALIGNER_MODEL_ID, language, index,
                round(start, 3), round(end, 3), self._dtype_name,
            ], ensure_ascii=False)
        except OSError:
            payload = json.dumps([str(media_path), ASR_MODEL_ID, language, index, round(start, 3), round(end, 3)])
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    def _load_cached_chunk(self, cache_file: Path, fingerprint: str) -> Optional[dict]:
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if data.get("fingerprint") != fingerprint:
            return None  # params changed — stale chunk, redo (doc §8)
        if data.get("status") != "ok":
            return None
        return data

    # --- transcription -------------------------------------------------------

    def transcribe(
        self,
        media_path: str,
        language: Optional[str] = None,
        options: Optional[dict] = None,
        on_stage: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> dict:
        import media as media_mod

        options = options or {}
        on_stage = on_stage or (lambda stage: None)
        media_path = Path(media_path)

        info = options.get("media_info") or media_mod.probe_media(media_path)
        duration = info["duration"]

        work_dir = Path(options.get("work_dir") or (media_path.parent / f".{media_path.stem}.chunks"))
        work_dir.mkdir(parents=True, exist_ok=True)

        self._load_models(on_stage)

        on_stage("预处理 16kHz 单声道音频")
        full_wav = media_mod.to_wav16k_mono(
            media_path, work_dir / "full16k.wav",
            stream_index=options.get("audio_track"),
        )
        silences = media_mod.detect_silences(full_wav)
        chunks = media_mod.plan_chunks(
            duration, silences,
            target=self._chunk_target, hard_cap=CHUNK_HARD_CAP,
        )
        if len(chunks) > 1:
            on_stage(f"长音频分为 {len(chunks)} 块（目标 {self._chunk_target:.0f}s，静音吸附）")

        qwen_language = None
        if language and language not in ("auto", None):
            from . import QWEN_LANGUAGE_NAMES
            qwen_language = QWEN_LANGUAGE_NAMES.get(language.lower(), language.capitalize())

        warnings: List[str] = []
        all_words: List[dict] = []
        chunk_texts: List[str] = []
        detected_language = language if language and language != "auto" else None
        alignment_failed = False

        for index, (start, end) in enumerate(chunks):
            cache_file = work_dir / f"chunk-{index:04d}.json"
            fingerprint = self._fingerprint(media_path, language, index, start, end)

            cached = self._load_cached_chunk(cache_file, fingerprint)
            if cached is not None:
                on_stage(f"分块 {index + 1}/{len(chunks)} 命中缓存（跳过）")
                words, text, chunk_lang = cached["words"], cached["text"], cached.get("language")
            else:
                chunk_wav = media_mod.extract_chunk(full_wav, start, end - start, work_dir / f"chunk-{index:04d}.wav")

                on_stage(f"转写+对齐分块 {index + 1}/{len(chunks)} [{start:.0f}s–{end:.0f}s]")
                align_error = None
                try:
                    results = self._asr.transcribe(
                        audio=str(chunk_wav), language=qwen_language, return_time_stamps=True,
                    )
                    asr_result = results[0] if isinstance(results, list) else results
                except Exception as exc:
                    # Integrated aligner failed — degrade once to text-only so the
                    # transcription itself survives (status partial, SRT off).
                    align_error = str(exc)
                    results = self._asr.transcribe(
                        audio=str(chunk_wav), language=qwen_language, return_time_stamps=False,
                    )
                    asr_result = results[0] if isinstance(results, list) else results

                text = str(_field(asr_result, "text", default="") or "").strip()
                chunk_lang = self._language_code(_field(asr_result, "language"))

                words = []
                if text and not align_error:
                    for item in self._timestamp_items(_field(asr_result, "time_stamps")):
                        unit_text = str(_field(item, "text", default="") or "").strip()
                        s = _field(item, "start_time", "start")
                        e = _field(item, "end_time", "end")
                        if unit_text and isinstance(s, (int, float)) and isinstance(e, (int, float)) and e >= s:
                            words.append(make_word(s + start, e + start, unit_text))
                    if not words:
                        align_error = "aligner returned no time units"
                    else:
                        # The aligner strips punctuation; map it back from the
                        # raw chunk text so sentence grouping can use it.
                        attached = attach_punctuation(words, text)
                        if attached:
                            words = attached

                try:
                    cache_file.write_text(json.dumps({
                        "fingerprint": fingerprint,
                        "status": "ok" if (words or not text) else "partial",
                        "index": index, "start": start, "end": end,
                        "text": text, "language": chunk_lang,
                        "align_error": align_error,
                        "words": words,
                    }, ensure_ascii=False), encoding="utf-8")
                except OSError:
                    pass

                if align_error:
                    alignment_failed = True
                    warnings.append(
                        f"chunk {index} ({start:.0f}s–{end:.0f}s) alignment failed: {align_error}; "
                        "text kept, SRT unavailable"
                    )

            all_words.extend(words)
            chunk_texts.append(text)
            if detected_language is None and chunk_lang:
                detected_language = chunk_lang

            if on_progress:
                try:
                    on_progress(min((index + 1) / len(chunks), 1.0), end, duration)
                except Exception:
                    pass

        merged_text = join_word_texts(chunk_texts)
        status = "partial" if alignment_failed else "complete"
        if not merged_text.strip():
            status = "complete"
            warnings.append("no_speech: no transcribable speech detected")

        return build_result(
            provider=self.provider,
            backend=self.backend,
            model_id=ASR_MODEL_ID,
            model_revision=cached_revision(ASR_MODEL_ID),
            weight_precision="bf16-fp16-cpu",
            compute_dtype=self._dtype_name or "unknown",
            language=detected_language,
            duration=duration,
            text=merged_text,
            words=sorted(all_words, key=lambda w: w["start"]) if all_words else [],
            status=status,
            warnings=warnings,
        )

    @staticmethod
    def _language_code(raw) -> Optional[str]:
        """Normalize a Qwen language ('Chinese'/'chinese'/'zh') to an ISO code."""
        from . import QWEN_NAME_TO_CODE
        if not raw or not isinstance(raw, str):
            return None
        if raw.lower() in QWEN_NAME_TO_CODE:
            return QWEN_NAME_TO_CODE[raw.lower()]
        lowered = raw.lower()
        return lowered[:2] if len(lowered) == 2 else lowered
