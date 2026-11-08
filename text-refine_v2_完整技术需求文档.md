# text-refine v2 完整技术需求文档

状态：草稿 v0.3（2026-11-08），评审中。已定决策见 §2.1，未决项见 §2.2，定稿前不实施。
配套：[video-tts v2 需求文档](video-tts_v2_完整技术需求文档.md)（体例参照）、
[line-break-cases.md](plugins/video-toolkit/skills/text-refine/references/line-break-cases.md)（质量标准，本文档只引用不重复）。
参考来源：[subtitle_translator_skill_v1.md](subtitle_translator_skill_v1.md)（独立 PRD，不可直接采用——冲突清单见 §3.5；其验收场景矩阵已修正吸收进 §16.5）。

# 1 目标与范围

## 1.1 必须交付（P0）

把 text-refine 的 SRT 翻译从"单发全文、靠模型自觉"改造为"四阶段流水线、代码强制门禁"：

1. **批次化受控翻译**：482 条级 SRT 按 40~60 条一批受控翻译，逐批确定性校验，禁止整篇一次性生成、禁止逐条孤立翻译。
2. **1:1 严格映射为默认交付物**：preserve 模式下条数、序号行、时间轴行逐字节保留，译文只替换正文；这是验收底线，不是可选目标。
3. **物理预算进输入**：批次材料必须携带每条 `duration_ms`、`max_han` 预算、`sentence_group`——模型看得到约束才谈得上遵守约束。
4. **统一质量门禁**：preserve 模式补齐阅读诊断（CPS / 行长 / 闪现），分级为 阻塞 / 必修 / 提示（§10）。
5. **结构化术语锁定**：术语探测 → 用户确认 → 锁定进全部批次材料 → 确定性合规扫描。
6. **重试阶梯与断点续跑**：批级重试 → 组级重试 → AskUserQuestion 升级；已提交批次幂等复用。

## 1.2 边界（不做）

- 不调用任何 API 或本地模型：执行者恒为宿主 agent（§2.1 已定）。
- 不自动翻译、不自动启动配音、不付费调用（沿用 v3）。
- 只支持 SRT：MD / TXT 能力随重建移除（D7）；未来有需要另立轻量 skill，不回填进本 skill。
- 不自动生成词级时间数据：`--timing-data` 仍由外部（如 audio-transcribe 对齐结果转换）提供。
- 不重命名 skill，不动插件目录结构。
- 时间轴不改写：v2 全部工作在"译文装进既有时间槽"内完成；语义重排是 semantic 模式的既有能力，不是 v2 新目标。

# 2 决策记录

## 2.1 已定决策（2026-11-08 会话）

| # | 决策 | 内容 |
| --- | --- | --- |
| D1 | 重做对象与方式 | 推倒重建 text-refine（同目录，v3 代码文件全部废弃重写；标准文档与测试用例作为规格继承，见 §5.1），不新建 subtitle-translate skill |
| D2 | 翻译执行者 | 仅 agent 自译（宿主 agent / subagent 读批次材料、写批次稿）；不引入 API provider 层 |
| D3 | 默认交付物 | 严格 1:1 preserve 模式为默认与推荐；semantic 重排保留为显式选择（交互契约见 §12） |
| D4 | 确定性归属 | 时间轴、序号、条数、预算换算、术语合规、CPS 计算、装配全部归 Python；语义、文采、切片归 LLM |
| D5 | 阶段三输入修正 | 批次材料必须含 `duration_ms` / `max_units` / `sentence_group`（修复"要求时间槽约束却不给时长"的矛盾） |
| D6 | 计量双口径 | 排版口径 `display_width`（全角 1.0 / 半角 0.5）管行长；语速口径 `effective_units`（汉字 1.0、英文词按音节当量，如 K-pop = 2.0）管 CPS 与预算；禁止混用（定义见 §10.1） |
| D7 | 任务范围 | 彻底聚焦 SRT：v3 的 MD / TXT 能力随重建移除，输入只接受 .srt；翻译 / 校对 / 精简任务保留但仅限 SRT |

## 2.2 未决项（评审时拍板）

