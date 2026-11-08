import subprocess
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from providers import FLAGSHIP_MODEL, find_voice
from providers.base import SynthesisResult
from providers.errors import (
    DOWNLOAD_FAILED,
    FATAL,
    RETRYABLE,
    SUBMISSION_UNKNOWN,
    SynthesisError,
)
from providers.online_bailian import (
    BAILIAN_CONSOLE_URL,
    DOWNLOAD_RETRY_DELAYS,
    OnlineBailianProvider,
    ProviderError,
    _readline_with_timeout,
    find_login_url,
    is_authenticated,
)

FLAG = find_voice("online", "longanlingxin_v3.1")
QTTS = find_voice("online", "Cherry")
CANTONESE = find_voice("online", "Rocky")


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
    out = Path("/tmp/a.wav")
    cmd = p.build_bl_command("你好", QTTS, out)
    assert cmd == [
        "bl", "speech", "synthesize", "--text", "你好",
        "--model", "qwen3-tts-flash", "--voice", "Cherry",
        "--format", "wav", "--language", "zh",
        "--sample-rate", "24000", "--out", str(out),
    ]


@pytest.mark.parametrize(
    ("lang", "code"),
    [
        ("chinese", "zh"), ("english", "en"), ("japanese", "ja"),
        ("korean", "ko"), ("german", "de"), ("french", "fr"),
        ("russian", "ru"), ("portuguese", "pt"), ("spanish", "es"),
        ("italian", "it"),
    ],
)
def test_build_bl_command_maps_language_code(lang, code):
    p = OnlineBailianProvider()
    cmd = p.build_bl_command("你好", QTTS, Path("/tmp/a.wav"), lang=lang)
    assert cmd[cmd.index("--language") + 1] == code


def _http_response(url="https://example.test/a.wav", request_id=None):
    body = {"output": {"audio": {"url": url}}}
    if request_id:
        body["request_id"] = request_id
    return MagicMock(
        raise_for_status=MagicMock(),
        json=lambda: body,
        headers={},
    )


def _http_download(content=b"RIFF"):
    return MagicMock(raise_for_status=MagicMock(), content=content)


# --- bl 路径：单次提交 + 错误分类（重试交给统一调度层） ---------------------


def test_synthesize_returns_synthesis_result_with_real_rate():
    p = OnlineBailianProvider()
    mono = np.full((100, 1), 0.2, dtype=np.float32)
    with patch("subprocess.run") as run, \
         patch("providers.online_bailian.sf.read", return_value=(mono, 24000)):
        out = p.synthesize("你好", QTTS)
    assert isinstance(out, SynthesisResult)
    assert out.sample_rate == 24000
    assert out.audio.shape == (100,)
    assert out.provider == "online"
    assert out.model_id == "qwen3-tts-flash"


def test_synthesize_accepts_non_24k_result_metadata():
    # 实际 WAV 元数据是 48k 时照常通过（T14 的在线侧）。
    p = OnlineBailianProvider()
    mono = np.full((100, 1), 0.2, dtype=np.float32)
    with patch("subprocess.run"), \
         patch("providers.online_bailian.sf.read", return_value=(mono, 48000)):
        out = p.synthesize("你好", QTTS)
    assert out.sample_rate == 48000


def test_http_500_is_retryable_single_attempt():
    # 429/5xx 只抛 retryable，不做内部重试（T05 的 provider 侧）。
    p = OnlineBailianProvider()
    error = subprocess.CalledProcessError(1, ["bl"], stderr="500 Internal Server Error")
    with patch("subprocess.run", side_effect=error) as run, \
         patch("providers.online_bailian.time.sleep") as sleep:
        with pytest.raises(SynthesisError) as excinfo:
            p.synthesize("你好", QTTS)
    assert excinfo.value.kind == RETRYABLE
    assert run.call_count == 1
    sleep.assert_not_called()


def test_429_is_retryable_and_parses_retry_after():
    p = OnlineBailianProvider()
    error = subprocess.CalledProcessError(
        1, ["bl"], stderr="429 Too Many Requests; Retry-After: 7"
    )
    with patch("subprocess.run", side_effect=error):
        with pytest.raises(SynthesisError) as excinfo:
            p.synthesize("你好", QTTS)
    assert excinfo.value.kind == RETRYABLE
    assert excinfo.value.retry_after == 7.0


def test_timeout_is_submission_unknown_not_auto_resubmit():
    # CLI 只给非零退出码时，timeout 不能当作安全重提信号（spec §10）。
    p = OnlineBailianProvider()
    error = subprocess.CalledProcessError(1, ["bl"], stderr="request timed out")
    with patch("subprocess.run", side_effect=error) as run:
        with pytest.raises(SynthesisError) as excinfo:
            p.synthesize("你好", QTTS)
    assert excinfo.value.kind == SUBMISSION_UNKNOWN
    assert run.call_count == 1


