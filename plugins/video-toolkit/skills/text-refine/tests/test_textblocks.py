# 覆盖验收用例 A15/A16 的文本块层断言（见需求文档 §16.1）。
from textblocks import (
    assemble_blocks,
    extract_inline_code,
    extract_link_targets,
    is_protected,
    split_blocks,
)

MIXED = (
    "---\ntitle: demo\n---\n\n# 标题\n\n正文一段，见 [文档](https://a.b/c) 与 `pip install x`。\n\n"
    "```python\nprint(1)\n\n# 空行在围栏内\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
)


def test_roundtrip_byte_identical():
    assert assemble_blocks(split_blocks(MIXED)) == MIXED


def test_kinds_and_protection():
    blocks = split_blocks(MIXED)
    assert {b.kind for b in blocks} == {"frontmatter", "text", "code_fence", "table"}
    assert [b.block_id for b in blocks] == [f"block-{i:06d}" for i in range(1, len(blocks) + 1)]
    assert [is_protected(b) for b in blocks if b.kind == "code_fence"] == [True]
    assert [is_protected(b) for b in blocks if b.kind == "text"] == [False, False]


def test_code_fence_atomic_despite_inner_blank_lines():
    blocks = split_blocks(MIXED)
    fences = [b for b in blocks if b.kind == "code_fence"]
    assert len(fences) == 1
    assert "print(1)" in fences[0].raw and "# 空行在围栏内" in fences[0].raw


def test_adversarial_text_is_data():
    t = '运行 `rm -rf $(echo hi)` 与 "引号" 和 SRT_EOF 字样\n'
    assert extract_inline_code(t) == ["rm -rf $(echo hi)"]
    blocks = split_blocks(t)
    assert assemble_blocks(blocks) == t  # 原文重组恒等：不执行、不截断


def test_tilde_fence_with_inner_backticks():
    src = "~~~\n```python\nprint(1)\n```\n~~~\n"
    blocks = split_blocks(src)
    assert len(blocks) == 1 and blocks[0].kind == "code_fence"
    assert assemble_blocks(blocks) == src


def test_link_targets():
    t = "见 [文档](https://a.b/c)、![图](media/图片 1.png) 与 [另一个](https://x.y/z)\n"
    assert sorted(extract_link_targets(t)) == [
        "https://a.b/c",
        "https://x.y/z",
        "media/图片 1.png",
    ]


def test_table_atomic():
    src = "段落一。\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n段落二。\n"
    blocks = split_blocks(src)
    kinds = [b.kind for b in blocks]
    assert kinds == ["text", "table", "text"]
    assert assemble_blocks(blocks) == src


def test_plain_txt_paragraphs():
    src = "第一段第一行\n第一段第二行\n\n第二段。\n\n\n第三段前面有两个空行。\n"
    blocks = split_blocks(src)
    assert [b.kind for b in blocks] == ["text", "text", "text"]
    assert assemble_blocks(blocks) == src


def test_fence_at_eof_without_trailing_newline():
    src = "```bash\necho hi\n```"
    blocks = split_blocks(src)
    assert len(blocks) == 1 and blocks[0].kind == "code_fence"
    assert assemble_blocks(blocks) == src
