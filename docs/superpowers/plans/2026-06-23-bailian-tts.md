# bailian-tts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个基于阿里云百炼 CosyVoice 的 AI 配音与音色管理 skill,支持文本/文件/SRT/segments 合成 + 系统音色查询/声音复刻/声音设计/自定义音色库 CRUD,并产出兼容 web-video-presentation 三函数契约的 `bailian.sh` provider。

**Architecture:** Python 包 `bailian_tts/` + 入口 `skill_main.py`。双轨实现:合成与系统音色走 `bl` CLI(已封装),音色管理(复刻/设计/CRUD)直连 DashScope RESTful API(`bl` 未封装)。`voices.json` 作为音色速查表,核心解决 `target_model` 与音色强制配对的约束。`bailian.sh` 是独立 provider 文件,内部调 `bl speech synthesize`,可复制进 web-video-presentation 的 `tts-providers/`。

**Tech Stack:** Python 3、`requests`(RESTful 客户端)、`argparse`(CLI)、`subprocess`(调 bl)、`pytest`(测试)、bash(`bailian.sh` provider)。设计 spec:`docs/superpowers/specs/2026-06-23-bailian-tts-design.md`。

---

## File Structure

```
plugins/video-toolkit/skills/bailian-tts/
├── SKILL.md                     # agent 工作流引导
├── skill_main.py                # 入口:from bailian_tts.cli import main; main()
├── bailian_tts/
│   ├── __init__.py              # 空
│   ├── cli.py                   # argparse 子命令定义 + dispatch + cmd_check
│   ├── config.py                # resolve_api_key(env > bl config > 报错)、check_environment
│   ├── voices_db.py             # VoicesDB:voices.json 读写 + validate_prefix + target_model 配对
│   ├── srt.py                   # parse_srt → [{index,start,end,text}]
│   ├── bl.py                    # bl CLI 封装:bl_synth / bl_list_voices / bl_file_upload / bl_auth_ok
│   ├── api.py                   # VoiceEnrollmentClient:create/list/query/delete/update + poll_until_ready
│   ├── synth.py                 # cmd_synth / cmd_batch / cmd_srt
│   └── voice_cmds.py            # cmd_voices / cmd_clone / cmd_design / cmd_list / cmd_query / cmd_delete / cmd_update
├── bailian.sh                   # web-video-presentation provider(三函数契约)
├── voices.json                  # 音色速查表(初始含 defaults 占位)
├── requirements.txt             # requests
├── manifest.json                # skill 元数据
├── references/
│   └── voices.md                # 系统音色完整列表(按语言分组)
└── tests/
    ├── test_voices_db.py
    ├── test_srt.py
    ├── test_config.py
    └── test_api.py
```

**职责边界**:`voices_db.py` / `srt.py` / `config.py` 是纯逻辑(无 IO 副作用),严格 TDD;`bl.py` / `api.py` 是外部客户端(可 mock 测试);`synth.py` / `voice_cmds.py` 是命令编排(手动集成验证);`cli.py` 是 dispatch。

**测试策略**:纯逻辑模块用 pytest(自动化);外部客户端用 mock;命令编排用 spec 第 14 节的手动集成清单。pytest 不进 `requirements.txt`(非运行依赖),测试时单独 `pip install pytest`。

---

## Task 0: 脚手架

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/skill_main.py`
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/__init__.py`
- Create: `plugins/video-toolkit/skills/bailian-tts/requirements.txt`
- Create: `plugins/video-toolkit/skills/bailian-tts/manifest.json`
- Create: `plugins/video-toolkit/skills/bailian-tts/voices.json`

- [ ] **Step 1: 创建目录结构**

```bash
cd plugins/video-toolkit/skills
mkdir -p bailian-tts/bailian_tts bailian-tts/tests bailian-tts/references
```

- [ ] **Step 2: 写 requirements.txt**

```
requests>=2.28
```

- [ ] **Step 3: 写 manifest.json**(对齐 web-video-presentation/manifest.json 风格)

```json
{
  "name": "bailian-tts",
  "version": "0.1.0",
  "category": "Audio / TTS",
  "description": "Aliyun Bailian CosyVoice AI dubbing & voice management: synthesize from text/file/SRT/segments, query system voices, clone/design custom voices, manage custom voice library. Ships a bailian.sh provider compatible with web-video-presentation.",
  "compat": ["claude-code", "cursor", "codex-cli", "gemini-cli", "opencode"]
}
```

- [ ] **Step 4: 写初始 voices.json**(仅含默认配置,系统/自定义音色待填充)

```json
{
  "version": 1,
  "system_voices": {
    "cosyvoice-v3-flash": []
  },
  "custom_voices": [],
  "defaults": {
    "system_voice": "longxiaochun_v3",
    "target_model_for_custom": "cosyvoice-v3.5-plus"
  }
}
```

- [ ] **Step 5: 写空 `__init__.py` 与入口骨架**

`bailian_tts/__init__.py`:(空文件)

`skill_main.py`:

```python
#!/usr/bin/env python3
"""bailian-tts skill entrypoint."""
from bailian_tts.cli import main

if __name__ == "__main__":
    main()
```

(此时 `cli.py` 还没写,入口会 ImportError —— Task 6 创建 `cli.py` 后即可运行。)

- [ ] **Step 6: Commit**

```bash
git add plugins/video-toolkit/skills/bailian-tts
git commit -m "chore: scaffold bailian-tts skill directory"
```

---

## Task 1: voices_db 模块(TDD)

`VoicesDB` 封装 `voices.json` 的读写、自定义音色增删、以及**target_model 自动配对**(本 skill 最核心逻辑)。

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/voices_db.py`
- Test: `plugins/video-toolkit/skills/bailian-tts/tests/test_voices_db.py`

- [ ] **Step 1: 写失败测试**

`tests/test_voices_db.py`:

```python
import json
from pathlib import Path
import pytest
from bailian_tts.voices_db import VoicesDB, validate_prefix


def test_validate_prefix_accepts_lowercase_alnum_under_10():
    assert validate_prefix("announcer") == "announcer"
    assert validate_prefix("v01") == "v01"


def test_validate_prefix_rejects_invalid():
    with pytest.raises(ValueError):
        validate_prefix("MyVoice")   # 大写
    with pytest.raises(ValueError):
        validate_prefix("汉语")       # 非ascii
    with pytest.raises(ValueError):
        validate_prefix("abcdefghijk")  # >10 字符
    with pytest.raises(ValueError):
        validate_prefix("a-b")       # 符号


