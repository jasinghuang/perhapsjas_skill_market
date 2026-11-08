import copy
import hashlib
import json
from pathlib import Path

import pytest

from semantic_timing import snapshot, schedule
from srt_struct import parse_srt
from test_cli import prepare, review, finish, material
from conftest import run_cli


def srt(rows):
    return "\n\n".join(f"{i}\n{a} --> {b}\n{t}" for i, (a, b, t) in enumerate(rows, 1)) + "\n"


SOURCE = srt([("00:00:00,000", "00:00:04,000", "Even big AI"),
              ("00:00:04,000", "00:00:10,000", "companies now pay creators.")])
DRAFT = {"blocks": [{"id": "b1", "units": [
    {"source": "Even big AI companies", "text": "连大型 AI 公司也开始"},
    {"source": "now pay creators.", "text": "付费邀请创作者合作。"}]}]}


def test_semantic_changes_count_and_internal_boundaries():
    source = snapshot(SOURCE)
    draft = {"blocks": [{"id": "b1", "units": [
        {"source": "Even big AI", "text": "连大型 AI 公司"},
        {"source": "companies now", "text": "如今也开始"},
        {"source": "pay creators.", "text": "付费邀请创作者合作。"}]}]}
    content, plan = schedule(source, draft)
    entries = parse_srt(content).entries
    assert len(entries) == 3 and entries[0].start_ms == 0 and entries[-1].end_ms == 10000
    assert plan["blocks"][0]["source_range"] == [0, len(source["document"])]
    assert len(plan["blocks"][0]["anchors"]) == 3


def test_source_anchors_determine_time_not_chinese_length():
    _, plan = schedule(snapshot(SOURCE), DRAFT)
    altered = copy.deepcopy(DRAFT)
    altered["blocks"][0]["units"][0]["text"] *= 5
    _, another = schedule(snapshot(SOURCE), altered)
    assert [c["start_ms"] for c in plan["cues"]] == [c["start_ms"] for c in another["cues"]]
    assert abs(plan["cues"][0]["end_ms"] - another["cues"][0]["end_ms"]) <= 300
    shifted_source = SOURCE.replace("00:00:04,000", "00:00:06,000")
    _, shifted = schedule(snapshot(shifted_source), DRAFT)
    assert plan["cues"][0]["end_ms"] != shifted["cues"][0]["end_ms"]


@pytest.mark.parametrize("quote", ["Even big", "Missing big AI companies", "Even big AI companies now pay creators. extra"])
def test_missing_unknown_duplicate_source_rejected(quote):
    bad = copy.deepcopy(DRAFT)
    bad["blocks"][0]["units"][0]["source"] = quote
    with pytest.raises(ValueError): schedule(snapshot(SOURCE), bad)


def test_uncovered_tail_and_word_internal_boundary_rejected():
    bad = copy.deepcopy(DRAFT)
    bad["blocks"][0]["units"].pop()
    with pytest.raises(ValueError, match="未覆盖"): schedule(snapshot(SOURCE), bad)
    bad["blocks"][0]["units"][0]["source"] = "Even big AI compan"
    with pytest.raises(ValueError): schedule(snapshot(SOURCE), bad)


def test_single_entry_multiple_blocks_unicode_offsets_deterministic():
    source = snapshot(srt([("00:00:00,000", "00:00:10,000", "😀 é hello. World ends.")]))
    draft = {"blocks": [{"id": "b1", "units": [{"source": "😀 é hello.", "text": "你好。"}]},
                        {"id": "b2", "units": [{"source": "World ends.", "text": "世界结束。"}]}]}
    a, plan = schedule(source, draft)
    assert schedule(source, draft)[0] == a
    assert plan["blocks"][0]["source_range"][1] == len("😀 é hello.")
    assert plan["blocks"][0]["end_ms"] < plan["blocks"][1]["start_ms"]


def test_silence_not_filled_and_block_must_not_cross():
    source = snapshot(srt([("00:00:00,000", "00:00:02,000", "Hello."),
                           ("00:00:12,000", "00:00:14,000", "World.")]))
    one = {"blocks": [{"id": "b1", "units": [{"source": "Hello. World.", "text": "你好世界。"}]}]}
    with pytest.raises(ValueError, match="留白"): schedule(source, one)
    one["blocks"][0]["units"] = [{"source": "Hello.", "text": "你好。"}, {"source": "World.", "text": "世界。"}]
    with pytest.raises(ValueError, match="留白"): schedule(source, one)
    good = {"blocks": [{"id": "b1", "units": [one["blocks"][0]["units"][0]]},
                       {"id": "b2", "units": [one["blocks"][0]["units"][1]]}]}
    _, plan = schedule(source, good)
    assert plan["cues"][0]["end_ms"] == 2000 and plan["cues"][1]["start_ms"] == 12000


def test_overlaps_rounding_diagnosed_substantial_blocked():
    tiny = SOURCE.replace("00:00:04,000 -->", "00:00:03,999 -->")
    _, plan = schedule(snapshot(tiny), DRAFT)
    assert any(w["code"] == "rounding_overlap" for w in plan["diagnostics"])
    with pytest.raises(ValueError, match="重叠"):
        snapshot(SOURCE.replace("00:00:04,000 -->", "00:00:03,000 -->"))


