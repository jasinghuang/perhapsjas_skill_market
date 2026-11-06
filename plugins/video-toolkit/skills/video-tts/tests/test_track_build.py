import numpy as np
import pytest
from track_build import build_track, read_wav, write_wav


def test_empty_track_has_exact_duration():
    out = build_track(2.0, [])
    assert len(out) == 48000
    assert np.all(out == 0)


def test_places_segment_at_start_offset():
    seg = np.full(2400, 0.5, dtype=np.float32)
    out = build_track(2.0, [(1.0, seg)])
    assert np.all(out[24000:26400] == 0.5)
    assert np.all(out[:24000] == 0)
    assert np.all(out[26400:] == 0)


def test_rejects_out_of_range_segment():
    with pytest.raises(ValueError):
        build_track(1.0, [(0.9, np.zeros(4800, dtype=np.float32))])


def test_rejects_overlapping_segments():
    seg = np.zeros(2400, dtype=np.float32)
    with pytest.raises(ValueError):
        build_track(2.0, [(0.0, seg), (0.05, seg)])


def test_rejects_negative_start():
    with pytest.raises(ValueError):
        build_track(1.0, [(-0.1, np.zeros(2400, dtype=np.float32))])


def test_wav_roundtrip(tmp_path):
    pcm = np.linspace(-0.5, 0.5, 24000).astype(np.float32)
    path = tmp_path / "out.wav"
    write_wav(path, pcm)
    back, sr = read_wav(path)
    assert sr == 24000
    assert len(back) == len(pcm)
    assert np.allclose(back, pcm, atol=1e-4)


def test_write_wav_averages_channels_to_mono(tmp_path):
    stereo = np.stack(
        [np.full(2400, 0.5, dtype=np.float32), np.full(2400, -0.1, dtype=np.float32)],
        axis=1,
    )
    path = tmp_path / "stereo.wav"
    write_wav(path, stereo)
    back, _ = read_wav(path)
    assert back.ndim == 1
    assert np.allclose(back, 0.2, atol=1e-4)
