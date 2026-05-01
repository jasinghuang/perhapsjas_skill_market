# Audio Transcribe Cross-Platform Design

Rename `mlx-whisper` skill to `audio-transcribe` and add Windows support via `faster-whisper` with CUDA acceleration.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Skill name | `audio-transcribe` | Platform-agnostic, describes the function |
| Win fallback | CUDA first, CPU (int8) fallback | Covers both GPU and non-GPU Windows users |
| Model options | Platform-specific lists | Each platform shows its best available models |
| Code architecture | Multi-file backend | `skill_main.py` + `backends/` with per-platform implementations |
| Platform detection | In SKILL.md + auto in script | SKILL.md branches for UI, script auto-detects for safety |
| CUDA detection | `device="auto"` in faster-whisper | Let the library handle it; no torch dependency needed |

## File Structure

```
skills/audio-transcribe/                  ← renamed from mlx-whisper
  SKILL.md                                ← platform detection + dual UI + unified commands
  skill_main.py                           ← entry point, backend dispatch, output formatting
  backends/
    __init__.py                           ← TranscriptionBackend ABC + get_backend() factory
    mlx_backend.py                        ← Mac: mlx_whisper wrapper (extracted from existing code)
    faster_whisper_backend.py             ← Win: faster-whisper wrapper (new)
```

## Platform Detection (SKILL.md)

```
Step 0: Detect platform
- Run: python -c "import platform; print(platform.system())"
- Darwin → Mac (mlx-whisper backend)
- Windows → Win (faster-whisper backend)
```

### Dependency Check

**Mac**:
- Check: `python3 -c "import mlx_whisper"` → install: `pip3 install --break-system-packages mlx-whisper zhconv`
- Check: `ffmpeg -version` → install: `brew install ffmpeg`

**Windows**:
- Check: `python -c "from faster_whisper import WhisperModel"` → install: `pip install faster-whisper zhconv`
- No external ffmpeg needed (PyAV bundled)
- CUDA auto-detected by faster-whisper `device="auto"`

### Model Selection (AskUserQuestion)

**Mac models**: small / large-v3-turbo / large-v3

**Windows models**: small / medium / large-v3

### Output Format (AskUserQuestion, unchanged)

Markdown / SRT / Markdown + timestamps

### Invocation (unchanged)

```
python ${CLAUDE_PLUGIN_ROOT}/skills/audio-transcribe/skill_main.py <input> --model <choice> --format <choice> [--keep-timestamps]
```

`--backend` is auto-detected by `skill_main.py`, not user-facing.

## Backend Interface

```python
# backends/__init__.py
from abc import ABC, abstractmethod

class TranscriptionBackend(ABC):
    @abstractmethod
    def load_model(self, model_name: str) -> None: ...

    @abstractmethod
    def transcribe(self, audio_path: str, language: str = None) -> dict:
        # Returns: {"segments": [{"start": float, "end": float, "text": str}], "language": str, "duration": float}
        ...

def get_backend() -> TranscriptionBackend:
    import platform
    if platform.system() == "Darwin":
        from .mlx_backend import MLXBackend
        return MLXBackend()
    else:
        from .faster_whisper_backend import FasterWhisperBackend
        return FasterWhisperBackend()
```

### MLX Backend (Mac, extracted from existing skill_main.py)

- Model mapping: `{"small": "mlx-community/whisper-small-mlx", "large-v3-turbo": "mlx-community/whisper-large-v3-turbo", "large-v3": "mlx-community/whisper-large-v3-mlx"}`
- `load_model()`: no-op (mlx-whisper loads per-call via `path_or_hf_repo`)
- `transcribe()`: calls `mlx_whisper.transcribe(audio_path, path_or_hf_repo=repo)`, normalizes return dict

### Faster-Whisper Backend (Windows, new)

- Model mapping: `{"small": "small", "medium": "medium", "large-v3": "large-v3"}` (faster-whisper auto-downloads from HF)
- `load_model()`: `WhisperModel(model_size, device="auto", compute_type="default")`
  - CUDA available → uses GPU with float16
  - No CUDA → uses CPU with int8
- `transcribe()`:
  - `segments, info = model.transcribe(audio_path, beam_size=5)`
  - `segments = list(segments)` (generator → list)
  - Normalize to `{"segments": [{"start": s.start, "end": s.end, "text": s.text}], "language": info.language, "duration": info.duration}`
- No ffmpeg dependency (PyAV bundled)

## skill_main.py (Unified Entry Point)

Preserved from existing code:
- CLI argument parser (input, --output, --model, --language, --format, --keep-timestamps)
- `format_timestamp()`, `segments_to_srt()`, `segments_to_md()`, `merge_segments_to_paragraphs()`
- `convert_to_simplified_chinese()` via zhconv
- Output file writing
- The "Suggest using text-refine skill for calibration" notice in MD output

Changed:
- Replace direct `mlx_whisper` calls with backend abstraction
- Remove inline model loading / transcription logic → delegate to backend
- Remove `ensure_config()` / `load_config()` → keep for backward compat but simplify

## Error Handling

| Scenario | Handling |
|----------|----------|
| faster-whisper import fails (Win) | Auto `pip install faster-whisper zhconv` |
| CUDA not available | Print warning, fall back to CPU int8, inform user |
| CUDA libraries missing (cuBLAS/cuDNN) | Catch ctranslate2 error, show install instructions + link to faster-whisper README |
| Input file not found | Error exit (unchanged) |
| Model download failure | Network error message, suggest retry (unchanged) |

## Files to Update (References)

| File | Change |
|------|--------|
| `.claude-plugin/marketplace.json` | `./skills/mlx-whisper` → `./skills/audio-transcribe` |
| `skills/video-downloader/SKILL.md` | Pipeline reference update |
| `skills/text-refine/SKILL.md` | Pipeline reference update |
| `README.md` | All mlx-whisper references, dependencies, workflow diagram |

## Git Strategy

- `git mv skills/mlx-whisper skills/audio-transcribe` to preserve history
- Add `backends/` directory with new files
- Update all referencing files
- Single commit for all changes

## Out of Scope

- Linux support (not requested, but architecture supports it naturally)
- Batched transcription mode (can be added later)
- VAD filter configuration (can be added later)
- Word-level timestamps (can be added later)
- Multi-GPU support
- GUI or interactive mode beyond AskUserQuestion
