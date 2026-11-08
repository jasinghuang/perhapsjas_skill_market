"""video-tts — Windows 官方 qwen-tts 本地 provider（PyTorch / CUDA）。

原生 Windows x64 路线（spec §5）：通过官方 `qwen-tts` 包加载
Qwen/Qwen3-TTS-12Hz-1.7B-{CustomVoice,VoiceDesign,Base}：

- 预设音色：CustomVoice 模型，`generate_custom_voice(text, speaker,
  language, instruct)`——参数名是 **speaker / language**，不是 MLX 的
  `voice / lang_code`；
- 文字设计：VoiceDesign 模型，`generate_voice_design(text, instruct,
  language)`；
- 参考克隆：Base 模型，`create_voice_clone_prompt(ref_audio, ref_text)`
  在任务内只构建一次并复用（spec §7.1），随后
  `generate_voice_clone(text, language, voice_clone_prompt=...)`；
  默认带准确参考文本的条件，不用 x-vector-only 简化模式。

三个 generate 都返回 `(List[np.ndarray], sample_rate)`；单条输入取
`audios[0]` 并核对条数。`non_streaming_mode` 只影响文本输入模式（模拟
流式文本），不是音频分片开关——结果一律完整取回。

BF16 + SDPA 起步（官方 Demo 的 CUDA 配置）；显存不足按 spec §5.2 报错
并给出占用信息，不自动换 0.6B / CPU / 在线。设计后克隆的模型切换必须
走 `release_model()` 的真实归还契约（spec §7.2，CUDA Caching Allocator
不会因 Python 引用消失自动把显还给驱动）。
"""

from __future__ import annotations

import importlib.metadata as _metadata

import numpy as np

from . import TORCH_BASE_MODEL, TORCH_CUSTOM_MODEL, TORCH_DESIGN_MODEL, is_base_model
from .base import SynthesisResult, Voice
from .errors import FATAL, INVALID_OUTPUT, SynthesisError

try:  # qwen-tts 只在 Windows torch 路线安装；测试 patch 这些名字。
    import torch as _torch
except ImportError:  # pragma: no cover - 环境相关
    _torch = None

try:
    from qwen_tts import Qwen3TTSModel as _Qwen3TTSModel
except ImportError:  # pragma: no cover - 环境相关
    try:
        from qwen_tts.inference.qwen3_tts_model import (
            Qwen3TTSModel as _Qwen3TTSModel,
        )
    except ImportError:
        _Qwen3TTSModel = None

DEFAULT_MODEL = TORCH_CUSTOM_MODEL

# torch 官方 API 的 language 取**语言全名**（'chinese'，实测模型报
# "Unsupported languages: ['zh']"），不是在线/bl 的两字母代码；常见
# 代码反向映射成全名，其余原样透传（模型侧校验兜底）。
_LANGUAGE_NAMES = {
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}


def _language_name(lang: str) -> str:
    lowered = lang.strip().lower()
    return _LANGUAGE_NAMES.get(lowered, lowered)


def _check_listed(value: str, listed: list[str] | None, kind: str, model_id: str) -> None:
    """值必须在模型真实支持的列表里（deterministic 错误，不烧重试预算）。"""
    if listed is None:
        return  # 模型未公开列表时不猜、不拦，交给运行期错误。
    if value.lower() not in [item.lower() for item in listed]:
        raise SynthesisError(
            f"{kind} {value!r} is not supported by {model_id}; "
            f"supported: {listed}",
            kind=FATAL,
        )


def _package_version(name: str) -> str:
    try:
        return _metadata.version(name)
    except _metadata.PackageNotFoundError:
        return ""


