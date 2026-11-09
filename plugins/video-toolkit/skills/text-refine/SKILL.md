---
name: text-refine
description: >
  字幕/文本校准与翻译工具。默认保持原语言校对 ASR 转录文本，
  修正错别字、同音字、专业术语与标点；只有用户明确要求时才翻译为中文。
  当用户要校准、校对、修正字幕、字幕纠错、错别字修正、校对ASR、
  修正转录、整理字幕、字幕美化、转录校准、文本纠错、refine、字幕翻译时触发此 skill。
  保持输入格式不变：SRT 进 SRT 出（默认完整保留时间轴与条目数），
  MD 进 MD 出，TXT 进 TXT 出。多个 SRT 时一个文件对应一个 agent，
  最多 3 个 agent 并行（含主 agent）。无需第三方依赖；有 Python 时可用标准库做结构校验。
---

# Text Refine

校准 ASR 转录文本：修正错别字、同音字、专业术语和标点；默认保留原语言、原信息和 SRT 时间轴。只有用户明确要求时才翻译。

**无需第三方依赖** — 宿主模型完成校准；有 Python 时可用标准库做结构校验。

## 优先级（冲突时按此顺序）

1. **原意准确**：事实、否定、条件、程度、数字、单位、版本号、因果、时序不变；不增删、不歪曲。
2. **术语准确**：人名、作品名、产品名、专业术语、版本号正确且全篇一致；不确定的保留原文并列入疑点，不猜。
3. **时间对应**：条目数、序号、时间轴不变；跨条句子按原时间槽分配，不把未说出的关键信息提前。
4. **阅读舒适**：CPS、行宽、行数；不达标时先调整表达或标记，不通过删事实解决。
5. **文风漂亮**：口语自然、节奏、修辞；只在前面四项满足后再优化。

任何两条冲突，前者优先。不要为了文风或阅读舒适牺牲原意、术语或时间对应。适用于校对、翻译和重排版。

## 第一步：判断任务意图

| 用户说法 | 执行 |
|---|---|
| "校准/校对/纠错/修正字幕" | **原语言校对**（默认）。英文就校对英文，不要自动翻译 |
| "翻译/译成中文/translate" | 先对原文做保守校正，再翻译为中文；翻译后做中文适配 |
| "翻译成英文/日文…" | 本 skill 只为中文目标优化；其他语言说明限制，用 AskUserQuestion 问是否改用中文或另用翻译工具，不要硬译 |
| "整理成文章/转成 Markdown" | 仅在明确要求时改变格式；先说明时间轴会丢失 |
| "处理一下/refine 一下" | 默认按原语言校对；只有目标语言/是否翻译/是否重排版确实影响执行且上下文无法判断时，才用 AskUserQuestion |
| "校准/翻译这些 SRT"（多个文件） | 一个文件一个 agent，最多 3 个；任务是否相同不明确时先用 AskUserQuestion 确认 |

- 不要因为输入是英文就自动翻译；这是最常见的越权。
- 用户已说明目标语言、术语或风格时，沿用，不重复询问。
- 本 skill 默认不做摘要/压缩。原语言校对默认保留口头禅、停顿和重复；用户明确要求去口头禅/精简口语，或任务明确是翻译时，才按下面的保真规则调整，不删除事实、条件、否定和数字。

## 用户选择

任何需要用户做选择的事项——任务类型、是否翻译、目标语言、是否拆分/重排版、多文件任务是否一致、是否覆盖已有文件、是否继续——都用 AskUserQuestion（或宿主等价控件）提问，不在普通消息里列选项代替。用户已经明确说过的偏好直接沿用，不重复询问。
能按上下文合理判断时（例如只说"refine 一下"），默认按原语言校对直接执行，不为了确认而反复弹框；只有选择会改变输出结果且无法判断时才问。

## 铁律：格式与结构

| 输入 | 输出 | 文件名 |
|------|------|--------|
| `.srt` | `.srt` | `{原文件名}_refined.srt` |
| `.md` | `.md` | `{原文件名}_refined.md` |
| `.txt` | `.txt` | `{原文件名}_refined.txt` |

**为什么这条最重要**：SRT 是带时间轴的字幕交换格式，播放器、剪辑软件和 `video-tts` 等下游 skill 都按 SRT 解析。格式不是"展示样式"，是契约——**只改文字，不动结构**。

规则冲突时按"原意 → 术语 → 时间 → 阅读 → 文风"取舍；时间轴属于第三优先级，不因排版或文风让步。

