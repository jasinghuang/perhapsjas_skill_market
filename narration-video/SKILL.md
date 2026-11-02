---
name: narration-video
description: 把财报（年报/季报/招股书）或财经文章，做成**能直接导出 mp4 的口播解读视频**——文章 → 口播稿（信息保留度 ≥85%）+ 大纲 → 机器生成真相源 → TTS 合成 → **静态分镜一次确认** → 章节叠动画 → `npm run render` 确定性出片（含字幕与 SRT）。两种画幅档案（B站 16:9 / 小红书 3:4）。核心是一套**机器门禁**（20 项 + 扩展，含视觉 token 与无头逐 step 检查）+ **组件库锁地板、章节层担天花板**的创作模型 + **A′ 确定性渲染**（逐帧 seek 而非录屏）。
---

# narration-video

把"做视频"翻译成"写前端"，再把"写前端"**收敛到一条能被机器验收的流水线**：每一步都有产物、每个产物都有门禁、每个创造性决策都有确认窗口。

**两条根原则**（读任何 references 前先记住）：

1. **step 模型**：`chapter = f(step)` 纯函数。视频的每一秒变成一个可点击/可枚举的 step，没有时间轴，没有 `setTimeout`，没有"第 3.2 秒该做什么"。
2. **单一真相源**：`narrations`（每章的口播句数组）= step 数 = mp3 文件数 = 时长表条目数。**四者由门禁钉死**——没有 `totalSteps` 这种可以写错的字段。

---

## 0. 硬性自检协议（贯穿所有阶段）

**三个产出，三次自检，无一例外**：口播稿+大纲（Phase 1）／静态分镜（Phase 3）／每一章（Phase 4）。自检 = **跑机器门禁 → 逐条修复 → 再汇报**。

- 拿到门禁输出**不修复就汇报 = 违规**。没有"已知问题但先这样"。
- 门禁命令见 `references/GATES.md`（20 项逐条手册：查什么 / 报错原文 / 怎么修）。
- 门禁不过不许说"做完了"；warning 必须在汇报里**逐条说明**理由或修复计划。

**检查点怎么定（M6 按用户拍板重构为五个，顺序即流程）**：一个检查点，只在**三个条件同时成立**时才设——

1. **是创造性决策的锁定点**（机器验不了的东西才需要人拍板）；
2. **重做成本高**（改稿=全链重做，改构图=重截所有帧）；
3. **机器验不了**（narratives 长度/色值/时长/越界由 20 项门禁**连续**把关——它们是底线，
   不是检查点；把门禁能拦的事放进检查点 = 浪费用户时间）。

按此验证出的五个检查点（顺序固定，缺一不可跳过）：

| # | 检查点 | 确认什么 | 为什么设在这 |
|---|---|---|---|
| A | **选题** | agent 自主分析素材后给 **3 个选题角度**（或重构选题），用户选 1 | 方向错 = 全片重做，最贵的一步 |
| B | **口播稿** | 润色后的稿子全文（信息保留度 ≥85%、语气唯一） | 稿子是全链源头；outline/分镜/配音全部由它派生——**outline 不再单独设检查点**（它的好坏在分镜确认时一并被看见） |
| C | **分镜** | 全部画面的静态构图 + 停留节奏 + 动画方向（分镜页逐帧） | 画面返工 = 重截所有帧；动画方向定错 = 全片重做 |
| D | **第一章配音** | 第一章的配音试听（音色/节奏） | 烧钱前先听一遍；第一章 = 全片声音的风格锚 |
| E | **成片** | 渲染出的 mp4 终审 | 交付前的最后一道人眼 |

其余节点（音频清单、逐章门禁）都是**机器连续把关**，不是检查点——机器能拦的事不占用用户时间。

---

## 1. 工作流总览

