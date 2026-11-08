# subtitle-translate 设计文档

日期：2026-11-08
状态：待评审
关联：[subtitle_translator_skill_v1.md](../../../subtitle_translator_skill_v1.md)（原始 PRD）

---

## 1. 结论先行

原始 PRD 的问题不是描述不清，而是**核心约束物理不可满足**。

在 `E:\AI 分享会` 的 10 份真实英文字幕（ASR 产出）上实测：

- 英文口播密度高度一致：3.15 ~ 3.77 词/秒（≈ 4.9 ~ 5.8 汉字当量/秒）。
- K-pop 一份有逐条 1:1 的中文对照（482 条，时间戳完全一致），整体语速 **6.86 字/秒**。
- 按 PRD 的 `max_chars = duration × 4.0` 计算，**429/482 = 89% 的条目超预算**；要全部压进预算需删掉 **45%** 的信息。

PRD 里三条约束——**1:1 对齐、4 字/秒预算、不删事实**——在真实语料上最多同时满足两条。若把 `max_chars` 写成硬断言，脚本会强迫模型为了"达标"删事实，与仓库自己的 `line-break-cases.md` 标准（"不能为了满足字数删掉否定、条件、关键事实"）直接矛盾。

本设计据此重定：**预算降级为目标值与压力线，硬断言只保留结构与完整性。**

---

## 2. 定位

**快速、严格 1:1、预算前置的字幕翻译器。**

- 用途：把带时间轴的 SRT 按原结构翻译为目标语言，翻完即可直接观看或交付。
- 与 `text-refine` 的分界：`text-refine` 会按语义重新分段、强制独立 agent 审校；本 skill 不重分段、不审校，只保证结构对齐与阅读速度合理。
- 与 `video-tts` 的分界：本 skill 不合成音频、不做时间轴适配；产物可作为 `video-tts` 的输入。

### 非目标

- 不做语义重分段（条数、序号、时间轴一律原样继承）。
- 不做独立审校 agent（需要信达雅审校时用 `text-refine`）。
- 不做配音对齐、变调变速（`video-tts` 负责）。
- v1 只产中文目标（代码里参数化，但不验收其他语言）。
- 不做听音校对；只按上下文修正明显 ASR 错误。

### 反目标（做成了也算失败）

- 为了压字数删掉否定、条件、数字、关键事实。
- 输出后与原文件条数不一致、时间戳漂移。
- 术语在前后文之间漂移。

---

## 3. 预算模型

### 3.1 参数（唯一来源）

| 参数 | 值 | 依据 |
|---|---|---|
| `target_han_cps` | 5.0 | 仓库 `line-break-cases.md`：中文舒适阅读 3~5 字/秒 |
| `max_han_cps` | 7.0 | 同上：7 字/秒为高阅读压力线 |
| `max_visible_cps` | 17.0 | 同上：纯拉丁/数字行的可见字符压力线 |
| `group_gap_ms` | 1200 | 原 PRD 4.1(3) |
| `short_slot_ms` | 600 | 本次实测：低于此值的槽位不具备可翻译时长 |

### 3.2 逐条预算

```python
duration = (end_ms - start_ms) / 1000

if duration_ms < 600:
    target_han = None          # 不设目标，只限制上限
    max_han = max(4, ceil(duration * 7))
    short_slot = True          # 不计入语速统计
else:
    target_han = round(duration * 5)
    max_han = floor(duration * 7)
    short_slot = False
```

样例（取自实测文件）：

| duration | target_han | max_han | 现有 1:1 译文当量 | 判定 |
|---|---|---|---|---|
| 2.24s | 11 | 15 | 14 | 通过 |
| 2.08s | 10 | 14 | 13 | 通过 |
| 1.04s | 5 | 7 | 6 | 通过 |
| 0.73s | — | 6 | 10 | 超限 → 告警 |
| 0.08s | — | 4 | 3 | 通过（短槽位） |

