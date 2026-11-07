from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import pytest
from providers import find_voice
from providers.local_mlx import LocalMLXProvider, ProviderError

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"


def _fake_model(audio=None, sample_rate=24000):
    sample = np.zeros(10) if audio is None else audio
    return SimpleNamespace(
        sample_rate=sample_rate,
        generate=lambda **kw: iter(
            [SimpleNamespace(audio=sample, sample_rate=sample_rate)]
        ),
    )


def test_synthesize_passes_voice_and_returns_float32():
    voice = find_voice("local", "Serena")
    fake = SimpleNamespace(
        sample_rate=24000,
        generate=lambda **kw: iter([SimpleNamespace(audio=np.zeros(24000), sample_rate=24000)]),
    )
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        out = p.synthesize("你好", voice)
    assert out.dtype == np.float32
    assert out.shape == (24000,)


def test_design_mode_requires_instruct_and_skips_voice():
    fake = SimpleNamespace(
        sample_rate=24000,
        generate=lambda **kw: iter([SimpleNamespace(audio=np.zeros(10), sample_rate=24000)]),
    )
    p = LocalMLXProvider(design="温柔女声")
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        p.synthesize("你好", voice=None)


def test_custom_voice_generate_receives_voice_and_instruction():
    voice = find_voice("local", "Serena")
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([SimpleNamespace(audio=np.zeros(10), sample_rate=24000)]),
    )[1]
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
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
        iter([SimpleNamespace(audio=np.zeros(10), sample_rate=24000)]),
    )[1]
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        p.synthesize("你好", voice)
    assert calls[0]["instruct"] is None


def test_design_mode_generates_with_design_and_no_voice():
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([SimpleNamespace(audio=np.zeros(10), sample_rate=24000)]),
    )[1]
    p = LocalMLXProvider(design="温柔女声")
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        p.synthesize("你好", voice=None)
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
        with pytest.raises(ProviderError, match="mlx-audio"):
            p.prepare()


def test_model_load_error_includes_download_hint():
    p = LocalMLXProvider()
    with patch(
        "providers.local_mlx.load_model", side_effect=RuntimeError("boom")
    ):
        with pytest.raises(ProviderError) as excinfo:
            p.prepare()
    message = str(excinfo.value)
    assert "huggingface-cli download" in message
    assert MODEL_ID in message


def test_synthesize_requires_prepare_first():
    p = LocalMLXProvider()
    with pytest.raises(ProviderError, match="prepare"):
        p.synthesize("你好", find_voice("local", "Serena"))


def test_synthesize_requires_voice_or_design():
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=_fake_model()):
        p.prepare()
        with pytest.raises(ProviderError, match="voice"):
            p.synthesize("你好", voice=None)


def test_synthesize_rejects_non_24k_audio():
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=_fake_model(sample_rate=48000)), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        with pytest.raises(ProviderError, match="24000"):
            p.synthesize("你好", find_voice("local", "Serena"))


def test_synthesize_flattens_multidimensional_audio():
    p = LocalMLXProvider()
    fake = _fake_model(audio=np.zeros((2, 5)))
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        out = p.synthesize("你好", find_voice("local", "Serena"))
    assert out.shape == (10,)
    assert out.dtype == np.float32


def test_synthesize_raises_provider_error_for_empty_results():
    p = LocalMLXProvider()
    fake = SimpleNamespace(sample_rate=24000, generate=lambda **kw: iter([]))
    with patch("providers.local_mlx.load_model", return_value=fake):
        p.prepare()
        with pytest.raises(ProviderError, match="no audio"):
            p.synthesize("你好", find_voice("local", "Serena"))


def test_describe_reports_provider_model_and_design():
    p = LocalMLXProvider(design="温柔女声")
    assert p.describe() == {
        "provider": "local",
        "model": MODEL_ID,
        "design": "温柔女声",
    }


def test_base_clone_forwards_ref_audio_and_ref_text():
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([SimpleNamespace(audio=np.zeros(10), sample_rate=24000)]),
    )[1]
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        p.synthesize(
            "你好", None, ref_audio="ref.wav", ref_text="参考文本"
        )
    assert calls[0]["voice"] is None
    assert calls[0]["instruct"] is None
    assert calls[0]["ref_audio"] == "ref.wav"
    assert calls[0]["ref_text"] == "参考文本"


def test_sampling_params_and_seed_are_forwarded():
    voice = find_voice("local", "Serena")
    calls = []
    fake = _fake_model()
    fake.generate = lambda **kw: (
        calls.append(kw),
        iter([SimpleNamespace(audio=np.zeros(10), sample_rate=24000)]),
    )[1]
    p = LocalMLXProvider()
    with patch("providers.local_mlx.load_model", return_value=fake), \
         patch("providers.local_mlx.mx") as mx:
        mx.array.side_effect = lambda x: np.asarray(x)
        p.prepare()
        p.synthesize(
            "你好", voice, temperature=0.6, top_p=0.9, top_k=40, seed=42
        )
    assert calls[0]["temperature"] == 0.6
    assert calls[0]["top_p"] == 0.9
    assert calls[0]["top_k"] == 40
    mx.random.seed.assert_called_once_with(42)