```
Phase 0 · 选题对齐      素材分析 → 提炼 3 个选题角度（或重构选题）→ 用户选 1
                        ── Checkpoint A：选题 ──
Phase 1 · 口播稿        润色稿子（信息保留度 ≥85%、语气唯一、数字可溯）
                        ── Checkpoint B：稿子 ──
Phase 1.5 · 大纲        由已确认稿子生成 outline（章节切分 + 信息池 + 步粒度）
                        （不再单独设检查点——它的好坏在分镜确认时一并被看见）
Phase 2 · 静态分镜      ★ 每章"静态终态版"先行（按 LIBRARY 构图模板册选屏型，禁一切动画）
                        → 逐帧截图 → storyboard/index.html
                        ── Checkpoint C：分镜（构图 + 停留节奏 + 动画方向，一次确认）──
Phase 2.5 · 第一章配音   合成第一章（风格锚）→ 试听
                        ── Checkpoint D：配音（音色/节奏确认后，其余章批量合成）──
Phase 3 · 章节开发      在静态版上叠动画（组件＋档位）；第 1 章强制主线程＋验收
                        ── 每章完工：npm run check:fast（0.9s 级，别攒到 Phase 4）──
Phase 4 · 渲染导出      npm run check（全量）→ npm run render → render/<slug>.mp4 ＋ .srt
                        ── Checkpoint E：成片终审，确认即交付 ──
```

**项目目录约定**（scaffold 生成后长这样）：

```
<project>/
  article.md              # 原始素材（双源原则的细节源，不删）
  script.md               # 口播稿（Checkpoint B 确认）
  outline.md              # 章节节奏 + 信息池（随 Checkpoint B 后生成，不单独确认）
  public/
    audio/<folder>/<step>.mp3     # 每步一个 mp3（step 从 0 计）
    audio-durations.json          # ffprobe 实测时长（合成后生成）
  src/
    chapters/manifest.ts          # 章节注册表（单一真相源：id / folder / narrations / 组件）
    chapters/<NN-id>/
      index.tsx                   # 章节组件（chapter = f(step)）+ narrations 导出
      timing.json                 # 每步停留垫 / 动画词汇 / 氛围声明（可选）
  storyboard/             # Phase 3 产物（gitignore）：index.html + storyboard.json + shots/
  render/                 # Phase 5 产物（gitignore）：<slug>.mp4 + <slug>.srt
```

---

## 2. 各阶段读什么（渐进式加载）

| 阶段 | 必读 | 按需查 |
|---|---|---|
| Phase 0 | 本文件 §3 | `profiles/<平台>.md`（画幅/安全框/口播语气） |
| Phase 1 | **`references/SCRIPT-STYLE.md`** + **`references/OUTLINE-FORMAT.md`** | `profiles/<平台>.md` 的语气表 |
| Phase 1.5 | 本文件 §4 | — |
| Phase 2 | **`references/AUDIO.md`** | `templates/scripts/tts-providers/README.md`（**M6 交付**） |
| Phase 3 | **`references/STORYBOARD-CRAFT.md`** | `references/LIBRARY.md`（选组件） |
| Phase 4（每章） | **`references/CHAPTER-CRAFT.md`**（单一入口，全部约束都在这份里） | `references/LIBRARY.md`（组件/token/动画词表）、`references/GATES.md`（门禁红了才查）、`references/EXAMPLES/`（**不是必读**——卡壳再翻） |
| Phase 5 | **`references/RENDER.md`** | `references/GATES.md` |

> **为什么每章都要回看 CHAPTER-CRAFT**：长会话里 agent 会遗忘约束。它被刻意做成**一份**而不是五份——一章的必读面越小，越可能真的被读完。

---

## 3. Phase 0 · 选题对齐

1. **识别输入三态**：给的是文章/链接/PDF（→ 走完整流程）｜给的是口播稿（→ 跳过 Phase 1 的转写，直接 outline）｜只有选题（→ 先产出素材大纲再回第一种）。
2. **自主分析 → 3 个选题角度**：汇总素材后提炼 **3 个选题角度**（或重新构思选题）——每个角度 = 一句话主张 + 数据钩子 + 目标时长 + 结构骨架。**不许直接开工**：选题方向错 = 全片重做，这是最贵的一步。用户选 1（或说"都不行"→ 重新提炼）。
3. **选平台**：B站（16:9）/ 小红书（3:4）。可双选——**双平台各走各的完整流程，稿子各自定制**（画幅不同、时长节奏不同；**语气不随平台变**——财报解读语气基线唯一，见 SCRIPT-STYLE）。
4. **素材三选一**：用户提供 / agent 挑选（列出候选让用户点头）/ placeholder（`<Figure>` 的诚实占位——**禁假 logo、假数据、假截图**）。
5. **主题**：v1 单主题（creative-mode）。展示 `?showcase=1` 画廊让用户确认气质。

---

## 4. Phase 1.5 · 脚手架与真相源

```bash
bash <skill>/scripts/scaffold.sh <目标目录> --slug <项目名> --stage 16:9   # 或 3:4
```

