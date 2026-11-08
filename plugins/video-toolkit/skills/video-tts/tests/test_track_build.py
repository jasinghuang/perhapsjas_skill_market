import numpy as np
import pytest
from track_build import DEFAULT_SAMPLE_RATE, build_track, read_wav, write_track, write_wav


def test_empty_track_has_exact_duration():
    out = build_track(2.0, [], sample_rate=24000)
    assert len(out) == 48000
    assert np.all(out == 0)


def test_default_sample_rate_is_master_48k():
    out = build_track(1.0, [], sample_rate=DEFAULT_SAMPLE_RATE)
    assert len(out) == 48000


def test_places_segment_at_start_offset():
    seg = np.full(2400, 0.5, dtype=np.float32)
    out = build_track(2.0, [(1.0, seg)], sample_rate=24000)
    assert np.all(out[24000:26400] == 0.5)
    assert np.all(out[:24000] == 0)
    assert np.all(out[26400:] == 0)


def test_rejects_out_of_range_segment():
    with pytest.raises(ValueError):
        build_track(1.0, [(0.9, np.zeros(4800, dtype=np.float32))], sample_rate=24000)


def test_rejects_overlapping_segments():
    seg = np.zeros(2400, dtype=np.float32)
    with pytest.raises(ValueError):
        build_track(2.0, [(0.0, seg), (0.05, seg)], sample_rate=24000)


def test_rejects_negative_start():
    with pytest.raises(ValueError):
        build_track(1.0, [(-0.1, np.zeros(2400, dtype=np.float32))], sample_rate=24000)


def test_wav_roundtrip(tmp_path):
    pcm = np.linspace(-0.5, 0.5, 24000).astype(np.float32)
    path = tmp_path / "out.wav"
    write_wav(path, pcm, sample_rate=24000)
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
    write_wav(path, stereo, sample_rate=24000)
    back, _ = read_wav(path)
    assert back.ndim == 1
    assert np.allclose(back, 0.2, atol=1e-4)


# --- write_track：流式写轨 + 原子替换 ---------------------------------------


def test_write_track_matches_build_track(tmp_path):
    seg_a = np.full(4800, 0.3, dtype=np.float32)     # 0.1s @48k
    seg_b = np.full(9600, -0.3, dtype=np.float32)    # 0.2s @48k
    path = tmp_path / "track.wav"
    write_track(path, [(0.10, seg_a), (0.40, seg_b)], 1.0, 48000)
    expected = build_track(1.0, [(0.10, seg_a), (0.40, seg_b)], sample_rate=48000)
    back, rate = read_wav(path)
    assert rate == 48000
    assert np.array_equal(back, expected)


def test_write_track_rejects_overlap_without_touching_target(tmp_path):
    path = tmp_path / "track.wav"
    write_wav(path, np.zeros(100, dtype=np.float32), 48000)  # 已有内容
    original = path.read_bytes()
    seg = np.zeros(4800, dtype=np.float32)
    with pytest.raises(ValueError, match="overlaps"):
        write_track(path, [(0.0, seg), (0.05, seg)], 1.0, 48000)
    assert path.read_bytes() == original  # 校验失败不破坏已有文件
    assert list(tmp_path.glob(".track.wav.*")) == []  # 临时文件已清理


def test_write_track_pads_head_and_tail(tmp_path):
    seg = np.full(4800, 0.5, dtype=np.float32)
    path = tmp_path / "track.wav"
    write_track(path, [(0.25, seg)], 1.0, 48000)
    back, _ = read_wav(path)
    assert back.size == 48000
    assert np.all(back[:12000] == 0)
    assert np.all(back[12000:16800] == 0.5)
    assert np.all(back[16800:] == 0)