对比：原 PRD 对 2.24s 给 `max_chars=8`，实测译文 14 字——**原公式会判 89% 的条目不合格**。

### 3.3 当量折算（单一口径）

- 汉字：1.0
- 拉丁词 / 数字串（`[A-Za-z0-9]+([-][A-Za-z0-9]+)*`）：2.0

废弃原 PRD 4.4(2) 的 `1.5/2.0/2.5` 三档函数，与 4.3(3) 的文字口径统一为 2.0。纯拉丁行额外检查 `visible_cps ≤ 17`。

### 3.4 判定规则

| 情况 | 处理 | 退出码 |
|---|---|---|
| 条数/序号/时间戳/非空校验失败 | 不产出文件 | 1 |
| 有条目 `units > max_han`（短槽位除外） | 产出文件 + 报告列出 | 2 |
| 全部在 `max_han` 内 | 产出文件 | 0 |

**超限不阻断产出。** 是否重写由 Agent 决定（见 §6.4），因为唯一能"达标"的方式是删事实，而删事实是反目标。

---

## 4. 接口契约

### 4.1 命令

```text
python3 skill_main.py prepare <input.srt> [--target-lang zh] [--out <dir>]
python3 skill_main.py finish  <workdir>
```

两条命令、一个文件。`prepare` 与 `finish` 之间只靠 `<workdir>` 通信。

### 4.2 prepare

读取 SRT，规范化换行与 BOM，输出到系统临时目录（默认 `<temp>/subtitle-translate/<hash>/`），打印 workdir 路径。

产出 `<workdir>/job.json`：

```json
{
  "version": 1,
  "source": "E:/x/in.srt",
  "target_lang": "zh",
  "params": {
    "target_han_cps": 5.0, "max_han_cps": 7.0,
    "max_visible_cps": 17.0, "group_gap_ms": 1200, "short_slot_ms": 600
  },
  "items": [
    {
      "id": "1",
      "start_ms": 0, "end_ms": 2240, "duration_ms": 2240,
      "group": 1, "short_slot": false,
      "text": "Every single frame of the music video you",
      "target_han": 11, "max_han": 15
    }
  ]
}
```

约定：

- `id` 一律为**字符串**，与 JSON 键类型一致，杜绝 `1 in {"1": ...}` 这类错误。
- `text` 为多行合并后的单行文本；不保留 HTML/SRT 样式标签（剥离并记入 `warnings`）。
- 空条目、纯音乐符号条目保留在 `items` 中，标记 `skip: true`，不参与翻译。

辅助对象：

```json
"warnings": [{"code": "overlap", "detail": "id 12/13 时间轴重叠"}]
```

### 4.3 中间产物（Agent 写）

`<workdir>/glossary.json`（可选）：

```json
{"Character Sheets": "角色设定图", "Motion Transfer": "动作迁移"}
```

`<workdir>/translated.json`（必须）：

```json
{"1": "你刚刚看到的那支音乐视频的每一帧", "2": "包括那首 K-pop 歌曲"}
```

键为字符串 id，`skip` 条目可缺省。

### 4.4 finish

1. 读取 `job.json` + `translated.json`（+ `glossary.json`）。
2. 硬断言：id 集合一致（skip 除外）、译文非空、时间戳未被修改。
3. 计算 `units`、`han_cps`、`visible_cps`，汇总超限条目。
4. 术语一致性：源文命中术语键、译文未命中对应值时记 warning。
5. 装配输出 `<stem>.<lang>.srt`（如 `foo.zh.srt`），已存在则依次尝试 `foo.zh_1.srt`、`foo.zh_2.srt`，**绝不覆盖**。
6. 输出 UTF-8、`\n`、无 BOM。
7. 退出码见 §3.4。成功时删除 workdir；失败时保留并打印路径。
8. 打印报告（供 Agent 转述给用户）：

```text
条目 482/482 ✔  时间戳未变 ✔
语速：中位 6.9 字/秒  p90 11.4  超限 225 条（短槽位 6 条不计）
超限最严重：id 260 (0.72s, 17.0 当量 / 上限 5)
术语：8 条，未命中 1 条（id 203 "Character Sheets"）
输出：E:/x/foo.zh.srt
```

