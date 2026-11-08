"""Subtitle segmentation and SRT export (doc §9).

Rules implemented here:
- split at punctuation / pause / semantic boundaries; never inside an English word
- single line by default; unified display width (CJK=2, others=1) targets 20 CJK chars
  or 42 ASCII chars per line
- target max display duration 6s (configurable); overlong captions are split at
  real word-time units — never by proportional padding, never fabricating
  content for silence, never merging past the next sentence to hit a minimum
- one track, sorted, non-overlapping; 0 <= start < end <= media duration
- indices from 1, timestamps HH:MM:SS,mmm (milliseconds rounded then re-checked)
"""

import re
import math
import unicodedata
from typing import List, Optional, Tuple

DEFAULT_CONFIG = {
    "max_lines": 1,
    "line_width": 42,        # display-width units: ~20 CJK or ~42 ASCII chars
    "max_duration": 6.0,
    "sentence_gap": 0.8,     # pause (s) that ends a caption group
    "paragraph_gap": 2.0,    # pause (s) that starts a new TXT paragraph
}

STRONG_PUNCT = "。！？!?…."
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
    if word.get("verbatim") or word.get("tail"):
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
    positions, folded = [], []
    for i, ch in enumerate(text):
        if ch.isalnum():
            folded.append(ch.casefold())
            positions.extend([i] * len(ch.casefold()))
    source = "".join(folded)
    cores = ["".join(ch.casefold() for ch in w["text"] if ch.isalnum()) for w in words]
    if not all(cores) or "".join(cores) != source:
        return None
    # Retain raw punctuation, quotes, hyphens and spaces exactly; only the
    # placement of cue boundaries changes. Never rewrite the recognized text.
    units, cursor, offset = [], 0, 0
    for i, (word, core) in enumerate(zip(words, cores)):
        cursor += len(core)
        stop = positions[cursor] if cursor < len(positions) else len(text)
        units.append({**word, "text": text[offset:stop], "tail": "", "verbatim": True})
        offset = stop
    return units


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
        if out and (_is_ascii_word_char(out[-1]) or out[-1] in ".,!?;:\"')]") and _is_ascii_word_char(piece[0]):
            out += " "
        out += piece
    return out


def _unit_ends_sentence(unit: dict) -> bool:
    tail = (unit.get("tail") or unit["text"]).rstrip().rstrip('"”’』」）)》')
    return bool(tail) and tail[-1] in STRONG_PUNCT


def _unit_ends_clause(unit: dict) -> bool:
    tail = (unit.get("tail") or unit["text"].rstrip()[-1:] or "").rstrip()
    return bool(tail) and tail[-1] in WEAK_PUNCT


def units_to_text(units: List[dict]) -> str:
    """Rebuild display text from units (core + punctuation tail)."""
    if units and all(u.get("verbatim") for u in units):
        return "".join(u["text"] for u in units).strip()
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
        if gap >= sentence_gap or nxt.get("speaker_id") != word.get("speaker_id"):
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
    return _balanced_pieces(sentence, config)


def _balanced_pieces(sentence: List[dict], config: dict) -> List[List[dict]]:
    """Choose word boundaries globally within a sentence, avoiding orphan tails.

    Width/duration remain budgets, never a reason to discard a word. Function
    words, small gaps and very short final cues make worse cut candidates.
    """
    limit = config["max_lines"] * config["line_width"]
    n = len(sentence)
    costs, choices = [float("inf")] * (n + 1), [None] * n
    costs[n] = 0
    hanging = {"a", "an", "the", "of", "to", "with", "and", "or", "for", "in", "on", "by", "from", "ai"}
    for i in range(n - 1, -1, -1):
        for j in range(i + 1, n + 1):
            piece = sentence[i:j]
            width = display_width(units_to_text(piece))
            duration = max(w["end"] for w in piece) - piece[0]["start"]
            if j > i + 1 and (width > limit + 8 or duration > config["max_duration"]):
                break
            score = (1.0 + max(0, 0.8 - duration) * 3 + max(0, 0.35 * limit - width) / limit
                     + 8 * (max(0, width - limit) / limit) ** 2)
            if j < n:
                last = piece[-1]["text"].strip().lower().strip(".,;:!?，。！？")
                if last in hanging or (last and last[-1] in "的地得把被与及"):
                    score += 3
                first_next = sentence[j]["text"].strip().lower().strip(".,;:!?，。！？")
                if first_next == "of" or (last in {"break", "breaking", "broke"} and first_next == "down"):
                    score += 3
                if _unit_ends_clause(piece[-1]):
                    score -= 0.6
                score -= min(0.3, max(0, sentence[j]["start"] - piece[-1]["end"]))
            if score + costs[j] < costs[i]:
                costs[i], choices[i] = score + costs[j], j
    out, cursor = [], 0
    while cursor < n:
        nxt = choices[cursor]
        out.append(sentence[cursor:nxt])
        cursor = nxt
    return out


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
        if not math.isfinite(word["start"]) or not math.isfinite(word["end"]) or word["end"] < word["start"]:
            raise ValueError("Invalid word timestamps")
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
                "end": max(w["end"] for w in piece),
                "text": text,
                "lines": [" ".join(text.split())] if cfg["max_lines"] == 1 else wrap_text(text, cfg["line_width"]),
                "speaker_id": piece[0].get("speaker_id"),
            })
    return entries


def finalize_entries(entries: List[dict], duration: Optional[float]) -> Tuple[List[dict], List[str]]:
    """Resolve minor boundary errors without dropping/reordering any content.

    Invalid spans fail before publication. Coincident/contained cue spans are
    merged, rather than assigning invented within-word timestamps.
    """
    warnings: List[str] = []
    cleaned = [e for e in entries if str(e.get("text", "")).strip()]

    result: List[dict] = []
    for entry in cleaned:
        start, end = float(entry["start"]), float(entry["end"])
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            raise ValueError("Invalid caption span; content retained in inference cache")
        if duration is not None:
            if start >= duration:
                raise ValueError("Caption starts beyond media duration")
            if end > duration:
                if end - duration <= 0.06:
                    end = duration  # float boundary error at the media tail
                else:
                    raise ValueError("Caption ends beyond media duration by more than 60ms")
            start = max(0.0, min(start, duration))
        if result and start < result[-1]["end"]:
            prev = result[-1]
            overlap = prev["end"] - start
            if overlap <= 0.08 and end > prev["end"]:
                start = prev["end"]
                warnings.append(f"shifted overlapping caption start by {overlap:.3f}s")
            elif start > prev["start"] and overlap <= 0.08:
                # The aligner stretched the previous entry (observed on
                # English words inside Chinese speech) — truncate it instead
                # of dropping this caption's content.
                result[-1] = {**prev, "end": start}
                warnings.append(
                    f"truncated previous caption end by {overlap:.3f}s to resolve overlap"
                )
            else:
                if overlap > 0.5:
                    raise ValueError("Severe caption overlap; alignment must be checked")
                if start < prev["start"] - 0.08:
                    raise ValueError("Caption time order contradicts source text order")
                merged = join_word_texts([prev["text"], entry["text"]])
                result[-1] = {**prev, "end": max(prev["end"], end), "text": merged, "lines": [merged]}
                warnings.append(f"merged overlapping captions ({overlap:.3f}s); no text dropped")
                continue
        if end <= start:
            raise ValueError("Caption has no remaining display duration")
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
        lines = entry.get("lines") or [" ".join(entry["text"].split())]
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
    if len(re.split(r"\n\s*\n", text.strip())) != len(entries):
        issues.append("SRT contains malformed blocks")
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
