import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from providers import find_voice
from providers.online_bailian import (
    OnlineBailianProvider, ProviderError, find_login_url, is_authenticated,
)

FLAG = find_voice("online", "longanlingxin_v3.1")
QTTS = find_voice("online", "Cherry")


def test_build_bl_command_for_flagship_with_instruction():
    p = OnlineBailianProvider()
    cmd = p.build_bl_command("你好", FLAG, Path("/tmp/a.wav"), instruct="平稳解说")
    assert cmd[:5] == ["bl", "speech", "synthesize", "--text", "你好"]
    assert "--model" in cmd and cmd[cmd.index("--model") + 1] == "qwen-audio-3.1-tts-plus"
    assert cmd[cmd.index("--voice") + 1] == "longanlingxin_v3.1"
    assert cmd[cmd.index("--instruction") + 1] == "平稳解说"


def test_build_bl_command_omits_instruction_for_qwen_tts():
    p = OnlineBailianProvider()
    cmd = p.build_bl_command("你好", QTTS, Path("/tmp/a.wav"), instruct="x")
    assert "--instruction" not in cmd


def test_build_bl_command_exact_order_and_audio_options():
    p = OnlineBailianProvider()
    cmd = p.build_bl_command("你好", QTTS, Path("/tmp/a.wav"))
    assert cmd == [
        "bl", "speech", "synthesize", "--text", "你好",
        "--model", "qwen3-tts-flash", "--voice", "Cherry",
        "--format", "wav", "--sample-rate", "24000", "--out", "/tmp/a.wav",
    ]


def test_find_login_url():
    assert find_login_url("open https://login.example.com/x?state=1 to continue") == "https://login.example.com/x?state=1"
    assert find_login_url("no url") is None


def test_authenticated_reads_bl_status():
    payload = '{"authenticated": true}'
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout=payload)
        assert is_authenticated("bl") is True


def test_authenticated_false_on_any_error():
    with patch("subprocess.run", side_effect=OSError("no bl")):
        assert is_authenticated("bl") is False
    with patch("subprocess.run") as run:
        run.return_value = MagicMock(returncode=0, stdout="not json")
        assert is_authenticated("bl") is False


def test_missing_bl_without_key_raises():
    with patch("shutil.which", return_value=None):
        p = OnlineBailianProvider(api_key=None)
        with pytest.raises(ProviderError, match="bl"):
            p.prepare()


def test_prepare_with_bl_checks_login():
    p = OnlineBailianProvider()
    with patch("shutil.which", return_value="/usr/local/bin/bl"), \
         patch.object(p, "ensure_authenticated") as ensure:
        p.prepare()
    ensure.assert_called_once_with()


def test_login_flow_prints_url_and_polls_until_authenticated(capsys):
    p = OnlineBailianProvider()
    calls = []
    with patch.object(p, "is_authenticated", side_effect=[False, False, True]), \
         patch("subprocess.Popen") as popen:
        proc = MagicMock()
        proc.stdout.readline.side_effect = ["Visit https://login.example.com/abc\n", ""]
        proc.poll.return_value = None
        popen.return_value = proc
        p.ensure_authenticated(on_url=calls.append)
    assert calls == ["https://login.example.com/abc"]
    assert "https://login.example.com/abc" in capsys.readouterr().out


def test_login_flow_raises_when_process_exits():
    p = OnlineBailianProvider()
    with patch.object(p, "is_authenticated", side_effect=[False, False]), \
         patch("subprocess.Popen") as popen:
        proc = MagicMock()
        proc.stdout.readline.side_effect = ["Visit https://login.example.com/abc\n", ""]
        proc.poll.return_value = 1
        popen.return_value = proc
        with pytest.raises(ProviderError, match="https://login.example.com/abc"):
            p.ensure_authenticated()


def test_synthesize_returns_mono_float32_at_24k():
    p = OnlineBailianProvider()
    stereo = np.ones((100, 2), dtype=np.float32)
    with patch("subprocess.run") as run, \
         patch("providers.online_bailian.sf.read", return_value=(stereo, 24000)):
        out = p.synthesize("你好", QTTS)
    cmd = run.call_args.args[0]
    assert cmd[:5] == ["bl", "speech", "synthesize", "--text", "你好"]
    assert run.call_args.kwargs == {"check": True, "capture_output": True, "text": True}
    assert out.dtype == np.float32
    assert out.shape == (100,)


def test_synthesize_raises_provider_error_with_stderr():
    p = OnlineBailianProvider()
    error = subprocess.CalledProcessError(1, ["bl"], stderr="boom")
    with patch("subprocess.run", side_effect=error):
        with pytest.raises(ProviderError, match="boom"):
            p.synthesize("你好", QTTS)


