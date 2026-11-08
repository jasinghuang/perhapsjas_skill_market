import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import media
from backends.qwen_torch_backend import (
    ALIGNER_MODEL_ID,
    ASR_MODEL_ID,
    QwenTorchBackend,
)

DURATION = 1000.0
# With target=240 / hard_cap=290 and one silence at 240–244 (midpoint 242):
CHUNKS = [(0.0, 242.0), (242.0, 532.0), (532.0, 822.0), (822.0, 1000.0)]


class FakeASRModel:
    instances = []
    load_kwargs = None
    transcribe_calls = []
    fail_timestamps_for = None  # chunk index whose aligner explodes

    @classmethod
    def from_pretrained(cls, model_id, **kwargs):
        cls.load_kwargs = {"model_id": model_id, **kwargs}
        instance = cls()
        cls.instances.append(instance)
        return instance

    def transcribe(self, audio, language=None, return_time_stamps=False):
        self.transcribe_calls.append({"audio": audio, "language": language,
                                      "return_time_stamps": return_time_stamps})
        index = int(Path(audio).stem.split("-")[1])
        text = f"第{index}块文本。"
        if return_time_stamps and self.fail_timestamps_for == index:
            raise RuntimeError("aligner exploded")
        time_stamps = None
        if return_time_stamps:
            time_stamps = SimpleNamespace(items=[
                SimpleNamespace(text="前半", start_time=0.2, end_time=0.6),
                SimpleNamespace(text=text, start_time=0.6, end_time=1.0),
            ])
        # official API returns a list even for a single input
        return [SimpleNamespace(text=text, language="Chinese", time_stamps=time_stamps)]


class FakeAligner:  # kept to satisfy imports; the official package integrates it now
    load_kwargs = None

    @classmethod
    def from_pretrained(cls, model_id, **kwargs):
        cls.load_kwargs = {"model_id": model_id, **kwargs}
        return cls()


@pytest.fixture
def media_fakes(monkeypatch, tmp_path):
    media_file = tmp_path / "长音频 文件.wav"
    media_file.write_bytes(b"x" * 32)
    monkeypatch.setattr(media, "probe_media", lambda p: {
        "duration": DURATION, "audio_streams": [{"index": 0, "codec": "pcm_s16le", "channels": 1}],
    })
    monkeypatch.setattr(media, "to_wav16k_mono", lambda src, dst, stream_index=None: Path(dst))
    monkeypatch.setattr(media, "detect_silences", lambda wav: [(240.0, 244.0)])
    monkeypatch.setattr(media, "extract_chunk", lambda wav, start, dur, dst: Path(dst))
    return media_file


@pytest.fixture
def torch_env(monkeypatch):
    fake_torch = types.ModuleType("torch")
    fake_torch.version = SimpleNamespace(cuda=None)
    fake_torch.cuda = SimpleNamespace(is_available=lambda: False)
    fake_torch.float32 = "float32"
    fake_qwen_asr = types.ModuleType("qwen_asr")
    fake_qwen_asr.Qwen3ASRModel = FakeASRModel
    fake_qwen_asr.Qwen3ForcedAligner = FakeAligner
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", fake_qwen_asr)
    return fake_qwen_asr


def run_backend(tmp_path, media_file, monkeypatch, fail_timestamps_for=None, language="auto"):
    FakeASRModel.transcribe_calls = []
    FakeASRModel.fail_timestamps_for = fail_timestamps_for
    backend = QwenTorchBackend(device="cpu")
    options = {
        "media_info": {"duration": DURATION, "audio_streams": []},
        "work_dir": tmp_path / "work",
    }
    return backend.transcribe(str(media_file), language=language, options=options), backend


def test_chunks_offsets_and_merge(media_fakes, torch_env, tmp_path, monkeypatch):
    result, _ = run_backend(tmp_path, media_fakes, monkeypatch)
    assert result["status"] == "complete"
    assert result["provider"] == "qwen" and result["backend"] == "torch"
    assert result["model_id"] == ASR_MODEL_ID
    assert result["language"] == "zh"  # Chinese -> zh
    assert result["text"] == "第0块文本。第1块文本。第2块文本。第3块文本。"
    # 4 chunks x 2 units, offsets applied from the silence-snapped boundaries
    assert len(result["words"]) == 8
    starts = [round(w["start"], 3) for w in result["words"]]
    assert starts[:4] == [0.2, 0.6, 242.2, 242.6]
    assert starts[-2:] == [822.2, 822.6]
    assert result["compute_dtype"] == "float32"  # CPU route


