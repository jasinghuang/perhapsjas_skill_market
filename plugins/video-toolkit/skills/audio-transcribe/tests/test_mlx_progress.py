import sys

import tqdm

from backends.mlx_backend import (
    _ProgressTqdm,
    _install_progress_hook,
    _restore_progress_hook,
)


def test_proxy_reports_fraction_elapsed_and_total():
    seen = []
    bar = _ProgressTqdm(total=1000, callback=lambda f, e, t: seen.append((f, e, t)))
    bar.update(250)
    bar.update(250)
    assert seen == [(0.0, 0.0, 10.0), (0.25, 2.5, 10.0), (0.5, 5.0, 10.0)]


def test_proxy_ignores_unknown_total():
    seen = []
    bar = _ProgressTqdm(total=None, callback=lambda f, e, t: seen.append((f, e, t)))
    bar.update(10)
    assert seen == []


def test_proxy_swallows_callback_errors():
    def boom(*args):
        raise RuntimeError("boom")

    bar = _ProgressTqdm(total=100, callback=boom)
    bar.update(50)  # must not raise


def test_hook_replaces_and_restores_tqdm():
    original = tqdm.tqdm
    seen = []
    restore = _install_progress_hook(lambda f, e, t: seen.append((f, e, t)))
    try:
        assert tqdm.tqdm is not original
        with tqdm.tqdm(total=100) as bar:
            bar.update(50)
        assert seen == [(0.0, 0.0, 1.0), (0.5, 0.5, 1.0)]
    finally:
        _restore_progress_hook(restore)
    assert tqdm.tqdm is original


def test_transcribe_survives_hook_install_failure(monkeypatch):
    class FakeWhisper:
        @staticmethod
        def transcribe(path, **kwargs):
            return {
                "language": "en",
                "segments": [{"start": 0.0, "end": 1.0, "text": " hi"}],
            }

    monkeypatch.setitem(sys.modules, "mlx_whisper", FakeWhisper)
    monkeypatch.setitem(sys.modules, "tqdm", None)  # import tqdm -> ImportError

    from backends.mlx_backend import MLXBackend

    backend = MLXBackend()
    backend._repo = "fake"
    result = backend.transcribe("x.mp4", on_progress=lambda *args: None)
    assert result["segments"][0]["text"] == "hi"


def test_hook_falls_back_for_iterable_input():
    seen = []
    original = _install_progress_hook(lambda f, e, t: seen.append((f, e, t)))
    try:
        with tqdm.tqdm(iter([1, 2, 3])) as bar:
            list(bar)
    finally:
        _restore_progress_hook(original)
    assert seen == []


def test_proxy_tolerates_extra_tqdm_methods():
    bar = _ProgressTqdm(total=100, callback=lambda *args: None)
    bar.set_description("test")
    bar.close()
    bar.refresh()
    assert bar.n == 0


def test_transcribe_without_callback_silences_library_bar(monkeypatch, capsys):
    import tqdm as tqdm_module

    class FakeWhisper:
        @staticmethod
        def transcribe(path, **kwargs):
            with tqdm_module.tqdm(total=100, unit="frames") as bar:
                bar.update(100)
            return {"language": "en", "segments": []}

    monkeypatch.setitem(sys.modules, "mlx_whisper", FakeWhisper)

    from backends.mlx_backend import MLXBackend

    backend = MLXBackend()
    backend._repo = "fake"
    backend.transcribe("x.mp4", on_progress=None)

    captured = capsys.readouterr()
    assert "%|" not in captured.err
    assert "%|" not in captured.out


def test_hook_restored_when_transcribe_raises(monkeypatch):
    import tqdm as tqdm_module

    class ExplodingWhisper:
        @staticmethod
        def transcribe(path, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setitem(sys.modules, "mlx_whisper", ExplodingWhisper)

    from backends.mlx_backend import MLXBackend

    original = tqdm_module.tqdm
    backend = MLXBackend()
    backend._repo = "fake"
    try:
        backend.transcribe("x.mp4", on_progress=lambda *args: None)
    except RuntimeError:
        pass
    assert tqdm_module.tqdm is original