- **SRT 默认严格 1:1**：条目数、序号、每条时间轴（`HH:MM:SS,mmm --> HH:MM:SS,mmm`）逐字保留；不合并、不拆分、不重排。
- 同一 cue 内的机械硬换行（约 20~21 字处折断、标点孤行）先合并成自然句，再校准；这不算改条目边界，不动时间轴。双语/双行字幕或用户明确要求两行时保留原换行。
- 只有用户明确说"重新分段/拆条/重做时间轴"时才允许改条目数和时间码；执行前说明时间轴会变化，执行后逐条校验。
- 不主动改版式。用户要求排版时，分别检查三件事：
  - **阅读速度**：每秒多少字（CPS），是舒适度参考，不是硬上限；4 字/秒可作默认舒适目标，成人节目可参考最高 9 字/秒。
  - **行宽**：每行多少字；简中字幕可参考 16 字/行，按平台调整。
  - **行数**：每条通常最多 2 行。
  三者冲突时内容优先；不要为凑 CPS、行宽或行数删事实，超标的条目在报告中标记。
- 保留样式标签和说话人标记：`<i>`、`<font>`、`{\an8}`、`>>`、`[音乐]`、`（笑声）` 等标签本身和标记原样保留，标签内的自然语言文字照常校准/翻译。
- 不改扩展名，不"因为 Markdown 更好读"就转换格式。
- SRT 输出 UTF-8 无 BOM，条与条之间空一行，不添加 Markdown 标记；MD/TXT 保持原结构。

### 输入异常

- 文件为空、没有有效条目、时间格式无法解析、起点晚于终点：停止并报告，不生成"成功"的空文件。
- 序号不连续、时间重叠、极短展示时间：原样保留并在报告中指出，不自动"修正"。
- `.vtt`、`.ass`、`.json` 等未列出的格式：不要猜；说明支持范围，或征得同意后转换并校验时间轴。

### MD / TXT 结构保护

- Markdown：标题层级、列表、引用、表格、代码围栏、行内代码、链接地址、图片地址、frontmatter、HTML 属性、公式、脚注默认原样保留，只校准自然语言文字。
- 带时间码的 Markdown（如 `audio-transcribe` 的 `.timed.md`）把行首/段首时间码视为受保护内容，只改文字。
- 链接可见文字可以校准或翻译，链接地址保持不变；代码块、命令、路径、URL、邮箱默认不碰；用户明确要求翻译注释时，只改注释，不改代码逻辑。
- TXT：保持纯文本分段，不引入 Markdown 语法。
- 默认不做"重排版"；只有用户明确要求美化/重组时，才按下面的规则调整结构。

#### 显式美化/重排版（仅在用户要求时）

- 仅对 MD/TXT；SRT 不加标题、加粗、引用块或分隔线。
- MD：按主题添加 `##` / `###`，标题简洁反映主旨；专业术语、核心概念首次出现可加粗，人名、作品名不加粗（作品用《》）；分类、要点可列表化；按语义分段，每段 3~8 句；重要引用用 `>`；主要章节之间用 `---`，前后留空行，避免被解析成标题或破坏 frontmatter。
- TXT：只调整空行和分段，不引入 Markdown 语法；要 Markdown 就明确输出 `.md`。
- 美化不得删减事实、改变语义或压缩内容；用户要求"整理成文章"时，先说明时间轴会丢失。

## 语言与翻译

### 原语言校正（默认）

- **英文原文校正**：只修明显 ASR 错误、恢复标点、保留完整含义；**不套用中文 CPS/行宽预算**。
- 英文 `. ? !` 句末标点是句子边界，校正阶段保留，不要为了"字幕风格"删掉。
- 中文校对按中文标点规则；繁体中文不自动转简体，除非用户要求。
- 中英夹杂时，只改有证据的 ASR 错误，不把正常英文术语翻译掉。
- 默认保留口头禅、停顿、重复和语气词；只有用户明确要求精简时才删，且不删事实、语气和说话人态度。
- 否定、条件、程度、数字、单位、版本号、因果关系必须保护。

### 翻译三遍法（仅明确要求时）

翻译不是逐条替换。按“先理解、再纠错、最后润色”执行；下面的通用约束同样适用。

#### Pass 1：全局扫描（翻译前必做）

先读完整英文，不边读边译；写一份内部简报（不写进 SRT）：

- **标题/文件名先验（必须）**：用户提供的视频标题或文件名必须作为 Pass 1 的第一背景先验输入。标题常已确定平台、主题和术语方向，例如 `6 Steps to Stop Burning AI Credits` 直接指向 AI 视频与积分控制。没有标题时，用用户说明、首尾样本补足。
- 标题只作先验，不替代全文阅读；标题与正文冲突时以正文为准，并标疑点。
- 主题/目的：
- 受众/讲者口吻：
- 源可信度/ASR 质量：
- 已确认术语/产品名：
- 疑似 ASR 混淆/口播重复：
- 翻译策略（口语化程度、TTS 节奏）：

