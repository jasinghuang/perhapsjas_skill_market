"""video-tts — 本地 MLX Qwen3-TTS provider（mlx-audio）。

本地 provider 在 Apple Silicon 上通过 `mlx-audio` 加载 Qwen3-TTS：

- 默认模型是 CustomVoice 1.7B bf16，`prepare()` 只加载一次并缓存；
- `synthesize()` 对 CustomVoice 传 `voice=<voice_id>` + 可选 `instruct`，
  对 VoiceDesign（构造时给了 `design`）传 `voice=None, instruct=<design>`，
  对 Base 克隆传 `ref_audio` / `ref_text`；
- `model.generate(...)` 返回 `GenerationResult` 迭代器。生成器按其实际
  分片语义**全量消费**：逐个收集 yield 的音频段（非流式模式下通常只有
  一段，多段时按顺序拼接），不假定首个 yield 就是完整结果，也不把同一段
  重复拼接；一个都没给则报错。
- 采样率以生成结果的元数据（`result.sample_rate`，回退模型属性）为准，
  缺失时明确报错，不默认标 24000。

三个模块级名字 `load_model` / `mx` 在 import 时守住：没装 mlx-audio 的
机器（或 CI）仍能 import 本模块，测试直接 patch 这些名字注入假模型。
"""

from __future__ import annotations

import numpy as np

from . import LOCAL_MODEL, is_base_model
from .base import SynthesisResult, Voice
from .errors import FATAL, INVALID_OUTPUT, SynthesisError

try:  # mlx-audio 只在 Apple Silicon 上可用；测试会 patch 这些名字。
    from mlx_audio.tts.utils import load_model
except ImportError:
    load_model = None

try:
    import mlx.core as mx
except ImportError:
    mx = None

try:
    import mlx_audio  # noqa: F401 — 只为读版本号
except ImportError:
    mlx_audio = None

DEFAULT_MODEL = LOCAL_MODEL


def _backend_version() -> str:
    """返回 mlx-audio 版本号（读不到给空串）；进缓存键与报告。"""
    return str(getattr(mlx_audio, "__version__", "") or "")


def _to_numpy(audio) -> np.ndarray:
    """把 mx array / ndarray 统一成 numpy float32（不改变形状）。

    mlx 的 array 实现了 `__array__` 协议，`np.asarray` 可直接转换。
    """
    return np.asarray(audio, dtype=np.float32)


