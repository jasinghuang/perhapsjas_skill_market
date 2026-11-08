"""验证真实文件行为；审校 JSON 是结构测试数据，不代表模型质量评测。"""
import json
from pathlib import Path

import pytest

from conftest import run_cli
from srt_struct import parse_srt

SRT = ("1\n00:00:00,000 --> 00:00:02,000\nEven big AI\n\n"
       "2\n00:00:02,000 --> 00:00:04,000\ncompanies pay creators.\n")


@pytest.fixture
def material(tmp_path, monkeypatch):
    source_dir = tmp_path / "素材 空格"
    source_dir.mkdir()
    internal = tmp_path / "system-temp"
    internal.mkdir()
    monkeypatch.setenv("TMPDIR", str(internal))
    monkeypatch.setenv("TMP", str(internal))
    monkeypatch.setenv("TEMP", str(internal))
    source = source_dir / 'input "中文".srt'
    source.write_text(SRT, encoding="utf-8")
    return source, internal


def prepare(source, *args):
    code, out, err = run_cli("prepare", str(source), *args)
    assert code == 0, (out, err)
    return json.loads(out)


def write_draft(packet, texts=None):
    texts = texts or ["连大型 AI 公司也开始", "付费邀请创作者合作。"]
    rows = [{"id": item["id"], "text": text}
            for item, text in zip(packet["items"], texts)]
    path = Path(packet["draft_path"])
    path.write_text(json.dumps({"items": rows}, ensure_ascii=False), encoding="utf-8")
    return path


def review(packet, draft, **changes):
    code, out, err = run_cli("review-input", packet["working_dir"], "--draft", str(draft))
    assert code == 0, (out, err)
    inputs = json.loads(out)
    data = {"reviewer_id": "test-independent-reviewer",
            "source_sha256": inputs["source_sha256"], "draft_sha256": inputs["draft_sha256"],
            "criteria": ["信", "达", "雅"], "coverage": [[1, inputs["source_count"]]],
            "verdict": "pass", "findings": []}
    data.update(changes)
    path = Path(packet["review_path"])
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def finish(packet, draft, report=None, *args):
    params = ["finish", packet["working_dir"], "--draft", str(draft)]
    if report:
        params += ["--review", str(report)]
    code, out, err = run_cli(*params, *args)
    return code, json.loads(out)


def test_prepare_whole_document_with_timing_terms_and_no_material_folder(material):
    source, internal = material
    terms = internal / "terms.txt"
    terms.write_text("character sheet = 角色设定图", encoding="utf-8")
    p = prepare(source, "--task", "translate", "--target-lang", "zh", "--terms", str(terms),
                "--allow-simplify")
    assert len(p["items"]) == 2 and p["items"][0]["duration_ms"] == 2000
    assert p["terms"] == terms.read_text() and p["allow_simplify"] is True
    assert Path(p["working_dir"]).parent == internal
    assert list(source.parent.iterdir()) == [source]


def test_large_input_not_split_by_entry_count(material):
    source, _ = material
    source.write_text("\n\n".join(
        f"{i}\n00:00:00,000 --> 00:00:01,000\nSentence {i}." for i in range(1, 501)))
    p = prepare(source, "--task", "proofread")
    assert len(p["items"]) == 500
    assert "chunks" not in p and "state.json" not in [f.name for f in Path(p["working_dir"]).iterdir()]


def test_translate_requires_independent_review(material):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    code, out = finish(p, d)
    assert code == 3 and "独立" in out["error"]
    assert Path(p["working_dir"]).exists() and list(source.parent.iterdir()) == [source]


def test_success_preserves_time_allows_adjacent_redistribution_and_cleans_temp(material):
    source, internal = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    r = review(p, d)
    code, out = finish(p, d, r)
    assert code == 0 and out["quality_review"] == "independent"
    output = Path(out["output"])
    original, translated = parse_srt(SRT).entries, parse_srt(output.read_text()).entries
    assert [(e.index_raw, e.timeline_raw) for e in original] == [
        (e.index_raw, e.timeline_raw) for e in translated]
    assert translated[0].text == "连大型 AI 公司也开始"
    assert len(list(source.parent.iterdir())) == 2
    assert not Path(p["working_dir"]).exists() and list(internal.iterdir()) == []
    assert source.read_text() == SRT


@pytest.mark.parametrize("changes", [
    {"reviewer_id": "main"}, {"reviewer_id": ""}, {"verdict": "revise"},
    {"coverage": [[1, 1]]}, {"coverage": [[1, 2], [2, 2]]}, {"coverage": [[2, 2]]},
    {"source_sha256": "stale"}, {"draft_sha256": "stale"}, {"criteria": ["信"]},
    {"findings": [{"severity": "required", "status": "open"}]},
    {"findings": [{"severity": "typo", "status": "resolved"}]},
])
def test_review_gate_rejects_self_partial_stale_or_unresolved(material, changes):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    r = review(p, d, **changes)
    code, out = finish(p, d, r)
    assert code == 3 and not out["ok"]
    assert list(source.parent.iterdir()) == [source]


def test_revision_invalidates_review_and_can_be_reviewed_again(material):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    r = review(p, d)
    d = write_draft(p, ["大型 AI 公司也开始", "付费请创作者合作。"])
    assert finish(p, d, r)[0] == 3
    r = review(p, d)
    assert finish(p, d, r)[0] == 0


def test_source_change_blocks_old_draft(material):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    r = review(p, d)
    source.write_text(SRT.replace("creators", "filmmakers"))
    code, out = finish(p, d, r)
    assert code == 3 and "源文件" in out["error"]


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "unknown", "empty", "separator", "tags"])
def test_bad_mapping_rejected_before_review(material, mutation):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    data = json.loads(d.read_text())
    if mutation == "missing": data["items"].pop()
    if mutation == "duplicate": data["items"].append(data["items"][0])
    if mutation == "unknown": data["items"][0]["id"] = "entry-999999"
    if mutation == "empty": data["items"][0]["text"] = ""
    if mutation == "separator": data["items"][0]["text"] = "正文\n\n伪条目"
    if mutation == "tags": data["items"][0]["text"] = "<i>正文</i>"
    d.write_text(json.dumps(data))
    code, out, _ = run_cli("review-input", p["working_dir"], "--draft", str(d))
    assert code == 3 and not json.loads(out)["ok"]


def test_existing_output_not_overwritten_and_no_temporary_residue(material):
    source, _ = material
    old = source.with_name(source.stem + "_refined.srt")
    old.write_text("用户已有结果")
    p = prepare(source, "--task", "proofread")
    d = write_draft(p, [i["text"] for i in p["items"]])
    code, out = finish(p, d)
    assert code == 0 and Path(out["output"]).stem.endswith("_refined_2")
    assert old.read_text() == "用户已有结果"
    assert not list(source.parent.glob(".text-refine-*"))


def test_failed_publish_retains_progress_without_partial_output(material):
    source, _ = material
    destination = source.parent / "absent" / "output.srt"
    p = prepare(source, "--task", "proofread", "--output", str(destination))
    d = write_draft(p, [i["text"] for i in p["items"]])
    assert finish(p, d)[0] == 3
    assert Path(p["working_dir"]).exists() and not destination.exists()


def test_resegment_can_change_entry_count_with_original_coverage(material):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh", "--timing", "resegment",
                "--timing-reason", "srt-estimate")
    d = Path(p["draft_path"])
    d.write_text(json.dumps({"items": [{"source_ids": [i["id"] for i in p["items"]],
        "start": "00:00:00,000", "end": "00:00:04,000", "text": "连大型 AI 公司也开始付费邀请创作者合作。"}]}))
    r = review(p, d)
    code, out = finish(p, d, r)
    assert code == 0 and any("估算" in w for w in out["warnings"])
    assert len(parse_srt(Path(out["output"]).read_text()).entries) == 1


@pytest.mark.parametrize("start,end,ids", [
    ("00:00:00,000", "00:00:00,000", ["entry-000001", "entry-000002"]),
    ("00:00:00,000", "00:00:05,000", ["entry-000001", "entry-000002"]),
    ("00:00:01,000", "00:00:04,000", ["entry-000001", "entry-000002"]),
    ("00:00:00,000", "00:00:02,000", ["entry-000001"]),
])
def test_resegment_rejects_invalid_boundaries_or_missing_sources(material, start, end, ids):
    source, _ = material
    p = prepare(source, "--task", "proofread", "--timing", "resegment", "--timing-reason", "srt-estimate")
    d = Path(p["draft_path"])
    d.write_text(json.dumps({"items": [{"source_ids": ids, "start": start, "end": end, "text": "正文"}]}))
    assert finish(p, d)[0] == 3


