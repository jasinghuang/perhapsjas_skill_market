from __future__ import annotations

import subprocess

import pytest

from helpers import write_tone


def make_video(r, path, duration=2.0):
    subprocess.run(
        [
            r.FFMPEG,
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size=160x120:rate=24:duration={duration}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=48000:duration={duration}",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
    )
    return path


def test_probe_video(r, tmp_path):
    video = make_video(r, tmp_path / "input.mp4", 2.0)
    info = r.probe_video(video)
    assert info["duration"] == pytest.approx(2.0, abs=0.1)
    assert info["codec_name"] == "h264"


def test_mux_replaces_original_audio(r, tmp_path):
    video = make_video(r, tmp_path / "input.mp4", 2.0)
    track = write_tone(tmp_path / "track.wav", 2.0, 48000)
    info = r.probe_video(video)
    target = tmp_path / "out.mp4"
    warnings = r.mux_video(video, track, target, info)
    assert target.is_file()
    probe = r.ffprobe_json(target)
    videos = [s for s in probe["streams"] if s["codec_type"] == "video"]
    audios = [s for s in probe["streams"] if s["codec_type"] == "audio"]
    assert len(videos) == 1 and len(audios) == 1
    assert audios[0]["codec_name"] == "aac"
    assert not warnings


def test_mux_accepts_padded_track(r, tmp_path):
    video = make_video(r, tmp_path / "input.mp4", 2.0)
    short = write_tone(tmp_path / "short.wav", 0.5, 48000)
    padded = tmp_path / "padded.wav"
    r.pad_track(short, padded, 2.0, 48000)
    info = r.probe_video(video)
    target = tmp_path / "padded.mp4"
    r.mux_video(video, padded, target, info)
    audio = [
        s for s in r.ffprobe_json(target)["streams"] if s["codec_type"] == "audio"
    ][0]
    assert float(audio["duration"]) == pytest.approx(2.0, abs=0.1)


def test_verify_mux_detects_wrong_duration(r, tmp_path):
    video = make_video(r, tmp_path / "input.mp4", 2.0)
    track = write_tone(tmp_path / "track.wav", 2.0, 48000)
    target = tmp_path / "out.mp4"
    r.mux_video(video, track, target, r.probe_video(video))
    with pytest.raises(r.RunnerError, match="differs"):
        r.verify_mux(target, 3.0)
