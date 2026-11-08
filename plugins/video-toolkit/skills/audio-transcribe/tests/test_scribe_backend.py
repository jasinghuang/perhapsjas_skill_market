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


@pytest.fixture(autouse=True)
def fake_audio_extraction(monkeypatch):
    import media
    def extract(src, dst, stream_index=None):
        dst.write_bytes(b"audio-only")
        return dst
    monkeypatch.setattr(media, "to_upload_audio", extract)


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
    body = b"".join(req.data)
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
    assert b'language_code' not in b''.join(spy.requests[0].data)


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


def test_5xx_unknown_state_not_reuploaded(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [HTTPError("u", 500, "error", None, None)])
    with pytest.raises(ScribeError) as caught:
        backend._post(audio_file, {}, lambda _: None)
    assert caught.value.kind == "submission_unknown"
    assert len(spy.requests) == 1 and not sleeps


def test_429_gives_up_after_three_attempts(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [
        HTTPError("u", 429, "Too Many Requests", None, None)] * 3)
    import media
    monkeypatch.setattr(media, "probe_media", lambda p: {"duration": 2.5, "audio_streams": []})
    with pytest.raises(ScribeError) as excinfo:
        backend.transcribe(str(audio_file))
    assert excinfo.value.kind == "rate_limit"
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


def test_connection_reset_not_reuploaded(audio_file, monkeypatch):
    backend, spy, sleeps = make_backend(monkeypatch, [URLError(OSError("reset"))])
    with pytest.raises(ScribeError) as caught:
        backend._post(audio_file, {}, lambda _: None)
    assert caught.value.kind == "submission_unknown"
    assert len(spy.requests) == 1 and not sleeps


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
    assert b'name="diarize"\r\n\r\ntrue' in b''.join(spy.requests[0].data)


def test_multipart_sanitizes_filename(tmp_path):
    from backends.scribe_backend import _multipart
    real = tmp_path / "weird name.mp3"  # legal on every filesystem
    real.write_bytes(b"12345678")

    class WeirdNamePath:  # NTFS forbids '"' in filenames; emulate it for the header path
        name = 'weird "name".mp3'
        suffix = ".mp3"

        def stat(self):
            return real.stat()

        def open(self, *args, **kwargs):
            return real.open(*args, **kwargs)

    body = _multipart({"model_id": "scribe_v2"}, "file", WeirdNamePath(), "bound123")
    data = b"".join(body)
    assert b'filename="weird _name_.mp3"' in data
    assert body.length == len(data)



@pytest.mark.parametrize('outcome', [TimeoutError('timed out'), HTTPError('u',404,'not found',None,None)])
def test_bare_timeout_or_404_never_retries(audio_file, monkeypatch, outcome):
    backend, spy, sleeps = make_backend(monkeypatch, [outcome])
    with pytest.raises(ScribeError):
        backend._post(audio_file, {}, lambda _: None)
    assert len(spy.requests) == 1 and not sleeps


def test_streaming_body_real_local_http_roundtrip(tmp_path, monkeypatch):
    import threading
    import socket
    monkeypatch.setattr(socket, "getfqdn", lambda name="": "localhost")
    from http.server import BaseHTTPRequestHandler, HTTPServer
    received = {}
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received['length'] = int(self.headers['Content-Length'])
            received['body'] = self.rfile.read(received['length'])
            body = json.dumps(ok_payload()).encode()
            self.send_response(200)
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self,*args): pass
    import backends.scribe_backend as sb
    monkeypatch.setattr(sb, 'REQUEST_TIMEOUT', 3)
    server = HTTPServer(('127.0.0.1',0),Handler)
    server.timeout = 3
    thread = threading.Thread(target=server.handle_request,daemon=True); thread.start()
    f = tmp_path/'audio.m4a'; f.write_bytes(b'abcde'*200000)
    monkeypatch.setenv('ELEVENLABS_API_KEY', API_KEY)
    try:
        backend = ScribeBackend(api_url=f'http://127.0.0.1:{server.server_port}/')
        result = backend._post(f, {'model_id':'scribe_v2'},lambda _:None)
        thread.join(timeout=3)
        assert not thread.is_alive()
        assert result['text'] == ok_payload()['text']
        assert len(received['body']) == received['length']
        assert f.read_bytes() in received['body']
    finally:
        server.server_close()
