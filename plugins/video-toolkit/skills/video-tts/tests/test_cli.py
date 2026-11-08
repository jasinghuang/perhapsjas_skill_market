import json
from pathlib import Path

import numpy as np
import pytest

import skill_main
from engine import FitAction, SegmentResult
from mux import VideoInfo
from providers import LOCAL_DESIGN_MODEL, LOCAL_MODEL
from providers.base import SynthesisResult
from run import required_route, route_imports
from skill_main import (
    _build_provider,
    _print_report,
    _resolve_outputs,
    _video_output_from_out,
    build_parser,
    validate_args,
)
from srt_parse import Cue, parse_srt

BASE_IMPORTS = ["soundfile", "numpy"]


def _job_dir_of(tmp_path):
    """conftest 把内部状态指到 tmp/state；返回最近一次任务的目录。"""
    jobs = tmp_path / "state" / "jobs"
    return max(jobs.iterdir(), key=lambda d: d.stat().st_mtime)


def _job_json(tmp_path):
    return _job_dir_of(tmp_path) / "job.json"


def _report_json(tmp_path):
    return _job_dir_of(tmp_path) / "report.json"


def _write_srt(tmp_path, name="a.srt", body=None):
    """写一个真实存在的 SRT；内容只需能被 validate_args 看到文件。"""
    path = tmp_path / name
    path.write_text(
        body
        or "1\n00:00:00,000 --> 00:00:02,000\n你好世界\n",
        encoding="utf-8",
    )
    return path


# --- 参数校验 -------------------------------------------------------------


def test_online_requires_yes(tmp_path, capsys):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "online",
                                      "--voice", "Cherry"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--yes" in capsys.readouterr().err


def test_online_dry_run_does_not_require_yes(tmp_path):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "online",
                                      "--voice", "Cherry", "--dry-run"])
    # 预览不产生费用，因此不要求 --yes。
    validate_args(args)


def test_local_design_and_voice_are_mutually_exclusive(tmp_path, capsys):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "local",
                                      "--voice", "Serena", "--design", "温柔"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "exactly one of --voice, --design" in capsys.readouterr().err


def test_defaults():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                      "--voice", "Serena"])
    assert args.lang == "chinese"
    assert args.max_speed == 1.30
    assert args.warn_speed == 1.15
    assert args.timing_mode == "natural"
    assert args.overflow_policy == "error"
    assert args.master_sample_rate == 48000
    assert args.max_attempts == 3
    assert not args.overwrite
    assert not args.write_plan


def test_sample_rate_flag_was_removed(tmp_path):
    # 旧的 --sample-rate 不再接受；采样率由 --master-sample-rate 控制。
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                   "--voice", "Serena", "--sample-rate", "16000"])


def test_master_sample_rate_restricted_to_tested_values(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena", "--master-sample-rate", "16000",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--master-sample-rate" in capsys.readouterr().err


def test_truncate_rejected_with_strict_slot(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena", "--timing-mode", "strict_slot",
        "--overflow-policy", "truncate",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "strict_slot" in capsys.readouterr().err


def test_abbreviated_flags_are_not_accepted():
    # allow_abbrev=False：`--voi` 不能被当成 --voice 静默接受。
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                   "--voi", "Serena"])


def test_yes_help_notes_dry_run_exemption():
    help_text = build_parser().format_help()
    assert "真实运行必需" in help_text
    assert "--dry-run" in help_text


def test_required_route_local_vs_online():
    # 本地路线按平台解析（Windows 实机即 torch 路线）；此处只验证
    # 解析结果与其 import 表一致，具体平台断言见 test_regression T21。
    route = required_route(["--provider", "local"])
    assert route in ("local_mlx", "local_torch", "base")
    if route == "local_mlx":
        assert route_imports(route) == BASE_IMPORTS + ["mlx_audio"]
    elif route == "local_torch":
        assert route_imports(route) == BASE_IMPORTS + ["torch", "qwen_tts"]
    assert route_imports("online") == BASE_IMPORTS + ["requests"]
    assert route_imports("base") == BASE_IMPORTS
    assert required_route(["--provider", "local"]) in (
        "local_mlx", "local_torch",
    )
    assert required_route(["--provider=online"]) == "online"


# --- supplementary coverage -------------------------------------------------


def test_preview_routes_are_base_only():
    # dry-run / help / write-plan 只解析：绝不触发 mlx_audio / requests。
    assert required_route(["--provider", "local", "--dry-run"]) == "base"
    assert required_route(["--provider", "online", "--dry-run"]) == "base"
    assert required_route(["--provider", "local", "--help"]) == "base"
    assert required_route(["--provider=local", "-h"]) == "base"
    assert required_route(["--provider", "local", "--write-plan"]) == "base"


