"""Shared fixtures for the new video-tts runner tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


def deep_update(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    result = json.loads(json.dumps(base))
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_update(result[key], value)
        else:
            result[key] = value
    return result


def base_task(**overrides: Any) -> Dict[str, Any]:
    data = {
        "schema_version": 1,
        "mode": "narration",
        "provider": "local",
        "backend": "mlx_audio",
        "model_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
        "language": "Chinese",
        "voice": {
            "source": "preset",
            "speaker": "Serena",
            "voice_id": None,
            "reference_audio": None,
            "reference_text": None,
            "name": None,
        },
        "parameters": {"instruct": "自然"},
        "timing": {"max_speed": 1.2, "safety_gap_sec": 0.1, "pause_between_sec": 0.3},
        "allow_text_edits": False,
        "polish": {"attempt": 0, "max_attempts": 2},
        "input": {"srt": None, "video": None},
        "output": {
            "directory": "output",
            "deliver": ["audio", "subtitle"],
            "audio_format": "wav",
            "sample_rate": 48000,
            "overwrite": False,
            "narration_video_policy": "ask",
            "mix_original": {"enabled": False, "volume_db": -18},
        },
        "segments": [
            {"id": 1, "text": "这是一句测试。", "start_sec": None, "end_sec": None}
        ],
    }
    return deep_update(data, overrides)


def aligned_task(**overrides: Any) -> Dict[str, Any]:
    data = base_task(
        mode="aligned",
        input={"srt": "input.srt", "video": None},
        segments=[
            {"id": 1, "text": "第一句。", "start_sec": 0.5, "end_sec": 1.5},
            {"id": 2, "text": "第二句。", "start_sec": 2.0, "end_sec": 3.0},
        ],
    )
    return deep_update(data, overrides)


def write_task(tmp_path: Path, data: Dict[str, Any], name: str = "task.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def write_srt(path: Path) -> Path:
    path.write_text(
        "1\n00:00:00,500 --> 00:00:01,500\n第一句。\n\n"
        "2\n00:00:02,000 --> 00:00:03,000\n第二句。\n",
        encoding="utf-8",
    )
    return path


def write_tone(path: Path, seconds: float = 1.0, sample_rate: int = 24000, frequency: float = 440.0) -> Path:
    import numpy as np
    import soundfile as sf

    frames = int(round(seconds * sample_rate))
    time_axis = np.arange(frames, dtype=np.float32) / sample_rate
    tone = (0.2 * np.sin(2 * np.pi * frequency * time_axis)).astype(np.float32)
    sf.write(str(path), tone, sample_rate, subtype="FLOAT")
    return path


def write_tone_with_silence(
    path: Path,
    total_seconds: float,
    lead: float,
    tail: float,
    sample_rate: int = 24000,
    frequency: float = 440.0,
) -> Path:
    import numpy as np
    import soundfile as sf

    total = int(round(total_seconds * sample_rate))
    lead_frames = int(round(lead * sample_rate))
    tail_frames = int(round(tail * sample_rate))
    tone_frames = max(1, total - lead_frames - tail_frames)
    time_axis = np.arange(tone_frames, dtype=np.float32) / sample_rate
    tone = (0.2 * np.sin(2 * np.pi * frequency * time_axis)).astype(np.float32)
    samples = np.concatenate(
        [
            np.zeros(lead_frames, dtype=np.float32),
            tone,
            np.zeros(tail_frames, dtype=np.float32),
        ]
    )
    sf.write(str(path), samples[:total], sample_rate, subtype="FLOAT")
    return path


def wav_bytes(seconds: float = 0.5, sample_rate: int = 44100) -> bytes:
    import io

    import numpy as np
    import soundfile as sf

    frames = int(round(seconds * sample_rate))
    time_axis = np.arange(frames, dtype=np.float32) / sample_rate
    tone = (0.2 * np.sin(2 * np.pi * 440.0 * time_axis)).astype(np.float32)
    buffer = io.BytesIO()
    sf.write(buffer, tone, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()
