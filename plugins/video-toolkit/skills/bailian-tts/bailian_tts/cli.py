"""argparse 子命令 + dispatch。"""
from __future__ import annotations
import argparse
import sys


def cmd_check(args) -> int:
    """环境与鉴权检查。退出码 0=全通过,非 0=有问题。"""
    from . import bl, config
    problems = []
    # 1. requests
    try:
        import requests  # noqa: F401
    except ImportError:
        problems.append("缺少 requests: pip install requests")
    # 2. bl 鉴权
    if not bl.auth_ok():
        problems.append("bl 未鉴权: bl auth login --api-key sk-...")
    # 3. API key 可解析(供音色管理用)
    try:
        config.resolve_api_key()
        key_ok = True
    except config.ApiKeyError as e:
        key_ok = False
        problems.append(str(e))

    if problems:
        for p in problems:
            print(f"✗ {p}", file=sys.stderr)
        return 1
    print("✓ bl 已鉴权,requests 可用,API Key 已配置" if key_ok
          else "✓ 基本环境就绪")
    return 0


def build_parser() -> tuple[argparse.ArgumentParser, dict]:
    """构建 parser,返回 (parser, 命令名→func 映射)。

    func 不在 add_parser 时绑定(避免循环 import),由 main() 在 dispatch 时查映射。
    """
    p = argparse.ArgumentParser(prog="bailian-tts", description="阿里云百炼 AI 配音")
    sub = p.add_subparsers(dest="command", required=True)
    funcs: dict[str, callable] = {"check": cmd_check}

    sub.add_parser("check", help="环境与鉴权检查")

    # 合成类
    sp = sub.add_parser("synth", help="单段合成")
    sp.add_argument("--text")
    sp.add_argument("--text-file")
    sp.add_argument("--voice", required=True)
    sp.add_argument("--model")
    sp.add_argument("--out", default="output.mp3")
    sp.add_argument("--format", default="mp3", choices=["mp3", "wav", "pcm", "opus"])
    sp.add_argument("--rate", type=float)
    sp.add_argument("--pitch", type=float)
    sp.add_argument("--volume", type=int)
    sp.add_argument("--instruction")
    sp.add_argument("--language")

    sp = sub.add_parser("batch", help="多段合成")
    sp.add_argument("--input", required=True)
    sp.add_argument("--voice", required=True)
    sp.add_argument("--out-dir", default="audio")
    sp.add_argument("--concurrent", type=int, default=1)
    sp.add_argument("--format", default="mp3")

    sp = sub.add_parser("srt", help="SRT 逐条配音")
    sp.add_argument("--srt", required=True)
    sp.add_argument("--voice", required=True)
    sp.add_argument("--out-dir", default="audio")
    sp.add_argument("--format", default="mp3")
    sp.add_argument("--merge", action="store_true")

    # 音色管理类
    sp = sub.add_parser("voices", help="列系统音色")
    sp.add_argument("--language")
    sp.add_argument("--refresh", action="store_true")

    sp = sub.add_parser("clone", help="声音复刻")
    sp.add_argument("--audio")
    sp.add_argument("--url")
    sp.add_argument("--prefix", required=True)
    sp.add_argument("--target-model", default="cosyvoice-v3.5-plus")
    sp.add_argument("--language", default="zh")
    sp.add_argument("--preprocess", action="store_true")
    sp.add_argument("--max-length", type=float, default=20.0)

    sp = sub.add_parser("design", help="声音设计")
    sp.add_argument("--prompt", required=True)
    sp.add_argument("--preview-text", required=True)
    sp.add_argument("--prefix", required=True)
    sp.add_argument("--target-model", default="cosyvoice-v3.5-plus")
    sp.add_argument("--language", default="zh")
    sp.add_argument("--play", action="store_true")

    sp = sub.add_parser("list", help="列自定义音色")
    sp.add_argument("--prefix")
    sp.add_argument("--page-size", type=int, default=50)

    sp = sub.add_parser("query", help="查询单个音色")
    sp.add_argument("--voice", required=True)

    sp = sub.add_parser("delete", help="删除音色")
    sp.add_argument("--voice", required=True)
    sp.add_argument("--yes", action="store_true")

    sp = sub.add_parser("update", help="更新复刻音色")
    sp.add_argument("--voice", required=True)
    sp.add_argument("--audio")
    sp.add_argument("--url")

    return p, funcs


def main(argv: list[str] | None = None) -> int:
    from . import synth as synth_mod
    from . import voice_cmds as vc
    parser, funcs = build_parser()
    funcs.update({
        "synth": synth_mod.cmd_synth,
        "batch": synth_mod.cmd_batch,
        "srt": synth_mod.cmd_srt,
        "voices": vc.cmd_voices,
        "clone": vc.cmd_clone,
        "design": vc.cmd_design,
        "list": vc.cmd_list,
        "query": vc.cmd_query,
        "delete": vc.cmd_delete,
        "update": vc.cmd_update,
    })
    args = parser.parse_args(argv)
    func = funcs[args.command]
    return func(args) or 0