---

## 5. 数据结构与算法

### 5.1 解析

沿用原 PRD 的正则，补充边界：

```python
SRT_REGEX = re.compile(
    r'(\d+)\r?\n'
    r'(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\r?\n'
    r'(.*?)(?=\r?\n\r?\n\d+|\Z)',
    re.DOTALL
)
```

- 读取时 `utf-8-sig`，`\r\n`/`\r` 统一为 `\n`。
- 结尾多余空行、尾随空格忽略。
- 序号重复 → 直接失败并报出两个相同的 id。
- 序号非连续 → 保留原样，不重排。
- 时间轴重叠 → 保留，记 warning。
- `duration <= 0` → 记 warning，`max_han` 取短槽位规则。

### 5.2 语义分组

```python
group = 1
for prev, cur in pairs(items):
    ends = prev.text.rstrip()[-1:] in {'.', '?', '!', ';', '。', '？', '！', '；'}
    gap = cur.start_ms - prev.end_ms
    if ends or gap >= 1200:
        group += 1
    cur.group = group
```

分组只用于**提示模型整段构思**，不改变条数与时间轴。

---

## 6. SKILL.md 要写的东西

SKILL.md 目标 1500~2000 词，细节参数留在 `references/`。

### 6.1 frontmatter

```yaml
name: subtitle-translate
description: >
  快速翻译 SRT 字幕并严格保留原条目数与时间轴，按每条时长注入字数预算。
  当用户要求"把字幕翻译成中文""SRT 翻译""保留时间轴翻译""字幕翻译得快一点"时使用。
  不负责重新分段、独立审校（需要时用 text-refine）、配音或音频合成（用 video-tts）。
```

### 6.2 三条铁律

1. **1:1 结构**：条数、序号、时间戳原样继承，模型不碰时间轴。
2. **预算前置**：`job.json` 的 `target_han` / `max_han` 是写作目标，不是事后检查项。
3. **事实不删**：超预算时先精简直译腔与冗余；否定、条件、因果、数字、态度不得删。

### 6.3 翻译规则

- 同一 `group` 先整体理解再逐条落笔，禁止按英文词序逐条直译。
- 目标语言为中文时：结尾不加句号，逗号/问号/感叹号按语气保留；默认单行。
- 英文专有名词保留原拼写，或"中文（English）"形式，全篇统一。
- 术语表先写先锁；出现新术语时回头统一，不得只改后半段。

### 6.4 流程

```text
1. prepare → 拿到 workdir
2. 通读 items.text，写 glossary.json
3. 写 translated.json（上下文装得下就一次写完；否则按 group 边界分批，每批带前 2 条已定译文作上下文）
4. finish
5. 退出码 2 → 只针对报告里的超限 id 精简一轮（不删事实），重写 translated.json，再 finish 一次
6. 仍超限 → 如实报告，不再重写
```

### 6.5 交付摘要

一句话说明输出路径、条目数、超限条数与术语疑点。不贴长报告。

---

## 7. 边界输入处理

| 输入情况 | 处理 |
|---|---|
| BOM / CRLF | 读入规范化；输出 UTF-8 + LF、无 BOM |
| 一条内多行正文 | 合并为单行翻译；输出单行 |
| `<i>`、`{\an8}` 等样式标签 | 翻译前剥离，记 warning；v1 不回填样式 |
| 空条目、`♪` 类 | `skip: true`，原样输出 |
| 序号重复 | 失败，报出重复 id |
| 序号非连续 | 保留原样 |
| 时间轴重叠 | 保留，warning |
| `duration < 0.6s` | 短槽位：不设目标，上限 `max(4, ceil(d*7))`，不计入语速统计 |
| 目标语言非中文 | v1 拒绝执行并提示（参数已预留） |
| 输出已存在 | 自动编号，不覆盖 |

---

