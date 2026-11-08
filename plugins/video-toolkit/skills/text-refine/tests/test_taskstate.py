# 覆盖验收用例 A10/A11/A12 的状态层断言（见需求文档 §16.1）。
from pathlib import Path

import pytest

from taskstate import (
    SCHEMA_VERSION,
    SKILL_REVISION,
    ChunkState,
    State,
    StateError,
    TaskConfig,
    load_state,
    resume_issues,
    save_state,
    sha256_file,
)


def make_state(tmp_path: Path) -> tuple[State, Path]:
    src = tmp_path / "in.srt"
    src.write_text("1\n00:00:01,000 --> 00:00:02,000\nx\n", encoding="utf-8")
    cfg = TaskConfig(
        task="proofread",
        target_lang=None,
        timing_policy="preserve",
        terms_path=None,
        input_format="srt",
        extra={},
    )
    st = State(
        schema_version=SCHEMA_VERSION,
        input_path=str(src),
        input_sha256=sha256_file(src),
        task_config=cfg.to_dict(),
        config_hash=cfg.config_hash(),
        skill_revision=SKILL_REVISION,
        output_path=str(tmp_path / "in_refined.srt"),
        working_dir=str(tmp_path / "in_refine_work"),
        chunks=[ChunkState("chunk-0001", 1, 1, None, None, "pending")],
        status="pending",
        diagnostics=[],
    )
    return st, src


def test_save_load_roundtrip(tmp_path: Path):
    st, _ = make_state(tmp_path)
    p = tmp_path / "state.json"
    save_state(st, p)
    assert not (tmp_path / "state.json.tmp").exists()
    assert load_state(p) == st


def test_save_overwrites_existing_state(tmp_path: Path):
    st, _ = make_state(tmp_path)
    p = tmp_path / "state.json"
    p.write_text('{"schema_version": 0}', encoding="utf-8")
    save_state(st, p)
    assert load_state(p) == st


def test_load_rejects_truncated_state(tmp_path: Path):
    p = tmp_path / "state.json"
    p.write_text('{"schema_version": 1, "input_pa', encoding="utf-8")
    with pytest.raises(StateError):
        load_state(p)


def test_wrong_schema_version_raises(tmp_path: Path):
    st, _ = make_state(tmp_path)
    d = st.to_dict()
    d["schema_version"] = 99
    p = tmp_path / "state.json"
    p.write_text(__import__("json").dumps(d, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(StateError):
        load_state(p)


def test_resume_clean_when_unchanged(tmp_path: Path):
    st, src = make_state(tmp_path)
    assert resume_issues(st, src) == []


def test_resume_rejects_changed_input(tmp_path: Path):
    st, src = make_state(tmp_path)
    src.write_text("changed content", encoding="utf-8")
    issues = resume_issues(st, src)
    assert any("input_sha256" in i or "内容已变化" in i for i in issues)


def test_resume_rejects_missing_input(tmp_path: Path):
    st, src = make_state(tmp_path)
    src.unlink()
    assert any("不存在" in i or "缺失" in i for i in resume_issues(st, src))


def test_resume_flags_revision_mismatch(tmp_path: Path):
    st, src = make_state(tmp_path)
    st.skill_revision = "0000-00-00"
    assert any("skill_revision" in i or "规则版本" in i for i in resume_issues(st, src))


def test_resume_flags_config_tamper(tmp_path: Path):
    st, src = make_state(tmp_path)
    cfg = st.task_config
    cfg["target_lang"] = "en"  # 目标语言被改，但 config_hash 未更新
    assert any("config_hash" in i or "任务配置" in i for i in resume_issues(st, src))


def test_task_config_validates_enums():
    with pytest.raises(ValueError):
        TaskConfig("summarize", None, "preserve", None, "srt", {})
    with pytest.raises(ValueError):
        TaskConfig("translate", None, "auto", None, "srt", {})