def test_preview_prefixes_stay_base_only():
    # 缩写前缀在 argparse 里会被拒绝，但预检阶段也不该先装模型依赖。
    assert required_route(["--provider", "local", "--dry"]) == "base"
    assert required_route(["--provider", "online", "--hel"]) == "base"
    assert required_route(["--provider", "local", "--write"]) == "base"
    # `--` 是选项终止符，不是预览。
    assert required_route(["--", "--provider", "local"]) in (
        "local_mlx", "local_torch",
    )


def test_local_requires_voice_or_design(tmp_path, capsys):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "local"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "exactly one of --voice, --design" in capsys.readouterr().err


def test_online_rejects_design(tmp_path, capsys):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "online",
                                      "--design", "温柔", "--yes"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--design is only supported by the local provider" in capsys.readouterr().err


def test_max_speed_below_one_is_rejected(tmp_path, capsys):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "local",
                                      "--voice", "Serena", "--max-speed", "0.9"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--max-speed" in capsys.readouterr().err


def test_warn_speed_above_max_is_rejected(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena", "--warn-speed", "1.4",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--warn-speed" in capsys.readouterr().err


def test_missing_srt_is_rejected_after_structural_checks(capsys):
    args = build_parser().parse_args(["--srt", "definitely-missing.srt",
                                      "--provider", "local", "--voice", "Serena"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "SRT not found" in capsys.readouterr().err


def test_out_must_not_overwrite_input_video(tmp_path, capsys):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"")
    args = build_parser().parse_args(["--srt", str(srt), "--provider", "local",
                                      "--voice", "Serena", "--video", str(video),
                                      "--out", str(video)])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "overwrite the input video" in capsys.readouterr().err


def test_out_stem_resolving_to_input_video_is_rejected(tmp_path, capsys):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.dub.mp4"
    video.write_bytes(b"")
    args = build_parser().parse_args(["--srt", str(srt), "--provider", "local",
                                      "--voice", "Serena", "--video", str(video),
                                      "--out", str(tmp_path / "in")])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "overwrite the input video" in capsys.readouterr().err


def test_out_equal_to_video_is_allowed_with_track_only(tmp_path):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"")
    args = build_parser().parse_args(["--srt", str(srt), "--provider", "local",
                                      "--voice", "Serena", "--video", str(video),
                                      "--out", str(video), "--track-only"])
    # 只出 wav 时不写视频，允许 --out 与输入视频同名。
    validate_args(args)


def test_dry_run_prints_plan_without_preparing_or_writing(tmp_path, capsys):
    srt = _write_srt(
        tmp_path,
        body=(
            "1\n00:00:00,000 --> 00:00:02,000\n你好世界\n\n"
            "2\n00:00:02,000 --> 00:00:04,000\n第二句\n"
        ),
    )

    def _explode(*args, **kwargs):
        raise AssertionError("dry-run must not create or prepare a provider")

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(skill_main, "get_provider", _explode)
        code = skill_main.main(
            ["--srt", str(srt), "--provider", "local", "--voice", "Serena",
             "--dry-run"]
        )

    assert code == 0
    out = capsys.readouterr().out
    assert "条目: 2 组" in out
    assert "总字数: 7 字" in out
    assert "00:00:02.000" in out
    assert "第二句" in out
    # dry-run 不写任何文件（含 report / job / dub.srt）。
    assert list(tmp_path.glob("*.json")) == []
    assert list(tmp_path.glob("*.srt")) == [srt]


# --- VoiceDesign / 模型匹配（行为保持） ------------------------------------


def _local_args(tmp_path, *extra):
    return build_parser().parse_args(
        ["--srt", str(_write_srt(tmp_path)), "--provider", "local", *extra]
    )


@pytest.mark.parametrize(
    ("backend", "expected_model"),
    [
        ("mlx", LOCAL_DESIGN_MODEL),
        ("torch", "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"),
    ],
)
def test_design_mode_defaults_per_backend(
    tmp_path, monkeypatch, backend, expected_model
):
    # 默认模型随后端解析（spec §4.2）：mlx 用 mlx-community 镜像，
    # torch 用官方 ID——用户不需要理解两套模型 ID。
    args = _local_args(tmp_path, "--design", "温柔、年轻的男声")
    captured = {}

    def fake_get_provider(name, **kwargs):
        captured["name"] = name
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(skill_main, "local_backend", lambda: backend)
    monkeypatch.setattr(skill_main, "get_provider", fake_get_provider)
    _build_provider(args, args.design)
    assert captured == {
        "name": "local",
        "backend": backend,
        "design": "温柔、年轻的男声",
        "model_id": expected_model,
    }


def test_design_mode_keeps_explicit_voice_design_model(tmp_path, monkeypatch):
    args = _local_args(tmp_path, "--design", "温柔", "--model", LOCAL_DESIGN_MODEL)
    captured = {}
    monkeypatch.setattr(
        skill_main, "get_provider",
        lambda name, **kwargs: captured.update(kwargs) or object(),
    )
    _build_provider(args, args.design)
    assert captured["model_id"] == LOCAL_DESIGN_MODEL


def test_design_rejects_instruct(tmp_path, capsys):
    args = _local_args(tmp_path, "--design", "温柔", "--instruct", "平静")
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--design cannot be combined with --instruct" in capsys.readouterr().err


def test_voice_rejects_voice_design_model(tmp_path, capsys):
    args = _local_args(tmp_path, "--voice", "Serena", "--model", LOCAL_DESIGN_MODEL)
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "VoiceDesign" in capsys.readouterr().err


def test_design_rejects_custom_voice_model(tmp_path, capsys):
    args = _local_args(tmp_path, "--design", "温柔", "--model", LOCAL_MODEL)
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--design requires a VoiceDesign model" in capsys.readouterr().err


def test_invalid_local_voice_exits_2(tmp_path, capsys):
    args = _local_args(tmp_path, "--voice", "NoSuchVoice")
    with pytest.raises(SystemExit) as excinfo:
        validate_args(args)
    assert excinfo.value.code == 2
    assert "valid IDs" in capsys.readouterr().err


def test_invalid_online_voice_exits_2(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "NoSuchVoice", "--dry-run",
    ])
    with pytest.raises(SystemExit) as excinfo:
        validate_args(args)
    assert excinfo.value.code == 2
    assert "valid IDs" in capsys.readouterr().err


