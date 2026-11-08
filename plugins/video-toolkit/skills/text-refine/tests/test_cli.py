# CLI 端到端：退出码契约 0/1/2/3/4 与验收用例 A05/A06/A08/A10-A14/A16。
import json
from pathlib import Path

from conftest import run_cli


def make_srt(n: int = 5, text_fmt="line {i}") -> str:
    blocks = [
        f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},900\n{text_fmt.format(i=i)}"
        for i in range(1, n + 1)
    ]
    return "\n\n".join(blocks) + "\n"


def write_result(workdir: Path, chunk_id: str, items: list[dict], mode: str | None = None) -> Path:
    payload: dict = {"chunk_id": chunk_id, "items": items}
    if mode:
        payload["mode"] = mode
    p = workdir / "model.json"
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return p


def full_flow(src: Path, task: str, *extra: str, transform=lambda ci: ci["items"]):
    """inspect → init → chunk×N → submit×N → validate → publish，返回关键输出。"""
    r, out, err = run_cli("inspect", str(src))
    assert r in (0, 1), err
    r, out, err = run_cli("init", str(src), "--task", task, *extra)
    assert r == 0, err
    wd = Path(json.loads(out)["working_dir"])
    r, out, err = run_cli("status", wd)
    assert r == 0, err
    chunk_ids = [c["chunk_id"] for c in json.loads(out)["chunks"]]
    for cid in chunk_ids:
        r, out, err = run_cli("chunk", wd, cid)
        assert r == 0, err
        ci = json.loads(out)
        items = transform(ci)
        rp = write_result(wd, cid, items)
        r, out, err = run_cli("submit", wd, cid, str(rp))
        assert r == 0, err
    r, out, err = run_cli("validate", wd)
    assert r == 0, (r, out, err)
    r, out, err = run_cli("publish", wd)
    assert r == 0, (r, out, err)
    return wd, json.loads(out)


def test_cli_happy_path_proofread(tmp_path: Path):
    src = tmp_path / "demo.srt"
    src.write_text(make_srt(5), encoding="utf-8")
    wd, pub = full_flow(src, "proofread")
    final = Path(pub["output"])
    assert final.name == "demo_refined.srt"
    assert final.read_text(encoding="utf-8") == src.read_text(encoding="utf-8")  # 恒等回填
    assert not final.read_bytes().startswith(b"\xef\xbb\xbf")
    r, out, _ = run_cli("status", wd)
    assert json.loads(out)["status"] == "completed"


def test_cli_translate_flow_changes_text_keeps_timeline(tmp_path: Path):
    src = tmp_path / "zh.srt"
    src.write_text(make_srt(3, text_fmt="第{i}句"), encoding="utf-8")
    wd, pub = full_flow(
        src, "translate", "--target-lang", "en",
        transform=lambda ci: [{"source_id": i["source_id"], "text": f"sentence {k+1}"}
                              for k, i in enumerate(ci["items"])],
    )
    final = Path(pub["output"])
    content = final.read_text(encoding="utf-8")
    assert "sentence 1" in content and "第1句" not in content
    for i in range(1, 4):
        assert f"00:00:{i:02d},000 --> 00:00:{i:02d},900" in content  # 时间轴不变


def test_cli_resume_rejects_changed_input(tmp_path: Path):
    src = tmp_path / "a.srt"
    src.write_text(make_srt(2), encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "proofread")
    wd = Path(json.loads(out)["working_dir"])
    src.write_text("内容被换掉了\n", encoding="utf-8")
    for cmd in (("status", wd), ("chunk", wd, "chunk-0001"), ("publish", wd)):
        r, out, err = run_cli(*cmd)
        assert r == 4, (cmd, r, err)


def test_cli_cjk_space_quote_paths(tmp_path: Path):
    d = tmp_path / "字幕 文件 (v2)"
    d.mkdir()
    src = d / "中文 名.srt"
    src.write_text(make_srt(2, text_fmt="第{i}句"), encoding="utf-8")
    wd, pub = full_flow(src, "proofread")
    assert Path(pub["output"]).name == "中文 名_refined.srt"


def test_cli_broken_srt_exit3(tmp_path: Path):
    src = tmp_path / "bad.srt"
    src.write_text("1\n00:00:05,000 --> 00:00:01,000\n反向时间\n", encoding="utf-8")
    r, out, err = run_cli("inspect", str(src))
    assert r == 3 and "早于" in err + out


def test_cli_inspect_overlap_warnings_exit1(tmp_path: Path):
    src = tmp_path / "ov.srt"
    src.write_text(
        "1\n00:00:01,000 --> 00:00:05,000\n前\n\n2\n00:00:04,000 --> 00:00:06,000\n后\n",
        encoding="utf-8",
    )
    r, out, _ = run_cli("inspect", str(src))
    assert r == 1
    assert any(d["code"] == "overlap_existing" for d in json.loads(out)["diagnostics"])


