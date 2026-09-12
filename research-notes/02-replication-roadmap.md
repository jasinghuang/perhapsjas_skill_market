# 02 · 复刻路线图

> 配套阅读：[01-skill-anatomy.md](01-skill-anatomy.md)（机制）、[03-findings-audit.md](03-findings-audit.md)（证据）、[04-improvements.md](04-improvements.md)（复刻时顺手修的缺陷）。

---

## 总原则

**MVP 极小**：核心引擎 5 个文件约 400 行，一两天可让"点击驱动的假视频"跑起来，之后全是增量。**真正的难点不在代码在文档**——三份方法论文档无法抄代码，只能抄"结构"。

## 第 1 层 · 核心引擎（约 5 个文件，1~2 天）

| 文件 | 做法 | 要点 |
|---|---|---|
| `useStageScale` | **原样照搬**（29 行） | 三层：app-shell → fitter(真实可见px) → frame(scale from top-left) |
| `useStepper` | **简化照抄** | 可去掉 `jumpToGlobal`/数字键；保留 next/prev/jumpToChapter + localStorage + sanitize |
| `Stage` | **照抄** | 点击推进 + `data-no-advance` 白名单（`t.closest("button, a, input, [data-no-advance]")`） |
| `registry/types.ts` | **照抄契约** | `ChapterDef { id, title, narrations, Component }`——注意原版有 `title` |
| 示例章节 + `App.tsx` | **照抄模式** | `key={ch.id}` 章节层重挂；`if (step === N)` 纯函数分支 |

到这一步"点击驱动的假视频"已经成立。

**⚠️ 复刻时顺手修**（对照 04 文档缺陷 #1）：
- 入场动画统一用 **keyframes**（挂载即重放），不要用 MaskReveal 式 transition（实证永不重放）
- 或者给 transition 类做 `requestAnimationFrame` 两帧翻转（先渲无终态类，下一帧再加）——若坚持 transition 的动画语汇

## 第 2 层 · 音画同步

| 组件 | 做法 |
|---|---|
| `useAutoMode` | 三模式状态机 + URL 同步（`?auto=1`/`?audio=1`）+ M 键循环 |
| `useAudioPlayer` | ended + trailMs(200) → next；error/catch/null 全走估时 `max(1500, 字数×250)` |
| `AutoStartGate` | Space 手势解锁 autoplay |
| `extract-narrations` | **不要照抄正则解析**——原版后缀匹配有静默错配风险（证据报告 #7）。改法：章节注册走独立 React-free manifest 文件，或 narrations.ts 里直接 export `{ id, folder }` 元数据 |
| runner + provider 契约 | bash 层独立可测；三函数契约照抄（`tts_synthesize` 必需 / `tts_check` / `tts_install_help`） |

**顺手修**：`?auto=1` 时跳过 localStorage 恢复（缺陷 #2）；STORAGE_KEY 按 project 名生成而非全局（缺陷 #3 跨项目污染）。

## 第 3 层 · 方法论层（价值密度最高）

**这层无法抄代码，只能抄结构**。三份文档的统一骨架：

```
原则（正文） + 反模式清单（❌ 具体句式/具体视觉指纹） + 强制自检 checklist
checklist 带"能力降级执行方式"：Agent Teams → subagent → 自检兜底
铁律：先按 fail 项改完再汇报，直接拿原始结论汇报 = 违规
```

| 你的文档 | 对应原版 | 必须保留的设计 |
|---|---|---|
| 口播稿写作法 | SCRIPT-STYLE（~410 行） | 信息保留度 ≥60% 可机器验证（wc -m）；五类 AI 指纹给**具体句式**；平台变体表 |
| outline 规格 | OUTLINE-FORMAT | **禁止写动画**；信息池必带来源标注；命名即目录结构 |
| 章节开发法 | CHAPTER-CRAFT | 双源原则；逐步揭示（1 项 = 1 step）；反 AI 味视觉指纹清单；token 红线 vs 自由区清单 |

**建议修正原版的结构漂移**：SKILL.md 引用的"Part 0~8"路标在原版文件里不存在（证据报告附加发现 #1）——你写自己的版本时，让路标和实际章节一一对应，或者干脆不给 Part 编号。

**主题系统**：
- 先定 token 契约：16 必填（4 表面 + 4 文字 + 1 rule + 3 accent + 4 字体）+ 性格旋钮（`--r-card`/`--rule-w/style`/`--hero-num-*`/`--stage-pad-*`）+ 装饰槽（pattern/vignette/text-shadow）
- 主题数量后补，起步 5~8 套覆盖主要情绪象限（深色电影/浅色印刷/keynote/终端/手写/赛博 各一）
- **顺手修**（缺陷 #4）：每套主题声明字体必须实际加载——字体清单进主题目录（theme.json 列 fonts），scaffold 校验
- **顺手修**（缺陷 #5）：字体自托管（fontsource 或本地 woff2），不要运行时 @import Google Fonts

## 第 4 层 · 流程协议

| 组件 | 做法 |
|---|---|
| `scaffold.sh` | 照抄结构：create vite → 删 boilerplate → 拷模板 → 拷主题 → 接 npm scripts → **tsc 冒烟**（这步值得抄，防接线错误） |
| Checkpoint 设计 | 单次对齐多件事（压缩往返）；第 1 章强制 anchor + 验收；合成前用户扫 segments.json |
| SKILL.md | 带"阶段 × 必读文件"渐进读取表；EXAMPLES 带"不是模板是 anchor"警告 |

## 复刻边界速查

| 类别 | 清单 |
|---|---|
| **原样照搬** | useStageScale / Stage 点击白名单 / ChapterDef 契约 / useAudioPlayer 退化路径 / provider 三函数契约 / tsc 冒烟 / 隐藏 chrome 思路 |
| **简化** | useStepper（去 jumpToGlobal/数字键）/ 主题数量（起步 5~8）/ EXAMPLES（起步 1~2 个 anchor） |
| **抄结构不抄实现** | 三份方法论文档 / 自检协议降级链 / checkpoint 设计 / EXAMPLES 的警告框架 |
| **不要照抄（有缺陷）** | MaskReveal 式 transition 入场 / extract-narrations 正则配对 / `?auto=1` 读 localStorage / 全局 STORAGE_KEY / 运行时 Google Fonts @import / SKILL.md ↔ CHAPTER-CRAFT 的 Part 路标 |
| **原版没有、值得直接加上** | `npm run check` 自动门禁 / `npm run render` 程序化出口 / 字幕层 `?sub=1` / style-card.md 风格锚（见 04 文档） |

## 工作量估计（单人 + AI 协作）

| 层 | 估计 | 说明 |
|---|---|---|
| 1 引擎 | 1~2 天 | 400 行核心 + demo 章节 |
| 2 音画 | 1~2 天 | hooks + extract/runner/provider（先 1 个 provider） |
| 3 方法论 | 3~5 天 | 三份文档各 ~300 行 + 5~8 主题 + 1~2 anchor |
| 4 流程 | 1 天 | scaffold + SKILL.md |
| 增强（04 文档） | 2~3 天 | check / render / 修缺陷 |
| **合计** | **约 1.5~2 周** | 到"超越原版"的可用状态 |
