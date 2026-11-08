"""video-tts — provider 错误分类（统一重试调度的输入）。

`SynthesisError` 由 provider 抛出，`kind` 决定调度层（engine）的行为：

- ``fatal``：参数 / 音色不匹配 / 401 / 403 / 额度不足。立即停止整个任务，
  修复条件后由用户恢复；绝不在后续组上重演。
- ``retryable``：明确尚未提交的连接失败、429、可重试的暂时拒绝。在总
  尝试预算内退避重试；`retry_after` 携带服务端要求的等待秒数。
- ``submission_unknown``：提交后超时等无法确认是否已处理的状态。标记后
  不自动重新合成，等待用户决定（避免重复计费）。
- ``invalid_output``：空音频、NaN / Inf、采样率异常等坏结果。按错误类型
  在预算内有限重试，坏结果绝不写缓存。

provider 内部只做错误分类，不做合成重试（下载重试属于独立预算，由
provider 自行处理）；重试由 engine 的统一调度层集中控制。
"""

from __future__ import annotations

FATAL = "fatal"
RETRYABLE = "retryable"
SUBMISSION_UNKNOWN = "submission_unknown"
INVALID_OUTPUT = "invalid_output"

_KINDS = frozenset({FATAL, RETRYABLE, SUBMISSION_UNKNOWN, INVALID_OUTPUT})


class SynthesisError(RuntimeError):
    """带错误分类的 provider 失败。

    Attributes:
        kind: fatal / retryable / submission_unknown / invalid_output。
        retry_after: 服务端 ``Retry-After``（秒）；没有则为 ``None``。
        request_id: 服务端请求标识（用于诊断与恢复）。
        audio_url: 合成成功、下载失败场景里保存的音频地址。
    """

    def __init__(
        self,
        message: str,
        kind: str = FATAL,
        retry_after: float | None = None,
        request_id: str | None = None,
        audio_url: str | None = None,
    ) -> None:
        if kind not in _KINDS:
            raise ValueError(f"unknown SynthesisError kind: {kind!r}")
        super().__init__(message)
        self.kind = kind
        self.retry_after = retry_after
        self.request_id = request_id
        self.audio_url = audio_url
