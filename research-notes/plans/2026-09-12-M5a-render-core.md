# M5a 渲染管线·确定性渲染核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 `npm run render` 的第一条完整链路——**窗口预扫 → 时间轴表 → 逐 step 确定性帧流（seek 30fps + 静置单帧复用）→ ffmpeg 出带音轨的 mp4 → 产物自校验**，并落地 M5 遗留清单 #2/#3/#5。

**Architecture:** 五层：① **窗口预扫**（真机量每步动画窗口 → `animMsByStep`，全流程唯一源头）；② **时间轴表**（纯函数：manifest + durations + timing.json + 窗口表 → 每步 `[startMs, audioMs, animMs, dwellMs, stepMs, frameCount, holdMs]`）；③ **帧流**（`seek(t)` 逐帧 + 静置单帧复用 + 页级并行 + 捕捉期同源断言与泄漏告警）；④ **编码**（视频走 concat demuxer 图像清单；音频走**单次 `filter_complex` concat** 保证样本级对齐；`-shortest` mux）；⑤ **自校验**（落盘 PNG 数 + mp4 帧数/时长/帧率 + 跨会话同刻重采逐字节）。

**Tech Stack:** TypeScript / tsx / Playwright 1.58.2（已锁）/ ffmpeg + ffprobe（`/opt/homebrew/bin`）/ vitest + jsdom / 真浏览器 fixture。

> **【终审修复波 2026-09-12（M3）】版本实况**：计划期核的是 **ffmpeg 8.0.1**；后因 T7 的 scaffold 反引号事故（见 `task-7-report.md` §二 B2）本机被升到 **9.0.1_1**——**实测 8→9 产物逐字节不变**（成片 7.650000s / `nb_frames=229` / `r_frame_rate=30/1` 与四个重采帧 md5 全同），故本计划的全部 ffmpeg 实测结论在 9.x 下同样成立。

**Spec:** `../07-design-draft.md` §8（渲染管线）、§8.1（风险与结构性方案）、§3.1（三层时间模型）、§11.2（金样与截图环境）、§12 M5 遗留清单 #2/#3/#5；复用 M3b 的 `scripts/shot/session.ts`、`scripts/check/serve.ts`（`startServe`）、`script/check/headless.ts`（`withRenderMode`）。

**M5 拆分说明**：§11.3 的 M5 含六段，本计划交付**确定性渲染核心**（可独立验收）。**M5b**（另行成计划，本计划 T7 会落一个占位计划文件）：字幕烧录 + SRT、导出按钮的本地渲染服务、金样入库（须用户视觉确认）、双渲对比全 deck 化、**实时捕获降级**（§8 step 4 / §8.1 ④ 的兜底）、§12 #4（`STORYBOARD_THEME` 漂移护栏）、§12 #6（`--verify-sequential` 负对照自动化）。**本计划不做**：真实 TTS provider（用合成音轨替代，归 M6）、逐帧 seek 之外的动画过程检查。

## Global Constraints

- **音画同源是构造保证**（§8）：总时长 = Σ步长；**步长 = max(音频时长, 动画窗口) + 停留垫**；两轨由**同一张时间轴表**驱动——任何一侧自己算时长都是 bug，捕捉期必须断言 `captured.animMs === timeline.animMs`
- **帧数两条口径，不得混用**（实测结论）：
  - **落盘 PNG 数** = Σ `frameCount`（`frameCount = ceil(animMs × fps / 1000) + 1`，**乘法式**，不用 `1000/fps` 除法——浮点分叉）
  - **mp4 `nb_frames`** = `Math.round(totalMs / 1000 × fps)`（±1）——CFR 会把静置帧复制成多帧，二者**从来不相等**

  > **【执行期更正 2026-09-12】** 上面的 `+1` 是**静置帧**，它**只在 `holdMs > 0` 时存在** ⇒ 实况是
  > `frameCount = ceil(animMs × fps / 1000) + (holdMs > 0 ? 1 : 0)`（`holdMs === 0` = 动画窗口自己盖住整步 → 没有"窗口之后"可静置，见 [KNOWN-ISSUES](../KNOWN-ISSUES.md) **K-81**）。
  > 另：`TimelineStep.holdMs` 是**残差** = `max(0, stepMs − 窗口帧时长)`（Ruling **R1**），**不是编解码参数**（它只陈述"窗口之后还有多长"这个事实）。权威文本：`scripts/render/timeline.ts` 文件头模型段（`:12-27`）。
