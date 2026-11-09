from __future__ import annotations

import json
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


def _make_snapshot(hub, shards=("model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors")):
    snapshot = hub / "models--org--name" / "snapshots" / "abc"
    snapshot.mkdir(parents=True)
    for name in (
        "config.json",
        "tokenizer_config.json",
        "preprocessor_config.json",
        "generation_config.json",
        "vocab.json",
        "merges.txt",
    ):
        (snapshot / name).write_text("{}", encoding="utf-8")
    (snapshot / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {f"w{index}": shard for index, shard in enumerate(shards)}}),
        encoding="utf-8",
    )
    for shard in shards:
        (snapshot / shard).write_bytes(b"weights")
    speech = snapshot / "speech_tokenizer"
    speech.mkdir()
    (speech / "config.json").write_text("{}", encoding="utf-8")
    (speech / "preprocessor_config.json").write_text("{}", encoding="utf-8")
    (speech / "model.safetensors").write_bytes(b"speech")
    return snapshot


def test_model_cache_path_requires_all_indexed_shards(r, tmp_path, monkeypatch):
    hub = tmp_path / "hub"
    monkeypatch.setenv("HF_HOME", str(tmp_path))
    snapshot = _make_snapshot(hub)
    complete, missing = r.snapshot_complete(snapshot)
    assert complete is True
    assert missing == []
    assert r.model_cache_path("org/name") == snapshot

    (snapshot / "model-00002-of-00002.safetensors").unlink()
    complete, missing = r.snapshot_complete(snapshot)
    assert complete is False
    assert "model-00002-of-00002.safetensors" in missing
    assert r.model_cache_path("org/name") is None


def test_ensure_model_cached_rejects_incomplete_snapshot_after_download(
    r, tmp_path, monkeypatch
):
    import huggingface_hub

    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    (snapshot / "config.json").write_text("{}", encoding="utf-8")

    def fake_snapshot_download(model_id, **kwargs):
        return str(snapshot)

    class FakeApi:
        def model_info(self, model_id, files_metadata=False):
            return SimpleNamespace(siblings=[])

    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot_download)
    monkeypatch.setattr(huggingface_hub, "HfApi", FakeApi)
    with pytest.raises(r.RunnerError, match="incomplete after download"):
        r.ensure_model_cached("org/name")


def test_snapshot_completeness_checks_speech_tokenizer_weights(r, tmp_path, monkeypatch):
    hub = tmp_path / "hub"
    monkeypatch.setenv("HF_HOME", str(tmp_path))
    snapshot = _make_snapshot(hub)
    (snapshot / "speech_tokenizer" / "model.safetensors").unlink()
    complete, missing = r.snapshot_complete(snapshot)
    assert complete is False
    assert "speech_tokenizer/weights/*.safetensors" in missing


def _nvidia_result(stdout, returncode=0):
    return SimpleNamespace(stdout=stdout, stderr=b"", returncode=returncode)


def test_driver_cuda_index(monkeypatch, r):
    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: _nvidia_result(
            b"| NVIDIA-SMI 610.88   Driver Version: 610.88   CUDA Version: 12.8 |\n"
        ),
    )
    assert r.driver_cuda_index() == "cu128"

    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: _nvidia_result(b"CUDA UMD Version: 13.1\n"),
    )
    assert r.driver_cuda_index() == "cu130"

    # torch 2.10.0 does not ship cu124; a 12.0-12.7 driver uses cu126 via
    # CUDA minor-version compatibility.
    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: _nvidia_result(b"CUDA Version: 12.2\n"),
    )
    assert r.driver_cuda_index() == "cu126"

    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: _nvidia_result(b"CUDA Version: 11.8\n"),
    )
    assert r.driver_cuda_index() is None


def test_nvidia_smi_no_devices(monkeypatch, r):
    monkeypatch.setattr(
        r.subprocess,
        "run",
        lambda command, **kwargs: _nvidia_result(
            b"NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver\n",
            returncode=1,
        ),
    )
    info = r.nvidia_smi_info()
    assert info["present"] is True
    assert info["usable"] is False
    assert "exit 1" in info["reason"]


def test_detect_local_cpu_torch_is_needs_setup(monkeypatch, r):
    monkeypatch.setattr(r.platform, "system", lambda: "Windows")
    monkeypatch.setattr(r.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(
        r,
        "nvidia_smi_info",
        lambda: {
            "present": True,
            "usable": True,
            "cuda_version": (12, 8),
            "reason": "",
        },
    )
    monkeypatch.setattr(
        r,
        "find_working_interpreter",
        lambda route, timeout=45: (None, ["C:/Python/python.exe: torch.cuda is unavailable"]),
    )
    monkeypatch.setattr(r, "model_cache_path", lambda model_id: None)
    info = r.detect_local()
    assert info["status"] == "needs_setup"
    assert info["backend"] == "qwen_tts"
    assert any("NVIDIA GPU detected" in reason for reason in info["reason"])


def test_detect_local_without_nvidia_is_unsupported(monkeypatch, r):
    monkeypatch.setattr(r.platform, "system", lambda: "Windows")
    monkeypatch.setattr(r.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(
        r,
        "nvidia_smi_info",
        lambda: {
            "present": False,
            "usable": False,
            "cuda_version": None,
            "reason": "nvidia-smi is unavailable",
        },
    )
    monkeypatch.setattr(r, "model_cache_path", lambda model_id: None)
    info = r.detect_local()
    assert info["status"] == "unsupported"


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
