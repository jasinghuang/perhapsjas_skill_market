#!/usr/bin/env python3
"""
video-tts — job manifest（任务恢复清单）与原子文件写入。

每个任务落盘一份 `<out>.job.json`（spec §10 / §13）：

- 输入指纹：SRT / merge plan / 参考音频的内容 SHA-256；
- 配置快照：provider、模型、音色 / design / 克隆、时间模式、overflow
  策略、制作采样率、风格参数；
- 计划：每组的 source_indices、配音文本与计划时间窗；
- 逐组状态：状态、缓存键、提交次数、错误类型与加工结果。

`resume` 读取旧 manifest：输入 / 参考音频 / 模型版本与参数不匹配时拒绝
错用旧分块；匹配时已完成组经原生缓存自然复用（改文本只重合成受影响组，
改时间窗 / 制作采样率复用全部原生音频，只重做加工与拼轨）。失败、取消
或超长停止后，至少落盘任务状态与已完成结果。

JSON 一律经 `atomic_write_text`（临时文件 + `os.replace`）写出：中途失败
不会留下半截 manifest，也不会破坏上一份可用的恢复信息。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

MANIFEST_SCHEMA = 1

# 报告 / manifest 里记录的状态枚举（spec §14）。
STATUSES = (
    "planned", "preparing", "synthesizing", "processing", "exporting",
    "complete", "completed_with_warnings", "needs_attention", "partial",
    "failed", "cancelled", "submission_unknown",
)


def new_job_id() -> str:
    """生成短任务 id（时间前缀 + 随机后缀，便于排序与口头引用）。"""
    return f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"


def text_sha256(text: str) -> str:
    """字符串内容的 SHA-256（输入指纹用）。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def atomic_write_text(path: Path, content: str) -> None:
    """UTF-8 文本原子写入（临时文件 + `os.replace`）。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def write_json(path: Path, payload: dict) -> None:
    """把 dict 写成规范 JSON（保留中文、稳定缩进），原子替换。"""
    atomic_write_text(
        path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    )


class JobManifest:
    """一次配音任务的恢复清单（读写都围绕同一个 JSON 文件）。"""

    def __init__(self, path: Path, payload: dict) -> None:
        self.path = Path(path)
        self.payload = payload

    # --- 生命周期 -------------------------------------------------------

    @classmethod
    def create(
        cls,
        path: Path,
        *,
        job_id: str | None = None,
        inputs: dict | None = None,
        config: dict | None = None,
        groups: list[dict] | None = None,
    ) -> "JobManifest":
        """创建新 manifest（`groups` 为计划里每组的初始记录）。"""
        payload = {
            "schema_version": MANIFEST_SCHEMA,
            "job_id": job_id or new_job_id(),
            "status": "planned",
            "created_at": time.time(),
            "updated_at": time.time(),
            "inputs": inputs or {},
            "config": config or {},
            "groups": groups or [],
            "notes": [],
        }
        return cls(path, payload)

    @classmethod
    def load(cls, path: Path) -> "JobManifest":
        """读取已有 manifest；损坏时抛 `ValueError`（不静默重建）。"""
        try:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
        except OSError as exc:
            raise ValueError(f"cannot read job manifest {path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise ValueError(f"job manifest is not valid JSON: {exc}") from exc
        if not isinstance(payload, dict) or "job_id" not in payload:
            raise ValueError(f"job manifest {path} is missing required fields")
        return cls(path, payload)

    def save(self, status: str | None = None, note: str | None = None) -> None:
        """落盘当前状态（原子替换）；状态与备注按需更新。"""
        if status is not None:
            if status not in STATUSES:
                raise ValueError(f"unknown job status: {status!r}")
            self.payload["status"] = status
        if note:
            self.payload.setdefault("notes", []).append(
                {"at": time.time(), "text": note}
            )
        self.payload["updated_at"] = time.time()
        write_json(self.path, self.payload)

    # --- 字段访问 -------------------------------------------------------

    @property
    def job_id(self) -> str:
        return str(self.payload.get("job_id", ""))

    @property
    def status(self) -> str:
        return str(self.payload.get("status", "planned"))

    def fingerprint(self, key: str) -> str:
        """返回输入指纹（如 `srt_sha256`）；缺失为空串。"""
        value = (self.payload.get("inputs") or {}).get(key)
        return str(value or "")

    def check_resume_inputs(
        self, srt_sha: str, plan_sha: str | None, ref_sha: str | None
    ) -> list[str]:
        """校验恢复条件，返回不匹配列表（空列表 = 可以安全恢复）。

        SRT 内容变化必须重新生成 merge plan（分组依据已变）；参考音频
        变化意味着克隆条件已变，旧分块不能复用。
        """
        mismatches: list[str] = []
        old_srt = self.fingerprint("srt_sha256")
        if old_srt and old_srt != srt_sha:
            mismatches.append(
                "SRT 内容与原任务不一致（srt_sha256 变化）；请重新生成"
                " merge plan 后开新任务，或改回原 SRT 再 resume"
            )
        old_plan = self.fingerprint("merge_plan_sha256")
        new_plan = plan_sha or ""
        if old_plan and new_plan and old_plan != new_plan:
            mismatches.append(
                "merge plan 与原任务不一致；改文本请只改受影响组并同步"
                " plan，其余组会经缓存复用"
            )
        old_ref = self.fingerprint("ref_audio_sha256")
        new_ref = ref_sha or ""
        if old_ref and new_ref and old_ref != new_ref:
            mismatches.append(
                "克隆参考音频内容与原任务不一致；旧分块不能复用"
            )
        return mismatches

    def group_records(self) -> list[dict]:
        """返回逐组记录（计划 + 状态合并视图）。"""
        return list(self.payload.get("groups") or [])

    def update_group(self, index: int, **fields) -> None:
        """更新第 `index` 组（0 基）的状态字段；越界忽略。"""
        groups = self.payload.get("groups") or []
        if 0 <= index < len(groups) and isinstance(groups[index], dict):
            groups[index].update(fields)
