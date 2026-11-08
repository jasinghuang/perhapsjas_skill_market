"""Subtitle segmentation and SRT export (doc §9).

Rules implemented here:
- split at punctuation / pause / semantic boundaries; never inside an English word
- at most 2 lines; unified display width (CJK=2, others=1) targets 20 CJK chars
  or 42 ASCII chars per line
- target max display duration 6s (configurable); overlong captions are split at
  real word-time units — never by proportional padding, never fabricating
  content for silence, never merging past the next sentence to hit a minimum
- one track, sorted, non-overlapping; 0 <= start < end <= media duration
- indices from 1, timestamps HH:MM:SS,mmm (milliseconds rounded then re-checked)
"""

import re
import unicodedata
from typing import List, Optional, Tuple

DEFAULT_CONFIG = {
    "max_lines": 2,
    "line_width": 42,        # display-width units: ~20 CJK or ~42 ASCII chars
    "max_duration": 6.0,
    "sentence_gap": 0.8,     # pause (s) that ends a caption group
    "paragraph_gap": 2.0,    # pause (s) that starts a new TXT paragraph
}

STRONG_PUNCT = "。！？!?…"
WEAK_PUNCT = "，、；：,;:"
# Characters that may trail a word unit as punctuation (never '-' — it lives
# inside English words).
_TAIL_PUNCT_CHARS = set(STRONG_PUNCT + WEAK_PUNCT + "”』」）)》.…·—～~\"'")


def _tail_punct(text: str) -> str:
    """Trailing punctuation run of a word unit (may be empty)."""
    i = len(text)
    while i > 0 and text[i - 1] in _TAIL_PUNCT_CHARS:
        i -= 1
    return text[i:]


def _is_unit_char(ch: str) -> bool:
    """Letters/digits/apostrophe — the characters forced aligners keep."""
    if ch == "'":
        return True
    category = unicodedata.category(ch)
    return category.startswith("L") or category.startswith("N")


def split_word_punct(word: dict) -> dict:
    """Normalize a word unit: core text + trailing punctuation in `tail`."""
    if word.get("tail"):
        return word  # already normalized (e.g. attach_punctuation output)
    text = word["text"].rstrip()
    tail = _tail_punct(text)
    core = text[: len(text) - len(tail)] if tail else text
    return {**word, "text": (core or word["text"]).rstrip(), "tail": tail}


def attach_punctuation(words: List[dict], text: str) -> Optional[List[dict]]:
    """Map punctuation from the raw ASR text back onto punctuation-free word
    units (Qwen's aligner strips punctuation while its text keeps it).

    Returns units whose `tail` carries the punctuation that followed each
    word in the raw text, or None when the sequences don't line up (callers
    then keep the original words and lose only punctuation-based grouping).
    """
    if not words or not text:
        return None
    if any(_tail_punct(w["text"]) for w in words):
        return None  # units already carry punctuation (e.g. Scribe)

    units = []
    pos = 0
    pending = ""
    for word in words:
        core = "".join(ch for ch in word["text"] if _is_unit_char(ch))
        if not core:
            continue
        while pos < len(text) and not _is_unit_char(text[pos]):
            pending += text[pos]
            pos += 1
        if text[pos: pos + len(core)] != core:
            return None
        pos += len(core)
        tail = ""
        while pos < len(text) and not _is_unit_char(text[pos]):
            tail += text[pos]
            pos += 1
        units.append({**word, "text": core, "tail": (pending + tail).rstrip()})
        pending = ""
    # Anything left over must be punctuation only — real content means mismatch.
    if any(_is_unit_char(ch) for ch in text[pos:]):
        return None
    return units or None


def display_width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in text)


def _is_ascii_word_char(ch: str) -> bool:
    return ch.isascii() and (ch.isalnum() or ch in "'’-")


