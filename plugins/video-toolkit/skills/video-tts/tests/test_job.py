"""F03 / A10：恢复对账规则（spec §13.1）。

- 计划修订允许 resume（修复「建议修改计划，但一修改就拒绝」的矛盾），
  分组结构变化时重建 groups，未变组靠内容寻址缓存复用。
- 移除计划 / 移除或更换参考参数是配置变化，不得因新值为空绕过身份校验。
- 影响合成身份的配置（音色 / 模型 / 语气 / 语言 / 采样参数）变化 → 阻断。
- 只影响加工的配置（制作采样率 / 时间窗 / 倍率）变化 → 允许并记修订。
"""

from __future__ import annotations

import json

from job import JobManifest

BASE_CONFIG = {
    "provider": "local",
    "voice": "Serena",
    "design": None,
    "ref_text": None,
    "instruct": "",
    "lang": "chinese",
    "model": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16",
    "timing_mode": "natural",
    "overflow_policy": "error",
    "master_sample_rate": 48000,
    "max_speed": 1.3,
    "style": {},
}

GROUPS = [
    {"source_indices": [1], "text": "第一句", "status": "ok"},
    {"source_indices": [2], "text": "第二句", "status": "pending"},
]


def _manifest(tmp_path, *, config=None, inputs=None):
    return JobManifest.create(
        tmp_path / "job.json",
        inputs=inputs or {
            "srt_sha256": "srt-hash",
            "merge_plan_sha256": "plan-hash-1",
            "ref_audio_sha256": None,
        },
        config=dict(BASE_CONFIG, **(config or {})),
        groups=[dict(group) for group in GROUPS],
    )


def test_plan_revision_is_allowed_and_rebuilds_groups(tmp_path):
    m = _manifest(tmp_path)
    blockers, revisions, plan_changed = m.reconcile_resume(
        "srt-hash", "plan-hash-2", None, BASE_CONFIG,
    )
    assert blockers == []
    assert plan_changed is True
    assert any("merge plan" in note for note in revisions)

    m.apply_revision(BASE_CONFIG, GROUPS, revisions)
    m.save("synthesizing")
    payload = json.loads((tmp_path / "job.json").read_text(encoding="utf-8"))
    assert any("merge plan" in note["text"] for note in payload["notes"])


def test_same_plan_resume_keeps_group_states(tmp_path):
    m = _manifest(tmp_path)
    blockers, revisions, plan_changed = m.reconcile_resume(
        "srt-hash", "plan-hash-1", None, BASE_CONFIG,
    )
    assert blockers == []
    assert revisions == []
    assert plan_changed is False  # groups/收据原样保留


def test_plan_removal_is_blocked(tmp_path):
    m = _manifest(tmp_path)
    blockers, _, _ = m.reconcile_resume("srt-hash", None, None, BASE_CONFIG)
    assert any("移除计划" in b or "merge plan" in b for b in blockers)


def test_ref_removal_does_not_bypass_identity_check(tmp_path):
    # F03 复现：原任务带克隆参考，本次不带 → 新值为空也必须阻断。
    m = _manifest(tmp_path, inputs={
        "srt_sha256": "srt-hash",
        "merge_plan_sha256": "plan-hash-1",
        "ref_audio_sha256": "ref-hash",
    })
    blockers, _, _ = m.reconcile_resume("srt-hash", "plan-hash-1", None, BASE_CONFIG)
    assert any("克隆参考" in b for b in blockers)


def test_ref_content_change_is_blocked(tmp_path):
    m = _manifest(tmp_path, inputs={
        "srt_sha256": "srt-hash",
        "merge_plan_sha256": "plan-hash-1",
        "ref_audio_sha256": "ref-hash-a",
    })
    blockers, _, _ = m.reconcile_resume(
        "srt-hash", "plan-hash-1", "ref-hash-b", BASE_CONFIG,
    )
    assert any("克隆参考" in b for b in blockers)


def test_identity_config_change_is_blocked(tmp_path):
    for key, value in (
        ("voice", "Vivian"),
        ("model", "other-model"),
        ("instruct", "温柔"),
        ("lang", "english"),
        ("style", {"temperature": 0.6}),
    ):
        m = _manifest(tmp_path)
        changed = dict(BASE_CONFIG, **{key: value})
        blockers, _, _ = m.reconcile_resume(
            "srt-hash", "plan-hash-1", None, changed,
        )
        assert blockers, f"{key} 变化必须阻断 resume"
        assert key in blockers[0]


def test_ref_text_change_is_blocked(tmp_path):
    m = _manifest(tmp_path, inputs={
        "srt_sha256": "srt-hash",
        "merge_plan_sha256": "plan-hash-1",
        "ref_audio_sha256": "ref-hash",
    })
    changed = dict(BASE_CONFIG, ref_text="新的参考文本")
    blockers, _, _ = m.reconcile_resume(
        "srt-hash", "plan-hash-1", "ref-hash", changed,
    )
    assert any("ref_text" in b for b in blockers)


def test_processing_change_is_allowed_and_recorded(tmp_path):
    m = _manifest(tmp_path)
    changed = dict(BASE_CONFIG, master_sample_rate=24000, max_speed=1.5)
    blockers, revisions, plan_changed = m.reconcile_resume(
        "srt-hash", "plan-hash-1", None, changed,
    )
    assert blockers == []
    assert plan_changed is False
    assert any("master_sample_rate" in note for note in revisions)
    assert any("max_speed" in note for note in revisions)

    m.apply_revision(config=changed, notes=revisions)
    assert m.payload["config"]["master_sample_rate"] == 24000
    # 旧配置进历史，可追溯（F04）。
    assert m.payload["config_history"][0]["config"]["master_sample_rate"] == 48000


def test_missing_srt_fingerprint_blocks_legacy_manifest(tmp_path):
    m = _manifest(tmp_path, inputs={"srt_sha256": None})
    blockers, _, _ = m.reconcile_resume(
        "srt-hash", "plan-hash-1", None, BASE_CONFIG,
    )
    assert any("srt_sha256" in b for b in blockers)
