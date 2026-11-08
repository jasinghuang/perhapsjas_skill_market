import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import run

PY = '/isolated/bin/python'


def test_parse_provider_forms():
    assert run.parse_provider(['a.mp4', '--provider', 'qwen-local']) == 'qwen'
    assert run.parse_provider(['--provider=elevenlabs']) == 'scribe'
    assert run.parse_provider(['a.mp4']) is None


@pytest.mark.parametrize('args', [['--detect-env', '--provider', 'qwen'], ['--help', '--provider', 'qwen'], ['video.mp4'], ['video.mp4', '--provider', 'scribe']])
def test_readonly_or_online_never_installs(monkeypatch, tmp_path, args):
    calls = []
    monkeypatch.setattr(run, 'managed_interpreter', lambda: tmp_path / 'missing')
    monkeypatch.setattr(run, 'ensure_qwen_interpreter', lambda *a: pytest.fail('must not install'))
    monkeypatch.setattr(run.subprocess, 'call', lambda cmd: calls.append(cmd) or 0)
    assert run.main(args) == 0
    assert calls[0][0] == sys.executable


def test_detection_uses_existing_managed_runtime(monkeypatch, tmp_path):
    py = tmp_path / 'python'; py.touch()
    monkeypatch.setattr(run, 'managed_interpreter', lambda: py)
    calls = []
    monkeypatch.setattr(run.subprocess, 'call', lambda cmd: calls.append(cmd) or 0)
    run.main(['--detect-env', '--provider', 'qwen'])
    assert calls[0][0] == str(py)


def test_qwen_launches_in_managed_runtime(monkeypatch):
    calls = []
    monkeypatch.setattr(run, 'candidates', lambda: ['/global/python'])
    monkeypatch.setattr(run, 'ensure_qwen_interpreter', lambda found: PY)
    monkeypatch.setattr(run.subprocess, 'call', lambda cmd: calls.append(cmd) or 0)
    assert run.main(['video.mp4', '--provider', 'qwen']) == 0
    assert calls[0][0] == PY


@pytest.mark.parametrize('gpu,cuda_build', [(True, ''), (True, '13.0'), (False, '')])
def test_windows_installs_only_managed_and_checks_cuda_even_if_qwen_present(monkeypatch, gpu, cuda_build):
    installs = []
    monkeypatch.setattr(run, 'IS_MAC', False)
    monkeypatch.setattr(run, 'prepare_venv', lambda found: PY)
    monkeypatch.setattr(run, 'has_module', lambda *a: True)
    monkeypatch.setattr(run, 'nvidia_gpu_present', lambda: gpu)
    monkeypatch.setattr(run, 'torch_cuda_build', lambda p: cuda_build)
    monkeypatch.setattr(run.shutil, 'which', lambda _: None)
    def execute(cmd, **kwargs):
        if 'install' in cmd: installs.append(cmd)
        return SimpleNamespace(stdout='2.10.0\n2.10.0\n' if 'torchaudio' in str(cmd) and 'install' not in cmd else '0.0.6\n', returncode=0)
    monkeypatch.setattr(run.subprocess, 'run', execute)
    assert run.ensure_qwen_interpreter(['/global/python']) == PY
    assert all(cmd[0] == PY for cmd in installs)
    if gpu and not cuda_build:
        assert installs and installs[0][-1].endswith('/cu130')
        assert '--force-reinstall' in installs[0]
    else:
        assert not installs


def test_mac_pins_package_in_venv_without_global_flags(monkeypatch):
    installs = []
    monkeypatch.setattr(run, 'IS_MAC', True)
    monkeypatch.setattr(run.platform, 'machine', lambda: 'arm64')
    monkeypatch.setattr(run, 'prepare_venv', lambda found: PY)
    monkeypatch.setattr(run, 'has_module', lambda *a: True)
    monkeypatch.setattr(run.shutil, 'which', lambda _: None)
    def execute(cmd, **kwargs):
        if 'install' in cmd: installs.append(cmd)
        return SimpleNamespace(stdout='0.1.0', returncode=0)
    monkeypatch.setattr(run.subprocess, 'run', execute)
    run.ensure_qwen_interpreter(['/global/python'])
    assert installs == [[PY, '-m', 'pip', 'install', 'mlx-qwen3-asr==0.4.4']]
