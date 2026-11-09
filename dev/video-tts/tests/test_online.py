from __future__ import annotations

import json
import shutil
import subprocess

import pytest
import requests

from helpers import base_task, wav_bytes, write_task, write_tone


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, content=b"", headers=None, text=""):
        self.status_code = status_code
        self._json = json_data
        self.content = content
        self.headers = headers or {}
        self.text = text

    def json(self):
        return self._json


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}
        self.closed = False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = self.responses.pop(0)
        if isinstance(response, BaseException):
            raise response
        return response

    def close(self):
        self.closed = True


def _online_task(tmp_path, r, **overrides):
    data = base_task(
        provider="elevenlabs",
        backend="elevenlabs_http",
        model_id="eleven_multilingual_v2",
        voice={
            "source": "preset",
            "speaker": None,
            "voice_id": "voice-123",
            "reference_audio": None,
            "reference_text": None,
            "name": None,
        },
    )
    data["parameters"] = {}
    for key, value in overrides.items():
        if key == "parameters":
            data["parameters"] = value
        elif key == "voice":
            data["voice"] = value
        else:
            data[key] = value
    return r.load_task(write_task(tmp_path, data))


def _adapter(r, task, session):
    return r.ElevenLabsAdapter(
        task,
        r.Result(task),
        session_factory=lambda: session,
        api_key="test-key",
        base_url="https://api.test",
    )


def _models(*model_ids):
    return FakeResponse(json_data=[{"model_id": model_id} for model_id in model_ids])


def test_prepare_and_synthesize_multilingual(r, tmp_path):
    task = _online_task(tmp_path, r)
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "voice-123", "name": "Test Voice"}),
            FakeResponse(content=wav_bytes(0.5)),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    output = tmp_path / "online.wav"
    assert adapter.synthesize("在线测试。", output) == 44100
    assert r.read_wav(output)[1] == 44100
    method, url, kwargs = session.calls[-1]
    assert method == "POST"
    assert url.endswith("/v1/text-to-speech/voice-123")
    assert kwargs["params"]["output_format"] == "mp3_44100_128"
    assert kwargs["json"]["text"] == "在线测试。"
    assert kwargs["json"]["model_id"] == "eleven_multilingual_v2"
    assert "language_code" not in kwargs["json"]


def test_mp3_response_is_decoded_to_native_wav(r, tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg unavailable")
    mp3 = tmp_path / "sample.mp3"
    subprocess.run(
        [
            r.FFMPEG,
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=44100:duration=0.5",
            str(mp3),
        ],
        check=True,
    )
    task = _online_task(tmp_path, r, parameters={"output_format": "mp3_44100_128"})
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "voice-123", "name": "Test Voice"}),
            FakeResponse(content=mp3.read_bytes()),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    output = tmp_path / "decoded.wav"
    assert adapter.synthesize("MP3 解码测试。", output) == 44100
    pcm, rate = r.read_wav(output)
    assert rate == 44100
    assert pcm.size / rate == pytest.approx(0.5, abs=0.1)


def test_flash_uses_language_code(r, tmp_path):
    task = _online_task(tmp_path, r, model_id="eleven_flash_v2_5")
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "voice-123", "name": "Test Voice"}),
            FakeResponse(content=wav_bytes(0.5)),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    adapter.synthesize("在线测试。", tmp_path / "online.wav")
    payload = session.calls[-1][2]["json"]
    assert payload["language_code"] == "zh"


def test_401_is_fatal_and_not_retryable(r, tmp_path):
    task = _online_task(tmp_path, r)
    session = FakeSession([FakeResponse(status_code=401, text="unauthorized")])
    adapter = _adapter(r, task, session)
    with pytest.raises(r.RunnerError) as info:
        adapter.prepare()
    assert info.value.retryable is False
    assert "401/403" in info.value.message


def test_429_is_retryable_with_retry_after(r, tmp_path):
    task = _online_task(tmp_path, r)
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "voice-123", "name": "Test Voice"}),
            FakeResponse(status_code=429, text="rate limited", headers={"Retry-After": "2"}),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    with pytest.raises(r.RunnerError) as info:
        adapter.synthesize("测试。", tmp_path / "online.wav")
    assert info.value.retryable is True
    assert info.value.retry_after == 2.0


