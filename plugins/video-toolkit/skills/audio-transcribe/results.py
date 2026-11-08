"""Unified transcription result (doc §9).

Both providers return this exact structure. Times are seconds from the
beginning of the original media. Fields a backend cannot provide stay null —
we never fabricate confidence, speakers or timestamps.
"""

import uuid
import math
from typing import List, Optional

SCHEMA_VERSION = 1

VALID_STATUS = ("complete", "partial", "failed", "cancelled")


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def make_word(start: float, end: float, text: str, speaker_id: Optional[str] = None) -> dict:
    return {"start": float(start), "end": float(end), "text": text, "speaker_id": speaker_id}


def build_result(
    *,
    provider: str,
    backend: str,
    model_id: str,
    language: Optional[str],
    duration: Optional[float],
    text: str,
    words: Optional[List[dict]] = None,
    segments: Optional[List[dict]] = None,
    status: str = "complete",
    job_id: Optional[str] = None,
    model_revision: Optional[str] = None,
    weight_precision: Optional[str] = None,
    compute_dtype: Optional[str] = None,
    warnings: Optional[List[str]] = None,
) -> dict:
    if status not in VALID_STATUS:
        raise ValueError(f"Invalid status '{status}', expected one of {VALID_STATUS}")
    return {
        "schema_version": SCHEMA_VERSION,
        "job_id": job_id or new_job_id(),
        "status": status,
        "provider": provider,
        "backend": backend,
        "model_id": model_id,
        "model_revision": model_revision,
        "weight_precision": weight_precision,
        "compute_dtype": compute_dtype,
        "language": language,
        "duration_seconds": duration,
        "text": text,
        "words": words or [],
        "segments": segments or [],
        "warnings": warnings or [],
    }


def _check_time_units(units: List[dict], label: str, issues: List[str]) -> None:
    previous_end = None
    for i, unit in enumerate(units):
        start, end = unit.get("start"), unit.get("end")
        if (not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(start) or not math.isfinite(end)):
            issues.append(f"{label}[{i}] has non-numeric times")
            continue
        if end < start:
            issues.append(f"{label}[{i}] ends before it starts ({start:.3f} > {end:.3f})")
        if start < 0:
            issues.append(f"{label}[{i}] starts before media begins")
        if previous_end is not None and start < previous_end - 1e-6:
            issues.append(f"{label}[{i}] starts before the previous unit ends")
        previous_end = end


def validate_result(result: dict) -> List[str]:
    """Structural validation. Returns a list of issues (empty when valid)."""
    issues = []
    if result.get("schema_version") != SCHEMA_VERSION:
        issues.append(f"schema_version must be {SCHEMA_VERSION}")
    if result.get("status") not in VALID_STATUS:
        issues.append(f"invalid status: {result.get('status')}")
    for field in ("provider", "backend", "model_id"):
        if not result.get(field):
            issues.append(f"missing {field}")
    if not isinstance(result.get("text"), str):
        issues.append("text must be a string")
    _check_time_units(result.get("words") or [], "words", issues)
    _check_time_units(result.get("segments") or [], "segments", issues)
    duration = result.get("duration_seconds")
    if duration is not None:
        for label in ("words", "segments"):
            for i, unit in enumerate(result.get(label) or []):
                if isinstance(unit.get("end"), (int, float)) and unit["end"] > duration + 0.06:
                    issues.append(f"{label}[{i}] ends {unit['end'] - duration:.3f}s past the media duration")
    if result.get("status") == "complete" and not (result.get("text") or "").strip() and not result.get("warnings"):
        issues.append("empty text without a no_speech warning looks like a silent success")
    return issues
