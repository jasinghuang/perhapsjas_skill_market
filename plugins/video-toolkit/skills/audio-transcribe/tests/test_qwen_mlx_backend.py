import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import media
from backends.qwen_mlx_backend import (
    DEFAULT_PRECISION,
    MLX_MODELS,
    MLXBackendError,
    QwenMLXBackend,
)


class FakeMLXModule:
    calls = []

    @staticmethod
    def transcribe(audio, model=None, language=None, return_timestamps=False,
                   return_chunks=False, on_progress=None, verbose=False, **extra):
        FakeMLXModule.calls.append({
            "audio": audio, "model": model, "language": language,
            "return_timestamps": return_timestamps, "return_chunks": return_chunks,
        })
        return SimpleNamespace(
            text="你好，世界。",
            language="Chinese",
            words=[
                SimpleNamespace(text="你", start=0.5, end=0.9),
                SimpleNamespace(text="好", start=0.9, end=1.2),
                SimpleNamespace(text="世界。", start=1.4, end=2.0),
            ],
            segments=[],
            chunks=[],
        )


@pytest.fixture
def mlx_fakes(monkeypatch, tmp_path):
    FakeMLXModule.calls = []
    fake = types.ModuleType("mlx_qwen3_asr")
    fake.transcribe = FakeMLXModule.transcribe
    monkeypatch.setitem(sys.modules, "mlx_qwen3_asr", fake)
    media_file = tmp_path / "测试 音频.m4a"
    media_file.write_bytes(b"x" * 16)
    monkeypatch.setattr(media, "probe_media", lambda p: {
        "duration": 12.4, "audio_streams": [{"index": 0, "codec": "aac", "channels": 2}],
    })
    return media_file


def test_default_is_8bit_repo_never_tool_default(mlx_fakes):
    backend = QwenMLXBackend()
    result = backend.transcribe(str(mlx_fakes), language="auto")
    call = FakeMLXModule.calls[0]
    assert call["model"] == MLX_MODELS["8bit"]  # NOT the tool's 0.6B default
    assert "1.7B" in call["model"]
    assert result["model_id"] == MLX_MODELS["8bit"]
    assert result["weight_precision"] == DEFAULT_PRECISION
    assert result["compute_dtype"] == "float16"  # loader converts fp params
    assert result["language"] == "zh"
    assert result["status"] == "complete"


def test_precision_variants_map_to_repos(mlx_fakes):
    QwenMLXBackend(precision="bf16").transcribe(str(mlx_fakes))
    assert FakeMLXModule.calls[-1]["model"] == MLX_MODELS["bf16"]
    QwenMLXBackend(precision="6bit").transcribe(str(mlx_fakes))
    assert FakeMLXModule.calls[-1]["model"] == MLX_MODELS["6bit"]


def test_unknown_precision_rejected():
    with pytest.raises(MLXBackendError):
        QwenMLXBackend(precision="4bit")


def test_language_mapping(mlx_fakes):
    QwenMLXBackend().transcribe(str(mlx_fakes), language="en")
    assert FakeMLXModule.calls[-1]["language"] == "English"
    QwenMLXBackend().transcribe(str(mlx_fakes), language="auto")
    assert FakeMLXModule.calls[-1]["language"] is None


def test_words_mapped_to_unified_schema(mlx_fakes):
    result = QwenMLXBackend().transcribe(str(mlx_fakes))
    assert [w["text"] for w in result["words"]] == ["你", "好", "世界。"]
    assert result["words"][0]["start"] == pytest.approx(0.5)
    assert result["duration_seconds"] == pytest.approx(12.4)
    assert result["provider"] == "qwen" and result["backend"] == "mlx"


def test_segment_fallback_extraction(monkeypatch, mlx_fakes):
    """Older lib versions nest words inside segments — the adapter flattens them."""
    def transcribe(**kwargs):
        FakeMLXModule.calls.append(kwargs)
        return SimpleNamespace(
            text="hello world",
            language="English",
            segments=[SimpleNamespace(words=[SimpleNamespace(text="hello", start=0.1, end=0.4),
                                             SimpleNamespace(text="world", start=0.5, end=0.8)])],
        )

    fake = types.ModuleType("mlx_qwen3_asr")
    fake.transcribe = transcribe
    monkeypatch.setitem(sys.modules, "mlx_qwen3_asr", fake)
    result = QwenMLXBackend().transcribe(str(mlx_fakes))
    assert [w["text"] for w in result["words"]] == ["hello", "world"]


def test_text_without_alignment_is_partial(monkeypatch, mlx_fakes):
    fake = types.ModuleType("mlx_qwen3_asr")
    fake.transcribe = lambda **kw: SimpleNamespace(text="只有文本", language="Chinese", segments=[])
    monkeypatch.setitem(sys.modules, "mlx_qwen3_asr", fake)
    result = QwenMLXBackend().transcribe(str(mlx_fakes))
    assert result["status"] == "partial"
    assert result["text"] == "只有文本"
    assert any("SRT unavailable" in warn for warn in result["warnings"])


def test_progress_passthrough(monkeypatch, mlx_fakes):
    seen = []

    def on_progress(fraction, elapsed, total):
        seen.append((fraction, elapsed, total))

    def transcribe(audio, model=None, language=None, return_timestamps=False,
                   return_chunks=False, on_progress=None, verbose=False, **extra):
        if on_progress:
            on_progress(0.5, 6.2, 12.4)
        return SimpleNamespace(text="ok", language="Chinese",
                               words=[SimpleNamespace(text="ok", start=0.0, end=1.0)])

    fake = types.ModuleType("mlx_qwen3_asr")
    fake.transcribe = transcribe
    monkeypatch.setitem(sys.modules, "mlx_qwen3_asr", fake)
    QwenMLXBackend().transcribe(str(mlx_fakes), on_progress=on_progress)
    assert seen == [(0.5, 6.2, 12.4)]
