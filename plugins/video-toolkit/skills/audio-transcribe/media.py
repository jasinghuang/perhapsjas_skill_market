"""Media probing, preprocessing and chunk planning.

All external calls go through parameter arrays (never a joined shell string),
so paths with Chinese characters, spaces and Windows drive letters stay intact.
Inputs are never modified; preprocessed audio lands in a caller-supplied
temporary directory.
"""

import json
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple

# Formats the skill advertises. ffmpeg usually accepts more, but we only
# promise the tested set (doc: WAV/MP3/M4A/FLAC/MP4/MOV).
SUPPORTED_SUFFIXES = {
    ".wav", ".mp3", ".m4a", ".flac", ".mp4", ".mov",
    ".aac", ".ogg", ".opus", ".wma", ".mkv", ".webm", ".avi", ".ts",
}


class MediaError(Exception):
    """Raised for corrupt input, missing audio track, or ffmpeg failures."""


def _run(cmd: List[str], timeout: float = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout
        )
    except FileNotFoundError as exc:
        raise MediaError(f"Required tool not found: {cmd[0]}. Install ffmpeg/ffprobe first.") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{cmd[0]} timed out after {timeout}s") from exc


def check_supported(path: Path) -> None:
    if not path.is_file():
        raise MediaError(f"File not found: {path}")
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise MediaError(
            f"Unsupported file type '{path.suffix}'. Supported: {', '.join(sorted(SUPPORTED_SUFFIXES))}"
        )


def probe_media(path) -> dict:
    """Return duration (seconds) and the audio streams of a media file.

    Raises MediaError before any transcription/upload when the file is
    corrupt or has no audio track (doc §12).
    """
    path = Path(path)
    check_supported(path)

    result = _run([
        "ffprobe", "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(path),
    ])
    if result.returncode != 0:
        raise MediaError(f"ffprobe could not read the file (corrupt or unsupported): {path}")

    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise MediaError(f"ffprobe returned unparsable output for: {path}") from exc

    audio_streams = []
    for stream in info.get("streams", []):
        if stream.get("codec_type") != "audio":
            continue
        audio_streams.append({
            "index": int(stream.get("stream_index", stream.get("index", 0))),
            "codec": stream.get("codec_name", "unknown"),
            "channels": int(stream.get("channels", 0) or 0),
            "language": (stream.get("tags") or {}).get("language"),
        })

    if not audio_streams:
        raise MediaError(f"No audio track found in: {path}")

    duration = None
    fmt_duration = (info.get("format") or {}).get("duration")
    if fmt_duration:
        try:
            duration = float(fmt_duration)
        except ValueError:
            duration = None
    if duration is None:
        for stream in info.get("streams", []):
            if stream.get("duration"):
                try:
                    duration = float(stream["duration"])
                    break
                except ValueError:
                    continue
    if duration is None or duration <= 0:
        raise MediaError(f"Could not determine media duration: {path}")

    return {"duration": duration, "audio_streams": audio_streams}


def to_wav16k_mono(src, dst, stream_index: Optional[int] = None) -> Path:
    """Convert to 16 kHz mono PCM WAV (local Qwen preprocessing, doc §8)."""
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src)]
    if stream_index is not None:
        cmd += ["-map", f"0:{stream_index}"]
    cmd += ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)]
    result = _run(cmd, timeout=1800)
    if result.returncode != 0 or not dst.is_file():
        raise MediaError(f"ffmpeg audio extraction failed: {result.stderr.strip()[:500]}")
    return dst


def extract_chunk(wav_path, start: float, duration: float, dst) -> Path:
    """Cut [start, start+duration) out of a WAV file without re-encoding."""
    wav_path, dst = Path(wav_path), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    result = _run([
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
        "-i", str(wav_path), "-c", "copy", str(dst),
    ], timeout=300)
    if result.returncode != 0 or not dst.is_file():
        raise MediaError(f"ffmpeg chunk extraction failed: {result.stderr.strip()[:500]}")
    return dst


def detect_silences(wav_path, noise_db: str = "-35dB", min_silence: float = 0.6) -> List[Tuple[float, float]]:
    """Return (start, end) silence intervals using ffmpeg silencedetect."""
    result = _run([
        "ffmpeg", "-hide_banner", "-nostats",
        "-i", str(wav_path),
        "-af", f"silencedetect=noise={noise_db}:d={min_silence}",
        "-f", "null", "-",
    ], timeout=1800)
    intervals = []
    pending_start = None
    for line in (result.stderr or "").splitlines():
        line = line.strip()
        if "silence_start:" in line:
            try:
                pending_start = float(line.split("silence_start:")[1].split("|")[0].strip())
            except (IndexError, ValueError):
                pending_start = None
        elif "silence_end:" in line and pending_start is not None:
            try:
                end = float(line.split("silence_end:")[1].split("|")[0].strip())
            except (IndexError, ValueError):
                continue
            intervals.append((pending_start, end))
            pending_start = None
    return intervals


def plan_chunks(
    duration: float,
    silences: List[Tuple[float, float]],
    target: float = 240.0,
    snap_window: float = 30.0,
    min_chunk: float = 30.0,
    hard_cap: float = 290.0,
) -> List[Tuple[float, float]]:
    """Split `duration` seconds into chunks aligned to silence midpoints.

    The Qwen3-ForcedAligner accepts at most ~5 minutes per call, so every
    chunk stays below `hard_cap` (doc §8). Ideal cut points near `target`
    snap to the middle of a detected silence; without a usable silence the
    cut is hard. No overlap is used, so chunk boundaries are exact.
    """
    if duration <= hard_cap:
        return [(0.0, duration)]

    midpoints = sorted((s + e) / 2.0 for s, e in silences if e > s)
    chunks = []
    cursor = 0.0
    while duration - cursor > hard_cap:
        window_lo = max(cursor + min_chunk, target + cursor - snap_window)
        window_hi = min(cursor + hard_cap, cursor + target + snap_window)
        candidates = [m for m in midpoints if window_lo <= m <= window_hi]
        if candidates:
            # Prefer the silence closest to the target length.
            ideal = cursor + target
            boundary = min(candidates, key=lambda m: abs(m - ideal))
        else:
            boundary = cursor + hard_cap
        boundary = min(boundary, cursor + hard_cap)
        boundary = max(boundary, cursor + min_chunk)
        chunks.append((cursor, boundary))
        cursor = boundary
    chunks.append((cursor, duration))
    return chunks


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
