# web-video-presentation 研究文档集

> **研究对象**：`web-video-presentation` skill（本地 `../web-video-presentation/`，548KB / 62 文件）
> **快照验证**：本地副本与上游 `github.com/ConardLi/garden-skills` main 分支**逐字节一致**（关键 5 文件 raw 对照 IDENTICAL + 全目录 `diff -rq` 通过；上游最后 touch：2026-06-09 `78b4d08` release 1.2.2，本地 manifest 同版本）→ 本仓库所有分析对上游同样成立。
> **方法**：本地 62 文件全量实读 + 后台研究 agent 对抗性复核（含 Playwright + React 18 UMD 实证、GitHub raw/commit 历史抓取、Remotion / Playwright / fontsource / ffmpeg 官方文档抓取）+ HyperFrames 18 个本地 skill 全套实读。
> **日期**：2026-09-01 ~ 09-02

---

## 文档地图（按阅读顺序）

| # | 文档 | 内容 | 适合谁 |
|---|---|---|---|
| 0 | [00-beginner-guide.md](00-beginner-guide.md) | **小白入门（人话版）**：一条视频诞生的故事、名词小词典（step/主题/token/零件…全部翻译）、9 个毛病的白话版、三家对比白话表、按身份的阅读顺序 | **没有技术背景，先读这份** |
| 1 | [01-skill-anatomy.md](01-skill-anatomy.md) | **skill 完整解剖**：本质（时间轴→坐标轴）、五大核心机制、Phase 1-4 全流程运转细节、协作协议、演化方向观察 | 想理解"它是什么" |
| 2 | [02-replication-roadmap.md](02-replication-roadmap.md) | **复刻路线图**：四层依赖序（引擎→音画→方法论→流程协议），每层具体文件清单、照抄/简化/抄结构的边界、技术选型 | 想动手复刻 |
| 3 | [03-findings-audit.md](03-findings-audit.md) | **对抗性复核证据报告**（agent 产出，保留原样）：10 条结论逐条判定（7 CONFIRMED / 2 PARTIAL / 1 REFUTED）+ 3 条清单外发现 + 外部一手研究（Remotion / Playwright / fontsource / ffmpeg / 上游 git 历史） | 想核实每条声明 |
| 4 | [04-improvements.md](04-improvements.md) | **改进方向全集**：复核后确认的缺陷清单（9 项）、把纪律自动化的方案（check / render）、字体修复、流程改进、必须保留的设计 | 想改进/超越原 skill |
| 5 | [05-comparison-video-engines.md](05-comparison-video-engines.md) | **Remotion / HyperFrames / web-video-presentation 三方对比**：三种时间模型（帧函数 / seek 函数 / step 函数）、联系与演进线、HyperFrames 全套一手发现、对复刻的 5 个行动项 | 想选型/借力 |
| 6 | [06-prompts-and-visual-elements.md](06-prompts-and-visual-elements.md) | **提示词控制 + 画面元素 + 控制矩阵 + 形态选型**：Part A 提示词 6 手法；Part B 画面元素三层楼；Part C 每个视觉细节谁说了算（主题/章节/框架权力矩阵）；Part D React 库 vs Vite 模板（整车 vs 发动机 + 模板缺陷解法）；**Part E 音频驱动机制（卡拉OK比喻）+ 库/模板/harness 三形态与组件库化路线** | 小白入门 / 选型决策 |
| 7 | [07-design-draft.md](07-design-draft.md) | **新 skill 需求设计草稿（进行中）**：15 条需求归宿映射、定位与范围、平台档案模型、主题 token 契约、组件库定稿、Phase 0-5 harness、A′ 渲染管线、字幕与播放控制、待敲定事项 | 复刻开发（随对话更新） |
| 8 | [plans/](plans/) | **实现计划（按里程碑拆）**：M1 引擎+脚手架 / M2a token+组件 / M2a-2 组件第二批 / M2b 主题 / M3a 静态门禁 / M4.5 ECharts / **M4 静态分镜管线** / **M3b 无头门禁**（均已执行已合并，终审通过；M3b 九任务收口于 2026-09-11~12，check 全量 20 项达成）；后续 M5 渲染、M6 E2E、M7 封装各独立计划（M5 前置项见 07 文档 §12"遗留清单"——首项已由 M3b Task 6 提前落地） | 执行者 |
| 9 | [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | **跨里程碑已知问题台账**：已修 / 活跃（门禁假绿方向 + 低危）/ 已知边界 / 记账问题——来源一句话 + 建议处置。**规则**：任何终审 parked 裁决与 deferred 项必须落此或下一里程碑显式条目，未落盘不许删工作区 | 维护者 |

> **你是小白？** 请从 [00-beginner-guide.md](00-beginner-guide.md) 开始——它把其余文档的黑话全部翻译成人话，并标注了每份文档该怎么配合读。

---

## 核心结论速览

1. **本质**：这个 skill 的真正产品不是模板代码，而是"把视频制作问题翻译成软件开发问题"的方法论——**把时间轴（连续）替换成 step 计数器（离散）**，视频的每一秒变成一个可点击的 step，于是视频制作变成纯前端开发。运行时代码极薄（核心 hooks < 400 行），价值密度在 references/ 的 ~2000 行创作法文档里。

2. **五大机制**：① `chapter = f(step)` 纯函数渲染（挂载即动画）；② `narrations.ts` 单一真相源（长度 = step 数 = 音频文件数，无 totalSteps 字段可写错）；③ 1920×1080 固定舞台 + transform scale（无响应式）；④ `audio.ended` 事件即时间轴（音画同步从机制上杜绝漂移）；⑤ 主题 token 双层契约（16 必填 + 性格 primitive，换主题 = 覆盖一个文件）。

3. **复核修正**（详见文档 3）：原分析 3 处需修正——**MaskReveal 的 transition 实证永不重放**（模板自己的文字揭示实际是瞬间出现）；extract-narrations 是**后缀匹配**非 1:1 配对（代码注释与实现不符）；fonts.css 实为 **13 家族**且 **7 个内置主题声明的字体从未被加载**。

4. **坐标系**：Remotion = 帧的函数（React 组件即视频，程序化渲染）；HyperFrames = seek 的函数（HTML + data-* 声明式时序，Agent 可静态 lint，确定性优先于表达能力）；web-video-presentation = step 的函数（拒绝时间轴也拒绝渲染，浏览器即播放器，录屏即成片）。前两者解决"怎么渲染"，第三者解决"怎么创作"。

5. **最高杠杆的改进**：把约束从"文档纪律"收敛到"结构保证"——`npm run check`（narrations 一致性 + 反 AI 味正则 lint + 无头 seek pass）和 `npm run render`（Playwright 截帧 + ffmpeg concat，Remotion/HF 有成熟先例）。这也是原 skill 自身 git 历史显示的演化方向。

## 修正记忆的说明

会话早期发现的"记忆索引死链"（`web-video-presentation-structure.md`）已重建：该文件是 **agent 记忆**（`~/.claude/projects/.../memory/`），不是源项目文件（上游全库 find 零命中确认）；内容基于本仓库实读 + 复核修正持续更新。
