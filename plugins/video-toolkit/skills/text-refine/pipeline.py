"""分块计划、块输入渲染与提交校验（需求文档 §9、§11）。

宿主语言模型只产出「条目 ID → 新正文」的结构化映射；本模块做确定性校验：
ID 合法性（未知/重复/遗漏/越界）、上下文条目只读、SRT 样式标签结构不变、
Markdown 链接地址与行内代码保护、重新分段的时间边界与源映射完整。
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from srt_struct import SrtEntry, SrtFormatError, parse_timestamp
from textblocks import TextBlock, extract_inline_code, extract_link_targets, is_protected

_TAG_RE = re.compile(r"<[^>\n]+>")


def extract_tags(text: str) -> list[str]:
    """抽取正文里的样式/控制标签整串（<i>、<font ...> 等），用于前后多重集合比对。"""
    return _TAG_RE.findall(text)


def result_sha(payload_bytes: bytes) -> str:
    return hashlib.sha256(payload_bytes).hexdigest()


@dataclass(frozen=True)
class ChunkDef:
    chunk_id: str  # chunk-%04d
    first: int  # 源位置闭区间（SRT=条目位置；文本=块位置）
    last: int


def plan_chunks(n: int, max_per_chunk: int = 40) -> list[ChunkDef]:
    if n <= 0:
        return []
    defs: list[ChunkDef] = []
    start, idx = 1, 1
    while start <= n:
        last = min(start + max_per_chunk - 1, n)
        defs.append(ChunkDef(f"chunk-{idx:04d}", start, last))
        start, idx = last + 1, idx + 1
    return defs


class SubmitError(ValueError):
    """块提交校验失败；.issues 逐条列出可定位问题。"""

    def __init__(self, issues: list[str]):
        self.issues = list(issues)
        super().__init__("; ".join(self.issues))


def _check_ids(expected: list[str], provided: list[str], issues: list[str]) -> None:
    expected_set = set(expected)
    seen: set[str] = set()
    for sid in provided:
        if sid not in expected_set:
            issues.append(f"条目 {sid} 不在本块编辑范围内（上下文条目只读）")
        elif sid in seen:
            issues.append(f"条目 {sid} 重复提交")
        seen.add(sid)
    missing = [sid for sid in expected if sid not in seen]
    if missing:
        issues.append(f"遗漏条目: {', '.join(missing)}")


def render_chunk_input_srt(
    entries: list[SrtEntry], chunk: ChunkDef, context: int = 2
) -> dict:
    """渲染给宿主模型的块输入。items 是待编辑条目；context_* 只读，不进输出。"""
    lo, hi = chunk.first - 1, chunk.last
    return {
        "chunk_id": chunk.chunk_id,
        "items": [
            {"source_id": e.entry_id, "text": e.text} for e in entries[lo:hi]
        ],
        "context_before": [
            {"source_id": e.entry_id, "text": e.text}
            for e in entries[max(0, lo - context):lo]
        ],
        "context_after": [
            {"source_id": e.entry_id, "text": e.text} for e in entries[hi:hi + context]
        ],
    }


def submit_chunk_srt(
    entries: list[SrtEntry], chunk: ChunkDef, payload: dict
) -> dict[str, str]:
    """校验并接收一个 SRT 块的正文映射，返回 {entry_id: 新正文}。"""
    issues: list[str] = []
    if not isinstance(payload, dict):
        raise SubmitError(["payload 必须是 JSON 对象"])
    if payload.get("chunk_id") != chunk.chunk_id:
        issues.append(f"chunk_id 不匹配（期望 {chunk.chunk_id}，收到 {payload.get('chunk_id')!r}）")
        raise SubmitError(issues)

    expected = [e.entry_id for e in entries[chunk.first - 1:chunk.last]]
    by_id = {e.entry_id: e for e in entries}
    items = payload.get("items")
    if not isinstance(items, list):
        raise SubmitError(["payload.items 必须是数组"])

    provided: list[str] = []
    mapping: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict) or "source_id" not in item or "text" not in item:
            issues.append(f"item 结构非法（需要 source_id 与 text）: {item!r}")
            continue
        sid, text = item["source_id"], item["text"]
        if not isinstance(text, str):
            issues.append(f"条目 {sid} 的 text 必须是字符串")
            continue
        provided.append(sid)
        mapping[sid] = text

    _check_ids(expected, provided, issues)

    for sid, new_text in mapping.items():
        entry = by_id.get(sid)
        if entry is None:
            continue  # 未知 ID 已在上面的 _check_ids 里记录
        if sorted(extract_tags(entry.text)) != sorted(extract_tags(new_text)):
            issues.append(
                f"条目 {sid} 样式标签被改动（标签应原样保留，只能编辑标签内可见文字）"
            )
        if entry.text.strip() and not new_text.strip():
            issues.append(f"条目 {sid} 正文被清空")
    if issues:
        raise SubmitError(issues)
    return mapping


# ---------- 文本块（TXT / Markdown） ----------

def _text_block_ids(blocks: list[TextBlock], positions: range) -> list[str]:
    return [blocks[i].block_id for i in positions if not is_protected(blocks[i])]


def render_chunk_input_text(
    blocks: list[TextBlock], chunk: ChunkDef, context: int = 1
) -> dict:
    """items 只含可编辑文本块；受保护块（围栏/表格/frontmatter）不交给模型。"""
    lo, hi = chunk.first - 1, chunk.last
    return {
        "chunk_id": chunk.chunk_id,
        "items": [
            {"source_id": blocks[i].block_id, "text": blocks[i].content}
            for i in range(lo, hi)
            if not is_protected(blocks[i])
        ],
        "context_before": [
            {"source_id": blocks[i].block_id, "text": blocks[i].content}
            for i in range(max(0, lo - context), lo)
            if not is_protected(blocks[i])
        ],
        "context_after": [
            {"source_id": blocks[i].block_id, "text": blocks[i].content}
            for i in range(hi, min(len(blocks), hi + context))
            if not is_protected(blocks[i])
        ],
    }


def submit_chunk_text(
    blocks: list[TextBlock],
    chunk: ChunkDef,
    payload: dict,
    allow_inline_code_edit: bool = False,
) -> dict[str, str]:
    """校验并接收一个文本块块（chunk）的映射；受保护块不可出现在 items。"""
    issues: list[str] = []
    if not isinstance(payload, dict):
        raise SubmitError(["payload 必须是 JSON 对象"])
    if payload.get("chunk_id") != chunk.chunk_id:
        issues.append(f"chunk_id 不匹配（期望 {chunk.chunk_id}，收到 {payload.get('chunk_id')!r}）")
        raise SubmitError(issues)

    by_id = {b.block_id: b for b in blocks}
    items = payload.get("items")
    if not isinstance(items, list):
        raise SubmitError(["payload.items 必须是数组"])

    provided: list[str] = []
    mapping: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict) or "source_id" not in item or "text" not in item:
            issues.append(f"item 结构非法（需要 source_id 与 text）: {item!r}")
            continue
        sid, text = item["source_id"], item["text"]
        if not isinstance(text, str):
            issues.append(f"块 {sid} 的 text 必须是字符串")
            continue
        provided.append(sid)
        mapping[sid] = text

    for sid in provided:
        block = by_id.get(sid)
        if block is not None and is_protected(block):
            issues.append(f"块 {sid} 是受保护结构（{block.kind}），不可编辑")

    expected = _text_block_ids(blocks, range(chunk.first - 1, chunk.last))
    _check_ids(expected, provided, issues)

    for sid, new_text in mapping.items():
        block = by_id[sid]
        old = block.content
        if sorted(extract_link_targets(old)) != sorted(extract_link_targets(new_text)):
            issues.append(f"块 {sid} 链接地址被改动（可见文字可改，地址必须原值）")
        old_code, new_code = extract_inline_code(old), extract_inline_code(new_text)
        if allow_inline_code_edit:
            if len(old_code) != len(new_code):
                issues.append(f"块 {sid} 行内代码数量变化（{len(old_code)} → {len(new_code)}）")
        elif sorted(old_code) != sorted(new_code):
            issues.append(f"块 {sid} 行内代码被改动（如需翻译代码注释需显式允许）")
        if old.strip() and not new_text.strip():
            issues.append(f"块 {sid} 正文被清空")
    if issues:
        raise SubmitError(issues)
    return mapping


# ---------- 重新分段（A17） ----------

@dataclass
class NewEntry:
    source_ids: list[str]
    start_ms: int
    end_ms: int
    text: str


def submit_chunk_resegment(
    entries: list[SrtEntry], chunk: ChunkDef, payload: dict
) -> list[NewEntry]:
    """校验重新分段映射：源覆盖完整、时间合法、不超源范围、按序不重叠。"""
    issues: list[str] = []
    if not isinstance(payload, dict):
        raise SubmitError(["payload 必须是 JSON 对象"])
    if payload.get("chunk_id") != chunk.chunk_id:
        issues.append(f"chunk_id 不匹配（期望 {chunk.chunk_id}，收到 {payload.get('chunk_id')!r}）")
        raise SubmitError(issues)
    if payload.get("mode") != "resegment":
        raise SubmitError(["重新分段提交必须带 \"mode\": \"resegment\""])

    by_id = {e.entry_id: e for e in entries}
    expected = [e.entry_id for e in entries[chunk.first - 1:chunk.last]]
    expected_set = set(expected)
    items = payload.get("items")
    if not isinstance(items, list) or not items:
        raise SubmitError(["payload.items 必须是非空数组"])

    mapped: set[str] = set()
    new_entries: list[NewEntry] = []
    for item in items:
        if not isinstance(item, dict):
            issues.append(f"item 结构非法: {item!r}")
            continue
        sids = item.get("source_ids")
        if not isinstance(sids, list) or not sids:
            issues.append(f"新条目缺少 source_ids: {item!r}")
            continue
        for sid in sids:
            if sid not in expected_set:
                issues.append(f"source_id {sid} 不在本块范围内")
        mapped.update(sids)

        try:
            start_ms = parse_timestamp(item["start"])
            end_ms = parse_timestamp(item["end"])
        except (KeyError, SrtFormatError) as e:
            issues.append(f"新条目时间无法解析（{item.get('start')!r} → {item.get('end')!r}）: {e}")
            continue
        text = item.get("text")
        if not isinstance(text, str) or not text.strip():
            issues.append("新条目 text 不能为空")
            continue
        sources = [by_id[s] for s in sids if s in by_id]
        if sources:
            span_lo = min(s.start_ms for s in sources)
            span_hi = max(s.end_ms for s in sources)
            if not (span_lo <= start_ms < end_ms <= span_hi):
                issues.append(
                    f"新条目 [{item['start']} → {item['end']}] 超出其源条目时间范围"
                    f"（{span_lo}ms ~ {span_hi}ms）"
                )
        new_entries.append(NewEntry(list(sids), start_ms, end_ms, text))

    unmapped = [sid for sid in expected if sid not in mapped]
    if unmapped:
        issues.append(f"源条目未被映射: {', '.join(unmapped)}")
    if issues:
        raise SubmitError(issues)

    new_entries.sort(key=lambda n: n.start_ms)
    for prev, cur in zip(new_entries, new_entries[1:]):
        if cur.start_ms < prev.end_ms:
            issues.append(
                f"新条目时间重叠: {prev.start_ms}~{prev.end_ms} 与 {cur.start_ms}~{cur.end_ms}"
            )
    if issues:
        raise SubmitError(issues)
    return new_entries