def join_word_texts(word_texts: List[str]) -> str:
    """Join word units; space only between ASCII word characters."""
    out = ""
    for piece in word_texts:
        piece = piece.strip()
        if not piece:
            continue
        if out and _is_ascii_word_char(out[-1]) and _is_ascii_word_char(piece[0]):
            out += " "
        out += piece
    return out


def _unit_ends_sentence(unit: dict) -> bool:
    tail = (unit.get("tail") or unit["text"][-1:] or "").rstrip()
    return bool(tail) and tail[-1] in STRONG_PUNCT


def _unit_ends_clause(unit: dict) -> bool:
    tail = (unit.get("tail") or unit["text"][-1:] or "").rstrip()
    return bool(tail) and tail[-1] in WEAK_PUNCT


def units_to_text(units: List[dict]) -> str:
    """Rebuild display text from units (core + punctuation tail)."""
    out = ""
    prev_core_ascii = False
    for unit in units:
        core = unit["text"]
        tail = unit.get("tail", "")
        if out and prev_core_ascii and core and _is_ascii_word_char(core[0]):
            out += " "
        out += core + tail
        prev_core_ascii = bool(core) and _is_ascii_word_char(core[-1])
    return out


def group_sentences(words: List[dict], sentence_gap: float) -> List[List[dict]]:
    """Group word units into sentences at strong punctuation or long pauses."""
    sentences: List[List[dict]] = []
    current: List[dict] = []
    for i, word in enumerate(words):
        current.append(word)
        end_of_input = i == len(words) - 1
        if end_of_input or _unit_ends_sentence(word):
            sentences.append(current)
            current = []
            continue
        nxt = words[i + 1]
        gap = nxt["start"] - word["end"]
        if gap >= sentence_gap:
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return sentences


def _split_oversized(sentence: List[dict], config: dict) -> List[List[dict]]:
    """Split one sentence that exceeds the duration or width budget.

    Cut points are, in order of preference: clause punctuation, then the
    largest word gaps. Times always come from actual word units.
    """
    max_width = config["max_lines"] * config["line_width"]
    max_duration = config["max_duration"]

    text_width = display_width(units_to_text(sentence))
    duration = sentence[-1]["end"] - sentence[0]["start"]
    if text_width <= max_width and duration <= max_duration:
        return [sentence]

    pieces: List[List[dict]] = []
    current: List[dict] = []
    current_width = 0
    last_clause_cut = -1  # index in `current` after which a weak-punct cut is allowed

    for i, word in enumerate(sentence):
        piece_width = display_width(word["text"]) or 1
        prospective = current_width + piece_width
        cur_duration = word["end"] - current[0]["start"] if current else 0
        over = current and (
            prospective > max_width or cur_duration > max_duration
        )
        if over:
            # Prefer cutting after the last clause punctuation inside `current`.
            if last_clause_cut >= 0:
                head, current_tail = current[: last_clause_cut + 1], current[last_clause_cut + 1 :]
                pieces.append(head)
                current = current_tail
                current_width = display_width(units_to_text(current))
                last_clause_cut = -1
            else:
                # No punctuation: cut before this word, i.e. `current` is a piece.
                pieces.append(current)
                current = []
                current_width = 0
                last_clause_cut = -1
        current.append(word)
        current_width += piece_width
        if _unit_ends_clause(word):
            last_clause_cut = len(current) - 1

    if current:
        pieces.append(current)

    # A piece may still be oversized if a single word is huge or one clause
    # runs past max_duration with no punctuation at all. Split those at their
    # largest word gap so no piece wildly exceeds the budget.
    final: List[List[dict]] = []
    for piece in pieces:
        duration = piece[-1]["end"] - piece[0]["start"]
        width = display_width(units_to_text(piece))
        if duration <= max_duration and width <= max_width:
            final.append(piece)
            continue
        final.extend(_split_at_largest_gaps(piece, config))
    return final