## 8. 文件结构

```text
plugins/video-toolkit/skills/subtitle-translate/
├── SKILL.md
├── skill_main.py            # 约 300 行，仅标准库
├── references/
│   └── budget.md            # 参数表、当量口径、样例、边界用例
└── tests/
    ├── fixtures/
    │   ├── basic.srt
    │   ├── short-slot.srt
    │   ├── messy.srt        # BOM + 多行 + 标签 + 空条目 + 重叠
    │   └── duplicate-id.srt
    └── test_skill_main.py
```

选择单文件双命令（而非多模块）：本 skill 的确定性逻辑约 300 行，拆文件不降低运行复杂度，只增加跳转。`prepare`/`finish` 两个命令本身就是"确定性代码"与"模型产出"之间的边界，与文件数无关。

---

## 9. 验收

### 9.1 单元测试

- 预算表：0.08 / 0.32 / 0.6 / 1.0 / 2.24 / 4.0 秒的 `target_han`、`max_han`、`short_slot`。
- 解析：BOM、CRLF、多行、标签、空条目、尾随空行。
- 失败路径：id 缺失 → 退出 1 且不产出文件；译文为空 → 退出 1；序号重复 → 退出 1。
- 告警路径：超限 → 退出 2 且文件已产出、报告列出 id。
- 幂等：`prepare` → 用源文当译文 → `finish` → 再解析，条数与时间戳完全一致。

### 9.2 真实语料验收

用 `E:\AI 分享会` 的 482 条文件：

1. `prepare` 输出 482 条，id 与时间戳与源文件逐条一致。
2. 用现有 `...zh.srt` 原文作 `translated.json` 跑 `finish`，产出的 SRT 与源中文文件在结构上逐条一致（换行符除外）。
3. 报告中的超限条数与本次实测（225 条，短槽位 6 条除外）吻合。

### 9.3 原 PRD 验收矩阵的修订

| 原用例 | 处理 |
|---|---|
| TC-01 完整性与行数锁定 | 保留，改为断言 id 集合 + 时间戳不变 |
| TC-02 跨行倒装从句 | 保留，用 fixtures 里的真实长句 |
| TC-03 0.8s 槽位 4~5 字 | **废弃**（自相矛盾，已由短槽位规则替代） |
| TC-04 中英混排与专有名词 | 保留，改为术语一致性断言 |
| TC-05 长文本跨批一致性 | 保留，用 482 条文件人工抽检 40→41 行 |
| TC-06 漏行恢复 | 保留，改为"缺失 id → 退出 1 并列出 id"，补译由 Agent 完成 |

---

## 10. 留给实现者的决定

- `skill_main.py` 内部函数划分与命名。
- workdir 的 hash 方式与清理策略细节。
- `references/budget.md` 的具体组织。
- 术语一致性检查是否大小写敏感（建议不敏感）。

---

## 11. 与原始 PRD 的差异汇总

| 项 | 原 PRD | 本设计 |
|---|---|---|
| 预算公式 | `max(4, floor(d*4))`，容差 0.7~1.3× | `target = round(d*5)`，`max = floor(d*7)` |
| 硬断言 | 超预算即断言失败 | 只断言结构/完整性；超限为退出码 2 |
| 英文当量 | 文字 2.0 / 代码三档 | 统一 2.0 |
| CPS 阈值 | 5.5 告警 / 6.0 重写 | 5.0 目标 / 7.0 压力线 |
| 短槽位 | 未定义 | `<0.6s` 单独规则并排除统计 |
| 交付形态 | "单文件 SKILL.md" | 单文件 `skill_main.py` + SKILL.md + tests |
| 数据契约 | 无 | `job.json` / `translated.json` / `glossary.json` |
| 跨批机制 | 无 | 按 group 分批 + 前 2 条译文上下文 |
| 术语表 | 仅举例 | 独立文件 + finish 一致性检查 |
| 恢复机制 | 一行描述 | 缺失 id → 退出 1，补译由 Agent 负责 |
