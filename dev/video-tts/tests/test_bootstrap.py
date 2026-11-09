from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


def test_env_dir_override_and_venv_paths(r, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEO_TTS_ENV_DIR", str(tmp_path / "envs"))
    assert r.app_envs_root() == tmp_path / "envs"
    assert r.venv_dir("mlx") == tmp_path / "envs" / "video-tts-mlx"
    assert str(r.venv_python("mlx")).endswith("python")


def test_venv_python_is_not_collapsed_to_base_interpreter(r, tmp_path, monkeypatch):
    monkeypatch.setenv("VIDEO_TTS_ENV_DIR", str(tmp_path / "envs"))
    bin_dir = tmp_path / "envs" / "video-tts-online" / "bin"
    bin_dir.mkdir(parents=True)
    link = bin_dir / "python"
    link.symlink_to(sys.executable)
    candidates = r.candidate_interpreters("online")
    assert str(link) in candidates
    assert r._same_executable(str(link), sys.executable) is False


def test_model_cache_path_requires_weights(r, tmp_path, monkeypatch):
    hub = tmp_path / "hub"
    monkeypatch.setenv("HF_HOME", str(tmp_path))
    snapshot = hub / "models--org--name" / "snapshots" / "abc"
    snapshot.mkdir(parents=True)
    (snapshot / "config.json").write_text("{}", encoding="utf-8")
    assert r.model_cache_path("org/name") is None
    (snapshot / "model.safetensors").write_bytes(b"weights")
    assert r.model_cache_path("org/name") == snapshot


def test_driver_cuda_index(monkeypatch, r):
    def fake_run(command, **kwargs):
        return SimpleNamespace(stdout=b"| NVIDIA-SMI 610.88   Driver Version: 610.88   CUDA Version: 12.8 |\n")

    monkeypatch.setattr(r.subprocess, "run", fake_run)
    assert r.driver_cuda_index() == "cu128"

    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: SimpleNamespace(stdout=b"CUDA UMD Version: 13.1\n"),
    )
    assert r.driver_cuda_index() == "cu130"

    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: SimpleNamespace(stdout=b"CUDA Version: 12.2\n"),
    )
    assert r.driver_cuda_index() is None


def test_detect_local_ready(monkeypatch, r, tmp_path):
    monkeypatch.setattr(r.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(r.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(r, "find_working_interpreter", lambda route, timeout=45: (sys.executable, []))
    monkeypatch.setattr(r, "model_cache_path", lambda model_id: tmp_path / "model")
    info = r.detect_local()
    assert info["status"] == "ready"
    assert info["backend"] == "mlx_audio"
    assert info["models"]["preset"]["cached"] is True


def test_detect_local_needs_model(monkeypatch, r):
    monkeypatch.setattr(r.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(r.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(r, "find_working_interpreter", lambda route, timeout=45: (sys.executable, []))
    monkeypatch.setattr(r, "model_cache_path", lambda model_id: None)
    info = r.detect_local()
    assert info["status"] == "needs_setup"
    assert any("not cached" in reason for reason in info["reason"])


def test_detect_local_unknown_on_probe_timeout(monkeypatch, r):
    monkeypatch.setattr(r.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(r.platform, "machine", lambda: "arm64")
    monkeypatch.setattr(
        r,
        "find_working_interpreter",
        lambda route, timeout=45: (None, ["/x/python: capability probe failed or timed out"]),
    )
    monkeypatch.setattr(r, "model_cache_path", lambda model_id: None)
    info = r.detect_local()
    assert info["status"] == "unknown"


def test_detect_local_unsupported_platform(monkeypatch, r):
    monkeypatch.setattr(r.platform, "system", lambda: "Linux")
    monkeypatch.setattr(r.platform, "machine", lambda: "x86_64")
    info = r.detect_local()
    assert info["status"] == "unsupported"
    assert info["backend"] is None


def test_detect_online_without_key(r, monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    info = r.detect_online()
    assert info["status"] == "needs_setup"
    assert info["api_key_present"] is False


def test_detect_online_ready(monkeypatch, r):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "key")
    monkeypatch.setattr(r, "find_working_interpreter", lambda route, timeout=30: (sys.executable, []))
    monkeypatch.setattr(
        r,
        "_http_json",
        lambda url, api_key, timeout=10: [
            {"model_id": "eleven_multilingual_v2"},
            {"model_id": "eleven_flash_v2_5"},
        ],
    )
    info = r.detect_online()
    assert info["status"] == "ready"
    assert sorted(info["models_available"]) == ["eleven_flash_v2_5", "eleven_multilingual_v2"]


def test_ensure_environment_no_install(monkeypatch, r):
    monkeypatch.setattr(r, "find_working_interpreter", lambda route, timeout=60: (None, ["missing"]))
    with pytest.raises(r.SetupError, match="automatic installation is disabled"):
        r.ensure_environment("online", allow_install=False)


def test_check_tools_requires_both(monkeypatch, r):
    old_ffmpeg, old_ffprobe = r.FFMPEG, r.FFPROBE
    monkeypatch.setattr(r.shutil, "which", lambda name: None)
    try:
        with pytest.raises(r.SetupError, match="ffmpeg"):
            r.check_tools()
    finally:
        r.FFMPEG, r.FFPROBE = old_ffmpeg, old_ffprobe
