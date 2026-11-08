# 覆盖验收用例 A01/A03/A04/A05/A06/A07 的结构层断言（见需求文档 §16.1）。
from pathlib import Path

import pytest

from srt_struct import (
    Diagnostic,
    SrtFormatError,
    parse_srt,
    parse_timestamp,
    read_text,
    render_srt,
)

STD = "1\n00:00:01,000 --> 00:00:04,000\nhello worlld\n\n2\n00:00:04,000 --> 00:00:06,500\ngood\n"


def test_parse_timestamp_accepts_comma_and_dot():
    assert parse_timestamp("00:01:02,500") == 62500
    assert parse_timestamp("00:00:05.200") == 5200


def test_roundtrip_replaces_only_text():
    doc = parse_srt(STD)
    out = render_srt(doc.entries, {"entry-000001": "hello world"})
    assert out == "1\n00:00:01,000 --> 00:00:04,000\nhello world\n\n2\n00:00:04,000 --> 00:00:06,500\ngood\n"


def test_render_preserves_coords_and_tags():
    src = (
        "1\n00:00:01,000 --> 00:00:04,000 X1:100 X2:600 Y1:20 Y2:80\n"
        '<font color="#fff">hi</font> there\n'
    )
    doc = parse_srt(src)
    out = render_srt(doc.entries, {"entry-000001": '<font color="#fff">hi</font> 你好'})
    assert "00:00:01,000 --> 00:00:04,000 X1:100 X2:600 Y1:20 Y2:80" in out
    assert '<font color="#fff">' in out


def test_bom_crlf_read_and_bomless_output(tmp_path: Path):
    p = tmp_path / "a.srt"
    p.write_bytes("﻿".encode() + STD.replace("\n", "\r\n").encode())
    doc = parse_srt(read_text(p))
    out = render_srt(doc.entries)
    assert not out.startswith("﻿") and "\r" not in out
    assert doc.entries[0].text == "hello worlld"


def test_duplicate_and_nonsequential_indices():
    src = (
        "5\n00:00:01,000 --> 00:00:02,000\n甲\n\n"
        "5\n00:00:02,000 --> 00:00:03,000\n乙\n\n"
        "1\n00:00:03,000 --> 00:00:04,000\n丙\n\n"
        "3\n00:00:04,000 --> 00:00:05,000\n丁\n"
    )
    doc = parse_srt(src)
    assert [e.entry_id for e in doc.entries] == [
        "entry-000001",
        "entry-000002",
        "entry-000003",
        "entry-000004",
    ]
    codes = {d.code for d in doc.diagnostics}
    assert "index_duplicate" in codes
    assert "index_nonsequential" in codes
    out = render_srt(doc.entries)
    assert out.split("\n").count("5") == 2  # 两个 "5" 原样保留，不重编号
    assert out.split("\n").count("1") == 1 and out.split("\n").count("3") == 1


def test_reversed_time_raises():
    with pytest.raises(SrtFormatError) as e:
        parse_srt("1\n00:00:05,000 --> 00:00:01,000\nx\n")
    assert e.value.entry_id == "entry-000001"


def test_garbage_time_raises():
    with pytest.raises(SrtFormatError):
        parse_srt("1\n00:00:0X,000 --> 00:00:04,000\nx\n")


@pytest.mark.parametrize("value", ["00:60:00,000", "00:00:60,000", "00:99:99,000"])
def test_invalid_minute_or_second_raises(value):
    with pytest.raises(SrtFormatError):
        parse_timestamp(value)


def test_block_without_timeline_raises():
    with pytest.raises(SrtFormatError):
        parse_srt("1\n只有正文没有时间行\n")


def test_empty_input_raises():
    with pytest.raises(SrtFormatError):
        parse_srt("")
    with pytest.raises(SrtFormatError):
        parse_srt("   \n\n  \n")


def test_existing_overlap_diagnosed_not_fixed():
    src = (
        "1\n00:00:01,000 --> 00:00:05,000\n前一条\n\n"
        "2\n00:00:04,000 --> 00:00:06,000\n后一条\n"
    )
    doc = parse_srt(src)
    assert any(d.code == "overlap_existing" and d.entry_id == "entry-000002" for d in doc.diagnostics)
    out = render_srt(doc.entries)
    assert "00:00:01,000 --> 00:00:05,000" in out and "00:00:04,000 --> 00:00:06,000" in out


def test_long_entry_untouched():
    src = "1\n00:00:00,000 --> 00:00:15,000\n第一行\n第二行\n第三行\n"
    doc = parse_srt(src)
    assert len(doc.entries) == 1
    assert doc.diagnostics == []
    assert doc.entries[0].text == "第一行\n第二行\n第三行"


def test_unknown_new_text_id_raises():
    doc = parse_srt(STD)
    with pytest.raises(SrtFormatError):
        render_srt(doc.entries, {"entry-000099": "x"})


def test_multiline_replacement_text():
    doc = parse_srt(STD)
    out = render_srt(doc.entries, {"entry-000001": "第一行\n第二行"})
    assert "第一行\n第二行\n" in out


def test_missing_index_line_diagnosed():
    doc = parse_srt("00:00:01,000 --> 00:00:02,000\n无序号条目\n")
    assert any(d.code == "index_missing" for d in doc.diagnostics)
    out = render_srt(doc.entries)
    assert out == "00:00:01,000 --> 00:00:02,000\n无序号条目\n"


def test_empty_text_and_zero_duration_diagnosed():
    doc = parse_srt("1\n00:00:01,000 --> 00:00:01,000\n\n2\n00:00:02,000 --> 00:00:03,000\nok\n")
    codes = {d.code for d in doc.diagnostics}
    assert "text_empty" in codes and "duration_zero" in codes
