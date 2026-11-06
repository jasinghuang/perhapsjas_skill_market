import sys
from pathlib import Path

# 让 tests/ 可以 import 上级目录的 skill 模块（srt_parse 等）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
