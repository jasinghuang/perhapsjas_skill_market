from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import pytest
from providers import find_voice
from providers.base import SynthesisResult
from providers.errors import FATAL, INVALID_OUTPUT, SynthesisError
from providers.local_mlx import LocalMLXProvider

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"


def _result(audio, sample_rate=24000):
    return SimpleNamespace(audio=audio, sample_rate=sample_rate)


def _fake_model(audio=None, sample_rate=24000, pieces=None):
    """构造假 mlx 模型；pieces 提供多段生成结果（分片语义）。"""
    if pieces is None:
        pieces = [_result(np.zeros(10) if audio is None else audio, sample_rate)]
    return SimpleNamespace(
        sample_rate=sample_rate,
        generate=lambda **kw: iter(pieces),
    )


def _prepared(model):
    provider = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=model), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        provider.prepare()
    return provider


def test_synthesize_passes_voice_and_returns_synthesis_result():
    voice = find_voice("local", "Serena")
    tone = np.full(24000, 0.2, dtype=np.float32)
    p = _prepared(_fake_model(audio=tone))
    out = p.synthesize("你好", voice)
    assert isinstance(out, SynthesisResult)
    assert out.audio.dtype == np.float32
    assert out.audio.shape == (24000,)
    assert out.sample_rate == 24000
    assert out.channels == 1
    assert out.provider == "local"
    assert out.model_id == MODEL_ID


def test_custom_voice_generate_receives_voice_and_instruction():
    voice = find_voice("local", "Serena")
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([_result(np.zeros(10))]),
    )[1]
    p = _prepared(fake)
    p.synthesize("你好", voice, instruct="平稳解说", lang="english")
    assert calls == [
        {
            "text": "你好",
            "voice": "Serena",
            "instruct": "平稳解说",
            "lang_code": "english",
        }
    ]


def test_empty_instruction_is_sent_as_none():
    voice = find_voice("local", "Serena")
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([_result(np.zeros(10))]),
    )[1]
    p = _prepared(fake)
    p.synthesize("你好", voice)
    assert calls[0]["instruct"] is None


def test_design_mode_generates_with_design_and_no_voice():
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([_result(np.zeros(10))]),
    )[1]
    provider = LocalMLXProvider(design="温柔女声")
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        provider.prepare()
        provider.synthesize("你好", voice=None)
    assert calls == [
        {"text": "你好", "voice": None, "instruct": "温柔女声", "lang_code": "chinese"}
    ]


def test_prepare_loads_model_once():
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=_fake_model()) as load:
        p.prepare()
        p.prepare()
    load.assert_called_once_with(MODEL_ID)


def test_prepare_with_custom_model_id():
    p = LocalMLXProvider(model_id="mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16")
    with patch("providers.local_mlx.load_model", return_value=_fake_model()) as load:
        p.prepare()
    load.assert_called_once_with("mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16")


def test_prepare_raises_when_mlx_audio_missing():
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", None):
        with pytest.raises(SynthesisError, match="mlx-audio") as excinfo:
            p.prepare()
    assert excinfo.value.kind == FATAL


def test_model_load_error_includes_download_hint():
    p = LocalMLXProvider()
    with patch(
        "providers.local_mlx.load_model", side_effect=RuntimeError("boom")
    ):
        with pytest.raises(SynthesisError) as excinfo:
            p.prepare()
    message = str(excinfo.value)
    assert "huggingface-cli download" in message
    assert MODEL_ID in message


def test_synthesize_requires_prepare_first():
    p = LocalMLXProvider()
    with pytest.raises(SynthesisError, match="prepare"):
        p.synthesize("你好", find_voice("local", "Serena"))


def test_synthesize_requires_voice_or_design():
    p = _prepared(_fake_model())
    with pytest.raises(SynthesisError, match="voice"):
        p.synthesize("你好", voice=None)


def test_non_24k_sample_rate_is_accepted_with_metadata():
    # 采样率以结果元数据为准；48kHz 模型结果不被拒绝（T14）。
    tone = np.full(48000, 0.2, dtype=np.float32)
    p = _prepared(_fake_model(audio=tone, sample_rate=48000))
    out = p.synthesize("你好", find_voice("local", "Serena"))
    assert out.sample_rate == 48000
    assert out.audio.shape == (48000,)


