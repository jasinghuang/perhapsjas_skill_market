import json
from pathlib import Path
import pytest
from bailian_tts.voices_db import VoicesDB, validate_prefix


def test_validate_prefix_accepts_lowercase_alnum_under_10():
    assert validate_prefix("announcer") == "announcer"
    assert validate_prefix("v01") == "v01"


def test_validate_prefix_rejects_invalid():
    with pytest.raises(ValueError):
        validate_prefix("MyVoice")   # 大写
    with pytest.raises(ValueError):
        validate_prefix("汉语")       # 非ascii
    with pytest.raises(ValueError):
        validate_prefix("abcdefghijk")  # >10 字符
    with pytest.raises(ValueError):
        validate_prefix("a-b")       # 符号


def test_load_returns_defaults_for_empty_custom(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    assert db.data["custom_voices"] == []
    assert db.data["defaults"]["system_voice"] == "longxiaochun_v3"


def test_add_and_remove_custom(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.add_custom({
        "voice_id": "cosyvoice-v3.5-plus-announcer-abc",
        "prefix": "announcer",
        "target_model": "cosyvoice-v3.5-plus",
        "type": "clone",
        "gmt_create": "2026-06-23 10:00:00",
        "status": "OK",
    })
    assert len(db.data["custom_voices"]) == 1
    # reload from disk
    db2 = VoicesDB(tmp_path / "v.json")
    assert len(db2.data["custom_voices"]) == 1
    db2.remove_custom("cosyvoice-v3.5-plus-announcer-abc")
    assert len(db2.data["custom_voices"]) == 0


def test_target_model_for_custom_voice(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.add_custom({"voice_id": "cosyvoice-v3.5-plus-announcer-abc",
                   "prefix": "announcer", "target_model": "cosyvoice-v3.5-plus",
                   "type": "clone", "gmt_create": "x", "status": "OK"})
    assert db.target_model_for("cosyvoice-v3.5-plus-announcer-abc") == "cosyvoice-v3.5-plus"


def test_target_model_for_system_voice(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.set_system_voices("cosyvoice-v3-flash", [
        {"id": "longxiaochun_v3", "name": "龙小淳", "desc": "", "lang": "中文/英文"}
    ])
    assert db.target_model_for("longxiaochun_v3") == "cosyvoice-v3-flash"


def test_target_model_for_unknown_returns_none(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    assert db.target_model_for("nonsense_voice") is None


def test_set_system_voices(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.set_system_voices("cosyvoice-v3-flash", [
        {"id": "longxiaochun_v3", "name": "龙小淳", "desc": "知性积极女", "lang": "中文/英文"}
    ])
    db2 = VoicesDB(tmp_path / "v.json")
    assert db2.data["system_voices"]["cosyvoice-v3-flash"][0]["id"] == "longxiaochun_v3"
