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


def test_parse_uv_path_forms():
    assert run.parse_uv_path(['--uv-path', 'C:/tools/uv.exe', 'a.mp4']) == ('C:/tools/uv.exe', ['a.mp4'])
    assert run.parse_uv_path(['a.mp4', '--uv-path=C:/tools/uv.exe']) == ('C:/tools/uv.exe', ['a.mp4'])
    assert run.parse_uv_path(['a.mp4']) == (None, ['a.mp4'])


@pytest.mark.parametrize('args', [['--detect-env', '--provider', 'qwen'], ['--help', '--provider', 'qwen'], ['video.mp4'], ['video.mp4', '--provider', 'scribe']])
def test_readonly_or_online_never_installs(monkeypatch, tmp_path, args):
    calls = []
    monkeypatch.setattr(run, 'managed_interpreter', lambda: tmp_path / 'missing')
    monkeypatch.setattr(run, 'ensure_qwen_interpreter', lambda *a: pytest.fail('must not install'))
    monkeypatch.setattr(run.subprocess, 'call', lambda cmd: calls.append(cmd) or 0)
    assert run.main(args) == 0
    assert calls[0][0] == sys.executable


def test_uv_path_is_launcher_only_and_never_forwarded(monkeypatch):
    forwarded = []
    monkeypatch.setattr(run.subprocess, 'call', lambda cmd: forwarded.append(cmd) or 0)
    run.main(['video.mp4', '--provider', 'scribe', '--uv-path', 'C:/tools/uv.exe'])
    assert '--uv-path' not in forwarded[0] and 'C:/tools/uv.exe' not in forwarded[0]


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
    monkeypatch.setattr(run, 'ensure_qwen_interpreter', lambda *a: PY)
    monkeypatch.setattr(run.subprocess, 'call', lambda cmd: calls.append(cmd) or 0)
    assert run.main(['video.mp4', '--provider', 'qwen']) == 0
    assert calls[0][0] == PY


@pytest.mark.parametrize('gpu,cuda_build', [(True, ''), (True, '13.0'), (False, '')])
def test_windows_installs_only_managed_and_checks_cuda_even_if_qwen_present(monkeypatch, gpu, cuda_build):
    installs = []
    monkeypatch.setattr(run, 'IS_MAC', False)
    monkeypatch.setattr(run, 'prepare_venv', lambda *a: PY)
    monkeypatch.setattr(run, 'has_module', lambda *a: True)
    monkeypatch.setattr(run, 'nvidia_gpu_present', lambda: gpu)
    monkeypatch.setattr(run, 'torch_cuda_build', lambda p: cuda_build)
    monkeypatch.setattr(run, 'find_uv', lambda *a: None)
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


def test_cuda_first_install_warns_about_download_size(monkeypatch, capsys):
    monkeypatch.setattr(run, 'IS_MAC', False)
    monkeypatch.setattr(run, 'prepare_venv', lambda *a: PY)
    monkeypatch.setattr(run, 'has_module', lambda p, m: m != 'torch')
    monkeypatch.setattr(run, 'nvidia_gpu_present', lambda: True)
    monkeypatch.setattr(run, 'torch_cuda_build', lambda p: '')
    monkeypatch.setattr(run, 'find_uv', lambda *a: None)
    monkeypatch.setattr(run.subprocess, 'run', lambda cmd, **kw: SimpleNamespace(stdout='', returncode=0))
    run.ensure_qwen_interpreter(['/global/python'])
    assert '1.7 GiB' in capsys.readouterr().out


def test_prepare_venv_uses_module_uv_without_path(monkeypatch, tmp_path):
    monkeypatch.setattr(run, 'managed_interpreter', lambda: tmp_path / 'env' / 'python')
    monkeypatch.setattr(run, 'IS_MAC', False)
    monkeypatch.setattr(run, 'find_uv', lambda *a: [sys.executable, '-m', 'uv'])
    commands = []
    monkeypatch.setattr(run.subprocess, 'run', lambda cmd, **kw: commands.append(cmd) or SimpleNamespace(returncode=0))
    run.prepare_venv(['/global/python'])
    assert commands[0][:4] == [sys.executable, '-m', 'uv', 'venv']
    assert commands[0][4:6] == ['--python', '3.12']


def test_prepare_venv_blocked_message_is_actionable(monkeypatch, tmp_path):
    monkeypatch.setattr(run, 'managed_interpreter', lambda: tmp_path / 'env' / 'python')
    monkeypatch.setattr(run, 'find_uv', lambda *a: None)
    monkeypatch.setattr(run, 'usable_system_python', lambda: None)
    with pytest.raises(SystemExit) as exc:
        run.prepare_venv([])
    message = str(exc.value)
    assert 'pip install uv' in message
    assert '无需手动改 PATH' in message or 'PATH' in message
    assert 'uv 会自动下载并管理 Python 3.12' in message


def test_mac_pins_package_in_venv_without_global_flags(monkeypatch):
    installs = []
    monkeypatch.setattr(run, 'IS_MAC', True)
    monkeypatch.setattr(run.platform, 'machine', lambda: 'arm64')
    monkeypatch.setattr(run, 'prepare_venv', lambda *a: PY)
    monkeypatch.setattr(run, 'has_module', lambda *a: True)
    monkeypatch.setattr(run, 'find_uv', lambda *a: None)
    def execute(cmd, **kwargs):
        if 'install' in cmd: installs.append(cmd)
        return SimpleNamespace(stdout='0.1.0', returncode=0)
    monkeypatch.setattr(run.subprocess, 'run', execute)
    run.ensure_qwen_interpreter(['/global/python'])
    assert installs == [[PY, '-m', 'pip', 'install', 'mlx-qwen3-asr==0.4.4']]
