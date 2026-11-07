import sys
from pathlib import Path

# 让 tests/ 能 import 上级目录的 skill 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
