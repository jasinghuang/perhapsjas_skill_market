"""音色管理命令:voices / clone / design / list / query / delete / update。"""
from __future__ import annotations
import json
import subprocess
from . import api, bl, config
from .voices_db import VoicesDB, validate_prefix


def cmd_voices(args) -> int:
    db = VoicesDB()
    model = "cosyvoice-v3-flash"
    if args.refresh:
        print("从 bl 拉取系统音色...")
        voices = bl.list_system_voices(model)
        db.set_system_voices(model, voices)
        print(f"✓ 已缓存 {len(voices)} 个系统音色")
    else:
        voices = db.data["system_voices"].get(model, [])
        if not voices:
            print("缓存为空,加 --refresh 重新拉取")
            return 1
    if args.language:
        voices = [v for v in voices if args.language in v.get("lang", "")]
    print(f"{'VOICE ID':<24} {'NAME':<12} {'LANG':<12} DESC")
    print("-" * 70)
    for v in voices:
        print(f"{v['id']:<24} {v.get('name',''):<12} {v.get('lang',''):<12} {v.get('desc','')}")
    print(f"\n共 {len(voices)} 个")
    return 0


def cmd_clone(args) -> int:
    validate_prefix(args.prefix)
    if args.audio and args.url:
        raise SystemExit("✗ --audio 与 --url 互斥")
    if args.url:
        url = args.url
    elif args.audio:
        print(f"上传 {args.audio} ...")
        try:
            url = bl.file_upload(args.audio, model=args.target_model)
        except bl.BlError as e:
            raise SystemExit(f"✗ 上传失败: {e}\n  可改用公网 URL(--url)或 OSS。")
        print(f"✓ 上传得到 URL: {url}")
    else:
        raise SystemExit("✗ 需要 --audio <本地路径> 或 --url <公网URL>")

    client = api.VoiceEnrollmentClient(config.resolve_api_key())
    print(f"提交复刻(prefix={args.prefix}, target_model={args.target_model})...")
    try:
        voice_id = client.create_clone(
            url=url, prefix=args.prefix, target_model=args.target_model,
            language=args.language, preprocess=args.preprocess,
            max_length=args.max_length,
        )
    except api.ApiError as e:
        raise SystemExit(f"✗ create_voice 失败: {e}")
    print(f"✓ 已提交,voice_id={voice_id},轮询状态...")
    try:
        status = client.poll_until_ready(voice_id, timeout=300, interval=10)
    except api.PollTimeoutError:
        raise SystemExit(f"✗ 轮询超时,稍后用 `query --voice {voice_id}` 查看")
    if status != "OK":
        raise SystemExit(f"✗ 复刻未通过审核(status={status})")
    VoicesDB().add_custom({
        "voice_id": voice_id, "prefix": args.prefix,
        "target_model": args.target_model, "type": "clone",
        "voice_prompt": None, "resource_link": url,
        "gmt_create": "", "status": status, "note": "",
    })
    print(f"✓ 复刻成功并入库: {voice_id}")
    print(f"  合成示例: python skill_main.py synth --text '测试' --voice {voice_id}")
    return 0


def cmd_design(args) -> int:
    validate_prefix(args.prefix)
    client = api.VoiceEnrollmentClient(config.resolve_api_key())
    print(f"设计音色(prefix={args.prefix}, prompt={args.prompt!r})...")
    try:
        result = client.create_design(
            prompt=args.prompt, preview_text=args.preview_text,
            prefix=args.prefix, target_model=args.target_model,
            language=args.language,
        )
    except api.ApiError as e:
        raise SystemExit(f"✗ create_voice(设计)失败: {e}")
    print(f"✓ voice_id={result.voice_id}")
    print(f"  预览音频 → {result.preview_path}")
    if args.play:
        if subprocess.run(["which", "afplay"], capture_output=True).returncode == 0:
            player = ["afplay"]
        else:
            player = ["ffplay", "-nodisp", "-autoexit"]
        print("播放预览中...")
        subprocess.run([*player, str(result.preview_path)])
    VoicesDB().add_custom({
        "voice_id": result.voice_id, "prefix": args.prefix,
        "target_model": args.target_model, "type": "design",
        "voice_prompt": args.prompt, "resource_link": None,
        "gmt_create": "", "status": "OK",
        "note": f"preview_text: {args.preview_text}",
    })
    print(f"✓ 已入库: {result.voice_id}")
    return 0


def _client():
    return api.VoiceEnrollmentClient(config.resolve_api_key())


def cmd_list(args) -> int:
    voices = _client().list_voices(prefix=args.prefix, page_size=args.page_size)
    if not voices:
        print("(无自定义音色)")
        return 0
    print(f"{'VOICE ID':<48} {'STATUS':<10} {'TARGET_MODEL'}")
    print("-" * 80)
    for v in voices:
        print(f"{v.get('voice_id',''):<48} {v.get('status',''):<10} {v.get('target_model','')}")
    print(f"\n共 {len(voices)} 个")
    return 0


def cmd_query(args) -> int:
    out = _client().query(args.voice)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def cmd_delete(args) -> int:
    if not args.yes:
        confirm = input(f"确认删除 {args.voice}?此操作不可逆 [y/N]: ").strip().lower()
        if confirm != "y":
            print("已取消")
            return 1
    _client().delete(args.voice)
    VoicesDB().remove_custom(args.voice)
    print(f"✓ 已删除 {args.voice}")
    return 0


def cmd_update(args) -> int:
    if args.audio and args.url:
        raise SystemExit("✗ --audio 与 --url 互斥")
    if args.audio:
        url = bl.file_upload(args.audio, model="cosyvoice-v3.5-plus")
    elif args.url:
        url = args.url
    else:
        raise SystemExit("✗ 需要 --audio 或 --url")
    _client().update(args.voice, url)
    print(f"✓ 已提交更新,voice_id={args.voice},新音频 URL={url}")
    return 0
