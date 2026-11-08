#!/usr/bin/env python3
"""
video-tts — SRT 解析、文本归一化与配音时间窗规划。

`load_cues()` 把标准 SRT 解析成 `Cue` 列表：
- 保留每条字幕原始 `start` / `end`（`end` 超出视频时长时夹到视频时长）；
- `effective_start` 为本条实际可用的起点（与上一条重叠时夹到上一条结束时间）；
- `next_start` 为下一条字幕的开始时间（最后一条取视频时长，无视频时取自身 `end`）。

越界夹取与重叠夹取以人类可读的 warning 返回；时间轴非法、文本为空等直接抛
`SRTError`，消息里带条目号。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

_TIMESTAMP_RE = re.compile(
    r"^(?P<sign>-)?(?P<hours>\d+):(?P<minutes>\d{1,2}):(?P<seconds>\d{1,2})"
    r"(?P<separator>[,.])(?P<millis>\d+)$"
)
# 时间轴行里结束时间后可能带位置后缀（`00:00:04,000 X1:100 X2:200`）。
_LEADING_TIMESTAMP_RE = re.compile(
    r"^\s*(?P<ts>-?\d+:\d{1,2}:\d{1,2}[,.]\d+)"
)
_ASCII_ALNUM_RE = re.compile(r"[A-Za-z0-9]")
_WHITESPACE_RE = re.compile(r"\s+")
_BRACKETED_RE = re.compile(r"[\[\(（【].*[\]\)）】]")


@dataclass(frozen=True)
class Subtitle:
    index: int
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Cue:
    index: int
    start: float
    end: float
    text: str
    effective_start: float
    next_start: float
    # 语义合并后：本组覆盖的源 SRT 条目序号（未合并时为 None，报告按
    # [index] 处理）。用于 plan/dub 字幕与报告的源条目映射。
    source_indices: tuple[int, ...] | None = None
    # 该组正文是否来自用户授权的 text override（F08：改文可追溯）。
    text_edited: bool = False


class SRTError(ValueError):
    """SRT 内容非法（时间轴越界、零时长、空文本等）。"""


def parse_timestamp(ts: str) -> float:
    """把 `HH:MM:SS,mmm` 或 `HH:MM:SS.mmm` 转成秒。

    毫秒右补 / 截断到 3 位（`1,5` 视为 500 ms，`1,5001` 视为 500 ms）。
    允许前导 `-`，负数时间由 `load_cues` 报错。
    """
    match = _TIMESTAMP_RE.match(ts.strip())
    if not match:
        raise SRTError(f"invalid timestamp: {ts!r}")
    hours = int(match.group("hours"))
    minutes = int(match.group("minutes"))
    seconds = int(match.group("seconds"))
    millis = (match.group("millis") + "00")[:3]
    value = hours * 3600 + minutes * 60 + seconds + int(millis) / 1000.0
    return -value if match.group("sign") else value


def normalize_text(text: str) -> str:
    """合并多行字幕文本。

    去首尾空白、丢掉纯空白行；换行两侧都是 ASCII 字母/数字时补一个空格，
    否则直接拼接（中文之间不插空格）；最后把连续空白压成一个空格。
    """
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return ""
    merged = lines[0]
    for line in lines[1:]:
        if _ASCII_ALNUM_RE.match(merged[-1]) and _ASCII_ALNUM_RE.match(line[0]):
            merged += " "
        merged += line
    return _WHITESPACE_RE.sub(" ", merged).strip()


def _leading_timestamp(raw: str) -> str:
    """取时间轴字段开头的第一个时间戳，忽略其后的位置后缀。"""
    match = _LEADING_TIMESTAMP_RE.match(raw)
    return match.group("ts") if match else raw.strip()


def _read_blocks(path: Path) -> list[list[str]]:
    raw = Path(path).read_text(encoding="utf-8-sig")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    return [
        block.split("\n")
        for block in re.split(r"\n\s*\n", raw.strip())
        if block.strip()
    ]


def parse_srt(
    path: Path,
    *,
    skip_bracketed: bool = False,
    warnings: list[str] | None = None,
    lenient: bool = False,
) -> list[Subtitle]:
    """解析 SRT 为按开始时间排序的 `Subtitle` 列表。

    **默认严格**（F13，spec §9.1）：结构不完整的块（缺序号、缺时间轴、
    时间戳无法解析）抛 `SRTError`（带块号与原因），在合成前阻塞——不能
    跳过坏块后报告「完整成功」。`lenient=True` 保留旧行为：坏块跳过并
    写入 `warnings`（用户显式选择 `--lenient-srt` 时才用）。

    时间轴语义非法（负时间、零/负时长）或文本归一化后为空始终抛
    `SRTError`，与 lenient 无关。
    """
    subtitles: list[Subtitle] = []
    for block_number, lines in enumerate(_read_blocks(path), start=1):
        reason: str | None = None
        if len(lines) < 2:
            reason = "内容不足两行"
        else:
            try:
                index = int(lines[0].strip())
            except ValueError:
                reason = "缺少序号"
            else:
                timing = lines[1]
                if "-->" not in timing:
                    reason = "缺少时间轴"
                else:
                    start_raw, end_raw = timing.split("-->", 1)
                    try:
                        start = parse_timestamp(_leading_timestamp(start_raw))
                        end = parse_timestamp(_leading_timestamp(end_raw))
                    except SRTError as exc:
                        reason = f"时间戳无法解析（{exc}）"

        if reason is not None:
            if not lenient:
                raise SRTError(
                    f"SRT 第 {block_number} 块格式不完整（{reason}）；"
                    "默认严格解析不在合成前跳过坏块——修复该块，或显式"
                    "使用 --lenient-srt 跳过并确认内容缺失"
                )
            if warnings is not None:
                warnings.append(
                    f"SRT 第 {block_number} 块格式不完整（{reason}），已跳过"
                )
            continue

        text = normalize_text("\n".join(lines[2:]))
        if skip_bracketed and _BRACKETED_RE.fullmatch(text):
            continue
        if start < 0.0 or end < 0.0:
            raise SRTError(
                f"cue {index}: negative timestamp ({start:.3f}s -> {end:.3f}s)"
            )
        if end <= start:
            raise SRTError(
                f"cue {index}: end ({end:.3f}s) must be greater than start ({start:.3f}s)"
            )
        if not text:
            raise SRTError(f"cue {index}: text is empty after normalization")

        subtitles.append(Subtitle(index=index, start=start, end=end, text=text))

    subtitles.sort(key=lambda subtitle: subtitle.start)
    return subtitles


def load_cues(
    path: Path,
    video_duration: float | None = None,
    skip_bracketed: bool = False,
    lenient: bool = False,
) -> tuple[list[Cue], list[str]]:
    """解析 SRT 并计算每条字幕的配音时间窗。

    返回 `(cues, warnings)`。`warnings` 是给用户看的说明，包括 lenient
    模式下跳过的 malformed 块、结束时间超出视频时长被夹取、与上一条字幕
    重叠导致 `effective_start` 后移。默认严格解析（见 `parse_srt`）。
    """
    warnings: list[str] = []
    subtitles = parse_srt(
        path, skip_bracketed=skip_bracketed, warnings=warnings,
        lenient=lenient,
    )

    # 先把结束时间夹进视频时长，并记录 warning。
    bounded: list[tuple[Subtitle, float]] = []
    for subtitle in subtitles:
        end = subtitle.end
        if video_duration is not None:
            if subtitle.start >= video_duration:
                raise SRTError(
                    f"cue {subtitle.index}: start {subtitle.start:.3f}s is at or "
                    f"beyond video duration {video_duration:.3f}s"
                )
            if end > video_duration:
                warnings.append(
                    f"cue {subtitle.index}: 结束时间 {end:.3f}s 超出视频时长 "
                    f"{video_duration:.3f}s，已 clamp 到 {video_duration:.3f}s"
                )
                end = video_duration
        bounded.append((subtitle, end))

    # 再按上一条（夹取后的）结束时间计算 effective_start / next_start。
    cues: list[Cue] = []
    previous_end: float | None = None
    for position, (subtitle, end) in enumerate(bounded):
        effective_start = subtitle.start
        if previous_end is not None and subtitle.start < previous_end:
            warnings.append(
                f"cue {subtitle.index}: 开始时间 {subtitle.start:.3f}s 早于上一条"
                f"结束时间 {previous_end:.3f}s，effective_start 已夹到 "
                f"{previous_end:.3f}s"
            )
            effective_start = previous_end

        if position + 1 < len(bounded):
            next_start = bounded[position + 1][0].start
        elif video_duration is not None:
            next_start = video_duration
        else:
            next_start = end

        cues.append(
            Cue(
                index=subtitle.index,
                start=subtitle.start,
                end=end,
                text=subtitle.text,
                effective_start=effective_start,
                next_start=next_start,
            )
        )
        previous_end = end

    return cues, warnings


def format_timestamp(seconds: float) -> str:
    """把秒格式化成 SRT 时间戳 `HH:MM:SS,mmm`（负数按 0 处理）。"""
    millis = int(round(max(0.0, seconds) * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def write_srt(cues: Sequence[Subtitle | Cue], path: Path) -> None:
    """把条目写成标准 SRT：序号重排为 1..N，UTF-8 无 BOM。

    时间戳用 `format_timestamp`（逗号毫秒）；文本单行（`normalize_text()`
    归一过的 Cue 文本本就无换行）；条与条之间空一行，文件以单个换行结尾。
    """
    blocks = [
        f"{number}\n"
        f"{format_timestamp(cue.start)} --> {format_timestamp(cue.end)}\n"
        f"{cue.text}\n"
        for number, cue in enumerate(cues, start=1)
    ]
    path.write_text("\n".join(blocks), encoding="utf-8")