class LocalMLXProvider:
    """通过 mlx-audio 调用本地 Qwen3-TTS CustomVoice / VoiceDesign / Base。"""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        design: str | None = None,
    ) -> None:
        self.model_id = model_id
        self.design = design
        self._model = None
        self._model_sample_rate: int | None = None

    def prepare(self) -> None:
        """加载模型（只加载一次）。"""
        if self._model is not None:
            return
        if load_model is None:
            raise SynthesisError(
                "mlx-audio is not installed; install it with: "
                "pip install mlx-audio",
                kind=FATAL,
            )
        try:
            model = load_model(self.model_id)
        except Exception as exc:
            raise SynthesisError(
                f"failed to load local model {self.model_id!r}: {exc}. "
                "若模型尚未缓存，先运行："
                f"huggingface-cli download {self.model_id}",
                kind=FATAL,
            ) from exc
        self._model = model
        rate = getattr(model, "sample_rate", None)
        self._model_sample_rate = int(rate) if rate else None

    def _collect_generation(self, results) -> tuple[np.ndarray, int, str | None]:
        """全量消费生成器：逐段收集音频，返回 (波形, 采样率, 请求标识)。

        多段按顺序拼接（模型按分片语义返回完整音频的各部分）；任何一段
        缺采样率且模型属性也没有时报错。请求标识本地没有，返回 None。
        """
        pieces: list[np.ndarray] = []
        sample_rate: int | None = None
        for result in results:
            audio = getattr(result, "audio", None)
            if audio is None:
                continue
            piece_rate = getattr(result, "sample_rate", None)
            if piece_rate is None:
                piece_rate = self._model_sample_rate
            if piece_rate is None:
                raise SynthesisError(
                    "local model result carries no sample rate and the "
                    "model exposes none; refusing to guess",
                    kind=INVALID_OUTPUT,
                )
            if sample_rate is None:
                sample_rate = int(piece_rate)
            elif int(piece_rate) != sample_rate:
                raise SynthesisError(
                    f"local model returned mixed sample rates "
                    f"({sample_rate} vs {int(piece_rate)})",
                    kind=INVALID_OUTPUT,
                )
            piece = _to_numpy(audio)
            if piece.ndim not in (1, 2):
                raise SynthesisError(
                    f"unexpected audio shape {piece.shape} from local model",
                    kind=INVALID_OUTPUT,
                )
            pieces.append(piece)

        if not pieces or sample_rate is None:
            raise SynthesisError(
                "model returned no audio", kind=INVALID_OUTPUT
            )
        audio = pieces[0] if len(pieces) == 1 else np.concatenate(pieces, axis=0)
        return audio, int(sample_rate), None

    def synthesize(
        self,
        text: str,
        voice: Voice | None,
        instruct: str = "",
        lang: str = "chinese",
        **style,
    ) -> SynthesisResult:
        """合成一段文本，返回带真实采样率的 `SynthesisResult`。

        本地支持 temperature / top_p / top_k / seed 控制采样稳定性；
        rate/pitch/volume/enable_ssml/hot_fix 只属于在线 provider。
        """
        unsupported = {"rate", "pitch", "volume", "enable_ssml", "hot_fix"} & set(style)
        if unsupported:
            raise SynthesisError(
                f"{', '.join(sorted(unsupported))} are only supported by the "
                "online provider",
                kind=FATAL,
            )
        if self._model is None:
            raise SynthesisError(
                "prepare() must be called before synthesize()", kind=FATAL
            )

        ref_audio = style.get("ref_audio")
        ref_text = style.get("ref_text")
        if ref_audio:
            if not ref_text:
                raise SynthesisError(
                    "Base voice cloning requires both --ref-audio and --ref-text",
                    kind=FATAL,
                )
            if self.design is not None:
                raise SynthesisError(
                    "ref_audio cannot be combined with --design", kind=FATAL
                )
            if not is_base_model(self.model_id):
                # CLI 已拦截，这里再挡直接调用 provider 的路径。
                raise SynthesisError(
                    f"voice cloning requires a Base model (got "
                    f"{self.model_id!r}); use the 1.7B Base model",
                    kind=FATAL,
                )
            voice_id = None
            prompt = None
        elif self.design is not None:
            if not self.design.strip():
                raise SynthesisError(
                    "design mode requires a non-empty design description",
                    kind=FATAL,
                )
            voice_id = None
            prompt = self.design
        else:
            if voice is None:
                raise SynthesisError(
                    "a voice is required unless design mode is enabled",
                    kind=FATAL,
                )
            voice_id = voice.voice_id
            prompt = instruct or None

        seed = style.get("seed")
        if seed is not None and mx is not None:
            mx.random.seed(int(seed))

        generate_kwargs = {
            "temperature": style.get("temperature"),
            "top_p": style.get("top_p"),
            "top_k": style.get("top_k"),
        }
        generate_kwargs = {
            key: value
            for key, value in generate_kwargs.items()
            if value is not None
        }
        if ref_audio:
            generate_kwargs["ref_audio"] = ref_audio
            generate_kwargs["ref_text"] = ref_text
        try:
            results = self._model.generate(
                text=text,
                voice=voice_id,
                instruct=prompt,
                lang_code=lang,
                **generate_kwargs,
            )
            audio, sample_rate, request_id = self._collect_generation(results)
        except SynthesisError:
            raise
        except Exception as exc:  # mlx 运行期错误（显存、形状等）
            raise SynthesisError(
                f"local synthesis failed: {exc}", kind=INVALID_OUTPUT
            ) from exc

        return SynthesisResult(
            audio=audio,
            sample_rate=sample_rate,
            channels=1 if audio.ndim == 1 else int(audio.shape[1]),
            provider="local",
            model_id=self.model_id,
            model_revision=None,
            request_id=request_id,
        )

    def describe(self) -> dict:
        """返回 provider 的自描述信息（engine 用它生成稳定的缓存 key）。"""
        return {
            "provider": "local",
            "model": self.model_id,
            "model_revision": None,
            "backend": "mlx-audio",
            "backend_version": _backend_version(),
            "design": self.design,
        }
