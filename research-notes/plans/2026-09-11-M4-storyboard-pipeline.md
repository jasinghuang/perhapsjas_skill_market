# M4 静态分镜管线（时间机器 + storyboard）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付"时间机器"——确定性游标桥 + Playwright 截图模块 + storyboard 生成器（Phase 3 静态分镜管线），并带分镜阶段门禁（零动画 + 帧数校验）与顺序推进/独立 mount 一致性校验。M5 渲染管线与 M3b 无头门禁将复用同一台机器。

**Architecture:** 三层：① 引擎层 `cursorBridge`（window.__presentation 确定性控制接口 + 就绪信号，仅 dev/headless 模式安装）；② 截图模块 `scripts/shot/`（Playwright 连接 → 跳游标 → 等就绪 → 断言 → 截图，纯函数式 API 可测）；③ 编排层 `scripts/storyboard.ts`（读 manifest/durations/timing.json → 逐帧截图 → 生成自包含 storyboard.html + 门禁）。

**Spec:** `../07-design-draft.md` §7 关键决策 1/2、§8（时间轴表/动画窗口/等待语义）、§11.3 M4 行。

## Global Constraints

- **截图模块与渲染管线同源**（§7 决策 1）——本计划的 `scripts/shot/` 即 M5/M3b 复用的"时间机器"；API 设计须让 M5 直接调用（逐帧 seek、动画窗口测量都是它的后续能力）
- **分镜阶段门禁**（§11.3 M4）：静态版 `animations()` 为空（**WAAPI + 引擎注册表之和**，Ruling M4-1；禁混入动画）+ 分镜帧数 === 总 step 数。注：求和语义对 WAAPI 动画为上界计数（注册表与 getAnimations 各计一次，2N）——门禁判据 `>0` 不受影响；精确计数断言不可依赖此值。
  **Ruling M4-2（氛围豁免）**：入场动画（reveal/counter/步骤等）在 Phase 3 静态版一律禁止（含未声明的任何动画计数 > 0 → blocker）；**氛围微动**（KenBurns/粒子/呼吸等"t=0 即组合态、无入场态"）按步**显式声明豁免**——`timing.json` 的 `"ambient": { "<step>": "<note>" }`，声明步允许计数 > 0 并在分镜帧上显示 note（Checkpoint 2 人审兜底；未声明的计数 > 0 仍报红）。example 章节 step 0 的 KenBurns（引擎测试脚手架）将如此声明
- **顺序推进 vs 独立 mount 一致性**：同一 step 以"顺序推进到达"与"直接跳转到达"截图，像素必须一致（渲染模型 = 独立 mount；此为 M5 的前置门禁）
- 确定性：跳转 → 等待（fonts.ready + 图像就绪 + 双 rAF）→ 截图；截图环境遵守既有约定（viewport 1920×1080 × deviceScaleFactor 1 = 精确 1080p；浏览器锁定版本）
- Playwright 版本**精确锁定**（§8.1 跨环境脆弱）；Chromium 浏览器下载不随 scaffold 自动执行（首次运行给出明确安装指引）
- 页面在 headless 模式下禁动画自主播放（复用既有 `?render` 创建即冻结机制——截图前动画**不存在**是分镜阶段的要求，本计划不启动 render 模式）
- 停留垫数据（`timing.json`）：引擎默认 400ms → 档案覆盖 → 分镜每帧可调（§3.1）；本计划落实"分镜每帧可调"的载体与消费

## 接口约定（跨计划冻结）

**1. 游标桥（引擎层新增，M5 复用）**
```ts
// src/engine/cursorBridge.ts
export interface PresentationBridge {
  jumpTo(chapter: number, step: number): void;   // 同步定位（React 状态更新后由 ready() 等待落定）
  getState(): { chapter: number; step: number };
  ready(): Promise<void>;                        // 双 rAF + fonts.ready + 所有 img.complete
  animations(): number;                          // document.getAnimations() 计数 + 引擎注册表计数（registrySize）之和——
                                                 // Ruling M4-1：仅 WAAPI 会漏 canvasAnim 帧函数动画，加上注册表才完备
                                                 // （分镜门禁/覆盖率断言共用）
}
declare global { interface Window { __presentation?: PresentationBridge } }
```
安装条件：URL 含 `headless=1` 或在 dev 模式（`import.meta.env.DEV`）——生产构建不暴露。

