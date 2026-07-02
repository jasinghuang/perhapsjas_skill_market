---
name: make-html-card
description: 将小红书文案转换为精美的 HTML 图文卡片（1242×1660），支持封面/正文/结尾多卡片自动拆分。当用户想将文案转为小红书图文、生成 XHS 卡片、制作图文笔记，或提到"小红书卡片"、"图文卡片"、"XHS card"时使用。支持从小红书文案、网页链接、PDF、纯文本等任意输入出发。
---

# 小红书 HTML 图文卡片

## 这个 Skill 做什么

将任意输入（小红书文案 / 网页链接 / PDF / 纯文本）先统一成一份 `source.md`，再排版成精美的 HTML 图文卡片，每张 1242×1660px。

**视觉风格：** 暖黄底 + 白色圆角卡片 + 红色强调 + 方正兰亭黑字体。
**能力：** 智能排版 — 自动拆段落、分配多卡片布局、标记重点关键词。

> 这个 Skill 是一个小型 harness（六个核心部分的对应关系见 `references/harness.md`）：
> 先统一输入，再规划拆卡，先做一张样张定调，确认后才批量生成，最后终审 + 最小切片修复。
> 每张卡独立成文件，主 agent 统一组装。

## 何时使用

**合适的场景：**
- 小红书图文笔记的文案转图片
- 金融投教内容的卡片化呈现
- 需要多张图片轮播的内容呈现

**不合适的场景：**
- 视频内容（用视频相关 skill）
- 纯文字发布（无需卡片化）
- 横版图片/海报（比例不同）

## 工作区结构

每次任务在用户当前目录下创建一个工作区，作为 skill 的**长期记忆**——
不要只依赖聊天上下文记决策，跨阶段决策都落盘到这里：

```
<workspace>/
  source/   original.*           # 原件留底（URL 抓取的 HTML / PDF / 原文本）
            source.md            # ★ 统一后的事实底座，后续所有写作从这里出发
            extraction-notes.md  # 抽取不确定项 / 丢失 / 待补充
  plan/     plan.md              # 卡片拆分规划（Brief / Outline / Layout / Assets）
  cards/    card-01.html ... card-NN.html   # 每张卡独立文件
            manifest.json        # 主 agent 拥有：卡序号/类型/标题/拥有者（Phase 5 用）
  review/   first-card-review.md · final-review.md · repair-log.md（仅有修复时） · patterns.md（Phase 9 跨任务累积）
```

长会话里拿不准已确认的决策，**回读这些文件**，不要凭记忆重新发明。

## 工作流总览

```
Phase 0  Intake              判断是否进入本 Skill + 捕获目标语言
   ▼
Phase 1  Source → Markdown    链接/PDF/纯文本 → source/source.md（统一事实底座）
   └ 主 Agent 内联 5 条自检
   ▼
Phase 2  规划                 读 source.md → plan/plan.md（拆卡 + 流式填充）
   ▼
Phase 3  Plan Checkpoint ★    确认拆卡方案（卡数/封面/配图模式）— 必须停
   ▼
Phase 4  First Card           封面 + 首张正文，风格定调样张
   ▼
Checkpoint 2 ★               验收首卡 + 选开发模式（A 顺序 / B 并行）— 必须停
   ▼
Phase 5  完整生成             剩余所有卡，一节一文件
   ▼
Phase 6  终审                 对照 checklist.md 三视角（P0/P1/P2）
   ▼
Phase 7  修复                 最小切片（单卡级），有修复才写 repair-log
   ▼
Checkpoint 3 ★               交付确认 — 必须停
   ▼
Phase 8  交付                 汇总 cards/*.html，报告文件列表
   ▼
Phase 9  回顾（可选）         回看 review/*.md 沉淀 patterns，反复出现的问题反馈优化 skill
```

> 标 ★ 的 Checkpoint 是硬节点：必须停下来让用户逐项确认，**禁止静默替用户选择**。

## 决策收集铁律（所有 Checkpoint 共用）

在每个 Checkpoint，所有需用户确认的决策项**必须每项独立列出 + 等用户答复**。Agent **可以推荐**
（"我推荐 X，因为…"），但**不能"已经替你定了 X，不对再说"**——后者等于剥夺选择机会。