def test_load_returns_defaults_for_empty_custom(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    assert db.data["custom_voices"] == []
    assert db.data["defaults"]["system_voice"] == "longxiaochun_v3"


def test_add_and_remove_custom(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.add_custom({
        "voice_id": "cosyvoice-v3.5-plus-announcer-abc",
        "prefix": "announcer",
        "target_model": "cosyvoice-v3.5-plus",
        "type": "clone",
        "gmt_create": "2026-06-23 10:00:00",
        "status": "OK",
    })
    assert len(db.data["custom_voices"]) == 1
    # reload from disk
    db2 = VoicesDB(tmp_path / "v.json")
    assert len(db2.data["custom_voices"]) == 1
    db2.remove_custom("cosyvoice-v3.5-plus-announcer-abc")
    assert len(db2.data["custom_voices"]) == 0


def test_target_model_for_custom_voice(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.add_custom({"voice_id": "cosyvoice-v3.5-plus-announcer-abc",
                   "prefix": "announcer", "target_model": "cosyvoice-v3.5-plus",
                   "type": "clone", "gmt_create": "x", "status": "OK"})
    assert db.target_model_for("cosyvoice-v3.5-plus-announcer-abc") == "cosyvoice-v3.5-plus"


def test_target_model_for_system_voice(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    assert db.target_model_for("longxiaochun_v3") == "cosyvoice-v3-flash"


def test_target_model_for_unknown_returns_none(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    assert db.target_model_for("nonsense_voice") is None


def test_set_system_voices(tmp_path):
    db = VoicesDB(tmp_path / "v.json")
    db.set_system_voices("cosyvoice-v3-flash", [
        {"id": "longxiaochun_v3", "name": "龙小淳", "desc": "知性积极女", "lang": "中文/英文"}
    ])
    db2 = VoicesDB(tmp_path / "v.json")
    assert db2.data["system_voices"]["cosyvoice-v3-flash"][0]["id"] == "longxiaochun_v3"
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
cd plugins/video-toolkit/skills/bailian-tts
pip install pytest -q
python -m pytest tests/test_voices_db.py -v
```

Expected: 全部 FAIL(`ModuleNotFoundError: No module named 'bailian_tts'`)。

- [ ] **Step 3: 写实现**

`bailian_tts/voices_db.py`:

```python
"""voices.json 读写 + target_model 自动配对。"""
from __future__ import annotations
import json
import re
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "voices.json"
_SYSTEM_MODEL = "cosyvoice-v3-flash"

_PREFIX_RE = re.compile(r"^[a-z0-9]{1,10}$")


def validate_prefix(prefix: str) -> str:
    """校验 prefix:仅数字+小写字母,<10 字符。不合法 raise ValueError。"""
    if not _PREFIX_RE.match(prefix):
        raise ValueError(
            f"prefix 必须仅含数字和小写字母且不超过 10 字符,收到: {prefix!r}"
        )
    return prefix


class VoicesDB:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else DEFAULT_PATH
        self.data = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            self.data = {
                "version": 1,
                "system_voices": {_SYSTEM_MODEL: []},
                "custom_voices": [],
                "defaults": {
                    "system_voice": "longxiaochun_v3",
                    "target_model_for_custom": "cosyvoice-v3.5-plus",
                },
            }
            self._save()
            return self.data
        with self.path.open(encoding="utf-8") as f:
            return json.load(f)

    def _save(self) -> None:
        self.path.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # —— 自定义音色 CRUD ——
    def add_custom(self, entry: dict) -> None:
        # 去重:同 voice_id 覆盖
        self.data["custom_voices"] = [
            v for v in self.data["custom_voices"] if v["voice_id"] != entry["voice_id"]
        ]
        self.data["custom_voices"].append(entry)
        self._save()

    def remove_custom(self, voice_id: str) -> None:
        self.data["custom_voices"] = [
            v for v in self.data["custom_voices"] if v["voice_id"] != voice_id
        ]
        self._save()

    def set_system_voices(self, model: str, voices: list[dict]) -> None:
        self.data["system_voices"][model] = voices
        self._save()

    # —— target_model 配对(核心)——
    def target_model_for(self, voice_id: str) -> str | None:
        """命中自定义音色 → 其 target_model;命中系统音色 → cosyvoice-v3-flash;未知 → None。"""
        for v in self.data["custom_voices"]:
            if v["voice_id"] == voice_id:
                return v["target_model"]
        for model, voices in self.data["system_voices"].items():
            if any(v["id"] == voice_id for v in voices):
                return model
        # 系统音色库里没缓存也按命名约定认为是系统音色(bl 能合成即合法)
        return None
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
python -m pytest tests/test_voices_db.py -v
```

Expected: 全部 PASS(7 passed)。

- [ ] **Step 5: Commit**

```bash
git add bailian_tts/voices_db.py tests/test_voices_db.py
git commit -m "feat: voices_db with target_model pairing logic"
```

---

## Task 2: SRT 解析(TDD)

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/srt.py`
- Test: `plugins/video-toolkit/skills/bailian-tts/tests/test_srt.py`

- [ ] **Step 1: 写失败测试**

`tests/test_srt.py`:

```python
from bailian_tts.srt import parse_srt, Subtitle


def test_parse_standard(tmp_path):
    f = tmp_path / "a.srt"
    f.write_text(
        "1\n00:00:01,000 --> 00:00:03,000\n你好世界\n\n"
        "2\n00:00:03,500 --> 00:00:05,000\n第二句\n",
        encoding="utf-8",
    )
    subs = parse_srt(f)
    assert len(subs) == 2
    assert subs[0] == Subtitle(index=1, start=1.0, end=3.0, text="你好世界")
    assert subs[1] == Subtitle(index=2, start=3.5, end=5.0, text="第二句")


def test_parse_multiline_merged(tmp_path):
    f = tmp_path / "a.srt"
    f.write_text(
        "1\n00:00:00,000 --> 00:00:02,000\n第一行\n第二行\n",
        encoding="utf-8",
    )
    subs = parse_srt(f)
    assert subs[0].text == "第一行 第二行"   # 多行合并为一行


def test_parse_skips_empty_entries(tmp_path):
    f = tmp_path / "a.srt"
    f.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n\n\n"      # 空文本
        "2\n00:00:01,000 --> 00:00:02,000\n有效\n",
        encoding="utf-8",
    )
    subs = parse_srt(f)
    assert len(subs) == 1
    assert subs[0].text == "有效"
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
python -m pytest tests/test_srt.py -v
```

Expected: FAIL(`ModuleNotFoundError`)。

- [ ] **Step 3: 写实现**

`bailian_tts/srt.py`:

```python
"""标准 SRT 解析。多行文本合并为一行;空条目跳过。"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Subtitle:
    index: int
    start: float   # 秒
    end: float     # 秒
    text: str


def _ts_to_sec(ts: str) -> float:
    """'00:01:02,500' -> 62.5"""
    h, m, rest = ts.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def parse_srt(path: Path | str) -> list[Subtitle]:
    text = Path(path).read_text(encoding="utf-8")
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    subs: list[Subtitle] = []
    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        try:
            index = int(lines[0])
        except ValueError:
            continue
        start_str, end_str = lines[1].split(" --> ")
        body = " ".join(line.strip() for line in lines[2:] if line.strip())
        if not body:
            continue
        subs.append(Subtitle(
            index=index,
            start=_ts_to_sec(start_str.strip()),
            end=_ts_to_sec(end_str.strip()),
            text=body,
        ))
    return subs
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
python -m pytest tests/test_srt.py -v
```

Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add bailian_tts/srt.py tests/test_srt.py
git commit -m "feat: SRT parser with multiline merge"
```

---

## Task 3: config 模块 — API Key 解析(TDD)

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/config.py`
- Test: `plugins/video-toolkit/skills/bailian-tts/tests/test_config.py`

- [ ] **Step 1: 写失败测试**

`tests/test_config.py`:

```python
import json
import os
import pytest
from bailian_tts import config


def test_resolve_from_env(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-env-xxx")
    # 即使 bl config 存在,env 优先
    assert config.resolve_api_key() == "sk-env-xxx"


def test_resolve_from_bl_config(tmp_path, monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    bl_cfg = tmp_path / "config.json"
    bl_cfg.write_text(json.dumps({"api_key": {"value": "sk-bl-yyy"}}), encoding="utf-8")
    monkeypatch.setattr(config, "_bl_config_path", lambda: bl_cfg)
    assert config.resolve_api_key() == "sk-bl-yyy"


def test_resolve_missing_raises(monkeypatch, tmp_path):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.setattr(config, "_bl_config_path", lambda: tmp_path / "nope.json")
    with pytest.raises(config.ApiKeyError):
        config.resolve_api_key()
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
python -m pytest tests/test_config.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`bailian_tts/config.py`:

```python
"""API Key 解析:env > bl config.json > 报错。"""
from __future__ import annotations
import json
import os
from pathlib import Path


class ApiKeyError(RuntimeError):
    """无法解析到可用的 DashScope API Key。"""


def _bl_config_path() -> Path:
    return Path.home() / ".bailian" / "config.json"


def _read_bl_config_key() -> str | None:
    path = _bl_config_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    # 兼容几种可能的结构
    if isinstance(data.get("api_key"), dict):
        return data["api_key"].get("value")
    if isinstance(data.get("api_key"), str):
        return data["api_key"]
    if data.get("dashscope", {}).get("api_key"):
        return data["dashscope"]["api_key"]
    return None


def resolve_api_key() -> str:
    """解析顺序:DASHSCOPE_API_KEY env > bl config.json 明文 > 抛 ApiKeyError。"""
    key = os.environ.get("DASHSCOPE_API_KEY")
    if key:
        return key
    key = _read_bl_config_key()
    if key:
        return key
    raise ApiKeyError(
        "未找到 DashScope API Key。请执行 `export DASHSCOPE_API_KEY=sk-...`,"
        "或先 `bl auth login --api-key sk-...`。"
    )
```

> **注:** `bl` 的 config.json 实际字段结构以运行时 `cat ~/.bailian/config.json` 为准。若 Task 13 集成验证时发现字段名不同,修正 `_read_bl_config_key` 的兼容分支即可。此处保守覆盖三种可能结构。

- [ ] **Step 4: 运行测试,确认通过**

```bash
python -m pytest tests/test_config.py -v
```

Expected: PASS(3 passed)。

- [ ] **Step 5: Commit**

```bash
git add bailian_tts/config.py tests/test_config.py
git commit -m "feat: API key resolution from env or bl config"
```

---

## Task 4: bl CLI 封装

薄封装,调 `bl` 子进程。不写自动化测试(subprocess mock 价值低),靠 Task 17 手动集成验证。

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/bl.py`

- [ ] **Step 1: 写实现**

`bailian_tts/bl.py`:

```python
"""bl CLI 封装(subprocess)。"""
from __future__ import annotations
import json
import subprocess


class BlError(RuntimeError):
    pass


def _run(args: list[str], capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["bl", *args], capture_output=capture, text=True)


def auth_ok() -> bool:
    """bl 是否已鉴权。"""
    try:
        r = _run(["auth", "status", "--output", "json"])
    except FileNotFoundError:
        return False
    if r.returncode != 0:
        return False
    try:
        return bool(json.loads(r.stdout).get("authenticated"))
    except json.JSONDecodeError:
        return False


def list_system_voices(model: str = "cosyvoice-v3-flash") -> list[dict]:
    """返回 [{id, name, desc, lang}, ...]。"""
    r = _run(["speech", "synthesize", "--list-voices", "--model", model])
    if r.returncode != 0:
        raise BlError(r.stderr or "bl --list-voices failed")
    voices: list[dict] = []
    for line in r.stdout.splitlines():
        line = line.strip()
        # 解析形如 "longxiaochun_v3   龙小淳   知性积极女   中文/英文" 的表格行
        parts = [p for p in line.split() if p]
        if len(parts) >= 2 and parts[0] not in ("VOICE", "Total:", "System"):
            voices.append({
                "id": parts[0],
                "name": parts[1] if len(parts) > 1 else "",
                "desc": " ".join(parts[2:-1]) if len(parts) > 3 else "",
                "lang": parts[-1] if len(parts) > 1 else "",
            })
    return voices


def synth(text: str, voice: str, out: str, model: str = "cosyvoice-v3-flash",
          fmt: str = "mp3", rate: float | None = None, pitch: float | None = None,
          volume: int | None = None, instruction: str | None = None,
          language: str | None = None) -> None:
    """合成一段。失败 raise BlError(含 stderr)。"""
    args = ["speech", "synthesize", "--text", text, "--voice", voice,
            "--out", out, "--model", model, "--format", fmt]
    if rate is not None:
        args += ["--rate", str(rate)]
    if pitch is not None:
        args += ["--pitch", str(pitch)]
    if volume is not None:
        args += ["--volume", str(volume)]
    if instruction:
        args += ["--instruction", instruction]
    if language:
        args += ["--language", language]
    r = _run(args)
    if r.returncode != 0:
        raise BlError(r.stderr or f"bl speech synthesize failed (rc={r.returncode})")


def file_upload(path: str) -> str:
    """上传本地文件,返回 URL。失败 raise BlError。"""
    r = _run(["file", "upload", path, "--output", "json"])
    if r.returncode != 0:
        raise BlError(r.stderr or "bl file upload failed")
    try:
        data = json.loads(r.stdout)
        # 常见字段:url / output.url / data.url,兼容处理
        return data.get("url") or data.get("output", {}).get("url") \
            or data.get("data", {}).get("url")
    except (json.JSONDecodeError, AttributeError) as e:
        raise BlError(f"无法解析 bl file upload 输出: {r.stdout!r} ({e})")
```

> **注:** `list_system_voices` 与 `file_upload` 的输出解析基于推测的字段结构。Task 17 集成验证时若实际格式不同,修正解析逻辑(以真实 `bl ... --output json` 输出为准,优先让 bl 输出 JSON 再解析,避免文本表格解析的脆弱性)。

- [ ] **Step 2: Commit**

```bash
git add bailian_tts/bl.py
git commit -m "feat: bl CLI wrapper (synth/list-voices/upload/auth)"
```

---

## Task 5: DashScope RESTful 客户端(TDD with mock)

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/api.py`
- Test: `plugins/video-toolkit/skills/bailian-tts/tests/test_api.py`

- [ ] **Step 1: 写失败测试(mock requests)**

`tests/test_api.py`:

```python
import base64
import json
from unittest.mock import patch, MagicMock
import pytest
from bailian_tts import api


def _mock_resp(status, payload):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = payload
    m.text = json.dumps(payload)
    m.raise_for_status = MagicMock()
    if status >= 400:
        m.raise_for_status.side_effect = Exception(f"HTTP {status}")
    return m


def test_create_clone_voice(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {"output": {"voice_id": "vid-123"}})
        vid = client.create_clone(url="https://x/a.wav", prefix="myvoice",
                                  target_model="cosyvoice-v3.5-plus")
    assert vid == "vid-123"
    body = json.loads(p.call_args.kwargs["data"])
    assert body["input"]["action"] == "create_voice"
    assert body["input"]["url"] == "https://x/a.wav"
    assert body["input"]["target_model"] == "cosyvoice-v3.5-plus"


def test_create_design_voice_returns_preview(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    wav_b64 = base64.b64encode(b"fakeaudio").decode()
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {
            "output": {"voice_id": "vid-d", "preview_audio": {"data": wav_b64}}
        })
        result = client.create_design(prompt="沉稳男声", preview_text="大家好",
                                      prefix="announcer",
                                      target_model="cosyvoice-v3.5-plus")
    assert result.voice_id == "vid-d"
    assert result.preview_path.read_bytes() == b"fakeaudio"


def test_poll_until_ready(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p, \
         patch("bailian_tts.api.time.sleep"):
        p.side_effect = [
            _mock_resp(200, {"output": {"status": "DEPLOYING"}}),
            _mock_resp(200, {"output": {"status": "OK"}}),
        ]
        status = client.poll_until_ready("vid-123", timeout=60, interval=0)
    assert status == "OK"


def test_poll_timeout(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p, \
         patch("bailian_tts.api.time.sleep"):
        p.return_value = _mock_resp(200, {"output": {"status": "DEPLOYING"}})
        with pytest.raises(api.PollTimeoutError):
            client.poll_until_ready("vid-123", timeout=0.001, interval=0)


def test_list_voices(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {"output": {"voice_list": [
            {"voice_id": "v1", "status": "OK", "target_model": "cosyvoice-v3.5-plus"}
        ]}})
        voices = client.list_voices()
    assert len(voices) == 1
    assert voices[0]["voice_id"] == "v1"


def test_delete_voice(tmp_path):
    client = api.VoiceEnrollmentClient("sk-test", cache_dir=tmp_path)
    with patch("bailian_tts.api.requests.post") as p:
        p.return_value = _mock_resp(200, {"output": {}})
        client.delete("vid-1")
    body = json.loads(p.call_args.kwargs["data"])
    assert body["input"]["action"] == "delete_voice"
    assert body["input"]["voice_id"] == "vid-1"
```

- [ ] **Step 2: 运行测试,确认失败**

```bash
python -m pytest tests/test_api.py -v
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

`bailian_tts/api.py`:

```python
"""DashScope voice-enrollment RESTful 客户端。"""
from __future__ import annotations
import base64
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
import requests

_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"


class PollTimeoutError(RuntimeError):
    pass


class ApiError(RuntimeError):
    pass


@dataclass
class DesignResult:
    voice_id: str
    preview_path: Path


class VoiceEnrollmentClient:
    def __init__(self, api_key: str, cache_dir: Path | str = Path.cwd()):
        self.api_key = api_key
        self.cache_dir = Path(cache_dir)

    def _post(self, action: str, **input_fields) -> dict:
        payload = {"model": "voice-enrollment", "input": {"action": action, **input_fields}}
        resp = requests.post(
            _ENDPOINT,
            headers={"Authorization": f"Bearer {self.api_key}",
                     "Content-Type": "application/json"},
            data=__import__("json").dumps(payload),
            timeout=60,
        )
        if resp.status_code >= 400:
            raise ApiError(f"HTTP {resp.status_code}: {resp.text}")
        return resp.json()

    # —— 创建(复刻 / 设计)——
    def create_clone(self, *, url: str, prefix: str, target_model: str,
                     language: str = "zh", preprocess: bool = False,
                     max_length: float = 20.0) -> str:
        input_fields = {
            "target_model": target_model, "prefix": prefix, "url": url,
            "language_hints": [language],
        }
        if preprocess:
            input_fields["enable_preprocess"] = True
            input_fields["max_prompt_audio_length"] = max_length
        data = self._post("create_voice", **input_fields)
        return data["output"]["voice_id"]

    def create_design(self, *, prompt: str, preview_text: str, prefix: str,
                      target_model: str, language: str = "zh") -> DesignResult:
        data = self._post("create_voice",
                          target_model=target_model, prefix=prefix,
                          voice_prompt=prompt, preview_text=preview_text,
                          language_hints=[language])
        out = data["output"]
        voice_id = out["voice_id"]
        b64 = out["preview_audio"]["data"]
        preview_path = self.cache_dir / f"{voice_id}_preview.wav"
        preview_path.write_bytes(base64.b64decode(b64))
        return DesignResult(voice_id=voice_id, preview_path=preview_path)

    # —— 查询 / 轮询 ——
    def query(self, voice_id: str) -> dict:
        return self._post("query_voice", voice_id=voice_id)["output"]

    def poll_until_ready(self, voice_id: str, timeout: float = 300,
                         interval: float = 10) -> str:
        """轮询直到 status 为 OK 或 UNDEPLOYED,或超时。返回最终 status。"""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            out = self.query(voice_id)
            status = out.get("status", "DEPLOYING")
            if status in ("OK", "UNDEPLOYED"):
                return status
            time.sleep(interval)
        raise PollTimeoutError(f"轮询超时(>{timeout}s),voice_id={voice_id}")

    def list_voices(self, prefix: str | None = None,
                    page_size: int = 50) -> list[dict]:
        input_fields = {"page_size": page_size, "page_index": 0}
        if prefix:
            input_fields["prefix"] = prefix
        data = self._post("list_voice", **input_fields)
        return data["output"].get("voice_list", [])

    def update(self, voice_id: str, url: str) -> None:
        self._post("update_voice", voice_id=voice_id, url=url)

    def delete(self, voice_id: str) -> None:
        self._post("delete_voice", voice_id=voice_id)
```

- [ ] **Step 4: 运行测试,确认通过**

```bash
python -m pytest tests/test_api.py -v
```

Expected: PASS(6 passed)。

- [ ] **Step 5: Commit**

```bash
git add bailian_tts/api.py tests/test_api.py
git commit -m "feat: DashScope voice-enrollment RESTful client"
```

---

## Task 6: CLI 骨架 + check 命令

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/cli.py`

- [ ] **Step 1: 写实现**

`bailian_tts/cli.py`:

```python
"""argparse 子命令 + dispatch。"""
from __future__ import annotations
import argparse
import sys
from . import bl, config


def cmd_check(args) -> int:
    """环境与鉴权检查。退出码 0=全通过,非 0=有问题。"""
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
    print("✓ bl 已鉴权,requests 可用,API Key 已配置" if key_ok else "✓ 基本环境就绪")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="bailian-tts", description="阿里云百炼 AI 配音")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("check", help="环境与鉴权检查").set_defaults(func=cmd_check)

    # 合成类(Task 7-9 补充 func)
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

    # 音色管理类(Task 10-13 补充 func)
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

    return p


def main(argv: list[str] | None = None) -> int:
    # 延迟 import,避免循环依赖;各命令模块在自身 task 里 set_defaults(func=...)
    from . import synth as synth_mod
    from . import voice_cmds as vc
    parser = build_parser()
    # 绑定命令 func(Task 7+ 定义这些函数后生效)
    _wire_funcs(parser, synth_mod, vc)
    args = parser.parse_args(argv)
    return args.func(args) or 0


def _wire_funcs(parser, synth_mod, vc):
    """把子命令名映射到模块里的 cmd_* 函数。"""
    mapping = {
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
    }
    for sub in parser._subparsers._group_actions[0].choices.values():
        name = sub.prog.split()[-1]
        if name in mapping:
            sub.set_defaults(func=mapping[name])
    parser._subparsers._group_actions[0].choices["check"].set_defaults(func=cmd_check)
```

> **注:** `_wire_funcs` 用 `parser._subparsers` 私有属性做名称映射。若觉得脆弱,可在 Task 7+ 改为每个 `sp = sub.add_parser(...)` 后立即 `.set_defaults(func=...)`。此处集中映射更易维护。

- [ ] **Step 2: 此时 synth/voice_cmds 还没写,跳过运行,先占位**

创建空的占位文件(后续 task 填充),让 cli.py 能 import:

```python
# bailian_tts/synth.py(占位,Task 7 填充)
# bailian_tts/voice_cmds.py(占位,Task 10 填充)
```

```bash
cat > bailian_tts/synth.py <<'EOF'
"""合成命令(Task 7-9 填充)。"""
def cmd_synth(args): raise NotImplementedError
def cmd_batch(args): raise NotImplementedError
def cmd_srt(args): raise NotImplementedError
EOF
cat > bailian_tts/voice_cmds.py <<'EOF'
"""音色管理命令(Task 10-13 填充)。"""
def cmd_voices(args): raise NotImplementedError
def cmd_clone(args): raise NotImplementedError
def cmd_design(args): raise NotImplementedError
def cmd_list(args): raise NotImplementedError
def cmd_query(args): raise NotImplementedError
def cmd_delete(args): raise NotImplementedError
def cmd_update(args): raise NotImplementedError
EOF
```

- [ ] **Step 3: 手动验证 check 命令**

```bash
cd plugins/video-toolkit/skills/bailian-tts
pip install requests -q
python skill_main.py check
```

Expected: `✓ bl 已鉴权,requests 可用,API Key 已配置`(退出码 0)。

- [ ] **Step 4: Commit**

```bash
git add bailian_tts/cli.py bailian_tts/synth.py bailian_tts/voice_cmds.py
git commit -m "feat: CLI skeleton with check command"
```

---

## Task 7: synth 命令

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/synth.py`

- [ ] **Step 1: 写实现**

替换 `bailian_tts/synth.py` 的 `cmd_synth`:

```python
"""合成命令。"""
from __future__ import annotations
from pathlib import Path
from . import bl
from .voices_db import VoicesDB


def _read_text(args) -> str:
    if args.text and args.text_file:
        raise SystemExit("✗ --text 与 --text-file 互斥")
    if args.text:
        return args.text
    if args.text_file:
        return Path(args.text_file).read_text(encoding="utf-8")
    raise SystemExit("✗ 需要 --text 或 --text-file")


def _resolve_model(args) -> str:
    """target_model 配对:显式 --model 优先;否则查 voices.json。"""
    if args.model:
        return args.model
    db = VoicesDB()
    model = db.target_model_for(args.voice)
    if model:
        return model
    raise SystemExit(
        f"✗ 无法确定 voice {args.voice!r} 对应的 model。"
        f"请用 --model 指定(系统音色用 cosyvoice-v3-flash,自定义音色用其 target_model)。"
    )


def cmd_synth(args) -> int:
    text = _read_text(args)
    model = _resolve_model(args)
    bl.synth(text=text, voice=args.voice, out=args.out, model=model,
             fmt=args.format, rate=args.rate, pitch=args.pitch,
             volume=args.volume, instruction=args.instruction, language=args.language)
    print(f"✓ 合成完成 → {args.out}")
    return 0
```

- [ ] **Step 2: 手动验证**

```bash
python skill_main.py synth --text "你好,这是一个配音测试" --voice longxiaochun_v3 --out /tmp/test.mp3
afplay /tmp/test.mp3   # 听一下
```

Expected: 产出 `/tmp/test.mp3` 并能播放。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/synth.py
git commit -m "feat: synth command with target_model auto-pairing"
```

---

## Task 8: batch 命令

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/synth.py`

- [ ] **Step 1: 写实现**

在 `bailian_tts/synth.py` 追加:

```python
import json
import time


def _load_segments(path: str) -> list[dict]:
    """加载配音清单。兼容两种格式:
    - 通用:[{"id":"x","text":"...","voice":"<可选>"}]
    - web-video-presentation:[{"chapter":"c","step":1,"text":"..."}]
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    segs = []
    for item in data:
        if "id" in item:
            seg_id = item["id"]
        elif "chapter" in item and "step" in item:
            seg_id = f"{item['chapter']}/{item['step']}"
        else:
            raise SystemExit(f"✗ 清单项缺少 id 或 chapter/step: {item!r}")
        segs.append({"id": seg_id, "text": item["text"],
                     "voice": item.get("voice")})
    return segs


def _safe_id(seg_id: str) -> str:
    """把 chapter/step 这类含 / 的 id 转成路径安全的子目录结构。"""
    return seg_id.replace("/", "__")


def cmd_batch(args) -> int:
    segments = _load_segments(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    failed = []
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
    (out_dir / "manifest.json").write_text(
        json.dumps({"segments": manifest, "failed": failed},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✓ done — {len(manifest)} ok, {len(failed)} failed. manifest → {out_dir}/manifest.json")
    return 2 if failed else 0
```

- [ ] **Step 2: 手动验证**

```bash
cat > /tmp/segs.json <<'EOF'
[{"id":"01","text":"第一段配音"},{"id":"02","text":"第二段配音"}]
EOF
python skill_main.py batch --input /tmp/segs.json --voice longxiaochun_v3 --out-dir /tmp/batchout
cat /tmp/batchout/manifest.json
```

Expected: `/tmp/batchout/01.mp3`、`02.mp3`、`manifest.json` 齐全。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/synth.py
git commit -m "feat: batch command with segment manifest"
```

---

## Task 9: srt 命令

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/synth.py`

- [ ] **Step 1: 写实现**

在 `bailian_tts/synth.py` 追加(顶部补 `from .srt import parse_srt`):

```python
from .srt import parse_srt


def cmd_srt(args) -> int:
    subs = parse_srt(args.srt)
    if not subs:
        raise SystemExit(f"✗ SRT 无有效条目: {args.srt}")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    db = VoicesDB()
    model = db.target_model_for(args.voice) or "cosyvoice-v3-flash"
    manifest = []
    failed = []
    for sub in subs:
        out_file = out_dir / f"{sub.index:04d}.{args.format}"
        t0 = time.time()
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
        # 用 ffmpeg 合并(可选依赖)
        import subprocess, shlex
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
    (out_dir / "manifest.json").write_text(
        json.dumps({"segments": manifest, "failed": failed},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n✓ done — {len(manifest)} ok, {len(failed)} failed")
    return 2 if failed else 0
```

- [ ] **Step 2: 手动验证**

```bash
cat > /tmp/test.srt <<'EOF'
1
00:00:00,000 --> 00:00:02,000
第一句字幕

2
00:00:02,000 --> 00:00:04,000
第二句字幕
EOF
python skill_main.py srt --srt /tmp/test.srt --voice longxiaochun_v3 --out-dir /tmp/srtout
ls /tmp/srtout
```

Expected: `0001.mp3`、`0002.mp3`、`manifest.json`(含 start/end 时间码)。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/synth.py
git commit -m "feat: srt command with per-entry dubbing and manifest"
```

---

## Task 10: voices 命令(列系统音色)

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/voice_cmds.py`

- [ ] **Step 1: 写实现**

替换 `bailian_tts/voice_cmds.py` 的 `cmd_voices`:

```python
"""音色管理命令。"""
from __future__ import annotations
from . import bl
from .voices_db import VoicesDB


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
    # 表格输出
    print(f"{'VOICE ID':<24} {'NAME':<10} {'LANG':<12} DESC")
    print("-" * 70)
    for v in voices:
        print(f"{v['id']:<24} {v.get('name',''):<10} {v.get('lang',''):<12} {v.get('desc','')}")
    print(f"\n共 {len(voices)} 个")
    return 0
```

- [ ] **Step 2: 手动验证**

```bash
python skill_main.py voices --refresh
python skill_main.py voices --language 英文
```

Expected: 第一次拉取并缓存 64 个;第二次按语言筛选。

> **注:** 若 `bl.list_system_voices` 解析表格结果不对(Task 4 备注),此处修正解析逻辑,优先尝试让 bl 输出 JSON 格式(`bl speech synthesize --list-voices --output json`,如支持)。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/voice_cmds.py
git commit -m "feat: voices command with caching"
```

---

## Task 11: clone 命令(声音复刻)

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/voice_cmds.py`

- [ ] **Step 1: 写实现**

在 `bailian_tts/voice_cmds.py` 顶部追加 import,并替换 `cmd_clone`:

```python
from . import config, api
from .voices_db import validate_prefix


def cmd_clone(args) -> int:
    validate_prefix(args.prefix)
    # 确定 URL
    if args.audio and args.url:
        raise SystemExit("✗ --audio 与 --url 互斥")
    if args.url:
        url = args.url
    elif args.audio:
        print(f"上传 {args.audio} ...")
        try:
            url = bl.file_upload(args.audio)
        except bl.BlError as e:
            raise SystemExit(f"✗ 上传失败: {e}\n  可改用公网 URL(--url)或 OSS。")
        print(f"✓ 上传得到 URL: {url}")
    else:
        raise SystemExit("✗ 需要 --audio <本地路径> 或 --url <公网URL>")

    api_key = config.resolve_api_key()
    client = api.VoiceEnrollmentClient(api_key)
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
    # 入库
    VoicesDB().add_custom({
        "voice_id": voice_id, "prefix": args.prefix,
        "target_model": args.target_model, "type": "clone",
        "voice_prompt": None, "resource_link": url,
        "gmt_create": "", "status": status, "note": "",
    })
    print(f"✓ 复刻成功并入库: {voice_id}")
    print(f"  合成示例: python skill_main.py synth --text '测试' --voice {voice_id}")
    return 0
```

- [ ] **Step 2: 手动验证**(用官方示例音频 URL,消耗 1 个音色位)

```bash
python skill_main.py clone \
  --url "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/cosyvoice/cosyvoice-zeroshot-sample.wav" \
  --prefix myvoice --target-model cosyvoice-v3.5-plus
# 等待轮询完成(约 10-60s)
python skill_main.py synth --text "复刻音色测试" --voice <返回的voice_id> --out /tmp/clone.mp3
afplay /tmp/clone.mp3
```

Expected: 复刻成功、入库、合成时 `target_model` 自动配对为 `cosyvoice-v3.5-plus`。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/voice_cmds.py
git commit -m "feat: clone command (voice cloning + polling + enroll)"
```

---

## Task 12: design 命令(声音设计)

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/voice_cmds.py`

- [ ] **Step 1: 写实现**

替换 `cmd_design`:

```python
import subprocess


def cmd_design(args) -> int:
    validate_prefix(args.prefix)
    api_key = config.resolve_api_key()
    client = api.VoiceEnrollmentClient(api_key)
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
        player = ["afplay"] if subprocess.run(["which", "afplay"],
                                              capture_output=True).returncode == 0 \
            else ["ffplay", "-nodisp", "-autoexit"]
        print("播放预览中...")
        subprocess.run([*player, str(result.preview_path)])
    # 入库(SKILL.md 工作流里会先问用户是否满意)
    VoicesDB().add_custom({
        "voice_id": result.voice_id, "prefix": args.prefix,
        "target_model": args.target_model, "type": "design",
        "voice_prompt": args.prompt, "resource_link": None,
        "gmt_create": "", "status": "OK",
        "note": f"preview_text: {args.preview_text}",
    })
    print(f"✓ 已入库: {result.voice_id}")
    return 0
```

- [ ] **Step 2: 手动验证**(消耗 1 个音色位)

```bash
python skill_main.py design \
  --prompt "沉稳的中年男性播音员,音色低沉浑厚,语速平稳,适合纪录片解说" \
  --preview-text "大家好,欢迎收听" \
  --prefix announcer --target-model cosyvoice-v3.5-plus --play
```

Expected: 生成预览、播放试听、入库。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/voice_cmds.py
git commit -m "feat: design command with preview playback"
```

---

## Task 13: CRUD 命令(list/query/delete/update)

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/bailian_tts/voice_cmds.py`

- [ ] **Step 1: 写实现**

替换 `cmd_list / cmd_query / cmd_delete / cmd_update`:

```python
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
    import json
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
        url = bl.file_upload(args.audio)
    elif args.url:
        url = args.url
    else:
        raise SystemExit("✗ 需要 --audio 或 --url")
    _client().update(args.voice, url)
    print(f"✓ 已提交更新,voice_id={args.voice},新音频 URL={url}")
    return 0
```

- [ ] **Step 2: 手动验证**

```bash
python skill_main.py list
python skill_main.py query --voice <某个voice_id>
# delete 谨慎,确认后再测
```

Expected: list 列出自定义音色;query 打印详情。

- [ ] **Step 3: Commit**

```bash
git add bailian_tts/voice_cmds.py
git commit -m "feat: list/query/delete/update voice commands"
```

---

## Task 14: bailian.sh provider

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/bailian.sh`

- [ ] **Step 1: 写实现**

`bailian.sh`:

```bash
# ────────────────────────────────────────────────────────────────────
# bailian provider — uses the bl CLI (Aliyun Model Studio / CosyVoice).
#
# Docs:  https://bailian.aliyun.com/cli/install.md
# Auth:  bl auth login --api-key sk-...
# Voice: pass a cosyvoice voice id; default longxiaochun_v3 (龙小淳, 知性女声)
#        override default via BAILIAN_TTS_VOICE env var
#
# Drop-in for web-video-presentation: copy this file into
# presentation/scripts/tts-providers/bailian.sh then
#   PRESENTATION_TTS=bailian npm run synthesize-audio
# ────────────────────────────────────────────────────────────────────

tts_check() {
  if ! command -v bl >/dev/null; then
    echo "✗ bl CLI not found in PATH." >&2
    return 1
  fi
  if ! bl auth status >/dev/null 2>&1; then
    echo "✗ bl is not authenticated." >&2
    return 1
  fi
}

tts_install_help() {
  cat <<'EOF' >&2
To use the bailian (CosyVoice) provider:

  Install:  npm install -g bailian-cli
  Login:    bl auth login --api-key sk-xxxxx
            (get a key at https://bailian.console.aliyun.com/cli)

Or pick another provider:  PRESENTATION_TTS=<name> npm run synthesize-audio
See tts-providers/README.md for the list and how to add your own.
EOF
}

tts_synthesize() {
  local text="$1"
  local out="$2"
  local voice="${3:-}"

  # 两分支处理 voice,避开 macOS bash 3.2 空数组 + set -u 的坑
  # (对齐 minimax.sh 写法)
  if [[ -n "$voice" ]]; then
    bl speech synthesize --text "$text" --voice "$voice" --out "$out" --format mp3 \
      >/dev/null 2>&1
  else
    voice="${BAILIAN_TTS_VOICE:-longxiaochun_v3}"
    bl speech synthesize --text "$text" --voice "$voice" --out "$out" --format mp3 \
      >/dev/null 2>&1
  fi
}
```

- [ ] **Step 2: 手动验证三函数契约**

```bash
cd plugins/video-toolkit/skills/bailian-tts
chmod +x bailian.sh
source bailian.sh
tts_check && tts_synthesize "契约测试一下" /tmp/contract.mp3 ""
echo "exit=$?"
afplay /tmp/contract.mp3
```

Expected: `exit=0`,`/tmp/contract.mp3` 可播放。

- [ ] **Step 3: Commit**

```bash
git add bailian.sh
git commit -m "feat: bailian.sh provider for web-video-presentation"
```

---

## Task 15: SKILL.md + references/voices.md

**Files:**
- Create: `plugins/video-toolkit/skills/bailian-tts/SKILL.md`
- Create: `plugins/video-toolkit/skills/bailian-tts/references/voices.md`

- [ ] **Step 1: 写 SKILL.md**

`SKILL.md`(frontmatter description 覆盖所有触发词,工作流对齐 audio-transcribe 风格):

```markdown
---
name: bailian-tts
description: >
  阿里云百炼 CosyVoice AI 配音与音色管理。基于 bailian-cli(bl)和 DashScope 声音复刻 API。
  当用户要配音、朗读、TTS、语音合成、把文字读出来、给文本/稿件/字幕(SRT)配音、
  批量配音、声音复刻、克隆音色、复刻声音、声音设计、设计音色、自定义音色、
  音色管理、列出音色、查询音色、删除音色、复刻我的声音时触发。
  合成支持文本/文件/SRT/segments,可选风格控制(温柔/激昂/沉稳)。
  音色支持 64 个系统音色 + 声音复刻(10-20s 样本) + 声音设计(文本描述)。
  每次合成前用 AskUserQuestion 询问音色和格式;复刻/设计前收集参数。
  产出 mp3(默认)/wav/pcm/opus。
---

# Bailian TTS — 阿里云百炼 AI 配音

基于阿里云百炼 CosyVoice。合成走 `bl` CLI,音色管理(复刻/设计/CRUD)走 DashScope RESTful API。

## 步骤 0:环境检查

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py check
```

失败则按提示修复:`pip install requests` / `bl auth login --api-key sk-...` / `export DASHSCOPE_API_KEY=sk-...`。

## 意图分流

| 用户说什么 | 走哪个命令 |
|------------|-----------|
| 配音/朗读/把这段读出来/给文字配音 | `synth` |
| 给清单/segments 批量配音 | `batch` |
| 给字幕(SRT)配音 | `srt` |
| 复刻我的声音/克隆音色(给样本) | `clone` |
| 设计一个音色(给描述) | `design` |
| 列出/查询/删除/管理已有音色 | `list` / `query` / `delete` / `update` |
| 有哪些音色/系统音色 | `voices` |

## 配音工作流(synth / batch / srt)

**每次配音前,用 AskUserQuestion 询问(用户已指定则跳过):**

```
AskUserQuestion({
  questions: [
    {
      header: "选择音色",
      question: "用哪个音色配音?",
      options: [
        // 从 voices.json 读取,系统音色按语言分组 + 自定义音色单列
        {"label": "龙小淳(知性女声,中文)", "value": "longxiaochun_v3"},
        {"label": "龙cheng(智慧青年男,中文)", "value": "longcheng_v3"},
        {"label": "loongabby(美式英文女)", "value": "loongabby_v3"},
        {"label": "<自定义音色名> (复刻/设计)", "value": "<voice_id>"},
        // ...更多见 references/voices.md
      ]
    },
    {
      header: "格式与风格",
      question: "输出格式和风格?",
      options: [
        {"label": "mp3,自然", "value": "mp3"},
        {"label": "mp3,温柔风格", "value": "mp3:用温柔的语气"},
        {"label": "mp3,沉稳风格", "value": "mp3:用沉稳的语气"},
        {"label": "wav(无损)", "value": "wav"}
      ]
    }
  ]
})
```

格式选项含 `:` 的,拆成 `--format` + `--instruction`。

然后执行:

```bash
# 单段
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py synth \
  --text "..." --voice <id> --out output.mp3
# 批量(清单 JSON)
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py batch \
  --input segments.json --voice <id> --out-dir audio/
# SRT
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py srt \
  --srt subtitle.srt --voice <id> --out-dir audio/
```

## 声音复刻工作流(clone)

收集:prefix(数字+小写字母,<10 字符)、target_model(默认 cosyvoice-v3.5-plus)、
音频来源(本地文件 `--audio` 或公网 URL `--url`,样本 10-20s、清晰无噪音)。

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py clone \
  --audio sample.wav --prefix myvoice --target-model cosyvoice-v3.5-plus
```

执行后告知用户轮询进度,成功后用新音色合成一句试听。⚠️ 复刻需公网 URL,
本地文件会先 `bl file upload` 上传;若上传 URL 不可用则提示用 OSS。

## 声音设计工作流(design)

协助用户写 `voice_prompt`(模板:**性别** + **年龄段** + **音色质感** + **语速** + **适用场景**),
收集 preview_text(试听文本)、prefix。

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py design \
  --prompt "沉稳的中年男性播音员,音色低沉浑厚,语速平稳,适合纪录片解说" \
  --preview-text "大家好,欢迎收听" \
  --prefix announcer --play
```

播放预览让用户试听;满意则保留(已入库),不满意调整 prompt 重新 design。

## 音色库管理

```bash
python .../skill_main.py list                 # 列自定义音色
python .../skill_main.py query --voice <id>   # 查详情
python .../skill_main.py delete --voice <id>  # 删除(不可逆,会确认)
python .../skill_main.py voices --refresh     # 刷新系统音色缓存
```

## 与其他 skill 配合

```
video-toolkit: video-downloader → audio-transcribe → text-refine → bailian-tts(srt) → srt-html
web-video-presentation: 复制 bailian.sh 进 presentation/scripts/tts-providers/
  → PRESENTATION_TTS=bailian npm run synthesize-audio
```

完整系统音色列表见 [references/voices.md](./references/voices.md)。
```

- [ ] **Step 2: 写 references/voices.md(系统音色分组,初始可从 voices --refresh 生成)**

```bash
python skill_main.py voices --refresh
# 然后手工按语言分组整理成 references/voices.md,或写脚本生成
```

`references/voices.md` 内容结构:

```markdown
# 系统音色参考(cosyvoice-v3-flash)

> 由 `voices --refresh` 缓存。完整列表以运行时 `bl speech synthesize --list-voices` 为准。

## 中文(普通话)
| ID | 名称 | 特征 |
|----|------|------|
| longxiaochun_v3 | 龙小淳 | 知性积极女 |
| longcheng_v3 | 龙橙 | 智慧青年男 |
| ... | ... | ... |

## 粤语 / 方言
| longjiaxin_v3 | 龙嘉欣 | 优雅粤语女 |
| longlaotie_v3 | 龙老铁 | 东北直率男 |
| ...

## 英文(美式 / 英式)
| loongabby_v3 | loongabby | 美式英文女 |
| ...

## 日 / 韩 / 其他
| ...
```

> **注:** 初始可只填几个代表,运行 `voices --refresh` 后用脚本补全全表。

- [ ] **Step 3: Commit**

```bash
git add SKILL.md references/voices.md
git commit -m "feat: SKILL.md and system voices reference"
```

---

## Task 16: 注册到 marketplace.json

**Files:**
- Modify: `plugins/video-toolkit/skills/bailian-tts/../../.claude-plugin/marketplace.json`(即 `.claude-plugin/marketplace.json`)
- 实际路径:`.claude-plugin/marketplace.json`

- [ ] **Step 1: 把 bailian-tts 加到 Video_Toolkit 插件的 skills 数组**

编辑 `.claude-plugin/marketplace.json`,在 `Video_Toolkit` 插件的 `skills` 数组追加 `"./skills/bailian-tts"`:

```json
{
  "name": "Video_Toolkit",
  "description": "视频内容一站工具:video-downloader + audio-transcribe + text-refine + web-video-presentation + bailian-tts(阿里云百炼 AI 配音与音色管理)",
  "source": "./plugins/video-toolkit",
  "strict": false,
  "skills": [
    "./skills/video-downloader",
    "./skills/audio-transcribe",
    "./skills/text-refine",
    "./skills/web-video-presentation",
    "./skills/bailian-tts"
  ]
}
```

- [ ] **Step 2: 同步更新 README.md 的插件表**

编辑 `README.md`,在 video-toolkit 行的"包含 Skill"列追加 `bailian-tts`,并在使用方法节加一段配音示例:

```markdown
### bailian-tts:文本/字幕 → 配音(阿里云百炼 CosyVoice)

\`\`\`
把这段口播稿配成音:大家好,欢迎来到...
给这个字幕配音 subtitle.srt
复刻我的声音(用这段样本 sample.wav)
\`\`\`
```

- [ ] **Step 3: 校验 JSON 合法**

```bash
python -c "import json; json.load(open('.claude-plugin/marketplace.json'))" && echo OK
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/marketplace.json README.md
git commit -m "feat: register bailian-tts in marketplace and README"
```

---

## Task 17: 集成验证(手动)

无新文件,按清单跑一遍。每项确认通过。

- [ ] **Step 1: 单元测试全绿**

```bash
cd plugins/video-toolkit/skills/bailian-tts
pip install requests pytest -q
python -m pytest tests/ -v
```

Expected: voices_db / srt / config / api 测试全 PASS(约 19 项)。

- [ ] **Step 2: check 通过**

```bash
python skill_main.py check
```

Expected: `✓ ...`,退出码 0。

- [ ] **Step 3: 系统音色拉取(免费)**

```bash
python skill_main.py voices --refresh
python skill_main.py voices --language 英文
```

Expected: 缓存 64 个;筛选生效。⚠️ 若 `bl.list_system_voices` 表格解析有误,修正解析(优先 `--output json`)。

- [ ] **Step 4: 单段合成(消耗少量字符)**

```bash
python skill_main.py synth --text "你好,这是 bailian-tts 的配音测试" \
  --voice longxiaochun_v3 --out /tmp/t.mp3
afplay /tmp/t.mp3
```

Expected: 产出可播放 mp3。

- [ ] **Step 5: 风格控制**

```bash
python skill_main.py synth --text "激动地宣布一个好消息" \
  --voice longcheng_v3 --instruction "用激动热情的语气" --out /tmp/t2.mp3
```

Expected: `--instruction` 透传到 bl,语气有变化。

- [ ] **Step 6: SRT 配音(v1 不对齐)**

```bash
python skill_main.py srt --srt <(printf '1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:02,000 --> 00:00:04,000\n第二句\n') \
  --voice longxiaochun_v3 --out-dir /tmp/srtout
ls /tmp/srtout
cat /tmp/srtout/manifest.json
```

Expected: `0001.mp3`、`0002.mp3`、`manifest.json`(含 start/end)。

- [ ] **Step 7: target_model 自动配对验证**

用 Task 11 复刻出的 voice_id 合成,**不传 --model**,确认自动用 `cosyvoice-v3.5-plus`:

```bash
python skill_main.py synth --text "测试配对" --voice <clone_voice_id> --out /tmp/pair.mp3 --verbose 2>&1 | grep -i model
```

Expected: 实际调用 bl 时 model=cosyvoice-v3.5-plus(若 bl 不打印模型,临时在 `bl.synth` 加 print 验证后移除)。

- [ ] **Step 8: provider 契约**

```bash
source bailian.sh
tts_check && tts_synthesize "provider 契约测试" /tmp/pc.mp3 "" && afplay /tmp/pc.mp3
```

Expected: 退出码 0,可播放。

- [ ] **Step 9: list / query**

```bash
python skill_main.py list
python skill_main.py query --voice <某个voice_id>
```

Expected: 列出/查询正常。

- [ ] **Step 10: 设计音色试听(可选,消耗音色位)**

```bash
python skill_main.py design --prompt "年轻女性,活泼甜美,语速轻快" \
  --preview-text "哈喽大家好呀" --prefix sweet --play
```

Expected: 预览生成并播放。

- [ ] **Step 11: 串联 video-toolkit pipeline(可选)**

用 text-refine 产出的 SRT 跑 `srt` 命令,确认能吃上游输出。

- [ ] **Step 12: 串联 web-video-presentation(可选)**

```bash
cp bailian.sh <某 web-video-presentation 项目>/presentation/scripts/tts-providers/bailian.sh
cd <该项目>/presentation && PRESENTATION_TTS=bailian npm run synthesize-audio
```

Expected: narrations 走 CosyVoice 合成。

- [ ] **Step 13: 收尾 commit + tag(可选)**

```bash
git log --oneline   # 确认所有 task 都已 commit
# 可选: git tag bailian-tts-v0.1.0
```

---

## Self-Review 结果

**1. Spec coverage:**
- 目录结构(spec §目录结构)→ Task 0 ✓
- skill_main.py 子命令(synth/batch/srt/voices/clone/design/list/query/delete/update/check)→ Task 6-13 ✓
- bailian.sh provider(三函数契约)→ Task 14 ✓
- voices.json 结构 + target_model 配对 → Task 1 ✓
- 鉴权策略(env > bl config > 报错)→ Task 3 ✓
- SKILL.md 工作流 → Task 15 ✓
- 数据流 + 与其他 skill 配合 → Task 15-16 ✓
- 错误处理 → 散布在各 Task(BlError/ApiError/PollTimeoutError/确认删除)✓
- 依赖检查 → Task 6 check ✓
- 测试策略 → Task 1/2/3/5(单元)+ Task 17(集成)✓
- v2 路线 → 非 v1,本 plan 不覆盖(已在 spec 记录)✓

**2. Placeholder scan:** 无 TBD/TODO;`bl.list_system_voices` 与 `bl.file_upload` 的输出解析基于推测,已在 Task 4/10/17 标注"以实际 `--output json` 为准修正",有明确 fallback,非占位。

**3. Type consistency:** `VoicesDB.target_model_for` / `add_custom` / `remove_custom` / `set_system_voices` 在 Task 1 定义,Task 7/8/9/10/11/12/13 调用,签名一致 ✓。`VoiceEnrollmentClient.create_clone/create_design/poll_until_ready/list_voices/query/update/delete` 在 Task 5 定义,Task 11/12/13 调用,签名一致 ✓。`cmd_*` 函数名在 Task 6 cli._wire_funcs 映射,Task 7-13 实现,一致 ✓。
