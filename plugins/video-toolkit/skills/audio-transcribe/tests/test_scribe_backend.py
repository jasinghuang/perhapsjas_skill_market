import json
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backends.scribe_backend import ScribeBackend, ScribeError

API_KEY = "sk-test-key-never-print"


@pytest.fixture
def audio_file(tmp_path):
    f = tmp_path / "sample zh.mp3"
    f.write_bytes(b"\x00" * 64)
    return f


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class UrlopenSpy:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)  # each: response payload | Exception
        self.requests = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(outcome)


def make_backend(monkeypatch, outcomes):
    monkeypatch.setenv("ELEVENLABS_API_KEY", API_KEY)
    spy = UrlopenSpy(outcomes)
    import backends.scribe_backend as sb
    monkeypatch.setattr(sb.urlrequest, "urlopen", spy)
    sleeps = []
    backend = ScribeBackend(sleeper=sleeps.append)
    return backend, spy, sleeps


def ok_payload():
    return {
        "language_code": "zh",
        "text": "你好，世界。",
        "words": [
            {"text": " ", "type": "spacing", "start": 0.0, "end": 0.1},
            {"text": "你", "type": "word", "start": 0.1, "end": 0.4},
            {"text": "好", "type": "word", "start": 0.4, "end": 0.7},
            {"text": "[laughter]", "type": "audio_event", "start": 0.7, "end": 0.9},
            {"text": "世界。", "type": "word", "start": 0.9, "end": 1.6},
        ],
        "transcription_id": "tr-123",
        "audio_duration_secs": 2.5,
    }


# --- request correctness ------------------------------------------------------

def test_request_params_and_auth_header(audio_file, monkeypatch):
    backend, spy, _ = make_backend(monkeypatch, [ok_payload()])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    result = backend.transcribe(str(audio_file), language="zh")
    req = spy.requests[0]
    body = req.data
    assert b'name="model_id"\r\n\r\nscribe_v2' in body
    assert b'name="timestamps_granularity"\r\n\r\nword' in body
    assert b'name="diarize"\r\n\r\nfalse' in body
    assert b'name="language_code"\r\n\r\nzh' in body
    assert req.headers.get("Xi-api-key") == API_KEY
    assert result["provider"] == "scribe"
    assert result["model_id"] == "scribe_v2"
    assert result["job_id"] == "tr-123"


def test_auto_language_omits_language_code(audio_file, monkeypatch):
    backend, spy, _ = make_backend(monkeypatch, [ok_payload()])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    backend.transcribe(str(audio_file), language="auto")
    assert b'language_code' not in spy.requests[0].data


def test_spacing_and_audio_event_words_dropped(audio_file, monkeypatch):
    backend, _, _ = make_backend(monkeypatch, [ok_payload()])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    result = backend.transcribe(str(audio_file), language="auto")
    texts = [word["text"] for word in result["words"]]
    assert texts == ["你", "好", "世界。"]  # spacing + [laughter] filtered
    assert result["text"] == "你好，世界。"
    assert result["status"] == "complete"


# --- error handling --------------------------------------------------------------

def test_missing_key_fails_fast_without_network(audio_file, monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    backend = ScribeBackend()
    with pytest.raises(ScribeError) as excinfo:
        backend.transcribe(str(audio_file))
    assert excinfo.value.kind == "auth"
    assert API_KEY not in str(excinfo.value)


def test_401_stops_without_retry(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [
        HTTPError("u", 401, "Unauthorized", None, None),
    ])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    with pytest.raises(ScribeError) as excinfo:
        backend.transcribe(str(audio_file))
    assert excinfo.value.kind == "auth"
    assert len(spy.requests) == 1  # no retry loop on credentials
    assert sleeps == []
    assert API_KEY not in str(excinfo.value)


def test_422_param_error_stops(audio_file, monkeypatch):
    backend, spy, _ = make_backend(monkeypatch, [HTTPError("u", 422, "Unprocessable", None, None)])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    with pytest.raises(ScribeError) as excinfo:
        backend.transcribe(str(audio_file))
    assert excinfo.value.kind == "param"
    assert len(spy.requests) == 1


def test_5xx_retries_then_succeeds(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [
        HTTPError("u", 500, "Server Error", None, None),
        HTTPError("u", 503, "Busy", None, None),
        ok_payload(),
    ])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    result = backend.transcribe(str(audio_file))
    assert result["status"] == "complete"
    assert len(spy.requests) == 3
    assert sleeps == [2.0, 4.0]  # backoff before retries 2 and 3


def test_429_gives_up_after_three_attempts(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [
        HTTPError("u", 429, "Too Many Requests", None, None)] * 3)
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    with pytest.raises(ScribeError) as excinfo:
        backend.transcribe(str(audio_file))
    assert excinfo.value.kind == "server"
    assert len(spy.requests) == 3  # max 3 attempts (doc §7)


def test_timeout_is_submission_unknown_no_reupload(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [URLError(TimeoutError("timed out"))])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    with pytest.raises(ScribeError) as excinfo:
        backend.transcribe(str(audio_file))
    assert excinfo.value.kind == "submission_unknown"
    assert "bills again" in str(excinfo.value) or "bill" in str(excinfo.value)
    assert len(spy.requests) == 1  # never blindly re-upload
    assert sleeps == []


def test_network_error_retries(audio_file, monkeypatch):
    backend, spy, _ = make_backend(monkeypatch, [
        URLError(OSError("connection reset")),
        ok_payload(),
    ])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    result = backend.transcribe(str(audio_file))
    assert result["status"] == "complete"
    assert len(spy.requests) == 2


# --- result mapping --------------------------------------------------------------

def test_no_speech_returns_empty_transcription(audio_file, monkeypatch):
    payload = ok_payload()
    payload["text"] = ""
    payload["words"] = []
    backend, _, _ = make_backend(monkeypatch, [payload])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    result = backend.transcribe(str(audio_file))
    assert result["text"] == ""
    assert any("no_speech" in warn for warn in result["warnings"])
    assert result["status"] == "complete"


def test_text_without_word_timestamps_is_partial(audio_file, monkeypatch):
    payload = ok_payload()
    payload["words"] = [{"text": " ", "type": "spacing", "start": 0.0, "end": 0.1}]
    backend, _, _ = make_backend(monkeypatch, [payload])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    result = backend.transcribe(str(audio_file))
    assert result["status"] == "partial"
    assert result["words"] == []


def test_diarize_flag_forwarded(audio_file, monkeypatch):
    backend, spy, _ = make_backend(monkeypatch, [ok_payload()])
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    backend.transcribe(str(audio_file), options={"diarize": True})
    assert b'name="diarize"\r\n\r\ntrue' in spy.requests[0].data


def test_multipart_sanitizes_filename():
    """Quotes in filenames must not break the multipart header (tested via a
    stub because NTFS forbids '"' in real file names)."""
    from backends.scribe_backend import _multipart

    stub = SimpleNamespace(suffix=".mp3", name='weird "name".mp3', read_bytes=lambda: b"\x00" * 8)
    body = _multipart({"model_id": "scribe_v2"}, "file", stub, "bound123")
    assert b'filename="weird _name_.mp3"' in body
    # the boundary line after the sanitized filename still parses
    assert b"\r\nContent-Type: audio/mpeg\r\n\r\n" in body