- **优先**：环境有 `AskQuestion` 工具时，每个决策项作为一个独立 question（一次调用可传多个 question），用户用选择卡逐项确认。
- **否则**：停下来在消息里把问题**编号列出**（每个独占一段、写清推荐项 + 理由 + 备选项），明确说"我等你逐项答复后再继续"，**不要继续做后续工作**。
- **绝不**：把多项决策打包成"全部 OK 吗？"yes/no；也不在"推荐一句话"后默认直接进下一步。
- **开场先发推荐说明**：进 Checkpoint 时，**先发一条消息**把所有决策项的"推荐 + 一句理由"摆出来，明示"以下是我的推荐，不会替你选，下面逐项确认"，**再**用 AskQuestion / 编号列问题收集。不要上来直接抛问题——用户要先看到推荐和理由才能判断。
- **默认值明示反悔**：走默认值、不必单独问成一项的事项（目标语言、配图模式、主题、封面开关等），**必须**在开场说明里列出来"默认走 X，如要改请告诉我"，给用户反悔机会，**不能藏起来**。agent 不得偷偷走默认而不告知——这正是"禁止静默替用户选择"要防的。

### Checkpoint 开场消息模板（所有 Checkpoint 共用）

```
<阶段产物>已经就绪。我会逐项跟你确认 N 件事：<列出本 Checkpoint 的决策项>。

我的推荐先放在这里供参考（不会替你选）：
- <项1>：<推荐>（理由：…）
- <项2>：<推荐>（理由：…）
- …

默认走但你可以推翻：<默认值1>；<默认值2>；…（如要改告诉我）。

下面逐项请你确认。
```

发完上面这条说明后，**立刻**用 AskQuestion 传 N 个 question（或编号列出 N 个问题、停下等答复）。
**N 项全部收齐答复才能进下一步**。

## 各阶段文件读取指南（渐进加载）

不要在启动时把所有规范一次性塞进上下文——不同阶段只看该阶段需要的东西，
避免模型注意力被无关规范稀释：

| 阶段 | 必读 | 按需查 |
|---|---|---|
| Phase 0 Intake | 本文件"何时使用"段 | `references/harness.md`（理解六层设计意图） |
| Phase 1 Source→MD | `references/source-to-markdown.md` | —— |
| Phase 2 规划 | 本文件 Phase 2 段（流式填充算法）· `references/plan-template.md` | —— |
| Phase 3 Checkpoint | `plan/plan.md` · `theme-profiles/index.json`（选主题） | —— |
| Phase 4 First Card / Phase 5 生成（每张卡回看） | 本文件"填充卡片的通用规则"· `references/component-policy.md`（含 raw 逃生舱）· `assets/layouts/<type>/default.html` · `theme-profiles/<id>.md`（选定主题）· `references/design-tokens.md` · `references/section-build.md`（Phase 5） | —— |
| Phase 6 终审 | `references/checklist.md` · `references/review-protocol.md` | —— |
| Phase 7 修复 | `references/repair-policy.md` | —— |
| Phase 8 交付 | 本文件 Phase 8 段 | —— |
| Phase 9 回顾（可选） | `references/self-evolution.md` · 本次 `review/*.md` | `review/patterns.md` |

> **长会话里 agent 容易遗忘规范** —— Phase 4 / Phase 5 每填一张卡前，回看"填充卡片的通用规则"
> + `design-tokens.md`，把字号 / 字重 / 颜色 / 间距持续拉回正轨，减少写到后面风格偏移。

## Phase 0 · Intake

判断是否进入本 Skill，记录目标语言（小红书卡片默认中文，除非用户另说）。

| 用户给的东西 | 该做的 |
|---|---|
| 文案 / 链接 / PDF / 纯文本（一种或多种） | 进入 Phase 1 |
| 只说"帮我做张小红书卡片"但没素材 | 反问：先要素材或文案。Skill 不替用户凭空构思内容 |
| 明显要的是视频 / 海报 / 应用 | 停下来澄清，不进入本 Skill |

## Phase 1 · Source → Markdown

**无论输入是什么，这一步都先转成统一的 `source/source.md`，后续所有写作从这份文件出发。**
规则与各类输入处理见 `references/source-to-markdown.md`。

要点：

1. 原件留底到 `source/original.*`（URL 抓取的 HTML、PDF、原文本都存一份）。
2. 抽取成 `source/source.md`，保留对 Phase 2 有用的**结构信号**：段落锚点
   （👉/📌/💡/##/【】）、列表（•/-/1.）、核心术语、可能的封面主题词。