- **concat 清单末帧规则**（实测结论，防每步错位 1 帧）：末帧条目 `duration = max(0, holdMs/1000 − 1/fps)`，且**保留"末行重复末帧"**（concat demuxer 需要它才认末帧 duration）⇒ 每步精确 `frameCount` 帧、时长精确 `stepMs/1000`。`holdMs === 0` 时不发静置帧（`frameCount` = 窗口帧数）

  > **【执行期更正 2026-09-12（Ruling R3/R11；T5 实测推翻本条的公式与"每步重复末行"）】** 实况两条：
  > ① 末帧时长用**统一式** `max(0, stepMs/1000 − (frameCount−1)/fps)`——式里的 `stepMs` **必须是真的 stepMs**（T5 的 `buildVideoConcatList` 用 `stepMsByStep` 逐字传入，不得从 `frameCount/fps` 反推：`stepMs < 窗口帧时长`〔`dwell ≤ slack`〕时反推每步多 slack、**逐步累加**）；
  > ② **重复行只能有一条，且只能在清单最后一行**（中段重复行没有 duration ⇒ 后续包 `AV_NOPTS_VALUE`，实测步 2 起点漂到 5.68、成片 9.133333——计划的"每步重复末行"正是这么崩的）。计划式 `holdMs/1000 − 1/fps` **已废弃**（见 `timeline.ts:20-24`：它假设每步末尾都补一条重复行来还那 1/fps，而那条路走不通）。
  > 权威文本：`scripts/render/encode.ts` 文件头结论 1~5（R2 矩阵实测读数见 `task-5-report.md`）；`holdMs === 0` 的步见 **K-81**。
- **音频走单次 `filter_complex` concat**（不是分段编码后 concat——实测分段 `-c copy` concat 每步漂 ~7ms，30 步累计 ~210ms）：各步 `[i:a]apad,atrim=0:<stepMs/1000>` → `concat=n=N:v=0:a=1` → 一次 AAC 编码；无声步用 `anullsrc=r=48000:cl=stereo` 输入
- **mux 必须 `-shortest`**（实测 `-t` 夹不住：`-c copy -t` 仍溢出到 3.413333）
- **停留垫单一源头**：引擎默认 `DEFAULT_HOLD_MS` → 档案（`RuntimeConfig.holdMs?`）→ `timing.json` 每帧覆盖；解析器**只有一份**（`src/engine/hold.ts`，宽松不抛），分镜侧的 assert+throw 校验**另包一层**（storyboard 的 throw 契约不得丢）
- **`?render=1` 创建即冻结** + 截图前 `seek(0)` 归位（M5 遗留 #2 实测：`canvasAnim.seek` 每次都调 `draw`，未 seek 时 `.cdp-kenburns-inner` 的 transform 是 `none`）
- **软件渲染保像素稳定**（§11.2）：`SessionOptions.softwareGL?`（默认 **false**，不改既有管线行为）；渲染 CLI 传 true
- **3:4 档案**：viewport 取 `stageConfig.dims`（不是常量 1920×1080）；输出 `render/<slug>.mp4`（`slug = stageConfig.slug`）
- **`.gitignore` 写 `/render/`（前导斜杠锚定）**——裸 `render/` 会连 `scripts/render/` 源码树一起忽略（模板 `.gitignore:5` 已记录该坑）
- 门禁测试双护栏；纯函数（Node 可测）与真机 fixture 分层，与 M3b 一致

---

## 接口约定（跨计划冻结；M5b/M6 消费）

**1. 时间轴表（`scripts/render/timeline.ts`，纯函数）**
```ts
export const RENDER_FPS = 30;
export interface TimelineStep {
  chapter: number; step: number; chapterId: string;
  startMs: number; audioMs: number | null; animMs: number;
  dwellMs: number; stepMs: number; frameCount: number; holdMs: number;
}
export interface BuildTimelineInput {
  chapters: readonly { id: string; folder: string; steps: number; narrations: readonly string[] }[];
  durations: unknown;                                   // public/audio-durations.json 的解析结果
  timings: Record<string, TimingFile | undefined>;      // chapterId → timing.json
  animMsByStep: readonly (readonly number[])[];         // 窗口预扫产出（T2）
  profileHoldMs?: number;                               // 档案覆盖（RuntimeConfig.holdMs）
  fps?: number;                                         // 默认 RENDER_FPS
}
export interface Timeline { steps: TimelineStep[]; totalMs: number; fps: number }
export function buildTimeline(input: BuildTimelineInput): Timeline;         // 空 chapters → 空表
export function estimateMsFromNarration(narration: string): number;         // 与运行时同一条公式
```

