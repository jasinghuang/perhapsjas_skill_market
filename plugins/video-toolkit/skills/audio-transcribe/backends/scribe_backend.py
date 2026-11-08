"""Online backend — ElevenLabs Scribe V2 (POST /v1/speech-to-text).

Implemented with the standard library only: choosing Scribe must never pull
in PyTorch/MLX, and it must run on any interpreter (doc §3/§4). Word-level
timestamps come back from the API; `spacing` and `audio_event` words are
dropped so they cannot distort the subtitle timeline (doc §7).

The API key is read only from ELEVENLABS_API_KEY — never written to logs,
outputs, or errors. 401/parameter errors stop immediately; rate limits and
connection failures retry at most 3 times with backoff; a post-upload timeout
is marked submission_unknown instead of being blindly retried (doc §7).
"""

import json
import os
import time
import uuid
from http.client import HTTPException
from pathlib import Path
from typing import Callable, Optional
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from results import build_result, make_word

API_URL = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL_ID = "scribe_v2"
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (2.0, 4.0)
REQUEST_TIMEOUT = 1200.0  # synchronous processing of long uploads

# ISO-639-1 codes Scribe accepts; unmapped codes pass through lowercased.
LANGUAGE_CODES = {"zh": "zh", "en": "en", "ja": "ja", "ko": "ko", "de": "de", "fr": "fr", "es": "es"}


class ScribeError(Exception):
    def __init__(self, message: str, kind: str = "error"):
        super().__init__(message)
        self.kind = kind  # auth | param | network | rate_limit | server | submission_unknown


class MultipartBody:
    """Replayable, bounded-memory HTTP iterable with an explicit Content-Length."""
    def __init__(self, prefix, file_path, suffix):
        self.prefix, self.path, self.suffix = prefix, file_path, suffix
        self.length = len(prefix) + file_path.stat().st_size + len(suffix)

    def __iter__(self):
        yield self.prefix
        with self.path.open("rb") as f:
            for block in iter(lambda: f.read(256 * 1024), b""):
                yield block
        yield self.suffix


def _multipart(fields: dict, file_field: str, file_path: Path, boundary: str):
    parts = []
    for name, value in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8")
        )
    mime = "application/octet-stream"
    suffix = file_path.suffix.lower()
    if suffix == ".mp3":
        mime = "audio/mpeg"
    elif suffix in (".mp4", ".mov", ".m4a"):
        mime = "audio/mp4"
    elif suffix == ".wav":
        mime = "audio/wav"
    filename = file_path.name.replace('"', "_")
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n".encode("utf-8")
    )
    return MultipartBody(b"".join(parts), file_path, f"\r\n--{boundary}--\r\n".encode("utf-8"))