3. 不确定项写进 `source/extraction-notes.md`。
4. 落盘后主 Agent 内联 5 条自检（见 `references/source-to-markdown.md`），按结论修复再进 Phase 2。

**为什么先统一成 source.md**：链接、PDF、纯文本形态各异，若每张卡都直接从原始输入取材，
抽取逻辑会反复执行且结果不一致；统一成 source.md 后，Phase 2+ 只面对一种输入，
注意力不被抽取细节稀释，多 agent 并行时也只共享同一份事实底座。

## Phase 2 · 规划 → plan.md

**从 `source/source.md` 读取**（不再触碰原始输入），识别结构、规划拆卡，产出 `plan/plan.md`
（模板见 `references/plan-template.md`）。

**识别结构**：① 段落锚点（emoji 前缀如 👉/📌/💡，或 `##` 标题）② 列表（•/-/1.）
③ 核心术语（专业名词、关键数据、需强调词组）④ 封面元素（主题词 2-4 字 / 栏目名 / 英文副标题需求）。

**预拆分**：
1. 第一张 = 封面：主题词作 hero-title，配图区占位（983×770px）
2. 正文按锚点拆：每个段落标题 + 其下正文 = 一个"内容块"
3. 结尾 = 合并或独立（有明确总结/CTA 则用结尾布局，否则合并到最后一张正文）
4. 风险提示：每张卡都有

**流式填充（把内容块分配到卡片）**：
- 高度估算：段落标题 94px · 正文每行 57px（40px × line-height 1.42）· 每行约 24 中文字 · 可用空间 1335px（padding 70 到风险提示 1405）
- 填充目标：每卡 ~92%（约 1228px）—— 实战确认的最佳填充（满但不挤风险提示）
- **填满策略**：行距（line-height 1.42）固定不动（易读性），填满靠 ① 段落间距（margin：块间 50 / 段间 15）微调 ② 视觉元素（重点框 / 引用框 / 数字卡片 / 网格）填充。**不要调 line-height 撑满**。
- 逻辑：① 依次往当前卡放 ② 段落标题必须跟至少第一段正文同卡 ③ 加入下一段会超 92% 则剩余流到下一卡 ④ 一个内容块可跨卡

plan.md 的 Outline 段就是这套分配的结果。

## Phase 3 · Plan Checkpoint（★硬节点，必须停）

把 `plan/plan.md` 摆给用户，确认拆卡方案后再动手做卡。**禁止静默替用户选择**——
可以推荐（"我推荐拆 6 张，因为…"），不能"已经替你定了，不对再说"。

需独立确认的项：
- 主题（默认 warm-yellow 暖黄风；其他主题见 `theme-profiles/index.json`）
- 卡片数量与每张卡的拆分边界
- 封面主题词 + 中/英文副标题
- 配图模式（none / placeholders / user-assets）

**默认走但你可以推翻**（开场说明里明示，如要改告诉我）：
- 目标语言：中文（小红书卡片默认）
- 封面：开（第一张封面卡）
- 开发模式：留到 Checkpoint 2 选（A 顺序 / B 并行）

> 为什么必须停：小红书卡片一旦开做，改拆分 = 重做。Phase 2 规划定下后让用户花 30 秒确认，
> 比 Phase 5 发现拆错了再返工便宜得多。收集方式见上方"决策收集铁律"（优先 AskQuestion，
> 否则编号列问题停下等答复）。

## 填充卡片的通用规则（Phase 4 / Phase 5 共用）

每填一张卡前，先回看对应布局模板 + 选定主题的 `theme-profiles/<id>.md`（默认 warm-yellow），
再动手替换占位符。

**主题**：布局模板的 `<style>` 已内置默认主题（warm-yellow）的 `:root` 变量；若 Checkpoint 1 选了
其他主题，按该主题 profile 里的 `:root` 值替换每张卡片 `<style>` 的 `:root` 即可，模板其余结构不动。

**raw 逃生舱**：某张卡需要图表 / 流程图 / 特殊视觉时，用 content 模板里被注释的 `raw-block` 区
（填 `{{RAW_BLOCK}}`）。raw 给自由但必须守主题统一——样式只用 `var(--xhs-*)` 变量、不得越界、
不得遮挡风险提示。完整规则见 `references/component-policy.md`。

