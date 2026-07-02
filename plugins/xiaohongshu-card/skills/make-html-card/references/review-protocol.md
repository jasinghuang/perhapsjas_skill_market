---
name: review-protocol
description: 各节点 SubAgent 质检协议——哪个阶段用哪种质检方式、各 Reviewer 的 prompt 模板
---

# 质检协议与 Reviewer

> 本文件的核心目的：**让每个节点用对的方式做对的事**——不要错开 SubAgent、不要错写文件。
> 误开 SubAgent / 错写 review 文件是首要性能问题。

## 各阶段质检方式（铁律）

| 阶段 | 质检方式 | 产物 |
|---|---|---|
| **Phase 1 Source（默认）** | 主 Agent 内联 5 条 checklist（见 `source-to-markdown.md`） | 无文件 |
| Phase 1 Source（仅复杂/低置信源） | Source Reviewer SubAgent（对照 `original.*` diff） | `review/source-review.md` |
| **Phase 2 Plan / Checkpoint 1 前** | **主 Agent 内联自查（禁开 SubAgent）** | **无文件** |
| **Phase 4 First Card / Checkpoint 2 前** | First Card Reviewer SubAgent | `review/first-card-review.md` |
| **Phase 5 每张卡** | Card Reviewer SubAgent | **以消息返回 pass/fail + 修复点，不写文件** |
| **Phase 6 终审 / Checkpoint 3 前** | Editorial + Visual + Technical Reviewer SubAgent | `review/final-review.md` |

拿到结论后**先按 fail 项把产出改完，再向用户汇报**。直接拿结论汇报但不修复 = 违规。

> 为什么这样分：Phase 2 plan 是文字决策且上下文热，SubAgent 冷启动反而慢，绝不开；
> Phase 4 首卡定调 + Phase 6 终审是交付物，多一道独立眼睛 + 留档有价值；
> Phase 5 一套可能 5-9 张卡，N 份 review 文件无人再读，所以用消息返回。

---

## Plan 自查（Phase 2 → Checkpoint 1 · 主 Agent 内联 · 5 条）

写完 `plan/plan.md` 后**就地**核查这 5 条，按结论改 `plan/plan.md` 本身（不要写新文件）：

1. **Brief / Outline 自洽**：卡片数量与 source.md 内容量相称；Outline 没偷塞 Brief 没承诺的内容，也没遗漏必须保留的内容。
2. **拆分有据**：每张卡的"内容块来源"指向 source.md 具体段落；流式填充估算的填充度落在 ~92%。
3. **封面方案**：主题词 2-4 字、中/英文副标题、配图区（983×770）有安排。
4. **关键词标记**：每卡列了关键词清单，且不过度（合计不超过本卡正文 30%）。
5. **卡片序号**：Outline 序号连续单调（01/02/03…），类型（cover/content/ending）正确，结尾卡放置合理。

> 这一步**绝不开 SubAgent**：内容量小、上下文是热的，SubAgent 冷启动反而慢。

---

## First Card 自检清单（Phase 4 → Checkpoint 2 前 · SubAgent）

SubAgent 读 `cards/card-01.html`（封面）、`cards/card-02.html`（首张正文）、`plan/plan.md`、
`references/design-tokens.md`、对应布局模板，按清单核查，写 `review/first-card-review.md`：

- 尺寸 1242×1660，白色卡片 1151×1580 居中，圆角 39px + 底边框 5px
- 字体兰亭黑系列，字重正确（封面主题词 Heavy 900 / 段落标题 ExtraBold 800 / 正文 Medium 500）
- letter-spacing 符合 design-tokens；颜色正确（封面 #fff1cc / 正文 #faf3e1 / 强调 #d22727）
- 封面：主题词突出（220px）、中/英文副标题层次清晰、配图区占位（983×770）
- 首张正文：段落标题 / 正文 / 关键词标记风格定调（这张是后续所有卡的"风格锚点"）
- 风险提示在位（布局自带固定文案，未改未删）
- 内容无溢出，填充度合理
- HTML 可 `open` 打开，无样式塌陷

prompt 模板：