**2. 桥 seek 面（`src/engine/cursorBridge.ts` 追加）**
```ts
seek(tMs: number): void;   // 追加的**必填**成员：seekAll(clamp) —— 渲染器唯一定位入口
                           // ⚠️ 会触及两处替身：src/engine/cursorBridge.test.ts 的 makeBridge()、
                           //    src/App.test.tsx 的 doMock 对象（已列入 T3 Files）
```
`scripts/shot/session.ts` 追加 `export async function seekTo(page: Page, tMs: number): Promise<void>;`

**3. 窗口预扫（`scripts/render/window-scan.ts`，T2）**
```ts
export interface WindowScanResult {
  animMsByStep: number[][];                              // [chapterIndex][step] → 动画窗口 ms
  frameCountByStep: number[][];                          // 同序：预扫时的注册表容量（诊断用）
}
export async function scanAnimationWindows(opts: {
  url: string; chapters: readonly { steps: number }[];
}): Promise<WindowScanResult>;
```

**4. 帧流（`scripts/render/frames.ts`，T4）**
```ts
export interface FrameSpec extends ShotSpec { chapterId: string }
export interface CapturedStep extends FrameSpec { dir: string; frameCount: number; animMs: number; holdMs: number }
export interface CaptureFramesOptions {
  url: string; outDir: string; timeline: Timeline;
  concurrency?: number;                     // 默认 2
  viewport?: { width: number; height: number };
  softwareGL?: boolean;                     // 默认 false
  only?: readonly number[];                 // 调试：只渲指定步（encode/verify 同步只处理这些步）
}
export async function captureFrames(specs: readonly FrameSpec[], opts: CaptureFramesOptions): Promise<CapturedStep[]>;
```
帧文件：`<outDir>/frames/<chapterId>/<step>/<%04d>.png`。

**5. 编码（`scripts/render/encode.ts`，T5）**
```ts
// 【执行期更正 2026-09-12（Ruling R11）】签名追加必传 `stepMsByStep`（与 captured 同序）：
// 末帧时长必须用**真 stepMs**（R3 原式 max(0, stepMs/1000 − (frameCount−1)/fps)）——
// 反推 `frameCount/fps` 在 `stepMs < 窗口帧时长`（即 dwell ≤ slack）时每步多出 slack、**逐步累加**（实测 3 步 +46.7/+70.0ms）。
// T7 传 `timeline.steps.map(s => s.stepMs)`。
export function buildVideoConcatList(
  captured: readonly CapturedStep[],
  fps: number,
  stepMsByStep: readonly number[],
): string;   // 纯函数
export function buildAudioFilterComplex(segments: readonly AudioSegment[], fps: number): { inputs: string[]; filter: string };
export interface AudioSegment { mp3: string | null; stepMs: number }
export async function encodeVideo(opts: EncodeOptions): Promise<EncodeResult>;   // 视频 + 音频 + mux
```

**6. 自校验（`scripts/render/verify.ts`，T6）**
```ts
export interface RenderVerifyReport { ok: boolean; lines: string[]; failures: string[] }
export function expectedPngTotal(timeline: Timeline): number;                             // Σ frameCount（空表 → throw）
export function expectedMp4Frames(timeline: Timeline, fps: number): number;               // round(totalMs×fps/1000)
export function checkProbe(probe: FfprobeSummary, timeline: Timeline, fps: number): string[];
export async function verifyRender(opts: VerifyOptions): Promise<RenderVerifyReport>;
// 【执行期更正 2026-09-12（T6 落地）】`VerifyOptions` 比本约定多一个**必传**字段：
//   segments: readonly AudioSegment[]   // 与 captured 同序同长，且 segments[i].stepMs 必须 === timeline.steps[i].stepMs
// 理由：边界断言要拿"时间轴步边界"当基准，而音轨段是它的载体；长度/数值不符即 throw（宁炸不静默）。
// 另两条 T7 接线约束（verify.ts 文件头亦已写明）：
//   ① viewport / softwareGL 必须与 captureFrames 那次**相同**；② `--only` 传**子时间轴**（verify 不裁剪）。
```

---

### Task 1: 时间轴表 + 停留垫单一源头（M5 遗留 #3）

