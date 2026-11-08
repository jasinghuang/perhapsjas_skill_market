#!/usr/bin/env python3
"""薄文件层：prepare 全文 → 独立 agent review-input → finish。

不调用模型、不维护逐块状态机。临时材料留在系统临时目录，成功后清理；
质量审校由宿主真实调度，本程序只核对审校记录、覆盖范围与稿件版本。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from srt_struct import SrtFormatError, parse_srt, parse_timestamp, read_text, render_srt
from textblocks import extract_inline_code, extract_link_targets, is_protected, split_blocks

FORMATS = {".srt": "srt", ".md": "md", ".markdown": "md", ".txt": "txt"}
TAGS = re.compile(r"<[^>\n]+>")
VERSION = 2


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def emit(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON 顶层必须是对象: {path}")
    return value


def source_items(text: str, fmt: str) -> tuple[list[dict], list[str]]:
    if fmt == "srt":
        doc = parse_srt(text)
        return [
            {"id": e.entry_id, "start": e.timeline_raw.split("-->")[0].strip(),
             "end": e.timeline_raw.split("-->")[1].strip().split()[0],
             "duration_ms": e.end_ms - e.start_ms, "text": e.text}
            for e in doc.entries
        ], [d.message for d in doc.diagnostics]
    if not text.strip():
        raise ValueError("输入为空")
    return [
        {"id": b.block_id, "text": b.content,
         "editable": not is_protected(b) if fmt == "md" else True}
        for b in split_blocks(text)
    ], []


def load_job(workdir: Path) -> dict:
    job = read_json(workdir / "request.json")
    if job.get("version") != VERSION or job.get("working_dir") != str(workdir.resolve()):
        raise ValueError("临时任务格式或位置不匹配，请重新 prepare")
    if digest(Path(job["input_path"]).read_bytes()) != job["source_sha256"]:
        raise ValueError("源文件内容已变化，请重新 prepare；旧译稿和审校不可复用")
    if digest(job["source_text"].encode("utf-8")) != job["snapshot_sha256"]:
        raise ValueError("临时原文快照损坏，请重新 prepare")
    return job


def prepare(args) -> int:
    source = Path(args.input).resolve()
    fmt = FORMATS.get(source.suffix.lower())
    if fmt is None:
        raise ValueError("只支持 SRT、MD、TXT")
    if args.task == "translate" and not args.target_lang:
        raise ValueError("翻译必须指定 --target-lang；未明确时先用 AskUserQuestion 询问")
    if args.task != "translate" and args.target_lang:
        raise ValueError("校对和精简默认保留原语言，不接受 --target-lang")
    if args.allow_simplify and args.task != "translate":
        raise ValueError("--allow-simplify 仅用于用户明确要求翻译并精简")
    if args.timing == "resegment" and (fmt != "srt" or not args.timing_reason):
        raise ValueError("重新分段仅用于 SRT，需用户明确选择并填写 --timing-reason")
    if args.timing == "preserve" and args.timing_reason:
        raise ValueError("preserve 不应设置 --timing-reason")
    raw = source.read_bytes()
    text = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    items, diagnostics = source_items(text, fmt)
    output = Path(args.output).resolve() if args.output else source.with_name(
        f"{source.stem}_refined{source.suffix}")
    if output == source:
        raise ValueError("输出不能覆盖源文件，请使用不同名称")
    if output.suffix.lower() != source.suffix.lower():
        raise ValueError("保持输入文件格式；格式转换请单独处理")
    terms = read_text(Path(args.terms)) if args.terms else ""
    workdir = Path(tempfile.mkdtemp(prefix="text-refine-"))
    job = {
        "version": VERSION, "working_dir": str(workdir.resolve()),
        "input_path": str(source), "output_path": str(output), "format": fmt,
        "source_sha256": digest(raw), "snapshot_sha256": digest(text.encode("utf-8")),
        "source_text": text, "task": args.task, "target_lang": args.target_lang,
        "translator_id": args.translator_id, "allow_simplify": args.allow_simplify,
        "timing": args.timing, "timing_reason": args.timing_reason,
        "terms": terms, "diagnostics": diagnostics,
    }
    try:
        (workdir / "request.json").write_text(
            json.dumps(job, ensure_ascii=False), encoding="utf-8")
    except BaseException:
        shutil.rmtree(workdir)
        raise
    emit({k: v for k, v in job.items() if k not in {"source_text", "snapshot_sha256"}}
         | {"items": items, "draft_path": str(workdir / "draft.json"),
            "review_path": str(workdir / "review.json")})
    return 0


def checked_text(value, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not value.strip() and not allow_empty) or "\x00" in value:
        raise ValueError("正文必须是非空字符串，不能含 NUL")
    return value.replace("\r\n", "\n").replace("\r", "\n")


def preserved_text(job: dict, draft: dict) -> str:
    items, _ = source_items(job["source_text"], job["format"])
    editable = {i["id"]: i for i in items if i.get("editable", True)}
    rows = draft.get("items")
    if not isinstance(rows, list):
        raise ValueError("译稿需要 items 数组")
    mapping = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("id"), str):
            raise ValueError("每条结果需要字符串 id 和 text")
        sid = row["id"]
        if sid not in editable or sid in mapping:
            raise ValueError(f"未知、重复或受保护的条目: {sid}")
        old = editable[sid]["text"]
        new = checked_text(row.get("text"), allow_empty=not old.strip())
        if job["format"] == "srt":
            if re.search(r"\n[ \t]*\n", new):
                raise ValueError(f"{sid} 正文含 SRT 条目分隔空行")
            if TAGS.findall(old) != TAGS.findall(new):
                raise ValueError(f"{sid} 样式标签或属性被改动")
        elif job["format"] == "md":
            if extract_link_targets(old) != extract_link_targets(new):
                raise ValueError(f"{sid} 链接地址被改动")
            if extract_inline_code(old) != extract_inline_code(new):
                raise ValueError(f"{sid} 行内代码被改动")
            marker = r"(?m)^\s{0,3}(#{1,6} |[-+*] |\d+[.)] |> ?|\|)"
            if re.findall(marker, old) != re.findall(marker, new):
                raise ValueError(f"{sid} Markdown 结构被改动")
        elif re.search(r"(?m)^\s*(?:#{1,6} |\*\*|> )", new) and not re.search(
                r"(?m)^\s*(?:#{1,6} |\*\*|> )", old):
            raise ValueError(f"{sid} TXT 被加入 Markdown 标记")
        mapping[sid] = new
    if set(mapping) != set(editable):
        raise ValueError("结果缺少条目: " + ", ".join(sorted(set(editable) - set(mapping))))
    if job["format"] == "srt":
        entries = parse_srt(job["source_text"]).entries
        content = render_srt(entries, mapping)
        actual = parse_srt(content).entries
        if len(actual) != len(entries) or any(
            (a.index_raw, a.timeline_raw, a.text) !=
            (b.index_raw, b.timeline_raw, mapping[b.entry_id])
            for a, b in zip(actual, entries)
        ):
            raise ValueError("结果破坏 SRT 结构")
        return content
    return "".join(mapping.get(b.block_id, b.content) + b.tail
                   for b in split_blocks(job["source_text"]))


def resegmented_text(job: dict, draft: dict) -> str:
    entries = parse_srt(job["source_text"]).entries
    by_id = {e.entry_id: e for e in entries}
    positions = {e.entry_id: i for i, e in enumerate(entries)}
    rows = draft.get("items")
    if not isinstance(rows, list) or not rows:
        raise ValueError("重新分段需要非空 items")
    seen, result, last_end, last_position = set(), [], -1, -1
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("重新分段条目必须是对象")
        ids = row.get("source_ids")
        if not isinstance(ids, list) or not ids or any(
                not isinstance(s, str) or s not in by_id for s in ids):
            raise ValueError("重新分段 source_ids 必须引用原条目")
        pos = [positions[s] for s in ids]
        if pos != list(range(pos[0], pos[-1] + 1)) or pos[0] < last_position:
            raise ValueError("重新分段必须映射连续且顺序不倒退的源条目")
        start, end = row.get("start"), row.get("end")
        if not isinstance(start, str) or not isinstance(end, str):
            raise ValueError("重新分段需要 start/end 时间字符串")
        lo, hi = parse_timestamp(start), parse_timestamp(end)
        if not (min(by_id[s].start_ms for s in ids) <= lo < hi <=
                max(by_id[s].end_ms for s in ids)) or lo < last_end:
            raise ValueError("重新分段时间越界、倒序、零时长或重叠")
        text = checked_text(row.get("text"))
        if re.search(r"\n[ \t]*\n", text):
            raise ValueError("正文含 SRT 分隔空行")
        result.append(f"{len(result) + 1}\n{start} --> {end}\n{text}")
        seen.update(ids)
        last_end, last_position = hi, pos[0]
    if seen != set(by_id):
        raise ValueError("重新分段漏掉源条目")
    content = "\n\n".join(result) + "\n"
    if TAGS.findall(content) != TAGS.findall(job["source_text"]):
        raise ValueError("重新分段改变了样式标签")
    parsed = parse_srt(content).entries
    if (parsed[0].start_ms, parsed[-1].end_ms) != (entries[0].start_ms, entries[-1].end_ms):
        raise ValueError("重新分段须保留原文首尾时间范围")
    return content


def candidate(job: dict, path: Path) -> tuple[str, str]:
    raw = path.read_bytes()
    draft = json.loads(raw.decode("utf-8"))
    if not isinstance(draft, dict):
        raise ValueError("译稿 JSON 顶层必须是对象")
    content = (resegmented_text(job, draft) if job["timing"] == "resegment"
               else preserved_text(job, draft))
    return content, digest(raw)


def review_input(args) -> int:
    job = load_job(Path(args.workdir))
    content, draft_hash = candidate(job, Path(args.draft))
    source, _ = source_items(job["source_text"], job["format"])
    emit({"source_sha256": job["source_sha256"], "draft_sha256": draft_hash,
          "translator_id": job["translator_id"], "task": job["task"],
          "target_lang": job["target_lang"], "allow_simplify": job["allow_simplify"],
          "terms": job["terms"], "timing": job["timing"],
          "timing_reason": job["timing_reason"], "source": source,
          "candidate": content, "source_count": len(source)})
    return 0


def check_review(job: dict, draft_hash: str, review: dict) -> str:
    reviewer = review.get("reviewer_id")
    if not isinstance(reviewer, str) or not reviewer.strip() or reviewer == job["translator_id"]:
        raise ValueError("需要不同于翻译者的独立 reviewer_id；自检不能代替独立审校")
    if (review.get("source_sha256"), review.get("draft_sha256")) != (
            job["source_sha256"], draft_hash):
        raise ValueError("审校对应的原文或译稿版本不匹配；修订后须独立复核")
    if review.get("verdict") != "pass" or review.get("criteria") != ["信", "达", "雅"]:
        raise ValueError("独立信达雅审校尚未通过")
    sources, _ = source_items(job["source_text"], job["format"])
    count = len(sources)
    source_ids = {i["id"] for i in sources}
    coverage = review.get("coverage")
    if not isinstance(coverage, list):
        raise ValueError("审校需要 coverage 源位置范围")
    next_position = 1
    for span in coverage:
        if (not isinstance(span, list) or len(span) != 2 or
                any(type(n) is not int for n in span) or
                span[0] != next_position or not span[0] <= span[1] <= count):
            raise ValueError("审校范围必须顺序覆盖全文，无遗漏或重复")
        next_position = span[1] + 1
    if next_position != count + 1:
        raise ValueError("独立审校未覆盖全文")
    findings = review.get("findings")
    if not isinstance(findings, list):
        raise ValueError("审校 findings 必须是数组")
    for finding in findings:
        if (not isinstance(finding, dict) or
                finding.get("severity") not in {"required", "optional"} or
                finding.get("status") not in {"open", "resolved"}):
            raise ValueError("审校问题需明确 severity(required/optional) 与 status(open/resolved)")
        locations = finding.get("source_ids")
        if (not isinstance(locations, list) or not locations or
                any(not isinstance(s, str) or s not in source_ids for s in locations) or
                finding.get("dimension") not in {"信", "达", "雅"} or
                not isinstance(finding.get("message"), str) or not finding["message"].strip() or
                not isinstance(finding.get("suggestion"), str)):
            raise ValueError("审校问题需包含有效 source_ids、信/达/雅维度、问题说明与修改建议")
        if finding["severity"] == "required" and finding["status"] != "resolved":
            raise ValueError("独立审校仍有未解决的必修问题")
    return reviewer


def publish(path: Path, content: str, overwrite: bool) -> Path:
    # 输出文件系统内临时写入；link 原子且不覆盖，避免 exists→replace 的竞态。
    fd, name = tempfile.mkstemp(prefix=".text-refine-", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if overwrite:
            os.replace(temporary, path)
            return path
        number = 1
        while True:
            target = path if number == 1 else path.with_name(f"{path.stem}_{number}{path.suffix}")
            try:
                os.link(temporary, target)
                return target
            except FileExistsError:
                number += 1
    finally:
        temporary.unlink(missing_ok=True)


def finish(args) -> int:
    workdir = Path(args.workdir).resolve()
    job = load_job(workdir)
    content, draft_hash = candidate(job, Path(args.draft))
    if job["task"] == "translate" or args.review:
        if not args.review:
            raise ValueError("翻译必须提供独立 agent 的 --review；仅结构通过不能交付")
        reviewer = check_review(job, draft_hash, read_json(Path(args.review)))
    else:
        reviewer = None
    output = Path(job["output_path"])
    if output.resolve() == Path(job["input_path"]).resolve():
        raise ValueError("输出不能覆盖源文件")
    load_job(workdir)
    final = publish(output, content, args.overwrite)
    warnings = list(job["diagnostics"])
    if job["timing_reason"] == "srt-estimate":
        warnings.append("重新分段时间为估算，未经音频或词级时间对齐")
    if workdir.parent == Path(tempfile.gettempdir()).resolve() and workdir.name.startswith("text-refine-"):
        try:
            shutil.rmtree(workdir)
        except OSError:
            warnings.append(f"临时材料清理失败: {workdir}")
    emit({"ok": True, "output": str(final), "reviewer_id": reviewer,
          "quality_review": "independent" if reviewer else "not_required", "warnings": warnings})
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="准备全文、独立审校、一次输出；中间材料不写入素材目录")
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare", help="读取全文，创建系统临时任务并输出模型材料")
    p.add_argument("input")
    p.add_argument("--task", required=True, choices=["proofread", "translate", "simplify"])
    p.add_argument("--target-lang")
    p.add_argument("--allow-simplify", action="store_true")
    p.add_argument("--translator-id", default="main")
    p.add_argument("--terms")
    p.add_argument("--output")
    p.add_argument("--timing", choices=["preserve", "resegment"], default="preserve")
    p.add_argument("--timing-reason", choices=["word-timestamps", "audio-align", "srt-estimate"])
    p.set_defaults(func=prepare)
    p = commands.add_parser("review-input", help="供独立审校 agent 一次读取原文、稿件与版本摘要")
    p.add_argument("workdir")
    p.add_argument("--draft", required=True)
    p.set_defaults(func=review_input)
    p = commands.add_parser("finish", help="验证审校和结构，一次输出；成功后清理内部临时目录")
    p.add_argument("workdir")
    p.add_argument("--draft", required=True)
    p.add_argument("--review")
    p.add_argument("--overwrite", action="store_true")
    p.set_defaults(func=finish)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (ValueError, OSError, KeyError, TypeError, SrtFormatError) as error:
        emit({"ok": False, "error": str(error)})
        return 3


if __name__ == "__main__":
    sys.exit(main())
