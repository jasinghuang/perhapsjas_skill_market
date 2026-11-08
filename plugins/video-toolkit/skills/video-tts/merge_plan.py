"""语义合并计划：把相邻 SRT 条目按人工/模型给出的分组合并成完整语义单元。

计划格式（JSON）：

    {"groups": [[1, 2, 3], [4, 5], ...], "srt_sha256": "…"}

每个 group 是连续的 SRT 条目序号（与 SRT 里的序号一致）。所有条目必须
恰好出现一次、顺序递增、组内连续。CLI 不做任何机械合并（按间隙/字数
硬切会损伤配音质量）；分组由调用方（通常是 Claude 读完整 SRT 后）根据
句子意思决定。

组内文本拼接规则（spec §8）：**直接连接，不凭空插标点**——「这个模」
与「型很好」必须拼成「这个模型很好」，而不是「这个模，型很好」。需要
分隔符时由计划作者用 `text` 显式给出整句。两侧都是 ASCII 字母/数字时
补一个空格（与 `normalize_text` 一致）。

`srt_sha256` 可选：写入计划时记录源 SRT 内容哈希，`load_merge_plan`
据此校验——SRT 改动后旧计划不再可用（时间轴与分句依据都已变化），
必须重新生成，防止用旧分组错配新字幕。
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from srt_parse import Cue

_ASCII_ALNUM_RE = re.compile(r"[A-Za-z0-9]")


def _join_texts(texts: list[str]) -> str:
    """把组内文本直接拼成整句；只在 ASCII 字母/数字之间补空格。"""
    out = ""
    for text in texts:
        text = text.strip()
        if not text:
            continue
        if out and _ASCII_ALNUM_RE.match(out[-1]) and _ASCII_ALNUM_RE.match(text[0]):
            out += " "
        out += text
    return out


def load_merge_plan(
    path: Path,
    cues: list[Cue],
    *,
    srt_sha256: str | None = None,
) -> list[Cue]:
    """读取计划并按组返回合并后的 Cue 列表。

    非法计划（缺条目、重复、乱序、组内不连续）抛 `ValueError`。计划带
    `srt_sha256` 且与实际 SRT 哈希不一致时抛 `ValueError`（要求重新生成
    计划）。合并后的 Cue 携带 `source_indices`（组内源条目序号），供
    plan/dub 字幕与报告映射回源 SRT。
    """
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read merge plan {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"merge plan is not valid JSON: {exc}") from exc

    if isinstance(data, dict) and srt_sha256:
        recorded = data.get("srt_sha256")
        if isinstance(recorded, str) and recorded and recorded != srt_sha256:
            raise ValueError(
                "merge plan was built for a different SRT (srt_sha256 "
                "mismatch); regenerate the plan for the current file"
            )

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
                source_indices=tuple(indices),
            )
        )
    return merged


def plan_payload(cues: list[Cue], srt_path: Path) -> dict:
    """把（合并后的）计划组写成 plan.json 的结构（预览 / 恢复用）。"""
    raw = Path(srt_path).read_bytes()
    return {
        "srt_sha256": hashlib.sha256(raw).hexdigest(),
        "groups": [
            {
                "source_indices": list(cue.source_indices or (cue.index,)),
                "text": cue.text,
                "start": cue.start,
                "end": cue.end,
            }
            for cue in cues
        ],
    }