def test_synthesize_rejects_non_24k_audio():
    p = OnlineBailianProvider()
    mono = np.zeros((100, 1), dtype=np.float32)
    with patch("subprocess.run"), \
         patch("providers.online_bailian.sf.read", return_value=(mono, 48000)):
        with pytest.raises(ProviderError, match="24000"):
            p.synthesize("你好", QTTS)


def test_http_fallback_downloads_audio_url(tmp_path):
    p = OnlineBailianProvider(api_key="sk-test", endpoint="https://example.test/tts")
    with patch("requests.post") as post, patch("requests.get") as get, \
         patch("soundfile.write") as write:
        post.return_value = MagicMock(raise_for_status=MagicMock(), json=lambda: {
            "output": {"audio": {"url": "https://example.test/a.wav"}}
        })
        get.return_value = MagicMock(raise_for_status=MagicMock(), content=b"RIFF")
        p._synthesize_http("你好", QTTS, "", "chinese", tmp_path / "a.wav")
    body = post.call_args.kwargs["json"]
    assert body["model"] == "qwen3-tts-flash"
    assert body["input"]["voice"] == "Cherry"
    assert post.call_args.kwargs["headers"]["Authorization"] == "Bearer sk-test"
    get.assert_called_once()


def test_http_fallback_requires_endpoint(tmp_path):
    p = OnlineBailianProvider(api_key="sk-test")
    with patch("requests.post") as post:
        with pytest.raises(ProviderError, match="--tts-endpoint"):
            p._synthesize_http("你好", QTTS, "", "chinese", tmp_path / "a.wav")
    post.assert_not_called()


def test_http_payload_includes_instruction_only_for_flagship(tmp_path):
    p = OnlineBailianProvider(api_key="sk-test", endpoint="https://example.test/tts")
    response = MagicMock(
        raise_for_status=MagicMock(),
        json=lambda: {"output": {"audio": {"url": "https://example.test/a.wav"}}},
    )
    download = MagicMock(raise_for_status=MagicMock(), content=b"RIFF")
    with patch("requests.post", return_value=response) as post, \
         patch("requests.get", return_value=download):
        p._synthesize_http("你好", FLAG, "平稳解说", "chinese", tmp_path / "a.wav")
        flag_body = post.call_args.kwargs["json"]
        p._synthesize_http("你好", QTTS, "平稳解说", "chinese", tmp_path / "b.wav")
        qwen_body = post.call_args.kwargs["json"]
    assert flag_body["input"]["instruction"] == "平稳解说"
    assert "instruction" not in qwen_body["input"]


def test_prepare_switches_to_http_when_bl_missing():
    p = OnlineBailianProvider(api_key="sk-test", endpoint="https://example.test/tts")
    with patch("shutil.which", return_value=None), \
         patch.object(p, "ensure_authenticated") as ensure:
        p.prepare()
    ensure.assert_not_called()
    assert p._use_http is True


def test_prepare_http_mode_requires_endpoint():
    p = OnlineBailianProvider(api_key="sk-test")
    with patch("shutil.which", return_value=None):
        with pytest.raises(ProviderError, match="--tts-endpoint"):
            p.prepare()


def test_synthesize_uses_http_after_prepare_without_bl():
    p = OnlineBailianProvider(api_key="sk-test", endpoint="https://example.test/tts")
    with patch("shutil.which", return_value=None), \
         patch.object(p, "_synthesize_http", side_effect=ProviderError("stop")) as http, \
         patch("subprocess.run") as run:
        p.prepare()
        with pytest.raises(ProviderError, match="stop"):
            p.synthesize("你好", QTTS)
    args = http.call_args.args
    assert args[0] == "你好" and args[1] is QTTS
    run.assert_not_called()


def test_synthesize_http_returns_mono_float32_at_24k():
    p = OnlineBailianProvider(api_key="sk-test", endpoint="https://example.test/tts")
    stereo = np.ones((100, 2), dtype=np.float32)
    with patch("shutil.which", return_value=None), \
         patch("requests.post") as post, patch("requests.get") as get, \
         patch("providers.online_bailian.sf.read", return_value=(stereo, 24000)):
        post.return_value = MagicMock(raise_for_status=MagicMock(), json=lambda: {
            "output": {"audio": {"url": "https://example.test/a.wav"}}
        })
        get.return_value = MagicMock(raise_for_status=MagicMock(), content=b"RIFF")
        p.prepare()
        out = p.synthesize("你好", QTTS)
    assert out.dtype == np.float32
    assert out.shape == (100,)
