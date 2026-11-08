import numpy as np
import pytest
from track_build import (
    DEFAULT_SAMPLE_RATE,
    build_track,
    read_wav,
    write_track,
    write_track_files,
    write_wav,
)


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


# --- F07：文件引用拼轨（低内存） ----------------------------------------------


def _write_parts(tmp_path, specs, sample_rate=24000):
    """specs: [(start, pcm)] → 返回文件引用 placements 与 part 路径列表。"""
    parts = tmp_path / "parts"
    parts.mkdir(exist_ok=True)
    placements = []
    for i, (start, pcm) in enumerate(specs):
        path = parts / f"{i:05d}.wav"
        write_wav(path, pcm, sample_rate=sample_rate)
        placements.append((start, path, pcm.size))
    return placements


def test_write_track_files_matches_in_memory_result(tmp_path):
    sr = 24000
    specs = [
        (1.0, np.full(2400, 0.3, dtype=np.float32)),
        (4.5, np.full(1200, -0.2, dtype=np.float32)),
        (8.0, np.full(sr, 0.1, dtype=np.float32)),
    ]
    placements = _write_parts(tmp_path, specs, sr)
    out = tmp_path / "track.wav"
    write_track_files(out, placements, 10.0, sample_rate=sr)

    expected = build_track(10.0, specs, sample_rate=sr)
    got, rate = read_wav(out)
    assert rate == sr
    assert got.size == expected.size
    assert np.allclose(got, expected, atol=1e-6)


def test_write_track_files_zero_gap_allocation_is_bounded(tmp_path, monkeypatch):
    # F07 复现点：空档补零不得一次 zeros(整个空档)——用 spy 观测
    # 单次分配大小的上界必须 ≤ IO_CHUNK_SAMPLES。
    import track_build

    sr = 24000
    specs = [(0.0, np.full(2400, 0.3, dtype=np.float32))]
    placements = _write_parts(tmp_path, specs, sr)
    sizes = []
    original = track_build._zeros

    def spy(size):
        sizes.append(size)
        return original(size)

    monkeypatch.setattr(track_build, "_zeros", spy)
    out = tmp_path / "long.wav"
    # 60s 整片、开头一段语音 → 57.6s 空档 ≈ 138 万样本需补零。
    write_track_files(out, placements, 60.0, sample_rate=sr)
    # 单缓冲复用：无论空档多长，只分配一次、且大小恰为块上限。
    assert sizes == [track_build.IO_CHUNK_SAMPLES]


def test_write_track_files_rejects_overlap_and_bad_count(tmp_path):
    sr = 24000
    pcm = np.full(2400, 0.2, dtype=np.float32)
    placements = _write_parts(
        tmp_path, [(0.0, pcm), (0.05, pcm)], sr
    )
    with pytest.raises(ValueError, match="overlap"):
        write_track_files(
            tmp_path / "t.wav", placements, 2.0, sample_rate=sr
        )

    # part 文件实际样本数与元数据不符 → 拒绝（防止静默错位）。
    single = _write_parts(tmp_path, [(0.0, pcm)], sr)
    single[0] = (0.0, single[0][1], single[0][2] + 100)
    with pytest.raises(ValueError, match="expected"):
        write_track_files(
            tmp_path / "t2.wav", single, 2.0, sample_rate=sr
        )
