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