- 脚手架 = 整拷模板 + 按档案写 `runtime-config.ts`（slug / 舞台尺寸 / 安全框折算）+ `npm install` + `tsc` 冒烟。**首次截图/渲染前**需 `npx playwright install chromium`（跨项目缓存复用）与 `ffmpeg`（仅渲染需要）。
- **真相源机器生成**：由 Checkpoint B 确认过的 `script.md` 切分生成每章的 `narrations` 数组并注册进 `src/chapters/manifest.ts`。**章节 agent 不得手改 narrations**——改稿 = 回 Phase 1 改稿 → 重生成 → 增量重合成（只重合成受影响段）。
- `narrations.length` 即该章 step 数。门禁 #1 与无头 pass 共同钉死"声明 = 使用"。

---

## 5. Phase 2 · 音频合成

见 `references/AUDIO.md`。要点：

- **provider-agnostic 三函数契约**（`tts_synthesize` / `tts_check` / `tts_install_help`）：换后端 = 丢一个 `.sh` 文件。
- 合成前**让用户扫一眼切分好的文本清单**（省钱门禁）；空 narration 步跳过不烧 token；已存在的 mp3 跳过（断点续合）。
- 合成后 `ffprobe` 实测 → `public/audio-durations.json`。**这是渲染时间轴的时长来源**——不再是估算。
- 单段 **≥ 15s 会报警**（口播过密 / step 没拆够）；这是门禁 #19。
- 音频缺失时全链**退化到估时**（`max(1500ms, 字数×250ms)`）——合法但不理想：分镜与成片的停留节奏会失真，CLI 会明示。

> **── Checkpoint D：第一章配音先合成，试听确认后其余章批量合成 ──**
> 第一章 = 全片声音的风格锚（音色/语速/断句）。合成**第一章** → 交给用户试听
> （音色对不对、节奏舒不舒服）→ 确认后再合成其余章。mock 音轨没有"声音"可听——
> 若本片走 mock，Checkpoint D 退化为"第一章 mock 节奏试听"并明示。

---

## 6. Phase 3 · 静态分镜（Checkpoint C 的作业面）

**这一步的产物是拿给用户确认的**，所以它必须"像成片"，而不是"像代码"。见 `references/STORYBOARD-CRAFT.md`。

1. **写静态终态版**：每章 `f(step)` 用组件拼出**这一步的终态构图**——**禁一切动画**（门禁 #4 + 分镜阶段零动画断言；氛围微动须在 `timing.json` 的 `ambient` 里逐帧声明）。
2. `npm run storyboard` → `storyboard/index.html`：每帧 = 静态终态图 + 口播文本 + 音频实测时长 + 停留垫（可调）+ **主导动画词汇**。
3. 在 `timing.json` 里标注每帧：`dwell`（停留垫覆盖）/ `animation`（主导动画词汇）/ `ambient`（氛围声明）。
4. `npm run storyboard -- --verify-sequential`：顺序推进 vs 独立 mount 逐字节一致（渲染模型的前置门禁）。

> **── Checkpoint C（本 skill 最重要的确认窗口）──**
> 一次确认三件事：**静态构图、每帧停留节奏、动画方向**。
> 反馈分级（作业细则见 STORYBOARD-CRAFT）：
> - 改构图/停留垫 → 改静态版 + `timing.json`，重截受影响帧
> - 改文本/切分 → 回 Phase 1 局部重生成 + 增量重合成 + 重截受影响帧
> - 改动画方向 → 只改 `timing.json` 的 `animation` 词汇，重新确认（**不用重截**）

**为什么动画在这里"定方向"而不"定实现"**：写死实现 = 章节 agent 退化为翻译机。Checkpoint C 确认的是**词汇**（"这一帧 Counter + BarGrow"），参数留给 Phase 4。

---

## 7. Phase 4 · 章节开发

**每章的单一必读入口是 `references/CHAPTER-CRAFT.md`**。要点：

- 在 Phase 3 的静态版上叠动画：**选组件 + 选档位**，不手写裸动画（组件动画必经引擎注册表——门禁 #4 扫的就是这个）。
- **第 1 章强制主线程 + 验收（含动画观感）**——它是全片动画节奏的风格锚。第 1 章没有"骨架版"概念，必须做到用户能直接验收。
- 第 2~N 章可切模式：**A** 逐章（默认）／**B** 顺序／**C** 并行 subagent（并行时 prompt 必须带：该章 outline 段 + CHAPTER-CRAFT 路径 + 阶段参数 + 第 1 章代码作风格参考 + 三条硬规则）。
- **每章完工即 `npm run check:fast`**（秒级），别攒到 Phase 5。

