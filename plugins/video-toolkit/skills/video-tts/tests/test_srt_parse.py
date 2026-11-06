from pathlib import Path

import pytest

from srt_parse import (
    Cue,
    SRTError,
    load_cues,
    normalize_text,
    parse_srt,
    parse_timestamp,
)


def test_parse_timestamp_comma_and_dot():
    assert parse_timestamp("00:01:02,500") == 62.5
    assert parse_timestamp("00:00:05.200") == 5.2


def test_normalize_joins_cjk_without_space_and_ascii_with_space():
    assert normalize_text("你好\n世界") == "你好世界"
    assert normalize_text("hello\nworld") == "hello world"
    assert normalize_text("  a\n  b  ") == "a b"


def test_load_cues_computes_effective_start_and_next_start(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:01,000 --> 00:00:02,000\n第一句\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\n第二句\n",
        encoding="utf-8",
    )
    cues, warnings = load_cues(srt, video_duration=10.0)
    assert [c.text for c in cues] == ["第一句", "第二句"]
    assert cues[0].effective_start == 1.0
    assert cues[0].next_start == 3.0
    assert cues[1].next_start == 10.0
    assert warnings == []


def test_load_cues_rejects_bad_times_with_index(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text("1\n00:00:05,000 --> 00:00:04,000\n坏条目\n", encoding="utf-8")
    with pytest.raises(SRTError, match="1"):
        load_cues(srt)


def test_load_cues_rejects_zero_duration_and_negative(tmp_path: Path):
    zero = tmp_path / "zero.srt"
    zero.write_text("1\n00:00:05,000 --> 00:00:05,000\n零时长\n", encoding="utf-8")
    with pytest.raises(SRTError, match="1"):
        load_cues(zero)
    neg = tmp_path / "neg.srt"
    neg.write_text("1\n-00:00:01,000 --> 00:00:02,000\n负数\n", encoding="utf-8")
    with pytest.raises(SRTError, match="1"):
        load_cues(neg)


def test_load_cues_clamps_end_to_video_duration(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text("1\n00:00:01,000 --> 00:00:20,000\n超长\n", encoding="utf-8")
    cues, warnings = load_cues(srt, video_duration=10.0)
    assert cues[0].end == 10.0
    assert any("clamp" in w or "夹" in w for w in warnings)


def test_load_cues_overlap_clamps_effective_start(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:01,000 --> 00:00:05,000\n第一句\n\n"
        "2\n00:00:03,000 --> 00:00:06,000\n第二句\n",
        encoding="utf-8",
    )
    cues, warnings = load_cues(srt, video_duration=10.0)
    assert cues[1].effective_start == 5.0
    assert warnings


def test_end_timestamp_tolerates_trailing_position_suffix(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:01,000 --> 00:00:04,000 X1:100 X2:200\n带位置后缀\n",
        encoding="utf-8",
    )
    cues, warnings = load_cues(srt)
    assert len(cues) == 1
    assert cues[0].end == 4.0
    assert not any("块" in warning for warning in warnings)


def test_malformed_blocks_produce_numbered_warnings(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n好\n\n"
        "2\n这不是时间轴\n坏块\n\n"
        "3\n00:00:02,000 --> 00:00:03,000\n好\n",
        encoding="utf-8",
    )
    warnings: list[str] = []
    cues = parse_srt(srt, warnings=warnings)
    assert [cue.text for cue in cues] == ["好", "好"]
    assert len(warnings) == 1
    assert "第 2 块" in warnings[0]
    assert "缺少时间轴" in warnings[0]


def test_unparseable_timestamp_produces_numbered_warning(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:00,000 --> not-a-time\n坏时间\n", encoding="utf-8"
    )
    warnings: list[str] = []
    assert parse_srt(srt, warnings=warnings) == []
    assert "第 1 块" in warnings[0]
    assert "时间戳无法解析" in warnings[0]


def test_load_cues_includes_malformed_block_warnings(tmp_path: Path):
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n好\n\n"
        "2\n缺少时间轴\n",
        encoding="utf-8",
    )
    cues, warnings = load_cues(srt)
    assert len(cues) == 1
    assert any("第 2 块" in warning for warning in warnings)