1. 根据卡片类型读取对应布局 HTML：
   - 封面：`${CLAUDE_PLUGIN_ROOT}/skills/make-html-card/assets/layouts/cover/default.html`
   - 正文：`${CLAUDE_PLUGIN_ROOT}/skills/make-html-card/assets/layouts/content/default.html`
   - 结尾：`${CLAUDE_PLUGIN_ROOT}/skills/make-html-card/assets/layouts/ending/default.html`
2. 将 plan.md Outline 里该卡的内容填入占位符位置
3. **关键词标记**：核心术语用 `<span class="highlight">` 包裹

**占位符替换对照：**

| 占位符 | 内容来源 |
|--------|----------|
| `{{TOPIC}}` | 主题词 |
| `{{COVER_IMAGE}}` | 配图路径（默认用占位色块） |
| `{{SECTION_TITLE_N}}` | 第 N 个段落标题（不含 emoji 前缀，emoji 由布局自带） |
| `{{BODY_PARAGRAPH_N}}` | 正文段落（含 highlight 标记） |
| `{{ENDING_ICON}}` / `{{ENDING_TITLE}}` | 结尾页图标 / 标题 |
| `{{SUMMARY_POINT_N}}` | 总结要点 |
| `{{CTA_TEXT}}` | CTA 按钮文案 |
| `{{RAW_BLOCK}}` | raw 逃生舱（可选，图表/图解/特殊视觉，须用主题变量，见 component-policy.md） |

## Phase 4 · First Card（首张样张定调）

先做"封面（若开）+ 第一张正文卡"作为**风格定调样张**——确认字号气质、内容密度、
关键词标记风格、配图方式符合预期，再进 Phase 5 批量生成。

- 读：`assets/layouts/cover/default.html` + `content/default.html` + 本文件"填充卡片的通用规则"
- 产出：`cards/card-01.html`（封面）+ `cards/card-02.html`（首张正文）
- 完成后进 Checkpoint 2

> 为什么先做一张：5-9 张轮播，风格跑偏到第 5 张才发现 = 前 4 张全废。先做一张定调，
> 是 beautiful-article "First Spread" 思路在小红书场景的对应。

## Checkpoint 2 · 首卡验收（★硬节点，必须停）

让用户验收首卡样张，并选定后续开发模式。两项**独立确认**，不要打包成"通过 + A，OK 吗？"：

1. **验收结论**：通过·进完整生成 / 局部修改·我会说改哪里 / 风格不对·回 Phase 2
2. **开发模式**：A 单 agent 顺序（默认，风格最统一）/ B 多 agent 并行（最快，需 manifest）

**默认走但你可以推翻**：开发模式默认 A 顺序（除非卡片多 / 赶时间，推 B 并行）。

> 收集方式见"决策收集铁律"：先发首卡定调结论 + 开发模式推荐的开场说明（模板见铁律段），
> 再两项各自独立确认，不要打包成"通过 + A，OK 吗？"。

## Phase 5 · 完整生成

按 Checkpoint 2 选定的模式，生成剩余所有卡。**每张卡必须是独立文件**
（`cards/card-NN.html`），坚决不允许把多张卡写进一个文件——文件级隔离是多 agent 并行
与最小切片修复的前提。完整规则（铁律 / manifest.json 结构 / 序号统一 / A·B 模式 /
并行 subagent prompt）见 `references/section-build.md`。

- 每填一张卡前，回看"填充卡片的通用规则" + `design-tokens.md`（见渐进加载表）
- **manifest.json** 是主 agent 拥有的唯一组装点（卡序号 / 类型 / 标题 / 拥有者 / 状态），
  subagent 只读自己那行、只写自己那个 HTML 文件
- **模式 A · 单 agent 顺序（默认）**：主 agent 顺序写每张卡，风格最统一
- **模式 B · 多 agent 并行**：subagent 各拥有一张卡并行；主 agent 维护 manifest、统一序号、
  兜底风格、解决衔接冲突
- 每张卡完工走 Card Reviewer 质检（消息返回 pass/fail，不写 review 文件），协议见 `references/review-protocol.md`

## Phase 6 · 终审

从三个视角验收全套卡片，产出 `review/final-review.md`（清单与 Reviewer prompt 见
`references/review-protocol.md`；三视角与 checklist 的 P0/P1/P2 对应）：

- **Editorial**：内容忠实（文案完整、关键词标记合理、封面主题词准确、CTA 到位），信息没丢
- **Visual**：排版质量（段落间距统一、填充度 ~92%、无溢出、全套风格统一、无明显 AI 味）
- **Technical**：硬规范（尺寸 1242×1660、兰亭黑字重、letter-spacing、颜色、每卡风险提示、卡片序号全篇自洽、HTML 可 open 打开）

