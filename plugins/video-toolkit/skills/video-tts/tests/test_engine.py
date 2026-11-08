import numpy as np
import pytest

from audio_fit import FitAction, split_long_text
from cache import SegmentCache
from engine import EngineAbort, EngineOptions, SegmentResult, run_engine
from providers.base import SynthesisResult, Voice
from providers.errors import (
    FATAL,
    RETRYABLE,
    SUBMISSION_UNKNOWN,
    SynthesisError,
)
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


def _pcm(seconds, sample_rate=24000, level=0.2):
    return np.full(int(sample_rate * seconds), level, dtype=np.float32)


class FakeProvider:
    """返回固定时长、可指定原生采样率的假 provider。"""

    def __init__(self, seconds, sample_rate=24000):
        self.seconds = seconds
        self.sample_rate = sample_rate
        self.calls = 0

    def describe(self):
        return {"provider": "FakeProvider", "model": "test-model"}

    def synthesize(self, text, voice, instruct="", lang="chinese", **style):
        self.calls += 1
        return SynthesisResult(
            audio=_pcm(self.seconds, self.sample_rate),
            sample_rate=self.sample_rate,
            channels=1,
            provider="FakeProvider",
            model_id="test-model",
        )


def cue(i, start, end, nxt):
    return Cue(i, start, end, f"第{i}句", start, nxt)


def _run(cues, provider, tmp_path, *, total=None, options=None, voice=None):
    """跑一次引擎并把整轨读回来（多数测试用 24k master，避免依赖 ffmpeg）。"""
    opts = options or EngineOptions(master_sample_rate=24000, retry_delays=(0, 0))
    track = tmp_path / "track.wav"
    total = total if total is not None else max(c.next_start for c in cues)
    results = run_engine(
        cues, provider, voice=voice, instruct="", lang="chinese",
        total_duration=total, options=opts,
        cache=SegmentCache(root=tmp_path / "cache"),
        track_path=track,
        progress=lambda _line: None,
    )
    master, rate = read_wav(track)
    assert rate == opts.master_sample_rate
    return master, results


# --- 基本放置与采样率 ---------------------------------------------------------


def test_places_cues_at_timecodes(tmp_path):
    master, results = _run(
        [cue(1, 1.0, 2.0, 3.0), cue(2, 3.0, 4.0, 10.0)], FakeProvider(1.0), tmp_path,
    )
    assert len(master) == 24000 * 10
    assert results[0].speed == 1.0
    assert results[0].action is FitAction.FIT
    assert np.allclose(master[:24000], 0.0)
    assert np.any(master[24000:48000] != 0.0)
    assert np.allclose(master[48000:72000], 0.0)
    assert np.any(master[72000:96000] != 0.0)


def test_natural_mode_uses_original_speed_when_gap_is_enough(tmp_path):
    # T09 / F04：合成 5s、槽位 3s、可用 10s → 必须 1.0 倍速，不丢字不越界。
    master, results = _run(
        [cue(1, 0.0, 3.0, 10.0)], FakeProvider(5.0), tmp_path,
    )
    assert results[0].speed == 1.0
    assert results[0].action is FitAction.FIT
    assert results[0].final_duration == pytest.approx(5.0, abs=0.01)
    assert np.any(master != 0.0)


def test_default_master_rate_is_48k_and_native_24k_is_resampled(tmp_path):
    # T13：24kHz 1s → 48kHz 输出约 48000 样本，时长不变（需要 ffmpeg）。
    pytest.importorskip("soundfile")
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")
    track = tmp_path / "track.wav"
    run_engine(
        [cue(1, 0.0, 3.0, 10.0)], FakeProvider(1.0, sample_rate=24000),
        voice=None, instruct="", lang="chinese", total_duration=10.0,
        options=EngineOptions(retry_delays=(0, 0)),  # 默认 master 48000
        cache=SegmentCache(root=tmp_path / "cache"),
        track_path=track, progress=lambda _line: None,
    )
    master, rate = read_wav(track)
    assert rate == 48000
    voiced = master[master != 0]
    assert voiced.size == pytest.approx(48000, abs=960)  # 时长 ~1s @48k


def test_48k_provider_passes_through_untouched(tmp_path):
    # T14：原生 48kHz provider 直接通过，不因不是 24kHz 被拒绝。
    master, results = _run(
        [cue(1, 0.0, 3.0, 10.0)], FakeProvider(1.0, sample_rate=48000), tmp_path,
        options=EngineOptions(master_sample_rate=48000, retry_delays=(0, 0)),
    )
    assert results[0].native_sample_rate == 48000
    assert results[0].action is FitAction.FIT


