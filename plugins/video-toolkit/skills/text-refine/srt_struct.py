"""SRT 原样结构解析与渲染。

设计原则（需求文档 §6）：时间轴行**整行原样**保留（含坐标 X1:… 与其他附加定位信息），
序号行原样保留；只有条目正文可以被替换。条目 ID 按源文件位置生成（entry-%06d），
不依赖可能重复或断续的显示序号——两个都显示 "5" 的条目依然是两个不同的源条目。

阻塞错误（SrtFormatError）与输入诊断（Diagnostic）分开：文件里已有的重叠、
断续序号是既成事实，诊断但不修、不掩盖；时间无法解析 / 反向 / 缺失则阻止继续。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# 时间轴行：起止时间 + 可选的坐标等附加信息（附加信息保留在 timeline_raw 里不动）
_TIMELINE_RE = re.compile(
    r"^\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d{1,3})(.*)$"
)
# 条目之间以空行分隔（空行上允许零散空白）
_BLOCK_SPLIT_RE = re.compile(r"\n(?:[ \t]*\n)+")
_TIMESTAMP_RE = re.compile(r"^\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*$")


@dataclass(frozen=True)
class Diagnostic:
    """非阻塞输入诊断：描述文件既有的可疑状态，不修改、不掩盖。"""

    level: str  # "warning" | "info"
    code: str  # overlap_existing | index_nonsequential | index_duplicate | index_missing | text_empty | duration_zero
    entry_id: str | None
    message: str


class SrtFormatError(ValueError):
    """阻塞性格式错误：对应文件不应继续产出成品。"""

    def __init__(self, message: str, entry_id: str | None = None):
        super().__init__(message)
        self.entry_id = entry_id


@dataclass
class SrtEntry:
    entry_id: str  # entry-%06d，按源位置 1 起
    index_raw: str  # 序号行原样；无序号行为 ""
    timeline_raw: str  # 时间轴行原样（含坐标等附加信息）
    text: str  # 条目正文（多行以 \n 连接）
    start_ms: int
    end_ms: int


@dataclass
class SrtDocument:
    entries: list[SrtEntry] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)


def parse_timestamp(ts: str) -> int:
    """把 `HH:MM:SS,mmm` / `HH:MM:SS.mmm` 解析为毫秒。"""
    m = _TIMESTAMP_RE.match(ts)
    if not m:
        raise SrtFormatError(f"无法解析时间戳: {ts!r}")
    hours, minutes, seconds, frac = m.groups()
    if int(minutes) > 59 or int(seconds) > 59:
        raise SrtFormatError(f"分和秒必须在 00～59 范围内: {ts!r}")
    ms = int(frac.ljust(3, "0"))
    return ((int(hours) * 60 + int(minutes)) * 60 + int(seconds)) * 1000 + ms


def read_text(path: Path) -> str:
    """读取文本：剥 UTF-8 BOM，统一换行为 \\n。"""
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")


def _parse_block(block: str, position: int) -> SrtEntry:
    lines = block.split("\n")
    timeline_idx: int | None = None
    match: re.Match | None = None
    for i, line in enumerate(lines):
        m = _TIMELINE_RE.match(line)
        if m:
            timeline_idx, match = i, m
            break
    if timeline_idx is None or match is None:
        raise SrtFormatError(
            f"第 {position} 个条目缺少可解析的时间轴行", entry_id=f"entry-{position:06d}"
        )

    if timeline_idx == 0:
        index_raw = ""
    else:
        index_raw = lines[timeline_idx - 1].strip()
    # 时间轴行与序号行之间若混入其他行，并入正文，不静默丢弃
    extra_head = lines[: max(timeline_idx - 1, 0)]
    text_lines = extra_head + lines[timeline_idx + 1 :]
    text = "\n".join(text_lines)

    entry_id = f"entry-{position:06d}"
    start_ms = parse_timestamp(match.group(1))
    end_ms = parse_timestamp(match.group(2))
    if end_ms < start_ms:
        raise SrtFormatError(
            f"条目 {entry_id} 终止时间早于起始时间（{match.group(2)} < {match.group(1)}）",
            entry_id=entry_id,
        )
    return SrtEntry(
        entry_id=entry_id,
        index_raw=index_raw,
        timeline_raw=lines[timeline_idx],
        text=text,
        start_ms=start_ms,
        end_ms=end_ms,
    )


def parse_srt(text: str) -> SrtDocument:
    """解析已剥 BOM、已归一换行的 SRT 文本。阻塞错误抛 SrtFormatError。"""
    doc = SrtDocument()
    blocks = [b for b in _BLOCK_SPLIT_RE.split(text.strip("\n")) if b.strip()]
    if not blocks:
        raise SrtFormatError("无有效 SRT 条目（空输入或只有空白）")

    seen_indices: dict[str, str] = {}
    prev_numeric: int | None = None
    for position, block in enumerate(blocks, start=1):
        entry = _parse_block(block, position)
        doc.entries.append(entry)

        if not entry.index_raw:
            doc.diagnostics.append(
                Diagnostic("info", "index_missing", entry.entry_id, "条目缺少序号行")
            )
        else:
            if entry.index_raw in seen_indices:
                doc.diagnostics.append(
                    Diagnostic(
                        "warning",
                        "index_duplicate",
                        entry.entry_id,
                        f"显示序号 {entry.index_raw} 与 {seen_indices[entry.index_raw]} 重复",
                    )
                )
            else:
                seen_indices[entry.index_raw] = entry.entry_id
            if entry.index_raw.isdigit():
                numeric = int(entry.index_raw)
                if prev_numeric is not None and numeric != prev_numeric + 1:
                    doc.diagnostics.append(
                        Diagnostic(
                            "info",
                            "index_nonsequential",
                            entry.entry_id,
                            f"显示序号不连续: {prev_numeric} -> {numeric}",
                        )
                    )
                prev_numeric = numeric

        if not entry.text.strip():
            doc.diagnostics.append(
                Diagnostic("info", "text_empty", entry.entry_id, "条目正文为空")
            )
        if entry.end_ms == entry.start_ms:
            doc.diagnostics.append(
                Diagnostic("info", "duration_zero", entry.entry_id, "条目时长为零")
            )
        if len(doc.entries) >= 2:
            prev = doc.entries[-2]
            if prev.end_ms > entry.start_ms:
                doc.diagnostics.append(
                    Diagnostic(
                        "warning",
                        "overlap_existing",
                        entry.entry_id,
                        f"与上一条 {prev.entry_id} 时间重叠（输入既有，保留不修）",
                    )
                )
    return doc


def render_srt(entries: list[SrtEntry], new_texts: dict[str, str] | None = None) -> str:
    """按源顺序渲染。只允许替换正文；序号行与时间轴行逐字保留。

    new_texts 含未知条目 ID 时抛 SrtFormatError（调用方映射错位必须暴露）。
    """
    new_texts = new_texts or {}
    unknown = sorted(set(new_texts) - {e.entry_id for e in entries})
    if unknown:
        raise SrtFormatError(f"new_texts 含未知条目 ID: {', '.join(unknown[:5])}")

    blocks: list[str] = []
    for e in entries:
        text = new_texts.get(e.entry_id, e.text)
        head = f"{e.index_raw}\n{e.timeline_raw}\n" if e.index_raw else f"{e.timeline_raw}\n"
        blocks.append(head + text if text else head.rstrip("\n"))
    return "\n\n".join(blocks) + "\n"
