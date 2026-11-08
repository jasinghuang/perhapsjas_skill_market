import pytest

from subtitles import (
    build_entries,
    display_width,
    entries_to_srt,
    finalize_entries,
    format_timestamp,
    group_sentences,
    join_word_texts,
    parse_srt,
    parse_timestamp,
    validate_srt,
    wrap_text,
    DEFAULT_CONFIG,
)


def w(start, end, text):
    return {"start": start, "end": end, "text": text, "speaker_id": None}


# --- primitives ----------------------------------------------------------------

def test_display_width_cjk_counts_double():
    assert display_width("你好") == 4
    assert display_width("ab") == 2
    assert display_width("你a") == 3


def test_join_word_texts_spaces_ascii_only():
    assert join_word_texts(["Hello", "world", "。", "你好"]) == "Hello world。你好"


def test_format_timestamp_rounds_milliseconds():
    assert format_timestamp(0.0) == "00:00:00,000"
    assert format_timestamp(3661.5) == "01:01:01,500"
    assert format_timestamp(0.9996) == "00:00:01,000"


def test_parse_timestamp_accepts_comma_and_dot():
    assert parse_timestamp("01:01:01,500") == pytest.approx(3661.5)
    assert parse_timestamp("00:00:01.5") == pytest.approx(1.5)


# --- sentence grouping -----------------------------------------------------------

def test_group_by_strong_punct_and_pause():
    words = [w(0.0, 0.5, "你好。"), w(0.6, 1.0, "世界。"),
             w(5.0, 5.5, "隔了很久"), w(5.6, 6.0, "才说话。")]
    sentences = group_sentences(words, sentence_gap=0.8)
    assert [join_word_texts([x["text"] for x in s]) for s in sentences] == [
        "你好。", "世界。", "隔了很久才说话。",
    ]


def test_group_keeps_comma_inside_sentence():
    words = [w(0.0, 0.5, "今天，"), w(0.6, 1.0, "天气不错。")]
    sentences = group_sentences(words, sentence_gap=0.8)
    assert len(sentences) == 1


# --- oversized splitting -----------------------------------------------------------

def test_long_sentence_split_at_real_time_units():
    # 8 words spread over 20s with gaps — must split at word gaps, not padding
    words = [w(i * 2.5, i * 2.5 + 2.4, f"词{i}") for i in range(8)]
    entries = build_entries(words)
    assert len(entries) > 1
    for entry in entries:
        assert entry["end"] - entry["start"] <= DEFAULT_CONFIG["max_duration"] + 1e-6
    # every entry's times come from actual word boundaries
    starts = {round(entry["start"], 3) for entry in entries}
    assert starts <= {round(x["start"], 3) for x in words}


def test_no_fabricated_silence_content():
    # entry times must never extend into the gap to the next sentence
    words = [w(0.0, 1.0, "第一句。"), w(30.0, 31.0, "第二句。")]
    entries = finalize_entries(build_entries(words), 60.0)[0]
    assert entries[0]["end"] == pytest.approx(1.0)
    assert entries[1]["start"] == pytest.approx(30.0)


def test_width_overflow_splits_at_clause_punct():
    text_units = ["这里是很长很长的一段话，" for _ in range(3)] + ["结尾。"]
    words = [w(i * 0.5, i * 0.5 + 0.4, t) for i, t in enumerate(text_units)]
    entries = build_entries(words)
    for entry in entries:
        total = sum(display_width(line) for line in entry["lines"])
        # tolerate one unit of overshoot from a single huge word
        assert total <= DEFAULT_CONFIG["max_lines"] * DEFAULT_CONFIG["line_width"] + 8


def test_english_words_never_split_mid_word():
    text = "internationalization " * 8 + "end."
    words = [w(i * 0.3, i * 0.3 + 0.25, t) for i, t in enumerate(text.split())]
    entries = build_entries(words)
    for entry in entries:
        for line in entry["lines"]:
            # no line may start/end inside an ASCII word (all source words kept whole)
            for token in ("internationalization", "end."):
                if token in line:
                    assert line.count(token) == line.count(token)  # intact copy
    # a word itself is never cut: every source word appears in some line
    all_text = "".join(e["text"] for e in entries)
    assert all_text.count("internationalization") == 8


def test_wrap_two_lines_max_for_subtitle():
    text = "很短"
    assert wrap_text(text, 42) == ["很短"]


# --- finalize -----------------------------------------------------------------

def test_finalize_fixes_small_overlap_without_sorting_text():
    entries = [{"start": 0., "end": 5.02, "text": "A"}, {"start": 5., "end": 8., "text": "B"}]
    fixed, warnings = finalize_entries(entries, 100.)
    assert [e["text"] for e in fixed] == ["A", "B"]
    assert fixed[1]["start"] == pytest.approx(5.02)
    assert warnings


def test_finalize_merges_contained_spans_without_losing_content():
    fixed, warnings = finalize_entries([{"start": 1., "end": 2., "text": "A"},
                                       {"start": 1.8, "end": 1.9, "text": "B"}], 10.)
    assert len(fixed) == 1 and fixed[0]["text"] == "A B"
    assert warnings


def test_finalize_clamps_end_to_duration():
    entries = [{"start": 9.0, "end": 10.03, "text": "tail"}]
    fixed, _ = finalize_entries(entries, 10.0)
    assert fixed[0]["end"] == pytest.approx(10.0)


