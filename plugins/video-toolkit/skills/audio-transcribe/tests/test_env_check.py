import json
from types import SimpleNamespace

import pytest

import env_check


def fake_platform(monkeypatch, system, machine, release="6.1.0"):
    monkeypatch.setattr(env_check.platform, "system", lambda: system)
    monkeypatch.setattr(env_check.platform, "machine", lambda: machine)
    monkeypatch.setattr(env_check.platform, "release", lambda: release)


def no_blockers(monkeypatch):
    """Keep needs_setup tests hermetic: real uv/python probes never run."""
    monkeypatch.setattr(env_check, "bootstrap_blockers", lambda: [])
    monkeypatch.setattr(env_check, "find_uv", lambda *a: None)


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
    no_blockers(monkeypatch)
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: False)
    assert env_check._local_support_status("Darwin", "arm64") == "needs_setup"


@pytest.mark.parametrize("system,machine", [("Windows", "AMD64"), ("Darwin", "arm64"), ("Linux", "x86_64")])
def test_cold_machine_without_uv_or_python_reports_blocked(monkeypatch, system, machine):
    fake_platform(monkeypatch, system, machine)
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: False)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: None)
    monkeypatch.setattr(env_check, "bootstrap_blockers", lambda: ["no uv and no Python 3.10-3.12 discovered"])
    assert env_check._local_support_status(system, machine) == "blocked_missing_uv"


def test_intel_mac_unsupported(monkeypatch):
    fake_platform(monkeypatch, "Darwin", "x86_64")
    assert env_check._local_support_status("Darwin", "x86_64") == "unsupported"


def test_windows_amd64_status_matrix(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64")
    no_blockers(monkeypatch)
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
    no_blockers(monkeypatch)
    monkeypatch.setattr(env_check, "_import_ok",
                        lambda module, python=None: module != env_check.QWEN_TORCH_IMPORT)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    report = env_check.probe_backend("qwen")
    assert report["status"] == "needs_setup"
    assert any("qwen_asr" in c for c in report["checks"])


def test_probe_qwen_blocked_reports_actionable_fix(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64")
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: False)
    monkeypatch.setattr(env_check, "bootstrap_blockers", lambda: [
        "no uv and no Python 3.10-3.12 discovered — run.py cannot create its managed venv",
        "fix: `pip install uv` is enough",
    ])
    report = env_check.probe_backend("qwen")
    assert report["status"] == "blocked_missing_uv"
    assert any("pip install uv" in c for c in report["checks"])


def test_probe_unknown_provider_raises():
    with pytest.raises(ValueError):
        env_check.probe_backend("whisper")


# --- detect_environment / format -------------------------------------------------

def test_detect_environment_shape(monkeypatch):
    fake_platform(monkeypatch, "Windows", "AMD64", release="10")
    no_blockers(monkeypatch)
    monkeypatch.setattr(env_check, "_import_ok", lambda module, python=None: True)
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda python=None: True)
    monkeypatch.setattr(env_check, "_available_memory", lambda: 16.0)
    monkeypatch.setattr(env_check, "_free_disk_gb", lambda: 512.0)
    monkeypatch.setattr(env_check, "has_ffmpeg", lambda: True)
    env = env_check.detect_environment(check_local=True)
    assert env["os"] == "Windows"
    assert env["architecture"] == "AMD64"
    assert env["local_support_status"] == "ready"
    assert env["available_memory_gb"] == 16.0
    # Bootstrap preflight rides along with check_local (doc §4, 2026-11-08 postmortem)
    assert env["uv_available"] is False and env["setup_blockers"] == []


def test_detect_environment_skips_preflight_without_check_local():
    env = env_check.detect_environment()
    assert "setup_blockers" not in env and "uv_available" not in env


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


def test_format_env_line_blocked_status_is_actionable():
    env = {"os": "Windows", "architecture": "AMD64", "is_wsl": False, "is_rosetta": False,
           "local_support_status": "blocked_missing_uv"}
    line = env_check.format_env_line(env)
    assert "pip install uv" in line


def test_generic_detection_never_imports_local_packages(monkeypatch):
    monkeypatch.setattr(env_check, "_import_ok", lambda *a: pytest.fail("no backend selected"))
    monkeypatch.setattr(env_check, "_torch_cuda_ok", lambda *a: pytest.fail("no backend selected"))
    assert env_check.detect_environment()["local_support_status"] in ("not_checked", "unsupported")
