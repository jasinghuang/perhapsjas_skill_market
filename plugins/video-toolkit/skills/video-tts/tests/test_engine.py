import numpy as np
import pytest

from audio_fit import FitAction
from cache import SegmentCache, segment_cache_key
from engine import EngineOptions, SegmentResult, run_engine
from srt_parse import Cue
from track_build import read_wav


class FakeProvider:
    def __init__(self, seconds):
        self.seconds = seconds
        self.calls = 0

    def synthesize(self, text, voice, instruct="", lang="chinese"):
        self.calls += 1
        return np.full(int(24000 * self.seconds), 0.2, dtype=np.float32)


def cue(i, start, end, nxt):
    return Cue(i, start, end, f"第{i}句", start, nxt)


def test_places_cues_at_timecodes(tmp_path):
    p = FakeProvider(1.0)
    master, results = run_engine(
        [cue(1, 1.0, 2.0, 3.0), cue(2, 3.0, 4.0, 10.0)],
        p, voice=None, instruct="", lang="chinese", total_duration=5.0,
        options=EngineOptions(), cache=SegmentCache(root=tmp_path),
    )
    assert len(master) == 120000
    assert results[0].speed == 1.0
    assert results[0].action is FitAction.FIT


def test_truncates_and_never_overlaps(tmp_path):
    p = FakeProvider(5.0)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)],
        p, voice=None, instruct="", lang="chinese", total_duration=2.0,
        options=EngineOptions(max_speed=1.3), cache=SegmentCache(root=tmp_path),
    )
    assert results[0].action is FitAction.TRUNCATED
    assert results[0].final_duration <= 2.0


def test_invalid_audio_fails_run(tmp_path):
    class Silent(FakeProvider):
        def synthesize(self, *a, **k):
            return np.zeros(24000, dtype=np.float32)

    with pytest.raises(ValueError):
        run_engine([cue(1, 0.0, 2.0, 3.0)], Silent(1.0), None, "", "chinese", 3.0,
                   EngineOptions(), SegmentCache(root=tmp_path))


def test_cache_hit_skips_provider(tmp_path):
    p = FakeProvider(1.0)
    run_engine([cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
               EngineOptions(), SegmentCache(root=tmp_path))
    calls_after_first = p.calls
    run_engine([cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
               EngineOptions(), SegmentCache(root=tmp_path))
    assert p.calls == calls_after_first


def test_cache_key_normalizes_missing_voice(tmp_path):
    p = FakeProvider(1.0)
    run_engine([cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
               EngineOptions(), SegmentCache(root=tmp_path))
    key = segment_cache_key("FakeProvider", "unknown", "", "", "chinese", "第1句")
    assert (tmp_path / f"{key}.wav").is_file()


def test_invalid_audio_is_never_cached(tmp_path):
    class Silent(FakeProvider):
        def synthesize(self, *a, **k):
            return np.zeros(24000, dtype=np.float32)

    cache_root = tmp_path / "cache"
    with pytest.raises(ValueError):
        run_engine([cue(1, 0.0, 2.0, 3.0)], Silent(1.0), None, "", "chinese", 3.0,
                   EngineOptions(), SegmentCache(root=cache_root))
    assert not list(cache_root.glob("*.wav"))


def test_no_window_fails_unless_continue_on_error(tmp_path):
    no_window = cue(1, 2.0, 3.0, 2.0)  # next_start == effective_start
    with pytest.raises(ValueError):
        run_engine([no_window], FakeProvider(1.0), None, "", "chinese", 3.0,
                   EngineOptions(), SegmentCache(root=tmp_path),
                   progress=lambda _line: None)

    master, results = run_engine(
        [no_window], FakeProvider(1.0), None, "", "chinese", 3.0,
        EngineOptions(continue_on_error=True), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    assert len(master) == 72000
    assert len(results) == 1
    assert isinstance(results[0], SegmentResult)
    assert results[0].failed is True
    assert results[0].action is FitAction.NO_WINDOW


def test_continue_on_error_records_synthesis_failure(tmp_path):
    class Exploding(FakeProvider):
        def synthesize(self, *a, **k):
            raise RuntimeError("provider boom")

    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)], Exploding(1.0), None, "", "chinese", 2.0,
        EngineOptions(continue_on_error=True), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    assert results[0].failed is True
    assert "provider boom" in (results[0].warning or "")
    assert np.allclose(master, 0.0)


def test_keep_segments_writes_final_wav(tmp_path):
    seg_dir = tmp_path / "segments"
    _, results = run_engine(
        [cue(7, 0.0, 1.0, 2.0)], FakeProvider(1.0), None, "", "chinese", 2.0,
        EngineOptions(keep_segments=True, segments_dir=seg_dir),
        SegmentCache(root=tmp_path / "cache"),
        progress=lambda _line: None,
    )
    out = seg_dir / "7.wav"
    assert out.is_file()
    pcm, sample_rate = read_wav(out)
    assert sample_rate == 24000
    assert len(pcm) == pytest.approx(results[0].final_duration * sample_rate, abs=1)


def test_no_cache_always_synthesizes(tmp_path):
    p = FakeProvider(1.0)
    for _ in range(2):
        run_engine([cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
                   EngineOptions(no_cache=True), SegmentCache(root=tmp_path),
                   progress=lambda _line: None)
    assert p.calls == 2


def test_long_text_is_split_and_cached_per_chunk(tmp_path):
    long_cue = Cue(1, 0.0, 10.0, "第一句。" * 80, 0.0, 20.0)
    p = FakeProvider(1.0)
    run_engine([long_cue], p, None, "", "chinese", 20.0,
               EngineOptions(), SegmentCache(root=tmp_path),
               progress=lambda _line: None)
    assert p.calls > 1
    calls_after_first = p.calls
    run_engine([long_cue], p, None, "", "chinese", 20.0,
               EngineOptions(), SegmentCache(root=tmp_path),
               progress=lambda _line: None)
    assert p.calls == calls_after_first


def test_truncated_tail_is_faded(tmp_path):
    p = FakeProvider(5.0)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
        EngineOptions(), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    assert results[0].action is FitAction.TRUNCATED
    assert abs(float(master[-1])) < 0.01
