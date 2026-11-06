#!/usr/bin/env python3
"""
video-tts — 合成片段缓存。

`segment_cache_key()` 把影响配音结果的全部参数（provider / 模型 / 音色 /
指令 / 语种 / 文本）拼成稳定的短哈希：参数完全相同才命中同一条缓存。
`SegmentCache` 把合成结果以 WAV 存到 `$XDG_CACHE_HOME/video-tts/segments`
（默认 `~/.cache/video-tts/segments`）。读到采样率不符或损坏的文件时按
未命中处理；写盘用临时文件 + `os.replace`，避免中途失败留下半截 WAV。
"""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000


def segment_cache_key(
    provider: str,
    model_id: str,
    voice_id: str,
    instruct: str,
    lang: str,
    text: str,
) -> str:
    """返回 `provider|model|voice|instruct|lang|text` 的 16 位 SHA-256 前缀。"""
    material = "|".join((provider, model_id, voice_id, instruct, lang, text))
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def _default_root() -> Path:
    base = os.environ.get("XDG_CACHE_HOME")
    cache_home = Path(base).expanduser() if base else Path.home() / ".cache"
    return cache_home / "video-tts" / "segments"


class SegmentCache:
    """按 key 存取单条合成片段 WAV 的磁盘缓存。"""

    def __init__(self, root: Path | None = None, enabled: bool = True) -> None:
        self.root = Path(root) if root is not None else _default_root()
        self.enabled = enabled

    def _path(self, key: str) -> Path:
        """返回 key 对应的缓存文件路径（不保证存在）。"""
        return self.root / f"{key}.wav"

    def get(
        self,
        key: str,
        sample_rate: int = SAMPLE_RATE,
    ) -> np.ndarray | None:
        """读回缓存波形；禁用、缺失、损坏或采样率不符时返回 `None`。"""
        if not self.enabled:
            return None
        path = self._path(key)
        if not path.is_file():
            return None
        try:
            samples, rate = sf.read(path, dtype="float32", always_2d=False)
        except (OSError, RuntimeError):
            return None
        if int(rate) != sample_rate:
            return None
        return np.asarray(samples, dtype=np.float32)

    def put(
        self,
        key: str,
        pcm: np.ndarray,
        sample_rate: int = SAMPLE_RATE,
    ) -> None:
        """写入缓存；缓存禁用时不落盘，写入过程对读者原子可见。

        缓存是加速手段而非正确性依赖：磁盘满、权限不足等 `OSError`
        只跳过本次缓存，绝不让已经合成好的条目失败。
        """
        if not self.enabled:
            return
        path = self._path(key)
        tmp_name: str | None = None
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(
                dir=self.root, prefix=f".{key}.", suffix=".wav"
            )
            os.close(fd)
            samples = np.asarray(pcm, dtype=np.float32).reshape(-1)
            sf.write(tmp_name, samples, sample_rate, subtype="FLOAT")
            os.replace(tmp_name, path)
        except OSError:
            _unlink_quietly(tmp_name)
        except BaseException:
            _unlink_quietly(tmp_name)
            raise


def _unlink_quietly(path: str | None) -> None:
    """删除临时文件；不存在或删除失败都不再抛错。"""
    if path is None:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass
