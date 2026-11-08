# 覆盖验收用例 A04/A08/A09/A15/A16/A17 的提交校验层断言（见需求文档 §16.1）。
import pytest

from pipeline import (
    ChunkDef,
    NewEntry,
    SubmitError,
    extract_tags,
    plan_chunks,
    render_chunk_input_srt,
    render_chunk_input_text,
    result_sha,
    submit_chunk_resegment,
    submit_chunk_srt,
    submit_chunk_text,
)
from srt_struct import parse_srt
from textblocks import split_blocks

SRC = "\n".join(
    f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},900\nline {i}\n" for i in range(1, 6)
) + "\n"
ENTRIES = parse_srt(SRC).entries

MD_SRC = (
    "# 标题\n\n"
    "见 [文档](https://a.b/c) 与 `pip install x`。\n\n"
    "```bash\nrm -rf $(echo hi)\n```\n\n"
    "尾段，见 [另](https://x.y/z)。\n"
)
BLOCKS = split_blocks(MD_SRC)  # text(1) text(2) code_fence(3) text(4)


def test_plan_chunks_boundaries():
    assert [(c.first, c.last) for c in plan_chunks(100, 40)] == [(1, 40), (41, 80), (81, 100)]
    assert [(c.first, c.last) for c in plan_chunks(5, 40)] == [(1, 5)]


def test_submit_exact_coverage_passes():
    m = submit_chunk_srt(
        ENTRIES,
        ChunkDef("chunk-0001", 1, 2),
        {
            "chunk_id": "chunk-0001",
            "items": [
                {"source_id": "entry-000001", "text": "第一行"},
                {"source_id": "entry-000002", "text": "第二行"},
            ],
        },
    )
    assert m == {"entry-000001": "第一行", "entry-000002": "第二行"}


@pytest.mark.parametrize(
    "items,frag",
    [
        ([{"source_id": "entry-000009", "text": "x"}], "entry-000009"),  # 未知
        (
            [
                {"source_id": "entry-000001", "text": "a"},
                {"source_id": "entry-000001", "text": "b"},
            ],
            "entry-000001",
        ),  # 重复
        ([{"source_id": "entry-000001", "text": "a"}], "entry-000002"),  # 遗漏
    ],
)
def test_submit_rejects_bad_ids(items, frag):
    with pytest.raises(SubmitError) as e:
        submit_chunk_srt(
            ENTRIES, ChunkDef("chunk-0001", 1, 2), {"chunk_id": "chunk-0001", "items": items}
        )
    assert frag in " ".join(e.value.issues)


def test_submit_rejects_context_id():
    payload = {
        "chunk_id": "chunk-0002",
        "items": [
            {"source_id": "entry-000002", "text": "a"},
            {"source_id": "entry-000003", "text": "b"},
            {"source_id": "entry-000005", "text": "c"},  # chunk-0002 范围外的上下文条目
        ],
    }
    with pytest.raises(SubmitError) as e:
        submit_chunk_srt(ENTRIES, ChunkDef("chunk-0002", 2, 4), payload)
    assert "entry-000005" in " ".join(e.value.issues)


def test_submit_rejects_chunk_id_mismatch():
    with pytest.raises(SubmitError):
        submit_chunk_srt(
            ENTRIES,
            ChunkDef("chunk-0001", 1, 2),
            {
                "chunk_id": "chunk-9999",
                "items": [
                    {"source_id": "entry-000001", "text": "a"},
                    {"source_id": "entry-000002", "text": "b"},
                ],
            },
        )


def test_submit_rejects_emptying_text():
    with pytest.raises(SubmitError):
        submit_chunk_srt(
            ENTRIES,
            ChunkDef("chunk-0001", 1, 1),
            {"chunk_id": "chunk-0001", "items": [{"source_id": "entry-000001", "text": ""}]},
        )


def test_extract_tags_multiset():
    assert extract_tags('<i>a</i> <font color="#fff">b</font>') == [
        "<i>",
        "</i>",
        '<font color="#fff">',
        "</font>",
    ]
    assert extract_tags("纯文本") == []