def test_stereo_provider_is_downmixed_not_flattened(tmp_path):
    # T15：双声道下混；时长不翻倍。
    class Stereo(FakeProvider):
        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            self.calls += 1
            left = _pcm(1.0, 24000, 0.2)
            audio = np.stack([left, left * 0.5], axis=1)
            return SynthesisResult(
                audio=audio, sample_rate=24000, channels=2,
                provider="Stereo", model_id="test-model",
            )

    master, results = _run([cue(1, 0.0, 2.0, 3.0)], Stereo(1.0), tmp_path)
    assert results[0].synth_duration == pytest.approx(1.0, abs=0.01)
    assert results[0].action is FitAction.FIT


def test_mixed_native_rates_place_correctly(tmp_path):
    # T16：混合原生采样率的片段在主轨上时间位置正确。
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")
    providers_by_text = {"第1句": FakeProvider(1.0, 24000), "第2句": FakeProvider(1.0, 48000)}

    class Mixed:
        def describe(self):
            return {"provider": "Mixed", "model": "m"}

        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            provider = providers_by_text[text]
            return provider.synthesize(text, voice, instruct, lang, **style)

    track = tmp_path / "track.wav"
    results = run_engine(
        [cue(1, 0.0, 1.0, 2.0), cue(2, 2.0, 3.0, 6.0)], Mixed(),
        voice=None, instruct="", lang="chinese", total_duration=6.0,
        options=EngineOptions(master_sample_rate=48000, retry_delays=(0, 0)),
        cache=SegmentCache(root=tmp_path / "cache"),
        track_path=track, progress=lambda _line: None,
    )
    master, rate = read_wav(track)
    assert rate == 48000
    assert results[0].native_sample_rate == 24000
    assert results[1].native_sample_rate == 48000
    assert np.any(master[:48000] != 0.0)          # 0-1s
    assert np.allclose(master[48000:96000], 0.0)  # 1-2s 静音
    assert np.any(master[96000:144000] != 0.0)    # 2-3s
    assert np.allclose(master[144000:], 0.0)


# --- overflow：默认 error，显式 truncate --------------------------------------


def _overflow_cue():
    return [cue(1, 0.0, 1.0, 2.0)]  # natural window 1.9s < 5s 合成


def test_overflow_default_policy_aborts_without_truncating(tmp_path):
    # T11：超过 max_speed 且未允许裁剪 → 保存完整音频（缓存），任务非成功。
    cache_root = tmp_path / "cache"
    track = tmp_path / "track.wav"
    with pytest.raises(EngineAbort):
        run_engine(
            _overflow_cue(), FakeProvider(5.0), voice=None, instruct="",
            lang="chinese", total_duration=2.0,
            options=EngineOptions(master_sample_rate=24000, retry_delays=(0, 0)),
            cache=SegmentCache(root=cache_root), track_path=track,
            progress=lambda _line: None,
        )
    # 原生音频已保存（可 resume），但不写伪完整音轨。
    assert list(cache_root.glob("v2-*.wav"))
    assert not track.exists()


def test_overflow_abort_result_records_gap_and_status(tmp_path):
    track = tmp_path / "track.wav"
    results = None
    try:
        run_engine(
            _overflow_cue(), FakeProvider(5.0), voice=None, instruct="",
            lang="chinese", total_duration=2.0,
            options=EngineOptions(master_sample_rate=24000, retry_delays=(0, 0)),
            cache=SegmentCache(root=tmp_path / "cache"), track_path=track,
            progress=lambda _line: None,
        )
    except EngineAbort as abort:
        results = abort.results
    assert results is not None
    assert results[0].status == "needs_attention"
    assert results[0].action is FitAction.OVERFLOW
    # 5s / 1.3x = 3.85s 还差 1.9s 窗口 → gap ≈ 1.95s
    assert results[0].overflow_gap == pytest.approx(5.0 / 1.3 - 1.9, abs=0.05)
    assert results[0].failed is True


def test_overflow_explicit_truncate_records_cut(tmp_path):
    # T12：显式 truncate → 裁剪 + 淡出 + 记录秒数；不再当普通成功。
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")
    master, results = _run(
        _overflow_cue(), FakeProvider(5.0), tmp_path, total=2.0,
        options=EngineOptions(
            master_sample_rate=24000, overflow_policy="truncate",
            retry_delays=(0, 0),
        ),
    )
    result = results[0]
    assert result.action is FitAction.TRUNCATED
    assert result.truncated_seconds > 0.5  # 5/1.3≈3.85s 放进 1.9s，裁掉 ~1.95s
    assert result.final_duration <= 1.9 + 0.001
    assert abs(float(master[-1])) < 0.01   # 淡出