**Files:**
- Create: `scripts/render/timeline.ts` + `scripts/render/timeline.test.ts`
- Create: `src/engine/hold.ts` + `src/engine/hold.test.ts`（**引擎侧唯一解析器**，宽松不抛）
- Modify: `scripts/storyboard/data.ts`（导出 `normalizeTiming`；`readDwellMs` 改为**薄校验包装**：调 `src/engine/hold.ts` 的解析器，非法值仍 throw——`storyboard.test.ts:188` 的契约不得丢）
- Modify: `src/chapters/manifest.ts`（`ChapterDef` 增 `timing?: TimingFile`）+ `src/chapters/01-example/index.tsx`（静态 `import timing from "./timing.json"` 挂到章节声明）
- Modify: `src/App.tsx`（`playStep` 的 hold 改为解析后的值，不再硬传 `DEFAULT_HOLD_MS`）
- Modify: `src/engine/runtime-config.ts`（`RuntimeConfig` 增可选 `holdMs?: number`——档案层的生产者）
- Test: `src/App.test.tsx`（+1：`timing.json` 的 dwell 覆盖进 `playStep` 的 `holdMs`）

**Interfaces:** 见"接口约定 1"；Consumes `src/engine/constants.ts`（`DEFAULT_HOLD_MS` / `EMPTY_NARRATION_MIN_MS` / `AUDIO_ESTIMATE_*`）

- [ ] **Step 1: 写失败测试**
```ts
it("步长 = max(音频, 动画窗口) + 垫；无音频步用与运行时同一条估时公式", () => {
  // 合成章节（**不要**用真 example——它的 timing.json 有 dwell{"1":600}，会打乱期望）
  const tl = buildTimeline({
    chapters: [{ id: "s", folder: "01-s", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] }],
    durations: null, timings: {},
    animMsByStep: [[3000, 0, 0]],
  });
  expect(tl.steps.map((s) => s.stepMs)).toEqual([3400, 2150, 1900]);   // max(1750,3000)+400 / 1750+400 / 1500+400
  expect(tl.totalMs).toBe(7450);
});
it("帧数用乘法式且 holdMs=0 时不发静置帧", () => {
  // animMs=3000 → ceil(3000*30/1000)+1 = 91；animMs=0 → 1（纯静置）；
  // 构造 holdMs=0 的步（animMs ≥ stepMs−垫）→ frameCount == ceil(animMs*30/1000)
  expect(tl.steps[0].frameCount).toBe(91);
  expect(tl.steps[0].holdMs).toBe(400);
});
it("dwell 三级优先级：timing.json > 档案 > 引擎默认（引擎侧宽松：非法值退回默认，不抛）", () => {
  expect(resolveHoldMs({ dwell: { "1": 600 } }, 1)).toBe(600);
  expect(resolveHoldMs({ dwell: { "1": 600 } }, 0)).toBe(400);
  expect(resolveHoldMs(undefined, 0, 250)).toBe(250);
  expect(resolveHoldMs({ dwell: { "0": -5 } }, 0)).toBe(400);   // 宽松：非法退回默认（预览不白屏）
});
it("非空护栏：空 chapters → 空表（不抛）", () => {
  expect(buildTimeline({ chapters: [], durations: null, timings: {}, animMsByStep: [] }).steps).toEqual([]);
});
```
- [ ] **Step 2: RED**（`npx vitest run scripts/render/timeline.test.ts src/engine/hold.test.ts`）
- [ ] **Step 3: 实现**：`src/engine/hold.ts` 的 `resolveHoldMs(chapterTiming, step, profileHoldMs?)` 三级解析（宽松）；`scripts/storyboard/data.ts` 的 `readDwellMs` 改为调它 + 自己保留 assert/throw（分工写进两侧文件头注释）；`scripts/render/timeline.ts` import 引擎侧解析器（**方向：scripts → src/engine**，仓库既有惯例）；`buildTimeline` 逐章逐 step 算全部字段（`startMs` 前缀和）。App 侧：`chapter.timing` + `stageConfig.holdMs` → `resolveHoldMs` → 传给 `playStep`。
- [ ] **Step 4: GREEN** + `npx vitest run`（全量）+ `npx tsc --noEmit`
- [ ] **Step 5: 反证**：把 `resolveHoldMs` 的优先级倒过来 → Step 1 第三条变红；把 `readDwellMs` 的 throw 去掉 → `scripts/storyboard.test.ts` 变红。两条都贴输出后还原
- [ ] **Step 6: Commit** `feat(M5a): 时间轴表 + 停留垫单一源头（引擎侧唯一解析器，预览与渲染同源）`

---

### Task 2: 窗口预扫（`animMsByStep` 的唯一生产者）

**Files:**
- Create: `scripts/render/window-scan.ts` + `scripts/render/window-scan.test.ts`（纯函数部分）+ `window-scan.browser.test.ts`（真机）
- Test: `scripts/render/window-scan.browser.test.ts`

**Interfaces:** 见"接口约定 3"；Consumes `openSession` / `jumpToStep` / `readyWithTimeout` / `auditAnimations`（`scripts/shot/session.ts` 全部已导出）

