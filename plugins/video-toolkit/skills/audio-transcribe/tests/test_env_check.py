import json
from types import SimpleNamespace

import pytest

import env_check


def fake_platform(monkeypatch, system, machine, release="6.1.0"):
    monkeypatch.setattr(env_check.platform, "system", lambda: system)
    monkeypatch.setattr(env_check.platform, "machine", lambda: machine)
    monkeypatch.setattr(env_check.platform, "release", lambda: release)


# --- WSL / Rosetta ---------------------------------------------------------------

def test_wsl_detected_from_release(monkeypatch):
    fake_platform(monkeypatch, "Linux", "x86_64", release="5.15.167.4-microsoft-standard-WSL2")
    assert env_check._is_wsl() is True


def test_wsl_false_on_windows(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64", release="10")
    assert env_check._is_wsl() is False


def test_rosetta_detected_via_sysctl(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "x86_64")
    monkeypatch.setattr(env_check.subprocess, "run", lambda *a, **k: SimpleNamespace(
        returncode=0, stdout="1\n", stderr=""))
    assert env_check._is_rosetta() is True


def test_native_arm_mac_is_not_rosetta(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "arm64")
    assert env_check._is_rosetta() is False


# --- local_support_status matrix (doc §2/§4) --------------------------------------

def test_apple_silicon_ready_when_mlx_importable(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "arm64")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: True)
    assert env_check._local_support_status("Darwin", "arm64") == "ready"


def test_apple_silicon_needs_setup_when_missing(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "arm64")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: False)
    assert env_check._local_support_status("Darwin", "arm64") == "needs_setup"


def test_intel_mac_unsupported(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "x86_64")
    assert env_check._local_support_status("Darwin", "x86_64") == "unsupported"


def test_windows_amd64_status_matrix(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: True)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    assert env_check._local_support_status("Windows", "AMD64") == "ready"
    # CPU fallback passed zh+en end-to-end validation -> ready (doc §6)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: False)
    assert env_check._local_support_status("Windows", "AMD64") == "ready"
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: None)
    assert env_check._local_support_status("Windows", "AMD64") == "needs_setup"
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: False)
    assert env_check._local_support_status("Windows", "AMD64") == "needs_setup"  # qwen_asr missing


def test_windows_arm_unverified(monkeypatch):
    fake_platform(monkeypatch, "Windows", "ARM64")
    assert env_check._local_support_status("Windows", "ARM64") == "unverified"


# --- probe_backend -----------------------------------------------------------------

def test_probe_scribe_without_key(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    report = env_check.probe_backend("scribe")
    assert report["status"] == "needs_setup"
    assert any("ELEVENLABS_API_KEY" in c for c in report["checks"])


def test_probe_scribe_with_key_never_prints_it(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk-secret-value-do-not-print")
    report = env_check.probe_backend("scribe")
    assert report["status"] == "ready"
    assert "sk-secret-value-do-not-print" not in json.dumps(report)


def test_probe_qwen_intel_mac_unsupported(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "x86_64")
    report = env_check.probe_backend("qwen")
    assert report["status"] == "unsupported"
    assert any("Apple Silicon" in c for c in report["checks"])


def test_probe_qwen_torch_cuda_ready(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: True)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    monkeypatch.setattr(env_check, "_gpu_name", lambda: "RTX 4070 Ti")
    report = env_check.probe_backend("qwen")
    assert report["status"] == "ready"
    assert report["route"] == "torch"
    assert any("RTX 4070 Ti" in c for c in report["checks"])


def test_probe_qwen_torch_cpu_validated(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: True)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: False)
    report = env_check.probe_backend("qwen")
    assert report["status"] == "ready"
    assert any("CPU FP32 fallback" in c for c in report["checks"])


def test_probe_qwen_torch_missing_qwen_asr(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64")
    monkeypatch.setattr(env_check, "_import_ok",
                        lambda module, python=None: module != env_check.QWEN_TORCH_IMPORT)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    report = env_check.probe_backend("qwen")
    assert report["status"] == "needs_setup"
    assert any("qwen_asr" in c for c in report["checks"])


def test_probe_unknown_provider_raises():
    with pytest.raises(ValueError):
        env_check.probe_backend("whisper")


# --- detect_environment / format -------------------------------------------------

def test_detect_environment_shape(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64", release="10")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: True)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    monkeypatch.setattr(env_check, "_available_memory", lambda: 16.0)
    monkeypatch.setattr(env_check, "_free_disk_gb", lambda: 512.0)
    monkeypatch.setattr(env_check, "has_ffmpeg", lambda: True)
    env = env_check.detect_environment()
    assert env["os"] == "Windows"
    assert env["architecture"] == "AMD64"
    assert env["local_support_status"] == "ready"
    assert env["available_memory_gb"] == 16.0


def test_format_env_line_mac(monkeypatch):
    env = {"os": "Darwin", "architecture": "arm64", "is_wsl": False, "is_rosetta": False,
           "local_support_status": "ready"}
    line = env_check.format_env_line(env)
    assert "macOS" in line and "Apple Silicon" in line and "ready" in line


def test_format_env_line_rosetta(monkeypatch):
    env = {"os": "Darwin", "architecture": "x86_64", "is_wsl": False, "is_rosetta": True,
           "local_support_status": "unsupported"}
    assert "Rosetta" in env_check.format_env_line(env)


def test_format_env_line_wsl():
    env = {"os": "Linux", "architecture": "x86_64", "is_wsl": True, "is_rosetta": False,
           "local_support_status": "ready"}
    assert "WSL" in env_check.format_env_line(env)