示例（6 Steps）：

- 标题先验：6 Steps to Stop Burning AI Credits → AI 视频/积分控制主题
- 主题：AI 视频工作流、Higgsfield、积分控制
- 口吻：专业、干练、口语化
- 源可信度：低（廉价 ASR，必须逆向纠错）
- 术语：Higgsfield、Soul Cinema、Soul ID、Cinema Studio、Seedance 1.5、character sheet、draft mode、relight
- ASR 混淆：Hixel/HistoTool/Excel→Higgsfield；sequence/Scene→Seedance；drama→draft；relate→relight；credit cards→credit costs
- 口播重复："I've been using AI to make AI videos" 的核心是"用生成式 AI 做视频"
- 策略：中文口语化、术语统一、句子适配 TTS 和时间槽

同一系列多文件共享这份简报；子 agent 必须使用主 agent 的简报。

#### Pass 2：ASR 逆向纠错（先修英文，再翻译）

输入是廉价 ASR：同音错词、连读丢失、重复、残句。先拿术语表和全文语境反推原词，再翻译。

- 词典示例：relate me→relight me；drama→draft mode；Hixel/HistoTool/Excel→Higgsfield；sequence/Scene→Seedance；credit cards→credit costs。
- 口播重复/语义冗余先提炼核心意图，不逐词直译。例："I've been using AI to make AI videos" → "用生成式 AI 做视频"。
- 只改有证据的；不确定保留原文并列疑点；不要为了通顺编造。
- 如果译文出现明显不合逻辑的短语，回到 Pass 2 检查英文源，不要硬译。

#### Pass 3：中文润色（TTS 可听性）

- 按纠正后的语义翻译；自然口语，去机翻腔和从句套从句的欧化句式。
- 术语用中文圈主流说法：credits=积分、prompt=提示词、up-res=超分/放大、character sheet=角色设定图。
- 句子长度适配时间槽/TTS；事实、否定、条件、数字、单位、版本号、因果不因润色改变；不删事实降 CPS。
- 保留讲者语气、强调、信息关系；不添加原文没有的内容。
- SRT 仍严格 1:1；允许在相邻条目内调整语序，但不要把整句提前/延后多条。
- 没有视频/截图时，不推测画面内容，不自行生成"【画面：…】"。
- 翻译后的文本只做通顺、术语和标点检查，不再套用同音字纠错表。

#### 硬门禁（防止纠错被翻译吞没）

- 没有 Pass 1 简报不开始翻译。
- 所有疑似 ASR 句先过修复表：`n / raw / corrected / confidence(A/B/C) / evidence / action`。B/C 级保留原文/最小译法并列疑点；译者不得把 raw 里的明显错词直接译成中文。
- 译者以修复后的英文为主输入；raw 只用于对照时间槽。
- 交付前做“中文单独可读”检查：脱离英文读不通的条目退回 Pass 2；不得用“脑补一个合理中文”掩盖 ASR 错误。
- 审校按优先级检查：原意/术语/时间/阅读/文风；发现 ASR 直译残留，退回对应 Pass，不做整篇重写。

### 翻译通用约束

- 目标语言为简体中文；其他目标语言不在本 skill 保证范围内，说明限制并建议另用翻译工具。
- 翻译保留事实、否定、条件、时态/时序、因果、程度和重要语气；数字、金额、百分比、单位、版本号必须准确。
- 人名、作品名、产品名、术语全篇一致；没有把握的专名保留原文并列入疑点，不臆造。
- 批次优先在句子结束处切分；无标点 ASR 可用时间空档/连接词找候选句界；相邻上下文只供理解，不重复输出；不要按固定 40~60 条硬切。
- 原文几乎没有标点时，用相邻时间空档（>0.5s）和连接词辅助判断句界。
- 翻译前先对原文做保守校正；不要先删口头禅/压缩内容再翻译。
- 翻译允许调整句法、合并/拆分口语碎片，但保留语义、语气、强调和信息关系。
- 先理解完整句意，再分配回时间槽；不要把尚未说出的关键信息提前显示。

### 术语优先级

用户指定术语 > 用户提供的资料 > 全文一致用法 > 领域常用译名 > 通用词表。冲突时保留用户指定并说明，不静默覆盖。

## 校准规则：证据优先

### 核心原则