**2. 截图模块（`scripts/shot/capture.ts`，M5/M3b 复用）**
```ts
export interface ShotSpec { chapter: number; step: number; }
export interface CaptureOptions {
  url: string;                 // 默认 http://localhost:5174
  outDir: string;
  viewport?: { width: number; height: number };  // 默认 1920×1080
  assertNoAnimations?: boolean;                  // 分镜模式 true（默认 false，M5 用 false）
  chapterIds?: readonly string[];                // 章节 id 序（chapters.map(c => c.id)）——Ruling M4-3：
                                                 // 必传（缺失即 throw，不静默退化为数字下标）
}
export interface CaptureResult extends ShotSpec { file: string; animations: number; }
export async function captureSteps(specs: ShotSpec[], opts: CaptureOptions): Promise<CaptureResult[]>;
```
实现要点：单浏览器实例单页面；每步 `evaluate(jumpTo)` → `await ready()` → 截图；`assertNoAnimations` 时 `animations()>0` → throw（定位到 chapter/step）。

**3. 分镜数据约定（章节层新增，可选文件）**
`src/chapters/<folder>/timing.json`：
```json
{ "dwell": { "3": 600 }, "animation": { "3": "Counter + BarGrow" }, "ambient": { "0": "KenBurns 背景缓推" } }
```
- `dwell`：该步停留垫**覆盖值**（ms；缺省用引擎默认 400）
- `animation`：该帧"主导动画词汇"标注（Phase 3 由章节作者填写，Checkpoint 2 确认的即是它）
- `ambient`：**氛围声明**（Ruling M4-2）——声明步允许动画计数 > 0（KenBurns/粒子等无入场态的氛围微动），note 显示在分镜帧；未声明的计数 > 0 = 门禁报红
- 文件可选；缺失 = 全默认（门禁不因缺失失败，仅分镜页显示"未标注"）

**4. 输出约定**
```
<project>/storyboard/
  index.html        # 自包含分镜页（相对引用 shots/，离线可开）
  storyboard.json   # 每帧：{chapter, step, chapterId, narration, audioMs, dwellMs, animMs|null, stepMs, animationVocab|null, shot}
  shots/<chapterId>/<step>.png
```
`audioMs` 来自 `public/audio-durations.json`（Ruling P4-8 位置）；`animMs` 分镜阶段恒 null（零动画）。

## 执行环境注意

- 模板新增 devDependency：`playwright`（精确版本，与全局 gstack 的 1.x 对齐——实现者取当前 gstack node_modules 里的版本号锁定）；`npx playwright install chromium` 在首次运行前由用户/CI 执行（脚本检测缺失时抛出含指引的错误）
- 截图脚本以 `tsx` 运行（模板已有）；dev server 需处于运行状态（脚本连接失败时给出 "先 npm run dev" 指引，不自动起服——M5 编排器再考虑自起）

---

### Task 1: 游标桥（引擎层 + App 接线）

**Files:**
- Create: `src/engine/cursorBridge.ts`
- Modify: `src/App.tsx`（安装桥）
- Test: `src/engine/cursorBridge.test.ts`

**Interfaces:**
- Produces: `PresentationBridge`、`installBridge(bridge: PresentationBridge): void`、`window.__presentation`（Task 2/M5 消费）；`ready()` 语义（双 rAF + fonts.ready + images complete）

- [ ] **Step 1: 写失败测试**（jsdom：installBridge 后 `window.__presentation` 可用；ready() 在 fonts.ready 后 resolve（stub document.fonts）；getState/jumpTo 透传；生产守卫——`installBridge` 仅在显式调用时安装，App 层守卫另行测）
- [ ] **Step 2: RED**（模块不存在）
- [ ] **Step 3: 实现** `cursorBridge.ts` + App 接线（`useEffect` 安装：`if (params.has("headless") || import.meta.env.DEV)`；jumpTo → stepper.jumpTo；ready → 见接口）
- [ ] **Step 4: GREEN**（全量 303 + 新增）
- [ ] **Step 5: Commit** `feat(M4): 游标桥（window.__presentation 确定性控制接口）`

---

### Task 2: 截图模块（时间机器核心）