- [ ] **Step 1: 写失败测试**
```ts
it("纯函数：窗口表形状与 chapters 对位（非空护栏：0 章 → throw）", () => { /* flattenWindowScan([[[3000,0,0]]], [{steps:3}]) 校验长度 */ });
// window-scan.browser.test.ts（真 Chromium）
it("真机：example 三步 → animMsByStep === [[3000, 0, 0]]（KenBurns fast×10，与 M3b 实测一致）", async () => {});
```
- [ ] **Step 2: RED → Step 3: 实现**：`openSession` → 开场 `jumpTo(0,0)`+ready → 逐 step `jumpToStep` → `readyWithTimeout` → `auditAnimations(page).windowMs` → 汇总。**这是全流程唯一的窗口采集点**（`headless.ts` 里的同名逻辑内联在 `runHeadlessPass`，不可复用——本任务自建，并在 T4 断言两处一致）
- [ ] **Step 4: GREEN** + 真机取证（贴 example 的读数）
- [ ] **Step 5: Commit** `feat(M5a): 窗口预扫（动画窗口的唯一生产者）`

---

### Task 3: 桥 seek 面 + 渲染态 t=0 归位（M5 遗留 #2 / #5）

**Files:**
- Modify: `src/engine/cursorBridge.ts`（追加 `seek`）、`src/App.tsx`（桥安装对象补 `seek`）
- Modify: `scripts/shot/session.ts`（追加 `seekTo`）
- Modify: `src/engine/cursorBridge.test.ts:53` 的 `makeBridge()`、`src/App.test.tsx` 的 doMock 对象（**替身必须同步**）
- Test: `scripts/shot/session.test.ts`（+1）

**Interfaces:** 见"接口约定 2"

- [ ] **Step 1: 写失败测试**
```ts
it("seek 透传 seekAll 且负数归零", () => { /* spy seekAll：seek(-5) → 以 0 调用 */ });
it("桥成员集合 ⊇ {jumpTo,getState,ready,animations,audit,seek}，前五者引用未变", async () => {});
```
- [ ] **Step 2: RED → Step 3: 实现**（`seek: (tMs) => seekAll(Math.max(0, tMs))`；`seekTo` 用 `page.evaluate`）
- [ ] **Step 4: GREEN** + 全量
- [ ] **Step 5: 真机取证（判据元素已由实测更正）**：`?render=1&headless=1` + `jumpTo(0,0)` → `ready()` → 读 **`.cdp-kenburns-inner`**（**不是** `.cdp-kenburns-placeholder`——transform 写在 inner 上，读外层恒 `none` 会假红）的 `transform`：未 seek 应为 `none`；经**同页模块实例**调 `seek(0)` → 期望 `matrix(1,0,0,1,-34.56,0)`；`seek(1500)` → `matrix(1.06,0,0,1.06,0,0)`；`seek(3000)` → `matrix(1.12,0,0,1.12,38.7072,0)`（贴三次读数）。**注意 vite dev 的模块 URL 带 HMR 时间戳**：裸路径 dynamic import 是另一个实例（假阴性），须按 resource timing 取真实 URL
- [ ] **Step 6: Commit** `feat(M5a): 桥 seek 面（渲染态 t=0 归位）`

---

### Task 4: 帧流捕捉（窗口逐帧 + 静置复用 + 页级并行 + 同源断言）

**Files:**
- Create: `scripts/render/frames.ts` + `frames.test.ts`（纯函数）+ `frames.browser.test.ts`（真机）

**Interfaces:** 见"接口约定 4"

- [ ] **Step 1: 写失败测试**
```ts
it("纯函数：帧路径清单与计数一致（非空护栏）", () => { /* framePaths(dir, 91).length === 91，首 0001 末 0091 */ });
it("纯函数：partition(specs, 3) 覆盖全部步且不重叠", () => {});
// frames.browser.test.ts（真 Chromium）
it("真机：三步 deck 的帧目录帧数 == timeline.frameCount，且 captured.animMs === timeline.animMs（同源断言）", async () => {});
it("真机确定性（强判据）：跨独立会话、同一 t 两拍逐字节一致；且 t=0 与 t=1500 的帧必须不同（负样本——动画没画就会假绿）", async () => {});
```
- [ ] **Step 2: RED → Step 3: 实现**：**每 worker 一个 `openSession`**（= 每 worker 一个浏览器进程，资源开销接受；`openSession` 内部 `chromium.launch` 无法共享，措辞以此为准）；worker 循环取步：`jumpToStep` → `readyWithTimeout` → `assertCursorMatch` → `seekTo(0)` → 窗口帧 `for k in 0..windowFrames-1: seek(k*1000/fps)` + `screenshot` → `holdMs > 0` 时 `seek(animMs)` 再截 1 帧 → **`auditAnimations` 泄漏告警**（`unowned > 0` 或 render 下 `running > 0` → 该步记 warning 并列出 hints——纯章节层泄漏动画的步会 `windowMs=0`，成片冻住而自校验全绿，故必须在此处可见）→ `assertCursorStill`。worker 失败即整轮失败。
- [ ] **Step 4: GREEN** + 真机：example 三步渲帧 → 贴目录树 / 帧数 / 两拍 md5 对照
- [ ] **Step 5: Commit** `feat(M5a): 帧流捕捉（seek 逐帧 + 静置复用 + 并行 + 同源/泄漏断言）`

