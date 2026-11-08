"""语义合并计划：把相邻 SRT 条目按人工/模型给出的分组合并成完整语义单元。

计划格式（JSON）：

    {"groups": [[1, 2, 3], [4, 5], ...], "srt_sha256": "…"}

每个 group 是连续的 SRT 条目序号（与 SRT 里的序号一致；`--write-plan`
产物用同义的 `source_indices` 键，两边都能读——计划往返不再断裂）。所有
条目必须恰好出现一次、顺序递增、组内连续。CLI 不做任何机械合并（按间隙/
字数硬切会损伤配音质量）；分组由调用方（通常是 Claude 读完整 SRT 后）根据
句子意思决定。

组内文本拼接规则（spec §8）：**直接连接，不凭空插标点**——「这个模」
与「型很好」必须拼成「这个模型很好」，而不是「这个模，型很好」。

`srt_sha256` **必填**（F13）：计划必须绑定源 SRT 内容哈希；缺失或与当前
SRT 不一致都拒绝加载——SRT 改动后旧计划不再可用（时间轴与分句依据都已
变化），必须重新生成，防止用旧分组错配新字幕。

组级 `text` 覆盖（改写正文）受双重授权约束（F08，spec §9.2）：

1. 计划顶层 `"text_edit_authorized": true`——宿主在用户经控件明确授权
   改文后才允许写入；
2. CLI 显式 `--allow-text-edits`——不能只因为 agent 写了 JSON 就视为
   已授权。

两者齐备才生效；被改写的组在 Cue 上带 `text_edited=True`，进报告与
任务清单可追溯。
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
    allow_text_edits: bool = False,
) -> list[Cue]:
    """读取计划并按组返回合并后的 Cue 列表。

    非法计划（缺条目、重复、乱序、组内不连续）抛 `ValueError`。计划
    **必须**带 `srt_sha256`（F13），且与当前 SRT 哈希一致，否则拒绝。
    组级 `text` 覆盖需要计划顶层 `text_edit_authorized: true` **且**
    `allow_text_edits=True`（对应 CLI `--allow-text-edits`）双重授权。
    合并后的 Cue 携带 `source_indices`（组内源条目序号）与
    `text_edited`（该组正文是否被授权改写），供 plan/dub 字幕、报告与
    任务清单映射回源 SRT。
    """
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"cannot read merge plan {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"merge plan is not valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(
            "merge plan must be a JSON object with 'groups' and 'srt_sha256'"
        )

    # F13：源绑定必填——无哈希的计划不可信（无法确认对应哪份 SRT）。
    recorded = data.get("srt_sha256")
    if not isinstance(recorded, str) or not recorded:
        raise ValueError(
            "merge plan lacks srt_sha256 (source binding is required); "
            "regenerate the plan with the current SRT"
        )
    if srt_sha256 and recorded != srt_sha256:
        raise ValueError(
            "merge plan was built for a different SRT (srt_sha256 "
            "mismatch); regenerate the plan for the current file"
        )

    groups = data.get("groups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("merge plan must contain a non-empty 'groups' array")

    by_index = {cue.index: cue for cue in cues}

    def _joined(indices: list[int]) -> str:
        return _join_texts([by_index[i].text for i in indices])

    # 「改写」以内容差异判定：text 与原文拼接一致的组（如 --write-plan
    # 产物）就是普通合并，不算 override；只有正文真正不同才算改写。
    normalized: list[tuple[list[int], str | None, bool]] = []
    has_override = False
    for pos, group in enumerate(groups, start=1):
        if isinstance(group, dict):
            # `indices` 与 `--write-plan` 产物用的 `source_indices` 同义，
            # 两边都接受（F13：计划往返不再一边写一边只认另一边）。
            indices = group.get("indices", group.get("source_indices"))
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
        edited = text is not None and text != _joined(indices)
        if edited:
            has_override = True
        else:
            text = None  # 与原文一致 → 按普通合并处理（含 None）
        normalized.append((indices, text, edited))

    if has_override:
        # F08：改写正文必须双层授权——宿主在计划里声明 + CLI 显式标记。
        authorized = data.get("text_edit_authorized") is True
        if not authorized:
            raise ValueError(
                "merge plan contains text overrides without "
                "'text_edit_authorized': true; rewriting source content "
                "requires explicit user authorization (AskUserQuestion)"
            )
        if not allow_text_edits:
            raise ValueError(
                "merge plan contains authorized text overrides but the CLI "
                "was not given --allow-text-edits; pass it to accept the "
                "edits (they will be recorded per group)"
            )

    by_index = {cue.index: cue for cue in cues}
    expected = [cue.index for cue in cues]
    flattened: list[int] = []
    for indices, _, _ in normalized:
        flattened.extend(indices)

    if flattened != expected:
        raise ValueError(
            "merge plan must cover every cue exactly once, in order; "
            f"expected {expected[:5]}... ({len(expected)} cues), "
            f"got {flattened[:5]}... ({len(flattened)} cues)"
        )

    merged: list[Cue] = []
    for pos, (indices, override, edited) in enumerate(normalized):
        members = [by_index[i] for i in indices]
        first = members[0]
        last = members[-1]
        next_start = (
            by_index[normalized[pos + 1][0][0]].start
            if pos + 1 < len(normalized)
            else last.next_start
        )
        if override is not None:
            text = override
        else:
            text = _join_texts([cue.text for cue in members])
        merged.append(
            Cue(
                index=first.index,
                start=first.start,
                end=last.end,
                text=text,
                effective_start=first.effective_start,
                next_start=next_start,
                source_indices=tuple(indices),
                text_edited=edited,
            )
        )
    return merged


def plan_payload(cues: list[Cue], srt_path: Path) -> dict:
    """把（合并后的）计划组写成 plan.json 的结构（预览 / 恢复用）。

    组键用 `source_indices`，与 `load_merge_plan` 接受的 `indices` 同义
    ——`--write-plan` 产物可以直接作为 `--merge-plan` 输入（F13 往返）。
    """
    raw = Path(srt_path).read_bytes()
    payload = {
        "srt_sha256": hashlib.sha256(raw).hexdigest(),
        "groups": [
            {
                "source_indices": list(cue.source_indices or (cue.index,)),
                "text": cue.text,
                "start": cue.start,
                "end": cue.end,
                "text_edited": cue.text_edited,
            }
            for cue in cues
        ],
    }
    if any(cue.text_edited for cue in cues):
        payload["text_edit_authorized"] = True
    return payload
