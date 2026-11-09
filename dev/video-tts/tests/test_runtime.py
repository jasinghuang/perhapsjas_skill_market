from __future__ import annotations

import json

import pytest

from helpers import aligned_task, base_task, write_srt, write_task, write_tone


def test_with_retry_retries_retryable_errors(r, monkeypatch):
    monkeypatch.setattr(r.time, "sleep", lambda _seconds: None)
    calls = {"count": 0}

    def flaky():
        calls["count"] += 1
        if calls["count"] < 3:
            raise r.RunnerError("temporary", stage="test", retryable=True)
        return "ok"

    assert r.with_retry(flaky) == "ok"
    assert calls["count"] == 3


def test_with_retry_does_not_retry_fatal_or_unknown(r, monkeypatch):
    monkeypatch.setattr(r.time, "sleep", lambda _seconds: None)
    for error in (
        r.RunnerError("fatal", stage="test", retryable=False),
        r.RunnerError("unknown", stage="test", retryable=True, submission_unknown=True),
    ):
        with pytest.raises(r.RunnerError):
            r.with_retry(lambda error=error: (_ for _ in ()).throw(error))


def test_result_records_segments_and_clone_voice(r, tmp_path):
    path = write_task(tmp_path, base_task())
    task = r.load_task(path)
    result = r.Result(task)
    result.set_segment(0, status="synthesized", duration=1.25)
    result.set_voice(voice_id="voice-new", requires_verification=True, name="clone")
    payload = json.loads(result.path.read_text(encoding="utf-8"))
    assert payload["segments"][0]["status"] == "synthesized"
    assert payload["segments"][0]["duration"] == 1.25
    assert payload["voice"]["voice_id"] == "voice-new"
    assert payload["clone"]["requires_verification"] is True
    assert payload["clone"]["voice_id"] == "voice-new"


def test_result_set_voice_does_not_create_empty_clone_block(r, tmp_path):
    path = write_task(tmp_path, base_task())
    task = r.load_task(path)
    result = r.Result(task)
    result.set_voice(speaker="Serena")
    payload = json.loads(result.path.read_text(encoding="utf-8"))
    assert payload["clone"] is None


def test_choose_output_names_auto_numbers_and_overwrites(r, tmp_path):
    path = write_task(tmp_path, base_task())
    task = r.load_task(path)
    directory = task.output.directory
    directory.mkdir(parents=True, exist_ok=True)
    existing = directory / "narration.dub.wav"
    existing.write_bytes(b"old")
    names = r.choose_output_names(task, ["audio", "subtitle"])
    assert names["audio"].name == "narration.dub_2.wav"
    assert names["subtitle"].name == "narration.dub_2.srt"

    task.output.overwrite = True
    names = r.choose_output_names(task, ["audio", "subtitle"])
    assert names["audio"].name == "narration.dub.wav"


def test_choose_output_names_protects_inputs(r, tmp_path):
    reference = write_tone(tmp_path / "narration.dub.wav", 0.6, 24000)
    path = write_task(
        tmp_path,
        base_task(
            model_id=r.MLX_CLONE_MODEL,
            voice={
                "source": "clone",
                "speaker": None,
                "voice_id": None,
                "reference_audio": reference.name,
                "reference_text": "参考文本。",
                "name": None,
            },
        ),
    )
    data = json.loads(path.read_text(encoding="utf-8"))
    data["parameters"] = {}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    task = r.load_task(path)
    task.output.overwrite = True
    task.output.directory = tmp_path
    with pytest.raises(r.TaskError, match="overwrite an input"):
        r.choose_output_names(task, ["audio"])


def test_build_narration_track_total_includes_pauses(r, tmp_path):
    path = write_task(
        tmp_path,
        base_task(
            segments=[
                {"id": 1, "text": "甲。", "start_sec": None, "end_sec": None},
                {"id": 2, "text": "乙。", "start_sec": None, "end_sec": None},
            ]
        ),
    )
    task = r.load_task(path)
    result = r.Result(task)
    first = write_tone(tmp_path / "first.wav", 0.5, 48000)
    second = write_tone(tmp_path / "second.wav", 0.25, 48000)
    processed = [
        r.ProcessedSegment(task.segments[0], first, 0.5, 0.5, 24000, 1.0),
        r.ProcessedSegment(task.segments[1], second, 0.25, 0.25, 24000, 1.0),
    ]
    track = r.build_narration_track(task, processed, result)
    assert track.duration == pytest.approx(1.05)
    assert processed[0].start_sec == 0.0
    assert processed[1].start_sec == pytest.approx(0.8)


def test_build_aligned_srt_only_track_ends_at_source_end(r, tmp_path):
    write_srt(tmp_path / "input.srt")
    path = write_task(tmp_path, aligned_task())
    task = r.load_task(path)
    result = r.Result(task)
    first = write_tone(tmp_path / "first.wav", 0.8, 48000)
    second = write_tone(tmp_path / "second.wav", 0.5, 48000)
    processed = [
        r.ProcessedSegment(task.segments[0], first, 0.8, 0.8, 24000, 1.0),
        r.ProcessedSegment(task.segments[1], second, 0.5, 0.5, 24000, 1.0),
    ]
    track = r.build_aligned_track(task, processed, result)
    assert track.duration == pytest.approx(3.0)
    assert processed[0].start_sec == pytest.approx(0.5)
    assert processed[0].end_sec == pytest.approx(1.3)
    assert processed[1].start_sec == pytest.approx(2.0)
    assert processed[1].end_sec == pytest.approx(2.5)
