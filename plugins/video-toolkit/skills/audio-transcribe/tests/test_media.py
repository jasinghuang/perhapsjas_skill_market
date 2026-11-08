import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import media
from media import MediaError, plan_chunks


# --- plan_chunks --------------------------------------------------------------

def test_short_audio_is_single_chunk():
    assert plan_chunks(120.0, []) == [(0.0, 120.0)]


def test_hard_cut_when_no_silences():
    chunks = plan_chunks(1000.0, [])
    assert chunks[0] == (0.0, 290.0)          # hard cap < 5 min aligner limit
    assert all(e - s <= 290.0 for s, e in chunks)
    assert chunks[-1][1] == 1000.0
    # contiguous coverage
    for (s1, e1), (s2, e2) in zip(chunks, chunks[1:]):
        assert e1 == s2


def test_snaps_to_silence_near_target():
    silences = [(240.0, 244.0)]  # midpoint 242
    chunks = plan_chunks(700.0, silences, target=240.0, snap_window=30.0)
    assert chunks[0] == (0.0, 242.0)
    assert all(e - s <= 290.0 for s, e in chunks)


def test_ignores_silence_outside_snap_window():
    silences = [(100.0, 102.0)]  # midpoint 101, far from target 240
    chunks = plan_chunks(700.0, silences, target=240.0, snap_window=30.0)
    assert chunks[0][1] == 290.0  # hard cut, silence not used


def test_min_chunk_respected():
    # silence midpoint only 10s in (below min_chunk) — must not be used
    chunks = plan_chunks(700.0, [(9.0, 11.0)], target=240.0, min_chunk=30.0)
    assert chunks[0][1] >= 30.0


# --- silencedetect parsing ------------------------------------------------------

def _fake_run_factory(stderr=""):
    def fake_run(cmd, timeout=120):
        return SimpleNamespace(returncode=0, stdout="", stderr=stderr)
    return fake_run


def test_detect_silences_parses_pairs(monkeypatch):
    stderr = (
        "[silencedetect @ 0x1] silence_start: 12.345\n"
        "[silencedetect @ 0x1] silence_end: 13.9 | silence_duration: 1.555\n"
        "[silencedetect @ 0x1] silence_start: 200.1\n"
        "[silencedetect @ 0x1] silence_end: 201.0 | silence_duration: 0.9\n"
    )
    monkeypatch.setattr(media, "_run", _fake_run_factory(stderr))
    intervals = media.detect_silences("x.wav")
    assert intervals == [(12.345, 13.9), (200.1, 201.0)]


def test_detect_silences_drops_orphan_start(monkeypatch):
    stderr = "silence_start: 5.0\n(no matching end)\n"
    monkeypatch.setattr(media, "_run", _fake_run_factory(stderr))
    assert media.detect_silences("x.wav") == []


# --- probe_media ----------------------------------------------------------------

FFPROBE_OK = json.dumps({
    "streams": [
        {"codec_type": "video", "index": 0},
        {"codec_type": "audio", "index": 1, "codec_name": "aac", "channels": 2,
         "tags": {"language": "und"}},
    ],
    "format": {"duration": "123.456"},
})


def test_probe_media_happy_path(monkeypatch, tmp_path):
    media_file = tmp_path / "视频 audio.mp4"
    media_file.write_bytes(b"x")
    monkeypatch.setattr(media, "_run", lambda cmd, timeout=120: SimpleNamespace(
        returncode=0, stdout=FFPROBE_OK, stderr=""))
    info = media.probe_media(media_file)
    assert info["duration"] == pytest.approx(123.456)
    assert info["audio_streams"][0]["index"] == 1
    assert info["audio_streams"][0]["channels"] == 2


def test_probe_media_rejects_missing_file(tmp_path):
    with pytest.raises(MediaError, match="not found"):
        media.probe_media(tmp_path / "nope.mp3")


def test_probe_media_rejects_unknown_suffix(tmp_path):
    bad = tmp_path / "file.xyz"
    bad.write_bytes(b"x")
    with pytest.raises(MediaError, match="Unsupported"):
        media.probe_media(bad)


def test_probe_media_rejects_no_audio_track(monkeypatch, tmp_path):
    media_file = tmp_path / "silent.mp4"
    media_file.write_bytes(b"x")
    payload = json.dumps({"streams": [{"codec_type": "video", "index": 0}],
                          "format": {"duration": "10"}})
    monkeypatch.setattr(media, "_run", lambda cmd, timeout=120: SimpleNamespace(
        returncode=0, stdout=payload, stderr=""))
    with pytest.raises(MediaError, match="No audio track"):
        media.probe_media(media_file)


def test_probe_media_rejects_corrupt_file(monkeypatch, tmp_path):
    media_file = tmp_path / "broken.mp4"
    media_file.write_bytes(b"x")
    monkeypatch.setattr(media, "_run", lambda cmd, timeout=120: SimpleNamespace(
        returncode=1, stdout="", stderr="Invalid data"))
    with pytest.raises(MediaError, match="corrupt"):
        media.probe_media(media_file)


def test_extract_chunk_and_wav_use_argument_arrays(monkeypatch, tmp_path):
    """External commands must receive path arrays (Chinese/space-safe), never a joined string."""
    seen = []

    def fake_run(cmd, timeout=120):
        seen.append(cmd)
        Path(cmd[-1]).write_bytes(b"wav")  # pretend ffmpeg wrote the output
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(media, "_run", fake_run)
    src = tmp_path / "视频 文件.mp4"
    src.write_bytes(b"x")
    media.to_wav16k_mono(src, tmp_path / "out.wav")
    media.extract_chunk(tmp_path / "out.wav", 12.5, 30.0, tmp_path / "c.wav")

    assert len(seen) == 2
    for cmd in seen:
        assert isinstance(cmd, list)          # argument array, never a shell string
        assert cmd[0] == "ffmpeg"
    assert str(src) in seen[0]                 # Chinese + spaces pass through intact
    assert any(part == "16000" for part in seen[0])  # 16 kHz mono preprocessing
    wav_cmd = seen[0]
    assert wav_cmd[0] == "ffmpeg"
    assert any(part == "-ar" for part in wav_cmd) and any(part == "16000" for part in wav_cmd)


def test_real_extraction_preserves_delayed_audio_origin(tmp_path):
    import shutil, subprocess, wave, array
    import media
    import pytest
    if not shutil.which('ffmpeg'):
        pytest.skip('ffmpeg unavailable')
    src = tmp_path/'delayed.mkv'
    subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','color=c=black:s=64x64:r=5:d=5',
                    '-itsoffset','2','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=3',
                    '-map','0:v','-map','1:a','-c:v','libx264','-c:a','pcm_s16le',str(src)],check=True,timeout=15)
    wav = media.to_wav16k_mono(src,tmp_path/'selected.wav',stream_index=1)
    with wave.open(str(wav)) as f:
        samples = array.array('h',f.readframes(f.getnframes()))
        first = next(i for i,x in enumerate(samples) if abs(x)>100)/f.getframerate()
    assert 1.99 <= first <= 2.01  # Must not shift the selected audio to video zero.
