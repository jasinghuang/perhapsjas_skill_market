# M3b 无头门禁（check 全量 20 项）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `npm run check` 从"静态 15 项"补齐为"全量 20 项"——新增无头 pass（#16 seek pass / #17 动画窗口 vs 音频 / #18 对比度 / #20 文字安全边距 / #14 字体加载的**已加载**读法）+ #19 音频节奏（数据检查），并收掉 KNOWN-ISSUES 盘账转入的 K-10/11/12/21 与 M5 遗留首项（音频自驱抢游标）。

**Architecture:** 四层：① **前置收紧**——scanner-css 行级预处理改**声明级状态机**（根除跨行值漏检与字符串内 `/*` 的注释态泄漏），scanner-tsx 拆豁免旗标；② **复用层**——`scripts/shot/session.ts` 会话模块（M4 三段复刻收敛）+ `src/engine/safe-area.ts` 安全框单一源 + 桥新增 `audit()` 动画审计面；③ **无头 pass**——`scripts/check/headless.ts` 走 `?render=1&headless=1` 逐 step 定位，**DOM 侧收集器以源码字符串为载体**（绕开 tsx 的 `__name` 注入，见 Global Constraints）产出结构化 findings；④ **入口**——`npm run check` = fast + 无头（进程内自起 Vite），blocker 不过 = exit 非零。

**Tech Stack:** TypeScript / tsx / Playwright（1.58.2 已锁）/ Vite 5 dev server（进程内 API）/ vitest + jsdom / 真浏览器 fixture（`page.setContent`）。

**Spec:** `../07-design-draft.md` §11.1（#16-20 与 #4/#14 无头半边）、§11.2（门禁负样本测试）、§12b V1（安全框）、§12 M5 遗留清单第 1 项；`../KNOWN-ISSUES.md` §1（K-10/11/12/21）。

## Global Constraints

- **门禁测试双护栏（M2a2 起强制）**：每个新检查/收集器的测试必须含【故意违规负样本】+【非空护栏】——"检查的检查"，防门禁自身漂移
- **收集器一律以源码字符串为载体（本计划的硬约束，不是风格偏好）**：
  `export const COLLECT_X_SRC = String.raw\`function (args) { … }\``，调用侧 `page.evaluate(\`(${SRC})(${JSON.stringify(args)})\`)`。理由（独立质检实测）：tsx 用 esbuild 且**硬编码 `keepNames: true`**（`node_modules/tsx/dist/*.mjs`，CLI 无开关可关），函数体内的**具名函数表达式 / 赋给 const 的箭头**会被改写成 `__name(…)`；函数源码序列化进浏览器后没有 `__name` → **`ReferenceError`，`npm run check` 在真机必崩**。而 **vitest 不做 keepNames**，单测全绿也发现不了——这是"测试通过、交付件必崩"的陷阱。
  推论：源码串内**不得出现反引号与 `${`**（避免 `String.raw` 模板被截断）；Node 侧用 `new Function(\`return (${SRC})\`)()` 取同一份实现做单测（两侧跑同一文本）；纯判据（比值/越界/差集）仍抽成普通 TS 函数，两侧共用
- **失败方向**：blocker 不过 = exit 非零；warning 须在汇报时逐条说明理由或修复计划（§11.1）
- **确定性优先**：无头 pass 一律 `?render=1&headless=1`（创建即冻结 + 干净帧）；**v1 不覆盖"动画播放期才出现的 console error"**（记 KNOWN-ISSUES，归 M5 帧流）
- **不改冻结契约**：`PresentationBridge` 四方法逐字不动（`audit()` 为追加成员，M4-3 同款）；`CaptureOptions`/`CaptureResult`/`shotPath`/`withHeadless` 等公开面经 `export … from "./session"` 再导出保持向后兼容（**类型必须 `export type`**——tsconfig 未开 `isolatedModules`，tsc 不报而 esbuild 运行期炸链接）
- **数字单一源**：安全框数字只允许存在一处（`safe-area.ts`）；showcase 参考线、无头检查、scaffold 全部派生
- **非空护栏唯一定级**：`examined === 0` 在**收集器级**（全 deck 累计）→ blocker（收集器失效）；**步级**零元素合法（该步没这类元素）；#14 的"没有主题字体文本"→ info（见 Task 8）
- Warning 级检查一律**带量化数字**（溢出 px / 对比度比 / 时长差 ms）
- 本计划**不做**：逐帧 seek 的过程检查、#1 的 step 使用上界无头半边、真实 TTS、3:4 档案数值定稿（见任务内显式待定）

---

## 接口约定（跨计划冻结）

**1. 会话模块（`scripts/shot/session.ts`，Task 3 产出，M5 复用）**
```ts
export interface SessionOptions {
  url: string;                                    // 基址；headless 参数由 openSession 归一（幂等）
  viewport?: { width: number; height: number };    // 默认 DEFAULT_VIEWPORT
  deviceScaleFactor?: number;                      // 默认 1（"精确 1080p"契约）
}
export interface Session { page: Page; close(): Promise<void>; }   // close = 关浏览器（context/browser 一并）
export async function openSession(opts: SessionOptions): Promise<Session>;

// 迁移面（**逐字搬移**，capture.ts 再导出保持向后兼容）：
//   ShotSpec / DEFAULT_VIEWPORT / READY_TIMEOUT_MS / CHROMIUM_INSTALL_HINT / expandSpecs /
//   shotPath（含 CHAPTER_ID_RE / assertChapterId / assertCursor）/
//   assertCursorMatch / assertCursorStill / withHeadless / isMissingBrowserError /
//   chromiumMissingError / readyWithTimeout
// 新增（原 capture.ts 的**内联**逻辑外提，非既有导出）：jumpToStep / readCursor / readAnimations
export async function jumpToStep(page: Page, spec: ShotSpec): Promise<void>;
export async function readCursor(page: Page): Promise<{ chapter: number; step: number }>;
export async function readAnimations(page: Page): Promise<number>;
export async function auditAnimations(page: Page): Promise<AnimationAudit>;   // Task 5 产出
```
**依赖方向单向**：`capture.ts → session.ts`、`verify-sequential.ts → session.ts`；**session 不 import capture**（否则成环）。