---

### Task 5: 合成音轨 + ffmpeg 编码出 mp4

**Files:**
- Create: `scripts/render/audio.ts`（`synthesizeMockAudio`：lavfi 正弦/静音 → `<repoRoot>/public/audio/<folder>/<step>.mp3` + `public/audio-durations.json`；**负责 mkdir**，与 App 的 `/audio/<folder>/<step>.mp3` 约定一致）
- Create: `scripts/render/encode.ts` + `encode.test.ts`（纯函数）+ `encode.browser.test.ts`（真机出片）

**Interfaces:** 见"接口约定 5"

- [ ] **Step 1: 写失败测试（纯函数）**
> **【终审修复波 2026-09-12】** 下面这段代码块是**执行前**的测试草稿（保留原样，不逐条回写）：其中的末帧公式与"每步重复末行"两条已被 T5 实测推翻（见上文 Global Constraints 的【执行期更正】）。实况测试在 `scripts/render/encode.test.ts`，判据口径以 `encode.ts` 文件头结论 1~5 为准。
```ts
it("视频清单：每步 frameCount 条 + 末帧 duration = max(0, holdMs/1000 − 1/fps) + 保留末行重复（防每步多 1 帧）", () => {
  const list = buildVideoConcatList([{ dir: "frames/example/0", frameCount: 3, holdMs: 400, animMs: 3000, ... }], 30, [3400]);
  expect(list).toContain("duration 0.366667");                       // 0.4 − 1/30
  expect(list.trimEnd().split("\n").pop()).toBe("file 'frames/example/0/0003.png'");   // 末行重复
});
it("holdMs=0 的步不发静置帧（frameCount 已扣）", () => {});
it("音频 filter_complex：有声步 apad+atrim 到步长；无声步用 anullsrc 输入（非空护栏：空段列表 → throw）", () => {
  const { inputs, filter } = buildAudioFilterComplex([{ mp3: "a.mp3", stepMs: 3400 }, { mp3: null, stepMs: 1900 }], 30);
  expect(inputs.length).toBe(2);
  expect(filter).toContain("apad");
  expect(filter).toContain("anullsrc");
  expect(filter).toContain("concat=n=2:v=0:a=1");
});
```
- [ ] **Step 2: RED → Step 3: 实现**：视频 `-f concat -safe 0 -i <清单> -fps_mode cfr -r 30 -c:v libx264 -pix_fmt yuv420p`（**清单落在 `<outDir>/` 根**——相对路径按清单文件所在目录解析，实测踩过）；音频单次 `filter_complex`（`apad,atrim=0:<秒>` → `concat` → `-c:a aac -ar 48000 -ac 2`）；mux `-c:v copy -c:a copy -shortest`；ffmpeg/ffprobe 缺失 → 抛含 `brew install ffmpeg` 指引的错误
- [ ] **Step 4: GREEN** + 真机：mock 音轨 → 三步 deck 出 `render/<slug>.mp4` → 贴 `ffprobe` 读数（`duration` / `nb_frames` / `r_frame_rate`）与**期望值逐条对照**
- [ ] **Step 5: Commit** `feat(M5a): 合成音轨 + ffmpeg 编码（concat cfr 帧清单 + filter_complex 音轨 + -shortest mux）`

---

### Task 6: 产物自校验

**Files:**
- Create: `scripts/render/verify.ts` + `verify.test.ts` + `verify.browser.test.ts`

**Interfaces:** 见"接口约定 6"