- 先理解全文主题、说话人和上下文，再逐段校准；不孤立地逐句改。
- 文字通顺不代表原文有错；没有音频时，也不能证明某句是 ASR 幻觉。
- 改与不改按证据分级：

| 等级 | 情况 | 处理 |
|---|---|---|
| A | 上下文能明确证明是 ASR 错字/误识 | 直接改 |
| B | 可疑，但证据不足 | **保留原文**，列入疑点清单 |
| C | 正常表达、术语、引用、风格 | 不改 |

- 不按 ASR 引擎名称决定删词；Qwen、Scribe、Whisper 或其他来源都用同一套保真原则。
- 删除/改写前问自己：删掉后事实、否定、条件、因果、数字是否仍然完整？不能，就不删。

### 可以处理的 ASR 问题

**口头禅与停顿**：原语言校对默认保留；翻译时可自然表达，但只在明显无意义、删掉不改变语义和语气时才删。
- "然后...嗯...就是说我们要开始" → "我们要开始"
- 但"那个"是指示代词、"然后"是时间/逻辑连接、"就是"是强调时，保留。
- 英文同理：`like` 可能是"喜欢/像/大约"，`then` 可能是时间顺序或推论，`so` 可能是因果；不要因为出现在口头禅清单里就删。
- "哎呀""哇"等情绪语气词保留。

**纯语气词条目**：严格保留时间槽时，纯 "Um…"/"嗯…" 用与原声相符的最小译法（如 "嗯……"）；不要为了填满编造"好吧""那么"等衔接语。无法确定时保留原文/最小译法并列入疑点；只有用户明确授权删条或合并时，才允许删除该条。

**重复**：只清理明显是 ASR 循环、语义为空的重复，不按"连续 3 次"机械删除。
- "观看观看观看观看观看" → "观看"
- 歌词、强调、口吃、情绪重复保留。

**平台水印/广告**：只有音频、画面或用户资料能确认时才删除。
- 视频角落的"优优独播剧场"等水印被识别进正文（需要画面证据）→ 删除。
- 没有音频、画面或用户资料证据时，不能仅凭"优优独播剧场"等词语判断它是水印广告；保留并列入疑点。
- 教程在讨论浏览器插件时出现的 `Extension`、"解锁更多"，或正文在引用广告词 → 保留。

**英文/外文片段**：不因为"是英文"就删除。
- 无法解释的片段保留原文并列入疑点；只有音频、画面或用户资料能确认其为误识时，才删除或修正。
- 术语、产品名、引用、歌词、人名 → 保留。

**标点**：中文补句号、逗号、问号、感叹号、冒号、分号；作品名用《》；人名中间用 `·`；省略号用 `……`。标点服务可读性，不改变语义和节奏。上游已带标点且合理时保留，只在缺失或明显错误时补/改，不为了统一重加标点。
- 英文原文校正保留 `. ? !` 句末标点，它是句子边界；不要在校正阶段按中文字幕风格删掉。
- 中文字幕行末是否加句号是可选风格；用户没要求时不要机械删，也不要为了统一全部补上。

### 同音字/错别字（有语境才改）

**通用**
- "一笔代过" → "一笔带过"
- "记录" → "纪录"（只在纪录片/纪录语境）
- "连接" → "链接"（只在网址/超链接语境）

**影视**
- "试点" → "视点"（point of view）
- "抚痒" → "俯仰"（镜头俯仰）
- "更生降" → "跟升降"（镜头运动）
- "组合剂" → "组合技"
- "类工" → "内功"（武术比喻）
- "被设主体" → "被摄主体"
- 人名：马丁西克赛斯 → 马丁·斯科塞斯；格达尔 → 戈达尔；西区科科 → 希区柯克
- 片名：巴黎灵灯 → 巴里·林登

**医疗**
- "肃部" → "腹部"；"隔肌" → "膈肌"；"肋股" → "肋骨"

**科技/产品名**
- 以官方拼写为准；上下文能确认时才改。
- 无法确认的产品名、版本号保留原文并列入疑点，不猜。
- 不把普通英文词（如 `Crawl`、`Extension`）默认改成产品名。

> 以上只是高置信度示例，不是强制替换表。遇到表里没有的词，按证据分级处理。

### 术语置信度

- **已确认**：用户词表、音频/画面证据、明确上下文、官方资料支持 → 可以替换。
- **疑似**：只有发音相似、词表联想或"看起来像" → 保留原文，列入疑点，不静默替换。
- 不凭猜测补产品版本或型号。反例：`CG`/`CG5` 不一定是 Seedream；`Histo`/`Hixel` 不一定是 Higgsfield；`Snow` 不一定是 Suno AI——这些不能当通用纠错规则。
- 普通词也可能是正确内容：`like`、`then`、`Extension` 等先按字面/上下文判断，不因出现在清单里就删改。

