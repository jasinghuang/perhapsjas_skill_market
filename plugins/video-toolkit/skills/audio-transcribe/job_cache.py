"""Content-addressed working files in the application cache, never beside media."""
import hashlib
import importlib.metadata
import json
import os
import platform
import tempfile
from pathlib import Path


def cache_root():
    override = os.environ.get("AUDIO_TRANSCRIBE_CACHE")
    if override:
        return Path(override).expanduser()
    if platform.system() == "Darwin":
        base = Path.home() / "Library" / "Caches"
    elif platform.system() == "Windows":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "video-toolkit" / "audio-transcribe"


def content_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def job_directory(path, backend, language, options):
    versions = {}
    packages = ("mlx-qwen3-asr", "mlx") if backend.backend == "mlx" else (("qwen-asr", "torch") if backend.backend == "torch" else ())
    for package in packages:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            pass
    from backends.qwen_torch_backend import cached_revision
    model = getattr(backend, "model_id", "Qwen/Qwen3-ASR-1.7B")
    identity = {"schema": 3, "preprocessing": "16k-mono-origin-v1", "source": content_hash(path), "track": options.get("audio_track"),
                "backend": backend.backend, "provider": backend.provider, "model": model,
                "revision": (getattr(backend, "_model_revision", None) or cached_revision(model)) if backend.provider == "qwen" else None,
                "aligner_revision": cached_revision("Qwen/Qwen3-ForcedAligner-0.6B") if backend.provider == "qwen" else None,
                "language": language, "versions": versions,
                "precision": getattr(backend, "precision", None),
                "device": getattr(backend, "_requested_device", None), "diarize": options.get("diarize", False)}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    directory = cache_root() / "jobs" / key
    directory.mkdir(parents=True, exist_ok=True)
    write_json(directory / "manifest.json", identity)
    return directory


def write_json(path, data):
    path = Path(path)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
        name = f.name
        json.dump(data, f, ensure_ascii=False)
    try:
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


class JobLock:
    """OS releases the lock on crashes; jobs fail fast, publication waits briefly."""
    def __init__(self, directory, blocking=False):
        self.path = directory / "job.lock"
        self.blocking = blocking

    def __enter__(self):
        self.file = self.path.open("a+b")
        try:
            if platform.system() == "Windows":
                import msvcrt
                self.file.write(b"0")
                self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_LOCK if self.blocking else msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | (0 if self.blocking else fcntl.LOCK_NB))
        except BaseException:
            self.file.close()
            raise
        return self

    def __exit__(self, *args):
        self.file.close()