**Files:**
- Create: `scripts/shot/capture.ts`
- Create: `scripts/shot/capture.test.ts`（纯函数部分单测：spec 展开、输出路径约定、结果结构）
- Modify: `package.json`（devDependency: playwright 精确版本；script 占位）

**Interfaces:**
- Consumes: Task 1 的 `window.__presentation`
- Produces: `captureSteps(specs, opts): Promise<CaptureResult[]>`（Task 3 与 M5/M3b 消费）；`chromiumMissingError()` 指引文案

- [ ] **Step 1: 写失败测试**（单测 capture.ts 的可测面：`expandSpecs(chapters, {ratio})` 展开 (chapter,step) 全列表；`shotPath(outDir, chapterId, step)` 路径约定；错误指引含 "npx playwright install chromium"）
- [ ] **Step 2-4: RED → 实现 → GREEN**（实现：`chromium.launch()` → `newPage({viewport})` → `goto(url + "?headless=1")` → 每步 `jumpTo` → `ready()` → `screenshot({path})`；assertNoAnimations 分支）
- [ ] **Step 5: 手工冒烟**：`npx tsx -e` 直调 captureSteps 对 example 章节 2 步截图（dev server 运行中），人眼确认 PNG 产出 + 动画计数 0（报告附文件列表）
- [ ] **Step 6: Commit** `feat(M4): 截图模块（Playwright 逐帧捕捉 + 零动画断言）`

---

### Task 3: storyboard 生成器 + 分镜门禁 + 一致性校验

**Files:**
- Create: `scripts/storyboard.ts`
- Create: `scripts/storyboard/html.ts`（纯函数：storyboard.html 模板生成，可单测）
- Create: `scripts/storyboard.test.ts`（data 组装 + html 生成单测）
- Create: `src/chapters/01-example/timing.json`（**示例标注**：dwell 覆盖 + 动画词汇 + **ambient 声明（step 0 的 KenBurns——引擎测试脚手架，Ruling M4-2）**——示范数据约定）
- Modify: `package.json`（`"storyboard": "tsx scripts/storyboard.ts"`）

**Interfaces:**
- Consumes: `captureSteps`（Task 2）、`COMPONENTS`/章节 manifest、`audio-durations.json`、各章 `timing.json`
- Produces: `storyboard/index.html` + `storyboard.json` + `shots/`；CLI flags：`--out <dir>`（默认 ./storyboard）、`--verify-sequential`（一致性校验模式）

- [ ] **Step 1: 写失败测试**（`buildStoryboardData({chapters, durations, timings})`: 每帧字段计算——dwellMs 覆盖/默认、stepMs = max(audioMs, 0) + dwellMs（分镜阶段 animMs 恒 0→stepMs=audioMs+dwellMs）、**ambient 声明步的 gatePass 语义（Ruling M4-2）**、帧数 === 总 steps；`renderStoryboardHtml(data)`: 含每帧图/文案/时长/词汇/ambient note、无外链）
- [ ] **Step 2-4: RED → 实现 → GREEN**（`captureSteps` 调用须传 `chapterIds`——Ruling M4-3）
- [ ] **Step 5: 手工冒烟**：`npm run storyboard` 对模板跑通（dev server 运行中）——产出 index.html + shots/；**门禁行为验证**：帧数=3、step 0 的 KenBurns 经 timing.json `"ambient"` 声明后通过（note 显示在帧上）、step 1/2 零动画通过；**负样本**：临时从 timing.json 删掉 ambient 声明 → 计数 >0 报红（报告附输出）→ 还原
- [ ] **Step 6: 一致性校验模式**：`--verify-sequential`——对每 step 分别用"键盘顺序推进"与"直接 jumpTo"两条路径截图 → 字节比对 → 不一致即非零退出（example 章节应一致；报告附结论）。注意 step 0 的 KenBurns 为氛围微动——两条路径须在同一静置时刻比对（如等待同一 rAF 帧数后截图），否则时间差会造成假红；若不可控则该步记录为"氛围步免比对"并说明
- [ ] **Step 7: Commit** `feat(M4): storyboard 生成器（Phase 3 分镜管线 + 零动画门禁 + 顺序/独立 mount 一致性校验）`

---

### Task 4: 集成收口（scaffold 接线 + 文档）

