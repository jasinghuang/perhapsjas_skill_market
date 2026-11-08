"""local_torch provider 单元测试（fake 模型；真机验收见需求文档 §17.3）。

覆盖 A02（三用途模型与参数契约：speaker/language 而非 MLX 的
voice/lang_code）、A03（克隆条件任务内只构建一次）、以及 §7.2 的
release_model 显存归还契约（fake torch 验证调用序列与校验逻辑）。
"""

from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from providers.base import SynthesisResult
from providers.errors import FATAL, INVALID_OUTPUT, SynthesisError
from providers.local_torch import LocalTorchProvider

CUSTOM = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
DESIGN = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"


def _result():
    """generate_* 的官方返回形态：(List[np.ndarray], sample_rate)。"""
    return ([np.full(24000, 0.2, dtype=np.float32)], 24000)


def _fake_model(calls=None):
    """记录调用的假 Qwen3TTSModel。"""
    calls = calls if calls is not None else {}

    def _record(name):
        def _inner(*args, **kwargs):
            calls.setdefault(name, []).append({"args": args, "kwargs": kwargs})
            return _result()
        return _inner

    model = SimpleNamespace(
        generate_custom_voice=_record("custom"),
        generate_voice_design=_record("design"),
        generate_voice_clone=_record("clone"),
        create_voice_clone_prompt=_record("prompt"),
        get_supported_speakers=lambda: ["Serena", "Cherry", "Ethan"],
    get_supported_languages=lambda: [
        "auto", "chinese", "english", "japanese",
    ],
        config=SimpleNamespace(_commit_hash="abc123"),
    )
    return model


def _prepared(model, **kwargs):
    provider = LocalTorchProvider(**kwargs)
    with patch("providers.local_torch._Qwen3TTSModel") as loader, \
         patch("providers.local_torch._torch") as fake_torch:
        fake_torch.cuda.is_available.return_value = True
        fake_torch.bfloat16 = "bf16"
        loader.from_pretrained.return_value = model
        provider.prepare()
    return provider


VOICE = SimpleNamespace(
    name="Serena", voice_id="Serena", gender="女", description="",
    model=CUSTOM, provider="local-torch",
)


def test_prepare_loads_with_bf16_sdpa():
    model = _fake_model()
    provider = LocalTorchProvider()
    with patch("providers.local_torch._Qwen3TTSModel") as loader, \
         patch("providers.local_torch._torch") as fake_torch:
        fake_torch.cuda.is_available.return_value = True
        fake_torch.bfloat16 = "bf16"
        provider.prepare()
        kwargs = loader.from_pretrained.call_args.kwargs
    assert kwargs["dtype"] == "bf16"
    assert kwargs["attn_implementation"] == "sdpa"
    assert kwargs["device_map"] == "cuda"


def test_prepare_rejects_missing_cuda():
    provider = LocalTorchProvider()
    with patch("providers.local_torch._Qwen3TTSModel"), \
         patch("providers.local_torch._torch") as fake_torch:
        fake_torch.cuda.is_available.return_value = False
        with pytest.raises(SynthesisError, match="cuda") as excinfo:
            provider.prepare()
    assert excinfo.value.kind == FATAL


def test_preset_voice_uses_speaker_and_language():
    # A02：官方 API 是 speaker/language，不是 MLX 的 voice/lang_code。
    calls = {}
    p = _prepared(_fake_model(calls))
    out = p.synthesize("你好", VOICE, instruct="平稳解说", lang="chinese")
    assert isinstance(out, SynthesisResult)
    assert out.sample_rate == 24000
    assert out.model_id == CUSTOM
    assert out.model_revision == "abc123"
    call = calls["custom"][0]
    assert call["args"][0] == "你好"
    assert call["kwargs"]["speaker"] == "Serena"
    # 实测 torch 的 language 取语言全名（不是在线路线的 'zh' 代码）。
    assert call["kwargs"]["language"] == "chinese"
    assert call["kwargs"]["instruct"] == "平稳解说"
    assert "lang_code" not in call["kwargs"]
    assert "voice" not in call["kwargs"]


def test_unsupported_language_is_rejected_upfront():
    # 实机复现：'zh' 不是 torch 支持的语言值 → 预检 FATAL，不进重试。
    calls = {}
    p = _prepared(_fake_model(calls))
    with pytest.raises(SynthesisError, match="not supported") as excinfo:
        p.synthesize("你好", VOICE, lang="klingon")
    assert excinfo.value.kind == FATAL
    assert "custom" not in calls


def test_language_code_is_mapped_to_full_name():
    calls = {}
    p = _prepared(_fake_model(calls))
    p.synthesize("你好", VOICE, lang="zh")  # 代码 → 全名
    assert calls["custom"][0]["kwargs"]["language"] == "chinese"


def test_unsupported_speaker_is_rejected():
    calls = {}
    p = _prepared(_fake_model(calls))
    bad = SimpleNamespace(**{**VOICE.__dict__, "voice_id": "NoSuch"})
    with pytest.raises(SynthesisError, match="not supported") as excinfo:
        p.synthesize("你好", bad)
    assert excinfo.value.kind == FATAL
    assert "custom" not in calls  # 未发起合成