**2. 动画审计面（`cursorBridge.ts` 追加 + `animationRuntime.ts` 打标，Task 5 产出）**
```ts
export interface AnimationAudit {
  waapi: number;          // document.getAnimations() 计数
  owned: number;          // 其中引擎 waapi 适配器创建（打标）的数量
  unowned: number;        // waapi − owned（章节层手写 animate / 组件 CSS 动画泄漏面）
  unownedRunning: number; // 上者中 playState === "running"（render 模式应为 0）
  unownedHints: string[]; // 泄漏定位（animationName 或 effect.target 选择器），至多 5 条
  registry: number;       // 引擎注册表容量（canvasAnim 等帧函数动画在内）
  windowMs: number;       // 注册表声明时长最大值 = 动画窗口（§8）
  running: number;        // 全部 WAAPI 中 playState === "running" 的数量（render 模式应恒 0）
}
```

**3. 无头 pass（`scripts/check/headless.ts`，Task 7 产出）**
```ts
export interface HeadlessOptions {
  url?: string;                    // 显式指定才复用外部服务；缺省=进程内自起（见 Task 7 Step 3）
  chapters: readonly ChapterDef[];
  repoRoot: string;
  only?: readonly number[];        // 只跑指定章节（调试；会改变跨步累积量，见 Task 8 #14）
}
export async function runHeadlessPass(opts: HeadlessOptions): Promise<FindingBag>;
```

**4. FindingBag 追加面（`findings.ts`，Task 7 产出）**
```ts
addAll(findings: readonly Finding[]): void;   // 顺序追加；空数组不改变任何结果
merge(other: FindingBag): void;               // 追加 other 的全部 findings（同类内私有数组互访）
render(title = "静态门禁报告"): string;        // 追加可选标题参（默认值不变；空袋分支同样带标题）
```

**5. 数据检查（`scripts/check/tempo.ts`，Task 9 产出；与分镜同源）**
```ts
// 从 scripts/storyboard/data.ts **外提并导出**：现网私有函数 resolveAudioMs(chapters, durations, warnings)，
// 名称/参数/warnings 出参**逐字保留**（data.ts 调用点不动；warnings 是分镜页依赖，丢了会打红 storyboard.test.ts）
export function resolveAudioMs(
  chapters: readonly { id: string; folder: string; steps: number; narrations: readonly string[] }[],
  durations: AudioDurations | null,
  warnings: string[],
): Array<Array<number | null>>;
export function checkAudioTempo(chapters, audioByChapter, opts: { minSegmentMs: number }): Finding[];
export function checkAnimationWindow(frames, windowByFrame, audioByChapter): Finding[];
```

**6. 收集器源码串契约**
```ts
// scripts/check/collectors.ts
export const COLLECT_OVERFLOW_SRC: string;      // function (args) → { findings, examined }
export const COLLECT_SAFE_MARGINS_SRC: string;
export const COLLECT_CONTRAST_SRC: string;
export const COLLECT_FONTS_SRC: string;
// Node 侧取实现（单测用，与浏览器侧同一文本）：
export function fromSrc<T>(src: string): T;     // new Function(`return (${src})`)()
// 纯判据（Node/浏览器共用，普通 TS 函数）：
export function contrastRatio(fg: Rgb, bg: Rgb): number;
export function outOfBandPx(rect: Rect, band: Band): { left: number; right: number; top: number; bottom: number };
export function diffFamilies(loaded: readonly string[], used: readonly string[]): string[];
```

---

### Task 1: scanner-css 声明级状态机（K-10 跨行值 + K-12 字符串内 `/*`）

**Files:**
- Modify: `scripts/check/scanner-css.ts`（预处理管线重写：行级 `stripCommentLine` → 声明级 `tokenizeCss`）
- Test: `scripts/check/scanner-css.test.ts`（新增 5 用例 + 既有全绿）
- Test: `scripts/check/__fixtures__/`（**新增真实夹具**——见 Step 4，模板 `src/chapters/` 下**没有任何 `.css`**，拿模板当"防误伤实证"是空转，独立质检已证）

**Interfaces:**
- Produces: `export interface CssDeclaration { text: string; line: number }`、`export function tokenizeCss(css: string): CssDeclaration[]`
- 消费面不变：`scanChapterCss(cssFiles)` 签名与 Finding 输出规则名/severity/message 逐字不动

- [ ] **Step 1: 写失败测试**

```ts
it("跨行声明值：续行的裸色不逃逸（K-10）", () => {
  const css = `.cdp-x {\n  box-shadow:\n    4px 4px 0 rgba(0, 0, 0, 0.2);\n}`;
  const f = scanChapterCss([{ path: "a.css", css }]);
  // 归属 = 声明起始行（stylelint 同款）：违规值在第 3 行，报告落在第 2 行
  expect(f.some((x) => x.rule === "禁硬编码色" && x.location === "a.css:2")).toBe(true);
});

it("字符串内的 /* 不置注释态：后续声明照常检查（K-12）", () => {
  const css = `.cdp-x {\n  content: "/*";\n  color: #ff0000;\n}`;
  const f = scanChapterCss([{ path: "a.css", css }]);
  expect(f.some((x) => x.rule === "禁硬编码色" && x.location === "a.css:3")).toBe(true);
});

it("注释内的裸色仍不误报", () => {
  const css = `/* box-shadow: 0 0 0 rgba(0,0,0,.2); */\n.cdp-x { color: var(--ink); }`;
  expect(scanChapterCss([{ path: "a.css", css }])).toEqual([]);
});

it("选择器/规则头不参与色值判定（假阳性钉死——pink/orange/purple/gold 都在命名色表内）", () => {
  expect(scanChapterCss([{ path: "a.css", css: `.purple-card { color: var(--text); }` }])).toEqual([]);
  expect(scanChapterCss([{ path: "a.css", css: `.pink-card { background: var(--surface); }` }])).toEqual([]);
  expect(scanChapterCss([{ path: "a.css", css: `.orange-bar { color: var(--ink); }` }])).toEqual([]);
  expect(scanChapterCss([{ path: "a.css", css: `#gold { color: var(--ink); }` }])).toEqual([]);
});

it("tokenizeCss 非空护栏：空输入产出空数组（不抛）", () => {
  expect(tokenizeCss("")).toEqual([]);
});
```
注：`scanChapterCss([])` 仍走既有非空护栏 throw（既有用例覆盖，不动）。

- [ ] **Step 2: RED**（`npx vitest run scripts/check/scanner-css.test.ts`——前两条失败：K-10 续行无色、K-12 后续检查被吞；后三条为回退护栏，必须保持绿）
- [ ] **Step 3: 实现**——`tokenizeCss` 单遍扫描：
  - 状态：`inComment` / `inString`（`"` `'` + `\` 转义）/ `parenDepth`；`/*` 仅在非字符串非注释时开注释，`*/` 仅注释态生效
  - 注释内容整体丢弃；字符串内容保留在声明文本里但不参与结构化判定（emoji 检查仍走原文行——不变）
  - **边界：`{` `}` `;`（`parenDepth === 0` 时）四者皆为 token 边界**；每条声明的行号 = 该声明**首个非空白字符**所在行
  - **两条既有语义必须等价保留**（否则打红两条假阳性钉死用例——`named-colors.ts` 147 词含 purple/pink/orange/gold）：
    ① **前导剥离**：`{` 作为边界已保证段内不含规则头；对残余段仍执行"丢弃最后一个顶层 `{` 之前的文本"（等价现网 `lastBrace` 切片）；
    ② **非声明段跳过**：段内**顶层 `:` 不存在** → 跳过一切结构化判定（等价现网 `includes(":")` 弱门，但由分词器判定）
  - `scanLine` → `scanDeclaration(decl, findings)`：`\n` 折成空格后跑既有正则；逐条规则**逐字保留**
