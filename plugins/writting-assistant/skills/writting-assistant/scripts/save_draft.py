#!/usr/bin/env python3
"""
save_draft.py — 小红书文案存档脚本

用法:
    python3 scripts/save_draft.py "中文极简关键词标题" "temp_content_202605071230.txt"

输出路径格式:
    口播文案/YYYY-MM/XX-标题.md
"""

import sys
import os
import re
from datetime import datetime
from pathlib import Path


def sanitize_title(title: str) -> str:
    """将标题转为安全的文件名格式"""
    title = title.strip()
    title = re.sub(r'[\\/:*?"<>|]', '-', title)
    title = re.sub(r'-+', '-', title)
    return title


def get_next_index(output_dir: Path) -> int:
    """获取目录下下一个序号"""
    if not output_dir.exists():
        return 1
    existing = list(output_dir.glob("*.md"))
    indices = []
    for f in existing:
        match = re.match(r'^(\d+)-', f.name)
        if match:
            indices.append(int(match.group(1)))
    return max(indices, default=0) + 1


def main():
    if len(sys.argv) < 3:
        print("用法: python3 scripts/save_draft.py <标题> <临时文件路径>")
        print('示例: python3 scripts/save_draft.py "基金定投-新手入门" "temp_content_202605071230.txt"')
        sys.exit(1)

    title = sys.argv[1]
    temp_file = sys.argv[2]

    # 读取临时文件内容
    temp_path = Path(temp_file)
    if not temp_path.exists():
        print(f"错误: 临时文件不存在: {temp_file}")
        sys.exit(1)

    content = temp_path.read_text(encoding="utf-8")

    # 生成输出路径 — 保存在当前工作目录下
    now = datetime.now()
    month_dir_name = now.strftime("%Y-%m")
    output_dir = Path.cwd() / "口播文案" / month_dir_name

    # 创建目录
    output_dir.mkdir(parents=True, exist_ok=True)

    # 生成文件名
    index = get_next_index(output_dir)
    safe_title = sanitize_title(title)
    filename = f"{index:02d}-{safe_title}.md"
    output_path = output_dir / filename

    # 写入文件
    output_path.write_text(content, encoding="utf-8")

    # 删除临时文件
    temp_path.unlink()

    # 输出结果
    rel_path = output_path.relative_to(Path.cwd())
    print(f"已保存: {rel_path}")


if __name__ == "__main__":
    main()
