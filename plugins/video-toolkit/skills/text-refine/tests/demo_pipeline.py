#!/usr/bin/env python3
"""text-refine 可复现演示：四场景端到端（标准库，无 pytest 依赖）。

跑法：python3 tests/demo_pipeline.py
场景：
  1. 英文 SRT 原语言校对（修正拼写，保持英文与时间轴）
  2. 中文字幕翻译为英文（信息保留，时间轴不变）
  3. 中文 TXT 精简润色（不引入 Markdown 标记，事实保留）
  4. 长文件中断恢复（10 块只提交 3 块 → 模拟中断 → status 续作 → 发布）

「模型输出」以内联确定性数据模拟（真实使用中由宿主语言模型产出同格式 JSON）。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_MAIN = Path(__file__).resolve().parent.parent / "skill_main.py"

EN_PROOFREAD_SRC = "\n".join([
    "1\n00:00:01,000 --> 00:00:03,500\nWe recieved the figer from the analyst.",
    "",
    "2\n00:00:03,500 --> 00:00:06,000\nThe threashold was set to 0.5 by defalut.",
    "",
    "3\n00:00:06,000 --> 00:00:09,200\nThis variable is called threshold, not limt.",
]) + "\n"
# 模型校对输出：只改明确拼写错误；「叫做 threshold」的命名关系保留（B06）
EN_PROOFREAD_NEW = [
    "We received the figure from the analyst.",
    "The threshold was set to 0.5 by default.",
    "This variable is called threshold, not limit.",
]

ZH_TRANSLATE_SRC = "\n".join([
    "1\n00:00:01,000 --> 00:00:04,000\n这台设备的售价是 1299 元，比去年下降了 15%。",
    "",
    "2\n00:00:04,000 --> 00:00:07,500\n注意，它并不支持 Windows 11 之前的系统。",
    "",
    "3\n00:00:07,500 --> 00:00:11,000\n发布会在 3 月 18 日举行，产品叫 Spark 2.0。",
]) + "\n"
# 模型翻译输出：数字/否定/专名保真（B13）
ZH_TRANSLATE_NEW = [
    "The device sells for 1,299 yuan, 15% less than last year.",
    "Note that it does NOT support systems earlier than Windows 11.",
    "The launch event was held on March 18; the product is called Spark 2.0.",
]

ZH_SIMPLIFY_SRC = (
    "项目进度汇报。\n\n"
    "呃，那个，就是说吧，我们这个星期呢，主要是把登录模块给做完了，"
    "做完了之后呢，还顺手把那个注册页面的校验也给补上了，反正就是这两件事。\n\n"
    "下周的话，我们计划开始做支付模块，预计需要两周时间。\n"
)
# 模型精简输出：删填充词，保留事实（登录/注册校验/支付/两周）（契约：事实集合不变）
ZH_SIMPLIFY_NEW_BLOCKS = [
    "项目进度汇报。",
    "本周完成了登录模块，并补上了注册页面的校验。",
    "下周计划开始做支付模块，预计需要两周。",
]


def run_cli(*args: str) -> tuple[int, str, str]:
    proc = subprocess.run(
        [sys.executable, str(SKILL_MAIN), *args],
        capture_output=True, text=True, encoding="utf-8",
    )
    return proc.returncode, proc.stdout, proc.stderr


def timeline_lines(srt: str) -> list[str]:
    return [l for l in srt.split("\n") if "-->" in l]


def submit_all(wd: Path, chunk_ids: list[str], transform) -> None:
    for cid in chunk_ids:
        r, out, err = run_cli("chunk", wd, cid)
        assert r == 0, f"chunk {cid}: {err}"
        ci = json.loads(out)
        payload = {"chunk_id": cid, "items": transform(cid, ci["items"])}
        rp = wd / f"{cid}.model.json"
        rp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        r, out, err = run_cli("submit", wd, cid, str(rp))
        assert r == 0, f"submit {cid}: {err}\n{out}"


def check(name: str, cond: bool, detail: str = "") -> bool:
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail and not cond else ""))
    return cond


def scenario_1_proofread(tmp: Path) -> bool:
    print("场景 1：英文 SRT 原语言校对（保持英文与时间轴）")
    src = tmp / "en_notes.srt"
    src.write_text(EN_PROOFREAD_SRC, encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "proofread")
    assert r == 0, out
    wd = Path(json.loads(out)["working_dir"])
    r, out, _ = run_cli("status", wd)
    ids = [c["chunk_id"] for c in json.loads(out)["chunks"]]
    submit_all(wd, ids, lambda cid, items: [
        {"source_id": i["source_id"], "text": EN_PROOFREAD_NEW[k]}
        for k, i in enumerate(items)
    ])
    assert run_cli("validate", wd)[0] == 0
    r, out, _ = run_cli("publish", wd)
    final = Path(json.loads(out)["output"])
    content = final.read_text(encoding="utf-8")
    ok = True
    ok &= check("退出码与发布路径", r == 0 and final.name == "en_notes_refined.srt")
    ok &= check("拼写已修正", "received the figure" in content and "threshold was set" in content)
    ok &= check("保持英文（无中文字符）", not re.search(r"[一-鿿]", content))
    ok &= check("命名关系保留（called threshold）", "is called threshold" in content)
    ok &= check("时间轴逐行一致", timeline_lines(content) == timeline_lines(EN_PROOFREAD_SRC))
    ok &= check("UTF-8 无 BOM", not final.read_bytes().startswith(b"\xef\xbb\xbf"))
    return bool(ok)


def scenario_2_translate(tmp: Path) -> bool:
    print("场景 2：中文字幕翻译为英文（时间轴不变）")
    src = tmp / "zh_device.srt"
    src.write_text(ZH_TRANSLATE_SRC, encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "translate", "--target-lang", "en")
    assert r == 0, out
    wd = Path(json.loads(out)["working_dir"])
    submit_all(wd, ["chunk-0001"], lambda cid, items: [
        {"source_id": i["source_id"], "text": ZH_TRANSLATE_NEW[k]}
        for k, i in enumerate(items)
    ])
    r, out, _ = run_cli("publish", wd)
    content = Path(json.loads(out)["output"]).read_text(encoding="utf-8")
    ok = True
    ok &= check("输出为英文", "1,299 yuan" in content and "March 18" in content)
    ok &= check("否定保真（does NOT）", "does NOT support" in content)
    ok &= check("产品名保真（Spark 2.0）", "Spark 2.0" in content)
    ok &= check("时间轴逐行一致", timeline_lines(content) == timeline_lines(ZH_TRANSLATE_SRC))
    return bool(ok)


def scenario_3_simplify_txt(tmp: Path) -> bool:
    print("场景 3：中文 TXT 精简润色（不引入 Markdown）")
    src = tmp / "进度汇报.txt"
    src.write_text(ZH_SIMPLIFY_SRC, encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "simplify")
    assert r == 0, out
    wd = Path(json.loads(out)["working_dir"])
    submit_all(wd, ["chunk-0001"], lambda cid, items: [
        {"source_id": i["source_id"], "text": ZH_SIMPLIFY_NEW_BLOCKS[k]}
        for k, i in enumerate(items)
    ])
    r, out, _ = run_cli("publish", wd)
    final = Path(json.loads(out)["output"])
    content = final.read_text(encoding="utf-8")
    ok = True
    ok &= check("输出仍为 .txt", final.name == "进度汇报_refined.txt")
    ok &= check("填充词已删", "呃" not in content and "就是说吧" not in content)
    ok &= check("无 Markdown 标记", not re.search(r"(^|\n)(#{1,6} |\*\*|> )", content))
    ok &= check("事实保留（登录/注册/支付/两周）",
                all(w in content for w in ["登录", "注册", "支付", "两周"]))
    return bool(ok)


def scenario_4_interrupt_resume(tmp: Path) -> bool:
    print("场景 4：长文件中断恢复（100 条，10 块）")
    src = tmp / "long.srt"

    def fmt(total_ms: int) -> str:
        h, rem = divmod(total_ms, 3600000)
        m, rem = divmod(rem, 60000)
        s, ms = divmod(rem, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    blocks = [
        f"{i}\n{fmt(i * 1500)} --> {fmt(i * 1500 + 1200)}\n条目 {i}"
        for i in range(1, 101)
    ]
    body = "\n\n".join(blocks) + "\n"
    src.write_text(body, encoding="utf-8")
    r, out, _ = run_cli("init", str(src), "--task", "proofread", "--chunk-entries", "10")
    assert r == 0, out
    wd = Path(json.loads(out)["working_dir"])

    ident = lambda cid, items: [
        {"source_id": i["source_id"], "text": i["text"] + "（校）"} for i in items
    ]
    submit_all(wd, ["chunk-0001", "chunk-0002", "chunk-0003"], ident)  # 提交 3 块后中断
    r, out, _ = run_cli("status", wd)
    st = json.loads(out)
    ok = True
    ok &= check("中断后 status 列出 7 个 pending", len(st["pending"]) == 7)
    r, out, err = run_cli("publish", wd)
    ok &= check("未完成时拒绝发布（退出码 3）", r == 3)

    submit_all(wd, st["pending"], ident)  # 恢复：补齐剩余块
    assert run_cli("validate", wd)[0] == 0
    r, out, _ = run_cli("publish", wd)
    content = Path(json.loads(out)["output"]).read_text(encoding="utf-8")
    ok &= check("恢复后成功发布", r == 0)
    ok &= check("时间轴 100 行逐行一致", len(timeline_lines(content)) == 100 and timeline_lines(content) == timeline_lines(body))
    ok &= check("全部条目已改写（无遗漏块）", content.count("（校）") == 100)
    return bool(ok)


def main() -> int:
    results = []
    with tempfile.TemporaryDirectory(prefix="text-refine-demo-") as td:
        tmp = Path(td)
        for fn in (scenario_1_proofread, scenario_2_translate, scenario_3_simplify_txt, scenario_4_interrupt_resume):
            try:
                results.append(fn(tmp))
            except AssertionError as e:
                print(f"  [FAIL] {fn.__name__} 异常: {e}")
                results.append(False)
            print()
    passed = sum(results)
    print(f"演示结果：{passed}/4 场景通过")
    return 0 if passed == 4 else 1


if __name__ == "__main__":
    sys.exit(main())
