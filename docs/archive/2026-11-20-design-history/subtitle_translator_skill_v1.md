# subtitle-translator Skill 技术需求文档 (PRD & Architecture Spec)

版本：1.0  
编写日期：2026-11-09  
面向对象：负责实现与维护该 Skill 的 Coding Agent / 研发人员  
核心定位：轻量级单文件（`SKILL.md`）或独立 CLI 工具，专用于工业级带时间轴 SRT 文件的跨语言高保真对齐翻译。

---

## 1. 背景与核心痛点

在多媒体 AI 工作流（ASR -> Translation -> TTS / 剪辑）中，将原始外语（如英语）SRT 字幕翻译为中文（或其他目标语言）时，传统方案存在以下四大致命缺陷：

1. **直接整篇投喂 LLM（Context Dump）**：超过 200 行字幕后，LLM 极易发生时间戳丢失、毫秒漂移、行号跳跃、甚至漏掉中间整段内容。
2. **逐条隔离翻译（Isolated Translation）**：将每条字幕单独提取翻译，彻底切断了上下文。面对英文中广泛存在的倒装从句（如定语从句、后置宾语），直译出的中文语义完全破碎，不可读。
3. **“时间槽失明”（Duration Blindness）**：只将 `{id, text}` 交给模型，模型对视频的实际播放时长毫不知情。导致在 0.8 秒的极短槽位塞入十几个汉字（语速爆表），而在 4 秒的长停顿槽位只写两个字（画面空档）。
4. **术语与专有名词漂移（Term Drift）**：视频前半部分翻译为“角色三视图”，后半部分翻译为“角色设定表”；或把特定工具（如 Suno 编曲标签、Zolly 镜头）错译为通用字面意。

---

## 2. 设计哲学与核心铁律

> **“代码管物理结构与字数预算（100% 确定性），模型管语境表达与语义切片（信达雅），严禁混杂。”**

* **铁律 1（1:1 绝对结构对齐）**：输出 SRT 的条目数 $N_{out}$ 必须严格等于输入 SRT 的条目数 $N_{in}$。每一个毫秒级时间戳 `start --> end` 必须原样继承自原始文件，任何 LLM 均不得直接重写时间轴。
* **铁律 2（显式物理限额）**：由代码基于时间差（`duration`）预先计算建议汉字字数上限（`max_chars`），作为强约束注入 Prompt。
* **铁律 3（零外部依赖）**：运行环境仅依托 Python 3.10+ 标准库（`re`, `json`, `math`, `sys`），不依赖 `pysrt`、`srt` 等第三方包，适应任何极简沙盒。
* **铁律 4（后检防御）**：所有批次翻译完成后，必须经由确定性 Python 脚本执行断言校验，拦截漏行、空行与超高语速。

---

## 3. 详细技术方案：四阶段工作流

```
                    [输入原始 SRT 文件]
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 阶段一：确定性结构提取与物理预算计算 (Python 标准库)   │
│  - 正则提取 (id, time_str, raw_text)                   │
│  - 物理时长: duration = end - start                    │
│  - 汉字预算: max_chars = max(4, int(duration * 4.0))   │
│  - 语义长句聚合: sentence_group (标记跨行长句)         │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 阶段二：前置全局术语表扫描与锁定 (Session Glossary)    │
│  - 快速通读全文，提取专有名词、专有工具、特征技术词汇  │
│  - 建立统一只读映射字典，锁定全篇统一译名              │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 阶段三：双约束切片翻译 (LLM Context-Aware Batching)     │
│  - 输入带有 {id, text, duration, max_chars, group}    │
│  - 同一 group 先全局构思通顺中文，再按时长切片回填     │
│  - 英文折算: K-pop/Suno/AI 等单词按 2 个字当量消耗     │
│  - 仅输出结构化 JSON: {"id": "中文翻译"}               │
└────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 阶段四：质量巡检与无损物理装配 (Python 脚本)           │
│  - 硬断言: assert len(trans) == N                      │
│  - 语速告警: CPS = Effective_Chars / duration > 6.0   │
│  - 原生时间轴强行缝合，输出 UTF-8 编码的 .zh.srt       │
└────────────────────────────────────────────────────────┘
```

---

## 4. 各阶段实现规范与核心算法

### 4.1 阶段一：确定性预处理

