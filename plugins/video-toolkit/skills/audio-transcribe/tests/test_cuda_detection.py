import sys
from types import SimpleNamespace

from backends.faster_whisper_backend import FasterWhisperBackend


class FakeCtranslate2:
    def __init__(self, device_count=0, device_name="RTX 4070"):
        self.device_count = device_count
        self.device_name = device_name

    def get_cuda_device_count(self):
        return self.device_count

    def get_device_property(self, index):
        return {"name": self.device_name}


class Ctranslate2WithoutDeviceProperty:
    """Mirrors ctranslate2 4.7.x, which ships no get_device_property."""

    def get_cuda_device_count(self):
        return 1


class RecordingWhisperModel:
    instances = []

    def __init__(self, model_name, device="cpu", compute_type="int8", **kwargs):
        self.args = {"model_name": model_name, "device": device, "compute_type": compute_type}
        RecordingWhisperModel.instances.append(self)


class ExplodingOnCudaWhisperModel(RecordingWhisperModel):
    def __init__(self, model_name, device="cpu", compute_type="int8", **kwargs):
        if device == "cuda":
            raise RuntimeError("Could not locate cudnn.dll")
        super().__init__(model_name, device, compute_type, **kwargs)


def _install(monkeypatch, ctranslate2, whisper_model_cls):
    monkeypatch.setitem(sys.modules, "ctranslate2", ctranslate2)
    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=whisper_model_cls))
    RecordingWhisperModel.instances = []


def test_no_cuda_device_uses_cpu(monkeypatch, capsys):
    _install(monkeypatch, FakeCtranslate2(device_count=0), RecordingWhisperModel)

    backend = FasterWhisperBackend()
    backend.load_model("medium")

    assert backend._model.args == {"model_name": "medium", "device": "cpu", "compute_type": "int8"}
    out = capsys.readouterr().out
    assert "CUDA unavailable" in out
    assert "no CUDA device visible" in out


def test_cuda_device_uses_float16(monkeypatch, capsys):
    _install(monkeypatch, FakeCtranslate2(device_count=1), RecordingWhisperModel)

    backend = FasterWhisperBackend()
    backend.load_model("medium")

    assert backend._model.args == {"model_name": "medium", "device": "cuda", "compute_type": "float16"}
    out = capsys.readouterr().out
    assert "RTX 4070" in out
    assert "CUDA GPU acceleration" in out


def test_gpu_name_via_nvidia_smi_when_api_missing(monkeypatch, capsys):
    _install(monkeypatch, Ctranslate2WithoutDeviceProperty(), RecordingWhisperModel)

    def fake_run(cmd, **kwargs):
        return SimpleNamespace(returncode=0, stdout="NVIDIA GeForce RTX 4070 Ti\n")

    monkeypatch.setitem(sys.modules, "subprocess", SimpleNamespace(run=fake_run))

    backend = FasterWhisperBackend()
    backend.load_model("medium")

    assert backend._model.args["device"] == "cuda"
    out = capsys.readouterr().out
    assert "RTX 4070 Ti" in out


def test_generic_gpu_name_when_nvidia_smi_also_fails(monkeypatch, capsys):
    _install(monkeypatch, Ctranslate2WithoutDeviceProperty(), RecordingWhisperModel)

    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        return SimpleNamespace(returncode=1, stdout="")

    monkeypatch.setitem(sys.modules, "subprocess", SimpleNamespace(run=fake_run))

    backend = FasterWhisperBackend()
    backend.load_model("medium")

    assert backend._model.args["device"] == "cuda"
    assert calls, "nvidia-smi should have been consulted before falling back to a generic name"
    out = capsys.readouterr().out
    assert "CUDA GPU" in out
    assert "CUDA GPU acceleration" in out


def test_cuda_load_failure_falls_back_to_cpu_with_reason(monkeypatch, capsys):
    _install(monkeypatch, FakeCtranslate2(device_count=1), ExplodingOnCudaWhisperModel)

    backend = FasterWhisperBackend()
    backend.load_model("medium")

    assert backend._model.args == {"model_name": "medium", "device": "cpu", "compute_type": "int8"}
    out = capsys.readouterr().out
    assert "load failed: Could not locate cudnn.dll" in out
    assert "Using CPU with int8 quantization" in out
