from __future__ import annotations

import json
from pathlib import Path

import pytest

from helpers import aligned_task, base_task, write_srt, write_task, write_tone


def test_narration_task_loads(r, tmp_path):
    path = write_task(tmp_path, base_task())
    task = r.load_task(path)
    assert task.mode == "narration"
    assert task.provider == "local"
    assert task.backend == "mlx_audio"
    assert task.language == "chinese"
    assert task.voice.speaker == "Serena"
    assert task.segments[0].start_sec is None
    assert task.output.deliver == ["audio", "subtitle"]
    assert task.timing.max_speed == 1.2


def test_relative_reference_audio_resolves_against_task_dir(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav")
    data = base_task(
        model_id=r.MLX_CLONE_MODEL,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": "ref.wav",
            "reference_text": "参考文本。",
            "name": None,
        },
    )
    data["parameters"] = {}
    task = r.load_task(write_task(tmp_path, data))
    assert task.voice.reference_audio == reference.resolve()


def test_model_must_match_voice_source(r, tmp_path):
    data = base_task(model_id=r.MLX_CLONE_MODEL)
    with pytest.raises(r.TaskError, match="model_id"):
        r.load_task(write_task(tmp_path, data))


def test_unknown_parameter_is_rejected(r, tmp_path):
    data = base_task(parameters={"unknown": 1})
    with pytest.raises(r.TaskError, match="unknown field"):
        r.load_task(write_task(tmp_path, data))


def test_clone_rejects_instruct(r, tmp_path):
    reference = write_tone(tmp_path / "ref.wav")
    data = base_task(
        model_id=r.MLX_CLONE_MODEL,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": "ref.wav",
            "reference_text": "参考文本。",
            "name": None,
        },
        parameters={"instruct": "温柔"},
    )
    with pytest.raises(r.TaskError, match="instruct"):
        r.load_task(write_task(tmp_path, data))


def test_narration_rejects_timings(r, tmp_path):
    data = base_task(
        segments=[{"id": 1, "text": "测试。", "start_sec": 0.0, "end_sec": 1.0}]
    )
    with pytest.raises(r.TaskError, match="null"):
        r.load_task(write_task(tmp_path, data))


def test_aligned_windows_and_srt_only_total(r, tmp_path):
    write_srt(tmp_path / "input.srt")
    task = r.load_task(write_task(tmp_path, aligned_task()))
    assert [segment.window_sec for segment in task.segments] == [1.4, 1.0]
    assert task.video_duration is None


def test_aligned_requires_strictly_increasing_starts(r, tmp_path):
    write_srt(tmp_path / "input.srt")
    data = aligned_task(
        segments=[
            {"id": 1, "text": "甲。", "start_sec": 1.0, "end_sec": 2.0},
            {"id": 2, "text": "乙。", "start_sec": 1.0, "end_sec": 3.0},
        ]
    )
    with pytest.raises(r.TaskError, match="strictly greater"):
        r.load_task(write_task(tmp_path, data))


def test_aligned_rejects_non_positive_window(r, tmp_path):
    write_srt(tmp_path / "input.srt")
    data = aligned_task(
        segments=[
            {"id": 1, "text": "甲。", "start_sec": 2.0, "end_sec": 3.0},
            {"id": 2, "text": "乙。", "start_sec": 2.05, "end_sec": 4.0},
        ]
    )
    with pytest.raises(r.TaskError, match="no usable window"):
        r.load_task(write_task(tmp_path, data))


def test_aligned_warns_on_source_overlap(r, tmp_path):
    write_srt(tmp_path / "input.srt")
    data = aligned_task(
        segments=[
            {"id": 1, "text": "甲。", "start_sec": 0.5, "end_sec": 2.5},
            {"id": 2, "text": "乙。", "start_sec": 2.0, "end_sec": 3.0},
        ]
    )
    task = r.load_task(write_task(tmp_path, data))
    assert any("overlaps" in message for message in task.warnings)


def test_deliver_video_requires_video(r, tmp_path):
    data = base_task(output={"deliver": ["video"]})
    with pytest.raises(r.TaskError, match="input.video"):
        r.load_task(write_task(tmp_path, data))


def test_sample_rate_must_be_48k(r, tmp_path):
    data = base_task(output={"sample_rate": 44100})
    with pytest.raises(r.TaskError, match="48 kHz"):
        r.load_task(write_task(tmp_path, data))


def test_json_nan_is_rejected(r, tmp_path):
    path = write_task(tmp_path, base_task())
    raw = json.loads(path.read_text(encoding="utf-8"))
    text = json.dumps(raw, ensure_ascii=False)
    text = text.replace('"timing": {', '"timing": {"max_speed": NaN, ', 1)
    path.write_text(text, encoding="utf-8")
    with pytest.raises(r.TaskError, match="invalid JSON constant"):
        r.load_task(path)


def test_fixed_model_rejects_other_qwen_size(r, tmp_path):
    data = base_task(model_id="mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16")
    with pytest.raises(r.TaskError, match="must be exactly"):
        r.load_task(write_task(tmp_path, data))


def test_online_model_and_voice_fields(r, tmp_path):
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
    data["parameters"] = {"voice_settings": {"stability": 0.5}, "output_format": "wav_44100"}
    task = r.load_task(write_task(tmp_path, data))
    assert task.voice.voice_id == "voice-123"
    assert task.parameters["output_format"] == "wav_44100"


def test_online_requires_voice_id_for_preset(r, tmp_path):
    data = base_task(
        provider="elevenlabs",
        backend="elevenlabs_http",
        model_id="eleven_multilingual_v2",
        voice={
            "source": "preset",
            "speaker": None,
            "voice_id": None,
            "reference_audio": None,
            "reference_text": None,
            "name": None,
        },
        parameters={},
    )
    with pytest.raises(r.TaskError, match="voice_id"):
        r.load_task(write_task(tmp_path, data))