- [ ] **Step 4: GREEN + 真实夹具防误伤**（不是拿模板当护身符——模板章节层零 CSS，扫描器根本不被调用）：
  在 `scripts/check/__fixtures__/` 加 `.css` 夹具（跨行 box-shadow 裸色 / 字符串内 `/*` / `.pink-card` 选择器 / `@media` 嵌套 / 注释内裸色），夹具测试断言"该报的报、不该报的不报"逐条成立；`npx vitest run scripts/check/` 全绿
- [ ] **Step 5: 反证（判别力）**——把 `tokenizeCss` 临时改回"按 `\n` 切行"，Step 1 前两条必须红（贴输出）；还原
- [ ] **Step 6: Commit** `fix(M3b): scanner-css 声明级状态机（K-10 跨行值 + K-12 注释态泄漏，含夹具与反证）`

---

### Task 2: scanner-tsx 豁免旗标拆分（K-11）

**Files:**
- Modify: `scripts/check/scanner-tsx.ts`（`ScanCtx.exemptEasing` 一分为二）
- Test: `scripts/check/scanner-tsx.test.ts`（新增 2 用例）
- Test: `scripts/check/__fixtures__/`（tsx 夹具：`src/engine/` 与 `src/components/` 两个路径下的 EChart option 字面量）

**Interfaces:** 消费面不变（`scanChapterTsx(files)` 与规则名 `"ECharts option 裸色/裸字体"` 逐字不动）

- [ ] **Step 1: 写失败测试**

```ts
it("engine 目录不再获得 EChart option 豁免（K-11）", () => {
  const src = `export const A = () => <EChart option={{ series: [{ itemStyle: { color: "#ff0000" } }] }} />;`;
  const f = scanChapterTsx([{ path: "src/engine/x.tsx", source: src }]);
  expect(f.some((x) => x.rule === "ECharts option 裸色/裸字体")).toBe(true);
});

it("components 目录仍豁免（组件库本体不受该规则约束）", () => {
  const src = `export const A = () => <EChart option={{ series: [{ itemStyle: { color: "#ff0000" } }] }} />;`;
  expect(scanChapterTsx([{ path: "src/components/charts/x.tsx", source: src }])).toEqual([]);
});
```

- [ ] **Step 2: RED → Step 3: 实现**（`exemptEasing` 保留原语义供缓动规则；新增 `exemptChartOption = isSrcSubdir(path, "components")`，EChart 规则改用它；**缓动规则面逐字不动**）
- [ ] **Step 4: GREEN** + 全量 `npx vitest run`
- [ ] **Step 5: 反证**：把 EChart 规则的旗标改回 `exemptEasing` → 第一条必须红；还原
- [ ] **Step 6: Commit** `fix(M3b): scanner-tsx 豁免旗标拆分（EChart option 规则不再沾 engine 豁免，K-11）`

---

### Task 3: 会话模块抽取（`scripts/shot/session.ts`，K-21）

**Files:**
- Create: `scripts/shot/session.ts` + `scripts/shot/session.test.ts`
- Modify: `scripts/shot/capture.ts`（改消费 session；公开面再导出）
- Modify: `scripts/shot/verify-sequential.ts`（删本地三段复刻）
- Modify: `narration-video/scripts/scaffold-smoke.sh`（**Flows 漏项**：第 35 行 grep 的 `npx playwright install chromium` 字面量随 `CHROMIUM_INSTALL_HINT` 迁走 → 断言改挂 `scripts/shot/session.ts`，否则 smoke 必红）

**Interfaces:** 见"接口约定 1"

- [ ] **Step 1: 写失败测试**
```ts
it("withHeadless 幂等且保留既有 query", () => {
  expect(withHeadless("http://a:1/?render=1")).toBe("http://a:1/?render=1&headless=1");
  expect(withHeadless("http://a:1/?headless=1")).toBe("http://a:1/?headless=1");
});
it("capture.ts 再导出面不回归（冻结契约仍可 import）", async () => {
  const cap = await import("./capture");
  for (const k of ["expandSpecs","shotPath","assertCursorMatch","assertCursorStill","withHeadless",
                   "chromiumMissingError","CHROMIUM_INSTALL_HINT","READY_TIMEOUT_MS","DEFAULT_VIEWPORT"]) {
    expect(k in cap).toBe(true);
  }
});
```
- [ ] **Step 2: RED → Step 3: 实现**（搬移 + 两处消费改造都要改到"内联逻辑"层面，否则 K-21 只搬走了启动三段）：
  - `capture.ts`：`captureOne` 内联的 `page.evaluate(jumpTo/ready/getState/animations)` 改调 `jumpToStep / readyWithTimeout / readCursor / readAnimations`；`captureSteps` 用 `openSession`
  - `verify-sequential.ts`：删本地 `launchChromium`/`openPage`/`readyWithTimeout`，改消费 session（键盘推进流程逐字不动）
  - **文案统一**：两处 `readyWithTimeout` 超时文案本就不同，合并后以其一为准（`verify.ts` 侧文案变化不属行为契约，报告里记一句）
  - 依赖方向单向（session 不 import capture）
- [ ] **Step 4: GREEN** + `npx tsc --noEmit` + 全量 `npx vitest run`
- [ ] **Step 5: 真机冒烟**：`npm run storyboard` 仍 3 帧且跨运行 PNG md5 一致；`npx tsx scripts/storyboard.ts --verify-sequential` 结论仍一致
- [ ] **Step 6: 冒烟** `bash narration-video/scripts/scaffold-smoke.sh`（改后的断言通过）
- [ ] **Step 7: Commit** `refactor(M3b): shot/session 会话模块（capture/verify 收敛三段复刻，K-21）`

---

### Task 4: 安全框单一源（`src/engine/safe-area.ts` + 档案参数化 + 参考线纠偏）

