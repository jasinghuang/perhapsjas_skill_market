from __future__ import annotations

from pathlib import Path

import numpy as np

from helpers import base_task, write_task


class CountingAdapter:
    def __init__(self, r):
        self.r = r
        self.calls = 0

    def synthesize(self, text, output_path):
        self.calls += 1
        frames = 7200
        time_axis = np.arange(frames, dtype=np.float32) / 24000
        tone = (0.2 * np.sin(2 * np.pi * 440 * time_axis)).astype(np.float32)
        self.r.write_wav_float(Path(output_path), tone, 24000)
        return 24000

    def voice_identity(self):
        return {"voice_id": "voice-123"}


def test_identical_segments_use_cache_and_synthesize_once(r, tmp_path):
    data = base_task(
        provider="elevenlabs",
        backend="elevenlabs_http",
        model_id="eleven_multilingual_v2",
        voice={
            "source": "preset",
            "speaker": None,
            "voice_id": "voice-123",
            "reference_audio": None,
            "reference_text": None,
            "name": None,
        },
        segments=[
            {"id": 1, "text": "完全相同的正文。", "start_sec": None, "end_sec": None},
            {"id": 2, "text": "完全相同的正文。", "start_sec": None, "end_sec": None},
        ],
    )
    data["parameters"] = {}
    task = r.load_task(write_task(tmp_path, data))
    (task.work_dir / "segments").mkdir(parents=True)
    result = r.Result(task)
    adapter = CountingAdapter(r)
    native = r.synthesize_all(task, adapter, result)
    assert adapter.calls == 1
    assert len(native) == 2
    assert sum(item.cache_hits for item in native) == 1