def test_online_model_must_match_voice_group(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "Cherry", "--model", "qwen-audio-3.1-tts-plus", "--dry-run",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "does not match voice" in capsys.readouterr().err


def test_online_model_matching_voice_group_is_allowed(tmp_path):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "Cherry", "--model", "qwen3-tts-flash", "--dry-run",
    ])
    validate_args(args)


# --- --out 语义 ------------------------------------------------------------


def test_only_mp4_suffix_is_an_explicit_video_path():
    assert _video_output_from_out(Path("foo.mp4")) == Path("foo.mp4")
    assert _video_output_from_out(Path("foo.MP4")) == Path("foo.MP4")
    assert _video_output_from_out(Path("foo.mkv")) == Path("foo.mkv.dub.mp4")
    assert _video_output_from_out(Path("foo.mov")) == Path("foo.mov.dub.mp4")
    assert _video_output_from_out(Path("foo")) == Path("foo.dub.mp4")


def test_non_mp4_out_is_treated_as_prefix(tmp_path):
    srt = _write_srt(tmp_path)
    args = build_parser().parse_args([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "foo.mkv"),
    ])
    prefix, video_out = _resolve_outputs(args, None, srt)
    assert prefix == tmp_path / "foo.mkv"
    assert video_out == tmp_path / "foo.mkv.dub.mp4"


# --- 完整运行（mock provider；24k master 避免 ffmpeg） ---------------------

class _FakeProvider:
    model_id = LOCAL_MODEL

    def prepare(self):
        pass

    def describe(self):
        return {"provider": "local", "model": LOCAL_MODEL}

    def synthesize(self, text, voice, instruct="", lang="chinese"):
        return SynthesisResult(
            audio=np.full(24000, 0.2, dtype=np.float32),  # 1s @24k
            sample_rate=24000, channels=1,
            provider="local", model_id=LOCAL_MODEL,
        )


class _LongProvider(_FakeProvider):
    """返回 5s 音频：2s 窗口放不下（natural window 1.9s）。"""

    def synthesize(self, text, voice, instruct="", lang="chinese"):
        return SynthesisResult(
            audio=np.full(24000 * 5, 0.2, dtype=np.float32),
            sample_rate=24000, channels=1,
            provider="local", model_id=LOCAL_MODEL,
        )


def _patch_run(monkeypatch, provider=None, mux=None):
    monkeypatch.setattr(
        skill_main, "probe_video",
        lambda path: VideoInfo(2.0, "h264", 320, 240, "24/1"),
    )
    monkeypatch.setattr(skill_main, "_require_binary", lambda name: None)
    monkeypatch.setattr(
        skill_main, "get_provider",
        lambda *args, **kwargs: provider or _FakeProvider(),
    )
    if mux is not None:
        monkeypatch.setattr(skill_main, "mux_video", mux)