- [ ] **Step 1: 写失败测试**
```ts
it("两条口径分开：PNG 总数 = Σ frameCount；mp4 帧数 = round(totalMs×fps/1000)", () => {
  expect(expectedPngTotal(tl)).toBe(93);            // 91+1+1
  expect(expectedMp4Frames(tl, 30)).toBe(224);      // round(7450×30/1000)=223.5 → 224（±1 容差）
});
it("checkProbe：时长差 / 帧数差 / 帧率错 → 逐条失败项（非空护栏：空 timeline → throw）", () => {});
```
- [ ] **Step 2: RED → Step 3: 实现**：`ffprobe -v error -show_entries format=duration:stream=nb_frames,r_frame_rate -of json`；时长容差 ±1 帧（33.3ms）**且**覆盖实测的 AAC 帧对齐（21.3ms）——取 `max(1/fps, 0.022)` 秒；帧率必须 `30/1`；**跨会话同刻重采**：采样 `min(3, 步数)` 个步（**必须含首末步**）→ 独立 `openSession` → `jumpTo+seek(k/fps)` 截帧 → 与产物帧目录同帧 md5 逐字节比对
- [ ] **Step 4: GREEN** + 真机：对 T5 产物跑一次 → 全绿读数贴报告
- [ ] **Step 5: 反证**：篡改帧目录一张 PNG（1 字节）→ 必须红；篡改 mp4 的时长（重编码加 0.5s）→ 时长项必须红。两条都贴输出后还原
- [ ] **Step 6: Commit** `feat(M5a): 渲染产物自校验（PNG 数/mp4 帧数时长帧率/跨会话同刻逐字节）`

---

### Task 7: `npm run render` CLI + 收口

**Files:**
- Create: `scripts/render.ts`（CLI 编排）
- Create: `research-notes/plans/2026-09-12-M5b-subtitles-export-service.md`（**占位计划**：列名 M5b 的任务清单与归属——防 §8.1 ④ 与 §12 #4/#6 的兜底项在交接中蒸发）
- Modify: `package.json`（`"render": "tsx scripts/render.ts"`，替换占位 echo）
- Modify: `.gitignore`（**`/render/`**，前导斜杠）
- Modify: `narration-video/scripts/scaffold.sh`（清理行补 `rm -rf "$TARGET/render"`；指引段把"渲染导出（M5 实现中，当前占位）"改成真实指引 + ffmpeg 前置）、`scaffold-smoke.sh`（`test ! -e "$TMP/demo/render"` + `grep '"render": "tsx scripts/render.ts"'`）
- Modify: `research-notes/07-design-draft.md`（§12 追加 M5a 行；M5 遗留 #2/#3/#5 标已落地）、`research-notes/KNOWN-ISSUES.md`（新增条目）

**Interfaces:** 消费全部前序产物

- [ ] **Step 1: 写失败测试**（CLI 参数解析纯函数：未知 flag → exit 2 + 用法；`--concurrency 0` → 归 1；`--only` 与 timeline/encode/verify 的联动——`--only` 下自校验**只校验被渲的步**，不得拿全表比对）
- [ ] **Step 2: RED → Step 3: 实现**，编排顺序**必须**是：
  `[--mock-audio → 音轨 + durations] → 窗口预扫 → buildTimeline → captureFrames → encode → verify`
  - **自起 Vite**：复用 `scripts/check/serve.ts` 的 `startServe()`（M3b 已交付，含"默认永不复用外部服务/端口占用自动 +1"），URL 用 `withRenderMode`（`scripts/check/headless.ts` 已导出）+ `withHeadless`
  - **loader-hooks 必挂**：CLI 顶部 `import "./check/loader-hooks";`（模块副作用——非 vitest 环境下 manifest 的 React/CSS 链否则必崩；`scripts/storyboard.ts:26` 是先例），随后 `await import("../src/chapters/manifest")`
  - viewport 取 `stageConfig.dims`；`softwareGL: true`（渲染 CLI 专属）
  - 无音频 deck：打印"未合成音频，按估时出片（无声）"（不是静默）
  - 每步进度一行：`[render] 章节 example 第 0 步 · 91 帧 · 3400ms`
- [ ] **Step 4: 全量收口**：`npx vitest run` + `npx tsc --noEmit` + `npm run check`（blocker 0）+ `npm run build` + 真机 `npm run render -- --mock-audio` 出一条 mp4 + `bash narration-video/scripts/scaffold-smoke.sh`
- [ ] **Step 5: 确定性终验**：`--verify-determinism` 重采采样步并与首渲逐字节比对（**含"两个不同 t 必须不同"的负样本**）
- [ ] **Step 6: 文档记录**（先落盘再删工作区）：
  - §12 追加 M5a 行（含 commit）；M5 遗留 #2/#3/#5 标已落地（#1 已由 M3b 落地；#4/#6 归 M5b，在 M5b 占位计划里点名）
  - KNOWN-ISSUES 新增：① 动画窗口是**声明面上界**（真实播放时长待 M5b 双渲对比）② 无音频 deck 按估时出片（无声，CLI 明示）③ `render/` 产物不入库 ④ **实时捕获降级未实现**（§8.1 ④ 的兜底，归 M5b）⑤ `softwareGL` 默认 false——仅渲染 CLI 开启，storyboard/capture 管线未开（跨机像素稳定性只对成片负责）⑥ `holdMs=0` 的步不发静置帧 ⑦ M5b 占位计划文件的位置