#### (1) 正则解析器规范
必须兼容 Windows（`\r\n`）与 Unix（`\n`）换行符，且兼容尾部多余空行：
```python
import re

SRT_REGEX = re.compile(
    r'(\d+)\r?\n'
    r'(\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3})\r?\n'
    r'(.*?)(?=\r?\n\r?\n\d+|\Z)',
    re.DOTALL
)

def parse_time(time_str: str) -> float:
    # 转换为秒数浮点数
    # "00:01:14,720" -> 74.72
    h, m, s_ms = time_str.split(':')
    s, ms = s_ms.split(',')
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0
```

#### (2) 物理字数预算定义
中文在视频字幕中的正常舒适阅读与口播语速为 **3.5 ~ 4.2 个汉字/秒**。
* 单条基准预算公式：
  $$\text{max\_chars} = \max\left(4, \; \lfloor \text{duration} \times 4.0 \rfloor\right)$$
* 容差范围：允许在 $[0.7 \times \text{max\_chars}, \; 1.3 \times \text{max\_chars}]$ 内浮动，以平衡语法完整性与节奏。

#### (3) 长句语义聚合（Sentence Grouping 算法）
判断两行字幕是否属于同一语义长句：
* 若前一行的末尾**不是**终止性标点（`.?!`、分号），且与后一行的起始时间间隔 $< 1.2$ 秒，则赋予相同的 `sentence_group_id`；
* 若遇到明确句号或长时间停顿，递增 `sentence_group_id`。

---

### 4.2 阶段二：术语表扫描与锁定（Glossary Locking）

在分批翻译前，Agent 必须通读全文原始文本，产出并锁定一份 `glossary.json`。以本篇 AI MV 为例，必须统一以下标准：
* `Character Sheets` -> 角色设定图 / 三视图（绝不能前后一会儿翻译为表、一会儿翻译为清单）
* `Zolly / Vertigo Shot` -> 变焦推拉镜头 / 希区柯克变焦
* `Motion Transfer` -> 动作迁移
* `Vocal Stem` -> 纯人声音轨
* `Credits` -> 算力点数
* 音乐术语保留规范：Suno 中的 `Stab`、`Gang Vocals`、`Silence Breaks`、`Hook`、`BPM` 建议保留行业标准词或以“中文（英文）”形式呈现。

---

### 4.3 阶段三：双约束切片翻译（LLM 提示工程与输入输出契约）

#### (1) 输入 JSON Schema（由 Python 组装）
将字幕按 30 ~ 50 条聚合为一个批次，输入 Prompt 示例如下：
```json
{
  "session_glossary": {
    "Character Sheets": "角色设定图",
    "Motion Transfer": "动作迁移",
    "Credits": "算力点数"
  },
  "rules": [
    "1. 同一 sentence_group 必须在全局理解后翻译，再按 duration 权重合理切碎回填，禁止倒装句生硬直译。",
    "2. 严格遵守 max_chars 预算。英文词（如 K-pop, AI, Suno）按 2 个字当量计算耗时。",
    "3. 字幕行末严禁加句号；逗号、感叹号、问号视语气保留。",
    "4. 仅返回以 id 为键的 JSON 字典，严禁输出任何额外废话。"
  ],
  "batch": [
    {"id": 1, "group": "G1", "text": "Every single frame of the music video you", "duration": 2.24, "max_chars": 9},
    {"id": 2, "group": "G1", "text": "just watched, including the K-pop track,", "duration": 2.08, "max_chars": 8},
    {"id": 3, "group": "G1", "text": "were all generated from my laptop.", "duration": 2.08, "max_chars": 8}
  ]
}
```

#### (2) 倒装句回填切片范式
* 原文长句：*Every single frame of the music video you just watched, including the K-pop track, were all generated from my laptop.*
* 中文整体译文：*“你刚刚看到的那支音乐视频里的每一帧画面，包括那首 K-pop 歌曲，全都是在我的笔记本电脑上生成的。”*
* 切片回填：
  * ID 1 (`2.24s`, `max=9`): `你刚刚看到的那支音乐视频里的`（13字，稍超但属自然定语）
  * ID 2 (`2.08s`, `max=8`): `每一帧画面，包括那首 K-pop 歌曲，`（汉字8 + K-pop 2 = 10 当量）
  * ID 3 (`2.08s`, `max=8`): `全都是在我的笔记本电脑上生成的。`（16字，可精简为：`全都是在我的笔记本电脑上生成的`）

