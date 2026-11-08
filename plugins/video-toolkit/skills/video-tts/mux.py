#!/usr/bin/env python3
"""
video-tts — 视频探测、混流与成片校验。

`probe_video()` 用 ffprobe 读第一条视频流的编码、分辨率、帧率与时长，供
CLI 决定主音轨长度与是否重编码。MKV / WebM 的视频流条目常常没有
`duration`，此时回退到同一次 ffprobe 输出里的容器级 `format.duration`。
`needs_reencode()` 只放行 mp4 可直接复制的 H.264 / HEVC；VP9 / AV1 及
未知编码一律重编码为 H.264。

`mux_video()` 用一条 ffmpeg 把配音轨替换进视频（不映射原音轨、不用
`-shortest`），AAC 显式采用与音轨相同的采样率（默认 48kHz）。成品先写
临时文件，**校验通过后原子替换**——失败不覆盖、不删除用户已有成品。
`verify_output()` 要求成片恰好一条视频流 + 一条 AAC 音频流，且视频与
音频流时长都与输入视频相差不超过 `tolerance` 秒（只验视频时长会漏掉
末段音频缺失）。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

# mp4 容器可直接复制、无需重编码的视频编码。
COPY_CODECS = frozenset({"h264", "hevc"})

FFPROBE_BASE = ["ffprobe", "-v", "error"]
PROBE_ENTRIES = (
    "stream=codec_name,width,height,r_frame_rate,duration:format=duration"
)
VERIFY_ENTRIES = "stream=codec_type,codec_name,duration:format=duration"


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


def probe_audio_duration(path: Path) -> float:
    """探测纯音频文件的容器时长（用于只给音频、不混流的配音）。"""
    probe = _ffprobe("format=duration", path)
    raw = (probe.get("format") or {}).get("duration")
    try:
        return float(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"could not determine audio duration for {path}") from exc


def needs_reencode(codec_name: str) -> bool:
    """编码不能直接复制进 mp4 时返回 True（含 VP9 / AV1）。"""
    return codec_name not in COPY_CODECS


def mux_video(
    video: Path,
    track: Path,
    out: Path,
    codec_name: str,
    sample_rate: int = 48000,
) -> None:
    """把 `track` 作为唯一音轨混进 `video`，原子写出 `out` 并校验。

    先探测输入视频时长作为校验基准；视频编码可直接复制时用 `-c:v copy`，
    否则用 `-c:v libx264 -crf 18 -preset medium` 重编码。AAC 显式 `-ar
    sample_rate` 与音轨一致。ffmpeg 先写临时文件，混流 + `verify_output`
    都通过后才 `os.replace` 成 `out`；任何失败只清理临时文件，不触碰
    `out` 已有的内容。
    """
    expected = probe_video(video).duration
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=out.parent, prefix=f".{out.name}.", suffix=".tmp.mp4"
    )
    os.close(fd)
    Path(tmp_name).unlink()  # ffmpeg 需要按后缀推断格式，不留空文件。

    command = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-i", str(track),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-map_metadata", "0",
    ]
    if needs_reencode(codec_name):
        print(
            f"warning: 视频编码 {codec_name or 'unknown'} 无法直接复制进 mp4，"
            "正在重编码为 H.264（耗时变长）",
            file=sys.stderr,
        )
        command += ["-c:v", "libx264", "-crf", "18", "-preset", "medium"]
    else:
        command += ["-c:v", "copy"]
    command += [
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", str(sample_rate),
        "-movflags", "+faststart",
        tmp_name,
    ]

    try:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            raise RuntimeError(f"ffmpeg mux failed for {out}: {stderr}")
        verify_output(Path(tmp_name), expected)
        os.replace(tmp_name, out)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def verify_output(
    path: Path,
    expected_duration: float,
    tolerance: float = 0.2,
) -> None:
    """校验成片：一条视频流 + 一条 AAC 音频流，两条流时长都 ≤ `tolerance`。"""
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
    audio_codec = audios[0].get("codec_name")
    if audio_codec != "aac":
        raise RuntimeError(
            f"expected AAC audio stream in {path}, found {audio_codec!r}"
        )
    video_duration = _duration(videos[0], probe, path)
    drift = abs(video_duration - expected_duration)
    if drift > tolerance:
        raise RuntimeError(
            f"output video duration {video_duration:.3f}s differs from "
            f"expected {expected_duration:.3f}s by {drift:.3f}s "
            f"(tolerance {tolerance:.3f}s)"
        )
    # 音频流时长单独校验：只看视频时长会漏掉「末段音频缺失」的坏成品。
    try:
        audio_duration = _duration(audios[0], probe, path)
    except RuntimeError:
        return  # 容器与流都没给音频时长时跳过（部分封装不记录）。
    audio_drift = abs(audio_duration - expected_duration)
    if audio_drift > tolerance:
        raise RuntimeError(
            f"output audio duration {audio_duration:.3f}s differs from "
            f"expected {expected_duration:.3f}s by {audio_drift:.3f}s "
            f"(tolerance {tolerance:.3f}s); trailing audio may be missing"
        )
