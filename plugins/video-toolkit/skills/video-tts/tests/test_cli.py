import pytest
from skill_main import build_parser, validate_args
from run import required_imports

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
    assert args.sample_rate == 24000


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
    assert "00:00:02.000" in out
    assert "第二句" in out