def test_cli_validate_detects_tampered_result(tmp_path: Path):
    src = tmp_path / "a.srt"
    src.write_text(make_srt(2), encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "proofread")
    wd = Path(json.loads(out)["working_dir"])
    r, out, _ = run_cli("chunk", wd, "chunk-0001")
    items = json.loads(out)["items"]
    rp = write_result(wd, "chunk-0001", [{"source_id": i["source_id"], "text": i["text"]} for i in items])
    assert run_cli("submit", wd, "chunk-0001", str(rp))[0] == 0
    stored = wd / "chunks" / "chunk-0001.result.json"
    stored.write_text(stored.read_text(encoding="utf-8").replace("line 1", "篡改"), encoding="utf-8")
    r, out, err = run_cli("validate", wd)
    assert r == 3 and "sha" in out + err


def test_cli_existing_output_not_overwritten(tmp_path: Path):
    src = tmp_path / "a.srt"
    src.write_text(make_srt(2), encoding="utf-8")
    pre = tmp_path / "a_refined.srt"
    pre.write_text("已有成品，不许动\n", encoding="utf-8")
    wd, pub = full_flow(src, "proofread")
    assert Path(pub["output"]).name == "a_refined_2.srt"
    assert pre.read_text(encoding="utf-8") == "已有成品，不许动\n"


def test_cli_md_flow_protects_fence(tmp_path: Path):
    src = tmp_path / "note.md"
    src.write_text(
        "# 标题\n\n一段文字 with [链接](https://a.b/c)。\n\n```bash\nrm -rf $(echo hi)\n```\n\n结尾段。\n",
        encoding="utf-8",
    )
    wd, pub = full_flow(
        src, "simplify",
        transform=lambda ci: [
            {"source_id": i["source_id"],
             "text": i["text"] + "（润色）" if "链接" in i["text"] or "结尾" in i["text"] else i["text"]}
            for i in ci["items"]
        ],
    )
    final = Path(pub["output"])
    content = final.read_text(encoding="utf-8")
    assert "```bash\nrm -rf $(echo hi)\n```" in content  # 围栏原样
    assert "[链接](https://a.b/c)" in content
    assert "结尾段。（润色）" in content
    assert content.count("（润色）") == 2  # 只有可编辑块被改


def test_cli_interrupted_resume_completes(tmp_path: Path):
    src = tmp_path / "long.srt"
    src.write_text(make_srt(5), encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "proofread", "--chunk-entries", "2")
    assert r == 0
    wd = Path(json.loads(out)["working_dir"])
    r, out, _ = run_cli("status", wd)
    st = json.loads(out)
    assert [c["chunk_id"] for c in st["chunks"]] == ["chunk-0001", "chunk-0002", "chunk-0003"]
    assert st["pending"] == ["chunk-0001", "chunk-0002", "chunk-0003"]

    # 模拟中断：只提交第一块
    r, out, _ = run_cli("chunk", wd, "chunk-0001")
    items = json.loads(out)["items"]
    rp = write_result(wd, "chunk-0001", [{"source_id": i["source_id"], "text": i["text"]} for i in items])
    assert run_cli("submit", wd, "chunk-0001", str(rp))[0] == 0
    r, out, _ = run_cli("status", wd)
    assert json.loads(out)["pending"] == ["chunk-0002", "chunk-0003"]
    assert run_cli("publish", wd)[0] == 3  # 未全齐不得发布

    # 恢复：补齐剩余块
    for cid in ["chunk-0002", "chunk-0003"]:
        r, out, _ = run_cli("chunk", wd, cid)
        items = json.loads(out)["items"]
        rp = write_result(wd, cid, [{"source_id": i["source_id"], "text": i["text"]} for i in items])
        assert run_cli("submit", wd, cid, str(rp))[0] == 0
    assert run_cli("validate", wd)[0] == 0
    r, out, _ = run_cli("publish", wd)
    assert r == 0
    assert Path(json.loads(out)["output"]).read_text(encoding="utf-8") == src.read_text(encoding="utf-8")


def test_cli_init_requires_target_lang_for_translate(tmp_path: Path):
    src = tmp_path / "a.srt"
    src.write_text(make_srt(2), encoding="utf-8")
    r, out, err = run_cli("init", str(src), "--task", "translate")
    assert r == 2 and "target-lang" in out + err


def test_cli_init_refuses_clobber_workdir(tmp_path: Path):
    src = tmp_path / "a.srt"
    src.write_text(make_srt(2), encoding="utf-8")
    assert run_cli("init", str(src), "--task", "proofread")[0] == 0
    r, out, err = run_cli("init", str(src), "--task", "proofread")
    assert r == 3 and ("工作目录" in out + err)


def test_cli_submit_rejects_bad_result(tmp_path: Path):
    src = tmp_path / "a.srt"
    src.write_text(make_srt(2), encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "proofread")
    wd = Path(json.loads(out)["working_dir"])
    rp = write_result(wd, "chunk-0001", [
        {"source_id": "entry-000001", "text": "ok"},
        {"source_id": "entry-000099", "text": "幽灵条目"},
    ])
    r, out, err = run_cli("submit", wd, "chunk-0001", str(rp))
    assert r == 3 and "entry-000099" in out + err


def test_cli_unknown_format_exit2(tmp_path: Path):
    src = tmp_path / "a.docx"
    src.write_text("x", encoding="utf-8")
    assert run_cli("inspect", str(src))[0] == 2