def test_read_timeout_is_submission_unknown(r, tmp_path):
    task = _online_task(tmp_path, r)
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "voice-123", "name": "Test Voice"}),
            requests.exceptions.ReadTimeout("timed out"),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    with pytest.raises(r.RunnerError) as info:
        adapter.synthesize("测试。", tmp_path / "online.wav")
    assert info.value.submission_unknown is True
    assert info.value.retryable is False


def test_422_is_fatal(r, tmp_path):
    task = _online_task(tmp_path, r)
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "voice-123", "name": "Test Voice"}),
            FakeResponse(status_code=422, text="invalid text"),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    with pytest.raises(r.RunnerError) as info:
        adapter.synthesize("测试。", tmp_path / "online.wav")
    assert info.value.retryable is False
    assert "422" in info.value.message


def test_model_unavailable_requires_user_choice(r, tmp_path):
    task = _online_task(tmp_path, r, model_id="eleven_flash_v2_5")
    session = FakeSession([_models("eleven_multilingual_v2")])
    adapter = _adapter(r, task, session)
    with pytest.raises(r.ActionRequired) as info:
        adapter.prepare()
    assert info.value.details["available_models"] == ["eleven_multilingual_v2"]


def test_new_clone_saves_voice_id_before_verification_stop(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    task = _online_task(
        tmp_path,
        r,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": reference.name,
            "reference_text": None,
            "name": "My Clone",
        },
    )
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "new-voice", "requires_verification": True}),
        ]
    )
    adapter = _adapter(r, task, session)
    with pytest.raises(r.ActionRequired) as info:
        adapter.prepare()
    assert info.value.details["voice_id"] == "new-voice"
    result = json.loads(adapter.result.path.read_text(encoding="utf-8"))
    assert result["voice"]["voice_id"] == "new-voice"
    assert result["clone"]["requires_verification"] is True
    clone_call = session.calls[-1]
    assert clone_call[0] == "POST"
    assert clone_call[1].endswith("/v1/voices/add")


def test_verification_pending_clone_is_not_created_twice(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    task = _online_task(
        tmp_path,
        r,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": reference.name,
            "reference_text": None,
            "name": "My Clone",
        },
    )
    first_session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "new-voice", "requires_verification": True}),
        ]
    )
    with pytest.raises(r.ActionRequired):
        _adapter(r, task, first_session).prepare()
    assert (tmp_path / "clone.json").is_file()

    second_session = FakeSession([_models("eleven_multilingual_v2", "eleven_flash_v2_5")])
    with pytest.raises(r.ActionRequired) as info:
        _adapter(r, task, second_session).prepare()
    assert info.value.details["voice_id"] == "new-voice"
    assert not any("/v1/voices/add" in call[1] for call in second_session.calls)


def test_completed_clone_is_reused_without_duplicate_creation(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    task = _online_task(
        tmp_path,
        r,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": reference.name,
            "reference_text": None,
            "name": "My Clone",
        },
    )
    first_session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "new-voice", "requires_verification": False}),
        ]
    )
    _adapter(r, task, first_session).prepare()

    second_session = FakeSession([_models("eleven_multilingual_v2", "eleven_flash_v2_5")])
    _adapter(r, task, second_session).prepare()
    assert not any("/v1/voices/add" in call[1] for call in second_session.calls)


def test_new_clone_reused_for_synthesis(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    task = _online_task(
        tmp_path,
        r,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": reference.name,
            "reference_text": None,
            "name": "My Clone",
        },
    )
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "new-voice", "requires_verification": False}),
            FakeResponse(content=wav_bytes(0.5)),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    adapter.synthesize("克隆测试。", tmp_path / "online.wav")
    urls = [call[1] for call in session.calls]
    assert sum("/v1/voices/add" in url for url in urls) == 1
    assert urls[-1].endswith("/v1/text-to-speech/new-voice")


def test_existing_voice_does_not_upload_reference(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    task = _online_task(
        tmp_path,
        r,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": "existing-voice",
            "reference_audio": reference.name,
            "reference_text": None,
            "name": None,
        },
    )
    assert any("no upload" in message for message in task.warnings)
    session = FakeSession(
        [
            _models("eleven_multilingual_v2", "eleven_flash_v2_5"),
            FakeResponse(json_data={"voice_id": "existing-voice", "name": "Existing"}),
        ]
    )
    adapter = _adapter(r, task, session)
    adapter.prepare()
    urls = [call[1] for call in session.calls]
    assert not any("/v1/voices/add" in url for url in urls)
