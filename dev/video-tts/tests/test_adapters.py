from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from helpers import base_task, write_task, write_tone


class FakeMLXModel:
    def __init__(self, chunks=2, sample_rates=None, model_type="custom_voice"):
        self.config = SimpleNamespace(tts_model_type=model_type)
        self.supported_speakers = ["serena", "ryan"]
        self.supported_languages = ["auto", "chinese", "english"]
        self.sample_rate = 24000
        self.chunks = chunks
        self.sample_rates = sample_rates or [24000] * chunks
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        for index in range(self.chunks):
            yield SimpleNamespace(
                audio=np.ones(1200, dtype=np.float32) * 0.1,
                sample_rate=self.sample_rates[index],
            )


def _mlx_task(tmp_path, monkeypatch, r, **overrides):
    monkeypatch.setattr(r, "ensure_model_cached", lambda model_id: tmp_path / "model")
    path = write_task(tmp_path, base_task(**overrides))
    return r.load_task(path)


def test_mlx_preset_collects_all_chunks_and_validates_speaker(r, tmp_path, monkeypatch):
    task = _mlx_task(
        tmp_path,
        monkeypatch,
        r,
        voice={
            "source": "preset",
            "speaker": "Serena",
            "voice_id": None,
            "reference_audio": None,
            "reference_text": None,
            "name": None,
        },
    )
    model = FakeMLXModel(chunks=2)
    adapter = r.MLXAdapter(task, r.Result(task), model_loader=lambda path: model)
    adapter.prepare()
    assert adapter.speaker == "serena"
    output = tmp_path / "native.wav"
    rate = adapter.synthesize("测试。", output)
    assert rate == 24000
    pcm, sample_rate = r.read_wav(output)
    assert sample_rate == 24000
    assert pcm.size == 2400
    assert model.calls[0]["voice"] == "serena"
    assert model.calls[0]["instruct"] == "自然"
    assert model.calls[0]["split_pattern"] is None


def test_mlx_rejects_unsupported_speaker(r, tmp_path, monkeypatch):
    task = _mlx_task(
        tmp_path,
        monkeypatch,
        r,
        voice={
            "source": "preset",
            "speaker": "Nobody",
            "voice_id": None,
            "reference_audio": None,
            "reference_text": None,
            "name": None,
        },
    )
    adapter = r.MLXAdapter(task, r.Result(task), model_loader=lambda path: FakeMLXModel())
    with pytest.raises(r.TaskError, match="not supported"):
        adapter.prepare()


def test_mlx_clone_normalizes_reference_and_passes_it(r, tmp_path, monkeypatch):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    data = base_task(
        model_id=r.MLX_CLONE_MODEL,
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": reference.name,
            "reference_text": "参考文本。",
            "name": None,
        },
    )
    data["parameters"] = {}
    monkeypatch.setattr(r, "ensure_model_cached", lambda model_id: tmp_path / "model")
    task = r.load_task(write_task(tmp_path, data))
    model = FakeMLXModel(chunks=1, model_type="base")
    model.supported_speakers = []
    adapter = r.MLXAdapter(task, r.Result(task), model_loader=lambda path: model)
    adapter.prepare()
    assert adapter.reference_audio is not None
    assert adapter.reference_audio.name == "reference_local.wav"
    assert adapter.reference_audio.is_file()
    output = tmp_path / "native.wav"
    adapter.synthesize("克隆测试。", output)
    call = model.calls[0]
    assert call["voice"] is None
    assert call["instruct"] is None
    assert call["ref_text"] == "参考文本。"
    assert call["ref_audio"].endswith("reference_local.wav")


def test_mlx_mixed_sample_rates_are_rejected(r, tmp_path, monkeypatch):
    task = _mlx_task(tmp_path, monkeypatch, r)
    model = FakeMLXModel(chunks=2, sample_rates=[24000, 48000])
    adapter = r.MLXAdapter(task, r.Result(task), model_loader=lambda path: model)
    adapter.prepare()
    with pytest.raises(r.RunnerError, match="mixed sample rates"):
        adapter.synthesize("测试。", tmp_path / "native.wav")


