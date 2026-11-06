import json

import pytest

from merge_plan import load_merge_plan
from srt_parse import Cue


def cue(i, start, end, text, nxt):
    return Cue(i, start, end, text, start, nxt)


def write_plan(tmp_path, groups):
    path = tmp_path / "merge.json"
    path.write_text(json.dumps({"groups": groups}, ensure_ascii=False), encoding="utf-8")
    return path


def test_merges_groups_and_joins_missing_punctuation(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "第一句", 1.0),
        cue(2, 1.0, 2.0, "第二句", 2.0),
        cue(3, 3.0, 4.0, "第三句。", 4.0),
    ]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2], [3]]), cues)
    assert [m.index for m in merged] == [1, 3]
    assert merged[0].text == "第一句，第二句"
    assert merged[0].start == 0.0
    assert merged[0].end == 2.0
    assert merged[0].next_start == 3.0
    assert merged[1].text == "第三句。"


def test_existing_punctuation_is_not_duplicated(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "第一句，", 1.0),
        cue(2, 1.0, 2.0, "第二句。", 2.0),
    ]
    merged = load_merge_plan(write_plan(tmp_path, [[1, 2]]), cues)
    assert merged[0].text == "第一句，第二句。"


def test_rejects_missing_duplicate_and_noncontiguous(tmp_path):
    cues = [
        cue(1, 0.0, 1.0, "一", 1.0),
        cue(2, 1.0, 2.0, "二", 2.0),
        cue(3, 2.0, 3.0, "三", 3.0),
    ]
    for groups in ([[1, 2]], [[1, 2, 2]], [[1, 3]], [[2, 1]]):
        with pytest.raises(ValueError):
            load_merge_plan(write_plan(tmp_path, groups), cues)
