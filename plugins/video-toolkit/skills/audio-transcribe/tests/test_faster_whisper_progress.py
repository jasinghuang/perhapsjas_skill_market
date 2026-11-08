from types import SimpleNamespace

from backends.faster_whisper_backend import FasterWhisperBackend


class FakeModel:
    def transcribe(self, path, language=None, beam_size=5, word_timestamps=False):
        segments = iter([
            SimpleNamespace(start=0.0, end=2.0, text=" hello"),
            SimpleNamespace(start=2.0, end=4.0, text=" world"),
        ])
        return segments, SimpleNamespace(language="en", duration=4.0)


def test_reports_progress_per_segment():
    backend = FasterWhisperBackend()
    backend._model = FakeModel()
    seen = []
    result = backend.transcribe("x.mp4", on_progress=lambda f, e, t: seen.append((f, e, t)))
    assert seen == [(0.5, 2.0, 4.0), (1.0, 4.0, 4.0)]
    assert [s["text"] for s in result["segments"]] == ["hello", "world"]


def test_callback_error_does_not_break_transcription():
    backend = FasterWhisperBackend()
    backend._model = FakeModel()

    def boom(*args):
        raise RuntimeError("boom")

    result = backend.transcribe("x.mp4", on_progress=boom)
    assert len(result["segments"]) == 2


def test_segment_times_follow_word_boundaries():
    # Token-level timestamps pin the first segment of a window to its start
    # when it opens on music; word boundaries must win.
    class FakeModelWithWords:
        def transcribe(self, path, language=None, beam_size=5, word_timestamps=False):
            segments = iter([
                SimpleNamespace(
                    start=0.0,
                    end=10.12,
                    text=" Hey there",
                    words=[
                        SimpleNamespace(start=3.74, end=5.0, word=" Hey"),
                        SimpleNamespace(start=5.0, end=10.06, word=" there"),
                    ],
                ),
            ])
            return segments, SimpleNamespace(language="en", duration=12.0)

    backend = FasterWhisperBackend()
    backend._model = FakeModelWithWords()
    result = backend.transcribe("x.mp4")
    assert result["segments"][0] == {"start": 3.74, "end": 10.06, "text": "Hey there"}
