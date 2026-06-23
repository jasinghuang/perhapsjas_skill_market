import base64
import json
from unittest.mock import patch, MagicMock
import pytest
from bailian_tts import api


def _mock_resp(status, payload):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = payload
    m.text = json.dumps(payload)
    if status >= 400:
        m.raise_for_status.side_effect = Exception(f"HTTP {status}")
    return m


def test_create_clone_voice(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {"output": {"voice_id": "vid-123"}})
        vid = client.create_clone(url="https://x/a.wav", prefix="myvoice",
                                  target_model="cosyvoice-v3.5-plus")
    assert vid == "vid-123"
    body = json.loads(p.call_args.kwargs["data"])
    assert body["input"]["action"] == "create_voice"
    assert body["input"]["url"] == "https://x/a.wav"
    assert body["input"]["target_model"] == "cosyvoice-v3.5-plus"


def test_create_design_voice_returns_preview(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    wav_b64 = base64.b64encode(b"fakeaudio").decode()
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {
            "output": {"voice_id": "vid-d", "preview_audio": {"data": wav_b64}}
        })
        result = client.create_design(prompt="沉稳男声", preview_text="大家好",
                                      prefix="announcer",
                                      target_model="cosyvoice-v3.5-plus")
    assert result.voice_id == "vid-d"
    assert result.preview_path.read_bytes() == b"fakeaudio"


def test_poll_until_ready(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p, \
         patch("bailian_tts.api.time.sleep"):
        p.side_effect = [
            _mock_resp(200, {"output": {"status": "DEPLOYING"}}),
            _mock_resp(200, {"output": {"status": "OK"}}),
        ]
        status = client.poll_until_ready("vid-123", timeout=60, interval=0)
    assert status == "OK"


def test_poll_timeout(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p, \
         patch("bailian_tts.api.time.sleep"):
        p.return_value = _mock_resp(200, {"output": {"status": "DEPLOYING"}})
        with pytest.raises(api.PollTimeoutError):
            client.poll_until_ready("vid-123", timeout=0.001, interval=0)


def test_list_voices(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {"output": {"voice_list": [
            {"voice_id": "v1", "status": "OK", "target_model": "cosyvoice-v3.5-plus"}
        ]}})
        voices = client.list_voices()
    assert len(voices) == 1
    assert voices[0]["voice_id"] == "v1"


def test_delete_voice(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {"output": {}})
        client.delete("vid-1")
    body = json.loads(p.call_args.kwargs["data"])
    assert body["input"]["action"] == "delete_voice"
    assert body["input"]["voice_id"] == "vid-1"


def test_http_error_raises(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(401, {"error": "bad key"})
        with pytest.raises(api.ApiError):
            client.list_voices()
