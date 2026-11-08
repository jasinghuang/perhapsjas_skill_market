#!/usr/bin/env python3
"""text-refine 结构化文件管线 CLI。

宿主语言模型负责改正文；本 CLI 负责结构解析、分块、校验、可靠落盘与发布。

退出码（单点定义，与 references/file-interface.md 保持同步）:
  0  成功
  1  成功，但带非阻塞警告/疑点（如输入既有的时间重叠）
  2  用法错误（参数缺失/取值非法、不支持的输入格式）
  3  阻塞失败（解析失败、块校验不过、未授权覆盖、有块未提交）
  4  状态陈旧或损坏（源文件变化、配置/规则版本不符、state.json 损坏）

约定：stdout 始终输出本命令结果的 JSON（含失败时的 {"ok": false, ...}），
stderr 输出一行人类可读摘要；调用方不得仅凭输出文件存在判断成功。
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

# 支持直接从 skill 目录运行（python skill_main.py …），也支持 pytest 导入
sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline import (  # noqa: E402
    ChunkDef,
    SubmitError,
    ValidationReport,
    assemble_resegment,
    assemble_srt,
    assemble_text,
    load_chunk_results,
    plan_chunks,
    publish,
    render_chunk_input_srt,
    render_chunk_input_text,
    result_sha,
    submit_chunk_resegment,
    submit_chunk_srt,
    submit_chunk_text,
    validate_full_srt,
    validate_full_text,
)
from srt_struct import SrtEntry, SrtFormatError, parse_srt, read_text  # noqa: E402
from taskstate import (  # noqa: E402
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
from textblocks import TextBlock, is_protected, split_blocks  # noqa: E402

EXIT_OK, EXIT_WARNINGS, EXIT_USAGE, EXIT_BLOCKED, EXIT_STALE = 0, 1, 2, 3, 4

_FORMAT_BY_SUFFIX = {".srt": "srt", ".md": "md", ".markdown": "md", ".txt": "txt"}


def _emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def _fail(code: int, message: str, **extra) -> int:
    payload = {"ok": False, "error": message, **extra}
    _emit(payload)
    print(f"[text-refine] {message}", file=sys.stderr)
    return code


def _detect_format(path: Path) -> str | None:
    return _FORMAT_BY_SUFFIX.get(path.suffix.lower())


def _source_kind(state: State) -> str:
    return "srt" if state.task_config["input_format"] == "srt" else "text"


def _load_source(state: State) -> tuple[list[SrtEntry] | list[TextBlock], str]:
    """按状态记录的格式重新解析源文件（sha 已由 resume_issues 校验）。"""
    path = Path(state.input_path)
    kind = _source_kind(state)
    if kind == "srt":
        return parse_srt(read_text(path)).entries, kind
    return split_blocks(read_text(path)), kind


def _load_state(workdir: Path) -> State | None:
    try:
        return load_state(workdir / "state.json")
    except StateError as e:
        _fail(EXIT_STALE, f"状态不可用: {e}")
        return None


def _guard_resume(state: State) -> int | None:
    issues = resume_issues(state, Path(state.input_path))
    if issues:
        return _fail(EXIT_STALE, "状态与当前输入不一致，不能静默复用", issues=issues)
    return None


def _chunk_defs(state: State) -> list[ChunkDef]:
    return [ChunkDef(c.chunk_id, c.first, c.last) for c in state.chunks]


def _find_chunk(state: State, chunk_id: str) -> ChunkDef | None:
    for d in _chunk_defs(state):
        if d.chunk_id == chunk_id:
            return d
    return None


def _diagnostics_to_dicts(diags) -> list[dict]:
    return [dataclasses.asdict(d) for d in diags]


# ---------- 子命令 ----------

def cmd_inspect(args) -> int:
    path = Path(args.input)
    fmt = _detect_format(path)
    if fmt is None:
        return _fail(EXIT_USAGE, f"不支持的输入格式: {path.suffix or '(无扩展名)'}（支持 .srt/.md/.txt）")
    try:
        text = read_text(path)
    except OSError as e:
        return _fail(EXIT_BLOCKED, f"文件不可读: {e}")
    if fmt == "srt":
        try:
            doc = parse_srt(text)
        except SrtFormatError as e:
            return _fail(EXIT_BLOCKED, f"SRT 解析失败: {e}", entry_id=getattr(e, "entry_id", None))
        diags = _diagnostics_to_dicts(doc.diagnostics)
        _emit({"ok": True, "format": "srt", "entries": len(doc.entries), "diagnostics": diags})
        return EXIT_WARNINGS if diags else EXIT_OK
    blocks = split_blocks(text)
    kinds: dict[str, int] = {}
    for b in blocks:
        kinds[b.kind] = kinds.get(b.kind, 0) + 1
    _emit({
        "ok": True,
        "format": fmt,
        "blocks": len(blocks),
        "kinds": kinds,
        "editable_blocks": sum(1 for b in blocks if not is_protected(b)),
    })
    return EXIT_OK


def cmd_init(args) -> int:
    path = Path(args.input)
    fmt = _detect_format(path)
    if fmt is None:
        return _fail(EXIT_USAGE, f"不支持的输入格式: {path.suffix}（支持 .srt/.md/.txt）")
    if args.task == "translate" and not args.target_lang:
        return _fail(EXIT_USAGE, "translate 任务需要 --target-lang（未明确目标语言时先询问用户，推荐中文）")
    if args.task != "translate" and args.target_lang:
        return _fail(EXIT_USAGE, f"{args.task} 默认保持原语言，不应设置 --target-lang")
    if args.timing != "preserve" and not args.timing_reason:
        return _fail(EXIT_USAGE, "重新分段需要用户明确要求；请以 --timing-reason 记录时间来源（word-timestamps/audio-align/srt-estimate）")

    try:
        text = read_text(path)
        if fmt == "srt":
            doc = parse_srt(text)
            n_items, diags = len(doc.entries), _diagnostics_to_dicts(doc.diagnostics)
        else:
            blocks = split_blocks(text)
            n_items, diags = len(blocks), []
    except (OSError, SrtFormatError) as e:
        return _fail(EXIT_BLOCKED, f"输入解析失败: {e}")

    try:
        cfg = TaskConfig(
            task=args.task,
            target_lang=args.target_lang,
            timing_policy=args.timing,
            terms_path=str(Path(args.terms).resolve()) if args.terms else None,
            input_format=fmt,
            extra={"timing_reason": args.timing_reason} if args.timing_reason else {},
        )
    except ValueError as e:
        return _fail(EXIT_USAGE, str(e))

    output = Path(args.output) if args.output else path.with_name(f"{path.stem}_refined{path.suffix}")
    workdir = output.parent / f"{path.stem}_refine_work"
    if workdir.exists():
        return _fail(
            EXIT_BLOCKED,
            f"工作目录已存在: {workdir}（用 status 查看进度并继续，或删除后重建；不会自动覆盖）",
        )

    chunk_defs = plan_chunks(n_items, args.chunk_entries)
    state = State(
        schema_version=SCHEMA_VERSION,
        input_path=str(path.resolve()),
        input_sha256=sha256_file(path),
        task_config=cfg.to_dict(),
        config_hash=cfg.config_hash(),
        skill_revision=SKILL_REVISION,
        output_path=str(output),
        working_dir=str(workdir),
        chunks=[
            ChunkState(d.chunk_id, d.first, d.last, None, None, "pending") for d in chunk_defs
        ],
        status="pending",
        diagnostics=diags,
    )
    (workdir / "chunks").mkdir(parents=True, exist_ok=True)
    save_state(state, workdir / "state.json")
    _emit({
        "ok": True,
        "working_dir": str(workdir),
        "output_path": str(output),
        "items": n_items,
        "chunks": [d.chunk_id for d in chunk_defs],
        "task": cfg.task,
        "target_lang": cfg.target_lang,
        "timing_policy": cfg.timing_policy,
    })
    return EXIT_OK


def cmd_chunk(args) -> int:
    workdir = Path(args.workdir)
    state = _load_state(workdir)
    if state is None:
        return EXIT_STALE
    guard = _guard_resume(state)
    if guard is not None:
        return guard
    chunk = _find_chunk(state, args.chunk_id)
    if chunk is None:
        return _fail(EXIT_BLOCKED, f"块不存在: {args.chunk_id}（可用: {[c.chunk_id for c in state.chunks]}）")
    source, kind = _load_source(state)
    if kind == "srt":
        ci = render_chunk_input_srt(source, chunk, context=args.context)
    else:
        ci = render_chunk_input_text(source, chunk, context=args.context)
    _emit({
        "ok": True,
        "task": state.task_config["task"],
        "target_lang": state.task_config.get("target_lang"),
        "timing_policy": state.task_config["timing_policy"],
        "note": "context_before/context_after 只读，不得出现在提交结果中",
        **ci,
    })
    return EXIT_OK


def cmd_submit(args) -> int:
    workdir = Path(args.workdir)
    state = _load_state(workdir)
    if state is None:
        return EXIT_STALE
    guard = _guard_resume(state)
    if guard is not None:
        return guard
    chunk = _find_chunk(state, args.chunk_id)
    if chunk is None:
        return _fail(EXIT_BLOCKED, f"块不存在: {args.chunk_id}")
    if args.chunk_id in [c.chunk_id for c in state.chunks if c.status == "validated"]:
        return _fail(EXIT_BLOCKED, f"块 {args.chunk_id} 已提交且校验通过；重做请先处理对应结果文件")

    try:
        raw = Path(args.result).read_bytes()
        payload = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        return _fail(EXIT_BLOCKED, f"结果文件不可用: {e}")

    is_resegment = payload.get("mode") == "resegment" if isinstance(payload, dict) else False
    policy = state.task_config["timing_policy"]
    if is_resegment and policy != "resegment":
        return _fail(EXIT_BLOCKED, "任务未授权重新分段（timing_policy=preserve）；如需拆条请与用户确认后重建任务")
    if not is_resegment and policy == "resegment":
        return _fail(EXIT_BLOCKED, "本任务为重新分段模式，结果必须带 \"mode\": \"resegment\"")

    source, kind = _load_source(state)
    try:
        if is_resegment:
            submit_chunk_resegment(source, chunk, payload)
        elif kind == "srt":
            submit_chunk_srt(source, chunk, payload)
        else:
            submit_chunk_text(source, chunk, payload, allow_inline_code_edit=args.allow_inline_code_edit)
    except SubmitError as e:
        return _fail(EXIT_BLOCKED, f"块 {args.chunk_id} 校验失败", issues=e.issues)

    result_path = workdir / "chunks" / f"{args.chunk_id}.result.json"
    result_path.write_bytes(raw)  # 原样落盘（正文是数据，不经 shell）

    for c in state.chunks:
        if c.chunk_id == args.chunk_id:
            c.result_path = str(result_path)
            c.result_sha256 = result_sha(raw)
            c.status = "validated"
    if state.status == "pending":
        state.status = "running"
    save_state(state, workdir / "state.json")
    _emit({"ok": True, "chunk_id": args.chunk_id, "status": "validated"})
    return EXIT_OK


def _run_validation(state: State, workdir: Path):
    """全量校验，返回 (report_dict, 组装产物)。内部复用，不打印。"""
    source, kind = _load_source(state)
    pending = [c.chunk_id for c in state.chunks if c.status != "validated"]
    blockers = [f"块未提交: {', '.join(pending)}"] if pending else []
    loaded, load_issues = load_chunk_results(state, workdir)
    blockers.extend(load_issues)

    merged: dict[str, str] = {}
    new_entries = []
    policy = state.task_config["timing_policy"]
    if policy == "resegment":
        report = ValidationReport(blockers=blockers)
        if not blockers:
            coverage: dict[str, int] = {}
            expected_all = [e.entry_id for e in source]
            for chunk, payload in loaded:
                try:
                    nes = submit_chunk_resegment(source, chunk, payload)
                except SubmitError as e:
                    report.blockers.extend(f"[{chunk.chunk_id}] {i}" for i in e.issues)
                    continue
                new_entries.extend(nes)
                for ne in nes:
                    for sid in ne.source_ids:
                        coverage[sid] = coverage.get(sid, 0) + 1
            missing = [sid for sid in expected_all if coverage.get(sid, 0) == 0]
            if missing:
                report.blockers.append(f"源条目未被重新分段覆盖: {', '.join(missing[:5])}")
        return report, ("resegment", new_entries)

    if kind == "srt":
        report = validate_full_srt(source, loaded)
        report.blockers.extend(blockers)
        for chunk, payload in loaded:  # 重新逐块合并（validate 只报告，不返回映射）
            try:
                merged.update(submit_chunk_srt(source, chunk, payload))
            except SubmitError:
                pass
        return report, ("srt", merged)
    report = validate_full_text(source, loaded)
    report.blockers.extend(blockers)
    for chunk, payload in loaded:
        try:
            merged.update(submit_chunk_text(source, chunk, payload))
        except SubmitError:
            pass
    return report, ("text", merged)


def cmd_validate(args) -> int:
    workdir = Path(args.workdir)
    state = _load_state(workdir)
    if state is None:
        return EXIT_STALE
    guard = _guard_resume(state)
    if guard is not None:
        return guard
    report, _ = _run_validation(state, workdir)
    warnings = report.warnings + [
        d.get("message", "") for d in state.diagnostics if d.get("level") == "warning"
    ]
    out = report.to_dict()
    out["warnings"] = warnings
    _emit({"ok": report.ok, **out})
    if not report.ok:
        print(f"[text-refine] 校验未通过（{len(report.blockers)} 项阻塞）", file=sys.stderr)
        return EXIT_BLOCKED
    return EXIT_WARNINGS if warnings else EXIT_OK


def cmd_publish(args) -> int:
    workdir = Path(args.workdir)
    state = _load_state(workdir)
    if state is None:
        return EXIT_STALE
    guard = _guard_resume(state)
    if guard is not None:
        return guard
    report, (kind, product) = _run_validation(state, workdir)
    if not report.ok:
        return _fail(EXIT_BLOCKED, "校验未通过，拒绝发布", blockers=report.blockers)

    source, _ = _load_source(state)
    if kind == "resegment":
        content = assemble_resegment(source, product)
    elif kind == "srt":
        content = assemble_srt(source, product)
    else:
        content = assemble_text(source, product)

    try:
        final, created = publish(Path(state.output_path), content, overwrite=args.overwrite)
    except OSError as e:
        return _fail(EXIT_BLOCKED, f"发布失败（进度已保留，可定位重试）: {e}")

    state.status = "completed"
    save_state(state, workdir / "state.json")
    _emit({"ok": True, "output": str(final), "created": created})
    return EXIT_OK


def cmd_status(args) -> int:
    workdir = Path(args.workdir)
    state = _load_state(workdir)
    if state is None:
        return EXIT_STALE
    guard = _guard_resume(state)
    if guard is not None:
        return guard
    chunks = [{"chunk_id": c.chunk_id, "status": c.status, "range": [c.first, c.last]} for c in state.chunks]
    _emit({
        "ok": True,
        "status": state.status,
        "chunks": chunks,
        "pending": [c["chunk_id"] for c in chunks if c["status"] != "validated"],
        "input": state.input_path,
        "output": state.output_path,
    })
    return EXIT_OK


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="text-refine", description="字幕/文本校对翻译润色的结构化文件管线")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("inspect", help="检查输入：格式、条目/块数、输入诊断")
    sp.add_argument("input")
    sp.set_defaults(func=cmd_inspect)

    sp = sub.add_parser("init", help="建立任务：状态文件与分块清单")
    sp.add_argument("input")
    sp.add_argument("--task", required=True, choices=["proofread", "translate", "simplify"])
    sp.add_argument("--target-lang")
    sp.add_argument("--timing", default="preserve", choices=["preserve", "resegment"])
    sp.add_argument("--timing-reason", choices=["word-timestamps", "audio-align", "srt-estimate"],
                    help="重新分段的时间来源（resegment 必填）")
    sp.add_argument("--terms")
    sp.add_argument("--chunk-entries", type=int, default=40)
    sp.add_argument("--output")
    sp.set_defaults(func=cmd_init)

    sp = sub.add_parser("chunk", help="渲染块输入（宿主模型据此改写 items 正文）")
    sp.add_argument("workdir")
    sp.add_argument("chunk_id")
    sp.add_argument("--context", type=int, default=2)
    sp.set_defaults(func=cmd_chunk)

    sp = sub.add_parser("submit", help="接收块结果并校验落盘")
    sp.add_argument("workdir")
    sp.add_argument("chunk_id")
    sp.add_argument("result")
    sp.add_argument("--allow-inline-code-edit", action="store_true",
                    help="仅当用户明确要求翻译代码注释时使用")
    sp.set_defaults(func=cmd_submit)

    sp = sub.add_parser("validate", help="全量确定性校验")
    sp.add_argument("workdir")
    sp.set_defaults(func=cmd_validate)

    sp = sub.add_parser("publish", help="组装并原子发布（默认不覆盖已有文件）")
    sp.add_argument("workdir")
    sp.add_argument("--overwrite", action="store_true")
    sp.set_defaults(func=cmd_publish)

    sp = sub.add_parser("status", help="查看进度 / 恢复入口")
    sp.add_argument("workdir")
    sp.set_defaults(func=cmd_status)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except OSError as e:  # 统一兜底：磁盘/权限类
        return _fail(EXIT_BLOCKED, f"IO 失败: {e}")


if __name__ == "__main__":
    sys.exit(main())
