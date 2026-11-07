"""video-tts — 本地 MLX Qwen3-TTS provider（mlx-audio）。

本地 provider 在 Apple Silicon 上通过 `mlx-audio` 加载 Qwen3-TTS：

- 默认模型是 CustomVoice 1.7B bf16，`prepare()` 只加载一次并缓存；
- `synthesize()` 对 CustomVoice 传 `voice=<voice_id>` + 可选 `instruct`，
  对 VoiceDesign（构造时给了 `design`）传 `voice=None, instruct=<design>`；
- `model.generate(...)` 返回 `GenerationResult` 迭代器，取第一条，把 `.audio`
  转成 1-D float32 numpy PCM，并校验 24 kHz。

四个模块级名字 `load_model` / `mx` 在 import 时守住：没装 mlx-audio 的机器
（或 CI）仍能 import 本模块，测试直接 patch 这两个名字注入假模型。
"""

from __future__ import annotations

import numpy as np

from . import LOCAL_MODEL
from .base import Voice

try:  # mlx-audio 只在 Apple Silicon 上可用；测试会 patch 这两个名字。
    from mlx_audio.tts.utils import load_model
except ImportError:
    load_model = None

try:
    import mlx.core as mx
except ImportError:
    mx = None

DEFAULT_MODEL = LOCAL_MODEL
SAMPLE_RATE = 24000


class ProviderError(RuntimeError):
    """本地 provider 准备或合成失败。"""


class LocalMLXProvider:
    """通过 mlx-audio 调用本地 Qwen3-TTS CustomVoice / VoiceDesign。"""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        design: str | None = None,
    ) -> None:
        self.model_id = model_id
        self.design = design
        self._model = None
        self._sample_rate: int | None = None

    def prepare(self) -> None:
        """加载模型（只加载一次）。"""
        if self._model is not None:
            return
        if load_model is None:
            raise ProviderError(
                "mlx-audio is not installed; install it with: pip install mlx-audio"
            )
        try:
            model = load_model(self.model_id)
        except Exception as exc:
            raise ProviderError(
                f"failed to load local model {self.model_id!r}: {exc}. "
                "若模型尚未缓存，先运行："
                f"huggingface-cli download {self.model_id}"
            ) from exc
        self._model = model
        self._sample_rate = getattr(model, "sample_rate", None)

    def synthesize(
        self,
        text: str,
        voice: Voice | None,
        instruct: str = "",
        lang: str = "chinese",
        **style,
    ) -> np.ndarray:
        """合成一段文本，返回 24 kHz 单声道 float32 PCM。

        本地支持 temperature / top_p / top_k / seed 控制采样稳定性；
        rate/pitch/volume/enable_ssml 只属于在线 provider。
        """
        unsupported = {"rate", "pitch", "volume", "enable_ssml", "hot_fix"} & set(style)
        if unsupported:
            raise ProviderError(
                f"{', '.join(sorted(unsupported))} are only supported by the "
                "online provider"
            )
        if self._model is None:
            raise ProviderError("prepare() must be called before synthesize()")

        ref_audio = style.get("ref_audio")
        ref_text = style.get("ref_text")
        if ref_audio:
            if not ref_text:
                raise ProviderError(
                    "Base voice cloning requires both --ref-audio and --ref-text"
                )
            if self.design is not None:
                raise ProviderError("ref_audio cannot be combined with --design")
            voice_id = None
            prompt = None
        elif self.design is not None:
            if not self.design.strip():
                raise ProviderError(
                    "design mode requires a non-empty design description"
                )
            voice_id = None
            prompt = self.design
        else:
            if voice is None:
                raise ProviderError(
                    "a voice is required unless design mode is enabled"
                )
            voice_id = voice.voice_id
            prompt = instruct or None

        seed = style.get("seed")
        if seed is not None and mx is not None:
            mx.random.seed(int(seed))

        generate_kwargs = {"temperature": style.get("temperature"),
                           "top_p": style.get("top_p"),
                           "top_k": style.get("top_k")}
        generate_kwargs = {
            key: value
            for key, value in generate_kwargs.items()
            if value is not None
        }
        if ref_audio:
            generate_kwargs["ref_audio"] = ref_audio
            generate_kwargs["ref_text"] = ref_text
        results = self._model.generate(
            text=text,
            voice=voice_id,
            instruct=prompt,
            lang_code=lang,
            **generate_kwargs,
        )
        try:
            result = next(iter(results))
        except StopIteration as exc:
            raise ProviderError("model returned no audio") from exc

        sample_rate = getattr(result, "sample_rate", None)
        if sample_rate is None:
            sample_rate = self._sample_rate
        if sample_rate != SAMPLE_RATE:
            raise ProviderError(
                f"expected {SAMPLE_RATE} Hz audio, got {sample_rate} Hz"
            )

        audio = result.audio
        if mx is not None:
            audio = mx.array(audio)
        return np.asarray(audio, dtype=np.float32).reshape(-1)

    def describe(self) -> dict:
        """返回 provider 的自描述信息。"""
        return {
            "provider": "local",
            "model": self.model_id,
            "design": self.design,
        }
