"""video-tts — Voice 元数据与 TTS provider 接口。

`Voice` 是不可变的音色描述：显示名、provider 内部 voice_id、性别、描述、
所属模型与 provider 名。`TTSProvider` 是本地 / 在线 provider 必须满足的
`typing.Protocol`；实现模块按需懒加载（mlx-audio、bl 只在真正使用时导入）。
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
    ) -> np.ndarray:
        """合成一段文本，返回 24 kHz 单声道 float32 PCM。"""

    def describe(self) -> dict:
        """返回 provider 的自描述信息（名称、模型、能力等）。"""