def test_submit_rejects_tag_removal():
    tagged = parse_srt("1\n00:00:01,000 --> 00:00:02,000\n<i>hi</i>\n").entries
    with pytest.raises(SubmitError):
        submit_chunk_srt(
            tagged,
            ChunkDef("chunk-0001", 1, 1),
            {"chunk_id": "chunk-0001", "items": [{"source_id": "entry-000001", "text": "hi"}]},
        )


def test_submit_allows_tag_inner_text_edit():
    tagged = parse_srt("1\n00:00:01,000 --> 00:00:02,000\n<i>helo</i>\n").entries
    m = submit_chunk_srt(
        tagged,
        ChunkDef("chunk-0001", 1, 1),
        {"chunk_id": "chunk-0001", "items": [{"source_id": "entry-000001", "text": "<i>hello</i>"}]},
    )
    assert m == {"entry-000001": "<i>hello</i>"}


def test_chunk_input_context_readonly():
    ci = render_chunk_input_srt(ENTRIES, ChunkDef("chunk-0002", 2, 3), context=1)
    assert [i["source_id"] for i in ci["items"]] == ["entry-000002", "entry-000003"]
    assert [c["source_id"] for c in ci["context_before"]] == ["entry-000001"]
    assert [c["source_id"] for c in ci["context_after"]] == ["entry-000004"]


def test_chunk_input_context_clamped_at_edges():
    ci = render_chunk_input_srt(ENTRIES, ChunkDef("chunk-0001", 1, 2), context=5)
    assert ci["context_before"] == []
    assert [c["source_id"] for c in ci["context_after"]] == ["entry-000003", "entry-000004", "entry-000005"]


def test_adversarial_payload_is_data():
    weird = "含 `rm -rf $(echo hi)`、\"引号\"、$SHELL 与 SRT_EOF 字样的正文"
    m = submit_chunk_srt(
        ENTRIES,
        ChunkDef("chunk-0001", 1, 1),
        {"chunk_id": "chunk-0001", "items": [{"source_id": "entry-000001", "text": weird}]},
    )
    assert m["entry-000001"] == weird  # 纯数据：不执行、不截断


# ---------- 重新分段（A17） ----------

def test_resegment_valid_split():
    long_src = "1\n00:00:10,000 --> 00:00:20,000\n很长的一句话\n"
    entries = parse_srt(long_src).entries
    payload = {
        "chunk_id": "chunk-0001",
        "mode": "resegment",
        "items": [
            {"source_ids": ["entry-000001"], "start": "00:00:10,000", "end": "00:00:13,000", "text": "第一段"},
            {"source_ids": ["entry-000001"], "start": "00:00:13,000", "end": "00:00:17,000", "text": "第二段"},
            {"source_ids": ["entry-000001"], "start": "00:00:17,000", "end": "00:00:20,000", "text": "第三段"},
        ],
    }
    out = submit_chunk_resegment(entries, ChunkDef("chunk-0001", 1, 1), payload)
    assert [(n.start_ms, n.end_ms) for n in out] == [
        (10000, 13000),
        (13000, 17000),
        (17000, 20000),
    ]


def test_resegment_out_of_range_time():
    entries = parse_srt("1\n00:00:10,000 --> 00:00:12,000\nx\n").entries
    payload = {
        "chunk_id": "chunk-0001",
        "mode": "resegment",
        "items": [
            {"source_ids": ["entry-000001"], "start": "00:00:09,000", "end": "00:00:12,000", "text": "x"},
        ],
    }
    with pytest.raises(SubmitError):
        submit_chunk_resegment(entries, ChunkDef("chunk-0001", 1, 1), payload)


def test_resegment_zero_duration():
    entries = parse_srt("1\n00:00:10,000 --> 00:00:12,000\nx\n").entries
    payload = {
        "chunk_id": "chunk-0001",
        "mode": "resegment",
        "items": [
            {"source_ids": ["entry-000001"], "start": "00:00:10,000", "end": "00:00:10,000", "text": "x"},
        ],
    }
    with pytest.raises(SubmitError):
        submit_chunk_resegment(entries, ChunkDef("chunk-0001", 1, 1), payload)