def test_successful_run_writes_track_report_and_job(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    assert code == 0
    assert (tmp_path / "out.dub.wav").is_file()
    report = json.loads(_report_json(tmp_path).read_text(encoding="utf-8"))
    assert report["schema_version"] == 2
    assert report["status"] == "complete"
    assert report["audio"]["master_sample_rate"] == 24000
    assert report["cues"][0]["actual_start"] == 0.0
    job = json.loads(_job_json(tmp_path).read_text(encoding="utf-8"))
    assert job["status"] == "complete"
    assert job["groups"][0]["status"] == "ok"
    assert (tmp_path / "out.dub.srt").is_file()  # 实际时间的块级字幕
    parsed = parse_srt(tmp_path / "out.dub.srt")
    assert parsed[0].end == pytest.approx(1.0, abs=0.02)


def test_track_and_report_survive_mux_failure(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"")

    def boom(*args, **kwargs):
        raise RuntimeError("mux boom")

    _patch_run(monkeypatch, mux=boom)
    code = skill_main.main([
        "--srt", str(srt), "--video", str(video), "--provider", "local",
        "--voice", "Serena", "--out", str(tmp_path / "out"),
        "--no-cache", "--master-sample-rate", "24000",
    ])
    captured = capsys.readouterr()
    assert code == 1
    assert "配音轨:" in captured.out
    assert "4 字" in captured.out
    assert "mux boom" in captured.err

    payload = json.loads(_report_json(tmp_path).read_text(encoding="utf-8"))
    assert payload["track"].endswith("out.dub.wav")
    assert payload["output"] is None
    assert payload["status"] == "failed"
    assert len(payload["cues"]) == 1


def test_mux_success_records_output(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"")
    mux_calls = {}

    def fake_mux(video_in, track, out, codec, sample_rate=48000):
        mux_calls["sample_rate"] = sample_rate
        out.write_bytes(b"mp4")
        return out

    _patch_run(monkeypatch, mux=fake_mux)
    monkeypatch.setattr(skill_main, "verify_output", lambda *a, **k: None)
    code = skill_main.main([
        "--srt", str(srt), "--video", str(video), "--provider", "local",
        "--voice", "Serena", "--out", str(tmp_path / "out"),
        "--no-cache", "--master-sample-rate", "24000",
    ])
    assert code == 0
    assert "成片:" in capsys.readouterr().out
    payload = json.loads(_report_json(tmp_path).read_text(encoding="utf-8"))
    assert payload["output"].endswith("out.dub.mp4")
    assert mux_calls["sample_rate"] == 24000  # AAC 采样率与音轨一致


# --- 退出码与状态 -----------------------------------------------------------


def test_overflow_default_exits_1_needs_attention(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch, provider=_LongProvider())
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    assert code == 1
    report = json.loads(_report_json(tmp_path).read_text(encoding="utf-8"))
    assert report["status"] == "needs_attention"
    assert not (tmp_path / "out.dub.wav").exists()  # 不出伪完整音轨
    job = json.loads(_job_json(tmp_path).read_text(encoding="utf-8"))
    assert job["status"] == "needs_attention"
    assert job["groups"][0]["overflow_gap"] > 1.0


def test_overflow_truncate_exits_3_with_warnings(tmp_path, capsys, monkeypatch):
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch, provider=_LongProvider())
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000", "--overflow-policy", "truncate",
    ])
    assert code == 3
    report = json.loads(_report_json(tmp_path).read_text(encoding="utf-8"))
    assert report["status"] == "completed_with_warnings"
    assert report["content_truncated"] is True
    assert report["cues"][0]["truncated_seconds"] > 0.5


def test_continue_on_error_yields_partial_exit_1(tmp_path, capsys, monkeypatch):
    class Broken(_FakeProvider):
        def prepare(self):
            pass

        def synthesize(self, text, voice, instruct="", lang="chinese"):
            from providers.errors import RETRYABLE, SynthesisError
            raise SynthesisError("boom", kind=RETRYABLE)

    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch, provider=Broken())
    monkeypatch.setattr("engine.time.sleep", lambda _s: None)  # 不真实退避
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000", "--max-attempts", "2",
        "--continue-on-error",
    ])
    assert code == 1
    report = json.loads(_report_json(tmp_path).read_text(encoding="utf-8"))
    assert report["status"] == "partial"
    assert report["cues"][0]["attempts"] == 2  # 统一预算：2 次提交


# --- 覆盖保护（T20） --------------------------------------------------------