def test_design_mode_generates_with_instruct():
    calls = {}
    p = _prepared(_fake_model(calls), model_id=DESIGN, design="温柔女声")
    p.synthesize("你好", None)
    call = calls["design"][0]
    assert call["kwargs"]["instruct"] == "温柔女声"
    assert call["kwargs"]["language"] == "chinese"


def test_clone_builds_prompt_once_and_reuses():
    # A03：同参考连续合成多组 → create_voice_clone_prompt 只跑一次，
    # generate_voice_clone 复用同一 prompt 对象。
    calls = {}
    model = _fake_model(calls)
    prompt_items = [SimpleNamespace(ref_text="参考文本")]
    model.create_voice_clone_prompt = lambda *a, **k: (
        calls.setdefault("prompt", []).append({"args": a, "kwargs": k})
        or prompt_items
    )
    p = _prepared(model, model_id=BASE)
    p.synthesize("第一句", None, ref_audio="ref.wav", ref_text="参考文本")
    p.synthesize("第二句", None, ref_audio="ref.wav", ref_text="参考文本")
    assert len(calls["prompt"]) == 1
    assert calls["prompt"][0]["kwargs"]["x_vector_only_mode"] is False
    assert len(calls["clone"]) == 2
    assert all(
        c["kwargs"]["voice_clone_prompt"] is prompt_items
        for c in calls["clone"]
    )
    # 参考文本变化 → 条件身份变化，重新构建。
    p.synthesize("第三句", None, ref_audio="ref.wav", ref_text="换文本")
    assert len(calls["prompt"]) == 2


def test_clone_requires_base_model():
    p = _prepared(_fake_model(), model_id=CUSTOM)
    with pytest.raises(SynthesisError, match="Base model") as excinfo:
        p.synthesize("你好", None, ref_audio="ref.wav", ref_text="参考")
    assert excinfo.value.kind == FATAL


def test_sampling_params_forwarded():
    calls = {}
    p = _prepared(_fake_model(calls))
    p.synthesize("你好", VOICE, temperature=0.6, top_p=0.9, top_k=40)
    kwargs = calls["custom"][0]["kwargs"]
    assert kwargs["temperature"] == 0.6
    assert kwargs["top_p"] == 0.9
    assert kwargs["top_k"] == 40


def test_online_only_style_rejected():
    p = _prepared(_fake_model())
    with pytest.raises(SynthesisError, match="only supported by the online"):
        p.synthesize("你好", VOICE, rate=1.1)


def test_bad_generation_output_is_invalid():
    def boom(*a, **k):
        raise RuntimeError("shape mismatch")
    model = _fake_model()
    model.generate_custom_voice = boom
    p = _prepared(model)
    with pytest.raises(SynthesisError) as excinfo:
        p.synthesize("你好", VOICE)
    assert excinfo.value.kind == INVALID_OUTPUT


def test_multiple_audios_for_single_text_rejected():
    model = _fake_model()
    model.generate_custom_voice = lambda *a, **k: (
        [np.zeros(100, dtype=np.float32)] * 2, 24000
    )
    p = _prepared(model)
    with pytest.raises(SynthesisError, match="exactly 1"):
        p.synthesize("你好", VOICE)


def test_release_model_runs_vram_contract():
    # §7.2：断引用 → gc → synchronize → empty_cache → 校验回基线。
    order = []
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            synchronize=lambda: order.append("synchronize"),
            empty_cache=lambda: order.append("empty_cache"),
            memory_allocated=lambda: order.append("allocated") or 0,
            memory_reserved=lambda: 8 * 1024 * 1024,
            max_memory_allocated=lambda: 1 << 30,
            reset_peak_memory_stats=lambda: order.append("reset_peak"),
        ),
    )
    p = _prepared(_fake_model())
    with patch("providers.local_torch._torch", fake_torch):
        stats = p.release_model()
    assert order[:2] == ["synchronize", "empty_cache"]
    assert stats["released_cleanly"] is True
    assert stats["allocated_after_release"] == 0
    assert p._model is None and p._clone_prompt is None


def test_release_model_flags_dirty_release():
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(
            is_available=lambda: True,
            synchronize=lambda: None,
            empty_cache=lambda: None,
            memory_allocated=lambda: 0,
            memory_reserved=lambda: 2 * 1024 ** 3,  # 残留 2GB → 不干净
            max_memory_allocated=lambda: 0,
            reset_peak_memory_stats=lambda: None,
        ),
    )
    p = _prepared(_fake_model())
    with patch("providers.local_torch._torch", fake_torch):
        stats = p.release_model()
    assert stats["released_cleanly"] is False
    assert "禁止直接加载" in stats["hint"]


def test_describe_reports_backend_and_versions():
    p = _prepared(_fake_model())
    info = p.describe()
    assert info["provider"] == "local-torch"
    assert info["model"] == CUSTOM
    assert info["model_revision"] == "abc123"
    assert "qwen-tts" in info["backend_version"]
    assert "torch=" in info["backend_version"]
    assert info["dtype"] == "bfloat16" and info["attn"] == "sdpa"
