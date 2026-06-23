"""合成命令:synth / batch / srt。"""
from __future__ import annotations
import json
import subprocess
import time
from pathlib import Path
from . import bl
from .srt import parse_srt
from .voices_db import VoicesDB


def _read_text(args) -> str:
    if args.text and args.text_file:
        raise SystemExit("✗ --text 与 --text-file 互斥")
    if args.text:
        return args.text
    if args.text_file:
        return Path(args.text_file).read_text(encoding="utf-8")
    raise SystemExit("✗ 需要 --text 或 --text-file")


def _resolve_model(voice: str, explicit_model: str | None) -> str:
    """target_model 配对:显式 --model 优先;否则查 voices.json;未命中默认系统模型。

    未命中时默认 cosyvoice-v3-flash(bl 会校验 voice 有效性),这样首次用系统音色
    不必先 voices --refresh;自定义音色必须先入库或显式传 --model。
    """
    if explicit_model:
        return explicit_model
    return VoicesDB().target_model_for(voice) or "cosyvoice-v3-flash"


def cmd_synth(args) -> int:
    text = _read_text(args)
    model = _resolve_model(args.voice, args.model)
    bl.synth(text=text, voice=args.voice, out=args.out, model=model,
             fmt=args.format, rate=args.rate, pitch=args.pitch,
             volume=args.volume, instruction=args.instruction, language=args.language)
    print(f"✓ 合成完成(model={model})→ {args.out}")
    return 0


def _load_segments(path: str) -> list[dict]:
    """加载配音清单。兼容两种格式:
    - 通用:[{"id":"x","text":"...","voice":"<可选>"}]
    - web-video-presentation:[{"chapter":"c","step":1,"text":"..."}]
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    segs = []
    for item in data:
        if "id" in item:
            seg_id = str(item["id"])
        elif "chapter" in item and "step" in item:
            seg_id = f"{item['chapter']}/{item['step']}"
        else:
            raise SystemExit(f"✗ 清单项缺少 id 或 chapter/step: {item!r}")
        segs.append({"id": seg_id, "text": item["text"], "voice": item.get("voice")})
    return segs


def _safe_id(seg_id: str) -> str:
    """把含 / 的 id 转成文件名安全形式。"""
    return seg_id.replace("/", "__")


def _write_manifest(out_dir: Path, manifest: list, failed: list) -> None:
    (out_dir / "manifest.json").write_text(
        json.dumps({"segments": manifest, "failed": failed},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def cmd_batch(args) -> int:
    segments = _load_segments(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest, failed = [], []
    db = VoicesDB()
    for i, seg in enumerate(segments, 1):
        voice = seg["voice"] or args.voice
        model = db.target_model_for(voice) or "cosyvoice-v3-flash"
        out_file = out_dir / f"{_safe_id(seg['id'])}.{args.format}"
        if out_file.exists():
            print(f"[{i}/{len(segments)}] {seg['id']} skip (exists)")
            continue
        t0 = time.time()
        try:
            bl.synth(text=seg["text"], voice=voice, out=str(out_file),
                     model=model, fmt=args.format)
            manifest.append({"id": seg["id"], "file": str(out_file),
                             "voice": voice, "model": model,
                             "elapsed": round(time.time() - t0, 2)})
            print(f"[{i}/{len(segments)}] {seg['id']} ✓")
        except bl.BlError as e:
            failed.append({"id": seg["id"], "error": str(e)})
            print(f"[{i}/{len(segments)}] {seg['id']} ✗ FAILED: {e}", flush=True)
    _write_manifest(out_dir, manifest, failed)
    print(f"\n✓ done — {len(manifest)} ok, {len(failed)} failed. "
          f"manifest → {out_dir}/manifest.json")
    return 2 if failed else 0


def cmd_srt(args) -> int:
    subs = parse_srt(args.srt)
    if not subs:
        raise SystemExit(f"✗ SRT 无有效条目: {args.srt}")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    db = VoicesDB()
    model = db.target_model_for(args.voice) or "cosyvoice-v3-flash"
    manifest, failed = [], []
    for sub in subs:
        out_file = out_dir / f"{sub.index:04d}.{args.format}"
        try:
            bl.synth(text=sub.text, voice=args.voice, out=str(out_file),
                     model=model, fmt=args.format)
            manifest.append({"index": sub.index, "start": sub.start,
                             "end": sub.end, "text": sub.text,
                             "file": str(out_file)})
            print(f"[{sub.index}] ✓")
        except bl.BlError as e:
            failed.append({"index": sub.index, "error": str(e)})
            print(f"[{sub.index}] ✗ FAILED: {e}", flush=True)
    if args.merge:
        list_file = out_dir / "_merge.txt"
        list_file.write_text(
            "".join(f"file '{m['file']}'\n" for m in manifest),
            encoding="utf-8",
        )
        merged = out_dir / f"merged.{args.format}"
        subprocess.run(["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                        "-i", str(list_file), "-c", "copy", str(merged)],
                       check=True, capture_output=True)
        print(f"✓ merged → {merged}")
    _write_manifest(out_dir, manifest, failed)
    print(f"\n✓ done — {len(manifest)} ok, {len(failed)} failed")
    return 2 if failed else 0