三个视角可并行起 SubAgent，主 agent 收齐后按 fail 项最小切片修复（Phase 7）。

## Phase 7 · 修复（最小切片）

按**最小单位（通常是单张卡）**修复，完整对照表与 repair-log 格式见 `references/repair-policy.md`：

- 禁止为修一处重写全套卡片
- 禁止为改视觉改动 Phase 3 已确认的拆分结构
- 禁止为压缩信息删掉必须保留的内容
- **合规红线**：风险提示是固定文案，任何修复都不得改 / 删 / 移（丢失只能从布局模板原样恢复）

有修复才写 `review/repair-log.md`（一次过则不写）。

## Checkpoint 3 · 交付确认（★硬节点，必须停）

终审改完后，**停下来**让用户确认交付决策（先发终审结论 + 交付建议的开场说明，模板见「决策收集铁律」），不要静默走默认导出：

- 通过·交付 / 还有局部修复·我会列出具体修哪里 / 先停一停·我要再看看

**默认走但你可以推翻**：交付形态默认直接给 `cards/*.html` 或 `out/card-*.html`（不额外导出其他格式）。

## Phase 8 · 交付

1. 按 manifest 顺序（或卡片序号）汇总 `cards/*.html`，向用户报告文件列表
2. 可选：复制到用户工作目录（`{主题}-card-01.html` ...）方便发布
3. 简短编辑说明：卡数 / 主题词 / 配图策略 / 主要编辑取舍

## Phase 9 · 回顾与沉淀（可选 · 自进化）

借鉴 beautiful-article 的自进化理念：质检 / 修复日志**不只是给人看，是给 agent 看**。每次任务
结束顺手做一次轻量回顾，跑多了同类任务后，高频问题会浮现，反过来优化 skill 本身。

读：本次的 `review/first-card-review.md`、`review/final-review.md`、`review/repair-log.md`（若有）。

做：

1. **提炼本次暴露的问题**，按类归档（抽取 / 拆分 / 排版 / 合规 / 并行 / raw / 主题 …）。
2. **追加到 `review/patterns.md`**（跨任务累积，带日期 + 简述；同类问题 +1 频次）。
3. **若某类问题反复出现（≥3 次）**，提出对 skill 的改进建议（checklist 加项 / 默认策略调整 /
   流式填充系数微调 / 布局模板修补 / 主题 profile 补充），写进 `patterns.md` 的"改进建议"段。
4. 下次同类任务开始时（Phase 0），agent 先扫一眼 `patterns.md` 的改进建议，把已沉淀的教训带进本次任务。

完整规则与 `patterns.md` 格式见 `references/self-evolution.md`。

> 这一步可选，但它是 skill 从"能稳定生产"走向"越用越好"的关键——把审核和修复日志沉淀下来，
> 反过来改进下一次流程。

## 资源文件路径

所有资源文件位于 `${CLAUDE_PLUGIN_ROOT}/skills/make-html-card/` 下：

```
xiaohongshu-card/
├── SKILL.md                    ← 你正在读
├── assets/
│   └── layouts/                # 按类型分目录的布局模板（CSS 变量化，支持主题切换）
│       ├── cover/default.html
│       ├── content/default.html
│       └── ending/default.html
├── theme-profiles/             # 主题（每套一份 profile + :root 值）
│   ├── index.json              # 主题索引（default = warm-yellow）
│   └── warm-yellow.md          # 暖黄风（默认）
└── references/
    ├── harness.md              # Harness 六层设计意图
    ├── source-to-markdown.md   # Phase 1 输入统一化规则
    ├── plan-template.md        # Phase 2 plan.md 模板
    ├── component-policy.md     # 布局协议 + raw 逃生舱 + 主题 token 约束
    ├── section-build.md        # Phase 5 一节一文件 + manifest + 并行
    ├── review-protocol.md      # 各节点 SubAgent 质检协议 + Reviewer prompt
    ├── repair-policy.md        # Phase 7 最小切片修复 + 合规红线
    ├── self-evolution.md       # Phase 9 自进化闭环 + patterns.md 格式
    ├── design-tokens.md        # 设计变量参考（颜色、字号、间距）
    └── checklist.md            # 质量检查清单（P0/P1/P2）
```