def test_401_fails_immediately_with_login_hint():
    p = OnlineBailianProvider()
    unauthorized = subprocess.CalledProcessError(
        1, ["bl"], stderr="401 Unauthorized"
    )
    with patch("subprocess.run", side_effect=unauthorized) as run:
        with pytest.raises(SynthesisError, match="bl auth login") as excinfo:
            p.synthesize("你好", QTTS)
    assert run.call_count == 1
    assert excinfo.value.kind == FATAL


def test_quota_error_is_fatal_with_console_link():
    p = OnlineBailianProvider()
    quota = subprocess.CalledProcessError(
        1, ["bl"], stderr="Throttling.User: 额度不足"
    )
    with patch("subprocess.run", side_effect=quota) as run:
        with pytest.raises(SynthesisError, match="bailian.console.aliyun.com") as excinfo:
            p.synthesize("你好", QTTS)
    assert run.call_count == 1
    assert excinfo.value.kind == FATAL


def test_plain_bl_failure_is_retryable():
    p = OnlineBailianProvider()
    error = subprocess.CalledProcessError(1, ["bl"], stderr="boom")
    with patch("subprocess.run", side_effect=error):
        with pytest.raises(SynthesisError) as excinfo:
            p.synthesize("你好", QTTS)
    assert excinfo.value.kind == RETRYABLE


# --- HTTP 兜底：提交一次 + 下载独立预算 -------------------------------------


def _prepared_http(tmp_path=None):
    return OnlineBailianProvider(
        api_key="sk-test", endpoint="https://example.test/tts"
    )


def test_http_payload_maps_language_type(tmp_path):
    p = _prepared_http()
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", return_value=_http_download()):
        p._synthesize_http("hello", QTTS, "", "english", tmp_path / "a.wav")
    assert post.call_args.kwargs["json"]["input"]["language_type"] == "English"


def test_http_payload_uses_language_hints_for_flagship(tmp_path):
    p = _prepared_http()
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", return_value=_http_download()):
        p._synthesize_http("你好", FLAG, "", "chinese", tmp_path / "a.wav")
    payload = post.call_args.kwargs["json"]["input"]
    assert payload["language_hints"] == ["zh"]
    assert "language_type" not in payload


def test_http_timeout_is_submission_unknown(tmp_path):
    p = _prepared_http()
    import requests as _requests

    with patch("requests.post", side_effect=_requests.Timeout("t")):
        with pytest.raises(SynthesisError) as excinfo:
            p._synthesize_http("你好", QTTS, "", "chinese", tmp_path / "a.wav")
    assert excinfo.value.kind == SUBMISSION_UNKNOWN


def test_http_connection_error_before_submit_is_retryable(tmp_path):
    p = _prepared_http()
    import requests as _requests

    with patch("requests.post", side_effect=_requests.ConnectionError("refused")):
        with pytest.raises(SynthesisError) as excinfo:
            p._synthesize_http("你好", QTTS, "", "chinese", tmp_path / "a.wav")
    assert excinfo.value.kind == RETRYABLE


def test_http_4xx_is_fatal_no_retry(tmp_path):
    p = _prepared_http()
    response = MagicMock(
        raise_for_status=MagicMock(
            side_effect=Exception("400 Bad Request invalid voice")
        ),
        status_code=400,
        headers={},
    )
    with patch("requests.post", return_value=response) as post:
        with pytest.raises(SynthesisError) as excinfo:
            p._synthesize_http("你好", QTTS, "", "chinese", tmp_path / "a.wav")
    assert excinfo.value.kind == FATAL
    assert post.call_count == 1


def test_download_failure_retries_without_resubmitting_synthesis(tmp_path):
    # T06：合成成功、下载失败 → 只重试下载，合成请求仍为 1 次。
    p = _prepared_http()
    out = tmp_path / "a.wav"
    bad = MagicMock(
        raise_for_status=MagicMock(side_effect=Exception("502")),
        status_code=502, headers={},
    )
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", side_effect=[bad, _http_download(b"RIFF")]) as get, \
         patch("providers.online_bailian.time.sleep") as sleep:
        p._synthesize_http("你好", QTTS, "", "chinese", out)
    assert post.call_count == 1
    assert get.call_count == 2
    sleep.assert_called_once_with(DOWNLOAD_RETRY_DELAYS[0])
    assert out.read_bytes() == b"RIFF"