class ScribeBackend:
    provider = "scribe"
    backend = "http"
    model_id = MODEL_ID

    def __init__(self, api_url: str = API_URL, sleeper=time.sleep):
        self._api_url = api_url
        self._sleep = sleeper

    def probe(self) -> dict:
        has_key = bool(os.environ.get("ELEVENLABS_API_KEY"))
        return {
            "provider": "scribe",
            "status": "ready" if has_key else "needs_setup",
            "checks": [
                "no local model or GPU required",
                "ELEVENLABS_API_KEY: "
                + ("present" if has_key else "missing — set the environment variable (never commit it)"),
            ],
        }

    def _build_request(self, file_path: Path, fields: dict):
        boundary = f"----audio-transcribe-{uuid.uuid4().hex}"
        body = _multipart(fields, "file", file_path, boundary)
        req = urlrequest.Request(self._api_url, data=body, method="POST")
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        req.add_header("Content-Length", str(body.length))
        req.add_header("xi-api-key", os.environ["ELEVENLABS_API_KEY"])
        return req

    def _post(self, file_path: Path, fields: dict, on_stage) -> dict:
        """POST with retry policy. Returns parsed JSON or raises ScribeError."""
        attempt = 0
        last_error = None
        while attempt < MAX_ATTEMPTS:
            attempt += 1
            request_id = f"req-{uuid.uuid4().hex[:10]}"
            req = self._build_request(file_path, fields)
            try:
                with urlrequest.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                    data = json.loads(response.read().decode("utf-8"))
                    if not isinstance(data, dict) or not isinstance(data.get("text"), str):
                        raise ScribeError("Invalid successful response; processing state unknown; not re-uploading automatically",
                                          kind="submission_unknown")
                    return data
            except HTTPError as exc:
                # The key must never leak into messages/logs.
                if exc.code in (401, 403):
                    raise ScribeError(
                        f"ElevenLabs rejected the credentials (HTTP {exc.code}). "
                        "Check ELEVENLABS_API_KEY — the key itself is not printed here.",
                        kind="auth",
                    ) from exc
                if 400 <= exc.code < 500 and exc.code != 429:
                    raise ScribeError(f"ElevenLabs rejected the request (HTTP {exc.code})", kind="param") from exc
                if exc.code != 429:
                    raise ScribeError(f"HTTP {exc.code}: processing state unknown; not re-uploading automatically",
                                      kind="submission_unknown") from exc
                last_error = ScribeError(
                    f"ElevenLabs rate limit (HTTP {exc.code}), attempt {attempt}/{MAX_ATTEMPTS}", kind="rate_limit"
                )
            except URLError as exc:
                if isinstance(getattr(exc, "reason", None), TimeoutError) or "timed out" in str(exc).lower():
                    raise ScribeError(
                        f"Request {request_id} timed out after upload; processing state unknown. "
                        "Not re-uploading automatically — check usage in the ElevenLabs dashboard "
                        "before retrying (a retried upload bills again).",
                        kind="submission_unknown",
                    ) from exc
                raise ScribeError("Connection interrupted; processing state unknown; not re-uploading automatically",
                                  kind="submission_unknown") from exc
            except (TimeoutError, ConnectionError, OSError, HTTPException, json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise ScribeError("Response unavailable or invalid; processing state unknown; not re-uploading automatically",
                                  kind="submission_unknown") from exc

            if attempt < MAX_ATTEMPTS:
                on_stage(f"请求失败，{BACKOFF_SECONDS[attempt - 1]:.0f}s 后重试（{attempt}/{MAX_ATTEMPTS}）")
                self._sleep(BACKOFF_SECONDS[attempt - 1])

        raise last_error or ScribeError("ElevenLabs request failed", kind="network")

    def transcribe(
        self,
        media_path: str,
        language: Optional[str] = None,
        options: Optional[dict] = None,
        on_stage: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[float, float, float], None]] = None,
    ) -> dict:
        on_stage = on_stage or (lambda stage: None)
        options = options or {}
        media_path = Path(media_path)

        if not os.environ.get("ELEVENLABS_API_KEY"):
            raise ScribeError(
                "ELEVENLABS_API_KEY is not set. Configure it in the environment "
                "(see references/scribe.md); the key never appears in outputs or logs.",
                kind="auth",
            )

        import media as media_mod
        info = options.get("media_info") or media_mod.probe_media(media_path)
        from job_cache import job_directory
        work_dir = Path(options["work_dir"]) if options.get("work_dir") else job_directory(media_path, self, language, options) / "work"
        work_dir.mkdir(parents=True, exist_ok=True)
        upload = media_mod.to_upload_audio(media_path, work_dir / "selected.m4a", options.get("audio_track"))

        fields = {
            "model_id": MODEL_ID,                      # scribe_v2 only, no realtime
            "timestamps_granularity": "word",
            "tag_audio_events": "false",               # keep audio events out of the timeline
            "diarize": "true" if options.get("diarize") else "false",
        }
        language = (language or "auto").lower()
        if language not in ("auto", ""):
            fields["language_code"] = LANGUAGE_CODES.get(language, language)

        on_stage(f"上传并转写（Scribe V2 在线，{media_path.name}）")
        t0 = time.monotonic()
        data = self._post(upload, fields, on_stage)
        elapsed = time.monotonic() - t0
        on_stage(f"在线转写完成（{elapsed:.1f}s）")

        text = str(data.get("text") or "").strip()
        raw_words = data.get("words") or []
        words = []
        for w in raw_words:
            if w.get("type") not in (None, "word"):  # drop spacing / audio_event
                continue
            wtext = str(w.get("text") or "").strip()
            start, end = w.get("start"), w.get("end")
            if wtext and isinstance(start, (int, float)) and isinstance(end, (int, float)) and end >= start:
                words.append(make_word(start, end, wtext, speaker_id=w.get("speaker_id")))

        duration = data.get("audio_duration_secs") or info["duration"]
        warnings = []
        status = "complete"
        if not text:
            warnings.append("no_speech: no transcribable speech detected")
        elif not words:
            status = "partial"
            warnings.append("API returned no usable word timestamps; text kept, SRT unavailable")

        return build_result(
            provider=self.provider,
            backend=self.backend,
            model_id=MODEL_ID,
            model_revision=None,
            weight_precision=None,
            compute_dtype=None,
            language=(data.get("language_code") or (language if language != "auto" else None)),
            duration=duration,
            text=text,
            words=words,
            status=status,
            job_id=data.get("transcription_id"),
            warnings=warnings,
        )