---

## 8. Phase 5 · 渲染导出

```bash
npm run check                      # 全量门禁（fast + 无头逐 step）：零 blocker 才继续
npm run render                     # 自起 Vite → 逐帧 seek → ffmpeg → render/<slug>.mp4（＋ .srt）
```

- 产物：`render/<slug>.mp4`（1920×1080 或 1080×1440 @30fps）＋ `render/<slug>.srt`。
- 未合成音频时按估时出片（**无声**，CLI 明示）；`--mock-audio` 可出占位音轨（lavfi 正弦）用来打通链路。
- 常用 flag：`--only 0,2`（只渲指定步）/ `--concurrency N` / `--no-subs`（出无字幕版）/ `--verify-determinism`（跨会话重采逐字节）。**注意 `npm run render -- --flag` 的 `--` 必带**。
- **页面导出按钮**：`npm run dev` 后页面上有导出按钮（本地渲染服务，随 dev server 起）——用户不碰命令行也能出片。
- 失败时**响亮降级**为实时捕获（`<slug>.realtime.mp4`，画面按墙钟、音轨按时间轴，A/V 同步是近似的）。
- 排查与管线细节见 `references/RENDER.md`。

---

## 9. 常见用户反馈速查

| 用户说 | 大概率问题在哪 | 最小修法 |
|---|---|---|
| "这页太空了 / 像 PPT" | 内容密度：画面信息量 ≤ 口播 | 回 `outline.md` 的信息池补细节，换更"能演示"的组件 |
| "动画太多了 / 花" | 动画选型同质化或都挂氛围微动 | 换**主导动画**（不是加持续微动），见 CHAPTER-CRAFT 的动画决策树 |
| "这步停留太快/太慢" | 停留垫 | 改该步 `timing.json` 的 `dwell` → 重跑 `storyboard` 确认 |
| "字幕挡住内容了" | 安全框 | 内容底缘 ≤934（`?showcase=1&guides=1` 有参考线），见 `references/LIBRARY.md` |
| "颜色/字体不对" | token 用错或绕过 | 门禁 #2/#3 会报位置；查 `references/LIBRARY.md` 的 token 表 |
| "check 报红了" | — | 查 `references/GATES.md` 对应编号，按"报错原文 → 修法"修 |
| "渲染出来卡住/黑屏" | 引擎或环境 | `references/RENDER.md` 的排查表；先 `--only 0` 渲一步定位 |
| "想改稿" | — | 回 Phase 1 改 `script.md` → 重生成 narrations → 增量重合成 → 重截受影响帧 |

---

## 10. 相关资源

| 文件 | 何时读 | 内容 |
|---|---|---|
| `references/SCRIPT-STYLE.md` | Phase 1 | 文章→口播稿：信息保留度 ≥85%、去 AI 味、数字三件套、四层自检 |
| `references/OUTLINE-FORMAT.md` | Phase 1 | outline 字段 spec、命名速查、切章法则、信息池（必带来源标注） |
| `references/STORYBOARD-CRAFT.md` | Phase 3 | 静态分镜作业手册、Checkpoint C 的确认话术、停留垫与动画词汇标注 |
| `references/CHAPTER-CRAFT.md` | Phase 4（每章） | **单章唯一入口**：视觉底线、逐步揭示、双源、动画决策树、完工自检 |
| `references/LIBRARY.md` | Phase 3/4 | 44 组件目录 + token 契约 + 动画原语词表 |
| `references/GATES.md` | 任何门禁报红时 | 20 项门禁逐条：查什么 / 报错原文 / 修法 |
| `references/AUDIO.md` | Phase 2 | TTS 三函数契约、合成流程、时长回写、故障表 |
| `references/RENDER.md` | Phase 5 | A′ 确定性渲染管线、产物自校验、降级与排查 |
| `references/EXAMPLES/` | 卡壳时（**不是必读**） | 结构骨架 anchor：怎么"保留形、换动作" |
| `profiles/bilibili.md` `profiles/xiaohongshu.md` | Phase 0/1 | 画幅与安全框、口播语气、构图约定、渲染参数 |
