import pytest

from results import build_result, make_word, validate_result


def test_build_result_full_shape():
    result = build_result(
        provider="qwen", backend="mlx", model_id="mlx-community/Qwen3-ASR-1.7B-8bit",
        language="zh", duration=12.4, text="示例",
        words=[make_word(0.8, 1.6, "示例")],
        segments=[{"start": 0.8, "end": 3.2, "text": "示例字幕。", "speaker_id": None}],
        model_revision="abc123", weight_precision="8bit", compute_dtype="float16",
    )
    assert result["schema_version"] == 1
    assert result["status"] == "complete"
    assert result["words"][0]["speaker_id"] is None
    assert validate_result(result) == []


def test_unknown_fields_stay_null_not_fabricated():
    result = build_result(
        provider="scribe", backend="http", model_id="scribe_v2",
        language=None, duration=None, text="hi",
    )
    assert result["model_revision"] is None
    assert result["weight_precision"] is None
    assert result["compute_dtype"] is None
    assert result["duration_seconds"] is None
    assert result["words"] == []


def test_invalid_status_rejected():
    with pytest.raises(ValueError):
        build_result(provider="qwen", backend="torch", model_id="x",
                     language="zh", duration=1.0, text="", status="bogus")


def test_validate_flags_backwards_words():
    result = build_result(
        provider="qwen", backend="torch", model_id="m", language="en", duration=10.0,
        text="a b",
        words=[make_word(5.0, 6.0, "b"), make_word(0.0, 1.0, "a")],
    )
    issues = validate_result(result)
    assert any("starts before the previous unit" in i for i in issues)


def test_validate_flags_end_before_start_and_past_duration():
    result = build_result(
        provider="qwen", backend="torch", model_id="m", language="en", duration=10.0,
        text="x y",
        words=[make_word(2.0, 1.0, "x"), make_word(0.0, 12.0, "y")],
    )
    issues = validate_result(result)
    assert any("ends before it starts" in i for i in issues)
    assert any("past the media duration" in i for i in issues)


def test_silent_success_flagged():
    result = build_result(provider="scribe", backend="http", model_id="s",
                          language=None, duration=5.0, text="", status="complete")
    assert any("no_speech" in i or "silent success" in i for i in validate_result(result))


def test_empty_text_with_no_speech_warning_is_valid():
    result = build_result(provider="scribe", backend="http", model_id="s",
                          language=None, duration=5.0, text="",
                          warnings=["no_speech: nothing detected"])
    assert validate_result(result) == []
