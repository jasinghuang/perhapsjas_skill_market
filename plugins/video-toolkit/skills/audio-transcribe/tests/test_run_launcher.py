import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import run


PY = r"C:\Python314\python.exe" if sys.platform == "win32" else "/usr/local/bin/python3.14"


# --- provider parsing ----------------------------------------------------------

def test_parse_provider_forms():
    assert run.parse_provider(["a.mp4", "--provider", "qwen"]) == "qwen"
    assert run.parse_provider(["a.mp4", "--provider=scribe"]) == "scribe"
    assert run.parse_provider(["a.mp4", "--provider", "qwen-local"]) == "qwen"
    assert run.parse_provider(["a.mp4", "--provider", "elevenlabs"]) == "scribe"
    assert run.parse_provider(["a.mp4", "--provider", "whisper"]) == "whisper"  # unknown passthrough
    assert run.parse_provider(["a.mp4"]) is None


# --- main routing ----------------------------------------------------------------

def test_detect_env_uses_current_interpreter_and_never_installs(monkeypatch):
    calls = []

    def fake_call(cmd):
        calls.append(cmd)
        return 0

    def explode():
        raise AssertionError("must not install in detect-env mode")

    monkeypatch.setattr(run.subprocess, "call", fake_call)
    monkeypatch.setattr(run, "ensure_qwen_interpreter", explode)
    assert run.main(["--detect-env", "--provider", "qwen"]) == 0
    assert calls[0][0] == sys.executable
    assert "--detect-env" in calls[0]


def test_missing_provider_passes_through_for_skill_main_error(monkeypatch):
    calls = []
    monkeypatch.setattr(run.subprocess, "call", lambda cmd: calls.append(cmd) or 2)
    monkeypatch.setattr(run, "ensure_qwen_interpreter", lambda found: pytest.fail("no install"))
    assert run.main(["video.mp4"]) == 2
    assert calls[0][0] == sys.executable


def test_scribe_route_never_installs_anything(monkeypatch):
    calls = []
    monkeypatch.setattr(run.subprocess, "call", lambda cmd: calls.append(cmd) or 0)
    monkeypatch.setattr(run, "ensure_qwen_interpreter", lambda found: pytest.fail("scribe must not install"))
    assert run.main(["video.mp4", "--provider", "scribe"]) == 0
    assert calls[0][0] == sys.executable


def test_qwen_route_uses_discovered_interpreter(monkeypatch):
    calls = []
    monkeypatch.setattr(run, "candidates", lambda: [PY])
    monkeypatch.setattr(run, "ensure_qwen_interpreter", lambda found: PY)
    monkeypatch.setattr(run.subprocess, "call", lambda cmd: calls.append(cmd) or 0)
    monkeypatch.setattr(run, "save_cache", lambda python, provider: None)
    assert run.main(["video.mp4", "--provider", "qwen"]) == 0
    assert calls[0][0] == PY


# --- ensure_qwen_interpreter ---------------------------------------------------------

@pytest.fixture
def win_route(monkeypatch):
    monkeypatch.setattr(run, "IS_MAC", False)


def test_already_installed_reuses_interpreter(monkeypatch, win_route):
    monkeypatch.setattr(run, "has_module", lambda python, module: module == "qwen_asr")
    monkeypatch.setattr(run, "pip_install", lambda *a, **k: pytest.fail("must not install"))
    assert run.ensure_qwen_interpreter([PY]) == PY


def test_gpu_missing_deps_installs_cuda_torch_then_qwen(monkeypatch, win_route, tmp_path):
    installed = {"torch": False, "qwen_asr": False}
    installs = []
    torch_installs = []

    def has_module(python, module):
        return installed.get(module, False)

    def pip_install(python, packages, flags=()):
        installs.append(list(packages))
        if "qwen-asr" in packages:
            installed["qwen_asr"] = True

    def fake_torch_install(cmd, check=True):
        torch_installs.append(cmd)
        installed["torch"] = True

    monkeypatch.setattr(run, "has_module", has_module)
    monkeypatch.setattr(run, "pip_install", pip_install)
    monkeypatch.setattr(run.subprocess, "run", fake_torch_install)
    monkeypatch.setattr(run, "nvidia_gpu_present", lambda: True)
    monkeypatch.setattr(run, "torch_cuda_build", lambda python: "")

    chosen = run.ensure_qwen_interpreter([PY])
    assert chosen == PY
    # CUDA torch install is forced (a CPU build already satisfies plain `torch`)
    assert torch_installs[0][1:] == [
        "-m", "pip", "install", "--force-reinstall", "--no-deps",
        "torch", "--index-url", "https://download.pytorch.org/whl/cu130",
    ]
    assert installs == [["qwen-asr", "zhconv"]]