**Files:**
- Create: `src/engine/safe-area.ts` + `src/engine/safe-area.test.ts`
- Modify: `src/engine/runtime-config.ts`（`RuntimeConfig` 增 `safeArea: SafeArea`）
- Modify: `src/ThemeShowcase.tsx`（`SafetyGuides` 改消费 `safeArea` + `SLIDE_BORDER_W`）
- Modify: `narration-video/scripts/scaffold.sh` + `scaffold-smoke.sh`

**Interfaces:**
```ts
export interface SafeArea { chrome: number; content: number; top: number; contentBottom: number; captionTop: number }
// 基准值来源逐条写明（勿笼统说"取自 V1"）：
//   chrome 64 / content 96 / contentBottom 934 / captionTop 958 → §12b V1
//   top 112 → **实现锚点**（V1 文本未给该数）：showcase 注释"topbar 底 88 + 24 = 顶 112"
export const SAFE_AREA_BASE: SafeArea;
export const SAFE_AREA_BASE_DIMS: { width: number; height: number };
export function deriveSafeArea(dims: { width: number; height: number }): SafeArea;   // 比例折算 + 取整
```
**待定项（不擅自定数字）**：3:4（1080×1440）按基准比例折算（`round(64 × W/1920)` 等），文件头注明"小红书档案绝对值待 M7 档案定稿时由用户确认"，并记 KNOWN-ISSUES。

**参考线现状与纠偏（执行期实测，2026-09-11）**：`SlideShell` 是 `boxSizing:"border-box"` + `border: 4px`，参考线 overlay 的包含块是 **padding box**（起点 (4,4)，1072 高）——实测四条竖线整体内移 4px（`left:64` 画在 x=68、`left:96` 画在 x=100）、两条顶锚横线下移 4px（`top:112` 画在 y=116），只有两条底锚横线的**底缘**恰好落在 958/934。故新公式（`SLIDE_BORDER_W = 4` 在 ThemeShowcase 内具名，与 `border` 同源）：
```
顶/左锚： top/left  = value − SLIDE_BORDER_W
底锚：   bottom    = dims.height − SLIDE_BORDER_W − value     // 现网 118 = 1080 − 4 − 958 ✓
```
纠偏后四条竖线与两条顶锚横线会**移动 4px**（这是修复，不是回归）。

- [ ] **Step 1: 写失败测试**
```ts
it("16:9 基准值 = 字面量（不用 SAFE_AREA_BASE 自比——恒真断言）", () => {
  expect(deriveSafeArea({ width: 1920, height: 1080 })).toEqual({
    chrome: 64, content: 96, top: 112, contentBottom: 934, captionTop: 958,
  });
});
it("3:4 比例折算（1080×1440）", () => {
  expect(deriveSafeArea({ width: 1080, height: 1440 })).toEqual({
    chrome: 36, content: 54, top: 149, contentBottom: 1245, captionTop: 1277,
  });
});
it("非空护栏：零/负尺寸抛错", () => {
  expect(() => deriveSafeArea({ width: 0, height: 1080 })).toThrow();
});
```
- [ ] **Step 2: RED → Step 3: 实现**（`runtime-config.ts` 接入：模板默认 + scaffold 生成的运行时配置同形；**不改 scaffold 的参数解析**）
- [ ] **Step 4: GREEN** + `npx tsc --noEmit`
- [ ] **Step 5: 几何验收（rect 数值，不赌整页像素）**：Playwright 打开 `?showcase=1&guides=1`，读参考线**画布绝对坐标**——**改前先记录一份 before 值**（预期见上"纠偏"），改后断言：
  - 四条竖线 `x == { chrome, W − chrome, content, W − content }`（±0）
  - 两条顶锚横线 `y == top`（±0）；两条底锚横线**底缘** `y == { contentBottom, captionTop }`（±0）
  - 报告贴 before/after 两张表 + 位移说明（预期：6 条各移 4px，底锚 2 条 0px）
- [ ] **Step 6: 冒烟** `bash narration-video/scripts/scaffold-smoke.sh`（新增 safeArea 断言通过）
- [ ] **Step 7: Commit** `feat(M3b): 安全框单一源（deriveSafeArea + 档案参数化 + 参考线 4px 纠偏）`

---

### Task 5: 桥的动画审计面（`audit()` + waapi 打标）

**Files:**
- Modify: `src/engine/animationRuntime.ts`（`OWNED` 打标 + `describeUnownedAnimations()` + running 统计）
- Modify: `src/engine/cursorBridge.ts`（`audit()` 合成面）
- Modify: `src/App.tsx`（桥安装处补 `audit`）
- Test: `src/engine/animationRuntime.test.ts`、`src/engine/cursorBridge.test.ts`

**Interfaces:** 见"接口约定 2"（`PresentationBridge` 四方法不动，`audit()` 为追加成员）

- [ ] **Step 1: 写失败测试**（jsdom 无 WAAPI → `vi.stubGlobal` 或 `Object.defineProperty(document, "getAnimations", …)`；沿用 cursorBridge.test.ts 既有做法）
```ts
it("unowned = 未打标动画；引擎 waapi() 创建的计入 owned", () => {});
it("unownedHints 至多 5 条且可读（animationName 或 target 选择器）", () => {});
it("running / unownedRunning 只数 playState==='running'；render 模式下引擎动画恒 paused", () => {});
it("非空护栏（jsdom 常态）：无 getAnimations 时不抛，waapi=0", () => {});
```
- [ ] **Step 2: RED → Step 3: 实现**（`waapi()` 内打标；`audit()` 组合；cursorBridge 文档头注明"audit 为 M3b 追加，四方法契约不动"）
- [ ] **Step 4: GREEN** + 全量 `npx vitest run`
- [ ] **Step 5: 真机判别力（DOM 注入取证——example 章节证不了）**：example step 0 只挂 KenBurns（`canvasAnim` 不进 WAAPI 面），`document.getAnimations()` 实测为空。
  1. `?render=1&headless=1` 基线 → 期望 `{ waapi: 0, owned: 0, unowned: 0, unownedRunning: 0, registry: 1, windowMs: <KenBurns 声明时长>, running: 0 }`
  2. 同页 `page.evaluate(() => document.body.animate([{opacity:0},{opacity:1}], {duration:100, fill:"both"}))` → `{ waapi: 1, owned: 0, unowned: 1, unownedRunning: 1 }`（**未注册动画的判别力**）
  3. `?headless=1`（非 render）注入同一动画 → `running ≥ 1`（证 `running` 不是死值）
  报告贴三次输出