### 不改变原意

- 不添加内容、不删事实；**可以改变句法结构**，但必须保留讲者的语气、强调和信息关系。
- 翻译重点核对：
  - 跨条否定：`I don't think it's good` 不能因为分条译成"我认为它很好"；否定必须留在原意所在位置。
  - 习语/讽刺：不要逐字直译；保留言外之意和语气，不把讽刺译成中性陈述。
  - 讲者改口：`I mean...` / `wait, no...` 保留修正关系，不把前后矛盾抹平。
  - 软件按钮/菜单：按界面原文或通用译名；不确定保留英文，不意译成不存在的按钮。
- 不确定的专名、术语、疑似幻觉：保留原文，在回复中列疑点，不静默删除或改写。

## 题材识别

快速浏览全文（长文件可先看开头和结尾样本，再在分批时补充），判断题材，优先使用对应术语：

| 类型 | 关键词示例 | 校准重点 |
|---|---|---|
| 影视 | 镜头、导演、摄影、景别、分镜、推拉摇移、视点、调度 | 人名片名、影视术语、外文片名 |
| 医疗 | 膈肌、骨盆、康复、腹内压、骶骨 | 解剖学、医学术语 |
| 科技 | 代码、API、Cursor、Python、React | 产品名、技术术语 |
| 财经 | 股票、基金、K线、涨停板 | 财经术语、公司名 |
| 通用 | 其他 | 常见 ASR 错误 |

题材判断只用于选术语，不改变任务意图，也不作为删词理由。

## 长文件处理

- 能放进上下文时，**一次处理**，不分批；这样跨段语义最连贯，也最快。
- 超出上下文或输出容量时，优先在完整句结束处切分；找不到句界再按条目边界分批：
  - 若原文严重缺失标点，优先用相邻条目的时间空档（前一条 end 与后一条 start 相差 > 0.5s）或明显的连接词/转折词（So、However、Now 等）找候选句界，再切批；不要把一句话从中间切开。时间空档直接由 SRT 时间戳计算，不需要音频。
  - 每批带上前一批最后 3~5 条作为**只读上下文**，不要重复输出；
  - 维护一份共享术语表，全篇一致；
  - 每批结果先落临时文件，最后按顺序合并；
  - 合并后核对总条数、序号、首尾时间轴，确认没有漏条/重复。
- 不要用固定的"200 段"阈值代替实际容量判断；也不要为了分批把一条字幕从中间切开。

## 多文件处理（多 agent 模式）

用户一次给多个 SRT 时，一个文件对应一个 agent，最多 3 个 agent 同时工作（含主 agent）。宿主支持独立子 agent 时才启用；不支持就按下面的回退方式串行处理。

- **计数**：主 agent 算 1 个；同一时间最多再开 2 个子 agent。子 agent 不得再开子 agent；宿主上限更低时按宿主上限。
- **分工**：每个文件 agent 独立完成该文件的翻译（仅明确要求时）和校准，不再把一个文件拆成翻译/校准两个 agent——否则多文件时会超过 3 个上限。
- **调度**：
  - 先分派子 agent，再处理主 agent 自己的文件；子 agent 独立运行。
  - 1 个文件：主 agent 自己处理，不开子 agent。
  - 2 个文件：主 agent 处理 1 个，另开 1 个子 agent 处理另 1 个。
  - 3 个文件：主 agent 处理 1 个，另开 2 个子 agent 各处理 1 个。
  - 超过 3 个：按 3 个一批处理；每批完成并校验后再开下一批，不一次性开超过 3 个。
- **交给子 agent 的信息**：输入路径、输出路径、用户对该文件的任务（校对/翻译/目标语言）、Pass 1 全局简报、共享术语表、本 skill 的规则、报告格式。子 agent 只处理指定文件，不改其他文件。
- **共享全局简报与术语表**：同一系列/同一主题的多个文件，主 agent 先做 Pass 1 全局扫描（主题、受众/口吻、术语、疑似 ASR 混淆），并提取一份术语表（用户指定优先），随任务传给所有 agent；子 agent 把新术语和不确定项写进报告；主 agent 合并冲突，必要时统一修正。
- **主 agent 最终校验**：每个文件返回后，主 agent 读取输出，核对条目数、序号、时间轴、空正文、样式标签；失败时先让原 agent 修一次，仍失败则由主 agent 串行重做该文件。
- **回退**：宿主不支持独立子 agent 时，主 agent 按文件顺序串行处理，并在报告中说明"单 agent 串行"。
- **任务不一致**：多个文件的任务或目标语言不同且用户没说清时，先用 AskUserQuestion 确认，再分派。
- 多 agent 只并行"文件"，不并行同一文件的条目；**单文件内部不拆 agent**——全局扫描、ASR 修复、翻译、润色由同一个文件 agent 完成，保证全篇连贯；同一文件内的长文处理仍按上一节规则。