def test_resegment_unmapped_source():
    src = "1\n00:00:10,000 --> 00:00:12,000\n甲\n\n2\n00:00:12,000 --> 00:00:14,000\n乙\n"
    entries = parse_srt(src).entries
    payload = {
        "chunk_id": "chunk-0001",
        "mode": "resegment",
        "items": [
            {"source_ids": ["entry-000001"], "start": "00:00:10,000", "end": "00:00:12,000", "text": "只映射了第一条"},
        ],
    }
    with pytest.raises(SubmitError) as e:
        submit_chunk_resegment(entries, ChunkDef("chunk-0001", 1, 2), payload)
    assert "entry-000002" in " ".join(e.value.issues)


def test_resegment_overlap_rejected():
    src = "1\n00:00:10,000 --> 00:00:14,000\n甲\n\n2\n00:00:14,000 --> 00:00:18,000\n乙\n"
    entries = parse_srt(src).entries
    payload = {
        "chunk_id": "chunk-0001",
        "mode": "resegment",
        "items": [
            {"source_ids": ["entry-000001"], "start": "00:00:10,000", "end": "00:00:15,000", "text": "第一段"},
            {"source_ids": ["entry-000002"], "start": "00:00:14,000", "end": "00:00:18,000", "text": "第二段"},
        ],
    }
    with pytest.raises(SubmitError):
        submit_chunk_resegment(entries, ChunkDef("chunk-0001", 1, 2), payload)


# ---------- 文本块提交（A16） ----------

def test_chunk_input_text_only_editable_blocks():
    ci = render_chunk_input_text(BLOCKS, ChunkDef("chunk-0001", 1, 4))
    assert [i["source_id"] for i in ci["items"]] == ["block-000001", "block-000002", "block-000004"]
    assert all("```" not in i["text"] for i in ci["items"])


def test_submit_text_pass_and_assemble_inputs():
    payload = {
        "chunk_id": "chunk-0001",
        "items": [
            {"source_id": "block-000001", "text": "# 标题"},
            {"source_id": "block-000002", "text": "见 [文档](https://a.b/c) 与 `pip install x`。"},
            {"source_id": "block-000004", "text": "尾段，见 [另](https://x.y/z)。"},
        ],
    }
    m = submit_chunk_text(BLOCKS, ChunkDef("chunk-0001", 1, 4), payload)
    assert set(m) == {"block-000001", "block-000002", "block-000004"}


def test_submit_text_link_target_tamper():
    payload = {
        "chunk_id": "chunk-0001",
        "items": [
            {"source_id": "block-000001", "text": "# 标题"},
            {"source_id": "block-000002", "text": "见 [文档](https://evil.example/c) 与 `pip install x`。"},
            {"source_id": "block-000004", "text": "尾段，见 [另](https://x.y/z)。"},
        ],
    }
    with pytest.raises(SubmitError) as e:
        submit_chunk_text(BLOCKS, ChunkDef("chunk-0001", 1, 4), payload)
    assert "链接" in " ".join(e.value.issues)


def test_submit_text_protected_block_rejected():
    payload = {
        "chunk_id": "chunk-0001",
        "items": [
            {"source_id": "block-000001", "text": "# 标题"},
            {"source_id": "block-000002", "text": "见 [文档](https://a.b/c) 与 `pip install x`。"},
            {"source_id": "block-000003", "text": "```bash\n改成别的\n```"},
            {"source_id": "block-000004", "text": "尾段，见 [另](https://x.y/z)。"},
        ],
    }
    with pytest.raises(SubmitError) as e:
        submit_chunk_text(BLOCKS, ChunkDef("chunk-0001", 1, 4), payload)
    assert "block-000003" in " ".join(e.value.issues)


def test_submit_text_inline_code_flag():
    def payload(code: str) -> dict:
        return {
            "chunk_id": "chunk-0001",
            "items": [
                {"source_id": "block-000001", "text": "# 标题"},
                {"source_id": "block-000002", "text": f"见 [文档](https://a.b/c) 与 `{code}`。"},
                {"source_id": "block-000004", "text": "尾段，见 [另](https://x.y/z)。"},
            ],
        }

    with pytest.raises(SubmitError):
        submit_chunk_text(BLOCKS, ChunkDef("chunk-0001", 1, 4), payload("pip install y"))
    m = submit_chunk_text(BLOCKS, ChunkDef("chunk-0001", 1, 4), payload("pip install y"), allow_inline_code_edit=True)
    assert "pip install y" in m["block-000002"]


