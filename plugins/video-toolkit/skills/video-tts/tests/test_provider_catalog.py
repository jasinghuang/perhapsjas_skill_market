import pytest
from providers import (
    LOCAL_VOICES, ONLINE_FLAGSHIP_VOICES, ONLINE_QWEN_TTS_VOICES,
    find_voice, get_provider,
)


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


def test_qwen_tts_catalog_is_five_and_five():
    assert len(ONLINE_QWEN_TTS_VOICES) == 10
    assert sum(v.gender == "女" for v in ONLINE_QWEN_TTS_VOICES) == 5
    assert sum(v.gender == "男" for v in ONLINE_QWEN_TTS_VOICES) == 5
    assert all(v.model == "qwen3-tts-flash" for v in ONLINE_QWEN_TTS_VOICES)


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
