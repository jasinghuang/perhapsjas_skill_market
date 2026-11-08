import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import env_check
import media
import skill_main
from results import build_result, make_word
from subtitles import validate_srt


class FakeBackend:
    provider = "scribe"
    backend = "http"
    model_id = "scribe_v2"
    probe_status = "ready"
    words = None
    raise_on_transcribe = None

    def probe(self):
        return {"provider": self.provider, "status": self.probe_status, "checks": ["fake"]}

    def transcribe(self, media_path, language=None, options=None, on_stage=None, on_progress=None):
        if self.raise_on_transcribe:
            raise self.raise_on_transcribe
        words = self.words or [
            make_word(0.5, 1.2, "你好。"),
            make_word(2.0, 3.5, "第二句。"),
            make_word(4.0, 5.0, "Third one."),
        ]
        return build_result(
            provider=self.provider, backend=self.backend, model_id=self.model_id,
            language="zh", duration=6.0, text="你好。第二句。Third one.", words=words,
        )


@pytest.fixture
def fast_env(monkeypatch):
    monkeypatch.setattr(env_check, "detect_environment", lambda python=None: {
        "os": "Windows", "architecture": "AMD64", "python_version": "3.14.0",
        "python_architecture": "64bit", "is_wsl": False, "is_rosetta": False,
        "ffmpeg_available": True, "ffprobe_available": True,
        "available_memory_gb": 16, "free_disk_gb": 512, "local_support_status": "ready",
    })


@pytest.fixture
def media_file(tmp_path, monkeypatch):
    f = tmp_path / "视频 sample.wav"
    f.write_bytes(b"x" * 16)
    monkeypatch.setattr(media, "probe_media", lambda p: {
        "duration": 6.0, "audio_streams": [{"index": 0, "codec": "pcm", "channels": 1}],
    })
    return f


def patch_backend(monkeypatch, backend):
    monkeypatch.setattr(skill_main, "get_provider_backend", lambda provider, options=None: backend)
    return backend


# --- provider gate (doc §3) ------------------------------------------------------

def test_missing_provider_exits_2_with_choices(capsys):
    assert skill_main.main(["whatever.wav"]) == 2
    out = capsys.readouterr().out
    assert "qwen" in out and "scribe" in out
    assert "不会默认触发在线上传" in out


def test_unknown_provider_exits_2(capsys):
    assert skill_main.main(["x.wav", "--provider", "whisper"]) == 2


def test_missing_input_exits_2():
    assert skill_main.main(["--provider", "qwen"]) == 2


def test_provider_aliases_accepted(monkeypatch, fast_env, media_file, tmp_path):
    backend = patch_backend(monkeypatch, FakeBackend())
    code = skill_main.main([str(media_file), "--provider", "elevenlabs", "--output", str(tmp_path)])
    assert code == 0


# --- detect-env mode ---------------------------------------------------------------

def test_detect_env_prints_json_and_exits_0(monkeypatch, fast_env, capsys):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert skill_main.main(["--detect-env"]) == 0
    out = capsys.readouterr().out
    assert "检测到当前环境" in out
    payload = json.loads(out[out.index("{"):])
    assert payload["local_support_status"] == "ready"


def test_detect_env_with_provider_probes(monkeypatch, fast_env, capsys):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk-x")
    assert skill_main.main(["--detect-env", "--provider", "scribe"]) == 0
    out = capsys.readouterr().out
    assert "scribe" in out
    assert "sk-x" not in out  # key value never printed


# --- end-to-end outputs -------------------------------------------------------------

def test_trio_outputs_written_and_valid(monkeypatch, fast_env, media_file, tmp_path, capsys):
    patch_backend(monkeypatch, FakeBackend())
    code = skill_main.main([str(media_file), "--provider", "scribe", "--output", str(tmp_path)])
    assert code == 0
    txt = tmp_path / "视频 sample.txt"
    jsn = tmp_path / "视频 sample.json"
    srt = tmp_path / "视频 sample.srt"
    assert txt.is_file() and jsn.is_file() and srt.is_file()
    assert not list(tmp_path.glob("*.tmp"))  # atomic writes leave no temp files

    result = json.loads(jsn.read_text(encoding="utf-8"))
    assert result["schema_version"] == 1
    assert result["provider"] == "scribe"
    assert result["segments"], "segments carry the final subtitle entries"

    srt_text = srt.read_text(encoding="utf-8")
    assert not srt_text.startswith("\ufeff")  # no BOM: \u4e0b\u6e38\u89e3\u6790\u5668\u5bf9 BOM \u654f\u611f
    assert validate_srt(srt_text, 6.0) == []


def test_formats_subset_srt_only(monkeypatch, fast_env, media_file, tmp_path):
    patch_backend(monkeypatch, FakeBackend())
    code = skill_main.main([
        str(media_file), "--provider", "scribe", "--formats", "srt", "--output", str(tmp_path),
    ])
    assert code == 0
    assert (tmp_path / "视频 sample.srt").is_file()
    assert not (tmp_path / "视频 sample.txt").exists()
    assert not (tmp_path / "视频 sample.json").exists()


def test_invalid_format_rejected(capsys):
    assert skill_main.main(["x.wav", "--provider", "qwen", "--formats", "md"]) == 2