```text
请作为 First Card Reviewer。读取 cards/card-01.html（封面）、cards/card-02.html（首张正文）、
plan/plan.md、references/design-tokens.md、assets/layouts/cover/default.html 与
assets/layouts/content/default.html。对照 First Card 自检清单逐项核查，把结论写进
review/first-card-review.md（pass / fail + 证据 + 必须修复项）。
不要替我改文件，也不要泛泛夸奖。
```

主 Agent 收到结论后**先按 fail 项改完**，再进 Checkpoint 2。

---

## Card 自检清单（Phase 5 每张卡 · SubAgent · 消息返回）

SubAgent 读对应 `cards/card-NN.html`、`plan/plan.md` 的本卡行、`source/source.md` 本卡对应内容，
按清单核查，**以消息形式返回结论**：

- 完成本卡 Outline 任务（该卡的内容块都填了）？
- 文案完整，没丢 source.md 对应段落的内容？
- 关键词标记合理（核心术语已用 `<span class="highlight">`，不过度）？
- 与相邻卡衔接（标题 / 内容承接，无重复无矛盾）？
- 风险提示在位（固定文案未改未删）？
- 内容无溢出（填充度 ~92%，不与风险提示重叠）？
- **本卡序号自洽**：`seq` / 文件名 `card-NN.html` / 类型 与 `cards/manifest.json` 一致？

prompt 模板：

```text
请作为 Card Reviewer。读取 cards/card-<NN>.html、plan/plan.md 的本卡行、source/source.md
本卡对应内容、cards/manifest.json 本卡行、references/design-tokens.md。
对照 Card 自检清单逐项核查，**直接以消息形式返回**：
- 第一行：pass / fail
- 若 fail：列出修复点（带证据）
不要写任何 review 文件。不要替我改文件。不要泛泛夸奖。
```

主 Agent 收到 fail 项后**直接修对应卡片文件**，再汇报本卡交付。

---

## Phase 6 终审三视角（SubAgent · 写 `review/final-review.md`）

三个视角与 `references/checklist.md` 的 P0/P1/P2 对应：Technical 管 P0 硬规范，
Visual 管 P1 排版 + P2 打磨，Editorial 管内容忠实度。

**Editorial Reviewer**（内容忠实、信息取舍）

- 文案完整呈现，source.md 的关键内容没有意外丢失。
- 封面主题词准确概括全文；CTA / 结尾要点到位。
- 关键词标记合理（服务理解，不过度，不漏标核心术语）。
- 没有空泛标题、堆砌、过度总结。

**Visual Reviewer**（排版、风格、AI 味）

- 段落间距统一（标题→正文 30px / 段落间 15px / 块间 50px）。
- 每卡填充度 ~92%，无内容溢出，不与风险提示重叠。
- 全套卡片风格统一（字号 / 字重 / 颜色 / 关键词标记风格一致）。
- 无明显 AI 味（配色 / 排版 / emoji 不浮夸）。

**Technical Reviewer**（硬规范、序号、可打开）

- 每卡 canvas 1242×1660；字体兰亭黑系列 + 字重正确；letter-spacing 符合 design-tokens。
- 颜色值正确（封面 #fff1cc / 正文 #faf3e1 / 卡片 #ffffff / 强调 #d22727 / 风险提示 #2d2727）。
- 每卡风险提示在位（absolute 钉底，固定文案未改）。
- **卡片序号全篇自洽**：对照 `cards/manifest.json`，seq 连续单调（01/02/03…），无跳号无重复，
  文件名 / 类型 / 标题与 manifest 一致（并行模式 B 下最容易在这里错）。
- 每个 HTML 可 `open` 打开，无样式塌陷。

prompt 模板：

```text
请作为 <Editorial / Visual / Technical> Reviewer。读取 plan/plan.md、source/source.md、
cards/manifest.json、所有 cards/card-*.html、references/design-tokens.md、references/checklist.md。
对照本视角的终审清单逐项核查，把结论追加到 review/final-review.md 的"<视角>"段
（pass / fail + 证据 + 必须修复项）。不要替我改文件，不要泛泛夸奖。
```

三个视角可并行起 SubAgent，主 Agent 收齐后按 fail 项最小切片修复（Phase 7 / `references/repair-policy.md`）。
