"""Opt-in integration smoke test: engine -> wav -> mux -> verify.

默认跳过；设置 `VIDEO_TTS_INTEGRATION=1` 且本机有 ffmpeg / ffprobe 才运行。
不加载真实模型、不访问网络：provider 是内存里的假实现。
"""

from __future__ import annotations

import os
import shutil
import subprocess

import numpy as np
import pytest

from cache import SegmentCache
from engine import EngineOptions, run_engine
from mux import _ffprobe, mux_video, verify_output
from providers.base import SynthesisResult
from srt_parse import load_cues
from track_build import read_wav

pytestmark = [pytest.mark.integration, pytest.mark.slow]

requires_integration = pytest.mark.skipif(
    os.environ.get("VIDEO_TTS_INTEGRATION") != "1",
    reason="set VIDEO_TTS_INTEGRATION=1 to run integration tests",
)
requires_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
    reason="ffmpeg / ffprobe not available",
)


class _SineProvider:
    """返回 0.8 s、24 kHz、非静音的正弦波（原生采样率）。"""

    def describe(self):
        return {"provider": "sine", "model": "sine-1"}

    def synthesize(self, text, voice, instruct="", lang="chinese"):
        t = np.arange(int(24000 * 0.8), dtype=np.float32) / 24000.0
        audio = (0.2 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
        return SynthesisResult(
            audio=audio, sample_rate=24000, channels=1,
            provider="sine", model_id="sine-1",
        )


@requires_integration
@requires_ffmpeg
def test_engine_mux_smoke(tmp_path):
    video = tmp_path / "in.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "testsrc=size=320x240:rate=24", "-t", "5",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    srt = tmp_path / "in.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n你好世界\n\n"
        "2\n00:00:02,000 --> 00:00:03,000\n第二句\n",
        encoding="utf-8",
    )

    cues, _warnings = load_cues(srt, video_duration=5.0)
    track = tmp_path / "out.dub.wav"
    results = run_engine(
        cues,
        _SineProvider(),
        voice=None,
        instruct="",
        lang="chinese",
        total_duration=5.0,
        options=EngineOptions(),  # master 48k：走真实 24k→48k 重采样
        cache=SegmentCache(enabled=False),
        track_path=track,
        progress=lambda _line: None,
    )
    assert all(not result.failed for result in results)
    master, rate = read_wav(track)
    assert rate == 48000
    assert master.size == 48000 * 5

    out = tmp_path / "out.dub.mp4"
    mux_video(video, track, out, "h264", sample_rate=48000)
    verify_output(out, 5.0)

    probe = _ffprobe(
        "stream=codec_type,codec_name,sample_rate:format=duration", out
    )
    streams = probe["streams"]
    videos = [s for s in streams if s.get("codec_type") == "video"]
    audios = [s for s in streams if s.get("codec_type") == "audio"]
    assert len(videos) == 1
    assert len(audios) == 1
    assert audios[0]["codec_name"] == "aac"
    assert int(audios[0]["sample_rate"]) == 48000
    assert abs(float(probe["format"]["duration"]) - 5.0) <= 0.2
