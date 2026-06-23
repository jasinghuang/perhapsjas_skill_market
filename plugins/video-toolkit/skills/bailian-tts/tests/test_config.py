import json
import pytest
from bailian_tts import config


def test_resolve_from_env(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-env-xxx")
    # 即使 bl config 存在,env 优先
    assert config.resolve_api_key() == "sk-env-xxx"


def test_resolve_from_bl_config(tmp_path, monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    bl_cfg = tmp_path / "config.json"
    bl_cfg.write_text(json.dumps({"api_key": {"value": "sk-bl-yyy"}}), encoding="utf-8")
    monkeypatch.setattr(config, "_bl_config_path", lambda: bl_cfg)
    assert config.resolve_api_key() == "sk-bl-yyy"


def test_resolve_missing_raises(monkeypatch, tmp_path):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.setattr(config, "_bl_config_path", lambda: tmp_path / "nope.json")
    with pytest.raises(config.ApiKeyError):
        config.resolve_api_key()
