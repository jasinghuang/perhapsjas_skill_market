"""长文件任务的进度状态：schema、原子落盘与恢复校验（需求文档 §9.2）。

恢复时同时检查输入内容（input_sha256）、任务配置（config_hash）与规则版本
（skill_revision）——仅路径相同不代表可复用；源文件被覆盖、目标语言更改、
规则升级后，旧状态不能静默沿用。
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA_VERSION = 1
SKILL_REVISION = "2026-11-08"

TASKS = {"proofread", "translate", "simplify"}
TIMING_POLICIES = {"preserve", "resegment"}
CHUNK_STATUSES = {"pending", "validated", "failed"}
STATE_STATUSES = {"pending", "running", "needs_review", "validated", "completed", "failed"}


class StateError(ValueError):
    """状态文件损坏、版本不符或字段缺失。"""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_hash(data) -> str:
    payload = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class TaskConfig:
    task: str  # proofread | translate | simplify
    target_lang: str | None
    timing_policy: str  # preserve | resegment
    terms_path: str | None
    input_format: str  # srt | md | txt
    extra: dict = field(default_factory=dict)

    def __post_init__(self):
        if self.task not in TASKS:
            raise ValueError(f"未知任务类型: {self.task!r}（可选 {sorted(TASKS)}）")
        if self.timing_policy not in TIMING_POLICIES:
            raise ValueError(f"未知时间轴策略: {self.timing_policy!r}（可选 {sorted(TIMING_POLICIES)}）")
        if self.task == "translate" and not self.target_lang:
            raise ValueError("translate 任务必须指定 target_lang")
        if self.task != "translate" and self.target_lang:
            raise ValueError(f"{self.task} 任务默认保持原语言，不应设置 target_lang")

    def to_dict(self) -> dict:
        return {
            "task": self.task,
            "target_lang": self.target_lang,
            "timing_policy": self.timing_policy,
            "terms_path": self.terms_path,
            "input_format": self.input_format,
            "extra": dict(self.extra),
        }

    def config_hash(self) -> str:
        return canonical_hash(self.to_dict())


@dataclass
class ChunkState:
    chunk_id: str
    first: int  # 源位置闭区间
    last: int
    result_path: str | None
    result_sha256: str | None
    status: str  # pending | validated | failed


@dataclass
class State:
    schema_version: int
    input_path: str
    input_sha256: str
    task_config: dict  # TaskConfig.to_dict() 的结果
    config_hash: str
    skill_revision: str
    output_path: str
    working_dir: str
    chunks: list[ChunkState] = field(default_factory=list)
    status: str = "pending"
    diagnostics: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "input_path": self.input_path,
            "input_sha256": self.input_sha256,
            "task_config": self.task_config,
            "config_hash": self.config_hash,
            "skill_revision": self.skill_revision,
            "output_path": self.output_path,
            "working_dir": self.working_dir,
            "chunks": [
                {
                    "chunk_id": c.chunk_id,
                    "first": c.first,
                    "last": c.last,
                    "result_path": c.result_path,
                    "result_sha256": c.result_sha256,
                    "status": c.status,
                }
                for c in self.chunks
            ],
            "status": self.status,
            "diagnostics": self.diagnostics,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "State":
        required = [
            "schema_version", "input_path", "input_sha256", "task_config",
            "config_hash", "skill_revision", "output_path", "working_dir",
            "chunks", "status", "diagnostics",
        ]
        missing = [k for k in required if k not in d]
        if missing:
            raise StateError(f"状态文件缺少字段: {', '.join(missing)}")
        if d["schema_version"] != SCHEMA_VERSION:
            raise StateError(
                f"状态 schema_version={d['schema_version']} 与当前 {SCHEMA_VERSION} 不符，"
                "不能混用旧状态；请新建任务"
            )
        if d["status"] not in STATE_STATUSES:
            raise StateError(f"未知任务状态: {d['status']!r}")
        chunks = []
        for c in d["chunks"]:
            if c.get("status") not in CHUNK_STATUSES:
                raise StateError(f"块 {c.get('chunk_id')!r} 状态非法: {c.get('status')!r}")
            chunks.append(
                ChunkState(
                    chunk_id=c["chunk_id"],
                    first=int(c["first"]),
                    last=int(c["last"]),
                    result_path=c.get("result_path"),
                    result_sha256=c.get("result_sha256"),
                    status=c["status"],
                )
            )
        return cls(
            schema_version=d["schema_version"],
            input_path=d["input_path"],
            input_sha256=d["input_sha256"],
            task_config=dict(d["task_config"]),
            config_hash=d["config_hash"],
            skill_revision=d["skill_revision"],
            output_path=d["output_path"],
            working_dir=d["working_dir"],
            chunks=chunks,
            status=d["status"],
            diagnostics=list(d["diagnostics"]),
        )


def save_state(state: State, path: Path) -> None:
    """原子写入：同目录 tmp + fsync + os.replace，中断不留半份状态。"""
    payload = json.dumps(state.to_dict(), ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    try:  # 目录项 fsync（Windows 不支持时忽略）
        dfd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError:
        pass


def load_state(path: Path) -> State:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as e:
        raise StateError(f"状态文件不可读: {path} ({e})") from e
    try:
        d = json.loads(raw)
    except json.JSONDecodeError as e:
        raise StateError(f"状态文件损坏（JSON 无法解析，可能写入中断）: {path} ({e})") from e
    if not isinstance(d, dict):
        raise StateError(f"状态文件顶层必须是对象: {path}")
    return State.from_dict(d)


def resume_issues(state: State, input_path: Path) -> list[str]:
    """恢复前校验：输入内容、任务配置、规则版本任一不符都给出可定位问题。"""
    issues: list[str] = []
    if not input_path.exists():
        issues.append(f"源文件不存在: {input_path}")
    else:
        actual = sha256_file(input_path)
        if actual != state.input_sha256:
            issues.append(
                f"源文件内容已变化（input_sha256 不符：状态 {state.input_sha256[:12]}… "
                f"实际 {actual[:12]}…），不能静默复用旧状态"
            )
    if state.skill_revision != SKILL_REVISION:
        issues.append(
            f"规则版本不符（状态 {state.skill_revision} / 当前 {SKILL_REVISION}），"
            "旧结果可能与新规则混用，请重新处理受影响块"
        )
    if canonical_hash(state.task_config) != state.config_hash:
        issues.append("任务配置与 config_hash 不符（配置被改动），需新建任务或重算受影响结果")
    return issues
