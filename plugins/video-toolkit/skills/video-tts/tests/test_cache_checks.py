import numpy as np
import pytest

from audio_checks import validate_pcm
from cache import SegmentCache, file_sha256, stable_cache_key


def _material(**overrides):
    base = {
        "provider": "online",
        "model": "m",
        "voice": {"voice_id": "Cherry"},
        "instruct": "",
        "lang": "chinese",
        "text": {"chunk_index": 0, "chunk_count": 1, "text": "你好"},
        "style": {},
    }
    base.update(overrides)
    return base


def test_cache_key_is_stable_and_sensitive_to_text():
    a = stable_cache_key(_material())
    b = stable_cache_key(_material())
    c = stable_cache_key(_material(text={"chunk_index": 0, "chunk_count": 1, "text": "你好！"}))
    assert a == b and a != c


def test_cache_key_is_hex_and_covers_key_fields():
    base = stable_cache_key(_material())
    assert len(base) == 24
    assert all(char in "0123456789abcdef" for char in base)
    variants = {
        stable_cache_key(_material(provider="local")),
        stable_cache_key(_material(model="other")),
        stable_cache_key(_material(voice={"voice_id": "Serena"})),
        stable_cache_key(_material(instruct="gentle")),
        stable_cache_key(_material(lang="english")),
        stable_cache_key(_material(style={"rate": 1.1})),
    }
    assert base not in variants
    assert len(variants) == 6
    # dict 构造顺序不影响键（结构化序列化）。
    assert stable_cache_key(dict(reversed(list(_material().items())))) == base


def test_ref_content_hash_changes_key_not_path():
    no_ref = stable_cache_key(_material())
    ref_a = stable_cache_key(_material(ref={"audio_sha256": "aaa", "ref_text": "x"}))
    ref_b = stable_cache_key(_material(ref={"audio_sha256": "bbb", "ref_text": "x"}))
    assert len({no_ref, ref_a, ref_b}) == 3


def test_file_sha256_depends_on_content(tmp_path):
    a = tmp_path / "a.wav"
    a.write_bytes(b"same")
    b = tmp_path / "moved.wav"
    b.write_bytes(b"same")
    c = tmp_path / "a.wav"  # 同路径、内容将被覆盖
    assert file_sha256(a) == file_sha256(b)
    c.write_bytes(b"different")
    assert file_sha256(a) != file_sha256(b)


def test_cache_roundtrip_preserves_native_rate(tmp_path):
    cache = SegmentCache(root=tmp_path)
    pcm = np.full(24000, 0.2, dtype=np.float32)
    cache.put("k", pcm, 24000)
    got = cache.get("k")
    assert got is not None
    samples, rate = got
    assert rate == 24000  # 采样率来自 WAV 元数据，不是固定常量
    assert np.array_equal(samples, pcm)

    cache.put("k48", np.full(48000, 0.2, dtype=np.float32), 48000)
    samples48, rate48 = cache.get("k48")
    assert rate48 == 48000 and samples48.size == 48000


def test_cache_roundtrip_preserves_float_samples(tmp_path):
    cache = SegmentCache(root=tmp_path)
    pcm = np.linspace(-0.9, 0.9, 24000, dtype=np.float32)
    cache.put("float", pcm, 24000)
    samples, rate = cache.get("float")
    assert samples.dtype == np.float32
    assert np.array_equal(samples, pcm)


def test_cache_miss_and_corrupt_file_return_none(tmp_path):
    cache = SegmentCache(root=tmp_path)
    assert cache.get("missing") is None
    (tmp_path / "v2-broken.wav").write_bytes(b"not a wav")
    assert cache.get("broken") is None


def test_v1_cache_files_do_not_collide_with_v2(tmp_path):
    cache = SegmentCache(root=tmp_path)
    cache.put("k", np.full(2400, 0.2, dtype=np.float32), 24000)
    # v1 的裸 key 文件名不会被 v2 读取，也不会被覆盖。
    legacy = tmp_path / "k.wav"
    legacy.write_bytes(b"legacy")
    cache.put("k", np.full(2400, 0.2, dtype=np.float32), 24000)
    assert legacy.read_bytes() == b"legacy"
    assert (tmp_path / "v2-k.wav").is_file()


def test_disabled_cache_does_not_write_or_read(tmp_path):
    enabled = SegmentCache(root=tmp_path)
    enabled.put("k", np.zeros(2400, dtype=np.float32), 24000)
    assert (tmp_path / "v2-k.wav").is_file()

    disabled = SegmentCache(root=tmp_path, enabled=False)
    assert disabled.get("k") is None
    disabled.put("new", np.zeros(2400, dtype=np.float32), 24000)
    assert not (tmp_path / "v2-new.wav").exists()


def test_put_is_best_effort_when_write_raises_oserror(tmp_path, monkeypatch):
    cache = SegmentCache(root=tmp_path)

    def boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("cache.sf.write", boom)
    cache.put("k", np.full(2400, 0.2, dtype=np.float32), 24000)
    assert not (tmp_path / "v2-k.wav").exists()
    # 临时文件也要清理掉。
    assert list(tmp_path.glob(".v2-k.*.wav")) == []


def test_put_rejects_multichannel_input(tmp_path):
    cache = SegmentCache(root=tmp_path)
    with pytest.raises(ValueError):
        cache.put("stereo", np.zeros((10, 2), dtype=np.float32), 24000)


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
