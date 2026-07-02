---
name: harness
description: make-html-card 的 harness 设计意图——六个核心部分的对应关系
---

# Harness 视角

本 Skill 的重点不是"提示词"，而是一个小型 harness。它要回答六个问题：

| Harness 部分 | 本 Skill 解决的问题 | 设计手段 |
|---|---|---|
| 上下文管理 | 模型到底看到了什么 | 输入统一转 `source.md`；阶段化读取 references；每张卡开工前回看布局模板 + design-tokens |
| 工具系统 | 能处理什么输入 / 输出 | URL / PDF / 纯文本 → `source.md`；布局模板占位符填空；浏览器 `open` 预览 |
| 执行编排 | 下一步该做什么 | 分 Phase 0-8；Plan Checkpoint → First Card 定调 → 完整生成 → 终审 → 修复 → 交付 |
| 状态与记忆 | 决策如何跨步骤保持 | `source.md` / `plan.md` / `manifest.json` / `review/*` |
| 评估与观测 | 怎么知道卡片好不好 | Phase 1 主 Agent 内联 5 条自检；Phase 6 终审对照 checklist P0/P1/P2 |
| 约束与恢复 | 跑偏后怎么修 | Phase 7 最小切片修复（单卡级），禁止全套重写 |

## 状态文件是长期记忆

Agent **不应依赖聊天上下文记住关键决策**。跨阶段决策落盘到下列文件：

```
source/source.md             # 统一后的事实底座（原始语言）
source/extraction-notes.md   # 抽取不确定项 / 丢失 / 待补充
plan/plan.md                 # 卡片拆分规划（Brief / Outline / Layout / Assets 四段）
cards/card-NN.html           # 每张卡独立文件
cards/manifest.json          # 主 agent 拥有：卡序号 / 类型 / 标题 / 拥有者（Phase 5 并行用）
review/first-card-review.md  # 首卡定调验收（Checkpoint 2 依据）
review/final-review.md       # 终审三视角结论（交付物的一部分）
review/repair-log.md         # 仅有修复时
```

长会话中如果不确定某个已确认的决策，**回读这些文件**，不要凭记忆重新发明。

## 为什么是这个流程

借鉴 `beautiful-article` skill 的 harness 骨架（Phase / Checkpoint / 渐进加载 / SubAgent 质检），
但**技术栈保持纯 HTML 模板填空**——小红书卡片每张天生是独立 HTML，`open` 即预览，
没有上 React / Vite 的必要。借鉴的是结构，不是技术栈。

## 一句话定位

> make-html-card 把任意输入统一成 `source.md`，再排版成精美的小红书图文卡片；
> 它首先是一组**可轮播的卡片**，每张独立成文件，主 agent 统一组装。
