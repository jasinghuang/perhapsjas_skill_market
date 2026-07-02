---
name: plan-template
description: Phase 2 产出的 plan/plan.md 模板，Phase 3 Plan Checkpoint 供用户确认
---

# Plan 模板（plan/plan.md）

Phase 2 产出，Phase 3 Plan Checkpoint 摆给用户确认。四段结构：

## Brief

- **主题词**（2-4 字，封面 hero-title）
- 视觉主题（默认 warm-yellow；其他见 `theme-profiles/index.json`）
- 目标读者
- 调性（专业 / 亲切 / 科普 / …）
- 配图模式：`none` / `placeholders` / `user-assets`（决定是否用外部图；不影响布局模板自带的色块占位）
- 封面：开 / 关
- 卡片数量预估

## Outline（卡片清单）

| 序号 | 类型 | 标题 | 内容块来源（source.md 锚点） | 关键词标记 |
|---|---|---|---|---|
| 01 | cover | {{主题词}} | —— | —— |
| 02 | content | {{段落标题}} | source.md § 第一段 | 词A、词B |
| 03 | content | {{段落标题}} | source.md § 第二段 | 词C |
| … | … | … | … | … |
| NN | ending | {{结尾标题}} | source.md § 总结 | —— |

## Layout

- 各卡布局模板（当前只有 `default`）
- 封面方案：主题词 / 中文副标题 / 英文副标题 / 配图区（983×770）

## Assets

逐卡配图计划：占位色块 / 用户提供 / 无。`none` 模式下本段一句话带过即可。
