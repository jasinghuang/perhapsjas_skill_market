import pytest
from skill_main import build_parser, validate_args
from run import required_imports


def test_online_requires_yes():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "online",
                                      "--voice", "Cherry"])
    with pytest.raises(SystemExit):
        validate_args(args)


def test_local_design_and_voice_are_mutually_exclusive():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                      "--voice", "Serena", "--design", "温柔"])
    with pytest.raises(SystemExit):
        validate_args(args)


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


def test_required_imports_supports_equals_form():
    assert "mlx_audio" in required_imports(["--provider=local"])
    assert "mlx_audio" not in required_imports(["--provider=online"])
    assert "requests" in required_imports(["--provider", "online"])
    assert "requests" not in required_imports(["--provider", "local"])


def test_local_requires_voice_or_design():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "local"])
    with pytest.raises(SystemExit):
        validate_args(args)


def test_online_rejects_design():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "online",
                                      "--design", "温柔", "--yes"])
    with pytest.raises(SystemExit):
        validate_args(args)


def test_max_speed_below_one_is_rejected():
    args = build_parser().parse_args(["--srt", "a.srt", "--provider", "local",
                                      "--voice", "Serena", "--max-speed", "0.9"])
    with pytest.raises(SystemExit):
        validate_args(args)


def test_missing_srt_is_rejected_after_structural_checks():
    args = build_parser().parse_args(["--srt", "definitely-missing.srt",
                                      "--provider", "local", "--voice", "Serena"])
    with pytest.raises(SystemExit):
        validate_args(args)


def test_dry_run_prints_plan_without_preparing_or_synthesizing(tmp_path, capsys):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\n你好世界\n\n"
        "2\n00:00:02,000 --> 00:00:04,000\n第二句\n",
        encoding="utf-8",
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
    assert "2" in out
    assert "第二句" in out
