import pytest
from providers import (
    FLAGSHIP_MODEL,
    LOCAL_DESIGN_MODEL,
    LOCAL_VOICES,
    ONLINE_FLAGSHIP_VOICES,
    ONLINE_QWEN_TTS_VOICES,
    find_voice,
    get_provider,
    is_voice_design_model,
)
from providers.online_bailian import FLAGSHIP_MODEL as ONLINE_FLAGSHIP_MODEL


def test_local_catalog_has_nine_voices():
    assert len(LOCAL_VOICES) == 9
    assert {v.voice_id for v in LOCAL_VOICES} >= {"Serena", "Vivian", "Uncle_Fu", "Dylan", "Eric"}


def test_online_flagship_catalog():
    assert len(ONLINE_FLAGSHIP_VOICES) == 4
    assert all(v.model == "qwen-audio-3.1-tts-plus" for v in ONLINE_FLAGSHIP_VOICES)
    assert {v.voice_id for v in ONLINE_FLAGSHIP_VOICES} == {
        "longanlingxin_v3.1", "xunanchuan_v3.1",
        "longanhuan_v3.1", "longanfengyue_v3.1",
    }


def test_qwen_tts_catalog_is_six_and_six_with_cantonese():
    assert len(ONLINE_QWEN_TTS_VOICES) == 12
    assert sum(v.gender == "女" for v in ONLINE_QWEN_TTS_VOICES) == 6
    assert sum(v.gender == "男" for v in ONLINE_QWEN_TTS_VOICES) == 6
    assert all(v.model == "qwen3-tts-flash" for v in ONLINE_QWEN_TTS_VOICES)
    assert {"Rocky", "Kiki"} <= {v.voice_id for v in ONLINE_QWEN_TTS_VOICES}


def test_find_voice_rejects_unknown_with_list():
    with pytest.raises(ValueError, match="Cherry"):
        find_voice("online", "nope")


def test_get_provider_rejects_unknown():
    with pytest.raises(ValueError):
        get_provider("nope")


def test_find_voice_returns_catalog_voice():
    local = find_voice("local", "Serena")
    assert local.voice_id == "Serena"
    assert local.provider == "local"
    assert local.model == "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16"

    online = find_voice("online", "Cherry")
    assert online.voice_id == "Cherry"
    assert online.provider == "online"
    assert online.model == "qwen3-tts-flash"


def test_find_voice_requires_exact_id():
    with pytest.raises(ValueError):
        find_voice("local", "serena")


def test_voice_design_model_marker_and_default_constant():
    assert LOCAL_DESIGN_MODEL.endswith("VoiceDesign-bf16")
    assert is_voice_design_model(LOCAL_DESIGN_MODEL)
    assert not is_voice_design_model(find_voice("local", "Serena").model)
    assert not is_voice_design_model(None)


def test_online_provider_shares_flagship_model_constant():
    assert ONLINE_FLAGSHIP_MODEL == FLAGSHIP_MODEL
