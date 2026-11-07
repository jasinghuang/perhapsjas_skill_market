import pytest

from progress import ProgressReporter, format_clock


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_format_clock_under_one_hour():
    assert format_clock(0) == "0:00"
    assert format_clock(150) == "2:30"


def test_format_clock_with_hours():
    assert format_clock(3661) == "1:01:01"


def test_update_prints_percentage_and_clocks(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.421, 553.0, 1325.0)
    out = capsys.readouterr().out
    assert " 42.1%  9:13 / 22:05" in out


def test_first_update_prints_even_at_zero(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.0, 0.0, 10.0)
    assert "  0.0%  0:00 / 0:10" in capsys.readouterr().out


def test_updates_are_throttled(capsys):
    clock = FakeClock()
    reporter = ProgressReporter(stream=None, clock=clock, interval=2.0)
    reporter.update(0.10, 10.0, 100.0)
    reporter.update(0.20, 20.0, 100.0)
    clock.now = 2.1
    reporter.update(0.30, 30.0, 100.0)
    out = capsys.readouterr().out
    assert out.count("%") == 2
    assert "10.0%" in out
    assert "30.0%" in out


def test_finish_prints_100_percent(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.5, 50.0, 100.0)
    reporter.finish()
    out = capsys.readouterr().out
    assert "100.0%  1:40 / 1:40" in out


def test_finish_does_not_duplicate_100_percent(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(1.0, 100.0, 100.0)
    reporter.finish()
    assert capsys.readouterr().out.count("100.0%") == 1


@pytest.mark.parametrize("total", [None, 0, 0.0])
def test_unknown_or_zero_total_prints_nothing(capsys, total):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.5, 50.0, total)
    reporter.finish()
    assert capsys.readouterr().out == ""


class BrokenStream:
    def write(self, *args):
        raise BrokenPipeError("closed")

    def flush(self):
        raise BrokenPipeError("closed")


def test_reporter_never_raises_on_broken_stream():
    reporter = ProgressReporter(stream=BrokenStream())
    reporter.update(0.5, 50.0, 100.0)  # must not raise
    reporter.finish()  # must not raise


def test_duplicate_100_percent_is_suppressed(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(1.0, 100.0, 100.0)
    reporter.update(1.0, 101.0, 100.0)
    assert capsys.readouterr().out.count("100.0%") == 1


def test_elapsed_is_clamped_to_total(capsys):
    reporter = ProgressReporter(stream=None)
    reporter.update(0.5, 150.0, 100.0)
    out = capsys.readouterr().out
    assert "1:40 / 1:40" in out
    assert "2:30" not in out
