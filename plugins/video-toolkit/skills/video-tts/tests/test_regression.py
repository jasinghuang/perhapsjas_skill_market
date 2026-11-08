"""需求文档 §16 的回归场景（T01–T23）集中索引。

多数场景已由分模块测试覆盖（见各文件注释里的 T 编号）；本文件补齐：

- T01/T02：克隆参考音频内容哈希（同路径换内容失效 / 同内容换路径命中）。
- T03：采样参数变化正确失效。
- T04：只改制作采样率 / 时间窗 → 复用原生缓存，仅重加工。
- T21：平台检测（Windows 拒绝本地、Intel Mac 给修复步骤、依赖按路线隔离）。
- T22：overflow 后调大 --max-speed resume → 复用已合成组完成任务。
- T23：真实 ffmpeg 成片（AAC / 采样率 / 音视频等长 / 末句完整）。
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf

import run as launcher
from cache import SegmentCache, file_sha256
from engine import EngineAbort, EngineOptions, run_engine
from mux import mux_video, probe_video, verify_output
from providers.base import SynthesisResult
from srt_parse import Cue, load_cues
from track_build import read_wav

requires_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
    reason="ffmpeg / ffprobe not available",
)


def cue(i, start, end, nxt):
    return Cue(i, start, end, f"第{i}句", start, nxt)


class CountingProvider:
    def __init__(self, seconds, sample_rate=24000):
        self.seconds = seconds
        self.sample_rate = sample_rate
        self.calls = 0

    def describe(self):
        return {"provider": "counting", "model": "m"}

    def synthesize(self, text, voice, instruct="", lang="chinese", **style):
        self.calls += 1
        return SynthesisResult(
            audio=np.full(int(self.sample_rate * self.seconds), 0.2, dtype=np.float32),
            sample_rate=self.sample_rate, channels=1,
            provider="counting", model_id="m",
        )


def _run(cues, provider, tmp_path, options):
    track = tmp_path / "track.wav"
    results = run_engine(
        cues, provider, voice=None, instruct="", lang="chinese",
        total_duration=max(c.next_start for c in cues), options=options,
        cache=SegmentCache(root=tmp_path / "cache"), track_path=track,
        progress=lambda _line: None,
    )
    return results, track


# --- T01 / T02：克隆参考音频的内容身份 ---------------------------------------


def _write_ref(path: Path, payload: bytes) -> None:
    sf.write(path, np.full(2400, 0.2, dtype=np.float32), 24000)
    path.write_bytes(path.read_bytes() + payload)  # 保证内容可区分


def test_T01_same_path_new_content_invalidates_cache(tmp_path):
    ref = tmp_path / "ref.wav"
    _write_ref(ref, b"AAA")
    provider = CountingProvider(1.0)
    c = [cue(1, 0.0, 2.0, 3.0)]
    opts = dict(
        master_sample_rate=24000, retry_delays=(0, 0),
        ref_audio=str(ref), ref_text="参考文本",
    )
    _run(c, provider, tmp_path,
         EngineOptions(ref_audio_sha256=file_sha256(ref), **opts))
    assert provider.calls == 1

    # 同路径、同参考文本，但音频内容被覆盖 → 必须重新合成。
    _write_ref(ref, b"BBB")
    _run(c, provider, tmp_path,
         EngineOptions(ref_audio_sha256=file_sha256(ref), **opts))
    assert provider.calls == 2


def test_T02_same_content_moved_path_reuses_cache(tmp_path):
    ref_a = tmp_path / "a.wav"
    ref_b = tmp_path / "moved.wav"
    _write_ref(ref_a, b"AAA")
    ref_b.write_bytes(ref_a.read_bytes())
    assert file_sha256(ref_a) == file_sha256(ref_b)

    provider = CountingProvider(1.0)
    c = [cue(1, 0.0, 2.0, 3.0)]
    opts = dict(
        master_sample_rate=24000, retry_delays=(0, 0),
        ref_text="参考文本", ref_audio_sha256=file_sha256(ref_a),
    )
    _run(c, provider, tmp_path, EngineOptions(ref_audio=str(ref_a), **opts))
    assert provider.calls == 1

    # 内容相同、路径不同 → 命中（身份是内容哈希，不是路径）。
    _run(c, provider, tmp_path, EngineOptions(ref_audio=str(ref_b), **opts))
    assert provider.calls == 1


# --- F01：克隆参数必须穿透 engine → provider（不只测缓存键） -------------------


def test_F01_clone_params_reach_provider_through_engine(tmp_path):
    """A01 复现：EngineOptions.ref_audio/ref_text 必须真实传到
    provider.synthesize，且克隆时 voice 必须是 None——不允许用
    voice_id="ref-clone" 的假预设音色冒充克隆。"""
    seen = []

    class SpyProvider(CountingProvider):
        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            seen.append({
                "voice_id": getattr(voice, "voice_id", None),
                "ref_audio": style.get("ref_audio"),
                "ref_text": style.get("ref_text"),
            })
            return super().synthesize(text, voice, instruct, lang, **style)

    ref = tmp_path / "ref.wav"
    _write_ref(ref, b"AAA")
    provider = SpyProvider(1.0)
    c = [cue(1, 0.0, 2.0, 3.0)]
    _run(c, provider, tmp_path, EngineOptions(
        master_sample_rate=24000, retry_delays=(0, 0),
        ref_audio=str(ref), ref_text="参考文本",
        ref_audio_sha256=file_sha256(ref),
    ))
    assert seen == [{
        "voice_id": None,
        "ref_audio": str(ref),
        "ref_text": "参考文本",
    }]


def test_F01_clone_cache_identity_carries_call_version(tmp_path):
    """修复前用假预设音色合成的克隆缓存键与修复后相同，会被伪命中。
    克隆缓存身份必须带 ref_call 版本标记，使旧克隆缓存全部失效；
    预设音色身份不带该标记（在线缓存不必陪葬）。"""
    from engine import _cache_material
    from providers.base import Voice

    ref = tmp_path / "ref.wav"
    _write_ref(ref, b"AAA")
    clone_opts = EngineOptions(
        master_sample_rate=24000,
        ref_audio=str(ref), ref_text="参考文本",
        ref_audio_sha256=file_sha256(ref),
    )
    info = {"provider": "p", "model": "m"}
    material = _cache_material(
        info, None, clone_opts, "", "chinese", "文本", 0, 1, {}
    )
    assert material["ref"]["call_version"] == 2

    voice = Voice("Serena", "Serena", "女", "", "m", "local")
    plain = _cache_material(
        info, voice, EngineOptions(master_sample_rate=24000),
        "", "chinese", "文本", 0, 1, {},
    )
    assert "ref" not in plain


# --- T03 / T04：缓存失效与复用边界 -------------------------------------------


def test_T03_sampling_parameter_change_invalidates(tmp_path):
    provider = CountingProvider(1.0)
    c = [cue(1, 0.0, 2.0, 3.0)]
    base = dict(master_sample_rate=24000, retry_delays=(0, 0))
    _run(c, provider, tmp_path, EngineOptions(temperature=0.9, **base))
    _run(c, provider, tmp_path, EngineOptions(temperature=0.9, **base))
    assert provider.calls == 1  # 同参数命中
    _run(c, provider, tmp_path, EngineOptions(temperature=0.6, **base))
    assert provider.calls == 2  # 换温度 → 重新合成


@requires_ffmpeg
def test_T04_master_rate_change_reuses_native_cache(tmp_path):
    provider = CountingProvider(1.0, sample_rate=24000)
    c = [cue(1, 0.0, 3.0, 6.0)]
    _run(c, provider, tmp_path,
         EngineOptions(master_sample_rate=24000, retry_delays=(0, 0)))
    assert provider.calls == 1
    results, track = _run(
        c, provider, tmp_path,
        EngineOptions(master_sample_rate=48000, retry_delays=(0, 0)),
    )
    assert provider.calls == 1  # 原生缓存复用：只重加工，不重新合成
    _, rate = read_wav(track)
    assert rate == 48000
    assert results[0].native_sample_rate == 24000


@requires_ffmpeg
def test_T04_time_window_change_reuses_native_cache(tmp_path):
    provider = CountingProvider(1.0)
    _run([cue(1, 0.0, 1.5, 3.0)], provider, tmp_path,
         EngineOptions(master_sample_rate=24000, retry_delays=(0, 0)))
    assert provider.calls == 1
    # 时间窗变了（SRT 不同但文本相同 → 同一缓存键）。
    _run([cue(1, 0.5, 2.8, 4.0)], provider, tmp_path,
         EngineOptions(master_sample_rate=24000, retry_delays=(0, 0)))
    assert provider.calls == 1


# --- T21：平台与依赖隔离（mlx / torch 双后端路由） ----------------------------


def test_T21_unsupported_platform_refuses_local(monkeypatch):
    # 既非 macOS 也非 Windows：本地路线明确不支持，给出在线建议。
    monkeypatch.setattr(launcher, "IS_MAC", False)
    monkeypatch.setattr(launcher, "IS_WIN", False)
    with pytest.raises(SystemExit, match="online"):
        launcher.main(["--srt", "a.srt", "--provider", "local",
                       "--voice", "Serena"])


def test_T21_windows_local_resolves_to_torch_route(monkeypatch):
    monkeypatch.setattr(launcher, "IS_WIN", True)
    monkeypatch.setattr(launcher, "IS_MAC", False)
    assert launcher.required_route(["--provider", "local"]) == "local_torch"


def test_T21_mac_local_resolves_to_mlx_route(monkeypatch):
    monkeypatch.setattr(launcher, "IS_MAC", True)
    monkeypatch.setattr(launcher, "IS_WIN", False)
    assert launcher.required_route(["--provider", "local"]) == "local_mlx"


def test_T21_non_mac_mlx_reports_unsupported(monkeypatch):
    monkeypatch.setattr(launcher, "IS_MAC", False)
    problems = launcher.capability_problems(launcher.sys.executable, "local_mlx")
    assert problems and "Apple Silicon" in problems[0]


def test_T21_non_windows_torch_reports_unsupported(monkeypatch):
    monkeypatch.setattr(launcher, "IS_WIN", False)
    problems = launcher.capability_problems(
        launcher.sys.executable, "local_torch"
    )
    assert problems and "Windows" in problems[0]


def test_T21_intel_python_gets_repair_steps(monkeypatch):
    monkeypatch.setattr(launcher, "IS_MAC", True)
    failed = MagicMock(
        returncode=1, stderr=b"AssertionError: not arm64: x86_64"
    )
    monkeypatch.setattr(launcher, "_run_probe", lambda python, code, timeout=180: failed)
    problems = launcher.capability_problems(launcher.sys.executable, "local_mlx")
    assert problems and "arm64" in problems[0]
    assert "Rosetta" in problems[0] or "Intel" in problems[0]


def test_T21_driver_cuda_index_handles_new_windows_header(monkeypatch):
    # 新版 Windows 驱动的 nvidia-smi 头部是 "CUDA UMD Version: 13.3"，
    # 且输出编码随区域设置（GBK）——按字节捕获 + 双格式匹配。
    header = "NVIDIA-SMI 610.88   KMD Version: 610.88   CUDA UMD Version: 13.3"
    gbk_bytes = ("…中文表头…\n" + header + "\n").encode("gbk")
    fake = MagicMock(returncode=0, stdout=gbk_bytes)
    monkeypatch.setattr(
        launcher.subprocess, "run", lambda *a, **k: fake
    )
    assert launcher.driver_cuda_index() == "cu130"

    classic = MagicMock(
        returncode=0, stdout=b"Driver Version: 550.54  CUDA Version: 12.4"
    )
    monkeypatch.setattr(
        launcher.subprocess, "run", lambda *a, **k: classic
    )
    assert launcher.driver_cuda_index() == "cu124"


def test_T21_torch_probe_reports_cuda_unavailable(monkeypatch):
    monkeypatch.setattr(launcher, "IS_WIN", True)
    failed = MagicMock(
        returncode=1, stderr=b"AssertionError: CUDA unavailable"
    )
    monkeypatch.setattr(
        launcher, "_run_probe",
        lambda python, code, timeout=120: failed,
    )
    problems = launcher.capability_problems(
        launcher.sys.executable, "local_torch"
    )
    assert problems and "CUDA" in problems[0]


def test_T21_route_requirements_are_backend_split():
    online = launcher.requirements_file("online").read_text(encoding="utf-8")
    mlx = launcher.requirements_file("local_mlx").read_text(encoding="utf-8")
    torch = launcher.requirements_file("local_torch").read_text(encoding="utf-8")
    assert "mlx-audio" in mlx and "mlx-audio" not in torch
    assert "qwen-tts" in torch and "qwen-tts" not in mlx
    # torch 不在 requirements 里（PyPI 默认源是 CPU wheel，安装器按驱动
    # 从 cuXXX 索引装）；在线路线不含任何本地依赖。
    assert "torch==" not in torch
    assert "requests" in online and "mlx-audio" not in online


def test_T21_route_imports_per_backend():
    assert "mlx_audio" in launcher.route_imports("local_mlx")
    assert "torch" in launcher.route_imports("local_torch")
    assert "qwen_tts" in launcher.route_imports("local_torch")
    assert "mlx_audio" not in launcher.route_imports("local_torch")
    assert "mlx_audio" not in launcher.route_imports("online")


def test_T21_explicit_env_var_missing_path(monkeypatch):
    monkeypatch.setenv("VIDEO_TTS_PYTHON", "/definitely/not/python")
    with pytest.raises(SystemExit, match="not an executable file"):
        launcher.resolve_interpreter("base")


def test_T21_explicit_env_var_lacking_imports(monkeypatch):
    monkeypatch.setenv("VIDEO_TTS_PYTHON", launcher.sys.executable)
    monkeypatch.setattr(launcher, "has_imports", lambda python, imports: False)
    with pytest.raises(SystemExit, match="lacks required imports"):
        launcher.resolve_interpreter("base")


# --- T22：overflow 后 resume 复用已合成组 -------------------------------------


@requires_ffmpeg
def test_T22_overflow_resume_with_higher_max_speed_reuses_audio(tmp_path):
    provider = CountingProvider(5.0)  # 5s 合成，窗口 1.9s
    c = [cue(1, 0.0, 1.0, 2.0)]
    base = dict(master_sample_rate=24000, retry_delays=(0, 0))

    with pytest.raises(EngineAbort):
        _run(c, provider, tmp_path, EngineOptions(**base))
    assert provider.calls == 1  # 失败前原生音频已缓存

    # 用户调大 --max-speed 后 resume：命中缓存，不再合成。
    results, track = _run(
        c, provider, tmp_path,
        EngineOptions(max_speed=3.0, **base),  # 5/1.9 ≈ 2.63x 可放下
    )
    assert provider.calls == 1
    assert results[0].failed is False
    assert results[0].speed == pytest.approx(5.0 / 1.9, abs=0.05)
    assert results[0].cache_hits == 1
    master, rate = read_wav(track)
    assert rate == 24000
    assert np.any(master != 0.0)


# --- T23：真实 ffmpeg 成片校验 ------------------------------------------------


@requires_ffmpeg
def test_T23_final_product_aac_rate_and_durations(tmp_path):
    video = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24",
         "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video)],
        check=True, capture_output=True, text=True,
    )
    srt = tmp_path / "in.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n第一句\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\n末句完整\n",
        encoding="utf-8",
    )
    cues, _ = load_cues(srt, video_duration=5.0)
    results, track = _run(
        cues, CountingProvider(0.8), tmp_path, EngineOptions(retry_delays=(0, 0))
    )
    assert all(not r.failed for r in results)

    out = tmp_path / "out.dub.mp4"
    mux_video(video, track, out, "h264", sample_rate=48000)
    verify_output(out, probe_video(video).duration)  # 音视频双时长校验

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,sample_rate,duration:format=duration",
         "-of", "json", str(out)],
        check=True, capture_output=True, text=True,
    )
    import json as _json
    payload = _json.loads(probe.stdout)
    audios = [s for s in payload["streams"] if s["codec_type"] == "audio"]
    assert audios[0]["codec_name"] == "aac"
    assert int(audios[0]["sample_rate"]) == 48000
    # 末句完整：最后一段配音落在 3.0–3.8s，音频流时长≈视频时长。
    assert results[-1].actual_end == pytest.approx(3.8, abs=0.05)
    assert abs(float(payload["format"]["duration"]) - 5.0) <= 0.2