def _split_at_largest_gaps(piece: List[dict], config: dict) -> List[List[dict]]:
    max_width = config["max_lines"] * config["line_width"]
    if len(piece) <= 1:
        return [piece]
    gaps = sorted(
        range(len(piece) - 1),
        key=lambda i: piece[i + 1]["start"] - piece[i]["end"],
        reverse=True,
    )
    for cut in gaps:
        head, tail = piece[: cut + 1], piece[cut + 1 :]
        head_ok = (
            head[-1]["end"] - head[0]["start"] <= config["max_duration"]
            and display_width(units_to_text(head)) <= max_width
        )
        tail_ok = (
            len(tail) == 1
            or (
                tail[-1]["end"] - tail[0]["start"] <= config["max_duration"]
                and display_width(units_to_text(tail)) <= max_width
            )
        )
        if head_ok:
            return [head] + (_split_at_largest_gaps(tail, config) if not tail_ok else [tail])
    return [piece]


def wrap_text(text: str, line_width: int) -> List[str]:
    """Display-width-aware wrap; ASCII words are never split mid-word."""
    lines: List[str] = []
    current = ""
    current_w = 0
    for ch in text:
        ch_w = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if current and current_w + ch_w > line_width:
            if ch.isascii() and ch.isalnum():
                # don't break an ASCII word: move it to the next line
                match = re.search(r"[^\s]+$", current)
                if match and match.start() > 0:
                    word = current[match.start():]
                    lines.append(current[: match.start()].rstrip())
                    current = word
                    current_w = display_width(word)
                else:
                    lines.append(current.rstrip())
                    current, current_w = "", 0
            else:
                lines.append(current.rstrip())
                current, current_w = "", 0
        current += ch
        current_w += ch_w
    if current.strip():
        lines.append(current.rstrip())
    return lines or [""]


MIN_WORD_DURATION = 0.08  # one video frame-ish: aligners emit zero-length spans
                          # for some tokens (observed on English words with
                          # Qwen3-ForcedAligner); keep the content, fix the span.


def normalize_word_spans(words: List[dict]) -> List[dict]:
    """Give zero-length word spans a minimal duration so captions built from
    them are never dropped as degenerate."""
    fixed = []
    for word in words:
        if word["end"] <= word["start"]:
            fixed.append({**word, "end": word["start"] + MIN_WORD_DURATION})
        else:
            fixed.append(word)
    return fixed


def build_entries(words: List[dict], config: Optional[dict] = None) -> List[dict]:
    """Word units -> final subtitle entries (unsorted/uncapped).

    Units are normalized first so trailing punctuation lives in `tail`
    (whether it came attached, e.g. Scribe, or via attach_punctuation).
    """
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    units = [split_word_punct(w) for w in normalize_word_spans(words)
             if str(w.get("text", "")).strip()]
    entries = []
    for sentence in group_sentences(units, cfg["sentence_gap"]):
        for piece in _split_oversized(sentence, cfg):
            text = units_to_text(piece)
            if not text:
                continue
            entries.append({
                "start": piece[0]["start"],
                "end": piece[-1]["end"],
                "text": text,
                "lines": wrap_text(text, cfg["line_width"])[: cfg["max_lines"]],
            })
    return entries