def test_strict_slot_uses_cue_end_as_hard_boundary(tmp_path):
    # T10：strict_slot 不借空档；5s 合成、槽位 3s、空档 10s → 仍 overflow。
    track = tmp_path / "track.wav"
    results = None
    try:
        run_engine(
            [cue(1, 0.0, 3.0, 10.0)], FakeProvider(5.0), voice=None, instruct="",
            lang="chinese", total_duration=10.0,
            options=EngineOptions(
                master_sample_rate=24000, timing_mode="strict_slot",
                retry_delays=(0, 0),
            ),
            cache=SegmentCache(root=tmp_path / "cache"), track_path=track,
            progress=lambda _line: None,
        )
    except EngineAbort as abort:
        results = abort.results
    assert results is not None
    assert results[0].status == "needs_attention"


def test_strict_slot_compresses_within_slot_when_possible(tmp_path):
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")
    master, results = _run(
        [cue(1, 0.0, 3.0, 10.0)], FakeProvider(3.3), tmp_path, total=10.0,
        options=EngineOptions(
            master_sample_rate=24000, timing_mode="strict_slot",
            retry_delays=(0, 0),
        ),
    )
    assert results[0].action is FitAction.ACCELERATED
    assert results[0].speed == pytest.approx(1.1, abs=0.02)
    assert results[0].final_duration <= 3.0 + 0.001


# --- 统一重试调度（spec §10 / T05-T08） ---------------------------------------


class FlakyProvider(FakeProvider):
    def __init__(self, seconds, failures, kind=RETRYABLE):
        super().__init__(seconds)
        self.failures = failures
        self.kind = kind

    def synthesize(self, text, voice, instruct="", lang="chinese", **style):
        # calls 由 FakeProvider 在成功路径递增；失败在这里补计数。
        if self.calls < self.failures:
            self.calls += 1
            raise SynthesisError(f"transient {self.calls}", kind=self.kind)
        return super().synthesize(text, voice, instruct, lang, **style)


def test_retryable_failures_retry_within_total_budget(tmp_path):
    # T05：明确可安全重试的失败共 3 次预算内成功；provider 不再内部重试。
    p = FlakyProvider(1.0, failures=2)
    master, results = _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    assert p.calls == 3
    assert results[0].failed is False
    assert results[0].attempts == 3
    assert np.any(master != 0.0)


def test_retryable_budget_exhaustion_fails_after_three_submissions(tmp_path):
    class Always500(FakeProvider):
        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            self.calls += 1
            raise SynthesisError("http 500", kind=RETRYABLE)

    p = Always500(1.0)
    with pytest.raises(EngineAbort):
        _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    assert p.calls == 3  # 总提交 = max_attempts，绝不 3×2 嵌套


def test_fatal_error_aborts_immediately_even_with_continue_on_error(tmp_path):
    # T08：401/额度类不重试、不继续、不自动切 provider。
    p = FlakyProvider(1.0, failures=99, kind=FATAL)
    with pytest.raises(EngineAbort) as excinfo:
        _run(
            [cue(1, 0.0, 2.0, 3.0), cue(2, 3.0, 4.0, 6.0)], p, tmp_path,
            options=EngineOptions(
                master_sample_rate=24000, continue_on_error=True,
                retry_delays=(0, 0),
            ),
        )
    assert p.calls == 1
    assert excinfo.value.results[0].error_kind == FATAL


def test_submission_unknown_aborts_without_resubmitting(tmp_path):
    # T07：提交后状态不明 → 不自动重提。
    p = FlakyProvider(1.0, failures=99, kind=SUBMISSION_UNKNOWN)
    with pytest.raises(EngineAbort) as excinfo:
        _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    assert p.calls == 1
    assert excinfo.value.results[0].status == "submission_unknown"


