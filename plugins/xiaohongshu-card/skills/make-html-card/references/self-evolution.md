---
name: self-evolution
description: 自进化闭环——回看质检/修复日志，沉淀 patterns，反馈优化 skill
---

# 自进化闭环

借鉴 beautiful-article 的自进化理念：**质检 / 修复日志不只是给人看，是给 agent 看**。同类任务
跑多了，回看这些日志能发现高频问题模式，反过来优化 skill 的规则 / 检查清单 / 默认策略。

## 何时做

- **每次任务结束**（Phase 8 交付后）：顺手做一次轻量回顾（Phase 9，可选）。
- **下次同类任务开始**（Phase 0）：先扫一眼 `review/patterns.md` 的改进建议，把已沉淀的教训
  带进本次任务。

## 回顾怎么做（Phase 9）

1. **读**：本次的 `review/first-card-review.md`、`review/final-review.md`、`review/repair-log.md`（若有）。
2. **提炼问题**：按类归档——抽取 / 拆分 / 排版 / 合规 / 并行 / raw / 主题 / 序号 …。
3. **追加 `review/patterns.md`**：跨任务累积（带日期 + 简述；同类问题 +1 频次）。
4. **反复出现（≥3 次）的问题**：提出对 skill 的改进建议，写进 `patterns.md` 的"改进建议"段。

## 改进建议的落点

| 反复出现的问题类型 | 改进落点 |
|---|---|
| 某个 P0 项经常漏 | `references/checklist.md` 加项 / 提权重 |
| 流式填充经常溢出或太空 | 微调 SKILL.md Phase 2 的填充系数（~92%） |
| 某类 raw 经常跑偏 | `references/component-policy.md` 加约束 / 示例 |
| 某主题不合适某类内容 | `theme-profiles/<id>.md` 补风格说明 |
| 抽取经常丢某类信息 | `references/source-to-markdown.md` 的 5 条自检补项 |
| 并行常出序号错乱 | `references/section-build.md` 的序号规则强化 |

> 改进建议先写进 `patterns.md` 积累；由人（或 agent 在明确授权时）择机落实进 skill 文件，
> 落实后在 `patterns.md` 标记"已采纳"。

## review/patterns.md 格式

```
## 问题频次（跨任务累积）

- [2026-06-27] 排版·溢出：正文卡 card-03 内容超出风险提示区（第 2 次）
- [2026-06-29] 排版·溢出：card-05 同样溢出（第 3 次）→ 触发改进建议
- [2026-07-02] 合规·风险提示：card-02 风险提示被 raw 遮挡（第 1 次）

## 改进建议（待落实 / 已采纳）

- [已采纳 2026-07-05] 填充目标：65~85% → ~92%（实战确认，黑天鹅 card-02 验证）。填满靠段落间距（margin）微调，行距（line-height 1.42）固定不动。
- [已采纳 2026-07-05] checklist P0 加一条：raw 不得遮挡 .disclaimer。
```

## 一句话

> 日志沉淀 → patterns 浮现 → 反馈优化 skill → 下次任务更好。这是 skill 自进化的闭环。