- [ ] **Step 6: Commit** `feat(M3b): 桥动画审计面 audit()（未注册动画/Running/窗口时长，M4-1 正交口径落地）`

---

### Task 6: headless/render 不武装音频推进链（M5 遗留首项提前落地）

**Files:**
- Modify: `src/App.tsx`（playStep effect 加守卫）
- Test: `src/App.test.tsx`（新增 2 用例 + afterEach 复位）

**Interfaces:** 行为契约——URL 含 `headless` 或 `render` 时页面**不自驱推进**；`?auto=1` 录屏流（不带 headless）不受影响

**背景**：M5 遗留清单第 1 项，本计划实测更正其前提（原记"仓库无 mp3 所以不触发"是错的）：模板无 `public/`，每步 mp3 必 404 → `onerror` 走估时兜底 → 自动链真的在跑。**独立的精确测量**：`?render=1&headless=1` 下 `jumpTo(0,1)`（无动画步）→ 实测 504/1005/1508/2010ms 停在 (0,1)，**2512ms 跳到 (0,2)**（= `estimateMs("这是第二句口播") 1750 + DEFAULT_HOLD_MS 400` 的累积）——即每步只给无头检查留 ~2.5s，Task 7 的逐 step 收集器完全可能超时。

- [ ] **Step 1: 写失败测试**（沿用 App.test.tsx:159-181 的 `vi.resetModules()` + `vi.doMock` + 动态 import；`params` 是模块作用域读一次，故必须先 `replaceState` 再造模块）
```ts
const mockPlayer = () => {
  const playStep = vi.fn();
  vi.doMock("./engine/useAudioPlayer", () => ({
    useAudioPlayer: () => ({ playing: false, playStep, pause: vi.fn(), resume: vi.fn(), stop: vi.fn() }),
  }));   // 五个成员缺一不可
  return playStep;
};
it("?headless=1 不武装自驱推进链：playStep 不被调用", async () => {
  window.history.replaceState({}, "", "/?headless=1");
  vi.resetModules();
  const playStep = mockPlayer();
  const { default: App } = await import("./App");
  render(<App />);
  expect(playStep).not.toHaveBeenCalled();
});
it("无 query 时行为不变：进入即 playStep 一次", async () => {
  window.history.replaceState({}, "", "/");
  vi.resetModules();
  const playStep = mockPlayer();
  const { default: App } = await import("./App");
  render(<App />);
  expect(playStep).toHaveBeenCalledTimes(1);
});
afterEach(() => {
  vi.doUnmock("./engine/useAudioPlayer");
  window.history.replaceState({}, "", "/");   // 不留 ?headless=1 给后续用例（假红来源）
});
```
- [ ] **Step 2: RED → Step 3: 实现**（effect 首行 `if (renderMode || params.has("headless")) return;`；注释写明依赖方：capture / storyboard / verify-sequential / 无头 pass；顺带注明"非 render 的 headless 下 transport 仍可见，但播放键点了不会有反应（`resume()` 因 `lastRef` 为 null 直接返回）"）
- [ ] **Step 4: GREEN** + 全量回归
- [ ] **Step 5: 真机反证（判别力必须取在 `?render=1&headless=1` + `jumpTo(0,1)`）**：
  - 修复前：`?render=1&headless=1` → `jumpTo(0,1)` → **~2.5s 后跳到 (0,2)**（贴时间线）
  - 修复后：同操作 → 8s 恒 (0,1)
  - 回归护栏：**真实预览 URL `/`（不带 headless）** 与 `?auto=1` 仍自驱（T6 执行期实测：预览 `/` 修复前 3548/5717ms、修复后 3550/5715ms，逐毫秒等价）
    **【执行期更正 2026-09-11】**：本行原文写的是"`?headless=1`（非 render）→ 预览自驱仍在（4s/6s）"——那组读数实为**修复前**状态，与本节契约（headless 不自驱）自相矛盾。契约优先：`?headless=1` 修复后**不**自驱；护栏改在真实预览 URL 上取证（见上）。
  - **注意**：render 模式 + step 0（KenBurns）**没有判别力**——canvasAnim 冻结在 t=0 → `allFinished()` 恒 false → 修复前后都恒 (0,0)，不要拿它当证据
- [ ] **Step 6: 回归验证 M4 管线**：`npm run storyboard` + `--verify-sequential` 复跑
- [ ] **Step 7: Commit** `fix(M3b): headless/render 不武装自驱推进链（M5 遗留首项提前；实测更正"不触发"前提）`

---

### Task 7: 无头 pass 编排 + #16 三断言 + `npm run check` 全量 CLI

**Files:**
- Create: `scripts/check/serve.ts`（自起 Vite）
- Create: `scripts/check/collectors.ts`（**源码串**收集器）+ `scripts/check/collectors.test.ts`
- Create: `scripts/check/headless.ts`（`runHeadlessPass`）
- Create: `scripts/check/check.ts`（全量 CLI）+ `scripts/check/check.test.ts`
- Modify: `scripts/check/findings.ts`（`addAll` / `merge` / `render(title?)`）+ `findings.test.ts`
- Modify: `package.json`（`"check": "tsx scripts/check/check.ts"`；`check:fast` 不动）

**Interfaces:** 见"接口约定 3/4/6"