def test_existing_output_auto_numbers_whole_set(tmp_path, capsys, monkeypatch):
    # F09：同名成品默认整组自动编号 name_2（不覆盖、不报错），
    # 旧文件原样保留，新产物全部落在同一编号下。
    srt = _write_srt(tmp_path)
    existing = tmp_path / "out.dub.wav"
    existing.write_bytes(b"previous")
    old_report = tmp_path / "out.dub.srt"
    old_report.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n旧字幕\n", encoding="utf-8"
    )
    _patch_run(monkeypatch)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    captured = capsys.readouterr()
    assert code == 0
    assert "自动编号" in captured.out
    assert existing.read_bytes() == b"previous"          # 不覆盖旧成品
    assert "旧字幕" in old_report.read_text(encoding="utf-8")
    assert (tmp_path / "out_2.dub.wav").is_file()        # 整组统一编号
    assert (tmp_path / "out_2.dub.srt").is_file()
    # report/job 是内部状态（F12），在应用任务目录、不在素材目录。
    assert (tmp_path / "out_2.report.json").exists() is False
    assert (_job_dir_of(tmp_path) / "report.json").is_file()
    assert (_job_dir_of(tmp_path) / "job.json").is_file()


def test_output_never_overwrites_input_srt(tmp_path, capsys, monkeypatch):
    # F09：输出撞输入（同文件）必须拒绝，--overwrite 也不放行。
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "ok"),
        "--json-report", str(srt),  # 自定义报告直接指向输入 SRT
        "--no-cache", "--master-sample-rate", "24000", "--overwrite",
    ])
    assert code == 2
    assert "覆盖输入" in capsys.readouterr().err
    assert srt.read_text(encoding="utf-8").startswith("1\n")


def test_failing_overwrite_run_keeps_existing_output(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    existing = tmp_path / "out.dub.wav"
    existing.write_bytes(b"previous")
    _patch_run(monkeypatch, provider=_LongProvider())  # overflow 失败
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000", "--overwrite",
    ])
    assert code == 1
    assert existing.read_bytes() == b"previous"  # 失败不覆盖用户已有成品


# --- dry-run / write-plan（F08 修正） --------------------------------------


_DUB_BODY = (
    "1\n00:00:00,000 --> 00:00:01,000\n你好，\n\n"
    "2\n00:00:01,100 --> 00:00:02,000\n世界。\n\n"
    "3\n00:00:02,100 --> 00:00:03,000\n新段落。\n\n"
    "4\n00:00:05,000 --> 00:00:06,000\n长停顿后。\n\n"
)


def _write_plan_groups(tmp_path, groups, srt=None, **extra):
    payload = {"groups": groups, **extra}
    if srt is not None:
        import hashlib
        payload["srt_sha256"] = hashlib.sha256(
            Path(srt).read_bytes()
        ).hexdigest()
    else:
        payload["srt_sha256"] = "hash"
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return plan


def test_merge_plan_run_writes_actual_dub_srt(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path, body=_DUB_BODY)
    plan = _write_plan_groups(tmp_path, [[1, 2, 3], [4]], srt=srt)
    _patch_run(monkeypatch)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--merge-plan", str(plan),
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    captured = capsys.readouterr()
    assert code == 0
    assert "合并: 4 条 → 2 组" in captured.out
    assert "块级字幕:" in captured.out
    parsed = parse_srt(tmp_path / "out.dub.srt")
    assert len(parsed) == 2
    assert parsed[0].text == "你好，世界。新段落。"
    # 实际结束时间：3.0s 窗口、1s 音频 → 1.0s 结束（不是计划窗口的复制）。
    assert parsed[0].end == pytest.approx(1.0, abs=0.02)
    assert (tmp_path / "out.dub.wav").is_file()


def test_write_plan_online_needs_no_cost_confirmation(tmp_path, capsys):
    # F14：--write-plan 只写计划、不合成、不联网 → 不要求 --yes。
    srt = _write_srt(tmp_path)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "online", "--voice", "Cherry",
        "--out", str(tmp_path / "out"), "--write-plan",
    ])
    assert code == 0
    assert (tmp_path / "out.plan.json").is_file()
    # 写出的计划带 srt_sha256，可直接作为 --merge-plan 回读（F13 往返）。
    import hashlib
    payload = json.loads(
        (tmp_path / "out.plan.json").read_text(encoding="utf-8")
    )
    assert payload["srt_sha256"] == hashlib.sha256(
        Path(srt).read_bytes()
    ).hexdigest()


def test_dry_run_with_merge_plan_writes_nothing(tmp_path, capsys):
    # F08：dry-run 不再隐式写 dub.srt。
    srt = _write_srt(tmp_path, body=_DUB_BODY)
    plan = _write_plan_groups(tmp_path, [[1, 2, 3], [4]], srt=srt)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--merge-plan", str(plan),
        "--out", str(tmp_path / "out"), "--dry-run",
    ])
    captured = capsys.readouterr()
    assert code == 0
    assert "合并: 4 条 → 2 组" in captured.out
    assert "块级字幕:" not in captured.out
    assert not (tmp_path / "out.dub.srt").exists()
    assert list(tmp_path.glob("*.json")) == [plan]


