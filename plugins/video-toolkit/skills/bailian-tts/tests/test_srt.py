from bailian_tts.srt import parse_srt, Subtitle


def test_parse_standard(tmp_path):
    f = tmp_path / "a.srt"
    f.write_text(
        "1\n00:00:01,000 --> 00:00:03,000\n你好世界\n\n"
        "2\n00:00:03,500 --> 00:00:05,000\n第二句\n",
        encoding="utf-8",
    )
    subs = parse_srt(f)
    assert len(subs) == 2
    assert subs[0] == Subtitle(index=1, start=1.0, end=3.0, text="你好世界")
    assert subs[1] == Subtitle(index=2, start=3.5, end=5.0, text="第二句")


def test_parse_multiline_merged(tmp_path):
    f = tmp_path / "a.srt"
    f.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\n第一行\n第二行\n",
        encoding="utf-8",
    )
    subs = parse_srt(f)
    assert subs[0].text == "第一行 第二行"   # 多行合并为一行


def test_parse_skips_empty_entries(tmp_path):
    f = tmp_path / "a.srt"
    f.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n\n\n"      # 空文本
        "2\n00:00:01,000 --> 00:00:02,000\n有效\n",
        encoding="utf-8",
    )
    subs = parse_srt(f)
    assert len(subs) == 1
    assert subs[0].text == "有效"