def test_missing_sample_rate_refuses_to_guess():
    # 结果与模型属性都没有采样率时必须报错，不默认 24000。
    fake = SimpleNamespace(
        sample_rate=None,
        generate=lambda **kw: iter([SimpleNamespace(audio=np.zeros(10))]),
    )
    p = _prepared(fake)
    with pytest.raises(SynthesisError, match="sample rate"):
        p.synthesize("你好", find_voice("local", "Serena"))


def test_generator_is_consumed_fully_and_pieces_concatenated():
    # 多段 yield 按分片语义拼接成完整音频（T17）。
    pieces = [
        _result(np.full(100, 0.2, dtype=np.float32)),
        _result(np.full(200, 0.2, dtype=np.float32)),
    ]
    p = _prepared(_fake_model(pieces=pieces))
    out = p.synthesize("你好", find_voice("local", "Serena"))
    assert out.audio.shape == (300,)


def test_generator_first_piece_only_is_not_assumed_complete():
    pieces = [
        _result(np.full(100, 0.2, dtype=np.float32)),
        _result(np.full(50, 0.2, dtype=np.float32)),
    ]
    calls = {"n": 0}

    def counting_generate(**kw):
        calls["n"] += 1
        return iter(pieces)

    fake = SimpleNamespace(sample_rate=24000, generate=counting_generate)
    p = _prepared(fake)
    out = p.synthesize("你好", find_voice("local", "Serena"))
    assert out.audio.shape == (150,)  # 150 != 100：证明取了全部段
    assert calls["n"] == 1


def test_mixed_sample_rate_pieces_are_rejected():
    pieces = [
        _result(np.zeros(100), 24000),
        _result(np.zeros(100), 48000),
    ]
    p = _prepared(_fake_model(pieces=pieces, sample_rate=24000))
    with pytest.raises(SynthesisError, match="mixed sample rates"):
        p.synthesize("你好", find_voice("local", "Serena"))


def test_synthesize_raises_for_empty_generation():
    p = _prepared(SimpleNamespace(sample_rate=24000, generate=lambda **kw: iter([])))
    with pytest.raises(SynthesisError, match="no audio"):
        p.synthesize("你好", find_voice("local", "Serena"))


def test_runtime_errors_are_classified_not_crash():
    def boom(**kw):
        raise RuntimeError("metal out of memory")

    p = _prepared(SimpleNamespace(sample_rate=24000, generate=boom))
    with pytest.raises(SynthesisError, match="metal out of memory") as excinfo:
        p.synthesize("你好", find_voice("local", "Serena"))
    assert excinfo.value.kind == INVALID_OUTPUT


def test_describe_reports_backend_and_model():
    provider = LocalMLXProvider(design="温柔女声")
    info = provider.describe()
    assert info["provider"] == "local"
    assert info["model"] == MODEL_ID
    assert info["design"] == "温柔女声"
    assert "backend" in info and "backend_version" in info


def test_base_clone_forwards_ref_audio_and_ref_text():
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([_result(np.zeros(10))]),
    )[1]
    provider = LocalMLXProvider(
        model_id="mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16"
    )
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        provider.prepare()
        provider.synthesize("你好", None, ref_audio="ref.wav", ref_text="参考文本")
    assert calls[0]["voice"] is None
    assert calls[0]["instruct"] is None
    assert calls[0]["ref_audio"] == "ref.wav"
    assert calls[0]["ref_text"] == "参考文本"


def test_clone_on_non_base_model_is_rejected():
    # F01 纵深防御：克隆必须配 Base 模型，直接调 provider 也拦。
    p = _prepared(_fake_model())  # 默认 CustomVoice 模型
    with pytest.raises(SynthesisError, match="Base model") as excinfo:
        p.synthesize("你好", None, ref_audio="ref.wav", ref_text="参考文本")
    assert excinfo.value.kind == FATAL


def test_sampling_params_and_seed_are_forwarded():
    voice = find_voice("local", "Serena")
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([_result(np.zeros(10))]),
    )[1]
    provider = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        provider.prepare()
        provider.synthesize(
            "你好", voice, temperature=0.6, top_p=0.9, top_k=40, seed=42
        )
    assert calls[0]["temperature"] == 0.6
    assert calls[0]["top_p"] == 0.9
    assert calls[0]["top_k"] == 40
    mx.random.seed.assert_called_once_with(42)


def test_online_only_style_is_rejected_as_fatal():
    p = _prepared(_fake_model())
    with pytest.raises(SynthesisError, match="only supported by the online"):
        p.synthesize("你好", find_voice("local", "Serena"), rate=1.1)
