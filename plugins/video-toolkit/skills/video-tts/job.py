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

# 影响原生音频身份的配置键：变化意味着旧分块/克隆条件不能再复用，
# 必须开新任务（未变内容仍经内容寻址缓存命中），不能以 resume 静默改道。
IDENTITY_CONFIG_KEYS = (
    "provider", "voice", "design", "ref_text", "instruct", "lang",
    "model", "style",
)
# 只影响加工 / 发布的配置键：变化允许 resume，原生音频全部复用。
PROCESSING_CONFIG_KEYS = (
    "timing_mode", "overflow_policy", "master_sample_rate",
    "max_speed", "warn_speed",
)

# 报告 / manifest 里记录的状态枚举（spec §14）。
STATUSES = (
    "planned", "preparing", "synthesizing", "processing", "exporting",
    "complete", "completed_with_warnings", "needs_attention", "partial",
    "failed", "cancelled", "submission_unknown", "download_failed",
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
        """兼容入口：等价于 `reconcile_resume` 只取阻断项（旧测试用）。"""
        blockers, _, _ = self.reconcile_resume(
            srt_sha, plan_sha, ref_sha, {}
        )
        # 空 config 会让全部身份键都「变化」；这里只比较输入指纹。
        return blockers

    def reconcile_resume(
        self,
        srt_sha: str,
        plan_sha: str | None,
        ref_sha: str | None,
        config: dict,
    ) -> tuple[list[str], list[str], bool]:
        """按 spec §13.1 对账恢复条件。

        返回 `(blockers, revisions, plan_changed)`：

        - blockers 非空 → 不能恢复：SRT 变化、克隆参考身份变化（含
          「移除参考参数」——新值为空同样是配置变化，不得绕过校验）、
          影响合成身份的配置（provider / 音色 / design / ref_text /
          语气 / 语言 / 模型 / 采样参数）变化，或移除了原任务的计划。
        - revisions 是允许的修订说明：计划修订（F03：修改计划后可以
          resume，不再「一修改就拒绝」）与加工参数修订。
        - plan_changed 表示分组结构变化，调用方需重建 groups（收据作废，
          未变组经内容寻址缓存复用）。
        """
        blockers: list[str] = []
        revisions: list[str] = []
        plan_changed = False

        old_srt = self.fingerprint("srt_sha256")
        if not old_srt:
            blockers.append(
                "原任务缺少 srt_sha256 输入指纹（旧版 manifest）；请开新任务"
            )
        elif old_srt != srt_sha:
            blockers.append(
                "SRT 内容与原任务不一致（srt_sha256 变化）；请为新 SRT 开"
                "新任务（未变内容仍会经缓存复用），或改回原 SRT 再 resume"
            )

        old_ref = self.fingerprint("ref_audio_sha256")
        new_ref = ref_sha or ""
        if bool(old_ref) != bool(new_ref) or (old_ref and old_ref != new_ref):
            blockers.append(
                "克隆参考配置与原任务不一致（原任务"
                f"{'带' if old_ref else '不带'}参考克隆，本次"
                f"{'带' if new_ref else '不带'}"
                + (
                    "，且内容哈希不同"
                    if old_ref and new_ref and old_ref != new_ref
                    else ""
                )
                + "）；音色身份已变化，请开新任务或改回原参考后 resume"
            )

        old_plan = self.fingerprint("merge_plan_sha256")
        new_plan = plan_sha or ""
        if old_plan and not new_plan:
            blockers.append(
                "原任务带 merge plan 而本次没有；移除计划属于分组结构变化，"
                "请带修订后的计划 resume，或开新任务"
            )
        elif new_plan and old_plan != new_plan:
            plan_changed = True
            revisions.append(
                "merge plan 已修订：按新计划重新验证全量覆盖，未变组的原生"
                "音频经内容寻址缓存复用，仅重合成变化内容"
            )
        elif not old_plan and not new_plan:
            pass  # 两侧都无计划：逐条结构未变

        old_config = self.payload.get("config") or {}
        for key in IDENTITY_CONFIG_KEYS:
            if old_config.get(key) != (config or {}).get(key):
                blockers.append(
                    f"合成身份配置变化：{key} 由 {old_config.get(key)!r} 变为 "
                    f"{(config or {}).get(key)!r}；请开新任务（未变内容经缓存"
                    "复用）或改回原配置 resume"
                )
        for key in PROCESSING_CONFIG_KEYS:
            if old_config.get(key) != (config or {}).get(key):
                revisions.append(
                    f"加工参数修订：{key} {old_config.get(key)!r} → "
                    f"{(config or {}).get(key)!r}；原生音频复用，仅重做加工"
                )

        return blockers, revisions, plan_changed

    def apply_revision(
        self,
        config: dict | None = None,
        groups: list[dict] | None = None,
        notes: list[str] | None = None,
    ) -> None:
        """应用允许的修订：更新配置快照与计划组，保留历史关联（F03/F04）。

        旧配置进 `config_history`（可追溯），groups 仅在计划修订时重建
        （重建后收据与逐组状态作废，靠内容寻址缓存恢复音频）。
        """
        old_config = self.payload.get("config")
        if config is not None and config != old_config:
            self.payload.setdefault("config_history", []).append(
                {"at": time.time(), "config": json.loads(
                    json.dumps(old_config or {}, ensure_ascii=False)
                )}
            )
            self.payload["config"] = config
        if groups is not None:
            self.payload["groups"] = groups
        for note in notes or []:
            self.payload.setdefault("notes", []).append(
                {"at": time.time(), "text": note}
            )

    def group_records(self) -> list[dict]:
        """返回逐组记录（计划 + 状态合并视图）。"""
        return list(self.payload.get("groups") or [])

    def update_group(self, index: int, **fields) -> None:
        """更新第 `index` 组（0 基）的状态字段；越界忽略。"""
        groups = self.payload.get("groups") or []
        if 0 <= index < len(groups) and isinstance(groups[index], dict):
            groups[index].update(fields)
