#!/usr/bin/env python3
"""
video-tts — 合成片段缓存（schema v2）。

v2 的缓存键是对**结构化字典**做稳定序列化（键排序的 JSON）后取的
SHA-256 前缀，不再用不带转义的分隔符拼接字段——旧实现里任何字段出现
`|` 都可能造成键碰撞 / 伪命中。键的构成（spec §9）：

- provider、实际 model_id、已解析 revision 与后端版本；
- 预设音色 ID，或完整 VoiceDesign 描述；
- 配音文本（含长文本切块的块序号）、语言、语气与影响合成的采样参数；
- 克隆参考音频的**内容 SHA-256** 与参考文本（不是路径——同路径换内容
  必须失效，同内容换路径应当命中）；
- 请求的音频规格（在线采样率）。

缓存内容是**原生音频**（未经裁剪 / 变速 / 重采样加工）+ 真实采样率（存
在 WAV 元数据里）：改变制作采样率、时间窗或 max_speed 时直接复用，只重做
后续加工，不重复在线合成。旧版（v1）缓存文件名格式不同，天然不会命中，
不批量删除。

写入用临时文件 + `os.replace` 原子替换；缓存写失败只记警告，绝不让已经
合成好的音频失效；损坏文件按未命中处理。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

CACHE_SCHEMA = 2


def stable_cache_key(material: dict) -> str:
    """把结构化缓存材料序列化成稳定的 24 位 SHA-256 前缀。

    JSON 序列化带 `sort_keys` + `ensure_ascii=False` + `default=str`，
    因此 dict 的构造顺序、嵌套方式不影响键值；`default=str` 兜底
    Path / float 等非 JSON 原生类型。
    """
    payload = json.dumps(
        {"schema": CACHE_SCHEMA, **material},
        sort_keys=True,
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def file_sha256(path: Path, chunk_size: int = 1 << 20) -> str:
    """计算文件内容的 SHA-256（参考音频身份用；任务准备阶段算一次）。"""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _default_root() -> Path:
    # 覆盖优先级：VIDEO_TTS_CACHE_DIR（测试 / 自定义缓存盘）>
    # XDG_CACHE_HOME（显式设置即尊重，跨平台一致）> 平台默认
    # （Windows: LOCALAPPDATA\video-toolkit\video-tts；其他: ~/.cache）。
    override = os.environ.get("VIDEO_TTS_CACHE_DIR")
    if override:
        return Path(override).expanduser() / "segments"
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg:
        return Path(xdg).expanduser() / "video-tts" / "segments"
    if os.name == "nt":
        base = Path(
            os.environ.get("LOCALAPPDATA")
            or (Path.home() / "AppData" / "Local")
        )
        return base / "video-toolkit" / "video-tts" / "segments"
    return Path.home() / ".cache" / "video-tts" / "segments"


class SegmentCache:
    """按 key 存取单条原生合成片段 WAV 的磁盘缓存。

    `get` 返回 `(pcm, sample_rate)`——采样率读自 WAV 元数据，调用方据此
    决定是否需要重采样，而不是假设某个固定值。
    """

    def __init__(self, root: Path | None = None, enabled: bool = True) -> None:
        self.root = Path(root) if root is not None else _default_root()
        self.enabled = enabled

    def _path(self, key: str) -> Path:
        """返回 key 对应的缓存文件路径（不保证存在）。"""
        return self.root / f"v{CACHE_SCHEMA}-{key}.wav"

    def get(self, key: str) -> tuple[np.ndarray, int] | None:
        """读回 `(原生波形, 真实采样率)`；禁用、缺失或损坏时返回 `None`。"""
        if not self.enabled:
            return None
        path = self._path(key)
        if not path.is_file():
            return None
        try:
            samples, rate = sf.read(path, dtype="float32", always_2d=False)
        except (OSError, RuntimeError):
            return None
        samples = np.asarray(samples, dtype=np.float32)
        if samples.ndim != 1 or int(rate) <= 0:
            return None
        return samples, int(rate)

    def put(self, key: str, pcm: np.ndarray, sample_rate: int) -> None:
        """写入原生音频缓存；禁用时不落盘，写入过程对读者原子可见。

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
                dir=self.root, prefix=f".{path.name}.", suffix=".wav"
            )
            os.close(fd)
            samples = np.asarray(pcm, dtype=np.float32)
            if samples.ndim != 1:
                raise ValueError("cached audio must be 1-D mono")
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