def test_result_sha():
    assert result_sha(b"abc") == result_sha(b"abc")
    assert result_sha(b"abc") != result_sha(b"abd")


# =====================================================================
# Task 5：全量校验、组装与可靠发布（A01/A12/A13/A14/A17）
# =====================================================================

import json  # noqa: E402

from pipeline import (  # noqa: E402
    assemble_resegment,
    assemble_srt,
    assemble_text,
    atomic_write,
    load_chunk_results,
    publish,
    validate_full_srt,
    validate_full_text,
)
from srt_struct import parse_srt as _parse  # noqa: E402


def make_doc(n: int = 5):
    src = "\n".join(
        f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},900\nold {i}\n" for i in range(1, n + 1)
    ) + "\n"
    return _parse(src).entries


def test_full_pipeline_preserve_a01(tmp_path):
    entries = make_doc(5)
    mapping = {e.entry_id: f"new {i}" for i, e in enumerate(entries, start=1)}
    chunk_results = [(ChunkDef("chunk-0001", 1, 5), {"chunk_id": "chunk-0001", "items": [
        {"source_id": sid, "text": txt} for sid, txt in mapping.items()
    ]})]
    rep = validate_full_srt(entries, chunk_results)
    assert rep.ok, rep.blockers
    out = assemble_srt(entries, mapping)
    for i in range(1, 6):
        assert out.split("\n").count(str(i)) == 1  # 序号原样、不重编号
        assert f"00:00:{i:02d},000 --> 00:00:{i:02d},900" in out  # 时间轴逐字节不变
    assert "new 1" in out and "old 1" not in out
    p, created = publish(tmp_path / "o.srt", out)
    assert created and p.read_text(encoding="utf-8") == out
    assert not p.read_bytes().startswith(b"\xef\xbb\xbf")  # UTF-8 无 BOM


def test_validate_full_detects_coverage_gap():
    entries = make_doc(5)
    chunk_results = [
        (ChunkDef("chunk-0001", 1, 2), {"chunk_id": "chunk-0001", "items": [
            {"source_id": "entry-000001", "text": "a"},
            {"source_id": "entry-000002", "text": "b"},
        ]}),
        (ChunkDef("chunk-0002", 4, 5), {"chunk_id": "chunk-0002", "items": [
            {"source_id": "entry-000004", "text": "d"},
            {"source_id": "entry-000005", "text": "e"},
        ]}),  # 漏掉 entry-000003
    ]
    rep = validate_full_srt(entries, chunk_results)
    assert not rep.ok and any("entry-000003" in b for b in rep.blockers)


def test_validate_full_detects_cross_chunk_duplicate():
    entries = make_doc(4)
    chunk_results = [
        (ChunkDef("chunk-0001", 1, 2), {"chunk_id": "chunk-0001", "items": [
            {"source_id": "entry-000001", "text": "a"},
            {"source_id": "entry-000002", "text": "b"},
            {"source_id": "entry-000003", "text": "c"},  # 越界写到别块
        ]}),
        (ChunkDef("chunk-0002", 3, 4), {"chunk_id": "chunk-0002", "items": [
            {"source_id": "entry-000003", "text": "c"},
            {"source_id": "entry-000004", "text": "d"},
        ]}),
    ]
    rep = validate_full_srt(entries, chunk_results)
    assert not rep.ok


def test_load_chunk_results_detects_tamper(tmp_path):
    entries = make_doc(2)
    from taskstate import ChunkState, State, TaskConfig, sha256_file

    src = tmp_path / "in.srt"
    src.write_text("1\n00:00:01,000 --> 00:00:01,900\nold 1\n\n2\n00:00:02,000 --> 00:00:02,900\nold 2\n", encoding="utf-8")
    cfg = TaskConfig("proofread", None, "preserve", None, "srt", {})
    result_file = tmp_path / "chunk-0001.result.json"
    payload = {"chunk_id": "chunk-0001", "items": [
        {"source_id": "entry-000001", "text": "new 1"},
        {"source_id": "entry-000002", "text": "new 2"},
    ]}
    result_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    st = State(
        schema_version=1, input_path=str(src), input_sha256=sha256_file(src),
        task_config=cfg.to_dict(), config_hash=cfg.config_hash(), skill_revision="2026-11-08",
        output_path=str(tmp_path / "out.srt"), working_dir=str(tmp_path),
        chunks=[ChunkState("chunk-0001", 1, 2, str(result_file), sha256_file(result_file), "validated")],
    )
    loaded, issues = load_chunk_results(st, tmp_path)
    assert issues == [] and len(loaded) == 1

    result_file.write_text(json.dumps(payload, ensure_ascii=False).replace("new 1", "篡改 1"), encoding="utf-8")
    _, issues = load_chunk_results(st, tmp_path)
    assert issues and "篡改" not in issues[0]  # 检出不一致（而非读到什么信什么）