class DownloadFailProvider(FakeProvider):
    """合成提交成功一次，随后下载持续失败（F02 / A06 复现）。"""

    def __init__(self, seconds):
        super().__init__(seconds)
        self.submissions = 0
        self.downloads = 0

    def synthesize(self, text, voice, instruct="", lang="chinese", **style):
        self.submissions += 1
        self.calls += 1
        raise SynthesisError(
            "failed to download synthesized audio after 3 attempts",
            kind="download_failed",
            audio_url="https://example.test/a.wav",
            request_id="req-42",
        )

    def download(self, audio_url, voice=None, request_id=None):
        self.downloads += 1
        return SynthesisResult(
            audio=_pcm(self.seconds), sample_rate=24000, channels=1,
            provider="DownloadFailProvider", model_id="m",
            request_id=request_id,
        )


def _run_raw(cues, provider, tmp_path, **kwargs):
    """带 receipts / 回调直接跑引擎（不读回整轨）。"""
    opts = EngineOptions(master_sample_rate=24000, retry_delays=(0, 0))
    return run_engine(
        cues, provider, voice=None, instruct="", lang="chinese",
        total_duration=max(c.next_start for c in cues), options=opts,
        cache=SegmentCache(root=tmp_path / "cache"),
        track_path=tmp_path / "track.wav",
        progress=lambda _line: None, **kwargs,
    )


def test_download_failure_aborts_after_single_submission(tmp_path):
    # F02 复现：合成已成功、下载耗尽 → 绝不重新提交合成（原来会被当成
    # retryable 再 POST 两次，重复计费）。
    p = DownloadFailProvider(1.0)
    with pytest.raises(EngineAbort) as excinfo:
        _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    assert p.submissions == 1          # 只提交一次（F02 的核心断言）
    result = excinfo.value.results[0]
    assert result.status == "download_failed"
    assert result.audio_url == "https://example.test/a.wav"
    assert result.request_id == "req-42"


def test_download_receipt_resume_downloads_without_resubmitting(tmp_path):
    # F02 恢复：带上次收据 → 只下载，不发生新的合成提交；下载成功后
    # 正常完成整轨，结果标记 downloaded。
    p = DownloadFailProvider(1.0)
    cues = [cue(1, 0.0, 2.0, 3.0)]
    results = _run_raw(
        cues, p, tmp_path,
        receipts={0: {
            "audio_url": "https://example.test/a.wav",
            "request_id": "req-42",
        }},
    )
    assert p.submissions == 0          # 没有新提交
    assert p.downloads == 1            # 只按收据下载
    assert results[0].failed is False
    assert results[0].downloaded is True
    assert results[0].attempts == 0


def test_download_receipt_failure_keeps_download_failed(tmp_path):
    # 收据下载再次失败 → 仍是 download_failed（收据保留，可再次恢复），
    # 不升级成重新合成。
    class StillFailing(DownloadFailProvider):
        def download(self, audio_url, voice=None, request_id=None):
            self.downloads += 1
            raise SynthesisError(
                "failed to download synthesized audio after 3 attempts",
                kind="download_failed",
                audio_url=audio_url,
                request_id=request_id,
            )

    p = StillFailing(1.0)
    with pytest.raises(EngineAbort) as excinfo:
        _run_raw(
            [cue(1, 0.0, 2.0, 3.0)], p, tmp_path,
            receipts={0: {
                "audio_url": "https://example.test/a.wav",
                "request_id": "req-42",
            }},
        )
    assert p.submissions == 0
    assert p.downloads == 1
    assert excinfo.value.results[0].status == "download_failed"


def test_on_result_callback_fires_per_group(tmp_path):
    # F04：逐组结果落定立即回调（不等引擎结束），供 manifest 原子落盘。
    p = FakeProvider(1.0)
    seen = []
    _run_raw(
        [cue(1, 0.0, 2.0, 3.0), cue(2, 3.0, 4.0, 6.0)], p, tmp_path,
        on_result=lambda pos, result: seen.append((pos, result.status)),
    )
    assert seen == [(0, "ok"), (1, "ok")]


def test_on_submit_callback_fires_before_first_submission(tmp_path):
    # A09：提交前落 submitting 标记；缓存命中的组不应触发（没有新提交）。
    p = FakeProvider(1.0)
    submitted = []
    cues = [cue(1, 0.0, 2.0, 3.0)]
    _run_raw(cues, p, tmp_path, on_submit=submitted.append)
    assert submitted == [0]
    # 第二次运行全命中缓存 → 无新提交。
    _run_raw(cues, p, tmp_path, on_submit=submitted.append)
    assert submitted == [0]


