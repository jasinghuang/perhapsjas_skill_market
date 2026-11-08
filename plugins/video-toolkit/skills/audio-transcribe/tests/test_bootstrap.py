import sys
from pathlib import Path
from types import SimpleNamespace

import bootstrap


def test_find_uv_prefers_explicit_override(monkeypatch, tmp_path):
    uv_exe = tmp_path / "uv.exe"; uv_exe.write_text("")
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: "/on/path/uv")
    assert bootstrap.find_uv(str(uv_exe)) == [str(uv_exe)]


def test_find_uv_reads_env_var(monkeypatch, tmp_path):
    uv_exe = tmp_path / "uv.exe"; uv_exe.write_text("")
    monkeypatch.setenv(bootstrap.UV_ENV_VAR, str(uv_exe))
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: None)
    monkeypatch.setattr(bootstrap, "_uv_exes", lambda: [])
    monkeypatch.setattr(bootstrap, "_uv_version_ok", lambda cmd: False)
    assert bootstrap.find_uv() == [str(uv_exe)]


def test_find_uv_falls_back_to_python_m_uv(monkeypatch):
    """pip-installed uv is never on PATH — `python -m uv` must be discovered."""
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: None)
    monkeypatch.setattr(bootstrap, "_uv_exes", lambda: [])
    monkeypatch.setattr(bootstrap, "_module_uv_commands", lambda: [[sys.executable, "-m", "uv"]])
    monkeypatch.setattr(bootstrap, "_uv_version_ok", lambda cmd: True)
    assert bootstrap.find_uv() == [sys.executable, "-m", "uv"]


def test_module_uv_probes_path_python_too(monkeypatch):
    """Detection inside the managed venv must still find a system-wide pip uv."""
    path_python = "C:/Python314/python.exe"
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: path_python)
    monkeypatch.setattr(bootstrap.sys, "executable", "C:/venv/Scripts/python.exe")
    commands = bootstrap._module_uv_commands()
    assert commands[0] == ["C:/venv/Scripts/python.exe", "-m", "uv"]
    assert commands[1] == [path_python, "-m", "uv"]


def test_find_uv_checks_user_scripts_dir(monkeypatch, tmp_path):
    """pip user install lands in site userscripts, off PATH (2026-11-08 case)."""
    uv_exe = tmp_path / "uv.exe"; uv_exe.write_text("")
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: None)
    monkeypatch.setattr(bootstrap, "_uv_exes", lambda: [uv_exe])
    monkeypatch.setattr(bootstrap, "_uv_version_ok", lambda cmd: False)
    assert bootstrap.find_uv() == [str(uv_exe)]


def test_find_uv_missing(monkeypatch):
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: None)
    monkeypatch.setattr(bootstrap, "_uv_exes", lambda: [])
    monkeypatch.setattr(bootstrap, "_uv_version_ok", lambda cmd: False)
    assert bootstrap.find_uv() is None


def test_candidates_parses_py_launcher_listing_with_spaces(monkeypatch):
    listing = (
        " -V:3.14 *       C:\\Python314\\python.exe\r\n"
        " -V:3.12         C:\\Program Files\\Python312\\python.exe\r\n"
    )
    monkeypatch.setattr(bootstrap, "IS_WIN", True)
    monkeypatch.setattr(bootstrap.subprocess, "run",
                        lambda cmd, **kw: SimpleNamespace(returncode=0, stdout=listing))
    monkeypatch.setattr(bootstrap.shutil, "which", lambda _: None)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)

    def fake_add(out, seen, path):  # skip is_file checks: fake paths don't exist
        if path and str(path) not in seen:
            seen.add(str(path))
            out.append(str(path))

    monkeypatch.setattr(bootstrap, "_add", fake_add)
    found = bootstrap.candidates()
    assert "C:\\Program Files\\Python312\\python.exe" in found
    assert found.index("C:\\Program Files\\Python312\\python.exe") > found.index("C:\\Python314\\python.exe")


def test_usable_system_python_skips_unsupported_versions(monkeypatch):
    monkeypatch.setattr(bootstrap, "candidates", lambda: ["/py/3.14", "/py/3.12"])
    monkeypatch.setattr(bootstrap, "supported_python",
                        lambda p: p.endswith("3.12"))
    assert bootstrap.usable_system_python() == "/py/3.12"


def test_bootstrap_blockers_empty_when_managed_env_exists(monkeypatch, tmp_path):
    py = tmp_path / "envs" / "audio-transcribe-torch-v2" / "python"; py.parent.mkdir(parents=True); py.write_text("")
    monkeypatch.setattr(bootstrap, "managed_interpreter", lambda: py)
    assert bootstrap.bootstrap_blockers() == []


def test_bootstrap_blockers_empty_when_uv_found(monkeypatch):
    monkeypatch.setattr(bootstrap, "managed_interpreter", lambda: Path("/missing"))
    monkeypatch.setattr(bootstrap, "find_uv", lambda: ["/opt/uv"])
    assert bootstrap.bootstrap_blockers() == []


def test_bootstrap_blockers_actionable_when_nothing_found(monkeypatch):
    monkeypatch.setattr(bootstrap, "managed_interpreter", lambda: Path("/missing"))
    monkeypatch.setattr(bootstrap, "find_uv", lambda: None)
    monkeypatch.setattr(bootstrap, "usable_system_python", lambda: None)
    blockers = bootstrap.bootstrap_blockers()
    assert any("pip install uv" in b for b in blockers)
    assert any("Python 3.12" in b for b in blockers)
