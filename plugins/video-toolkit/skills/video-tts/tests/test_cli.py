import json
from pathlib import Path

import numpy as np
import pytest

import skill_main
from engine import FitAction, SegmentResult
from mux import VideoInfo
from providers import LOCAL_DESIGN_MODEL, LOCAL_MODEL
from run import required_imports
from skill_main import (
    _build_provider,
    _print_report,
    _resolve_outputs,
    _video_output_from_out,
    build_parser,
    validate_args,
)
from srt_parse import Cue

BASE_IMPORTS = ["soundfile", "numpy"]


def _write_srt(tmp_path, name="a.srt", body=None):
    """写一个真实存在的 SRT；内容只需能被 validate_args 看到文件。"""
    path = tmp_path / name
    path.write_text(
        body
        or "1\n00:00:00,000 --> 00:00:02,000\n你好世界\n",
        encoding="utf-8",
    )
    return path


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
    assert "exactly one of --voice or --design" in capsys.readouterr().err


def test_defaults():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                      "--voice", "Serena"])
    assert args.lang == "chinese"
    assert args.max_speed == 1.30
    assert not hasattr(args, "sample_rate")


def test_sample_rate_flag_was_removed(tmp_path):
    # 输出固定 24 kHz；旧的 --sample-rate 不再接受，避免静默变调。
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                   "--voice", "Serena", "--sample-rate", "16000"])


def test_abbreviated_flags_are_not_accepted():
    # allow_abbrev=False：`--voi` 不能被当成 --voice 静默接受。
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                   "--voi", "Serena"])


def test_yes_help_notes_dry_run_exemption():
    help_text = build_parser().format_help()
    assert "真实运行必需" in help_text
    assert "--dry-run" in help_text


def test_required_imports_local_vs_online():
    assert "mlx_audio" in required_imports(["--provider", "local"])
    assert "mlx_audio" not in required_imports(["--provider", "online"])


# --- supplementary coverage -------------------------------------------------


def test_required_imports_preview_is_base_only():
    # dry-run / help 只解析、不创建 provider：绝不触发 mlx_audio / requests。
    assert required_imports(["--provider", "local", "--dry-run"]) == BASE_IMPORTS
    assert required_imports(["--provider", "online", "--dry-run"]) == BASE_IMPORTS
    assert required_imports(["--provider", "local", "--help"]) == BASE_IMPORTS
    assert required_imports(["--provider=local", "-h"]) == BASE_IMPORTS


def test_required_imports_preview_prefixes_stay_base_only():
    # 缩写前缀在 argparse 里会被拒绝，但预检阶段也不该先装模型依赖。
    assert required_imports(["--provider", "local", "--dry"]) == BASE_IMPORTS
    assert required_imports(["--provider", "online", "--hel"]) == BASE_IMPORTS
    assert required_imports(["--provider", "local", "--h"]) == BASE_IMPORTS
    assert required_imports(["--provider", "local", "--dry-run=1"]) == BASE_IMPORTS
    # `--` 是选项终止符，不是预览。
    assert "mlx_audio" in required_imports(["--", "--provider", "local"])


def test_required_imports_supports_equals_form():
    assert "mlx_audio" in required_imports(["--provider=local"])
    assert "mlx_audio" not in required_imports(["--provider=online"])
    assert "requests" in required_imports(["--provider", "online"])
    assert "requests" not in required_imports(["--provider", "local"])


def test_local_requires_voice_or_design(tmp_path, capsys):
    args = build_parser().parse_args(["--srt", str(_write_srt(tmp_path)),
                                      "--provider", "local"])
    with pytest.raises(SystemExit):
        validate_args(args)
    assert "exactly one of --voice or --design" in capsys.readouterr().err


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


