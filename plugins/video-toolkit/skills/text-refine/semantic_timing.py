"""语义片段到源时间的确定性排时；只有句级 SRT 时明确标记局部插值。"""
from __future__ import annotations

import hashlib
import math
import re

from srt_struct import parse_srt

DEFAULTS = {"block_target_ms": 20000, "block_warning_ms": 30000,
            "gap_ms": 800, "max_han_cps": 7, "max_visible_cps": 17,
            "short_ms": 800, "long_ms": 6000, "line_chars": 18,
            "overlap_tolerance_ms": 2, "target_han_cps": 5, "max_tail_ms": 300}
TAG = re.compile(r"<[^>\n]+>")


def normalized(text):
    return " ".join(text.split())


def snapshot(text, parameters=None, timing_data=None, source_sha256=None):
    config = dict(DEFAULTS)
    config.update(parameters or {})
    if set(config) != set(DEFAULTS) or any(type(n) not in (int, float) or not math.isfinite(n)
                                         or n <= 0 for n in config.values()):
        raise ValueError("排时参数必须为已知、有限、正数参数")
    entries = parse_srt(text).entries
    segments, pieces, cursor, warnings = [], [], 0, []
    for entry in entries:
        visible = normalized(TAG.sub("", entry.text))
        if not visible or entry.end_ms <= entry.start_ms:
            raise ValueError(f"{entry.entry_id} 空正文或零时长，不能可靠自然重排；可用 preserve")
        start, end = entry.start_ms, entry.end_ms
        if segments and start < segments[-1]["end_ms"]:
            overlap = segments[-1]["end_ms"] - start
            if overlap > config["overlap_tolerance_ms"]:
                raise ValueError(f"{entry.entry_id} 源时间重叠 {overlap}ms，局部范围冲突，不能静默移时")
            boundary = (start + segments[-1]["end_ms"]) // 2
            if boundary <= segments[-1]["start_ms"] or boundary >= end:
                raise ValueError("重叠归一化将产生零时长")
            segments[-1]["end_ms"] = boundary
            start = boundary
            warnings.append({"code": "rounding_overlap", "source_id": entry.entry_id,
                             "message": f"原始 {overlap}ms 舍入重叠以共同边界归一化，未平移段落"})
        if pieces:
            cursor += 1
        segments.append({"id": entry.entry_id, "start_char": cursor,
                         "end_char": cursor + len(visible), "start_ms": start, "end_ms": end,
                         "original_start_ms": entry.start_ms, "original_end_ms": entry.end_ms,
                         "text": visible, "raw_text": entry.text})
        pieces.append(visible)
        cursor += len(visible)
    document = " ".join(pieces)
    result = {"document": document, "segments": segments, "parameters": config,
              "basis": "srt-estimate", "warnings": warnings, "words": [], "pauses": []}
    if timing_data is not None:
        if not isinstance(timing_data, dict) or timing_data.get("source_sha256") != source_sha256:
            raise ValueError("词级元数据与源文件摘要不匹配")
        if timing_data.get("document_sha256") != hashlib.sha256(document.encode()).hexdigest():
            raise ValueError("词级元数据正文规范化或偏移不匹配")
        words = timing_data.get("words")
        if not isinstance(words, list) or not words:
            raise ValueError("词级元数据必须包含 words")
        previous_char, previous_time = 0, segments[0]["start_ms"]
        for word in words:
            if not isinstance(word, dict):
                raise ValueError("非法词级记录")
            a, b, lo, hi = [word.get(k) for k in ("start_char", "end_char", "start_ms", "end_ms")]
            if (any(type(n) is not int for n in (a, b, lo, hi)) or
                    not 0 <= a < b <= len(document) or a < previous_char or
                    document[previous_char:a].strip() or word.get("text") != document[a:b] or
                    not previous_time <= lo < hi <= segments[-1]["end_ms"]):
                raise ValueError("词级范围、文字、时间单位或时序不匹配")
            # 大偏移不能仅凭文件摘要掩盖；每个词须落在对应句级时间参照内。
            related = [s for s in segments if a < s["end_char"] and b > s["start_char"]]
            if not related or lo < related[0]["start_ms"] or hi > related[-1]["end_ms"]:
                raise ValueError("词级时间超出对应源条目范围，可能存在偏移")
            previous_char, previous_time = b, hi
        if document[previous_char:].strip():
            raise ValueError("词级记录未覆盖全部源文")
        result["words"], result["basis"] = words, "word-timestamps"
        pauses = timing_data.get("pauses", [])
        if not isinstance(pauses, list):
            raise ValueError("pauses 应为数组")
        for pause in pauses:
            if (not isinstance(pause, dict) or not isinstance(pause.get("kind"), str) or
                    type(pause.get("start_ms")) is not int or type(pause.get("end_ms")) is not int or
                    not segments[0]["start_ms"] <= pause["start_ms"] < pause["end_ms"] <= segments[-1]["end_ms"]):
                raise ValueError("停顿或切换区间非法")
            if any(w["start_ms"] < pause["end_ms"] and w["end_ms"] > pause["start_ms"] for w in words):
                raise ValueError("停顿区间与词语时间重叠")
        result["pauses"] = pauses
    result["document_sha256"] = hashlib.sha256(document.encode()).hexdigest()
    return result


