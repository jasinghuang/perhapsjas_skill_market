---
name: section-build
description: Phase 5 一节一文件铁律、manifest.json 组装点、单/多 Agent 模式、并行 subagent prompt
---

# 卡片构建与多 Agent 并行

## 铁律:一张卡 = 一个 HTML 文件

每张卡**必须**是独立的 HTML 文件,**坚决不允许**把多张卡写进一个文件。

```
cards/
  manifest.json          # 主 Agent 拥有(唯一组装点):卡序号/类型/标题/拥有者/状态
  card-01.html           # 封面
  card-02.html           # 正文 1（Phase 4 First Card 已由主 Agent 完成 = 风格锚点）
  card-03.html           # 正文 2
  ...
```

文件级隔离 → 多个 agent 改不同卡片文件**不会互相破坏**;出问题时能定位到单张卡做最小切片修复。

## manifest.json:主 Agent 拥有的唯一组装点

manifest 扮演 beautiful-article 里 `Article.tsx`(assembler)的角色——它是卡片顺序与归属的
**唯一真值源**。主 Agent 拥有并维护它;subagent 只读自己那行、只写自己那个 HTML 文件。

```json
{
  "topic": "主题词",
  "card_count": 6,
  "cards": [
    { "seq": "01", "type": "cover",   "title": "{{主题词}}",   "owner": "main",       "file": "card-01.html", "status": "done" },
    { "seq": "02", "type": "content", "title": "{{段落标题}}", "owner": "main",       "file": "card-02.html", "status": "done" },
    { "seq": "03", "type": "content", "title": "{{段落标题}}", "owner": "subagent-A", "file": "card-03.html", "status": "wip" },
    { "seq": "06", "type": "ending",  "title": "{{结尾标题}}", "owner": "subagent-B", "file": "card-06.html", "status": "wip" }
  ]
}
```

字段:
- `seq`:卡片序号(主 Agent 统一编,见下节)
- `type`:`cover` / `content` / `ending`
- `title`:该卡标题(来自 `plan/plan.md` 的 Outline)
- `owner`:`main` / `subagent-X`——谁拥有这个 HTML 文件
- `file`:文件名 `card-NN.html`
- `status`:`wip` / `done` / `review`——并行进度跟踪

## 序号由主 Agent 统一编(避免并行写错)

卡片序号(`seq` 与文件名 `card-NN.html` 里的 NN)归**主 Agent 所有**。并行模式里 subagent
看不到自己在全套里的位置,若自编序号容易写错(典型:几张卡都叫 `card-02`,或跳号)。

- 主 Agent 派活时直接告诉 subagent"你负责 `card-03.html`,你是第 03 张",subagent 用这个 03。
- subagent **不自编序号、不重命名文件**。
- 组装后主 Agent 对照 manifest 与 `plan/plan.md` Outline,确认序号连续、类型正确、无跳号无重复。

## 两种开发模式(Checkpoint 2 由用户选定)

**第一张卡(Phase 4 First Card)无论哪种模式都先由主 Agent 完成并验收**——它是风格锚点。
差异从第 2 张卡起:

### A · 单 Agent 顺序(默认,最稳)

主 Agent 顺序写 `card-02 → card-03 → …`,风格最统一,随时自检。manifest 的 `owner` 都填 `main`。

### B · 多 Agent 并行(最快)

subagent 各**拥有一张** `card-NN.html` 并行开发。**主 Agent 负责合并与稳定性**:

- 维护 `manifest.json`(唯一组装点,避免冲突),据 `plan/plan.md` Outline 统一分配序号与归属。
- 每轮并行结束,对照 manifest 汇总所有卡片文件,检查序号 / 类型 / 文件齐全。
- 兜底视觉一致(颜色 / 字体 / 字号 / 间距走 `design-tokens.md`,气质不跑偏)。
- 解决衔接问题(相邻卡片的标题 / 内容是否承接,关键词标记风格是否统一)。

风格在并行下会有轻微差异(这是预期,`design-tokens.md` 兜底视觉统一)。

## 并行 subagent 的 prompt 必须包含

```text
你负责文件 cards/card-<NN>.html,只改这一个文件。你是全套第 <NN> 张卡(编号由主 Agent 指定,
你看不到自己在全套的位置,不要自己另编序号、不要重命名文件)。
读取:plan/plan.md 的 Outline 段本卡行(序号/类型/标题/内容块来源/关键词) +
      source/source.md 本卡对应内容块 +
      对应布局模板 assets/layouts/<type>/default.html +
      references/design-tokens.md + SKILL.md 的"填充卡片的通用规则" +
      cards/card-02.html(主 Agent 已完成的首卡)作为"风格锚点"参考(不是抄袭对象)。
硬规则:
- 一个文件 = 一张卡;不要碰 manifest.json 或别的卡片文件。
- 严格按布局模板的占位符填空,不改动模板的 CSS(字号/字重/颜色/间距已写死,你只填内容)。
- 关键词用 <span class="highlight"> 包裹,标记不过度(不超过本卡正文 30%)。
- 风险提示是布局模板自带的固定文案,不要改、不要删。
- 完工对照 references/checklist.md 的 P0/P1 自检(尺寸/字体/颜色/风险提示/溢出)。
不要修改 manifest.json(主 Agent 统一组装与序号校准)。
```

## 每张卡完工(质检 · SubAgent · 消息返回)

每张卡完成后走 Section Reviewer SubAgent 核查(对照 `references/checklist.md` 的 P0/P1:
尺寸 / 字体 / letter-spacing / 颜色 / 风险提示 / 溢出 / 关键词标记)。

**SubAgent 以消息形式返回 pass/fail + 修复点**(pass 一行 OK,fail 列出修复点),**不要写
`review/card-NN-review.md` 文件**;主 Agent 收到 fail 项后直接修对应卡片文件,再汇报本卡交付。

> 完整的各节点 SubAgent 质检协议(Phase 1 / 4 / 5 / 6 各用哪种方式、prompt 模板)在 Batch 3
> 落地,计划放 `references/review-protocol.md`。
