import numpy as np
import pytest

from audio_fit import FitAction, split_long_text
from cache import SegmentCache, segment_cache_key
from engine import EngineOptions, SegmentResult, run_engine
from providers.base import Voice
from srt_parse import Cue
from track_build import read_wav


VOICE = Voice(
    "Serena",
    "Serena",
    "女",
    "温柔",
    "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
    "local",
)


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
    assert np.allclose(master[:24000], 0.0)        # silence before cue 1
    assert np.any(master[24000:48000] != 0.0)      # cue 1 at 1.0-2.0 s
    assert np.allclose(master[48000:72000], 0.0)   # gap 2.0-3.0 s
    assert np.any(master[72000:96000] != 0.0)      # cue 2 at 3.0-4.0 s
    assert np.allclose(master[96000:], 0.0)        # tail


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


def test_spill_into_gap_places_audio_before_next_cue(tmp_path):
    p = FakeProvider(1.5)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0), cue(2, 2.0, 4.0, 10.0)],
        p, None, "", "chinese", 10.0,
        EngineOptions(), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    assert results[0].action is FitAction.SPILL
    assert 1.0 < results[0].final_duration <= 2.0
    assert results[1].action is FitAction.FIT
    assert np.any(master[24000:48000] != 0.0)  # spills into the gap
    assert np.any(master[48000:72000] != 0.0)  # cue 2 still starts at 2.0 s
    assert np.allclose(master[96000:], 0.0)    # nothing after cue 2


def test_clamped_window_relabels_fit_as_truncated(tmp_path):
    # effective_start 被前一条推到 5.0，slot=8 s 但可用窗口只有 1 s；
    # plan_fit 会判 FIT（d=5 <= slot），引擎必须按 available 截断。
    clamped = Cue(1, 2.0, 10.0, "重叠句", 5.0, 6.0)
    master, results = run_engine(
        [clamped], FakeProvider(5.0), None, "", "chinese", 12.0,
        EngineOptions(), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    result = results[0]
    assert result.action is FitAction.TRUNCATED
    assert result.speed == 1.0
    assert result.final_duration <= 1.0
    assert np.allclose(master[: 5 * 24000], 0.0)
    assert np.any(master[5 * 24000: 6 * 24000] != 0.0)
    assert np.allclose(master[6 * 24000:], 0.0)  # never past next_start


def test_retries_once_then_succeeds(tmp_path):
    class Flaky(FakeProvider):
        def synthesize(self, *a, **k):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("transient")
            return np.full(24000, 0.2, dtype=np.float32)

    cache_root = tmp_path / "cache"
    p = Flaky(1.0)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
        EngineOptions(), SegmentCache(root=cache_root),
        progress=lambda _line: None,
    )
    assert p.calls == 2
    assert results[0].failed is False
    assert np.any(master[:24000] != 0.0)
    assert len(list(cache_root.glob("*.wav"))) == 1  # cache written once


def test_fails_twice_then_raises(tmp_path):
    class Broken(FakeProvider):
        def synthesize(self, *a, **k):
            self.calls += 1
            raise RuntimeError("boom")

    p = Broken(1.0)
    with pytest.raises(RuntimeError, match="boom"):
        run_engine([cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
                   EngineOptions(), SegmentCache(root=tmp_path),
                   progress=lambda _line: None)
    assert p.calls == 2


def test_fails_twice_continue_on_error_records_failure(tmp_path):
    class Broken(FakeProvider):
        def synthesize(self, *a, **k):
            self.calls += 1
            raise RuntimeError("boom")

    p = Broken(1.0)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
        EngineOptions(continue_on_error=True), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    assert p.calls == 2
    assert results[0].failed is True
    assert np.allclose(master, 0.0)


def test_nan_audio_is_retried_then_fails(tmp_path):
    class Nan(FakeProvider):
        def synthesize(self, *a, **k):
            self.calls += 1
            pcm = np.full(24000, 0.2, dtype=np.float32)
            pcm[100] = np.nan
            return pcm

    p = Nan(1.0)
    with pytest.raises(ValueError):
        run_engine([cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
                   EngineOptions(), SegmentCache(root=tmp_path),
                   progress=lambda _line: None)
    assert p.calls == 2


def test_invalid_audio_continue_on_error_records_failure(tmp_path):
    class Silent(FakeProvider):
        def synthesize(self, *a, **k):
            self.calls += 1
            return np.zeros(24000, dtype=np.float32)

    p = Silent(1.0)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)], p, None, "", "chinese", 2.0,
        EngineOptions(continue_on_error=True), SegmentCache(root=tmp_path),
        progress=lambda _line: None,
    )
    assert p.calls == 2
    assert results[0].failed is True
    assert np.allclose(master, 0.0)