#### (3) 英文词折算口径（Syllable-Based Equivalence）
中英混排时，单字计量统一标准：
* **短英文单词 / 常见缩写**（如 `AI`、`MV`、`Suno`、`K-pop`、`Claude`、`Trap`）：在口播时间与观众视线抓取上，**统一计为 2.0 个汉字当量**。
* **数字**（如 `120`、`4153`）：按发音音节折算（`120` 念“一百二”，计 3 字当量；`4153` 计 4 字当量）。

---

### 4.4 阶段四：质量巡检与物理装配

翻译完成后，Python 验收脚本执行强制检查：

#### (1) 硬约束断言（Hard Assertions）
```python
assert len(translations) == total_count, f"条目总数不符: 期望 {total_count}, 实际 {len(translations)}"
for i in range(1, total_count + 1):
    assert i in translations, f"严重缺陷: 缺失第 {i} 行字幕"
    text = translations[i].strip()
    assert len(text) > 0, f"严重缺陷: 第 {i} 行翻译为空"
```

#### (2) 语速过载告警（CPS Audit）
```python
def get_effective_units(text: str) -> float:
    # 提取英文与数字词组
    words = re.findall(r'[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*', text)
    zh_chars = re.findall(r'[\u4e00-\u9fff]', text)
    en_units = sum(1.5 if len(w) <= 2 else 2.0 if len(w) <= 6 else max(2.5, len(w)/3.0) for w in words)
    return len(zh_chars) + en_units

for idx, time_str, _, _, _, dur in raw_items:
    units = get_effective_units(translations[idx])
    cps = units / dur
    if cps > 5.5:
        print(f"[CPS WARNING] ID={idx} 时长={dur}s 当量字数={units:.1f} CPS={cps:.1f}: {translations[idx]}")
```
*对于 CPS > 6.0 的条目，脚本要求 Agent 触发局部重写（Refine），精简多余助词或修饰语，直到降至安全阈值。*

#### (3) 物理组装
```python
with open(output_srt_path, 'w', encoding='utf-8') as f:
    for idx, time_str, _, _, _, _ in raw_items:
        f.write(f"{idx}\n{time_str}\n{translations[idx]}\n\n")
```

---

## 5. 验收测试用例矩阵 (Test Matrix)

针对 Coding Agent 开发完成的 Skill，必须通过以下测试用例：

| 用例编号 | 场景描述 | 输入特征 | 必须达到的验收标准 |
| :--- | :--- | :--- | :--- |
| **TC-01** | **完整性与行数锁定** | 任意 100~500 行真实 SRT | 输出行数必须严格 $4N$ 行，`assert len(out) == len(in)` 100% 通过。 |
| **TC-02** | **跨行倒装从句切分** | 英文长定语从句跨越 4 条字幕 | 中文必须符合主谓宾自然语序，切片点位于逗号或连词，禁止头重脚轻。 |
| **TC-03** | **超短时间槽预算压制** | 0.8s 槽位，英文 5 个词 | 中文字数严格限制在 4~5 字以内，CPS 必须 $\le 5.5$。 |
| **TC-04** | **中英混排与专有名词** | 包含 `K-pop`、`AI`、`120 BPM` | 专有名词大小写规范，折算当量准确，行末无句号。 |
| **TC-05** | **长文本分批上下文隔离** | 400 行以上的长视频字幕 | 跨 Batch（如第 40 行到 41 行之间）断句平滑，术语前后 100% 统一。 |
| **TC-06** | **异常恢复机制** | 模拟 LLM 某批次漏掉第 38 行 | Python 校验脚本能够精确报出 `Missing index: 38` 并自动单独补译。 |

---

## 6. 交付形态说明：单文件 `SKILL.md` 落地指南

如果将此需求文档直接封装为 Claude Code / ZCode / Cursor 等 Agent 的单文件 Skill，只需将上述规范浓缩为包含 YAML Frontmatter 的 `SKILL.md`。

Agent 在被调起时将遵循该文档规定的 SOP：
1. **自动创建临时 Python 脚本提取 SRT 并计算预算**；
2. **通读扫描术语形成 Glossary**；
3. **在上下文窗口内分批翻译并产出 JSON**；
4. **运行校验脚本完成 CPS 与完整性检查**；
5. **缝合原生时间轴输出 `<原名>.zh.srt` 并展示交付摘要**。