def point(source, position, end=False):
    rows = source["words"] or source["segments"]
    for row in rows:
        a, b = row["start_char"], row["end_char"]
        if a <= position <= b:
            if source["words"]:
                if position not in (a, b):
                    raise ValueError("源范围切在词内部，请按完整词标注")
                return row["end_ms"] if end else row["start_ms"]
            return round(row["start_ms"] + (position-a) / (b-a) * (row["end_ms"]-row["start_ms"]))
    raise ValueError("源字符位置没有时间依据")


def timestamp(ms):
    seconds, fraction = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{fraction:03d}"


def range_ids(source, a, b):
    return [s["id"] for s in source["segments"] if a < s["end_char"] and b > s["start_char"]]


def silence_regions(source):
    gaps = [{"start_ms": a["end_ms"], "end_ms": b["start_ms"], "kind": "srt_gap"}
            for a, b in zip(source["segments"], source["segments"][1:])
            if b["start_ms"] - a["end_ms"] >= source["parameters"]["gap_ms"]]
    if source["words"]:
        gaps += [{"start_ms": a["end_ms"], "end_ms": b["start_ms"], "kind": "word_gap"}
                 for a, b in zip(source["words"], source["words"][1:])
                 if b["start_ms"] - a["end_ms"] >= source["parameters"]["gap_ms"]]
    return gaps + source["pauses"]


def style(source, a, b, text):
    if TAG.search(text):
        raise ValueError("语义稿只写可见译文，样式由程序回填")
    related = [s for s in source["segments"] if a < s["end_char"] and b > s["start_char"]]
    layouts = []
    for row in related:
        raw = row["raw_text"]
        tags = TAG.findall(raw)
        if not tags:
            layouts.append(("", ""))
            continue
        match = re.fullmatch(r"((?:<[^/!][^>]*>)+)([^<>]*?)((?:</[^>]+>)+)", raw, re.S)
        if not match:
            raise ValueError(f"{row['id']} 包含局部复杂样式，需保留模式或单独处理，不能丢弃")
        prefix, _, suffix = match.groups()
        opened = re.findall(r"<([\w]+)(?:\s[^>]*)?>", prefix)
        closed = re.findall(r"</([\w]+)>", suffix)
        if opened != list(reversed(closed)):
            raise ValueError("源样式标签未正确闭合")
        layouts.append((prefix, suffix))
    if len(set(layouts)) > 1:
        raise ValueError("同一意群跨越不同样式，请在样式边界拆分意群")
    prefix, suffix = layouts[0]
    return prefix + text + suffix