def test_write_plan_saves_plan_json_and_srt(tmp_path, capsys):
    srt = _write_srt(tmp_path, body=_DUB_BODY)
    plan = _write_plan_groups(tmp_path, [[1, 2, 3], [4]], srt=srt)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--merge-plan", str(plan),
        "--out", str(tmp_path / "out"), "--write-plan",
    ])
    assert code == 0
    payload = json.loads((tmp_path / "out.plan.json").read_text(encoding="utf-8"))
    assert payload["groups"][0]["source_indices"] == [1, 2, 3]
    assert payload["srt_sha256"]
    parsed = parse_srt(tmp_path / "out.plan.srt")
    assert len(parsed) == 2
    # 只写计划，不合成、不出成品。
    assert not (tmp_path / "out.dub.wav").exists()
    assert not (tmp_path / "out.dub.srt").exists()


# --- resume（T22 的 CLI 侧） ------------------------------------------------


def test_resume_reuses_job_and_completes(tmp_path, capsys, monkeypatch):
    import shutil
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")

    class Switchable:
        broken = True

        def prepare(self):
            pass

        def describe(self):
            return {"provider": "local", "model": LOCAL_MODEL}

        def synthesize(self, text, voice, instruct="", lang="chinese"):
            from providers.errors import RETRYABLE, SynthesisError
            if self.broken:
                raise SynthesisError("transient", kind=RETRYABLE)
            return SynthesisResult(
                audio=np.full(48000, 0.2, dtype=np.float32),  # 1s @48k
                sample_rate=48000, channels=1,
                provider="local", model_id=LOCAL_MODEL,
            )

    provider = Switchable()
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch, provider=provider)

    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache", "--max-attempts", "1",
    ])
    assert code == 1  # 单次提交失败 → failed；报告与 job 已落盘
    job_path = _job_json(tmp_path)
    first_job = json.loads(job_path.read_text(encoding="utf-8"))
    assert first_job["status"] == "failed"
    # 失败后允许同任务继续（resume 放行覆盖保护）。
    provider.broken = False
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"),
        "--resume", str(_job_dir_of(tmp_path)),
    ])
    assert code == 0
    resumed = json.loads(job_path.read_text(encoding="utf-8"))
    assert resumed["status"] == "complete"
    assert resumed["job_id"] == first_job["job_id"]  # 同一任务延续


def test_resume_rejects_changed_srt(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch)
    skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    job_path = _job_json(tmp_path)
    _write_srt(tmp_path, body="1\n00:00:00,000 --> 00:00:02,000\n完全不同的内容\n")
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--resume", str(job_path),
        "--master-sample-rate", "24000",
    ])
    assert code == 2
    assert "srt_sha256" in capsys.readouterr().err


def test_resume_rejects_identity_config_change(tmp_path, capsys, monkeypatch):
    # F03：换音色 = 合成身份变化，不能借 --resume 静默改道。
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch)
    skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    job_path = _job_json(tmp_path)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Vivian",
        "--out", str(tmp_path / "out"), "--resume", str(job_path),
        "--master-sample-rate", "24000",
    ])
    assert code == 2
    assert "voice" in capsys.readouterr().err


def test_resume_allows_processing_change_with_revision_note(
    tmp_path, capsys, monkeypatch
):
    # F03：只改制作采样率 → 允许 resume，原生音频复用，配置快照更新。
    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch)
    skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--no-cache",
        "--master-sample-rate", "24000",
    ])
    job_path = _job_json(tmp_path)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"), "--resume", str(job_path),
        "--master-sample-rate", "48000",
    ])
    assert code == 0
    out = capsys.readouterr().out
    assert "加工参数修订" in out
    payload = json.loads(job_path.read_text(encoding="utf-8"))
    assert payload["config"]["master_sample_rate"] == 48000
    assert payload["config_history"][0]["config"]["master_sample_rate"] == 24000


# --- 杂项：打印报告 / 风格参数（行为保持） ----------------------------------


def test_print_report_includes_total_chars(capsys):
    cue_ = Cue(1, 0.0, 1.0, "你好世界", 0.0, 1.0)
    result = SegmentResult(cue_, 1.0, 1.0, 1.0, FitAction.FIT, None, False)
    warnings, failures = _print_report([result], 0)
    assert (warnings, failures) == (0, 0)
    assert "4 字" in capsys.readouterr().out


def test_online_style_flags_validate_for_flagship(tmp_path):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "longanlingxin_v3.1", "--yes",
        "--rate", "1.1", "--pitch", "0.95", "--volume", "80",
        "--seed", "42", "--enable-ssml",
    ])
    validate_args(args)
    assert (args.rate, args.pitch, args.volume, args.seed) == (1.1, 0.95, 80, 42)
    assert args.enable_ssml is True


