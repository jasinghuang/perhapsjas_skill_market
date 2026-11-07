"""语义合并计划：把相邻 SRT 条目按人工/模型给出的分组合并成完整语义单元。

计划格式（JSON）：

    {"groups": [[1, 2, 3], [4, 5], ...]}

每个 group 是连续的 SRT 条目序号（与 SRT 里的序号一致）。所有条目必须
恰好出现一次、顺序递增、组内连续。CLI 不再按时间间隙自动合并；分组由
调用方（通常是 Claude 读完整 SRT 后）根据句子意思决定。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from srt_parse import Cue

_END_PUNCT = re.compile(r"[，、；：,;:。！？!?—…\"'”’）)]$")


def _join_texts(texts: list[str]) -> str:
    """把组内文本拼成一个自然句；缺标点时补一个逗号。"""
    out = ""
    for text in texts:
        text = text.strip()
        if not text:
            continue
        if out and not _END_PUNCT.search(out):
            out += "，"
        out += text
    return out


def load_merge_plan(path: Path, cues: list[Cue]) -> list[Cue]:
    """读取计划并按组返回合并后的 Cue 列表。

    非法计划（缺条目、重复、乱序、组内不连续）抛 `ValueError`。
    """
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read merge plan {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"merge plan is not valid JSON: {exc}") from exc

    groups = data.get("groups") if isinstance(data, dict) else data
    if not isinstance(groups, list) or not groups:
        raise ValueError("merge plan must contain a non-empty 'groups' array")

    normalized: list[tuple[list[int], str | None]] = []
    for pos, group in enumerate(groups, start=1):
        if isinstance(group, dict):
            indices = group.get("indices")
            text = group.get("text")
            if not isinstance(text, (str, type(None))):
                raise ValueError(f"group {pos} 'text' must be a string")
        else:
            indices = group
            text = None
        if not isinstance(indices, list) or not indices:
            raise ValueError(f"group {pos} must be a non-empty array")
        if not all(isinstance(i, int) for i in indices):
            raise ValueError(f"group {pos} must contain integer cue indices")
        if indices != list(range(indices[0], indices[0] + len(indices))):
            raise ValueError(f"group {pos} is not contiguous: {indices}")
        normalized.append((indices, text))

    by_index = {cue.index: cue for cue in cues}
    expected = [cue.index for cue in cues]
    flattened: list[int] = []
    for indices, _ in normalized:
        flattened.extend(indices)

    if flattened != expected:
        raise ValueError(
            "merge plan must cover every cue exactly once, in order; "
            f"expected {expected[:5]}... ({len(expected)} cues), "
            f"got {flattened[:5]}... ({len(flattened)} cues)"
        )

    merged: list[Cue] = []
    for pos, (indices, override) in enumerate(normalized):
        members = [by_index[i] for i in indices]
        first = members[0]
        last = members[-1]
        next_start = (
            by_index[normalized[pos + 1][0][0]].start
            if pos + 1 < len(normalized)
            else last.next_start
        )
        text = override if override is not None else _join_texts(
            [cue.text for cue in members]
        )
        merged.append(
            Cue(
                index=first.index,
                start=first.start,
                end=last.end,
                text=text,
                effective_start=first.effective_start,
                next_start=next_start,
            )
        )
    return merged
