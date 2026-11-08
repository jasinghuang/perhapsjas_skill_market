import json
from pathlib import Path

import pytest

from merge_plan import load_merge_plan, plan_payload
from srt_parse import Cue


def cue(i, start, end, text, nxt):
    return Cue(i, start, end, text, start, nxt)


def write_plan(target, groups, srt_sha256="hash", **extra):
    """把计划写进 target（目录或 .json 路径），返回计划文件路径。

    F13 后计划必须带 srt_sha256（默认占位值）；传 None 显式省略。
    """
    path = Path(target)
    if path.suffix != ".json":
        path = path / "merge.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"groups": groups, **extra}
    if srt_sha256 is not None:
        payload["srt_sha256"] = srt_sha256
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def test_merges_groups_without_inserting_punctuation(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "第一句", 1.0),
        cue(2, 1.0, 2.0, "第二句", 2.0),
        cue(3, 3.0, 4.0, "第三句。", 4.0),
    ]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2], [3]]), cues)
    assert [m.index for m in merged] == [1, 3]
    # 直接拼接：不再无条件补逗号（spec §8）。
    assert merged[0].text == "第一句第二句"
    assert merged[0].start == 0.0
    assert merged[0].end == 2.0
    assert merged[0].next_start == 3.0
    assert merged[0].source_indices == (1, 2)
    assert merged[1].text == "第三句。"
    assert merged[1].source_indices == (3,)


def test_word_split_fragments_join_without_comma(tmp_path):
    # 「这个模」+「型很好」必须成为完整词，不能插逗号（T18）。
    cues = [
        cue(1, 0.0, 1.0, "这个模", 1.0),
        cue(2, 1.0, 2.0, "型很好", 2.0),
    ]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2]]), cues)
    assert merged[0].text == "这个模型很好"


def test_ascii_neighbors_get_a_single_space(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "hello", 1.0),
        cue(2, 1.0, 2.0, "world", 2.0),
    ]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2]]), cues)
    assert merged[0].text == "hello world"


def test_existing_punctuation_is_kept_as_is(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "第一句，", 1.0),
        cue(2, 1.0, 2.0, "第二句。", 2.0),
    ]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2]]), cues)
    assert merged[0].text == "第一句，第二句。"


def test_group_text_override_replaces_joined_text(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "很长的第一句，", 1.0),
        cue(2, 1.0, 2.0, "很长的第二句。", 2.0),
    ]
    plan = [{"indices": [1, 2], "text": "精简后的句子。"}]
    # F08：改文需要计划声明授权 + 调用方显式 allow_text_edits 双重确认。
    path = write_plan(tmp_path, plan, text_edit_authorized=True)
    merged = load_merge_plan(path, cues, allow_text_edits=True)
    assert merged[0].text == "精简后的句子。"
    assert merged[0].start == 0.0 and merged[0].end == 2.0
    assert merged[0].text_edited is True


def test_unauthorized_text_override_is_rejected(tmp_path):
    # F08 复现：不带授权标记的 text override 不得替换正文。
    cues = [cue(1, 0.0, 1.0, "原文。", 1.0)]
    plan = [{"indices": [1], "text": "被换掉的整句。"}]
    with pytest.raises(ValueError, match="text_edit_authorized"):
        load_merge_plan(write_plan(tmp_path, plan), cues)


def test_authorized_override_without_cli_flag_is_rejected(tmp_path):
    # F08：宿主声明了授权，但 CLI 没给 --allow-text-edits 也不生效。
    cues = [cue(1, 0.0, 1.0, "原文。", 1.0)]
    plan = [{"indices": [1], "text": "改写后的句子。"}]
    path = write_plan(tmp_path, plan, text_edit_authorized=True)
    with pytest.raises(ValueError, match="--allow-text-edits"):
        load_merge_plan(path, cues)


def test_plain_plan_marks_no_text_edited(tmp_path):
    cues = [cue(1, 0.0, 1.0, "一", 1.0), cue(2, 1.0, 2.0, "二", 2.0)]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2]]), cues)
    assert merged[0].text_edited is False


def test_rejects_missing_duplicate_and_noncontiguous(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "一", 1.0),
        cue(2, 1.0, 2.0, "二", 2.0),
        cue(3, 2.0, 3.0, "三", 3.0),
    ]
    for groups in ([[1, 2]], [[1, 2, 2]], [[1, 3]], [[2, 1]]):
        with pytest.raises(ValueError):
            load_merge_plan(write_plan(tmp_path, groups), cues)


def test_srt_hash_mismatch_rejects_plan(tmp_path):
    cues = [cue(1, 0.0, 1.0, "一", 1.0), cue(2, 1.0, 2.0, "二", 2.0)]
    plan = write_plan(tmp_path, [[1], [2]], srt_sha256="deadbeef")
    with pytest.raises(ValueError, match="srt_sha256"):
        load_merge_plan(plan, cues, srt_sha256="cafebabe")
    # 哈希一致时正常加载。
    assert len(load_merge_plan(plan, cues, srt_sha256="deadbeef")) == 2


def test_plan_without_hash_is_rejected(tmp_path):
    # F13：源绑定必填——不带 srt_sha256 的计划不可加载。
    cues = [cue(1, 0.0, 1.0, "一", 1.0)]
    plan = write_plan(tmp_path, [[1]], srt_sha256=None)
    with pytest.raises(ValueError, match="srt_sha256"):
        load_merge_plan(plan, cues)


def test_write_plan_output_round_trips_as_merge_plan(tmp_path):
    # F13 复现：--write-plan 产物（source_indices 键）必须能直接作为
    # --merge-plan 输入读回（原来一边写 source_indices、一边只认 indices）。
    srt = tmp_path / "a.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n一\n\n"
        "2\n00:00:01,000 --> 00:00:02,000\n二\n",
        encoding="utf-8",
    )
    cues = [cue(1, 0.0, 1.0, "一", 1.0), cue(2, 1.0, 2.0, "二", 2.0)]
    merged = load_merge_plan(write_plan(tmp_path / "p", [[1, 2]]), cues)
    payload = plan_payload(merged, srt)
    written = tmp_path / "roundtrip.json"
    written.write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    reloaded = load_merge_plan(written, cues)
    assert [c.text for c in reloaded] == ["一二"]
    assert reloaded[0].source_indices == (1, 2)


def test_plan_payload_records_source_indices_and_hash(tmp_path):
    srt = tmp_path / "a.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\n一\n", encoding="utf-8")
    cues = [cue(1, 0.0, 1.0, "一", 1.5), cue(2, 1.5, 2.0, "二", 2.0)]
    merged = load_merge_plan(write_plan(tmp_path / "p", [[1, 2]]), cues)
    payload = plan_payload(merged, srt)
    assert payload["srt_sha256"] == plan_payload(merged, srt)["srt_sha256"]
    assert payload["groups"][0]["source_indices"] == [1, 2]
    assert payload["groups"][0]["text"] == "一二"
    assert payload["groups"][0]["start"] == 0.0
    assert payload["groups"][0]["end"] == 2.0