- [ ] **Step 1: 写失败测试**
```ts
it("findings.render(title) 自定义标题；默认标题不变；空袋分支同样带标题", () => {
  expect(new FindingBag().render()).toBe("静态门禁报告：0 项（blocker 0，warning 0）");
  expect(new FindingBag().render("门禁报告（fast + 无头）")).toContain("门禁报告（fast + 无头）");
});
it("FindingBag.addAll：顺序追加；空数组不改变任何结果（双护栏）", () => {});
it("FindingBag.merge：other 的 findings 全量并入，blocker 决定 exit code", () => {});
it("收集器源码串：不含反引号与 ${（String.raw 模板安全）", () => {
  for (const src of [COLLECT_OVERFLOW_SRC, COLLECT_SAFE_MARGINS_SRC, COLLECT_CONTRAST_SRC, COLLECT_FONTS_SRC]) {
    expect(src.includes("`")).toBe(false);
    expect(src.includes("${")).toBe(false);
    expect(src.includes("__name")).toBe(false);   // tsx keepNames 注入物不得出现在源码串
  }
});
it("收集器非空护栏：examined === 0（收集器级）→ blocker", () => {
  expect(fromSrc<any>(COLLECT_OVERFLOW_SRC)({ /* 空 DOM */ }).findings.some((f) => f.severity === "blocker")).toBe(true);
});
```
- [ ] **Step 2: RED → Step 3: 实现**
  - `serve.ts`：**不给 `server:{port:0}`**（实测：会覆盖 vite.config 的 5174 而回落 5173）。缺省 `createServer({ configFile, server: { hmr: false } })` 让配置文件生效（端口被占时 Vite 自动 +1）；`await server.listen()` 后**必须断言 `resolvedUrls !== null`** 再取 `resolvedUrls.local[0]`（否则静默传出 `undefined` 坏 URL）；`stop()` 关服务
  - **复用规则**：默认**永不复用**外部服务（本机实测 5174 上常有别人的 dev server——探活即复用会静默检查错误的项目）；只有显式传 `--url` 才复用
  - `headless.ts`：`openSession({ url: withHeadless(renderUrl), viewport: stageConfig.dims })`（URL 追加 `render=1`）→ **开场显式 `jumpTo(0,0)` + `ready()`**（防 localStorage 游标恢复带来的起点漂移——同一 context 的第二个页面实测开局在 step 2）→ `expandSpecs(chapters)` 逐 step：`jumpToStep` → `readyWithTimeout` → `readCursor` 校验（复用 `assertCursorMatch`）→ 采数据 → 归 Finding
  - **#16 三断言**：① console —— **blocker 只认 `pageerror` 与 `console.error`**，且归因窗口 = "该步 `ready()` 之后的该步期间"（框架期/上一步消息丢弃）；`m.location().url` 非本页脚本的浏览器 Log 类消息（弃用告警/CSP/非 passive 监听器）归 **info 并计数**，不报 warning；② 被画布截断 → blocker（见 Task 8 的 overflow 收集器口径）；③ 动画逃逸 —— `audit.unownedRunning > 0` 或 render 下 `audit.running > 0` → **blocker**；`unowned > 0` 但**未在跑**（如 CSS transition 残影）→ warning 并列 hints（收窄理由：一刀切会把任何 CSS transition 判成逃逸）
  - `check.ts`：`runCheckFast()` → `runHeadlessPass()` → `bag.merge(...)` → `render("门禁报告（fast + 无头）")` → `process.exit(bag.exitCode())`；flags：`--url`（复用外部服务）/ `--no-headless`（只跑 fast 的调试口）
- [ ] **Step 4: GREEN** + `npx tsc --noEmit`
- [ ] **Step 5: 真机正反样本**：
  - 正：模板 `npm run check` → 0 blocker（贴完整报告，含 #16 的 examined 计数）
  - 反（逐条贴报告后还原）：① example 章节临时挂 `console.error("boom")` → blocker 且定位到步；② 临时加一个含文本的溢出 `<div style={{position:"absolute",left:-200}}>` → "被画布截断"；③ `page.evaluate` 注入未注册动画 → "动画逃逸"（blocker，因 running）
  - **tsx 真机护栏（C1 的守门测试）**：用**子进程**跑一次真实 CLI 路径（`npx tsx -e "…page.evaluate(COLLECT_OVERFLOW_SRC…)"`）并断言无 `__name` ReferenceError——vitest 内无法发现该问题（vitest 不做 keepNames）
- [ ] **Step 6: Commit** `feat(M3b): 无头 pass 编排 + #16 三断言 + check 全量 CLI（自起 Vite）`

---

### Task 8: #20 文字安全边距 + #18 对比度 + #14 字体加载（无头半边）

**Files:**
- Modify: `scripts/check/collectors.ts`（新增三个源码串收集器 + 纯判据）+ `collectors.test.ts`
- Create: `scripts/check/collectors.browser.test.ts`（**真浏览器 fixture 测试**，`chromium.launch()` + `page.setContent()`）
- Modify: `scripts/check/headless.ts`（接线；`#14` 在**全部步跑完后**做一次）

**Interfaces:** 见"接口约定 6"

**测试策略（关键修正）**：jsdom **不做布局**（`getBoundingClientRect()` 恒零矩形、无 `elementFromPoint`、无 `document.fonts`），且**测不出** tsx `__name` 类问题——"在 jsdom 里 stub 一切"等于只测减法。故：
- **纯判据**（`contrastRatio` / `outOfBandPx` / `diffFamilies`）→ Node 单测，真红→绿
- **收集器** → **真浏览器 fixture**：`page.setContent(FIXTURE_HTML)` + `page.evaluate(src, args)`，断言逐节点期望（固定 HTML 含：带内文本 / 越界文本 / 自绘深底徽章 / 反色卡 / caption 子树 / 渐变背景 / `<svg><text>` / 空文本 div），一次 launch 约 1-2s

**规则**（§11.1 #20 / #18 / #14 + §12b V1/V9）
- **#20 warning**：舞台框内含可见文本的元素（文本节点非空白；SVG `<text>` 计入）；排除 `.caption-layer` 子树；`[data-safe-band="chrome"]` 子树按 **chrome 带 64** 判，其余按**内容带**（96 / 顶 112 / 底 934）；量化输出"越界 Xpx"
  **关于 `data-safe-band="chrome"`（诚实标注）**：全仓当前**无生产者**（topbar 在 showcase 是内联结构、章节层无框架级 chrome）。本版定为**作者约定**（随 CHAPTER-CRAFT 在 M7 成文），默认**从严**：未标记的顶栏文字会被报成内容带越界——有意为之，误报消息里附"若为 chrome 带元素请加 `data-safe-band=\"chrome\"`"的指引。单测必须覆盖"带标记按 64 判 / 不带按 96 判"两条路径，并记 KNOWN-ISSUES
- **#18 warning**：**先读元素自身 `getComputedStyle(el).backgroundColor`（α>0 即作为有效背景）**——本仓大量组件自绘底色（badge/pill/marker/card/表头/Kicker/PostIt/MarkerBlock invert 墨底），先隐藏自身再 hit-test 的写法会让比值系统性偏乐观（实测 5.25:1 被算成 7.185:1，偏 37%）或把深底浅字卡判成"浅底浅字"假 warning；**仅当自身背景 transparent** 才走 `visibility:hidden` + `elementFromPoint` 祖先链采样；背景为 `img/canvas/gradient/background-image` → 记 **info**（不可判定）并计数；阈值 `largePx = 24` → 大字 3:1 / 小字 4.5:1；输出实际比值
- **#14 blocker（无头半边）**：**判据 = `document.fonts` 中 `status === "loaded"` 的家族**（实测 317 条 FontFace / 按 family 去重 5 个 / 按 loaded 过滤只剩 1 个——不过滤 status 等于左右同源的同义反复，抓不到原版缺陷 #8）；"声明面"取**该 deck 实际用到的 font-family 集合**（从渲染文本的 computed font-family 收集），而非 theme.json 全量；`loaded ⊄ used` → blocker 带家族名清单；**#14 在全部步跑完后做一次**（字体加载跨步累积，`only` 模式读数不同）；`examined === 0`（全 deck 无主题字体文本）→ **info**（不是 blocker——示例章节正文用 UA 默认字体，实测 `examined` 会为 0）