- [ ] **Step 7: Commit** `feat(M5a): npm run render 全链打通（预扫→时间轴→帧流→编码→自校验）+ 收口`

---

## 执行环境注意

- ffmpeg 8.0.1 / ffprobe 在 `/opt/homebrew/bin`（已核）；缺失时错误文案含 `brew install ffmpeg`
- **帧体量按公式估**：`frameCount = ceil(animMs×30/1000)+1` —— example step 0（KenBurns fast×10 = 3000ms）是 **91 帧/步**；1080p PNG 每步约 30–80MB（x264 编码单步实测 ~1.1s，不是瓶颈）
  - **【执行期更正 2026-09-12】** 该式同为**执行前**文本：`+1` 是静置帧，`holdMs === 0` 的步没有它（K-81）；本例 91 = 90 窗口帧 + 1 静置帧，恰好不触发那条边界。实况见 `timeline.ts` 文件头模型段。
- `--concurrency` 默认 2；本机负载常高（load 14 常见），每 worker 是一个独立浏览器进程
- **本计划不做**：字幕/SRT、导出服务、金样、实时捕获降级、真实 TTS（见"M5 拆分说明"）

## 自检记录（writing-plans Self-Review · v2）

1. **Spec coverage**：§8 步骤 1（时间轴表 → T1）/ 步骤 2（逐 step seek 帧流 → T3+T4；**动画覆盖率断言 → T4 的 `auditAnimations` 泄漏告警**）/ 步骤 3（ffmpeg concat + 混音 → T5）/ 步骤 4（自校验 → T6）✓；§8.1 的"静置期单帧复用"（T4）/ "step 级并行"（T4）/ "渲染产物自校验"（T6）/ "总时长 = Σ步长"（T1+T5+T6）✓；§11.2 的软件渲染（`softwareGL`）✓；§12 M5 遗留 #2（T3）、#3（T1）、#5（T3）✓。**不在本计划**（M5b 占位计划点名）：字幕/SRT、导出服务、金样、实时捕获降级、§12 #4/#6、真实 TTS。
2. **两轮独立质检的修订**：v1 → v2 采纳 9 条 Critical（C1 动画窗口无生产者 → T2；C2 帧数口径冲突 → 约束两条口径；C3 私有函数+第二份解析 → T1 的引擎侧唯一解析器；C4 运行时无数据通路 → `ChapterDef.timing`；C5 `.gitignore` 裸路径 → `/render/`；C2#2 末帧多 1 帧 → 末帧 `duration − 1/fps`；C3#2 animMs 双源 → T2 唯一生产者 + T4 同源断言；C4#2 取证元素读错 → `.cdp-kenburns-inner` + 实测期望值）与 16 条 Important（自起 Vite / loader-hooks / viewport 与 slug / #5 形态与替身同步 / 覆盖率断言 / 档案层生产者 / `--mock-audio` 顺序 / `public/` 落点 / softwareGL / 抽帧比对对象与负样本 / filter_complex 音频 / `-shortest` / 并行措辞 / dwell 宽松 vs throw 分工 / 无音频明示 / parse 测试用合成章节）。
3. **Placeholder scan**：无 TBD；接口全部给签名；命令行给确切 flags；无"类似 Task N"。
4. **Type consistency**：`TimelineStep`/`Timeline`（T1 → T4/T5/T6）、`WindowScanResult`（T2 → T7）、`seek`/`seekTo`（T3 → T4）、`CapturedStep`（T4 → T5/T6）、`AudioSegment`（T5 内）、`expectedPngTotal`/`expectedMp4Frames`（T6 → T7）、`RENDER_FPS`（T1 定义，T4/T5/T6 共用）。
5. **已知取舍**：① 动画窗口取**声明面**（注册表上界）而非实测播放时长——真实播放时长由 M5b 的双渲对比兜底（约束与 KNOWN-ISSUES 双向登记）；② 合成音轨用 lavfi（长度精确、零依赖），真实 TTS 归 M6；③ 抽帧比对取 `min(3, 步数)` 个采样步（**必须含首末步**）；④ 每 worker 一个浏览器进程（`openSession` 无法共享 launch）——资源换简单，`concurrency` 默认压到 2。