def test_invalid_output_retries_within_budget_then_fails(tmp_path):
    class Nan(FakeProvider):
        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            self.calls += 1
            pcm = _pcm(1.0)
            pcm[100] = np.nan
            return SynthesisResult(
                audio=pcm, sample_rate=24000, channels=1,
                provider="Nan", model_id="m",
            )

    p = Nan(1.0)
    with pytest.raises(EngineAbort):
        _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    assert p.calls == 3
    assert not list((tmp_path / "cache").glob("v2-*.wav"))  # 坏结果不进缓存


def test_continue_on_error_records_failure_and_writes_partial_track(tmp_path):
    class Exploding(FakeProvider):
        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            self.calls += 1
            raise SynthesisError("boom", kind=RETRYABLE)

    master, results = _run(
        [cue(1, 0.0, 1.0, 2.0)], Exploding(1.0), tmp_path,
        options=EngineOptions(
            master_sample_rate=24000, continue_on_error=True,
            retry_delays=(0, 0),
        ),
    )
    assert results[0].failed is True
    assert np.allclose(master, 0.0)


def test_no_window_fails_unless_continue_on_error(tmp_path):
    no_window = cue(1, 2.0, 3.0, 2.0)
    with pytest.raises(EngineAbort):
        _run([no_window], FakeProvider(1.0), tmp_path)

    master, results = _run(
        [no_window], FakeProvider(1.0), tmp_path,
        options=EngineOptions(
            master_sample_rate=24000, continue_on_error=True, retry_delays=(0, 0),
        ),
    )
    assert len(results) == 1
    assert isinstance(results[0], SegmentResult)
    assert results[0].failed is True
    assert results[0].action is FitAction.NO_WINDOW


# --- 缓存（v2） ---------------------------------------------------------------


def test_cache_hit_skips_provider(tmp_path):
    p = FakeProvider(1.0)
    _run([cue(1, 0.0, 1.0, 2.0)], p, tmp_path)
    calls_after_first = p.calls
    master, results = _run([cue(1, 0.0, 1.0, 2.0)], p, tmp_path)
    assert p.calls == calls_after_first
    assert results[0].cache_hits == 1
    assert np.any(master != 0.0)


def test_no_cache_always_synthesizes(tmp_path):
    p = FakeProvider(1.0)
    for _ in range(2):
        _run(
            [cue(1, 0.0, 1.0, 2.0)], p, tmp_path,
            options=EngineOptions(master_sample_rate=24000, no_cache=True,
                                  retry_delays=(0, 0)),
        )
    assert p.calls == 2


def test_long_text_is_split_and_cached_per_chunk(tmp_path):
    long_cue = Cue(1, 0.0, 10.0, "第一句。" * 80, 0.0, 20.0)
    p = FakeProvider(1.0)
    _run([long_cue], p, tmp_path)
    assert p.calls > 1
    calls_after_first = p.calls
    _run([long_cue], p, tmp_path)
    assert p.calls == calls_after_first


def test_chunk_text_does_not_alias_single_chunk_cache(tmp_path):
    long_text = "第一句。" * 80
    chunks = split_long_text(long_text)
    assert len(chunks) == 2

    p = FakeProvider(1.0)
    _run([Cue(1, 0.0, 10.0, long_text, 0.0, 20.0)], p, tmp_path)
    calls_after_long = p.calls

    sneaky = Cue(2, 0.0, 10.0, f"1:{chunks[1]}", 0.0, 20.0)
    _run([sneaky], p, tmp_path)
    assert p.calls == calls_after_long + 1  # 单块文本不命中长文本块缓存


def test_cache_write_failure_does_not_fail_the_cue(tmp_path, monkeypatch):
    # 缓存写失败只影响加速（spec §12.1）：已合成的音频不丢、组不失败。
    # 只打挂 SegmentCache.put——全局打挂 sf.write 会连内部片段落盘
    # （F07 part 文件）一起破坏，那种磁盘级失败本来就该报错。
    def boom(self, key, pcm, sample_rate):
        raise OSError("cache directory is read-only")

    monkeypatch.setattr(SegmentCache, "put", boom)
    master, results = _run([cue(1, 0.0, 2.0, 3.0)], FakeProvider(1.0), tmp_path)
    assert results[0].failed is False
    assert np.any(master != 0.0)


def test_corrupt_cache_is_treated_as_miss(tmp_path, monkeypatch):
    p = FakeProvider(1.0)
    _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    # 把缓存文件写坏：下次按未命中重新合成。
    for wav in (tmp_path / "cache").glob("v2-*.wav"):
        wav.write_bytes(b"garbage")
    _run([cue(1, 0.0, 2.0, 3.0)], p, tmp_path)
    assert p.calls == 2