def test_assemble_resegment_renumbers():
    entries = make_doc(2)
    new_entries = [
        NewEntry(["entry-000001"], 1000, 1900, "拆出的第一句"),
        NewEntry(["entry-000002"], 2000, 2900, "第二句"),
    ]
    out = assemble_resegment(entries, new_entries)
    lines = out.split("\n")
    assert lines[0] == "1" and lines[4] == "2"  # 连续新序号 1..N
    assert lines[1] == "00:00:01,000 --> 00:00:01,900"
    assert lines[2] == "拆出的第一句"


def test_assemble_text_keeps_protected_and_tail(tmp_path):
    mapping = {
        "block-000001": "# 改过的标题",
        "block-000002": "见 [文档](https://a.b/c) 与 `pip install x`。改过的段落",
        "block-000004": "尾段，见 [另](https://x.y/z)。改过",
    }
    out = assemble_text(BLOCKS, mapping)
    assert "# 改过的标题" in out
    assert "rm -rf $(echo hi)" in out  # 围栏原样
    assert out.count("```bash") == 1
    assert out.endswith("尾段，见 [另](https://x.y/z)。改过\n")


def test_validate_text_blocks_end_to_end():
    payload = {"chunk_id": "chunk-0001", "items": [
        {"source_id": "block-000001", "text": "# 标题"},
        {"source_id": "block-000002", "text": "见 [文档](https://a.b/c) 与 `pip install x`。"},
        {"source_id": "block-000004", "text": "尾段，见 [另](https://x.y/z)。"},
    ]}
    rep = validate_full_text(BLOCKS, [(ChunkDef("chunk-0001", 1, 4), payload)])
    assert rep.ok, rep.blockers
    bad = {"chunk_id": "chunk-0001", "items": [
        {"source_id": "block-000001", "text": "# 标题"},
        {"source_id": "block-000002", "text": "改了 [链接](https://evil.x/)。"},
        {"source_id": "block-000004", "text": "尾段，见 [另](https://x.y/z)。"},
    ]}
    rep2 = validate_full_text(BLOCKS, [(ChunkDef("chunk-0001", 1, 4), bad)])
    assert not rep2.ok


def test_publish_no_overwrite_numbered(tmp_path):
    (tmp_path / "o.srt").write_text("EXISTING", encoding="utf-8")
    p, created = publish(tmp_path / "o.srt", "NEW")
    assert p.name == "o_2.srt" and (tmp_path / "o.srt").read_text(encoding="utf-8") == "EXISTING"
    assert p.read_text(encoding="utf-8") == "NEW"
    p2, _ = publish(tmp_path / "o.srt", "NEW2")
    assert p2.name == "o_3.srt"


def test_publish_overwrite_when_authorized(tmp_path):
    (tmp_path / "o.srt").write_text("EXISTING", encoding="utf-8")
    p, created = publish(tmp_path / "o.srt", "NEW", overwrite=True)
    assert p.name == "o.srt" and p.read_text(encoding="utf-8") == "NEW"


def test_atomic_write_leaves_no_partial(tmp_path, monkeypatch):
    import os

    real_replace = os.replace

    def boom(*a):
        raise OSError("boom")

    monkeypatch.setattr("pipeline.os.replace", boom)
    target = tmp_path / "x.txt"
    with pytest.raises(OSError):
        atomic_write(target, "data")
    assert not target.exists()
    assert not list(tmp_path.glob("*.tmp"))  # 无半成品、无残留 tmp
    monkeypatch.setattr("pipeline.os.replace", real_replace)
    atomic_write(target, "data")
    assert target.read_text(encoding="utf-8") == "data"