def test_torch_index_env_override(monkeypatch, win_route):
    installed = {"qwen_asr": False}
    torch_installs = []
    monkeypatch.setenv("AUDIO_TRANSCRIBE_TORCH_INDEX", "cu126")
    monkeypatch.setattr(run, "has_module", lambda p, m: installed.get(m, False))
    monkeypatch.setattr(run, "pip_install",
                        lambda python, packages, flags=(): installed.update({"qwen_asr": True}))
    monkeypatch.setattr(run.subprocess, "run", lambda cmd, check=True: torch_installs.append(cmd))
    monkeypatch.setattr(run, "nvidia_gpu_present", lambda: True)
    monkeypatch.setattr(run, "torch_cuda_build", lambda python: "")
    run.ensure_qwen_interpreter([PY])
    assert torch_installs[0][-1] == "https://download.pytorch.org/whl/cu126"


def test_no_gpu_skips_cuda_torch(monkeypatch, win_route):
    installed = {"qwen_asr": False}
    installs = []
    monkeypatch.setattr(run, "has_module", lambda p, m: installed.get(m, False))
    monkeypatch.setattr(run, "pip_install",
                        lambda python, packages, flags=(): installs.append(list(packages)) or installed.update({"qwen_asr": True}))
    monkeypatch.setattr(run, "nvidia_gpu_present", lambda: False)
    chosen = run.ensure_qwen_interpreter([PY])
    assert installs == [["qwen-asr", "zhconv"]]


def test_cuda_torch_already_present_not_reinstalled(monkeypatch, win_route):
    installed = {"torch": True, "qwen_asr": False}
    installs = []
    monkeypatch.setattr(run, "has_module", lambda p, m: installed.get(m, False))
    monkeypatch.setattr(run, "pip_install",
                        lambda python, packages, flags=(): installs.append(list(packages)) or installed.update({"qwen_asr": True}))
    monkeypatch.setattr(run, "nvidia_gpu_present", lambda: True)
    monkeypatch.setattr(run, "torch_cuda_build", lambda python: "13.0")
    run.ensure_qwen_interpreter([PY])
    assert installs == [["qwen-asr", "zhconv"]]


def test_mac_route_installs_mlx_package(monkeypatch):
    monkeypatch.setattr(run, "IS_MAC", True)
    installed = {"mlx_qwen3_asr": False}
    installs = []
    monkeypatch.setattr(run, "has_module", lambda p, m: installed.get(m, False))
    monkeypatch.setattr(run, "pip_install",
                        lambda python, packages, flags=(): installs.append((list(packages), list(flags))) or installed.update({"mlx_qwen3_asr": True}))
    monkeypatch.setattr(run, "nvidia_gpu_present", lambda: False)  # must not be consulted on mac
    run.ensure_qwen_interpreter([PY])
    assert installs[0][0] == ["mlx-qwen3-asr", "zhconv"]
    assert installs[0][1] == ["--break-system-packages"]


def test_install_failure_exits_with_manual_hint(monkeypatch, win_route, capsys):
    def pip_install(python, packages, flags=()):
        raise RuntimeError("no network")

    monkeypatch.setattr(run, "has_module", lambda p, m: False)
    monkeypatch.setattr(run, "pip_install", pip_install)
    monkeypatch.setattr(run, "nvidia_gpu_present", lambda: False)
    with pytest.raises(SystemExit) as excinfo:
        run.ensure_qwen_interpreter([PY])
    assert "Manual install" in str(excinfo.value.code)
