#!/usr/bin/env python3
"""
srt-html — SRT subtitle to animated HTML converter.
Converts standard SRT files to HTML pages with Karaoke-style character-by-character highlighting.
"""

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent / "templates"

PALETTES = {
    "resend": {"highlight": "#ff801f", "unhighlight": "#f0f0f0", "bar_bg": "rgba(0,0,0,0.50)"},
    "neon":   {"highlight": "#00ffaa", "unhighlight": "#2a2a3a", "bar_bg": "rgba(0,20,10,0.55)"},
    "sakura": {"highlight": "#ff6b9d", "unhighlight": "#f0e6ea", "bar_bg": "rgba(30,10,15,0.50)"},
    "ocean":  {"highlight": "#00b4d8", "unhighlight": "#caf0f8", "bar_bg": "rgba(0,10,20,0.50)"},
    "fire":   {"highlight": "#ff4500", "unhighlight": "#ffe8cc", "bar_bg": "rgba(20,5,0,0.50)"},
}


def check_jinja2():
    try:
        import jinja2
        return True
    except ImportError:
        return False


def install_jinja2():
    print("Installing jinja2...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "jinja2"])


@dataclass
class Subtitle:
    index: int
    start: float
    end: float
    text: str
    chars: list = field(default_factory=list)

    def __post_init__(self):
        text = self.text.replace("\n", " ")
        self.text = text
        self.chars = list(text)


def parse_timestamp(ts: str) -> float:
    m = re.match(r"(\d+):(\d+):(\d+)[,.](\d+)", ts.strip())
    if not m:
        raise ValueError(f"Invalid timestamp: {ts}")
    h, mi, s, ms = m.groups()
    ms = ms.ljust(3, "0")[:3]
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(ms) / 1000


def parse_srt(srt_path: Path) -> list[Subtitle]:
    content = srt_path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    subtitles = []

    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) < 3:
            continue

        try:
            index = int(lines[0].strip())
        except ValueError:
            continue

        time_match = re.match(
            r"(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)", lines[1].strip()
        )
        if not time_match:
            continue

        start = parse_timestamp(time_match.group(1))
        end = parse_timestamp(time_match.group(2))
        text = "\n".join(lines[2:]).strip()

        if text:
            subtitles.append(Subtitle(index=index, start=start, end=end, text=text))

    return subtitles


def ensure_relative(video_path: Path, output_dir: Path) -> str:
    try:
        return video_path.relative_to(output_dir).as_posix()
    except ValueError:
        return video_path.name


