"""video-tts — Voice 元数据、合成结果协议与 TTS provider 接口。

`Voice` 是不可变的音色描述：显示名、provider 内部 voice_id、性别、描述、
所属模型与 provider 名。`TTSProvider` 是本地 / 在线 provider 必须满足的
`typing.Protocol`；实现模块按需懒加载（mlx-audio、bl 只在真正使用时导入）。

`SynthesisResult` 是 provider 的统一返回：波形必须带真实采样率。声道布局
固定为「单声道 = 1-D frames；多声道 = 2-D (frames, channels)」，禁止把
交错样本 `reshape(-1)` 成单声道（会把时长翻倍、音高破坏）。下游统一在
`audio_pipeline` 里按下混 → 重采样处理，绝不通过改文件头"假装"重采样。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class Voice:
    """一个可选音色。"""

    name: str
    voice_id: str
    gender: str
    description: str
    model: str
    provider: str


@dataclass
class SynthesisResult:
    """一次合成的原生输出与元数据。

    ``audio`` 是 provider 实际生成的波形（1-D 单声道或 2-D 多声道），
    ``sample_rate`` 必须来自真实生成结果或可验证的模型元数据——缺失或
    冲突时 provider 要显式报错，不得默认标 24000。
    """

    audio: np.ndarray
    sample_rate: int
    channels: int
    provider: str
    model_id: str
    model_revision: str | None = None
    request_id: str | None = None

    def __post_init__(self) -> None:
        if self.sample_rate <= 0:
            raise ValueError(
                f"SynthesisResult.sample_rate must be positive, "
                f"got {self.sample_rate}"
            )
        audio = np.asarray(self.audio)
        if audio.ndim == 1:
            if self.channels != 1:
                raise ValueError("1-D audio must declare channels=1")
        elif audio.ndim == 2:
            if audio.shape[1] != self.channels:
                raise ValueError(
                    f"audio has {audio.shape[1]} channels but channels="
                    f"{self.channels} was declared"
                )
        else:
            raise ValueError(
                f"audio must be 1-D mono or 2-D (frames, channels), "
                f"got shape {audio.shape}"
            )


class TTSProvider(Protocol):
    """TTS provider 的结构化接口。"""

    def prepare(self) -> None:
        """加载模型 / 校验登录态等一次性准备工作。"""

    def synthesize(
        self,
        text: str,
        voice: Voice,
        instruct: str = "",
        lang: str = "chinese",
        **style: object,
    ) -> SynthesisResult:
        """合成一段文本，返回带真实采样率的原生波形与元数据。

        可选 style：rate / pitch / volume / seed / enable_ssml（在线），
        temperature / top_p / top_k（本地），ref_audio / ref_text（本地
        Base 克隆；克隆调用必须收到真实参考，voice 传 None，绝不伪装预设
        音色）。失败时抛 `providers.errors.SynthesisError`，由统一调度层
        决定重试。
        """

    def download(self, audio_url: str, **kwargs: object) -> SynthesisResult:
        """按收据重新下载已生成的音频（在线 provider 可选实现）。

        供 `download_failed` 恢复使用：只下载、不重新提交合成。本地
        provider 无此能力（引擎会自动跳过收据路径）。
        """

    def describe(self) -> dict:
        """返回 provider 的自描述信息（名称、模型、能力、后端版本等）。"""