## 输出与文件安全

- 输出到源文件同目录，文件名 `{原文件名}_refined.{原扩展名}`。
- 目标文件已存在时自动编号（`_refined_2`、`_refined_3`），**绝不覆盖源文件**。
- 读取时发现乱码或解析失败，先检查 BOM/GBK/UTF-16 编码，不要按 UTF-8 硬读；无法转换时说明限制。输出统一 UTF-8 无 BOM。
- 输入是 CRLF 不必强改，SRT 用 LF 即可，但不要混用。
- 源文件只读，不改名、不移动、不删除。

## 完成前自检

交付前按优先级从高到低检查：原意、术语、时间、阅读、文风。结构/事实/术语错误必须修好才能交付；阅读速度和文风问题可以带报告交付，但不能通过删事实解决：

- [ ] SRT 条目数与源一致（未授权拆分时）
- [ ] 每条序号、时间轴行与源逐字一致（未授权拆分时）
- [ ] 没有空正文；未授权时没有新增/丢失条目
- [ ] 没有 Markdown 标记、没有多余标题/摘要
- [ ] 样式标签、说话人标记、平台标记原样保留
- [ ] 数字、否定、条件、专名没有被误改
- [ ] 英文校正没有删句末标点或句子边界
- [ ] 翻译没有把未说出的关键信息提前，跨条句子连贯
- [ ] 翻译前做过全局扫描，简报覆盖主题/口吻/术语/ASR 混淆；有标题/文件名时已作为第一先验
- [ ] 英文源的明显 ASR 错误已在翻译前修正，不是把错词直接译成中文
- [ ] 译文是母语级口语，不是逐条直译
- [ ] 纯语气词条目有最小译法或疑点，没有编造衔接语
- [ ] CPS、行宽、行数分别检查，没有为凑指标删事实
- [ ] 输出为 UTF-8 无 BOM，源文件未被覆盖
- [ ] MD/TXT 的标题、列表、代码块、链接地址、frontmatter 未被改动

**必修（不通过不交付）**：条数/序号/时间轴不一致、空正文、漏条/重复、受保护标签丢失、源文件被覆盖、数字/否定/条件/术语被误改。

**可带报告交付**：CPS 偏高、超行宽、超过 2 行、文风偏好；前提是没有删事实、没有改时间轴。

纯提示词不能像程序一样 100% 保证结构；有 Python 时用下面的物理校验补上，无 Python 时按上面的自检执行并说明。

### 物理校验（有 Python 时必须执行；不可用时报告未做）

**仅适用于默认的“严格保留结构”模式**：条目数、序号、时间轴必须与源完全一致。用户明确授权“重新分段/拆条/重做时间轴”时，不能用本脚本的 strict 比较，也不要直接运行本脚本；按宽松检查项逐条核对：候选可解析、每条 `start < end`、无空正文、UTF-8 无 BOM、不覆盖源文件，并在报告中说明结构已改变。有 Python 时，宽松模式也应用脚本检查这些项，只是不做源/候选结构相等比较。

严格模式下，有 Python 时：先把候选稿写到临时文件（如 `{原文件名}_refined.tmp.srt`），运行下面的标准库脚本；校验通过后脚本会用 `os.replace` 把临时文件发布为最终文件，失败则不发布、修正后重跑。`candidate` 必须是独立临时文件，不能等于 `source` 或 `final`；`final` 是首选路径，若已存在，脚本会自动改用 `_refined_2`、`_refined_3`…，并跳过 `source`/`candidate` 路径，绝不覆盖已有文件。脚本会拒绝路径重合、空文件/无有效 cue、起点晚于终点和非法时间数值；时间重叠、倒序或零时长只打印 `WARN`，不自动修正，交付时写入报告。序号行与时间轴行按原始文本逐字比较（含行首/行尾空白，行尾 CRLF/LF 归一化为 LF），不把序号转成整数。源文件允许 UTF-8/UTF-8 BOM；`candidate` 必须是 UTF-8 无 BOM，否则拒绝发布；GBK/UTF-16 不自动支持，先转成 UTF-8，不要改源文件。