def render_html(
    subtitles: list[Subtitle],
    template_name: str,
    output_path: Path,
    srt_name: str,
    video_path: str | None = None,
    style_name: str = "karaoke",
    theme: dict | None = None,
    font_family: str = "FZLanTingHei",
    subtitles2: list[Subtitle] | None = None,
):
    from jinja2 import Environment, FileSystemLoader

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=True,
    )

    template = env.get_template(template_name)

    from dataclasses import asdict

    if theme is None:
        theme = PALETTES["resend"]

    html = template.render(
        subtitles=[asdict(s) for s in subtitles],
        subtitles2=[asdict(s) for s in subtitles2] if subtitles2 else None,
        srt_name=srt_name,
        video_path=video_path,
        font_family=font_family,
        font_hint=f"请在系统中安装{font_family}字体以获得最佳效果",
        style_name=style_name,
        theme=theme,
    )

    output_path.write_text(html, encoding="utf-8")
    print(f"  Saved: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Convert SRT subtitles to animated HTML",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python skill_main.py subtitle.srt
  python skill_main.py subtitle.srt --video video.mp4
  python skill_main.py subtitle.srt --video video.mp4 --lyric
  python skill_main.py subtitle.srt -o ~/Desktop
  python skill_main.py subtitle.srt --palette neon
  python skill_main.py subtitle.srt --highlight-color #00ffaa --font-family "Noto Sans SC"
  python skill_main.py subtitle.srt --srt2 en.srt
        """,
    )

    parser.add_argument("srt_file", type=str, help="Input SRT file path")
    parser.add_argument("--video", type=str, help="Video file path (generates player version)")
    parser.add_argument("--lyric", action="store_true", help="Generate lyric (standalone) version")
    parser.add_argument("--style", type=str, default="karaoke", help="Animation style name (default: karaoke)")
    parser.add_argument("--output", "-o", type=str, help="Output directory")

    # Visual params
    parser.add_argument("--palette", type=str, choices=list(PALETTES.keys()), help="Color palette preset")
    parser.add_argument("--highlight-color", type=str, help="Override highlight color (e.g. #ff0000)")
    parser.add_argument("--unhighlight-color", type=str, help="Override unhighlight color")
    parser.add_argument("--bar-bg", type=str, help="Override subtitle bar background")
    parser.add_argument("--font-family", type=str, default="FZLanTingHei", help="Font family (default: FZLanTingHei)")

    # Bilingual
    parser.add_argument("--srt2", type=str, help="Second SRT file for bilingual subtitles")

    args = parser.parse_args()

    if not check_jinja2():
        install_jinja2()

    srt_path = Path(args.srt_file).expanduser()
    if not srt_path.exists():
        print(f"Error: File not found: {srt_path}")
        sys.exit(1)

    output_dir = Path(args.output).expanduser() if args.output else srt_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    base_name = srt_path.stem

    subtitles = parse_srt(srt_path)
    if not subtitles:
        print("Error: No valid subtitles found in SRT file")
        sys.exit(1)

    # Build theme from palette + overrides
    theme = dict(PALETTES[args.palette] if args.palette else PALETTES["resend"])
    if args.highlight_color:
        theme["highlight"] = args.highlight_color
    if args.unhighlight_color:
        theme["unhighlight"] = args.unhighlight_color
    if args.bar_bg:
        theme["bar_bg"] = args.bar_bg

    # Bilingual subtitles
    subtitles2 = None
    if args.srt2:
        srt2_path = Path(args.srt2).expanduser()
        if not srt2_path.exists():
            print(f"Error: Second SRT file not found: {srt2_path}")
            sys.exit(1)
        subtitles2 = parse_srt(srt2_path)

    generate_player = bool(args.video)
    generate_lyric = args.lyric

    if not generate_player and not generate_lyric:
        generate_lyric = True

    print(f"\n{'=' * 60}")
    print(f"srt-html — SRT Subtitle to Animated HTML")
    print(f"{'=' * 60}")
    print(f"  Input:  {srt_path.name}")
    print(f"  Subtitles: {len(subtitles)} entries")
    print(f"  Style:  {args.style}")
    print(f"  Font:   {args.font_family}")
    print(f"  Palette: highlight={theme['highlight']} unhighlight={theme['unhighlight']}")
    if subtitles2:
        print(f"  SRT2:   {srt2_path.name} ({len(subtitles2)} entries)")
    if generate_player:
        print(f"  Player: {base_name}_player.html")
    if generate_lyric:
        print(f"  Lyric:  {base_name}_lyric.html")
    print(f"{'=' * 60}\n")

    render_kwargs = dict(
        subtitles=subtitles,
        srt_name=base_name,
        style_name=args.style,
        theme=theme,
        font_family=args.font_family,
        subtitles2=subtitles2,
    )

    if generate_player:
        video_path = Path(args.video).expanduser()
        video_rel = ensure_relative(video_path, output_dir)
        render_html(
            **render_kwargs,
            template_name="player.html.j2",
            output_path=output_dir / f"{base_name}_player.html",
            video_path=video_rel,
        )

    if generate_lyric:
        render_html(
            **render_kwargs,
            template_name="lyric.html.j2",
            output_path=output_dir / f"{base_name}_lyric.html",
        )

    print(f"\n{'=' * 60}")
    print(f"Done!")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