| # | 事项 | 本稿建议 |
| --- | --- | --- |
| U1 | 目录批量排队（E:\AI 分享会 10 个视频）是 P0 还是 P1 | P1：v1 锁单文件核心，批量只加队列清单，不动门禁 |
| U2 | semantic 模式批次化是否与 preserve 同期交付 | P1：semantic 保留 v3 单发流程可用，批次化后置 |
| U3 | `.bilingual.srt` 双语对照衍生输出 | P2：实现廉价（源文 + 译文两行），验收后按需加 |
| U4 | 并行批次（subagent 同时翻多批） | P2：并行只能携带源文上下文、无法携带前批译文尾部，先验证串行质量再开 |
| U5 | 阻塞阈值 10 CPS / 24 字及 §10.1 当量权重（缩写 / 单词 / 长词 / 数字）是否合适 | 用 K-Pop 语料校准后再定（§16.3） |

# 3 当前运作方式与评估依据（v3）

## 3.1 v3 现状（代码事实）

- 三命令 `prepare → review-input → finish`，`VERSION=3`，纯标准库，宿主模型处理语言、Python 保护结构（[skill_main.py](plugins/video-toolkit/skills/text-refine/skill_main.py)）。
- preserve 模式：`{id, text}` 回填，结构校验（样式标签集合不变、无条目分隔空行、渲染后回读一致），时间轴与序号逐字保留（[srt_struct.py](plugins/video-toolkit/skills/text-refine/srt_struct.py)）。
- **preserve 没有任何阅读诊断**：CPS、行长、闪现只在 semantic 模式计算（semantic_timing.py `schedule`），且只作提示不作门禁。
- prepare 的材料已含 `duration_ms`（[skill_main.py:47](plugins/video-toolkit/skills/text-refine/skill_main.py#L47)），但只透传：不换算预算、不进门禁、SKILL.md 也未要求模型参照它。
- SKILL.md 明文"能容纳输入与输出时一次处理，不按 40/60/200 条机械切块"——482 条实际就是一次处理，这正是 v2 要推翻的假设。
- 术语只有 `--terms` 自由文本文件（进材料、不进校验）；无探测、无锁定、无合规扫描。
- 独立审校协议：四哈希绑定（source / draft / candidate / request+engine）、coverage 顺序全覆盖、findings 分 required / optional，翻译无 pass 不得 finish。
- 发布：临时文件 + 硬链接原子落盘、自动编号、永不覆盖源文件。
- 排时参数集中于 `semantic_timing.DEFAULTS`：`target_han_cps=5`、`max_han_cps=7`、`gap_ms=800`、`line_chars=18`、`max_tail_ms=300` 等，`--timing-parameters` 可覆盖。

## 3.2 实测证据 A：K-Pop 中文字幕成品（482 条）

文件：`E:\AI 分享会\How I Made a K-Pop Music Video With AI (Suno + Seedance 2.5) [uo6uTiXsfEY].zh.srt`

- **成功面**：482/482 条数严格对应；时间戳逐条无损；UTF-8 无 BOM、LF，符合输出契约。
- **失败面**：正文最长 48 字；超 25 字 29 条、超 30 字 10 条——违反仓库自身标准（默认单行、14~18 字舒适区，line-break-cases.md §物理版面）。第 6 条源文 `"A"`、时长 80ms，被填"如果是"（han CPS≈37，物理不可读）。
- **归因**：产出流程的校验只查 ID 数量对齐，未查阅读预算与闪现——门禁维度不足，不是模型能力问题。

## 3.3 实测证据 B：成功案例复盘（外部模型五步执行记录）

2026-11-08 后台实际执行 482 条翻译的完整记录，五步：

1. **正则提取、锁定基准**：无第三方库环境下用标准库正则解析，建立 482 条清单，锁定"条数必须恰好 482、时间轴绝不漂移"。
2. **术语与人设预扫描**：分块通读后提取作者口吻（Kareema，10 年音乐背景、极客口语）与全片术语锁——Suno（Stab / Gang Vocals / Trap Pop beat / Hook）、Character Sheet→角色设定图、Zolly / Vertigo Shot→希区柯克变焦、Vocal Stem→纯人声、Motion Transfer→动作迁移、Credits→算力点数、4153 credits。
3. **整句理解、按时间槽回填**：第 1~5 行是同一个倒装长句，先合成完整中文，再按各条时长切片装入对应 ID（例见 §8.2）。
4. **自动查错**：`Missing index` 扫描现场抓出 450~482 缺失及打斗场景段的行数偏移，补齐后 1~482 无一缺漏。**实证：无门禁的 LLM 长输出必然漂移，确定性校验不是可选项。**
5. **程序化装配**：译文与原始时间戳由 Python 缝合输出。

**该案例的盲区（v2 必须补齐的差值）**：

- 校验只覆盖 ID 数量与对齐 → 超长行（证据 A 的 29 条）全部漏出。
- 无 flash 策略 → 80ms 条目被强填 3 字。
- 术语锁只存在于模型脑内 → 无合规扫描，一致性靠运气。
- "1928 = 482×4 行"不是可靠不变量（多行正文会改变行数）；可靠不变量是**条数相等 + 时间戳逐字节相同**。

## 3.4 缺口结论

| 缺口 | v2 对策 | 章节 |
| --- | --- | --- |
| 无批次机制，482 条一次生成 | 批次计划 + 逐批校验 + 断点续跑 | §8 |
| 约束不进输入（D5 矛盾） | duration / max_han / sentence_group 进材料 | §8.2 |
| preserve 无阅读门禁 | 统一诊断分级：阻塞 / 必修 / 提示 | §10 |
| 无 flash 策略 | <500ms 条目空填并入 + 强制报告 | §6、§8.4 |
| 术语无锁定无扫描 | 探测 → 确认 → 锁定 → 合规门禁 | §7 |
| 校验失败无路可走 | 批级 → 组级 → AskUserQuestion 升级 | §8.4 |
| 反面假设写进了 SKILL.md | 重写执行方式章节 | §13 |

## 3.5 与 subtitle_translator_skill_v1.md 的关系（不可直接采用）

该文档是"新建 subtitle-translator 单文件 skill"的独立 PRD，与本文档同源但存在已裁决的冲突；保留为参考，冲突处一律以本文档为准：

| # | 该文档主张 | 冲突与结论 |
| --- | --- | --- |
| 1 | 新建单文件 skill，agent 每次现场自建临时 Python 脚本 | 违背 D1（重做 text-refine）；现场脚本无版本、无测试、无引擎哈希绑定，与仓库"固定版本化脚本"哲学相反，不采纳 |
| 2 | `max_chars = max(4, int(d×4.0))` + `[0.7×, 1.3×]` 容差 | min-4 下限合法化 <0.8s 不可读条目（无 flash 策略）；双层容差使预算 / 容差 / CPS 三线打架；4.0/s 与仓库 5/7/10 分级冲突。已修正为预算软指导 + CPS 硬分级（§6、§8.2、§10.2） |
| 3 | CPS 告警 5.5 / 强制精简 6.0 | 其自带切片示例自我违约：ID1 填 13 字超自定容差上限 11.7，ID3 15 字 ≈7.2 CPS 超其自身 6.0 线——实证"字符预算 ± 容差"路线走不通，CPS 分级才成立 |
| 4 | 裸正则解析器 | 要求序号行、固定 3 位毫秒、无坐标 / 缺序号容错；`srt_struct.py` 各项均更强，保留仓库实现 |
| 5 | TC-01"输出必须严格 4N 行" | 伪不变量（多行正文即破）；正确不变量是条数相等 + 时间戳逐字节（§16.1） |
| 6 | 行末严禁句号 | 与 line-break-cases.md 冲突（语义需要则保留，不为美观删标点），以仓库标准为准 |
| 7 | 无独立审校 / 哈希绑定 / 原子发布，Python 3.10+ | 丢失仓库硬协议；审校、绑定、发布机制全部保留（§9、§11），Python ≥3.9 |
| 8 | 可取之处 | 四痛点与 §3.4 缺口互证；批次 rules 的提示表述；验收场景矩阵（修正后吸收为 §16.5） |

# 4 实施优先级

- **P0**：批次机制与逐批门禁（preserve）；预算换算与材料 Schema；flash 空填策略；结构化术语锁定与合规扫描；统一阅读诊断分级；重试阶梯；SKILL.md 重写；测试（§16.4）。
- **P1**：semantic 模式批次化；目录批量排队（U1）；审校增强——阅读诊断条目必须被 resolved finding 覆盖才可 finish；批次材料动态携带前批译文尾部。
- **P2**：并行批次（U4）；跨运行单元级缓存；专名多译法模糊检测；`.bilingual.srt` 衍生（U3）。

# 5 四阶段管线总览

## 5.1 重建原则（D1：推倒重建）

- **代码零继承**：v3 的 `skill_main.py / srt_struct.py / semantic_timing.py / textblocks.py` 与 `SKILL.md / file-interface.md` 全部废弃重写，旧代码不作为新实现的起点。
- **知识全继承**：旧实现验证过的容错矩阵、不变量与全部测试用例作为**规格与验收输入**移植（不是代码搬运）；`line-break-cases.md` 质量标准原文保留。
- **重建顺带丢弃的历史包袱**：resegment 手填时间兼容模式；"能容纳就单发"路径（批次管线成为唯一翻译路径）；`--terms` 自由文本（结构化 glossary 取代）；semantic 单发翻译路径（semantic 按 U2 时机重建）；MD / TXT 多格式支撑与 `textblocks.py`（D7）。

| 阶段 | 内容 | v3 现状（仅作规格参照） | v2 重建 |
| --- | --- | --- | --- |
| 1 解析与断言 | SRT 解析、诊断、基准锁定 N | `srt_struct.py` 容错矩阵完备 | 重写实现，按 §6 规格验收；新增 flash 集合与预算表 |
| 2 语义分组与术语锁定 | 句组划分、术语探测、口吻定调 | 无 | 新建：代码先行分组 + agent 调整；结构化术语闭环 |
| 3 批次化受控翻译 | 带预算与上下文的分批翻译 | 无（单发全文） | 新建：material / check / status 命令、重试阶梯 |
| 4 确定性审计与装配 | 全文件校验、装配、审校、发布 | candidate / finish 维度不足 | 重写实现：preserve 补阅读诊断、术语全扫、flash 清单 |

## 5.2 数据流

```text
输入.srt
  └─ prepare ──→ 任务(临时目录) + 基准 N + 诊断 + 语义组(代码先行) + 术语候选(确定性)
       └─ agent 通读脉络 → 术语表 → AskUserQuestion 确认 → glossary 锁定
            └─ 每批: material(带预算/组标/上下文) → agent 翻译 → check
                        │ 未过: 定向重试(≤2) → 组级 → AskUserQuestion 升级
                        │ 过: 幂等合并入 master draft
            └─ 全批完成 → review-input(独立 agent, 四哈希绑定) → 修订复核
                 └─ finish: 全文件审计 + 装配 + 原子发布 {原名}.zh.srt
```

# 6 阶段一：解析与断言

- 解析器按本节规格重写（v3 实现仅作规格参照，`test_srt_struct` 用例全部移植为验收）。必须覆盖其验证过的容错矩阵：序号行可选、时间轴行整行保留（含 `X1:` 坐标等附加信息）、`\r\n` / `\r` / LF 统一、UTF-8 BOM 剥离、重叠 / 重号 / 断续序号 / 空正文 / 零时长只诊断不掩盖、时间反向才是阻塞错误——各项均强于外部 PRD 的裸正则方案（§3.5 #4）。
- 条目 ID 按源位置生成 `entry-%06d`，不依赖显示序号（重复断号免疫）。渲染只替换正文，序号与时间轴逐字保留。
- **新增（确定性，prepare 内完成）**：
  - flash 集合：`duration_ms < flash_ms`（新参数，默认 500）的条目集合。
  - 预算表：非 flash 条目 `max_units = max(2, floor(duration_s × budget_han_cps))`，`budget_han_cps` 复用 `target_han_cps`（默认 5），单位为语速当量字（§10.1 `effective_units`）；flash 条目无预算，标记 `flash: true`。
  - 取整一律 `math.floor`，禁止 round / ceil 混用（对照案例：示例数字与自定公式不一致的教训）。
- 基准断言：`N = len(entries)` 写入任务，finish 前 `len(输出条目) == N` 与时间戳逐字节比对是硬门禁。

# 7 阶段二：语义分组与术语锁定

## 7.1 语义分组（sentence_group）

- **代码先行**（prepare 内，确定性）：以句末标点（`. ! ? …`）或条目间留白 ≥ `gap_ms`（800）为界，把连续条目切成语义组；组是 `1..N` 的**连续、不重叠、全覆盖**分区，此不变量由 check 强制。
- **agent 可调整**：批次内允许合并相邻组（句子未完、标点误导时），禁止拆分组、禁止跨批界调整——调整后仍必须是连续分区。
- 组 ID 形如 `g001`，写入批次材料的 `sentence_group` 字段（D5）。

## 7.2 术语闭环

1. **确定性候选**（prepare）：拉丁字母序列频次 ≥3、含大写、非纯句首大写启发式，提取候选专名 / 产品名 / 术语清单。
2. **agent 通读定表**：结合全片脉络给出 `[{source, target, notes}]` 结构化术语表（案例步骤 2 即此步的模型自觉版：Suno / Character Sheet→角色设定图 / Zolly→希区柯克变焦 / Vocal Stem→纯人声 / Motion Transfer→动作迁移 / Credits→算力点数）。
3. **AskUserQuestion 确认**（§12 决策矩阵）。
4. **`glossary` 命令锁定**：结构化 JSON 写入任务；此后所有批次材料携带，审校材料携带。
5. **合规门禁（确定性）**：源条目文本含锁定术语 → 对应译文必须含锁定译法；violation 为阻塞错误（§10）。`--terms` 旧自由文本保留兼容：进材料、不进门禁，文档明示差异。

## 7.3 口吻定调

agent 通读后写 `style_note`（如"创作者教程，自豪、利落、极客口语"）存入任务，批次材料与审校材料共用。不做代码校验（文体不可确定性判定），审校按 line-break-cases.md §字幕文体与术语 检查。

# 8 阶段三：批次化受控翻译（核心新增）

## 8.1 批次计划（prepare 内，确定性）

- 语义组打包成批：**批界必须落在组界**；每批 40~60 条且可见字符 ≤5500（新参数 `batch_entry_max / batch_entry_min / batch_chars_max`，进 DEFAULTS 可覆盖）。
- 最后一批不足 `batch_entry_min` 时并入前批（仍不跨组拆分）。

## 8.2 批次材料 Schema（D5 修正的核心）

`material <workdir> --batch N` 生成，UTF-8 JSON：

```json
{
  "instruction": "<版本化指令模板渲染；模板哈希进 request 绑定>",
  "target_lang": "zh",
  "style_note": "创作者教程，自豪、利落、极客口语",
  "glossary": [{"source": "Character Sheet", "target": "角色设定图"}],
  "context": {"prev_group_source": "...", "next_group_source": "...", "prev_batch_tail_translation": "..."},
  "items": [
    {"id": "entry-000001", "text": "Every single frame of the music video you",
     "duration_ms": 2240, "max_units": 11, "sentence_group": "g001", "flash": false},
    {"id": "entry-000006", "text": "A",
     "duration_ms": 80, "max_units": null, "sentence_group": "g002", "flash": true}
  ]
}
```

- `max_units` 是**软指导预算**（给模型看的红线刻度，单位为 §10.1 的语速当量字），门禁在 §10 用 CPS 硬算，两者同源于 `budget_han_cps`，不叠加容差（±20% 类双层容差会让预算线、容差线、CPS 线互相打架，不采用）。
- 预算与 CPS 统一用语速当量 `effective_units`（D6）：汉字计 1.0，英文单词按音节当量折算（K-pop = 2.0，详见 §10.1）；纯汉字条目当量 == 汉字数，既有阈值无缝沿用。
- `context`：邻组源文静态携带；`prev_batch_tail_translation` 在前批已提交时由 material 动态注入（顺序执行，U4 并行时此字段缺席）。

**预算算例**（K-Pop 第 1~5 条，`floor(duration_s × 5)`）：

| id | duration_ms | max_units | 参考译文 | 当量 units | 实测 CPS | 分级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 2240 | 11 | 你刚刚看到的那支音乐视频里的 | 14 | 6.25 | 5~7 提示 |
| 2 | 2080 | 10 | 每一帧画面，包括那首 K-pop 歌曲、 | 13（11 汉字 + K-pop 2.0） | 6.25 | 5~7 提示 |
| 3 | 1600 | 8 | 故事情节、对口型， | 7 | 4.38 | 通过 |
| 4 | 1040 | 5 | 以及打斗场面， | 6 | 5.77 | 5~7 提示 |
| 5 | 2080 | 10 | 全都是在我的笔记本电脑上生成的。 | 15 | 7.21 | 7~10 必修 |

两点校准启示：① 第 2 条按纯汉字口径只有 5.29 CPS，当量口径 6.25 才是真实阅读负担——han-only 对混排行**系统性低估**，这是 D6 的实证依据；② 连人工认可的译文也会落进 7~10 必修带（第 5 条 7.21）——该档必须是"定向精简重试 / 审校说明后放行"，不能一刀切阻塞，">10 才阻塞"的分级由此定标（§10、U5）。

## 8.3 批次稿格式

```json
{"items": [{"id": "entry-000001", "text": "你刚刚看到的那支音乐视频里的"}]}
```

- 只回 `id` + 译文，不回时间戳、不回序号（结构与内容分离；时间轴由 Python 独占）。
- 用数组不用 `{id: text}` 扁平字典：JSON 对象无序且重复键静默覆盖，审计需要确定顺序。
- flash 条目允许 `"text": ""`（空填，内容并入邻条）；非 flash 条目空文本为阻塞错误。
- 单条正文单行（默认版面），含 `\n\n` 或 `-->` 为阻塞错误。

## 8.4 逐批校验与重试阶梯

`check <workdir> --batch N --draft <path>`，通过即幂等合并入 master draft 并记 `status.json`：

**校验项（全部确定性）**：ID 集合恰好覆盖本批（缺 / 多 / 重皆为错）；非 flash 非空；flash 空填登记；无结构泄漏（空行 / `-->` / NUL）；术语合规（§7.2.5）；CPS 与行长分级（§10）；组完整性（组内条目同批出现、连续分区不变量）。

**重试阶梯**：

1. 批级重试 ≤2 次：check 返回逐条错误清单（id + 违规项 + 实测值），agent 只修复被点名的条目。
2. 组级重试：仍失败的组单独重翻（携带更宽上下文）。
3. AskUserQuestion 升级：选项为「保留该组原文」「人工提供译文」「放宽预算参数重试」；**不提供跳过门禁的选项**。

# 9 阶段四：确定性审计与装配

- 装配重新实现同语义：preserve 渲染时序号 / 时间轴行逐字保留、只替换正文；semantic 重排后 1..N 重新编号（按 U2 时机重建）。
- **全文件审计（finish 前）**：
  - 条数断言 `len == N`；preserve 模式时间戳 + 序号行与源逐字节比对（不是行数比对——多行正文使"482×4=1928 行"不成立）。
  - 术语合规全量扫描。
  - 阅读诊断全量计算——**preserve 也算**（v3 缺口），口径 = `effective_units` / `display_width` / `visible_char_count`（§10.1）。
  - flash 空填清单必须出现在 finish 返回的 warnings（显式报告，不静默）。
- 输出契约：UTF-8 无 BOM、LF、`{原名}.zh.srt`（翻译默认）或 `{原名}_refined.srt`（校对 / 精简）；自动编号防覆盖、永不覆盖源文件、原子落盘（临时文件 + fsync + 硬链接）按 v3 验证过的同一机制规格重新实现。

# 10 质量门禁分级

## 10.1 计量口径（D6）

三个度量各司其职，禁止混用：

| 度量 | 定义 | 用途 |
| --- | --- | --- |
| `effective_units`（语速当量） | 汉字 / 全角符号计 1.0；连续拉丁 / 数字词按音节当量折算：全大写缩写每字母 1.0（AI=2.0、LLM=3.0），普通词 2.0（K-pop、Suno），长词 `max(2.5, len/3)`，纯数字串每字符 1.0（4153=4.0）；标点 / 空白不计 | CPS 门禁与 `max_units` 预算（时间口径） |
| `display_width`（排版宽度） | 汉字 / 全角符号 1.0，半角字符 0.5（K-pop = 2.5） | 行长门禁（视觉口径；修复现行 `len(line)` 把半角按全角计的口径混乱） |
| `visible_char_count` | 现行定义保留 | 仅当 `effective_units` 为 0 的纯外文行沿用 `max_visible_cps`，避免重校英文阈值 |

- 当量权重是 `DEFAULTS` 平铺数值参数（`unit_acronym_per_char`、`unit_word`、`unit_long_min`、`unit_long_divisor`、`unit_digit`），不硬编码进函数；`--timing-parameters` 可覆盖，U5 校准。
- 词切分 `[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*`（K-pop 记一个词）；汉字范围沿用 `[\u3400-\u9fff]`（含扩展 A）。
- 纯汉字条目 `effective_units == 汉字数`，5 / 7 / 10 阈值无缝沿用；纯外文行行为不变；仅混排行改为当量计——正是现行口径的缺口。

## 10.2 分级

阈值集中于 `semantic_timing.DEFAULTS`（新增 `flash_ms=500`、`block_units_cps=10`、`block_line_chars=24`、批次参数与 §10.1 当量权重），`--timing-parameters` 可覆盖。诊断口径与 line-break-cases.md §阅读速度一致。

| 级别 | 触发（CPS 用 `effective_units`；行长用 `display_width`） | 处置 |
| --- | --- | --- |
| 阻塞（代码，必须重试） | 条数 / ID 覆盖 / 时间戳或序号变动；非 flash 空文本；结构泄漏；术语违规；当量 CPS >10；行长 >24 | check / finish 直接失败，进重试阶梯；审校无权放行 |
| 必修（进审校，必须 resolved） | 当量 CPS 7~10；行长 18~24；flash 空填本身；单条 >6s 长展示 | 生成 required finding，未 resolved 不得 finish（P1 起由 finish 强制核对 finding 覆盖） |
| 提示（进材料与审校视野） | 当量 CPS 5~7；行长 14~18；`srt-estimate` 估算披露 | 供审校参考，不强制 |

# 11 独立审校协议（保留与增强）

- 保留：翻译必须独立 agent 审校（信 / 达 / 雅），四哈希绑定（source / draft / candidate / request+engine），coverage 顺序全覆盖，无 pass 不得 finish，禁止自检替代、禁止伪造 reviewer_id。
- 增强（P1）：
  - review-input 材料追加：批次结构、术语锁、阅读诊断清单、flash 空填清单。
  - finish 核对：每个"必修"级诊断条目必须被对应 `resolved` finding 覆盖，否则拒绝发布。
  - 审校检查项追加：术语一致性、专名译法统一、flash 并组后语义完整。

# 12 AskUserQuestion 交互契约

沿用全仓强制规则：一切用户选择必须走 AskUserQuestion 控件，不得文字列选项代替、不得默选。

| 决策点 | 触发 | 选项 |
| --- | --- | --- |
| 任务类型 | 意图不明 | 原语言校对 / 翻译 / 精简润色 |
| 目标语言 | 翻译未指定 | 推荐 zh |
| 时间策略 | SRT 翻译未明确 | **严格 1:1（默认推荐）** / 自然重新分段（披露：新增时间为估算，用户选择即覆盖披露）——与 v3 推荐顺序相反，属 D3 落地 |
| 术语确认 | 探测完成 | 展示候选表：确认 / 增删改 / 不锁定（明示后果：不进合规门禁） |
| 预算参数 | 触发 U5 校准变更时 | 调整阈值重试 / 维持现值 |
| 重试升级 | 组级重试仍失败 | 保留原文 / 人工供稿 / 放宽预算重试（无跳过门禁项） |
| 覆盖输出 | 目标文件已存在 | 覆盖 / 自动编号 |

# 13 CLI 与文件接口变更

| 命令 | v3 | v2 |
| --- | --- | --- |
| `prepare` | 全文材料 | + 语义组（代码先行）+ 术语候选 + flash 集合 + 预算表 + 批次计划 |
| `glossary` | — | 新增：锁定结构化术语表 |
| `material` | — | 新增：`--batch N` 生成批次材料（§8.2 Schema） |
| `check` | — | 新增：逐批校验 + 幂等合并 + 错误清单 |
| `status` | — | 新增：批次进度与断点状态 |
| `review-input` | 原文 + 候选 + 摘要 | + 批次结构 / 术语锁 / 阅读诊断 / flash 清单（P1） |
| `finish` | 审校 + 装配 + 发布 | + 全文件阅读诊断、术语全扫、flash 清单 warnings、finding 覆盖核对（P1） |

- 全新接口，无兼容承诺：旧临时任务、旧 draft 格式、旧参数全部失效；`file-interface.md` 随代码重写；skill 目录全量替换后需刷新插件缓存分发。
- 指令模板独立成文件、哈希进 request 绑定：改模板与改代码同样使旧审校失效。
- SKILL.md 重写"执行方式"：删除"不按 40/60/200 条机械切块"，替换为批次流（material → 翻译 → check → 合并 → 审校 → finish），任务类型 / 交互规则 / 只交付最终文件等章节保持既有约束。

# 14 失败恢复与断点续跑

- 临时任务持续到 finish 成功才清理（沿用 v3）；`status.json` 记录每批状态，重跑 `check` 对已提交批次幂等直接通过。
- 翻译中途中断：workdir 存活则从断点续跑；workdir 丢失（系统清理临时目录）= 重译，可接受，v2 不做跨运行缓存（P2 再议）。
- 失败退出码沿用：0 成功 / 2 用法 / 3 输入、结构、审校或文件操作失败。

# 15 平台与依赖

- 纯标准库，Python ≥3.9，Windows / macOS / Linux 一致行为；无网络、无模型、无 GPU 依赖。
- Windows 细节沿用：发布用硬链接原子落盘，不支持硬链接的文件系统明确失败而不降级为可能覆盖的方式。

# 16 验收标准

## 16.1 硬不变量（可脚本断言，任一失败即不通过）

1. 输出条数 == 输入条数 N（preserve 与 semantic 分别按各自契约）。
2. preserve：全部序号行与时间轴行与源文件**逐字节相同**。
3. 非 flash 条目无空译文；全部空译文条目出现在 finish warnings。
4. 锁定术语合规扫描零违规。
5. 无当量 CPS >10、无排版宽度 >24 的条目发布。
6. 审校协议完整：独立 reviewer_id、四哈希匹配、coverage 全覆盖、无未解决必修 finding。

## 16.2 真实语料回归

- 语料：`E:\AI 分享会` 10 个英文 SRT（13904~53231 字节，约 200~700 条量级）。
- 重点用例 K-Pop 482 条：
  - 第 6 条（`"A"`，80ms）走 flash 空填并入，不出现"如果是"式强填；
  - 用 v1 产出的 29 条超长译文作为门禁负例——必须全部被分级拦截；
  - 时间戳与源逐字节 diff 为空。

## 16.3 校准验收（U5）

在 K-Pop 与至少 2 个其他语料上人工评审译文后，统计 5~7 / 7~10 / >10 CPS 带的分布与误报率，据此确认或调整 `block_han_cps` / `block_line_chars`，结论回写本文档。

## 16.4 测试清单（新增）

批次计划（组界 / 条数 / 字符上限 / 末批合并）；预算表（floor 取整、flash 无预算、min 2）；`effective_units` / `display_width` 计量（混排行、纯汉字、纯外文、全大写缩写、数字串、连字符词，权重参数覆盖生效）；material Schema 字段完整性与上下文注入；check 各失败模式（缺 / 多 / 重 ID、空文本、结构泄漏、术语违规、CPS 分级、组不变量）；幂等合并与断点续跑；glossary 锁定与 `--terms` 兼容差异；finish 全文件审计与 warnings；指令模板哈希绑定。旧 `test_srt_struct / test_semantic_timing / test_textblocks / test_cli` 的 SRT 相关用例全部移植为新测试的规格输入（MD/TXT 相关用例随 D7 移除，不移植），不要求旧测试文件本身存续。

## 16.5 验收场景矩阵（吸收自 subtitle_translator_skill_v1.md TC 表，已修正）

| # | 场景 | 输入特征 | 验收标准 |
| --- | --- | --- | --- |
| S1 | 完整性与时间锁 | 100~500 条真实 SRT | 条数相等、序号 / 时间轴行逐字节相同（不检查"4N 行"） |
| S2 | 跨行倒装切分 | 英文定语从句跨 4~5 条 | 中文主谓宾自然语序；切片落在标点 / 连词；组内当量分布连续无堆积 |
| S3 | 超短时间槽 | 0.8s 槽位 5 个英文词 | ≤4~5 当量字、CPS ≤5.5；<500ms 条目走 flash 空填并入且出现在 warnings |
| S4 | 中英混排与专名 | 含 K-pop、AI、120 BPM | 当量折算按 §10.1；术语锁合规零违规；标点遵循仓库标准（不硬禁句号） |
| S5 | 跨批连续性 | 400 条以上长字幕 | 批界全部落在组界；术语 100% 统一；邻组上下文携带生效、断句平滑 |
| S6 | 异常恢复 | 注入漏行 / 空行 / 超速条目 | check 精确点名 id + 违规项 + 实测值；重试阶梯生效；断点续跑幂等 |