def test_cache_write_failure_does_not_fail_the_cue(tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("cache directory is read-only")

    monkeypatch.setattr("cache.sf.write", boom)
    master, results = run_engine(
        [cue(1, 0.0, 1.0, 2.0)], FakeProvider(1.0), None, "", "chinese", 2.0,
        EngineOptions(), SegmentCache(root=tmp_path / "cache"),
        progress=lambda _line: None,
    )
    assert results[0].failed is False
    assert np.any(master[:24000] != 0.0)


def test_real_voice_is_used_in_cache_key(tmp_path):
    p = FakeProvider(1.0)
    run_engine([cue(1, 0.0, 1.0, 2.0)], p, VOICE, "", "chinese", 2.0,
               EngineOptions(), SegmentCache(root=tmp_path),
               progress=lambda _line: None)
    key = segment_cache_key(
        "FakeProvider", VOICE.model, VOICE.voice_id, "", "chinese", "第1句"
    )
    assert (tmp_path / f"{key}.wav").is_file()


def test_progress_reports_the_available_window(tmp_path):
    lines = []
    clamped = Cue(1, 2.0, 10.0, "重叠句", 5.0, 6.0)
    run_engine([clamped], FakeProvider(5.0), None, "", "chinese", 12.0,
               EngineOptions(), SegmentCache(root=tmp_path),
               progress=lines.append)
    assert len(lines) == 1
    assert "窗口 8.00s" in lines[0]
    assert "可用 1.00s" in lines[0]


def test_chunk_cache_key_does_not_alias_single_chunk_text(tmp_path):
    long_text = "第一句。" * 80
    chunks = split_long_text(long_text)
    assert len(chunks) == 2

    p = FakeProvider(1.0)
    cache = SegmentCache(root=tmp_path)
    run_engine([Cue(1, 0.0, 10.0, long_text, 0.0, 20.0)], p, None, "",
               "chinese", 20.0, EngineOptions(), cache,
               progress=lambda _line: None)
    calls_after_long = p.calls
    assert calls_after_long == 2

    # 旧实现用 "1:" 拼块序号时，这条单块文本会误命中长文本第 2 块的缓存。
    sneaky = Cue(2, 0.0, 10.0, f"1:{chunks[1]}", 0.0, 20.0)
    run_engine([sneaky], p, None, "", "chinese", 20.0,
               EngineOptions(), cache, progress=lambda _line: None)
    assert p.calls == calls_after_long + 1


class StyleProvider:
    def __init__(self):
        self.calls = []
        self.seconds = 1.0

    def synthesize(self, text, voice, instruct="", lang="chinese", **style):
        self.calls.append(style)
        return np.full(24000, 0.2, dtype=np.float32)


def test_style_options_reach_provider_and_cache_key(tmp_path):
    p = StyleProvider()
    cache = SegmentCache(root=tmp_path)
    c = cue(1, 0.0, 2.0, 3.0)
    run_engine([c], p, None, "", "chinese", 3.0,
               EngineOptions(rate=1.1, volume=80), cache,
               progress=lambda _line: None)
    assert p.calls == [{"rate": 1.1, "volume": 80}]

    # Same style → cache hit; different style → new synthesis.
    run_engine([c], p, None, "", "chinese", 3.0,
               EngineOptions(rate=1.1, volume=80), cache,
               progress=lambda _line: None)
    assert len(p.calls) == 1
    run_engine([c], p, None, "", "chinese", 3.0,
               EngineOptions(rate=1.2, volume=80), cache,
               progress=lambda _line: None)
    assert len(p.calls) == 2
    assert p.calls[1]["rate"] == 1.2
