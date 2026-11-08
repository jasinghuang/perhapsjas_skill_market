"""TXT / Markdown 的块模型与受保护结构。

原则（需求文档 §8）：采用"保留原文片段"的方式更新——代码围栏、表格、frontmatter
是受保护的原子块，块内字节原样回填；普通段落才允许校对/翻译/润色。
链接地址与行内代码属于结构信息，校验时与源文件比对（见 pipeline.submit_chunk_text）。

切分保证字节恒等：split_blocks → assemble_blocks 与原文逐字节相同，
因此"没动的地方"天然不会被改动。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_TABLE_LINE_RE = re.compile(r"^\s*\|")
_FRONTMATTER_DELIM = "---"


@dataclass
class TextBlock:
    block_id: str  # block-%06d，按源位置 1 起
    raw: str  # 该块原文（含尾随空行等分隔），重组时逐字节使用
    kind: str  # code_fence | table | frontmatter | text

    @property
    def content(self) -> str:
        """块的实际内容（去掉尾随空行）；提交新正文时替换的是这一部分。"""
        return self.raw.rstrip("\n")

    @property
    def tail(self) -> str:
        """块尾部的空行分隔，组装时接在新正文之后，保持排版不变。"""
        stripped = self.raw.rstrip("\n")
        return self.raw[len(stripped):]


def _is_blank(line: str) -> bool:
    return line.strip() == ""


def _fence_close(line: str, fence_char: str, min_len: int) -> bool:
    body = line.rstrip("\n").lstrip(" ")
    return len(body) >= min_len and set(body) == {fence_char}


def _classify(lines: list[str], i: int, n: int) -> tuple[str, int]:
    """从第 i 行开始识别一个块，返回 (kind, 内容结束行号-不含)。"""
    # frontmatter 只可能出现在文件首行
    if i == 0 and lines and lines[0].rstrip("\n") == _FRONTMATTER_DELIM:
        j = 1
        while j < n and lines[j].rstrip("\n") != _FRONTMATTER_DELIM:
            j += 1
        if j < n:
            return "frontmatter", j + 1
        # 未闭合的 --- 开头按普通文本处理
    m = _FENCE_OPEN_RE.match(lines[i])
    if m:
        fence_run = m.group(1)
        char, min_len = fence_run[0], len(fence_run)
        j = i + 1
        while j < n and not _fence_close(lines[j], char, min_len):
            j += 1
        return "code_fence", min(j + 1, n)  # 未闭合围栏整体到 EOF，原子保守处理
    if _TABLE_LINE_RE.match(lines[i]):
        j = i + 1
        while j < n and _TABLE_LINE_RE.match(lines[j]):
            j += 1
        if j - i >= 2:
            return "table", j
        # 单行 | 开头不成表格，并入段落
    # 段落：文件头的空行前缀 + 连续非空行；遇到空行、围栏、表格行停止
    j = i
    while j < n and _is_blank(lines[j]):
        j += 1
    while j < n and not _is_blank(lines[j]):
        if _FENCE_OPEN_RE.match(lines[j]) or (
            _TABLE_LINE_RE.match(lines[j]) and j > i
        ):
            break
        j += 1
    return "text", max(j, i + 1)


def split_blocks(text: str) -> list[TextBlock]:
    """把 TXT/MD 全文切成互不重叠、铺满全文的块。"""
    lines = text.splitlines(keepends=True)
    n = len(lines)
    blocks: list[TextBlock] = []
    i = 0
    while i < n:
        kind, content_end = _classify(lines, i, n)
        # 消化块后的空行，作为本块尾部（保证块铺满全文、重组恒等）
        end = content_end
        while end < n and _is_blank(lines[end]):
            end += 1
        raw = "".join(lines[i:end])
        blocks.append(TextBlock(f"block-{len(blocks) + 1:06d}", raw, kind))
        i = end
    if not blocks and text:
        # text 只含空行时也要能恒等重组
        blocks.append(TextBlock("block-000001", text, "text"))
    return blocks


def assemble_blocks(blocks: list[TextBlock]) -> str:
    """按顺序拼接块原文。未做任何修改时结果与源文件逐字节相同。"""
    return "".join(b.raw for b in blocks)


def is_protected(block: TextBlock) -> bool:
    return block.kind in {"code_fence", "table", "frontmatter"}


def extract_link_targets(text: str) -> list[str]:
    """抽取 Markdown 链接/图片的目标地址（可见文字可改，地址不可改）。"""
    return re.findall(r"\[[^\]]*\]\(([^)]+)\)", text)


def extract_inline_code(text: str) -> list[str]:
    """抽取行内代码 span 内容（排除围栏行本身）。"""
    spans: list[str] = []
    for line in text.splitlines():
        if _FENCE_OPEN_RE.match(line):
            continue
        spans.extend(re.findall(r"`([^`\n]+)`", line))
    return spans