def test_partial_alignment_skips_srt(monkeypatch, fast_env, media_file, tmp_path, capsys):
    backend = FakeBackend()

    def transcribe(*args, **kwargs):
        result = build_result(
            provider="scribe", backend="http", model_id="scribe_v2",
            language="zh", duration=6.0, text="只有文本没有对齐。",
            words=[], status="partial",
            warnings=["chunk 0 alignment failed: boom; text kept, SRT unavailable"],
        )
        return result

    backend.transcribe = transcribe
    patch_backend(monkeypatch, backend)
    code = skill_main.main([str(media_file), "--provider", "scribe", "--output", str(tmp_path)])
    assert code == 0  # partial is a recognizable outcome, not a crash
    assert (tmp_path / "视频 sample.txt").is_file()
    assert (tmp_path / "视频 sample.json").is_file()
    assert not (tmp_path / "视频 sample.srt").exists()
    out = capsys.readouterr().out
    assert "SRT" in out


def test_no_speech_keeps_txt_json_without_fake_srt(monkeypatch, fast_env, media_file, tmp_path):
    backend = FakeBackend()

    def transcribe(*args, **kwargs):
        return build_result(
            provider="scribe", backend="http", model_id="scribe_v2",
            language=None, duration=6.0, text="",
            warnings=["no_speech: nothing detected"],
        )

    backend.transcribe = transcribe
    patch_backend(monkeypatch, backend)
    code = skill_main.main([str(media_file), "--provider", "scribe", "--output", str(tmp_path)])
    assert code == 0
    assert (tmp_path / "视频 sample.txt").read_text(encoding="utf-8") == ""
    assert not (tmp_path / "视频 sample.srt").exists()


# --- probe failures / batch ----------------------------------------------------------

def test_needs_setup_probe_reports_runpy_hint(monkeypatch, fast_env, media_file, tmp_path, capsys):
    backend = FakeBackend()
    backend.probe_status = "needs_setup"
    patch_backend(monkeypatch, backend)
    code = skill_main.main([str(media_file), "--provider", "qwen", "--output", str(tmp_path)])
    assert code == 1
    assert "run.py" in capsys.readouterr().out


def test_unsupported_probe_fails_with_reason(monkeypatch, fast_env, media_file, tmp_path, capsys):
    backend = FakeBackend()
    backend.probe_status = "unsupported"
    patch_backend(monkeypatch, backend)
    code = skill_main.main([str(media_file), "--provider", "qwen", "--output", str(tmp_path)])
    assert code == 1
    assert "不受支持" in capsys.readouterr().out


def test_batch_failure_summary_and_exit_1(monkeypatch, fast_env, tmp_path, capsys):
    files = []
    for name in ("a.wav", "b.wav"):
        f = tmp_path / name
        f.write_bytes(b"x")
        files.append(f)
    monkeypatch.setattr(media, "probe_media", lambda p: {
        "duration": 6.0, "audio_streams": [{"index": 0, "codec": "pcm", "channels": 1}],
    })

    calls = {"n": 0}
    backend = FakeBackend()

    def transcribe(media_path, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("network down")
        return build_result(provider="scribe", backend="http", model_id="scribe_v2",
                            language="zh", duration=6.0, text="ok",
                            words=[make_word(0.0, 1.0, "ok。")])

    backend.transcribe = transcribe
    patch_backend(monkeypatch, backend)
    code = skill_main.main(
        [str(f) for f in files] + ["--provider", "scribe", "--output", str(tmp_path)]
    )
    assert code == 1
    out = capsys.readouterr().out
    assert "1 failure" in out
    assert "a.wav: network down" in out
    assert (tmp_path / "b.srt").is_file()  # second file still processed


def test_keyboard_interrupt_exits_130(monkeypatch, fast_env, media_file, tmp_path, capsys):
    backend = FakeBackend()
    backend.raise_on_transcribe = KeyboardInterrupt()
    patch_backend(monkeypatch, backend)
    code = skill_main.main([str(media_file), "--provider", "scribe", "--output", str(tmp_path)])
    assert code == 130
    assert "已取消" in capsys.readouterr().out


def test_output_rejects_existing_file(monkeypatch, fast_env, media_file, tmp_path):
    existing = tmp_path / "out.txt"
    existing.write_text("x")
    assert skill_main.main([str(media_file), "--provider", "scribe", "--output", str(existing)]) == 2


def test_same_stem_inputs_do_not_overwrite(monkeypatch, fast_env, tmp_path):
    monkeypatch.setattr(media, "probe_media", lambda p: {
        "duration": 6.0, "audio_streams": [{"index": 0, "codec": "pcm", "channels": 1}],
    })
    f1 = tmp_path / "sample.mp4"
    f2 = tmp_path / "sample.mp3"
    f1.write_bytes(b"x")
    f2.write_bytes(b"x")

    def transcribe(media_path, **kwargs):
        return build_result(provider="scribe", backend="http", model_id="scribe_v2",
                            language="zh", duration=6.0, text="ok",
                            words=[make_word(0.0, 1.0, "ok。")])

    backend = FakeBackend()
    backend.transcribe = transcribe
    patch_backend(monkeypatch, backend)
    out = tmp_path / "out"
    code = skill_main.main([str(f1), str(f2), "--provider", "scribe", "--output", str(out)])
    assert code == 0
    assert (out / "sample.srt").is_file()
    assert (out / "sample-2.srt").is_file()  # second same-stem input gets a suffix