- [ ] **Step 1: 写失败测试**（纯判据 + 源码串安全 + fixture 期望）
```ts
it("对比度纯判据：黑/白 = 21:1；浅灰底浅灰字 < 3:1", () => {});
it("越界纯判据：rect 越内容带 40px → 量化值 40", () => {});
it("字体差集：loaded 多出 used → 返回该家族", () => {});
it("源码串：三个收集器均不含反引号/${/__name", () => {});
// 真浏览器 fixture（collectors.browser.test.ts）
it("fixture：自绘深底徽章取自身底色（不是祖先白底）", async () => {});
it("fixture：caption 子树不计入；chrome 标记按 64 判", async () => {});
it("fixture：渐变/图片背景记 info 不报 warning", async () => {});
it("fixture：非空护栏 examined = 文本元素数", async () => {});
```
- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN** + `npx tsc --noEmit`
- [ ] **Step 5: 真机验证（模板零误报）**：`npm run check` 全量跑模板——核对 `examined` 非零、#18/#20 对 chapter 场景零误报（有误报逐条判定：真问题→修章节；判定偏差→收紧规则并在报告说明）；#14 贴实测"loaded / used"两张清单
- [ ] **Step 6: Commit** `feat(M3b): #20 安全边距 + #18 对比度（自身底色优先）+ #14 字体加载（loaded 读法）`

---

### Task 9: #17 动画窗口 vs 音频 + #19 音频段 ≥15s + 收口

**Files:**
- Create: `scripts/check/tempo.ts` + `tempo.test.ts`
- Modify: `scripts/storyboard/data.ts`（外提并导出 `resolveAudioMs`；调用点不动）
- Modify: `scripts/check/headless.ts`（#17 接线：逐帧 `audit.windowMs` × `audioMs`）
- Modify: `narration-video/scripts/scaffold.sh` / `scaffold-smoke.sh`
- Modify: `research-notes/07-design-draft.md`、`research-notes/KNOWN-ISSUES.md`

**Interfaces:** 见"接口约定 5"

- [ ] **Step 1: 写失败测试**
```ts
it("#17 动画窗口 > 音频时长 → warning 含差值 ms", () => { /* windowMs 3000 / audioMs 2000 → "超出人声 1000ms" */ });
it("#17 无音频（null）不报（未合成是合法态）", () => {});
it("#19 音频段 < 15000ms → warning 含实际值；≥15000 不报", () => {});
it("resolveAudioMs 外提后语义不变：空 narration 步不吃条目 + warnings 两类警示仍产出", () => {
  // 断言与 storyboard.test.ts:153-170 既有钉死值一致
});
it("非空护栏：chapters 空数组 → 空结果不抛", () => {});
```
- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**（含分镜回归：`npx vitest run scripts/storyboard.test.ts` 全绿——行为不变的硬证据）
- [ ] **Step 5: 全量收口**：`npx tsc --noEmit` + `npx vitest run` + `npm run check`（0 blocker）+ `npm run build` + `bash narration-video/scripts/scaffold-smoke.sh`
- [ ] **Step 5b: 冒烟/指引语义同步**（`npm run check` 已从秒级静态变成"起 Vite + 拉 Chromium"）：
  - `scaffold-smoke.sh`：`npm run check` 断言改 **`npm run check:fast`**（保持秒级），并新增 `grep -q '"check": "tsx scripts/check/check.ts"' package.json`；注释写明"全量 check 需 Chromium，冒烟不跑"
  - `scaffold.sh` 指引：`npm run check` 移入"需先 `npx playwright install chromium`"的命令清单
- [ ] **Step 6: 文档记录**（**先落盘再删任何工作区**）：
  - `07-design-draft.md` §12 追加 M3b 行（含 commit）+ "20 项达成"的准确措辞；M5 遗留清单第 1 项标注"已提前落地于 M3b（Task 6）"
  - `KNOWN-ISSUES.md`：K-10/11/12/21 → §0；**新增边界**：① §11.1 #1 的**无头半边**推迟（归属 M5；触发条件 = 章节 `f(step)` 越界渲染且不抛错，纯空白帧漏网；Task 7 的逐 step console 断言只部分兜底）② `data-safe-band="chrome"` 约定暂无生产者（随 M7 成文；未标记从严）③ 3:4 安全框为比例折算，待档案定稿 ④ 无头 pass 不覆盖"动画播放期 console error" ⑤ `captureSteps` 不带 `?render` 时 transport 会进截图（M5 注意）⑥ `serve.ts` 默认不复用外部服务（防查错项目）
- [ ] **Step 7: Commit** `feat(M3b): #17/#19 节奏检查 + 收口（scaffold/smoke/文档）；check 全量 20 项达成`

---

## 执行环境注意

