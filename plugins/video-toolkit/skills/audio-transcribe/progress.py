"""Throttled transcription progress display."""

import sys
import time
from typing import Optional


def format_clock(seconds: float) -> str:
    """Format seconds as M:SS, or H:MM:SS once past one hour."""
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


class ProgressReporter:
    """Print at most one progress line per `interval` seconds."""

    def __init__(self, stream=None, clock=None, interval: float = 2.0):
        self._stream = stream if stream is not None else sys.stdout
        self._clock = clock if clock is not None else time.monotonic
        self._interval = interval
        self._last_emit: Optional[float] = None
        self._last_fraction = 0.0
        self._total: Optional[float] = None

    def update(
        self,
        fraction: float,
        elapsed_seconds: float,
        total_seconds: Optional[float],
    ) -> None:
        if total_seconds is None or total_seconds <= 0:
            return

        self._total = total_seconds
        fraction = min(max(fraction, 0.0), 1.0)
        now = self._clock()
        should_print = (
            self._last_emit is None
            or now - self._last_emit >= self._interval
            or fraction >= 1.0
        )
        if not should_print:
            return

        self._print_line(fraction, elapsed_seconds, total_seconds)
        self._last_emit = now
        self._last_fraction = fraction

    def finish(self) -> None:
        if self._total is None or self._last_fraction >= 1.0:
            return
        self._print_line(1.0, self._total, self._total)
        self._last_fraction = 1.0

    def _print_line(
        self,
        fraction: float,
        elapsed_seconds: float,
        total_seconds: float,
    ) -> None:
        line = (
            f"  {fraction * 100:5.1f}%  "
            f"{format_clock(elapsed_seconds)} / {format_clock(total_seconds)}"
        )
        try:
            print(line, file=self._stream, flush=True)
        except Exception:
            pass
