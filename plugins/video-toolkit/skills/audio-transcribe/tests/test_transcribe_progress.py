import skill_main


class FakeBackend:
    def __init__(self):
        self.on_progress = "unset"

    def load_model(self, model_name):
        pass

    def transcribe(self, audio_path, language=None, on_progress=None,
                   condition_on_previous_text=False):
        self.on_progress = on_progress
        if on_progress:
            on_progress(0.5, 5.0, 10.0)
        return {"segments": [{"start": 0.0, "end": 1.0, "text": "hi"}], "language": "en"}


def _run(tmp_path, monkeypatch, show_progress):
    backend = FakeBackend()
    monkeypatch.setattr(skill_main, "get_backend", lambda: backend)
    video = tmp_path / "a.mp4"
    video.write_bytes(b"")
    output = tmp_path / "a.srt"
    skill_main.transcribe(
        video_path=video,
        output_path=output,
        show_progress=show_progress,
    )
    return backend, output


def test_progress_callback_is_wired(tmp_path, monkeypatch, capsys):
    backend, output = _run(tmp_path, monkeypatch, True)
    assert callable(backend.on_progress)
    out = capsys.readouterr().out
    assert "50.0%  0:05 / 0:10" in out
    assert output.exists()


def test_no_progress_disables_callback(tmp_path, monkeypatch, capsys):
    backend, output = _run(tmp_path, monkeypatch, False)
    assert backend.on_progress is None
    assert "%" not in capsys.readouterr().out
    assert output.exists()


def test_finish_precedes_detected_language(tmp_path, monkeypatch, capsys):
    _run(tmp_path, monkeypatch, True)
    out = capsys.readouterr().out
    assert "Detected language: en" in out
    assert out.index("100.0%") < out.index("Detected language: en")


def test_progress_does_not_change_srt_bytes(tmp_path, monkeypatch):
    backend = FakeBackend()
    monkeypatch.setattr(skill_main, "get_backend", lambda: backend)
    video = tmp_path / "a.mp4"
    video.write_bytes(b"")
    on = tmp_path / "on.srt"
    off = tmp_path / "off.srt"

    skill_main.transcribe(video_path=video, output_path=on, show_progress=True)
    skill_main.transcribe(video_path=video, output_path=off, show_progress=False)

    assert on.read_bytes() == off.read_bytes()