```bash
python3 - "源文件.srt" "候选稿.tmp.srt" "最终文件_refined.srt" <<'PY'
import os
import re
import sys
from pathlib import Path

TS_LINE = re.compile(
    r"^\s*(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*$"
)
TOKEN = re.compile(r"</?(?:i|b|u|font)\b[^>]*>|<[^>]+>|\{\\[^}]+\}|>>|\[[^\]]+\]|（(?:笑声|掌声|音乐|欢呼|叹气|静默)）", re.I)
SUPPORTED = re.compile(r"^</?(i|b|u|font)\b[^>]*>$", re.I)
OPEN = re.compile(r"^<(i|b|u|font)\b[^>]*>$", re.I)
CLOSE = re.compile(r"^</(i|b|u|font)\s*>$", re.I)

def ts_to_ms(ts, path):
    try:
        h, m, s = ts.split(":")
        sec, ms = s.split(",")
        h, m, sec, ms = int(h), int(m), int(sec), int(ms)
    except ValueError:
        raise SystemExit(f"invalid timestamp in {path}: {ts}")
    if m > 59 or sec > 59 or ms > 999:
        raise SystemExit(f"invalid timestamp in {path}: {ts}")
    return h * 3600000 + m * 60000 + sec * 1000 + ms

def read_text(path, candidate=False):
    raw = Path(path).read_bytes()
    if candidate and raw.startswith(b"\xef\xbb\xbf"):
        raise SystemExit(f"candidate has UTF-8 BOM: {path}; write it as UTF-8 without BOM")
    try:
        return raw.decode("utf-8" if candidate else "utf-8-sig")
    except UnicodeDecodeError as e:
        raise SystemExit(f"{path} is not UTF-8/UTF-8-BOM; convert to UTF-8 first ({e})")

def check_pairs(tokens, path, cue):
    stack = []
    for token in tokens:
        m = OPEN.match(token)
        if m:
            stack.append(m.group(1).lower())
            continue
        m = CLOSE.match(token)
        if m:
            name = m.group(1).lower()
            if not stack or stack[-1] != name:
                raise SystemExit(f"tag nesting mismatch in {path} at cue {cue}: {token!r}")
            stack.pop()
    if stack:
        raise SystemExit(f"unclosed tag in {path} at cue {cue}: {stack}")

def parse(path, warn=False, candidate=False):
    text = read_text(path, candidate).replace("\r\n", "\n").replace("\r", "\n")
    blocks = [b for b in re.split(r"\n\s*\n", text) if b.strip()]
    if not blocks:
        raise SystemExit(f"no cues in {path}")
    cues = []
    warnings = []
    prev_start = prev_end = None
    for block in blocks:
        lines = block.split("\n")
        if len(lines) < 2:
            raise SystemExit(f"malformed block in {path}: {block[:60]!r}")
        index_line, timestamp_line = lines[0], lines[1]
        if not re.fullmatch(r"\s*\d+\s*", index_line):
            raise SystemExit(f"invalid index line in {path}: {index_line!r}")
        m = TS_LINE.match(timestamp_line)
        if not m:
            raise SystemExit(f"invalid timestamp line in {path}: {timestamp_line!r}")
        idx_text = index_line.strip()
        start_ms, end_ms = ts_to_ms(m.group(1), path), ts_to_ms(m.group(2), path)
        if start_ms > end_ms:
            raise SystemExit(f"invalid time range in {path} at cue {idx_text}: {timestamp_line!r}")
        if start_ms == end_ms:
            warnings.append(f"cue {idx_text} has zero duration")
        if prev_start is not None:
            if start_ms < prev_start:
                warnings.append(f"cue {idx_text} starts before previous cue")
            if start_ms < prev_end:
                warnings.append(f"cue {idx_text} overlaps previous cue")
        prev_start, prev_end = start_ms, end_ms
        body = "\n".join(lines[2:]).strip()
        body = re.sub(r"[ \t]*\n[ \t]*", " ", body)
        cues.append((index_line, timestamp_line, body))
    if len(cues) != len(blocks):
        raise SystemExit(f"block/cue mismatch in {path}: {len(blocks)} vs {len(cues)}")
    if warn:
        for w in warnings:
            print(f"WARN {path}: {w}", file=sys.stderr)
    return cues

def next_available(path, forbidden):
    if path.is_dir():
        raise SystemExit(f"final is a directory: {path}")
    if not path.exists() and path not in forbidden:
        return path
    stem, suffix = path.stem, path.suffix
    m = re.match(r"^(.*)_(\d+)$", stem)
    if m:
        base, n = m.group(1), int(m.group(2)) + 1
    else:
        base, n = stem, 2
    while True:
        candidate = path.with_name(f"{base}_{n}{suffix}")
        if candidate not in forbidden and not candidate.exists():
            return candidate
        n += 1

if len(sys.argv) != 4:
    raise SystemExit("usage: validate_srt.py <source.srt> <candidate.srt> <final.srt>")

src, candidate, final = sys.argv[1], sys.argv[2], sys.argv[3]
src_p, cand_p, final_p = Path(src).resolve(), Path(candidate).resolve(), Path(final).resolve()
if cand_p == src_p:
    raise SystemExit("candidate must not be the source file")
if final_p == src_p:
    raise SystemExit("final must not be the source file")
if cand_p == final_p:
    raise SystemExit("candidate and final must be different paths")

final_p = next_available(final_p, {src_p, cand_p})

a, b = parse(src, warn=True), parse(candidate, candidate=True)
if len(a) != len(b):
    raise SystemExit(f"cue count: {len(a)} != {len(b)}")

unsupported_tags = False
for i, (x, y) in enumerate(zip(a, b), 1):
    if x[:2] != y[:2]:
        raise SystemExit(f"id/timestamp mismatch at cue {x[0]} (position {i})")
    if not y[2]:
        raise SystemExit(f"empty text at cue {y[0]}")
    xt, yt = TOKEN.findall(x[2]), TOKEN.findall(y[2])
    check_pairs(xt, src, x[0])
    check_pairs(yt, candidate, y[0])
    if xt != yt:
        raise SystemExit(f"tag token/order mismatch at cue {y[0]}: {xt!r} != {yt!r}")
    if any(t.startswith("<") and not SUPPORTED.match(t) for t in xt + yt):
        unsupported_tags = True

if unsupported_tags:
    print(f"WARN {src}: unsupported tag structure present; order compared, nesting not fully validated", file=sys.stderr)

os.replace(candidate, final_p)
print(f"PASS: {len(a)} cues, ids/timestamps identical, tags preserved -> {final_p}")
PY
```