def test_download_failure_exhausts_budget_and_keeps_url(tmp_path):
    p = _prepared_http()
    bad = MagicMock(
        raise_for_status=MagicMock(side_effect=Exception("502")),
        status_code=502, headers={},
    )
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", side_effect=[bad, bad, bad]) as get, \
         patch("providers.online_bailian.time.sleep"):
        with pytest.raises(SynthesisError) as excinfo:
            p._synthesize_http("你好", QTTS, "", "chinese", tmp_path / "a.wav")
    assert post.call_count == 1   # 绝不重新提交合成
    assert get.call_count == 3    # 下载预算独立用尽
    # F02：合成已成功、只差下载 → download_failed（不是 retryable），
    # 引擎不得据此重新提交合成。
    assert excinfo.value.kind == DOWNLOAD_FAILED
    assert excinfo.value.audio_url == "https://example.test/a.wav"


def test_download_receipt_redownloads_without_resubmitting(tmp_path):
    # F02 恢复路径：按收据 URL 只下载，不发生新的合成提交。
    import numpy as np
    import soundfile as sf

    wav = tmp_path / "receipt.wav"
    sf.write(wav, np.full(2400, 0.2, dtype=np.float32), 24000)
    p = _prepared_http()
    with patch("requests.post") as post, \
         patch("requests.get", return_value=MagicMock(content=wav.read_bytes())):
        result = p.download(
            "https://example.test/a.wav", voice=QTTS, request_id="req-1"
        )
    post.assert_not_called()
    assert result.sample_rate == 24000
    assert result.request_id == "req-1"


def test_bl_synthesize_timeout_is_submission_unknown(tmp_path):
    # F02：bl 子进程必须有界；超时无法确认服务端是否受理 → submission_unknown。
    import subprocess as _sp

    p = OnlineBailianProvider()
    p._use_http = False
    out = tmp_path / "a.wav"
    with patch(
        "subprocess.run",
        side_effect=_sp.TimeoutExpired(cmd="bl", timeout=300),
    ):
        with pytest.raises(SynthesisError) as excinfo:
            p._synthesize_bl("你好", QTTS, "", "chinese", out)
    assert excinfo.value.kind == SUBMISSION_UNKNOWN


# --- 其余行为保持 -------------------------------------------------------------


def test_cantonese_voice_omits_language_and_carries_style():
    p = OnlineBailianProvider()
    cmd = p.build_bl_command(
        "你好", CANTONESE, Path("/tmp/a.wav"),
        rate=1.1, pitch=1.0, volume=80, seed=42, enable_ssml=False,
    )
    assert "--language" not in cmd
    assert cmd[cmd.index("--rate") + 1] == "1.1"
    assert cmd[cmd.index("--volume") + 1] == "80"
    assert cmd[cmd.index("--seed") + 1] == "42"


def test_ssml_text_is_wrapped_once():
    p = OnlineBailianProvider()
    cmd = p.build_bl_command(
        "你好<break time=\"300ms\"/>世界", FLAG, Path("/tmp/a.wav"),
        enable_ssml=True,
    )
    assert cmd[cmd.index("--text") + 1] == (
        "<speak>你好<break time=\"300ms\"/>世界</speak>"
    )
    assert "--enable-ssml" in cmd

    wrapped = p.build_bl_command(
        "<speak>你好</speak>", FLAG, Path("/tmp/a.wav"), enable_ssml=True,
    )
    assert wrapped[wrapped.index("--text") + 1] == "<speak>你好</speak>"


def test_http_payload_wraps_ssml_once(tmp_path):
    p = _prepared_http()
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", return_value=_http_download()):
        p._synthesize_http(
            "你好<break time=\"300ms\"/>", FLAG, "", "chinese",
            tmp_path / "a.wav", enable_ssml=True,
        )
    payload = post.call_args.kwargs["json"]["input"]
    assert payload["text"] == "<speak>你好<break time=\"300ms\"/></speak>"
    assert payload["enable_ssml"] is True


def test_force_http_prepare_for_hotfix():
    p = OnlineBailianProvider(
        api_key="sk-test", endpoint="https://example.test/tts", force_http=True
    )
    with patch("shutil.which") as which:
        p.prepare()
    which.assert_not_called()
    assert p._use_http is True


def test_http_payload_includes_hot_fix(tmp_path):
    p = _prepared_http()
    hotfix = {"replace": [{"今天": "金天"}]}
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", return_value=_http_download()):
        p._synthesize_http(
            "今天", FLAG, "", "chinese", tmp_path / "a.wav", hot_fix=hotfix
        )
    assert post.call_args.kwargs["json"]["input"]["hot_fix"] == hotfix


def test_synthesize_routes_hotfix_to_http_even_with_bl(tmp_path):
    p = _prepared_http()
    p._use_http = False
    with patch.object(p, "_synthesize_http") as http, \
         patch.object(p, "_synthesize_bl") as bl, \
         patch("providers.online_bailian.sf.read") as read:
        read.return_value = (np.zeros((24000, 1), dtype=np.float32), 24000)
        p.synthesize("今天", FLAG, hot_fix={"replace": [{"今天": "金天"}]})
    http.assert_called_once()
    bl.assert_not_called()


