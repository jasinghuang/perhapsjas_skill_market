#!/usr/bin/env python3
"""
video-tts — 视频探测、混流与成片校验。

`probe_video()` 用 ffprobe 读第一条视频流的编码、分辨率、帧率与时长，供
CLI 决定主音轨长度与是否重编码。MKV / WebM 的视频流条目常常没有
`duration`，此时回退到同一次 ffprobe 输出里的容器级 `format.duration`。
`needs_reencode()` 只放行 mp4 可直接复制的 H.264 / HEVC；VP9 / AV1 及
未知编码一律重编码为 H.264（AV1 虽然理论上可装进 mp4，但兼容性差，按
spec §9 统一重编码）。

`mux_video()` 用一条 ffmpeg 把配音轨替换进视频（不映射原音轨、不用
`-shortest`），失败或产出校验不过时删除半成品，避免留下音画不同步的
文件。`verify_output()` 要求成片恰好一条视频流 + 一条音频流，且视频时长
与输入视频相差不超过 `tolerance` 秒。
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

# mp4 容器可直接复制、无需重编码的视频编码。
COPY_CODECS = frozenset({"h264", "hevc"})

FFPROBE_BASE = ["ffprobe", "-v", "error"]
PROBE_ENTRIES = (
    "stream=codec_name,width,height,r_frame_rate,duration:format=duration"
)
VERIFY_ENTRIES = "stream=codec_type,duration:format=duration"


@dataclass(frozen=True)
class VideoInfo:
    duration: float
    codec_name: str
    width: int
    height: int
    fps: str


def _ffprobe(
    entries: str,
    path: Path,
    select_streams: str | None = None,
) -> dict:
    """跑一次 ffprobe 并返回解析后的 JSON；失败抛 `RuntimeError`。"""
    command = [*FFPROBE_BASE]
    if select_streams is not None:
        command += ["-select_streams", select_streams]
    command += [
        "-show_entries", entries,
        "-of", "json",
        str(path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(f"ffprobe failed for {path}: {stderr}")
    return json.loads(result.stdout)


def _duration(stream: dict, probe: dict, path: Path) -> float:
    """取流时长；流条目没有 `duration`（MKV/WebM 常见）时用容器时长。"""
    container = probe.get("format") or {}
    for raw in (stream.get("duration"), container.get("duration")):
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    raise RuntimeError(f"could not determine duration for {path}")


def probe_video(path: Path) -> VideoInfo:
    """探测第一条视频流的基本信息。"""
    probe = _ffprobe(PROBE_ENTRIES, path, select_streams="v:0")
    streams = probe.get("streams", [])
    if not streams:
        raise RuntimeError(f"no video stream found in {path}")
    stream = streams[0]
    return VideoInfo(
        duration=_duration(stream, probe, path),
        codec_name=stream.get("codec_name", ""),
        width=int(stream.get("width", 0)),
        height=int(stream.get("height", 0)),
        fps=stream.get("r_frame_rate", ""),
    )


def needs_reencode(codec_name: str) -> bool:
    """编码不能直接复制进 mp4 时返回 True（含 VP9 / AV1）。"""
    return codec_name not in COPY_CODECS


def _remove_quietly(path: Path) -> None:
    """删除半成品；文件不存在或删除失败都不再抛错。"""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def mux_video(video: Path, track: Path, out: Path, codec_name: str) -> None:
    """把 `track` 作为唯一音轨混进 `video`，写出 `out` 并校验。

    先探测输入视频时长作为校验基准；视频编码可直接复制时用 `-c:v copy`，
    否则用 `-c:v libx264 -crf 18 -preset medium` 重编码。ffmpeg 失败、或
    混流后校验不通过（缺流、时长漂移）都会删除 `out` 再抛 `RuntimeError`。
    """
    expected = probe_video(video).duration
    command = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-i", str(track),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-map_metadata", "0",
    ]
    if needs_reencode(codec_name):
        command += ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]
    else:
        command += ["-c:v", "copy"]
    command += [
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(out),
    ]

    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        _remove_quietly(out)
        stderr = (result.stderr or "").strip()
        raise RuntimeError(f"ffmpeg mux failed for {out}: {stderr}")

    try:
        verify_output(out, expected)
    except Exception:
        _remove_quietly(out)
        raise


def verify_output(
    path: Path,
    expected_duration: float,
    tolerance: float = 0.2,
) -> None:
    """校验成片：恰好一条视频流 + 一条音频流，时长与期望相差 ≤ `tolerance`。"""
    probe = _ffprobe(VERIFY_ENTRIES, path)
    streams = probe.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(videos) != 1:
        raise RuntimeError(
            f"expected exactly one video stream in {path}, found {len(videos)}"
        )
    if len(audios) != 1:
        raise RuntimeError(
            f"expected exactly one audio stream in {path}, found {len(audios)}"
        )
    duration = _duration(videos[0], probe, path)
    drift = abs(duration - expected_duration)
    if drift > tolerance:
        raise RuntimeError(
            f"output duration {duration:.3f}s differs from expected "
            f"{expected_duration:.3f}s by {drift:.3f}s "
            f"(tolerance {tolerance:.3f}s)"
        )
