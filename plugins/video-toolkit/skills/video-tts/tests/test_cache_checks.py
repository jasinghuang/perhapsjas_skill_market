import numpy as np
import pytest

from audio_checks import validate_pcm
from cache import SegmentCache, segment_cache_key


def test_cache_key_is_stable_and_sensitive_to_text():
    a = segment_cache_key("online", "m", "Cherry", "", "chinese", "你好")
    b = segment_cache_key("online", "m", "Cherry", "", "chinese", "你好")
    c = segment_cache_key("online", "m", "Cherry", "", "chinese", "你好！")
    assert a == b and a != c


def test_cache_key_is_short_hex_and_covers_every_field():
    base = segment_cache_key("online", "m", "Cherry", "", "chinese", "你好")
    assert len(base) == 16
    assert all(char in "0123456789abcdef" for char in base)
    variants = {
        segment_cache_key("local", "m", "Cherry", "", "chinese", "你好"),
        segment_cache_key("online", "other", "Cherry", "", "chinese", "你好"),
        segment_cache_key("online", "m", "Serena", "", "chinese", "你好"),
        segment_cache_key("online", "m", "Cherry", "gentle", "chinese", "你好"),
        segment_cache_key("online", "m", "Cherry", "", "english", "你好"),
        segment_cache_key("online", "m", "Cherry", "", "chinese", "你好。"),
    }
    assert base not in variants
    assert len(variants) == 6


def test_cache_roundtrip(tmp_path):
    cache = SegmentCache(root=tmp_path)
    pcm = np.zeros(24000, dtype=np.float32)
    cache.put("k", pcm)
    assert np.array_equal(cache.get("k"), pcm)
    cache.put("k", pcm, sample_rate=16000)
    assert cache.get("k") is None  # wrong sample rate is not a hit


def test_cache_roundtrip_preserves_float_samples(tmp_path):
    cache = SegmentCache(root=tmp_path)
    pcm = np.linspace(-0.9, 0.9, 24000, dtype=np.float32)
    cache.put("float", pcm)
    cached = cache.get("float")
    assert cached.dtype == np.float32
    assert np.array_equal(cached, pcm)


def test_cache_miss_and_corrupt_file_return_none(tmp_path):
    cache = SegmentCache(root=tmp_path)
    assert cache.get("missing") is None
    (tmp_path / "broken.wav").write_bytes(b"not a wav")
    assert cache.get("broken") is None


def test_disabled_cache_does_not_write_or_read(tmp_path):
    enabled = SegmentCache(root=tmp_path)
    enabled.put("k", np.zeros(24000, dtype=np.float32))
    assert (tmp_path / "k.wav").is_file()

    disabled = SegmentCache(root=tmp_path, enabled=False)
    assert disabled.get("k") is None
    disabled.put("new", np.zeros(24000, dtype=np.float32))
    assert not (tmp_path / "new.wav").exists()


def test_put_is_best_effort_when_write_raises_oserror(tmp_path, monkeypatch):
    cache = SegmentCache(root=tmp_path)

    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("cache.sf.write", boom)
    cache.put("k", np.full(24000, 0.2, dtype=np.float32))
    assert not (tmp_path / "k.wav").exists()
    # 临时文件也要清理掉。
    assert list(tmp_path.glob(".k.*.wav")) == []


def test_default_root_honors_xdg_cache_home(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    cache = SegmentCache()
    assert cache.root == tmp_path / "video-tts" / "segments"


def test_validate_rejects_empty_nan_and_silence():
    with pytest.raises(ValueError):
        validate_pcm(np.array([], dtype=np.float32), 24000)
    bad = np.zeros(24000, dtype=np.float32); bad[0] = np.nan
    with pytest.raises(ValueError):
        validate_pcm(bad, 24000)
    with pytest.raises(ValueError):
        validate_pcm(np.zeros(24000, dtype=np.float32), 24000)


def test_validate_rejects_inf_short_audio_and_faint_audio():
    infinite = np.full(24000, 0.2, dtype=np.float32)
    infinite[0] = np.inf
    with pytest.raises(ValueError):
        validate_pcm(infinite, 24000)
    with pytest.raises(ValueError):
        validate_pcm(np.full(4000, 0.2, dtype=np.float32), 24000)  # 0.167 s
    with pytest.raises(ValueError):
        validate_pcm(np.full(24000, 1e-5, dtype=np.float32), 24000)  # RMS below 1e-4


def test_validate_accepts_loud_enough_audio_and_flattens():
    validate_pcm(np.full((12000, 2), 0.2, dtype=np.float32), 24000)  # 1.0 s after flatten
    validate_pcm(np.full(4800, 0.2, dtype=np.float32), 24000)  # exactly 0.2 s