def test_fixed_models_loaded(media_fakes, torch_env, tmp_path, monkeypatch):
    run_backend(tmp_path, media_fakes, monkeypatch)
    assert FakeASRModel.load_kwargs["model_id"] == ASR_MODEL_ID
    assert FakeASRModel.load_kwargs["forced_aligner"] == ALIGNER_MODEL_ID  # integrated at init
    assert FakeASRModel.load_kwargs["max_new_tokens"] >= 1024  # raised for long chunks


def test_language_mapped_to_qwen_name(media_fakes, torch_env, tmp_path, monkeypatch):
    run_backend(tmp_path, media_fakes, monkeypatch, language="zh")
    assert FakeASRModel.transcribe_calls[0]["language"] == "Chinese"
    run_backend(tmp_path, media_fakes, monkeypatch, language="en")
    assert FakeASRModel.transcribe_calls[-1]["language"] == "English"


def test_alignment_failure_degrades_to_text_and_partial(media_fakes, torch_env, tmp_path, monkeypatch):
    result, _ = run_backend(tmp_path, media_fakes, monkeypatch, fail_timestamps_for=1)
    assert result["status"] == "partial"
    assert any("alignment failed" in warn for warn in result["warnings"])
    assert any("SRT unavailable" in warn for warn in result["warnings"])
    # text from every chunk is still kept (chunk 1 recovered via text-only retry)
    assert "第1块文本。" in result["text"]
    # chunk 1 was transcribed twice: with timestamps (failed) then text-only
    chunk1_calls = [c for c in FakeASRModel.transcribe_calls
                    if Path(c["audio"]).stem == "chunk-0001"]
    assert len(chunk1_calls) == 2
    assert chunk1_calls[0]["return_time_stamps"] is True
    assert chunk1_calls[1]["return_time_stamps"] is False
    # aligned words only come from successful chunks
    assert all(w["start"] < 242.0 or w["start"] > 243.0 for w in result["words"])


def test_chunk_cache_reused_on_second_run(media_fakes, torch_env, tmp_path, monkeypatch):
    result1, _ = run_backend(tmp_path, media_fakes, monkeypatch)
    assert len(FakeASRModel.transcribe_calls) == 4
    cache_dir = tmp_path / "work"
    assert (cache_dir / "chunk-0000.json").exists()
    cached = json.loads((cache_dir / "chunk-0000.json").read_text(encoding="utf-8"))
    assert cached["fingerprint"]

    result2, _ = run_backend(tmp_path, media_fakes, monkeypatch)
    assert len(FakeASRModel.transcribe_calls) == 0  # everything served from cache
    assert result2["text"] == result1["text"]
    assert result2["status"] == "complete"


def test_cache_invalidated_when_language_changes(media_fakes, torch_env, tmp_path, monkeypatch):
    run_backend(tmp_path, media_fakes, monkeypatch, language="auto")
    run_backend(tmp_path, media_fakes, monkeypatch, language="zh")
    # fingerprint includes language -> chunks recomputed
    assert len(FakeASRModel.transcribe_calls) == 4


def test_no_speech_chunk_yields_no_speech_warning(media_fakes, torch_env, tmp_path, monkeypatch):
    class EmptyASR(FakeASRModel):
        def transcribe(self, audio, language=None, return_time_stamps=False):
            self.transcribe_calls.append({"audio": audio, "language": language,
                                          "return_time_stamps": return_time_stamps})
            return [SimpleNamespace(text="", language="Chinese", time_stamps=None)]

    qwen_asr_module = sys.modules["qwen_asr"]
    qwen_asr_module.Qwen3ASRModel = EmptyASR
    EmptyASR.transcribe_calls = []
    try:
        backend = QwenTorchBackend(device="cpu")
        result = backend.transcribe(
            str(media_fakes), language="auto",
            options={"media_info": {"duration": DURATION, "audio_streams": []},
                     "work_dir": tmp_path / "work2"},
        )
    finally:
        qwen_asr_module.Qwen3ASRModel = FakeASRModel
    assert result["text"] == ""
    assert any("no_speech" in warn for warn in result["warnings"])
    assert result["status"] == "complete"


def test_probe_needs_setup_without_torch(monkeypatch):
    # drop fakes: torch import fails in a subprocess-free probe of this interpreter
    monkeypatch.setitem(sys.modules, "torch", None)  # forces `import torch` failure
    backend = QwenTorchBackend()
    report = backend.probe()
    assert report["status"] == "needs_setup"


def test_explicit_cpu_does_not_require_gpu_smoke(torch_env, monkeypatch):
    import torch
    torch.__version__='test'
    def no_gpu(*a,**k): raise AssertionError('CPU should not probe CUDA')
    monkeypatch.setattr(torch.cuda,'is_available',no_gpu)
    report=QwenTorchBackend(device='cpu').probe()
    assert report['status']=='ready'