def test_local_rejects_online_style_flags(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena", "--rate", "1.1",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "only supported by the online provider" in capsys.readouterr().err


def test_style_flag_ranges_are_enforced(tmp_path, capsys):
    for flag, value in (("--rate", "0.4"), ("--pitch", "2.1"),
                        ("--volume", "101"), ("--seed", "-1")):
        args = build_parser().parse_args([
            "--srt", str(_write_srt(tmp_path)), "--provider", "online",
            "--voice", "Cherry", "--yes", flag, value,
        ])
        with pytest.raises(SystemExit):
            validate_args(args)
        assert flag in capsys.readouterr().err


def test_enable_ssml_is_flagship_only(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "Cherry", "--yes", "--enable-ssml",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--enable-ssml" in capsys.readouterr().err


def test_hotfix_requires_flagship_http_env_and_endpoint(tmp_path, capsys, monkeypatch):
    hotfix = tmp_path / "hotfix.json"
    hotfix.write_text('{"replace": [{"今天": "金天"}]}', encoding="utf-8")
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "longanlingxin_v3.1", "--yes",
        "--hotfix-file", str(hotfix),
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "DASHSCOPE_API_KEY" in capsys.readouterr().err

    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-test")
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--tts-endpoint" in capsys.readouterr().err

    args.tts_endpoint = "https://example.test/tts"
    validate_args(args)
    assert args.hotfix == {"replace": [{"今天": "金天"}]}


def test_audio_and_video_are_mutually_exclusive(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena", "--audio", "a.wav", "--video", "v.mp4",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "mutually exclusive" in capsys.readouterr().err


def test_ref_audio_pair_and_base_model_validation(tmp_path, capsys, monkeypatch):
    # 本用例测 ref 参数配对与模型族校验；平台路由（Windows 拒绝 MLX）
    # 属于 launcher / 运行期路由，不在这里测。
    monkeypatch.setattr(skill_main, "IS_WINDOWS", False)
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"RIFF")
    base = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--ref-audio", str(ref), "--ref-text", "参考文本", "--model", base,
    ])
    validate_args(args)

    missing = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--ref-audio", str(ref),
    ])
    with pytest.raises(SystemExit):
        validate_args(missing)
    assert "together" in capsys.readouterr().err

    with_voice = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--ref-audio", str(ref), "--ref-text", "参考文本", "--voice", "Serena",
    ])
    with pytest.raises(SystemExit):
        validate_args(with_voice)
    assert "cannot be combined" in capsys.readouterr().err

    wrong_model = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--ref-audio", str(ref), "--ref-text", "参考文本", "--model", LOCAL_MODEL,
    ])
    with pytest.raises(SystemExit):
        validate_args(wrong_model)
    assert "Base model" in capsys.readouterr().err


def test_voice_rejects_base_model(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena",
        "--model", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "Base model" in capsys.readouterr().err


def test_online_rejects_ref_audio(tmp_path, capsys):
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"RIFF")
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "Cherry", "--yes",
        "--ref-audio", str(ref), "--ref-text", "参考文本",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "local provider" in capsys.readouterr().err


def test_local_sampling_params_validate(tmp_path):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "local",
        "--voice", "Serena", "--temperature", "0.6", "--top-p", "0.9",
        "--top-k", "40", "--seed", "42",
    ])
    validate_args(args)
    assert (args.temperature, args.top_p, args.top_k, args.seed) == (
        0.6, 0.9, 40, 42
    )