- `npm run check` 会自起 Vite + 开 Chromium（十秒级）；迭代期用 `npm run check:fast`（不变）
- 无头 pass 默认**不复用**外部 dev server；调试时可 `--url http://localhost:5174`（显式复用）
- Playwright 1.58.2 已锁；`npx playwright install chromium` 首次需已执行
- Task 6 改的是**运行时行为**：Step 5 的真机反证必须在 `?render=1&headless=1` + `jumpTo(0,1)` 上取，且不得用 step 0（KenBurns 冻结恒不推进 = 死值）

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：#16（T7）/ #17（T9）/ #18（T8）/ #19（T9）/ #20（T8）/ **#14 无头半边（T8）** / #4 无头半边 = 注册表覆盖断言（T5 audit + T7 判据）；§11.2 门禁负样本测试 = 双护栏 + 夹具 + 各任务反证；§12 M5 遗留 #1（T6）；KNOWN-ISSUES K-10/11/12（T1/T2）、K-21（T3）。**check 全量 20 项在本计划结束时可达**（15 静态 + 5 无头）。
2. **明确缺口（逐条有归属）**：① #1 的 step 使用上界无头半边 → M5 帧流（KNOWN-ISSUES 点名）② 动画播放期 console error（本计划跑冻结态）→ M5 ③ 逐帧 seek 的过程检查 → M5。
3. **Placeholder scan**：无 TBD；`only?`（调试，缺省全量）与 `url?`（缺省自起）是仅有的可选参；`chromeSelector` 必传；规则名/函数名均为**现网字面量**。
4. **Type consistency**：`AnimationAudit`（T5→T7）、`SafeArea`（T4→T8）、`openSession/readyWithTimeout/jumpToStep/readCursor/readAnimations/auditAnimations`（T3/T5→T7/T8）、`FindingBag.addAll/merge`（T7）、`COLLECT_*_SRC`（T7/T8）、`resolveAudioMs`（T9 内外同源）、`render(title?)`（T7）。
5. **两轮独立质检修订记录（2026-09-11；均为对照真实仓库/真跑实测后回改）**：
   - **C1（#1）** Task 1 行号自相矛盾 → 定死"声明起始行"，用例改 `a.css:2`
   - **C2（#1 + #2）** 删弱门会打红既有假阳性用例（`purple`/`pink`/`orange`/`gold` 都在 147 词命名色表内）→ 明写两条**等价语义**（前导剥离 + 非声明段跳过），补 4 条选择器负样本，并把"防误伤实证"从**空转的模板**改为**真夹具**
   - **C3（#1）** 接口约定 5 的函数名/签名/出参三处不实 → 改为现网 `resolveAudioMs(chapters, durations, warnings)` 逐字外提
   - **C1（#2）** **tsx `keepNames` 注入 `__name` → 收集器在真机必崩而 vitest 发现不了** → 收集器全面改为**源码串**载体 + Node `new Function` 同文本单测 + 子进程真机护栏
   - **C3（#2）** #18 丢弃元素自身底色（实测偏乐观 37%、反色卡假 warning）→ 自身 `backgroundColor` 优先，transparent 才走祖先链
   - **I1（#2）** Task 3 会让 `scaffold-smoke.sh` 必红（grep 的字面量迁走）→ Files 补该文件并改断言位置
   - **I2/#1-I3（#2）** `serve.ts` 端口 0 不成立（实测回落 5173）且"探活即复用"会静默检查**别人的项目**（实测 5174 被占）→ 缺省自起 + `hmr:false` + 断言 `resolvedUrls` 非空 + 只在显式 `--url` 时复用
   - **I4（#2）** Task 6 反证取在 render+step0 是**死值**（KenBurns 冻结恒不推进）→ 改用 `jumpTo(0,1)` + 实测 2512ms 时间线
   - **I5（#2）** jsdom 测不到会坏的部分 → 纯判据 Node 测 + 收集器走**真浏览器 fixture**
   - **I6（#2）** #14 判据两种读法结论相反、`examined=0` 假 blocker → 定 `status==="loaded"` + 声明面改"实际用到" + 全程跑完再做一次 + `examined=0` 降 info
   - **I7（#2）** Task 5 判别力反证在示例章节恒 0 → 改 DOM 注入
   - **I10（#2）** 模板章节层零 `.css`，扫描器根本不被调用 → 夹具替代
   - **I11（#2）** console 归因 → blocker 只认 `pageerror`/`console.error`，浏览器 Log 类归 info，窗口按步
   - **I12（#2）** 其余非确定性 → HMR 关闭、开场 `jumpTo(0,0)`、`unowned` 收窄为 `unownedRunning` 才算 blocker、跨步累积量记录
   - **M1/M2（#2）** 非空护栏定级统一（收集器级 blocker / 步级合法 / #14 info）+ `render()` 空袋分支测试
   - **M3（#2）+ 执行期实测** Task 4 的"逐字节一致"不可达：参考线 overlay 的包含块是 padding box → 四条竖线与两条顶锚横线**实测各偏 4px**（`left:64`→x68、`top:112`→y116）→ 验收改为"改后绝对坐标 == safeArea 数值 ±0"并记录 before/after 位移表；这次单源化同时**修掉该 4px 偏差**
   - **M4（#2）** verify-sequential 的 `readyWithTimeout` 文案合并后可能变化 → 计划已注明
   - **M5（#2）** 非 render 的 headless 下 transport 可见但播放键无效 → 写进 Task 6 注释

---

## 执行记录（2026-09-12 完成 · 终审 Ready to merge: Yes）

**提交（16 个，直提 main）**：
`39aa464` scanner-css 声明级状态机 → `2860a69` 修复轮 1（`{` 无条件边界）→ `38b0298` 1b（URL 态）→ `1239164` 2（重锚）→ `f97e637` 3（终止条件收窄）→ `0e5464e` scanner-tsx 旗标拆分 → `2f4d500` shot/session → `7449815` 安全框单一源+参考线 4px 纠偏 → `85c4479` 桥 audit() → `ed42c7e` headless/render 不自驱 → `0fcd039` 无头 pass 编排+#16+全量 CLI → `bc3f4d5` 修复轮 1（开场监听缺口+info 分列）→ `3e130b6` #20/#18/#14 → `e4e1c61` 修复轮 1（字体使用面跨步并集+示例章节归位）→ `6c98350` #17/#19+收口 → `293f30d` 终审修复波。

**结果**：`npm run check` = **全量 20 项**（15 静态 + 5 无头 #16-20）+ #4/#14 的无头半边；模板 **blocker 0 / exit 0**；**566 测试绿**（基线 446）；`tsc` 0 错；`build` 通过；scaffold 冒烟 OK。KNOWN-ISSUES 收 K-10/11/12/21 入 §0，新增 K-30/31/32/46~49/54~74（终审修复波补 15 条 + 主控补录 2 条边缘项）。

**执行期偏离（对照计划原文，均为改进方向）**：
1. **两处"对 brief 字面不可实现"的放宽**（T7，经评审独立插桩证实）：console 归因窗口含该步 `jumpTo→ready` 渲染期（字面读法下章内错误 100% 落在 `ready()` 之前 → 假绿）；溢出检查做元素级截断（页面级在本布局 `overflow:hidden` 下永不触发，且向左溢出不计入 `scrollWidth`）。
2. **三处裁定性扩展**：`auditAnimations` 由 T7 而非 T5 产出（计划分工缺口）；`SessionOptions` 追加 `beforeGoto?`（堵开场挂载期监听缺口）；`FindingBag` 追加 `addNote/notes`（info 档唯一落点）。
3. **T6 Step 5 原文自相矛盾已就地更正**（"`?headless=1` 预览自驱仍在"实为修复前读数；契约优先，护栏改在真实预览 URL 取证）。
4. **示例章节归位**（`margin` 取自 `stageConfig.safeArea`）：它是 Ruling P4-4 的"门禁标杆"，不该自带 4 条自家违规。

**遗留**：全部 deferred minor 与残余面已落 `research-notes/KNOWN-ISSUES.md`（K-58~K-74）；M5 前置项见设计文档 §12 遗留清单（第 1 项已由本里程碑 Task 6 提前落地）。