**Files:**
- Modify: `narration-video/scripts/scaffold.sh`（下一步指引追加 storyboard 步骤；playwright 安装指引）
- Modify: `narration-video/scripts/scaffold-smoke.sh`（冒烟补：产物含 scripts/shot/ 与 scripts/storyboard.ts；`npm run check` 仍 0 blocker）
- Modify: `src/main.tsx`/注释等（如有陈旧表述）
- Test: 全量回归

- [ ] **Step 1: scaffold 接线**（模板目录整拷已覆盖 scripts/shot/；指引文案补 `npm run storyboard` 与首次 `npx playwright install chromium`）
- [ ] **Step 2: 冒烟**：`bash narration-video/scripts/scaffold-smoke.sh`（产物断言 + check exit 0）
- [ ] **Step 3: 全量**：`npx tsc --noEmit` + `npx vitest run` + `npm run check`（0 blocker）+ `npm run build`
- [ ] **Step 4: 设计文档记录**：§12 执行记录追加一行（M4 落地：游标桥/截图模块/storyboard 管线/门禁/一致性校验 + commit 哈希）
- [ ] **Step 5: Commit** `feat(M4): 集成收口（scaffold 接线 + 冒烟 + 设计文档记录）`

---

## 执行记录（2026-09-11 完成 · 终审 Ready to merge: Yes）

**提交**：`421c00b` 游标桥 / `56ba865` 截图模块 / `789d289` 截图模块评审硬化 / `a154e7d` storyboard 生成器 / `d14683a` storyboard 评审硬化 / `e29971f` 集成收口。387 测试全绿、check blocker 0、scaffold 冒烟 OK、终审独立复跑全部证据链（含篡改参考图负对照）。

**执行期偏离（对照本计划原文，均为改进方向）**：
1. 分镜截图 URL 实为 `?render=1&headless=1`（计划 Global Constraints 写"本计划不启动 render 模式"）——render 模式给干净帧（无播放控制条，Stage noUi）+ 创建即冻结；计数语义不受影响（冻结的注册动画仍计数），氛围豁免机制照常工作。
2. `--out` 默认锚在**模板根** `./storyboard/`（与"输出约定"一致，非相对 cwd）。

**Ruling 汇总**：M4-1（animations = WAAPI + registrySize，上界语义只判 `>0`）/ M4-2（氛围微动声明制豁免，入场动画零容忍）/ M4-3（chapterIds 必传，缺即 throw）。

**遗留（M5 前置项见设计文档 §12 "M5 遗留清单"）**：音频自驱抢游标（M5 首项）/ canvasAnim t=0 / dwell 运行时消费 / STORYBOARD_THEME 漂移护栏 / ShotSpec 时间维预决 / verify 负对照自动化 / 人审纪律成文。
其他 deferred minor：`assertChapterId` 非字符串隐式强转（TS 不可达）；manifest `define()` 未校验 id 字符集；`html.ts` 帧图 width/height 硬编码 16:9（3:4 项目占位跳变）；`shotPath("")` 根锚定；`withHeadless` 无协议 URL 裸 TypeError；5174 被占时错误指引不提示实际端口；verify-sequential 与 capture 的浏览器三段复刻（漂移面）。

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：§7 决策 1（静态先行 + storyboard.html + 时间机器同源）✓；决策 2（停留垫可调载体 timing.json + 动画词汇标注）✓；§11.3 M4 三件套（截图模块/分镜管线+门禁/一致性校验）✓；§8 相关的等待语义（fonts/images ready）与确定性（headless 模式）为 M5 预埋 ✓。**不在本计划**：M3b 无头门禁条目（#16-20，下一计划，复用本模块）、M5 渲染（逐帧 seek/ffmpeg/并行）、真实 TTS。
2. **Placeholder scan**：无 TBD；接口签名完整。
3. **Type consistency**：`PresentationBridge`（T1 → T2/M5）；`captureSteps/CaptureResult`（T2 → T3/M3b/M5）；`timing.json` 约定（T3 → M5 时间轴表消费）。
4. **已知取舍**：截图脚本要求 dev server 已运行（M5 编排器再自起）；`--verify-sequential` 用键盘事件模拟顺序推进（若 App 键盘监听在 headless 模式被禁用需补放开——实现者验证，必要时改用内部接口顺序推进）。