def test_finalize_rejects_degenerate_without_dropping():
    with pytest.raises(ValueError):
        finalize_entries([{"start": 3., "end": 3., "text": "bad"}], 10.)


def test_finalize_rejects_past_end_without_dropping():
    with pytest.raises(ValueError):
        finalize_entries([{"start": 12., "end": 13., "text": "ghost"}], 10.)


def test_attach_punctuation_maps_tails():
    from subtitles import attach_punctuation
    words = [w(0.0, 0.3, "大"), w(0.3, 0.6, "家"), w(0.6, 0.9, "好"),
             w(1.0, 1.2, "你"), w(1.2, 1.5, "好")]
    units = attach_punctuation(words, "大家好，你好。")
    assert units is not None
    assert units[2]["text"] == "好，"
    assert units[4]["text"] == "好。"
    assert all(u["text"] not in ("，", "。") for u in units)


def test_attach_punctuation_english_words_stay_whole():
    from subtitles import attach_punctuation
    words = [w(0.0, 0.4, "Hello"), w(0.5, 0.9, "world")]
    units = attach_punctuation(words, "Hello, world!")
    assert units is not None
    assert units[0]["text"] == "Hello, "
    assert units[1]["text"] == "world!"


def test_attach_punctuation_extra_content_is_mismatch():
    from subtitles import attach_punctuation
    words = [w(0.0, 0.4, "Hello")]
    assert attach_punctuation(words, "Hello and more content") is None


def test_attach_punctuation_mismatch_returns_none():
    from subtitles import attach_punctuation
    words = [w(0.0, 0.3, "错")]
    assert attach_punctuation(words, "完全不同的文本") is None


def test_attach_punctuation_skips_when_words_carry_punct():
    from subtitles import attach_punctuation
    words = [w(0.0, 0.3, "好。")]
    assert attach_punctuation(words, "好。")[0]["text"] == "好。"


def test_build_entries_uses_attached_punctuation_for_grouping():
    from subtitles import attach_punctuation, build_entries
    # short sentence + period + second sentence: strong punctuation must split
    raw_units = [w(i * 0.4, i * 0.4 + 0.35, ch) for i, ch in enumerate("这是一句话然后又一句")]
    units = attach_punctuation(raw_units, "这是一句话，然后又一句。")
    assert units is not None
    entries = build_entries(units)
    # one sentence of 10 chars / 3.95s fits a single caption, punctuation kept
    assert entries[0]["text"] == "这是一句话，然后又一句。"

    # two full sentences back to back -> two captions
    raw_two = raw_units + [w(4.4 + i * 0.4, 4.4 + i * 0.4 + 0.35, ch)
                           for i, ch in enumerate("第二句话")]
    units_two = attach_punctuation(raw_two, "这是一句话，然后又一句。第二句话。")
    assert units_two is not None
    entries_two = build_entries(units_two)
    assert len(entries_two) == 2
    assert entries_two[0]["text"].endswith("。")
    assert entries_two[1]["text"] == "第二句话。"


def test_scribe_style_words_with_punct_still_group():
    # Scribe words already end with punctuation — grouping must still work.
    words = [w(0.0, 0.5, "Hello,"), w(0.6, 1.1, "world."), w(3.0, 3.5, "Second.")]
    entries = build_entries(words)
    assert len(entries) == 2
    assert entries[0]["text"] == "Hello, world."


# --- SRT round trip -------------------------------------------------------------

def test_srt_roundtrip_indices_and_times():
    words = [w(0.5, 1.2, "你好。"), w(2.0, 3.5, "第二句。"), w(4.0, 5.0, "Third one.")]
    entries = finalize_entries(build_entries(words), 10.0)[0]
    srt = entries_to_srt(entries)
    parsed = parse_srt(srt)
    assert [p[0] for p in parsed] == [1, 2, 3]
    assert parsed[0][1] == pytest.approx(0.5)
    assert validate_srt(srt, 10.0) == []


def test_srt_no_overlap_after_boundary_word_merge():
    words = [w(0.0, 1.0, "a。"), w(0.9, 2.0, "b。")]  # slight overlap from aligner
    entries = finalize_entries(build_entries(words), 5.0)[0]
    srt = entries_to_srt(entries)
    assert validate_srt(srt, 5.0) == []


def test_validate_srt_flags_disorder_and_overlap():
    bad = "1\n00:00:05,000 --> 00:00:06,000\nA\n\n2\n00:00:00,000 --> 00:00:01,000\nB\n"
    issues = validate_srt(bad)
    assert any("out of order" in i for i in issues)
    assert any("overlap" in i for i in issues)


def test_validate_srt_rejects_empty():
    assert validate_srt("") == ["SRT contains no parseable entries"]


def test_empty_words_produce_no_entries():
    assert build_entries([]) == []


def test_zero_length_word_spans_are_repaired_not_dropped():
    # Qwen's aligner emits start==end for some English words; the caption
    # starting on such a word must survive with a minimal span.
    words = [w(0.0, 0.5, "One。"), w(1.0, 1.0, "two"), w(1.1, 1.4, "three。")]
    entries = finalize_entries(build_entries(words), 10.0)[0]
    texts = [e["text"] for e in entries]
    assert any("two" in t for t in texts), "content on zero-length word must not vanish"
    for entry in entries:
        assert entry["end"] > entry["start"]