def schedule(source, draft):
    if not isinstance(draft, dict) or not isinstance(draft.get("blocks"), list) or not draft["blocks"]:
        raise ValueError("semantic 稿件需要非空 blocks")
    document, cursor = source["document"], 0
    cues, blocks, diagnostics, block_ids = [], [], list(source["warnings"]), set()
    gaps = silence_regions(source)
    for block in draft["blocks"]:
        if (not isinstance(block, dict) or not isinstance(block.get("id"), str) or
                not block["id"] or block["id"] in block_ids or
                not isinstance(block.get("units"), list) or not block["units"]):
            raise ValueError("语义段须有唯一 id 和非空 units")
        block_ids.add(block["id"])
        block_cues = []
        for unit in block["units"]:
            if not isinstance(unit, dict) or not isinstance(unit.get("source"), str):
                raise ValueError("意群需要连续原文 source 与译文 text")
            quote = normalized(unit["source"])
            while cursor < len(document) and document[cursor].isspace():
                cursor += 1
            a, b = cursor, cursor + len(quote)
            if not quote or document[a:b] != quote:
                raise ValueError(f"{block['id']} 在源位置 {a} 遗漏、重复或非连续，期望 {document[a:a+70]!r}")
            if (a and not document[a-1].isspace()) or (b < len(document) and not document[b].isspace()):
                raise ValueError("意群不能切开源文单词；标点可随词保留")
            text = unit.get("text")
            if (not isinstance(text, str) or not text.strip() or "\x00" in text or
                    re.search(r"\n\s*\n", text) or "-->" in text):
                raise ValueError("意群译文为空或含字幕结构内容")
            lo, hi = point(source, a), point(source, b, end=True)
            if lo >= hi:
                raise ValueError("意群时间过短或反向，请合并相邻意群")
            for gap in gaps:
                if lo < gap["end_ms"] and hi > gap["start_ms"]:
                    raise ValueError(f"{block['id']} 意群跨越已知留白／停顿 {gap}，请在边界拆分语义段")
            cue = {"id": f"cue-{len(cues)+1:06d}", "block_id": block["id"],
                   "source_range": [a, b], "source_ids": range_ids(source, a, b),
                   "start_ms": lo, "end_ms": hi, "text": style(source, a, b, text.strip()),
                   "basis": source["basis"]}
            if cues and lo < cues[-1]["end_ms"]:
                raise ValueError("候选字幕新增重叠，源范围或锚点冲突")
            cues.append(cue)
            block_cues.append(cue)
            cursor = b
        start, end = block_cues[0]["start_ms"], block_cues[-1]["end_ms"]
        # 每个局部段都记录自己的范围和内部源锚点，不以文件首尾替代。
        for gap in gaps:
            if start < gap["end_ms"] and end > gap["start_ms"]:
                raise ValueError(f"语义段 {block['id']} 跨越留白／切换区间，请拆段")
        # 只借段内、下条尚未出现前的短空隙改善阅读，重要内容的入点不挪动。
        # 不填已知长停顿，不跨段；长句仍需译者调整意群而不是大幅拖延。
        for current, following in zip(block_cues, block_cues[1:]):
            han = len(re.findall(r"[\u3400-\u9fff]", TAG.sub("", current["text"])))
            desired = round(han * 1000 / source["parameters"]["target_han_cps"])
            available = min(following["start_ms"], current["end_ms"] + source["parameters"]["max_tail_ms"])
            extended = max(current["end_ms"], min(available, current["start_ms"] + desired))
            if extended > current["end_ms"] and not any(
                    current["end_ms"] < g["end_ms"] and extended > g["start_ms"] for g in gaps):
                current["source_end_ms"] = current["end_ms"]
                current["end_ms"] = extended
                current["tail_extension_ms"] = extended - current["source_end_ms"]
        blocks.append({"id": block["id"], "source_range": [block_cues[0]["source_range"][0], cursor],
                       "start_ms": start, "end_ms": end,
                       "source_ids": range_ids(source, block_cues[0]["source_range"][0], cursor),
                       "anchors": [{"source_char": c["source_range"][0], "time_ms": c["start_ms"],
                                    "basis": c["basis"]} for c in block_cues]})
        if end-start > source["parameters"]["block_warning_ms"]:
            diagnostics.append({"code": "long_block", "block_id": block["id"],
                                "message": "语义段较长，请独立审校其内部锚点和语义划分"})
    if document[cursor:].strip():
        raise ValueError(f"稿件未覆盖全文，缺少 {document[cursor:cursor+80]!r}")
    for cue in cues:
        text = TAG.sub("", cue["text"])
        han = len(re.findall(r"[\u3400-\u9fff]", text))
        visible = len(re.sub(r"\s", "", text))
        duration = cue["end_ms"]-cue["start_ms"]
        cue["metrics"] = {"han_count": han, "visible_char_count": visible,
                          "han_cps": round(han*1000/duration, 2),
                          "visible_cps": round(visible*1000/duration, 2)}
        reasons = []
        if han*1000/duration > source["parameters"]["max_han_cps"]:
            reasons.append("汉字阅读压力")
        if not han and visible*1000/duration > source["parameters"]["max_visible_cps"]:
            reasons.append("可见字符阅读压力")
        if duration < source["parameters"]["short_ms"]: reasons.append("短条闪现")
        if duration > source["parameters"]["long_ms"]: reasons.append("长条展示")
        if len(text.splitlines()) > 2: reasons.append("超过两行")
        if any(len(line) > source["parameters"]["line_chars"] for line in text.splitlines()):
            reasons.append("检查行长与意群分行")
        if reasons:
            diagnostics.append({"code": "reading", "cue_id": cue["id"],
                                "source_ids": cue["source_ids"], "message": "、".join(reasons)})
    content = "\n\n".join(f"{i}\n{timestamp(c['start_ms'])} --> {timestamp(c['end_ms'])}\n{c['text']}"
                            for i, c in enumerate(cues, 1)) + "\n"
    parsed = parse_srt(content).entries
    if len(parsed) != len(cues) or any(d.code == "overlap_existing" for d in parse_srt(content).diagnostics):
        raise ValueError("候选 SRT 回读失败")
    return content, {"blocks": blocks, "cues": cues, "diagnostics": diagnostics,
                     "basis": source["basis"], "parameters": source["parameters"],
                     "gaps": gaps}