def finalize_entries(entries: List[dict], duration: Optional[float]) -> Tuple[List[dict], List[str]]:
    """Sort, drop empties, clamp to media duration, resolve overlaps.

    Returns (entries, warnings). Small float-boundary errors are corrected and
    recorded; structurally broken entries are dropped, never silently kept.
    """
    warnings: List[str] = []
    cleaned = [e for e in entries if str(e.get("text", "")).strip()]
    cleaned.sort(key=lambda e: (e["start"], e["end"]))

    result: List[dict] = []
    for entry in cleaned:
        start, end = float(entry["start"]), float(entry["end"])
        if end <= start:
            warnings.append(f"dropped zero-length caption '{entry['text'][:20]}' ({start:.3f})")
            continue
        if duration is not None:
            if start >= duration:
                warnings.append(f"dropped caption past media end '{entry['text'][:20]}'")
                continue
            if end > duration:
                if end - duration <= 0.06:
                    end = duration  # float boundary error at the media tail
                else:
                    warnings.append(
                        f"clamped caption end {end:.3f} -> {duration:.3f} '{entry['text'][:20]}'"
                    )
                    end = duration
            start = max(0.0, min(start, duration))
        if result and start < result[-1]["end"]:
            prev = result[-1]
            overlap = prev["end"] - start
            if overlap <= 0.5 and end > prev["end"]:
                start = prev["end"]
                warnings.append(f"shifted overlapping caption start by {overlap:.3f}s")
            elif start > prev["start"]:
                # The aligner stretched the previous entry (observed on
                # English words inside Chinese speech) — truncate it instead
                # of dropping this caption's content.
                result[-1] = {**prev, "end": start}
                warnings.append(
                    f"truncated previous caption end by {overlap:.3f}s to resolve overlap"
                )
            else:
                warnings.append(f"dropped overlapping caption '{entry['text'][:20]}'")
                continue
        if end <= start:
            continue
        entry = {**entry, "start": start, "end": end}
        result.append(entry)
    return result, warnings


# --- timestamp formatting / parsing -----------------------------------------

def format_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


_TIMESTAMP_RE = re.compile(r"(\d+):(\d+):(\d+)[,.](\d{1,3})")


def parse_timestamp(stamp: str) -> float:
    match = _TIMESTAMP_RE.fullmatch(stamp.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {stamp!r}")
    h, m, s, ms = match.groups()
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000.0


def entries_to_srt(entries: List[dict]) -> str:
    blocks = []
    for i, entry in enumerate(entries, 1):
        lines = entry.get("lines") or wrap_text(entry["text"], DEFAULT_CONFIG["line_width"])
        blocks.append("\n".join([
            str(i),
            f"{format_timestamp(entry['start'])} --> {format_timestamp(entry['end'])}",
            "\n".join(lines),
        ]))
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def parse_srt(text: str) -> List[Tuple[int, float, float, str]]:
    entries = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [line for line in block.splitlines() if line.strip()]
        if len(lines) < 3 or "-->" not in lines[1]:
            continue
        try:
            index = int(lines[0].strip())
            start_s, end_s = lines[1].split("-->")
            start, end = parse_timestamp(start_s), parse_timestamp(end_s)
        except ValueError:
            continue
        entries.append((index, start, end, "\n".join(lines[2:])))
    return entries


def validate_srt(text: str, duration: Optional[float] = None) -> List[str]:
    """Parse-back validation: sequential indices, valid ordered times."""
    issues: List[str] = []
    entries = parse_srt(text)
    if not entries:
        return ["SRT contains no parseable entries"]
    for expected, (index, start, end, body) in zip(range(1, len(entries) + 1), entries):
        if index != expected:
            issues.append(f"index {index} out of order (expected {expected})")
        if not body.strip():
            issues.append(f"entry {index} has empty text")
        if end <= start:
            issues.append(f"entry {index}: end {end:.3f} <= start {start:.3f}")
    for i in range(1, len(entries)):
        if entries[i][1] < entries[i - 1][1]:
            issues.append(
                f"entry {entries[i][0]} is out of order "
                f"(starts {entries[i][1]:.3f} before entry {entries[i - 1][0]} at {entries[i - 1][1]:.3f})"
            )
        if entries[i][1] < entries[i - 1][2] - 1e-6:
            issues.append(f"entry {entries[i][0]} overlaps entry {entries[i - 1][0]}")
    if duration is not None:
        for index, start, end, _ in entries:
            if start < 0 or end > duration + 0.06:
                issues.append(f"entry {index} escapes media timeline [{start:.3f}, {end:.3f}]")
    return issues
