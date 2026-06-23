"""标准 SRT 解析。多行文本合并为一行;空条目跳过。"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Subtitle:
    index: int
    start: float   # 秒
    end: float     # 秒
    text: str


def _ts_to_sec(ts: str) -> float:
    """'00:01:02,500' -> 62.5"""
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_srt(path: Path | str) -> list[Subtitle]:
    text = Path(path).read_text(encoding="utf-8")
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    subs: list[Subtitle] = []
    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        try:
            index = int(lines[0])
        except ValueError:
            continue
        start_str, end_str = lines[1].split(" --> ")
        body = " ".join(line.strip() for line in lines[2:] if line.strip())
        if not body:
            continue
        subs.append(Subtitle(
            index=index,
            start=_ts_to_sec(start_str.strip()),
            end=_ts_to_sec(end_str.strip()),
            text=body,
        ))
    return subs