def test_style_wrapped_cues_preserved_and_complex_not_silently_lost():
    src = srt([("00:00:00,000", "00:00:04,000", '<i>Hello world.</i>')])
    draft = {"blocks": [{"id": "b1", "units": [{"source": "Hello", "text": "你好"},
                                                       {"source": "world.", "text": "世界。"}]}]}
    out, _ = schedule(snapshot(src), draft)
    assert out.count("<i>") == out.count("</i>") == 2
    with pytest.raises(ValueError, match="复杂样式"):
        schedule(snapshot(src.replace('<i>Hello world.</i>', 'Hello <i>world.</i>')), draft)


def test_zero_or_tiny_duration_not_published():
    with pytest.raises(ValueError): snapshot(SOURCE.replace("00:00:04,000", "00:00:00,000", 1))
    tiny = snapshot(srt([("00:00:00,000", "00:00:00,001", "One two three.")]))
    draft = {"blocks": [{"id": "b1", "units": [{"source": x, "text": "字"} for x in ["One", "two", "three."]]}]}
    with pytest.raises(ValueError): schedule(tiny, draft)


def word_data(source):
    doc = source["document"]
    return {"source_sha256": "source", "document_sha256": hashlib.sha256(doc.encode()).hexdigest(),
            "words": [{"text": "Hello", "start_char": 0, "end_char": 5, "start_ms": 0, "end_ms": 1000},
                      {"text": "world.", "start_char": 6, "end_char": 12, "start_ms": 2000, "end_ms": 4000}]}


def test_word_timing_real_anchors_and_pauses():
    text = srt([("00:00:00,000", "00:00:04,000", "Hello world.")])
    data = word_data(snapshot(text))
    source = snapshot(text, timing_data=data, source_sha256="source")
    draft = {"blocks": [{"id": "b1", "units": [{"source": "Hello", "text": "你好。"}]},
                        {"id": "b2", "units": [{"source": "world.", "text": "世界。"}]}]}
    _, plan = schedule(source, draft)
    assert plan["cues"][0]["end_ms"] == 1000 and plan["cues"][1]["start_ms"] == 2000
    assert plan["basis"] == "word-timestamps"
    data["source_sha256"] = "wrong"
    with pytest.raises(ValueError): snapshot(text, timing_data=data, source_sha256="source")


@pytest.mark.parametrize("field,value", [("start_char", 2), ("end_ms", 5000), ("text", "wrong"), ("start_ms", 3000)])
def test_invalid_word_metadata_rejected(field, value):
    text = srt([("00:00:00,000", "00:00:04,000", "Hello world.")])
    data = word_data(snapshot(text))
    data["words"][0][field] = value
    with pytest.raises(ValueError): snapshot(text, timing_data=data, source_sha256="source")


def test_semantic_cli_final_candidate_binding_and_cleanup(material):
    src, _ = material
    src.write_text(SOURCE)
    packet = prepare(src, "--task", "translate", "--target-lang", "zh", "--timing", "semantic",
                     "--timing-reason", "srt-estimate")
    draft = Path(packet["draft_path"])
    draft.write_text(json.dumps(DRAFT))
    report = review(packet, draft)
    jobfile = draft.parent / "request.json"
    job = json.loads(jobfile.read_text())
    job["semantic_source"]["parameters"]["line_chars"] = 19
    jobfile.write_text(json.dumps(job))
    code, result = finish(packet, draft, report)
    assert code == 3 and "排时参数" in result["error"]
    report = review(packet, draft)
    code, result = finish(packet, draft, report)
    assert code == 0 and not draft.parent.exists()
    assert "估算" in "".join(result["warnings"])


def test_reading_tail_extension_is_local_and_does_not_move_next_onset():
    source = snapshot(SOURCE)
    draft = copy.deepcopy(DRAFT)
    draft["blocks"][0]["units"][0]["text"] = "很多需要阅读的文字" * 5
    _, plan = schedule(source, draft)
    first, second = plan["cues"]
    assert 0 <= first.get("tail_extension_ms", 0) <= 300
    assert first["end_ms"] <= second["start_ms"]
    assert first["start_ms"] == 0 and second["end_ms"] == 10000


@pytest.mark.parametrize("parameters", [{"unknown": 1}, {"gap_ms": 0}, {"max_tail_ms": float('inf')}])
def test_invalid_or_unknown_parameters_rejected(parameters):
    with pytest.raises(ValueError): snapshot(SOURCE, parameters=parameters)


def test_local_blocks_and_anchors_exist_for_every_section():
    draft = copy.deepcopy(DRAFT)
    units = draft["blocks"][0]["units"]
    draft["blocks"] = [{"id": "a", "units": [units[0]]}, {"id": "b", "units": [units[1]]}]
    _, plan = schedule(snapshot(SOURCE), draft)
    assert len(plan["blocks"]) == 2
    for block, cue in zip(plan["blocks"], plan["cues"]):
        assert (block["start_ms"], block["end_ms"]) == (cue["start_ms"], cue["end_ms"])
        assert block["anchors"][0]["time_ms"] == cue["start_ms"]


def test_explicit_empty_timing_config_not_silently_ignored_in_preserve(material):
    source, temporary = material
    params = temporary / "params.json"
    params.write_text('{}')
    code, out, _ = run_cli('prepare', str(source), '--task', 'proofread', '--timing-parameters', str(params))
    assert code == 3 and 'semantic' in json.loads(out)['error']