- 这校验的是条数、序号、完整时间轴、空正文、受保护标签的物理一致性；不判断语义。
- 支持的成对标签：`i`、`b`、`u`、`font`；校验原始顺序、闭合和嵌套。`{\anX}`、`>>`、`[音乐]` 等按独立标记比较顺序，不作为 HTML 成对标签。
- 脚本显式识别的独立标记：`{\anX}`、`>>`、`[...]`、`（笑声）` 等常见 SDH 标记；其他括号/说话人标记不在脚本校验范围，仍需模型自检。
- 未知 `<...>` 标签只比较原文顺序，不校验嵌套；出现时脚本打印 `WARN`，报告注明“标签校验为部分覆盖”。
- 标签顺序/嵌套校验只证明结构未被破坏，不能证明样式覆盖了语义上正确的译文片段；这部分仍由模型自检。
- 严格模式有 Python 时本节必须执行；宿主不支持 Python 时，在报告中写“未做程序校验”，按提示词自检执行，不要声称物理结构已验证。

## 报告

交付时在对话里给一个简短报告，不要写进 SRT/MD/TXT 正文：

- 处理了多少条/段，修改了多少条；
- 主要修改类型（错别字、标点、口头禅、术语）；
- 疑点清单：原文、位置、疑似问题、建议复核方式；
- 全局简报摘要（主题/口吻/关键术语）和关键 ASR 修正（原文 → 修正 → 依据）；
- 高 CPS、超行宽、超过 2 行的条目单独列出，不要静默删事实；
- 如果改了时间轴或格式，明确说明范围和原因。
- 多文件时按文件分别报告，最后给一张总表（文件名、任务、修改量、疑点、使用的 agent）。

## 与其他 skill 配合

```text
video-downloader → audio-transcribe → text-refine → video-tts
    下载视频           转录字幕          校准/翻译       配音/压制
```

- `video-tts` 可消费中文 SRT 或文稿；如果用户的目标是配音，且明确要求翻译，就在这里翻译并保持时间轴。
- text-refine 的输出格式与输入一致，SRT 校准完可以直接交给 `video-tts`。
- 不做语义合并；合并和配音时长适配由 `video-tts` 负责。

## 示例

```text
用户: 校准这个字幕 video.srt          → video_refined.srt（保持原语言，只纠错）
用户: 翻译并校准 audio.srt            → audio_refined.srt（中文，保持时间轴）
用户: refine 一下这个 md 文件         → xxx_refined.md（默认原语言校对，不额外询问）
用户: 把这份字幕整理成文章            → 明确要求时才输出 .md，并说明时间轴已丢失
```