def test_markdown_protects_structure_code_and_links(material):
    source, _ = material
    source = source.with_suffix(".md")
    source.write_text('# Heading\n\nSee [guide](https://example.com) and `x = 1`.\n\n```sh\nexit 1\n```\n')
    p = prepare(source, "--task", "proofread")
    rows = [{"id": i["id"], "text": i["text"].replace("Heading", "标题")}
            for i in p["items"] if i["editable"]]
    d = Path(p["draft_path"])
    d.write_text(json.dumps({"items": rows}))
    rows[0]["text"] = "## 标题"
    d.write_text(json.dumps({"items": rows}))
    assert finish(p, d)[0] == 3
    rows[0]["text"] = "# 标题"
    rows[1]["text"] = "见 [指南](https://example.com) 和 `x = 1`。"
    d.write_text(json.dumps({"items": rows}))
    code, out = finish(p, d)
    assert code == 0 and "```sh\nexit 1\n```" in Path(out["output"]).read_text()


def test_txt_shell_text_remains_data_and_not_markdown(material):
    source, _ = material
    source = source.with_suffix(".txt")
    text = '命令 $(touch SHOULD_NOT_EXIST) 与 `echo hi`、SRT_EOF。\n'
    source.write_text(text)
    p = prepare(source, "--task", "proofread")
    d = write_draft(p, ["## 标题"])
    assert finish(p, d)[0] == 3
    d = write_draft(p, [text.strip()])
    code, out = finish(p, d)
    assert code == 0 and Path(out["output"]).read_text() == text
    assert not (source.parent / "SHOULD_NOT_EXIST").exists()


@pytest.mark.parametrize("extra", [
    ["--task", "translate"], ["--task", "proofread", "--target-lang", "zh"],
    ["--task", "proofread", "--allow-simplify"],
    ["--task", "proofread", "--timing", "resegment"],
])
def test_invalid_configuration_fails_without_creating_work(material, extra):
    source, internal = material
    code, out, _ = run_cli("prepare", str(source), *extra)
    assert code == 3 and not json.loads(out)["ok"] and list(internal.iterdir()) == []


def test_source_cannot_be_output(material):
    source, _ = material
    code, out, _ = run_cli("prepare", str(source), "--task", "proofread", "--output", str(source))
    assert code == 3 and source.read_text() == SRT


def test_parallel_prepares_do_not_require_user_cleanup_or_overwrite(material):
    source, internal = material
    first = prepare(source, "--task", "proofread")
    second = prepare(source, "--task", "proofread")
    assert first["working_dir"] != second["working_dir"]
    outputs = []
    for packet in (first, second):
        draft = write_draft(packet, [i["text"] for i in packet["items"]])
        code, out = finish(packet, draft)
        assert code == 0
        outputs.append(out["output"])
    assert outputs[0] != outputs[1] and list(internal.iterdir()) == []


def test_existing_empty_cue_kept_without_inventing_text(material):
    source, _ = material
    source.write_text("1\n00:00:00,000 --> 00:00:01,000\n\n2\n00:00:01,000 --> 00:00:02,000\nHello.\n")
    p = prepare(source, "--task", "proofread")
    d = write_draft(p, ["", "Hello."])
    code, out = finish(p, d)
    assert code == 0
    assert parse_srt(Path(out["output"]).read_text()).entries[0].text == ""


def test_explicit_overwrite_and_bom_crlf(material):
    source, _ = material
    source.write_bytes(b"\xef\xbb\xbf" + SRT.replace("\n", "\r\n").encode())
    old = source.with_name(source.stem + "_refined.srt")
    old.write_text("old")
    p = prepare(source, "--task", "proofread")
    d = write_draft(p, [i["text"] for i in p["items"]])
    code, out = finish(p, d, None, "--overwrite")
    assert code == 0 and Path(out["output"]) == old
    assert old.read_bytes() == SRT.encode()


def test_optional_review_finding_has_real_location_and_description(material):
    source, _ = material
    p = prepare(source, "--task", "translate", "--target-lang", "zh")
    d = write_draft(p)
    finding = {"source_ids": ["entry-000001"], "dimension": "雅", "message": "风格偏好",
               "suggestion": "可保持现译", "severity": "optional", "status": "open"}
    r = review(p, d, findings=[finding])
    assert finish(p, d, r)[0] == 0