def test_dry_run_prints_plan_without_preparing_or_synthesizing(tmp_path, capsys):
    srt = _write_srt(
        tmp_path,
        body=(
            "1\n00:00:00,000 --> 00:00:02,000\n你好世界\n\n"
            "2\n00:00:02,000 --> 00:00:04,000\n第二句\n"
        ),
    )

    def _explode(*args, **kwargs):
        raise AssertionError("dry-run must not create or prepare a provider")

    import skill_main

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(skill_main, "get_provider", _explode)
        code = skill_main.main(
            ["--srt", str(srt), "--provider", "local", "--voice", "Serena",
             "--dry-run"]
        )

    assert code == 0
    out = capsys.readouterr().out
    assert "条目: 2 条" in out
    assert "总字数: 7 字" in out
    assert "00:00:02.000" in out
    assert "第二句" in out


# --- I2: VoiceDesign model selection and coherence --------------------------


def _local_args(tmp_path, *extra):
    return build_parser().parse_args(
        ["--srt", str(_write_srt(tmp_path)), "--provider", "local", *extra]
    )


def test_design_mode_defaults_to_voice_design_model(tmp_path, monkeypatch):
    args = _local_args(tmp_path, "--design", "温柔、年轻的男声")
    captured = {}

    def fake_get_provider(name, **kwargs):
        captured["name"] = name
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(skill_main, "get_provider", fake_get_provider)
    _build_provider(args, args.design)
    assert captured == {
        "name": "local",
        "design": "温柔、年轻的男声",
        "model_id": LOCAL_DESIGN_MODEL,
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


# --- I6 / M18: voice and model validation exits 2 ---------------------------


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


# --- M12: --out semantics ---------------------------------------------------


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


# --- M17 / M20: reports survive mux failure and show character counts -------


class _FakeProvider:
    model_id = LOCAL_MODEL

    def prepare(self):
        pass

    def synthesize(self, text, voice, instruct="", lang="chinese"):
        return np.full(24000, 0.2, dtype=np.float32)


def _patch_run(monkeypatch, mux):
    monkeypatch.setattr(
        skill_main, "probe_video",
        lambda path: VideoInfo(2.0, "h264", 320, 240, "24/1"),
    )
    monkeypatch.setattr(skill_main, "_require_binary", lambda name: None)
    monkeypatch.setattr(
        skill_main, "get_provider", lambda *args, **kwargs: _FakeProvider()
    )
    monkeypatch.setattr(skill_main, "mux_video", mux)


def test_track_and_json_report_survive_mux_failure(tmp_path, capsys, monkeypatch):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"")
    report = tmp_path / "report.json"

    def boom(*args, **kwargs):
        raise RuntimeError("mux boom")

    _patch_run(monkeypatch, boom)
    code = skill_main.main([
        "--srt", str(srt), "--video", str(video), "--provider", "local",
        "--voice", "Serena", "--out", str(tmp_path / "out"),
        "--no-cache", "--json-report", str(report),
    ])
    captured = capsys.readouterr()
    assert code == 1
    assert "配音轨:" in captured.out
    assert "4 字" in captured.out
    assert "mux boom" in captured.err

    payload = json.loads(report.read_text(encoding="utf-8"))
    assert payload["track"].endswith("out.dub.wav")
    assert payload["output"] is None
    assert len(payload["cues"]) == 1


def test_json_report_records_output_after_successful_mux(
    tmp_path, capsys, monkeypatch
):
    srt = _write_srt(tmp_path)
    video = tmp_path / "in.mp4"
    video.write_bytes(b"")
    report = tmp_path / "report.json"
    _patch_run(monkeypatch, lambda *args, **kwargs: None)
    monkeypatch.setattr(skill_main, "verify_output", lambda *a, **k: None)

    code = skill_main.main([
        "--srt", str(srt), "--video", str(video), "--provider", "local",
        "--voice", "Serena", "--out", str(tmp_path / "out"),
        "--no-cache", "--json-report", str(report),
    ])
    assert code == 0
    assert "成片:" in capsys.readouterr().out
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert payload["output"].endswith("out.dub.mp4")


def test_print_report_includes_total_chars(capsys):
    cue = Cue(1, 0.0, 1.0, "你好世界", 0.0, 1.0)
    result = SegmentResult(cue, 1.0, 1.0, 1.0, FitAction.FIT, None, False)
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