# --- 其它行为 -----------------------------------------------------------------


def test_keep_segments_writes_final_wav(tmp_path):
    seg_dir = tmp_path / "segments"
    _, results = _run(
        [cue(7, 0.0, 1.0, 2.0)], FakeProvider(1.0), tmp_path,
        options=EngineOptions(
            master_sample_rate=24000, keep_segments=True, segments_dir=seg_dir,
            retry_delays=(0, 0),
        ),
    )
    out = seg_dir / "7.wav"
    assert out.is_file()
    pcm, sample_rate = read_wav(out)
    assert sample_rate == 24000
    assert len(pcm) == pytest.approx(results[0].final_duration * sample_rate, abs=1)


def test_style_options_reach_provider_and_cache_key(tmp_path):
    class StyleProvider(FakeProvider):
        def __init__(self):
            super().__init__(1.0)
            self.styles = []

        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            self.styles.append(style)
            return super().synthesize(text, voice, instruct, lang, **style)

    p = StyleProvider()
    c = cue(1, 0.0, 2.0, 3.0)
    _run([c], p, tmp_path,
         options=EngineOptions(master_sample_rate=24000, rate=1.1, volume=80,
                               retry_delays=(0, 0)))
    assert p.styles == [{"rate": 1.1, "volume": 80}]

    _run([c], p, tmp_path,
         options=EngineOptions(master_sample_rate=24000, rate=1.1, volume=80,
                               retry_delays=(0, 0)))
    assert len(p.styles) == 1  # 同风格 → 缓存命中
    _run([c], p, tmp_path,
         options=EngineOptions(master_sample_rate=24000, rate=1.2, volume=80,
                               retry_delays=(0, 0)))
    assert len(p.styles) == 2  # 改风格 → 重新合成
    assert p.styles[1]["rate"] == 1.2


def test_sub_ms_rounding_is_trimmed_without_truncation_flag(tmp_path, monkeypatch):
    p = FakeProvider(1.0)
    c = cue(1, 0.0, 1.0, 1.0)  # natural window 0.9s；合成 1.0s → 加速到 ~1.11x
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")
    # atempo 后 5ms 超窗（≤1ms 才算取整——这里应触发 overflow 默认策略）。
    monkeypatch.setattr(
        "engine.apply_atempo",
        lambda pcm, speed, sr, ffmpeg="ffmpeg": np.full(
            int(sr * 0.905), 0.2, dtype=np.float32
        ),
    )
    with pytest.raises(EngineAbort):
        _run([c], p, tmp_path)


def test_progress_reports_window_and_attempts(tmp_path):
    lines = []
    track = tmp_path / "track.wav"
    run_engine(
        [cue(1, 0.0, 2.0, 3.0)], FlakyProvider(1.0, failures=1), voice=None,
        instruct="", lang="chinese", total_duration=3.0,
        options=EngineOptions(master_sample_rate=24000, retry_delays=(0, 0)),
        cache=SegmentCache(root=tmp_path / "cache"), track_path=track,
        progress=lines.append,
    )
    assert any("当前组生成中" in line for line in lines)
    final = lines[-1]
    assert "窗口 2.90s" in final  # next_start 3.0 - safety 0.1 - start 0.0
    assert "尝试 2 次" in final


def test_real_voice_is_used_in_cache_material(tmp_path):
    # 同文本、不同音色 → 缓存键不同（provider 调用翻倍）。
    p = FakeProvider(1.0)
    c = cue(1, 0.0, 2.0, 3.0)
    _run([c], p, tmp_path, voice=VOICE)
    _run([c], p, tmp_path, voice=VOICE)
    assert p.calls == 1
    other = Voice("Eric", "Eric", "男", "", VOICE.model, "local")
    _run([c], p, tmp_path, voice=other)
    assert p.calls == 2


def test_track_rejects_placement_past_total_duration(tmp_path):
    # next_start 与 total 不一致的防御性输入：写轨阶段拒绝越界，不静默截断。
    with pytest.raises(ValueError, match="exceeds track duration"):
        _run(
            [cue(1, 0.0, 1.0, 10.0)], FakeProvider(5.0), tmp_path, total=2.0,
        )


def test_keyboard_interrupt_saves_partial_results(tmp_path):
    class Interrupting(FakeProvider):
        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            raise KeyboardInterrupt

    with pytest.raises(EngineAbort):
        _run([cue(1, 0.0, 2.0, 3.0)], Interrupting(1.0), tmp_path)