class FakeCuda:
    available = True
    bf16 = True

    @staticmethod
    def is_available():
        return FakeCuda.available

    @staticmethod
    def is_bf16_supported():
        return FakeCuda.bf16

    @staticmethod
    def empty_cache():
        return None


class FakeTorch:
    bfloat16 = "bf16"
    float16 = "fp16"
    float32 = "fp32"
    cuda = FakeCuda

    @staticmethod
    def manual_seed(seed):
        return None


class FakeTorchModel:
    def __init__(self):
        self.custom_calls = []
        self.clone_calls = []
        self.prompt_calls = 0

    def get_supported_speakers(self):
        return ["serena", "ryan"]

    def get_supported_languages(self):
        return ["chinese", "english"]

    def generate_custom_voice(self, text, **kwargs):
        self.custom_calls.append((text, kwargs))
        return [np.ones(1200, dtype=np.float32) * 0.1], 24000

    def create_voice_clone_prompt(self, path, **kwargs):
        self.prompt_calls += 1
        assert kwargs.get("x_vector_only_mode") is False
        return "clone-prompt"

    def generate_voice_clone(self, text, **kwargs):
        self.clone_calls.append((text, kwargs))
        assert kwargs.get("voice_clone_prompt") == "clone-prompt"
        return [np.ones(2400, dtype=np.float32) * 0.1], 24000


def _torch_task(tmp_path, monkeypatch, r, **overrides):
    monkeypatch.setattr(r, "ensure_model_cached", lambda model_id: tmp_path / "model")
    # The adapter is exercised on this Mac; validate the Windows torch task
    # shape by presenting the platform that owns that backend.
    monkeypatch.setattr(r.platform, "system", lambda: "Windows")
    monkeypatch.setattr(r.platform, "machine", lambda: "AMD64")
    overrides.setdefault("provider", "local")
    overrides.setdefault("backend", "qwen_tts")
    overrides.setdefault("model_id", r.TORCH_PRESET_MODEL)
    data = base_task(**overrides)
    if data["voice"]["source"] == "clone":
        data["parameters"] = {}
    return r.load_task(write_task(tmp_path, data))


def test_torch_preset_uses_official_parameter_names(r, tmp_path, monkeypatch):
    task = _torch_task(tmp_path, monkeypatch, r)
    model = FakeTorchModel()
    adapter = r.QwenTorchAdapter(
        task,
        r.Result(task),
        torch_module=FakeTorch,
        model_factory=lambda path, **kwargs: model,
    )
    adapter.prepare()
    output = tmp_path / "native.wav"
    assert adapter.synthesize("测试。", output) == 24000
    text, kwargs = model.custom_calls[0]
    assert text == "测试。"
    assert kwargs["speaker"] == "serena"
    assert kwargs["language"] == "chinese"
    assert kwargs["instruct"] == "自然"
    assert r.read_wav(output)[1] == 24000


def test_torch_clone_prompt_is_built_once_and_reused(r, tmp_path, monkeypatch):
    reference = write_tone(tmp_path / "ref.wav", 1.0, 24000)
    task = _torch_task(
        tmp_path,
        monkeypatch,
        r,
        model_id=r.TORCH_CLONE_MODEL,
        backend="qwen_tts",
        voice={
            "source": "clone",
            "speaker": None,
            "voice_id": None,
            "reference_audio": reference.name,
            "reference_text": "参考文本。",
            "name": None,
        },
    )
    model = FakeTorchModel()
    adapter = r.QwenTorchAdapter(
        task,
        r.Result(task),
        torch_module=FakeTorch,
        model_factory=lambda path, **kwargs: model,
    )
    adapter.prepare()
    adapter.synthesize("第一句。", tmp_path / "a.wav")
    adapter.synthesize("第二句。", tmp_path / "b.wav")
    assert model.prompt_calls == 1
    assert len(model.clone_calls) == 2
    assert model.clone_calls[0][1]["language"] == "chinese"