def test_online_rejects_local_sampling(tmp_path, capsys):
    args = build_parser().parse_args([
        "--srt", str(_write_srt(tmp_path)), "--provider", "online",
        "--voice", "Cherry", "--yes", "--temperature", "0.6",
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "temperature" in capsys.readouterr().err


def test_hotfix_rejects_local_and_qwen_tts(tmp_path, capsys):
    hotfix = tmp_path / "hotfix.json"
    hotfix.write_text('{"replace": [{"a": "b"}]}', encoding="utf-8")
    for provider, voice in (("local", "Serena"), ("online", "Cherry")):
        args = build_parser().parse_args([
            "--srt", str(_write_srt(tmp_path)), "--provider", provider,
            "--voice", voice, "--yes", "--hotfix-file", str(hotfix),
        ])
        with pytest.raises(SystemExit):
            validate_args(args)
        assert "hotfix" in capsys.readouterr().err.lower()


# --- A12：懒加载（缓存全命中 → 模型加载零次） ---------------------------------


class _PreparingProvider:
    """数 prepare 次数的假 provider；prepare 前调用 synthesize 会留下标记。"""

    def __init__(self):
        self.prepares = 0
        self.synths = 0
        self.synth_before_prepare = False

    def prepare(self):
        self.prepares += 1

    def describe(self):
        return {"provider": "lazy-test", "model": "m"}

    def synthesize(self, text, voice, instruct="", lang="chinese", **style):
        self.synths += 1
        if self.prepares == 0:
            self.synth_before_prepare = True
        return SynthesisResult(
            audio=np.full(24000, 0.2, dtype=np.float32),
            sample_rate=24000, channels=1,
            provider="lazy-test", model_id="m",
        )


def test_lazy_provider_defers_prepare_until_first_synthesis():
    inner = _PreparingProvider()
    lazy = skill_main._LazyProvider(inner)
    assert lazy.describe() == {"provider": "lazy-test", "model": "m"}
    assert inner.prepares == 0  # describe 不触发加载
    lazy.synthesize("你好", None)
    assert inner.prepares == 1
    assert inner.synth_before_prepare is False
    lazy.synthesize("再见", None)
    assert inner.prepares == 1  # 只 prepare 一次
    assert lazy.prepare_count == 1
    assert lazy.prepare_seconds is not None


def test_lazy_provider_download_never_prepares():
    # 收据恢复只下载，不需要模型。
    class Downloadable(_PreparingProvider):
        def download(self, audio_url, voice=None, request_id=None):
            return SynthesisResult(
                audio=np.full(2400, 0.2, dtype=np.float32),
                sample_rate=24000, channels=1,
                provider="lazy-test", model_id="m",
            )

    inner = Downloadable()
    lazy = skill_main._LazyProvider(inner)
    lazy.download("https://example.test/a.wav")
    assert inner.prepares == 0


def test_cli_report_records_zero_prepare_on_full_cache_hit(tmp_path, monkeypatch):
    # A12 端到端：第二次运行全命中缓存 → prepare_count == 0，
    # 报告 prepare_seconds 为 null（模型加载零次，重拼轨不等模型）。
    import shutil as _shutil
    if _shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg required")

    srt = _write_srt(tmp_path)
    _patch_run(monkeypatch)
    common = [
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--out", str(tmp_path / "out"),
        "--master-sample-rate", "24000",
    ]
    assert skill_main.main(common) == 0
    job = json.loads(_job_json(tmp_path).read_text(encoding="utf-8"))
    # resume 同任务第二次运行（缓存命中，无新合成）。
    code = skill_main.main([*common, "--resume", str(_job_dir_of(tmp_path))])
    assert code == 0
    report = json.loads(
        _report_json(tmp_path).read_text(encoding="utf-8")
    )
    assert report["timings"]["prepare_count"] == 0
    assert report["timings"]["prepare_seconds"] is None
    assert job["job_id"]


# --- 设计后克隆第一步：--preview-text（spec §7.2） ----------------------------


def test_design_preview_writes_only_preview_wav(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    seen = {}

    class PreviewProvider:
        def prepare(self):
            seen["prepared"] = True

        def describe(self):
            return {"provider": "local-torch", "model": "m"}

        def synthesize(self, text, voice, instruct="", lang="chinese", **style):
            seen["text"] = text
            seen["style"] = style
            return SynthesisResult(
                audio=np.full(24000, 0.2, dtype=np.float32),
                sample_rate=24000, channels=1,
                provider="local-torch", model_id="m",
            )

    monkeypatch.setattr(
        skill_main, "get_provider",
        lambda name, **kwargs: PreviewProvider(),
    )
    monkeypatch.setattr(skill_main, "_require_binary", lambda name: None)
    code = skill_main.main([
        "--srt", str(srt), "--provider", "local", "--design", "温柔女声",
        "--preview-text", "这是试听文本。",
        "--out", str(tmp_path / "pv"), "--master-sample-rate", "24000",
    ])
    assert code == 0
    assert seen == {"prepared": True, "text": "这是试听文本。", "style": {}}
    assert (tmp_path / "pv.preview.wav").is_file()
    # 只产出试听一件：无整片轨、无字幕、无任务目录。
    assert not (tmp_path / "pv.dub.wav").exists()
    assert not (tmp_path / "state" / "jobs").exists()
    out = capsys.readouterr().out
    assert "--ref-audio" in out and "--ref-text" in out


def test_design_preview_requires_design(tmp_path, capsys):
    srt = _write_srt(tmp_path)
    args = build_parser().parse_args([
        "--srt", str(srt), "--provider", "local", "--voice", "Serena",
        "--preview-text", "x", "--out", str(tmp_path / "pv"),
    ])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "--design" in capsys.readouterr().err