def test_http_payload_cantonese_omits_language_and_carries_style(tmp_path):
    p = _prepared_http()
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", return_value=_http_download()):
        p._synthesize_http(
            "你好", CANTONESE, "", "chinese", tmp_path / "a.wav",
            rate=1.1, pitch=1.0, volume=80, seed=42,
        )
    payload = post.call_args.kwargs["json"]["input"]
    assert "language_type" not in payload and "language_hints" not in payload
    assert payload["rate"] == 1.1
    assert payload["pitch"] == 1.0
    assert payload["volume"] == 80
    assert payload["seed"] == 42


def test_http_payload_includes_instruction_only_for_flagship(tmp_path):
    p = _prepared_http()
    with patch("requests.post", return_value=_http_response()) as post, \
         patch("requests.get", return_value=_http_download()):
        p._synthesize_http("你好", FLAG, "平稳解说", "chinese", tmp_path / "a.wav")
        flag_body = post.call_args.kwargs["json"]
        p._synthesize_http("你好", QTTS, "平稳解说", "chinese", tmp_path / "b.wav")
        qwen_body = post.call_args.kwargs["json"]
    assert flag_body["input"]["instruction"] == "平稳解说"
    assert "instruction" not in qwen_body["input"]


def test_describe_reports_online_and_shared_flagship_constant():
    p = OnlineBailianProvider()
    info = p.describe()
    assert info["provider"] == "online"
    assert info["model"] == FLAGSHIP_MODEL


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


def test_missing_bl_error_mentions_dashscope_env_and_endpoint():
    with patch("shutil.which", return_value=None):
        p = OnlineBailianProvider(api_key=None)
        with pytest.raises(ProviderError) as excinfo:
            p.prepare()
    message = str(excinfo.value)
    assert "DASHSCOPE_API_KEY" in message
    assert "--tts-endpoint" in message
    assert "--api-key" not in message


def test_prepare_with_bl_checks_login():
    p = OnlineBailianProvider()
    with patch("shutil.which", return_value="/usr/local/bin/bl"), \
         patch.object(p, "ensure_authenticated") as ensure:
        p.prepare()
    ensure.assert_called_once_with()


def test_login_flow_prints_url_and_polls_until_authenticated(capsys):
    p = OnlineBailianProvider(poll_interval=0.001)
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
    # 成功后也必须回收登录子进程，避免遗留。
    proc.terminate.assert_called_once()
    proc.wait.assert_called_once()


def test_login_flow_raises_when_process_exits():
    p = OnlineBailianProvider(poll_interval=0.001)
    with patch.object(p, "is_authenticated", side_effect=[False, False]), \
         patch("subprocess.Popen") as popen:
        proc = MagicMock()
        proc.stdout.readline.side_effect = ["Visit https://login.example.com/abc\n", ""]
        proc.poll.return_value = 1
        popen.return_value = proc
        with pytest.raises(ProviderError, match="https://login.example.com/abc"):
            p.ensure_authenticated()
    proc.wait.assert_called_once()


def test_login_flow_terminates_child_on_timeout():
    p = OnlineBailianProvider(login_timeout=0.0, poll_interval=0.0)
    with patch.object(p, "is_authenticated", return_value=False), \
         patch("subprocess.Popen") as popen:
        proc = MagicMock()
        proc.stdout.readline.side_effect = ["no url here\n", ""]
        proc.poll.return_value = None
        popen.return_value = proc
        with pytest.raises(ProviderError, match="超时"):
            p.ensure_authenticated()
    proc.terminate.assert_called_once()
    proc.wait.assert_called_once()


def test_readline_with_timeout_does_not_hang_without_newline():
    unblock = threading.Event()

    class BlockingStream:
        def readline(self):
            unblock.wait(2.0)
            return ""

    started = time.monotonic()
    try:
        assert _readline_with_timeout(BlockingStream(), 0.05) == ""
        assert time.monotonic() - started < 1.0
    finally:
        unblock.set()


def test_prepare_switches_to_http_when_bl_missing():
    p = _prepared_http()
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
    p = _prepared_http()
    with patch("shutil.which", return_value=None), \
         patch.object(p, "_synthesize_http", side_effect=ProviderError("stop")) as http, \
         patch("subprocess.run") as run:
        p.prepare()
        with pytest.raises(ProviderError, match="stop"):
            p.synthesize("你好", QTTS)
    args = http.call_args.args
    assert args[0] == "你好" and args[1] is QTTS
    run.assert_not_called()


def test_console_url_constant_is_the_shared_link():
    assert BAILIAN_CONSOLE_URL == "https://bailian.console.aliyun.com/"