class LocalTorchProvider:
    """官方 qwen-tts 三模式 provider（Windows x64 + NVIDIA CUDA）。"""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL,
        design: str | None = None,
        device: str = "cuda",
        dtype: str = "bfloat16",
        attn_implementation: str = "sdpa",
    ) -> None:
        self.model_id = model_id
        self.design = design
        self.device = device
        self.dtype = dtype
        self.attn_implementation = attn_implementation
        self._model = None
        self._supported_speakers: list[str] | None = None
        self._supported_languages: list[str] | None = None
        # 任务内复用的克隆条件（create_voice_clone_prompt 只跑一次）。
        self._clone_prompt = None
        self._clone_identity: tuple[str, str] | None = None

    # --- 生命周期 -------------------------------------------------------

    def prepare(self) -> None:
        """加载模型（一次）；CUDA / 依赖缺失给出可操作错误。"""
        if self._model is not None:
            return
        if _Qwen3TTSModel is None or _torch is None:
            raise SynthesisError(
                "qwen-tts / torch 未安装；Windows 本地路线需要专用环境"
                "（qwen-tts、CUDA 版 torch/torchaudio）。让 launcher "
                "（run.py）自动准备，或参考 references/setup.md 手动安装",
                kind=FATAL,
            )
        if self.device.startswith("cuda") and not _torch.cuda.is_available():
            raise SynthesisError(
                "torch.cuda.is_available() 为 False：无可用 NVIDIA GPU / "
                "驱动不匹配 / 装到 CPU 版 torch；请检查显卡驱动与 CUDA "
                "wheel 构建（nvidia-smi + torch.version.cuda）",
                kind=FATAL,
            )
        dtype = {
            "bfloat16": _torch.bfloat16,
            "float16": _torch.float16,
            "float32": _torch.float32,
        }.get(self.dtype)
        if dtype is None:
            raise SynthesisError(
                f"unknown dtype {self.dtype!r} (expected bfloat16/float16/"
                "float32)", kind=FATAL,
            )
        try:
            model = _Qwen3TTSModel.from_pretrained(
                self.model_id,
                dtype=dtype,
                attn_implementation=self.attn_implementation,
                device_map=self.device,
            )
        except SynthesisError:
            raise
        except Exception as exc:
            hint = ""
            if "out of memory" in str(exc).lower():
                hint = "；显存不足——关闭其他占显存的程序后重试"
            raise SynthesisError(
                f"failed to load {self.model_id!r} on {self.device} "
                f"({self.dtype}/{self.attn_implementation}): {exc}{hint}. "
                "若模型尚未缓存，先运行："
                f"huggingface-cli download {self.model_id}",
                kind=FATAL,
            ) from exc
        self._model = model

    def release_model(self) -> dict:
        """卸载模型并**可验证地**归还显存（spec §7.2 切换契约）。

        顺序：断引用 → gc（引用环）→ synchronize → empty_cache，然后
        校验 allocated/reserved 回到基线；返回校验快照。校验不过说明
        存在隐藏引用，调用方不得直接加载下一个模型。
        """
        self._model = None
        self._clone_prompt = None
        self._clone_identity = None
        stats: dict = {"backend": "torch"}
        if _torch is None or not _torch.cuda.is_available():
            return stats
        import gc

        gc.collect()
        _torch.cuda.synchronize()
        _torch.cuda.empty_cache()
        stats["allocated_after_release"] = int(
            _torch.cuda.memory_allocated()
        )
        stats["reserved_after_release"] = int(_torch.cuda.memory_reserved())
        stats["released_cleanly"] = (
            stats["reserved_after_release"] - stats["allocated_after_release"]
            < 64 * 1024 * 1024  # 残留 < 64MB 视为干净
            and stats["reserved_after_release"] < 256 * 1024 * 1024
        )
        if not stats["released_cleanly"]:
            stats["hint"] = (
                "reserved 未回基线：仍有对象引用 GPU 张量，禁止直接加载"
                "下一个模型（双模型峰值）"
            )
        return stats

    def peak_vram_bytes(self) -> int | None:
        """当前阶段的峰值显存（字节）；无 CUDA 时 None。"""
        if _torch is None or not _torch.cuda.is_available():
            return None
        return int(_torch.cuda.max_memory_allocated())

    def reset_peak_vram(self) -> None:
        if _torch is not None and _torch.cuda.is_available():
            _torch.cuda.reset_peak_memory_stats()

    # --- 合成 -----------------------------------------------------------

    def _ensure_clone_prompt(self, ref_audio, ref_text: str):
        """构建 / 复用克隆条件；身份是 (ref_audio, ref_text)。"""
        identity = (str(ref_audio), ref_text)
        if self._clone_prompt is not None and identity == self._clone_identity:
            return self._clone_prompt
        try:
            prompt = self._model.create_voice_clone_prompt(
                ref_audio, ref_text=ref_text, x_vector_only_mode=False,
            )
        except Exception as exc:
            raise SynthesisError(
                f"create_voice_clone_prompt failed: {exc}", kind=FATAL,
            ) from exc
        self._clone_prompt = prompt
        self._clone_identity = identity
        return prompt

    def synthesize(
        self,
        text: str,
        voice: Voice | None,
        instruct: str = "",
        lang: str = "chinese",
        **style,
    ) -> SynthesisResult:
        """合成一段文本，返回带真实采样率的 `SynthesisResult`。

        本地支持 temperature / top_p / top_k / seed（采样稳定）；
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
        language = _language_name(lang)
        self._check_language(language)
        sampling = {
            key: style[key]
            for key in ("temperature", "top_p", "top_k")
            if style.get(key) is not None
        }
        seed = style.get("seed")
        if seed is not None and _torch is not None:
            _torch.manual_seed(int(seed))

        try:
            if ref_audio:
                if not ref_text:
                    raise SynthesisError(
                        "Base voice cloning requires both --ref-audio and "
                        "--ref-text", kind=FATAL,
                    )
                if self.design is not None:
                    raise SynthesisError(
                        "ref_audio cannot be combined with --design", kind=FATAL,
                    )
                if not is_base_model(self.model_id):
                    raise SynthesisError(
                        f"voice cloning requires a Base model (got "
                        f"{self.model_id!r})", kind=FATAL,
                    )
                prompt = self._ensure_clone_prompt(ref_audio, ref_text)
                audios, rate = self._model.generate_voice_clone(
                    text, language=language, voice_clone_prompt=prompt,
                    **sampling,
                )
            elif self.design is not None:
                if not self.design.strip():
                    raise SynthesisError(
                        "design mode requires a non-empty design description",
                        kind=FATAL,
                    )
                audios, rate = self._model.generate_voice_design(
                    text, instruct=self.design, language=language,
                    **sampling,
                )
            else:
                if voice is None:
                    raise SynthesisError(
                        "a voice is required unless design mode is enabled",
                        kind=FATAL,
                    )
                speaker = voice.voice_id
                self._check_speaker(speaker)
                audios, rate = self._model.generate_custom_voice(
                    text, speaker=speaker, language=language,
                    instruct=instruct or None,
                    **sampling,
                )
        except SynthesisError:
            raise
        except Exception as exc:  # torch 运行期错误（显存、形状等）
            message = str(exc)
            if "out of memory" in message.lower() and _torch is not None \
                    and _torch.cuda.is_available():
                raise SynthesisError(
                    f"CUDA out of memory: {message}；当前峰值 "
                    f"{self.peak_vram_bytes() / 1024**2:.0f}MB。关闭其他占"
                    "显存的程序后重试；本 skill 不自动降级模型或改用在线",
                    kind=FATAL,
                ) from exc
            raise SynthesisError(
                f"local synthesis failed: {message}", kind=INVALID_OUTPUT,
            ) from exc

        if not isinstance(audios, list) or len(audios) != 1:
            raise SynthesisError(
                f"expected exactly 1 audio for single text, got "
                f"{len(audios) if isinstance(audios, list) else type(audios)}",
                kind=INVALID_OUTPUT,
            )
        audio = np.asarray(audios[0], dtype=np.float32)
        if audio.ndim not in (1, 2):
            raise SynthesisError(
                f"unexpected audio shape {audio.shape} from qwen-tts",
                kind=INVALID_OUTPUT,
            )
        return SynthesisResult(
            audio=audio,
            sample_rate=int(rate),
            channels=1 if audio.ndim == 1 else int(audio.shape[1]),
            provider="local-torch",
            model_id=self.model_id,
            model_revision=self._model_revision(),
            request_id=None,
        )

    def _check_speaker(self, speaker: str) -> None:
        """预设音色必须被当前模型真实支持（不猜目录）。"""
        if self._supported_speakers is None:
            try:
                listed = self._model.get_supported_speakers()
            except Exception:
                listed = None
            self._supported_speakers = (
                [item.lower() for item in listed] if listed else None
            )
        if self._supported_speakers is not None:
            if speaker.lower() not in self._supported_speakers:
                raise SynthesisError(
                    f"speaker {speaker!r} is not supported by {self.model_id}; "
                    f"supported: {self._supported_speakers}",
                    kind=FATAL,
                )

    def _check_language(self, language: str) -> None:
        """语言必须在模型真实支持的列表里（实测 torch 要语言全名）。"""
        if self._supported_languages is None:
            try:
                listed = self._model.get_supported_languages()
            except Exception:
                listed = None
            self._supported_languages = listed
        _check_listed(
            language, self._supported_languages, "language", self.model_id,
        )

    def _model_revision(self) -> str | None:
        """真实模型提交（HF snapshot）；读不到给 'unknown'，不猜。"""
        config = getattr(self._model, "config", None)
        commit = getattr(config, "_commit_hash", None)
        return str(commit) if commit else "unknown"

    def describe(self) -> dict:
        """返回 provider 自描述（engine 用它生成稳定缓存键）。"""
        return {
            "provider": "local-torch",
            "model": self.model_id,
            "model_revision": None if self._model is None
            else self._model_revision(),
            "backend": "qwen-tts+torch",
            "backend_version": (
                f"qwen-tts={_package_version('qwen-tts')}"
                f"/torch={_package_version('torch')}"
            ),
            "device": self.device,
            "dtype": self.dtype,
            "attn": self.attn_implementation,
            "design": self.design,
        }
