# M5b 字幕·导出服务·真实内容开箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M5a 的"确定性渲染核心"补成**能交给人的成片**——先用接近真实的音频开箱（补上 M5a 全部证据都是数字、没走过真实音频特征的两个遗憾），再交付字幕与 SRT、实时捕获降级、导出按钮的本地渲染服务，并把 M5a 交接的护栏落地。

**Architecture:** 六段：① **真实音频开箱**（拟真档 120ms 起手静音/44.1k/单声道 → 直接验 K-82③ → 按实测修法修边界锚点 → 出片交**用户审** → 金样入库）；② **SRT 副产物**（narrations × 时间轴表，纯函数）；③ **字幕口径**（默认进片；`--no-subs` 出无字幕版）；④ **实时捕获降级**（真播放 + 录屏 + 同一份确定性音轨 mux）；⑤ **导出服务**（**Vite dev server 中间件**——同源，无 CORS/无端口发现）；⑥ **收口**（`STORYBOARD_THEME` 护栏 / `--verify-sequential` 负对照自动化 / `--all-steps` 可选扩面）。

**Tech Stack:** 同 M5a（TypeScript / tsx / Playwright 1.58.2 / ffmpeg / vitest）+ Vite `configureServer` 中间件（不引新依赖）。

**Spec:** `../07-design-draft.md` §8 步骤 4（失败降级）、§8.1（双渲对比）、§9（字幕与播放控制）、§11.2（金样与截图环境）、§12 M5 遗留 #4/#6；M5a 的执行记录见 `2026-09-12-M5a-render-core.md` 的「执行记录」段。

## Global Constraints

- **M5a 的既有约定全部继续生效**：容差口径（视频内容边界 ±4 帧 / 音轨边界 ±10ms / 总时长 ±1 帧 / 音轨总长 ±2 AAC 帧 / `nb_frames` ±3）、`npm run render -- …`（**`--` 必带**）、`--only` 传子时间轴、`verifyRender` 的 `segments` 必传且数值须与 timeline 一致、`/render/` 与 `/public/audio/` 前导斜杠 gitignore
- **字幕层归引擎框架**（§9）：文本强制来自 narrations；渲染截的就是页面 ⇒ 字幕天然进视频（**已实测成立**：`Stage.tsx:34` 的 `CaptionLayer` 在 `.stage-frame` 内，帧流是整视口截图）
- **SRT 是纯派生**：`narrations` × 时间轴表，不得引入第二份时长来源；**"空 narration"的判据必须与引擎的字幕判据同源**（`hasAudio` 是 trim 口径，App 是裸真值口径——取 trim，并在测试里钉一条空白串用例）
- **金样落 `narration-video/golden/`**（skill 级资产，**不在 `templates/` 的 `cp -R` 拷贝面内**）；**入库须用户视觉确认**（§11.2）
- **降级必须响亮且不假绿**：`.realtime.mp4` 后缀 + 日志明写原因；**验收必须含"抽帧证明画面在变"**（首/中/末帧两两不同）——只判时长在定格画面上恒真（两轮质检实测）
- **导出服务 = Vite 中间件**（同源 ⇒ 无 CORS、无预检、无端口发现；§9 本来就写"随 dev server 启动"）；独立进程方案**不作备选**（跨源契约无法自洽，且 5174 常被占）
- **不引新依赖**；`node:http` 仅在中间件内部使用 Vite 的 `middlewares`
- 门禁测试双护栏；纯函数（Node 可测）与真机 fixture 分层

---

## 接口约定（跨计划冻结）

**1. 拟真音频档（`scripts/render/audio.ts` 扩展，Task 1）**
```ts
export interface MockAudioProfile {
  leadSilenceMs: number;          // 起手静音 ms——拟真档 120（真 TTS 常见 80~200，**实测 ≥50 必触发 K-82③**）
  sampleRate: number;             // 拟真档 44100
  channels: 1 | 2;                // 拟真档 1
}
export const MOCK_AUDIO_DEFAULT: MockAudioProfile;    // {0, 48000, 2}（与 M5a 行为一致）
export const MOCK_AUDIO_REALISTIC: MockAudioProfile;  // {120, 44100, 1}
// **追加** `profile?` 到既有 SynthesizeMockAudioOptions——既有可选参数（repoRoot? / ffmpegPath? /
// ffprobePath? / baseFrequency?）**逐字保留**，不传即行为不变（M4-3 款追加）
```

**2. SRT 导出（`scripts/render/srt.ts`，Task 2）**
```ts
export interface SrtCue { index: number; startMs: number; endMs: number; text: string }
export function buildSrtCues(timeline: Timeline, chapters: readonly { narrations: readonly string[] }[]): SrtCue[];
export function formatSrtTime(ms: number): string;      // 1234 → "00:00:01,234"
export function renderSrt(cues: readonly SrtCue[]): string;
```

**3. 字幕开关（Task 3）**：CLI 增 `--no-subs`；`withNoSubs(url)` helper（照 `withHeadless` 款）**在 capture 与 verify 重采前统一归一**（否则"成片无字幕、重采有字幕"假红）。SRT 默认写 `<outDir>/<slug>.srt`，`--no-srt` 关；**`--no-subs` 不影响 SRT**（SRT 是文本副产物，与画面无关）。

**4. 实时捕获降级（`scripts/render/realtime.ts`，Task 4）**
```ts
export const REALTIME_LAUNCH_ARGS: readonly string[];   // 含 --autoplay-policy=no-user-gesture-required（照 SOFTWARE_GL_ARGS 款，单测钉住）
export interface RealtimeOptions {
  url: string;                    // **裸 `?auto=1`**（不得带 headless / render）
  outDir: string; slug: string; timeline: Timeline;
  audioTrack: string | null;      // 确定性音轨（encode 出的 audio.m4a）——降级不得失声
  viewport: …; softwareGL?: boolean;
}
export async function captureRealtime(opts: RealtimeOptions): Promise<{ file: string; declaredMs: number; durationMs: number }>;
```
实现要点：**自己开会话**（`openSession` 恒加 `headless=1`，用不了）→ `recordVideo: { size: viewport }`（不传会缩到 800×450，实测）→ 录制 → `context.close()` 落盘 → **转 codec 到 mp4 / 30fps**（recordVideo 出的是 webm/VP8/25fps）→ **mux 确定性音轨** → 落 `<slug>.realtime.mp4`。

**5. 导出服务（Vite 中间件，Task 5）**
```ts
// vite.config.ts 的 plugin：configureServer(server) → server.middlewares.use("/__export", handler)
// GET  /__export/status → { state: "idle"|"running"|"done"|"failed"; progress: { done: number; total: number }; message?: string }
// POST /__export/run    → 触发（重复触发 409）
// GET  /__export/file   → 最近成片（Content-Disposition: attachment）
export interface ExportJob { run(): Promise<{ file: string; code: number }> }   // 注入面（**不复用 runRender 之名**——真 runRender 返回退出码）
```
进度来源：**显式注入** `onProgress?: (done, total) => void` 到渲染编排（M4-3 款追加字段；`RenderIo` 只有文本行，不够）。

**6. 金样（Task 1 产出，Task 6 消费）**
```
<repoRoot>/narration-video/golden/          # ← skill 级，**不在 templates/ 内**（不会随 scaffold 拷走）
  README.md      # 用途 + "重采须用户确认"的纪律 + 消费方在 scaffold 后项目里须跳过
  clip.mp4 / clip.srt / clip.probe.json
  frames/{first,mid,last}.png
```

---

### Task 1: 真实音频开箱（拟真档 → K-82③ 修复 → 用户审片 → 金样）

**Files:**
- Modify: `scripts/render/audio.ts`（`MockAudioProfile` + 拟真档，追加字段）
- Modify: `scripts/render/verify.ts`（**K-82③ 的边界锚点修法**——见 Step 3）+ `scripts/render/verify.test.ts`（纯函数用例）
- Modify: `scripts/render.ts` + `scripts/render.test.ts`（`--realistic-audio` flag：`RenderArgs`/`parseArgs`/`USAGE_FLAGS`/`RENDER_USAGE` 与 `RenderDeps` 的注入签名）
- Create: `narration-video/golden/`（**skill 级**）+ README
- Test: `scripts/render/audio.test.ts`（拟真档 ffprobe 读数）

**Interfaces:** 见"接口约定 1/6"

- [ ] **Step 1: 写失败测试（纯函数优先——缺陷真身在 `verify.ts:344` 的空判面护栏，秒级可钉）**
```ts
it("拟真音频（起手静音 120ms）下：边界层不得整层失明（K-82③）", () => { /* 真 fixture：真 mp3 + 真时间轴 + 真音轨图 → 断言 judged > 0 且 failures === 0 */ });
it("mock 档（无起手静音）读数与现行逐字相同（零行为改变）", () => {});
it("修完仍能抓恒定偏移（判别力反证）：注入 +30ms → 必须报红", () => {});
it("拟真档 ffprobe 读数：44100 / mono / 起手 120ms 静音", () => {});
```
- [ ] **Step 2: RED**（预期第一条红在"judged === 0 / 触发空判面护栏"——质检实测确认）
- [ ] **Step 3: 实现锚点修法（按质检原型，约 15 行，逐条照做）**
  1. 锚点 = "步起点之后**第一个有声 onset**"：从 `start` 起在 **lookahead ≥500ms**（截到 `min(ideal.length, product.length)`）内找第一个 5ms RMS ≥ `SILENCE_RMS`(20) 的样点；
  2. **在参考轨（ideal）上找 onset**——在产物轨上找会把任何真实偏移当成基准，判据变恒真；
  3. `measureAudioAlignment` 原样调用，`atSample = onsetSample`；**容差口径一律不动**（±10ms）；
  4. lookahead 内无 onset → 走"跳过"（真无声步），跳过文案改为"步起点后 500ms 内无内容"；
  5. 读数写明锚点是**内容起点**（`expectedMs`/`detail` 其一），别让读者以为比的是步起点。
- [ ] **Step 4: GREEN** + 真机一条**拟真音频**成片（`npm run render -- --mock-audio --realistic-audio`）→ 贴 ffprobe 读数与边界层读数
- [ ] **Step 5: Checkpoint：交用户审片**（唯一人工闸门）。确认后把成片 + 同源 SRT + probe + 三帧写进 `narration-video/golden/`（SRT 若 T2 未就绪，由 **T2 的 Files 负责补写与校验**——见 T2）；**未确认则本任务以 `DONE_WITH_CONCERNS` 收尾、金样留空**。
- [ ] **Step 6: Commit** `feat(M5b): 拟真音频档 + 边界锚点修法（K-82③ 实测修复，含判别力反证）(+ 金样)`

---

### Task 2: SRT 副产物（纯派生）

**Files:**
- Create: `scripts/render/srt.ts` + `scripts/render/srt.test.ts`
- Modify: `scripts/render.ts`（渲染后写 `<outDir>/<slug>.srt`；`--no-srt` 关）
- Modify: `narration-video/golden/`（**补写/校验 `clip.srt`**——T1 可能先于本任务完成）
- Test: 同上

**Interfaces:** 见"接口约定 2"

- [ ] **Step 1: 写失败测试**
```ts
it("时间格式：0 → 00:00:00,000；1234 → 00:00:01,234；3661001 → 01:01:01,001", () => {});
it("条目 = 非空 narration 步（**trim 口径**，与引擎 hasAudio 同源）；空步不出条目", () => { /* 含一条 "   " 空白串用例 → 不出条目 */ });
it("条目 [startMs, startMs+stepMs)；不依赖音频是否存在", () => {});
it("SRT 文本：序号 1..n、`-->` 时间行、空行分隔、末尾换行", () => {});
it("非空护栏：空时间轴 → 空文本（不抛）", () => {});
```
- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**
- [ ] **Step 5: 真机**：`npm run render -- --mock-audio` 后贴 `presentation.srt` 全文；**若 `golden/clip.mp4` 已存在（T1 已确认），补写 `golden/clip.srt` 并断言与主产物同源**（同一 `buildSrtCues` 输入）
- [ ] **Step 6: Commit** `feat(M5b): SRT 副产物（narrations × 时间轴表，trim 口径同源）`

---

### Task 3: 字幕口径（默认进片，`--no-subs` 出无字幕版）

**Files:**
- Modify: `src/engine/Stage.tsx`（`noSubs?: boolean` → `{caption && !noSubs ? <CaptionLayer/> : null}`）+ `src/App.tsx`（读 URL 参数）
- Modify: `scripts/shot/session.ts`（`withNoSubs(url)` helper）
- Modify: `scripts/render.ts`（`--no-subs` → URL 归一；capture 与 verify 重采**用同一个归一后的 URL**）
- Test: `src/engine/Stage.test.tsx`（+2）

**Interfaces:** 见"接口约定 3"

- [ ] **Step 1: 写失败测试**：`noSubs` 时 `caption` 非空但 `caption-layer` 不在 DOM；缺省时在。
- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**
- [ ] **Step 5: 真机取证**：同一 deck 渲两遍（默认 / `--no-subs`）→ **各抽一帧验字幕存在性**（默认帧含字幕、`--no-subs` 帧不含）+ `--no-subs` 的成片仍能过自校验（证明归一后的 URL 在 verify 重采里也生效）
- [ ] **Step 6: Commit** `feat(M5b): 字幕开关（默认进片；--no-subs 出无字幕版，重采同源归一）`

---

### Task 4: 实时捕获降级 + `useAudioPlayer` 静默 stall 修复

**Files:**
- Create: `scripts/render/realtime.ts` + `realtime.test.ts`（纯函数）+ `realtime.browser.test.ts`（真机）
- **Modify: `src/engine/useAudioPlayer.ts`**（**产品缺陷**：`play()` 被自动播放策略拒时**武装估时兜底计时器**——与 `onerror` 同款；否则真人用 `?auto=1` 预览也是一帧死画面且无提示）+ `useAudioPlayer.test.ts`（+1）
- Modify: `scripts/render.ts`（失败路径接线；`--no-fallback` 关）

**Interfaces:** 见"接口约定 4"

- [ ] **Step 1: 写失败测试**
```ts
it("播放在策略拒绝（NotAllowedError）下不静默 stall：武装估时兜底并推进（产品缺陷修复）", () => { /* FakeAudio.play() 返回 rejected promise → 期望 onDone 被调 */ });
it("产物命名：<slug>.realtime.mp4；声明时长 = timeline.totalMs", () => {});
it("REALTIME_LAUNCH_ARGS 含 --autoplay-policy=no-user-gesture-required（单测钉住，照 SOFTWARE_GL_ARGS 款）", () => {});
// realtime.browser.test.ts
it("真机：裸 ?auto=1 会话里游标**真的前进**（s0 → s1），录出的 mp4 首/中/末帧**两两不同**", async () => {});
```
- [ ] **Step 2: RED → Step 3: 实现**：`captureRealtime` **自开会话**（不用 `openSession`——它恒加 headless）+ `REALTIME_LAUNCH_ARGS` + `recordVideo:{size:viewport}`（不传会缩到 800×450）+ 录制 → `context.close()` → 转 mp4/30fps → **mux 确定性音轨**（`audioTrack`；若为 null，**日志明写"本次降级产物无声"**）→ 日志明写"已降级为实时捕获（确定性链路失败：<原因>）"
- [ ] **Step 4: GREEN** + 真机反证：**故意制造 seek 失败**（临时把 `seekTo` 换成抛错）→ 降级链路真被走到 + 产物名带 `.realtime` + **首/中/末帧 md5 两两不同**（这条是防"定格画面假绿"的唯一有牙判据）→ 贴输出后还原
- [ ] **Step 5: 台账**：`KNOWN-ISSUES` 明写"实时捕获的 A/V 同步是**近似的**（画面按墙钟、音轨按时间轴）"；spec §8 的"实时捕获已内建"措辞更正为"已实现，见 KNOWN-ISSUES"
- [ ] **Step 6: Commit** `feat(M5b): 实时捕获降级（真播放+录屏+音轨 mux）+ useAudioPlayer 策略拒绝的静默 stall 修复`

---

### Task 5: 导出服务（Vite 中间件 + 页面按钮）

**Files:**
- Create: `narration-video/templates/vite-plugins/export-service.ts`（`configureServer` 中间件；注入 `ExportJob`）+ 其 test
- Modify: `vite.config.ts`（挂插件，dev-only）
- Modify: `src/engine/Stage.tsx`（**新增**导出按钮：`onExport?` + 三态（idle/running/done）+ `data-testid="btn-export"`；不可达 → 提示）——**仓库当前没有导出按钮，这是新建不是修改**
- Modify: `src/App.tsx`（接线：fetch `/__export/*`，同源）
- Modify: `scripts/render.ts`（`RenderDeps` 追加 `onProgress?`；编排内按步上报 done/total）
- Test: `Stage.test.tsx`（按钮三态）、中间件测试（真 `fetch` 打本机 Vite）

**Interfaces:** 见"接口约定 5"

- [ ] **Step 1: 写失败测试**
```ts
it("POST /__export/run 触发一次；重复触发 → 409", async () => {});
it("GET /__export/status 状态机：idle → running → done；失败 → failed + message", async () => {});
it("同源中间件：非本机来源（伪造 Host）→ 403；正常同源 → 200", async () => {});
it("GET /__export/file：无产物 404；有产物 → Content-Disposition: attachment", async () => {});
it("进度来源：onProgress 注入被调用（done/total 单调递增至 total）", async () => {});
```
- [ ] **Step 2: RED → Step 3: 实现 → Step 4: GREEN**
- [ ] **Step 5: 真机**：起 dev server → 页面点按钮 → 真实渲染一次 → 取到 mp4；再关掉 dev server 验证按钮降级（贴 DOM 断言）
- [ ] **Step 6: Commit** `feat(M5b): 导出服务（Vite 同源中间件 + 页面导出按钮三态 + 进度注入）`

---

### Task 6: 收口（M5a 交接的护栏 + 文档）

**Files:**
- Modify: `scripts/storyboard/data.ts`（`STORYBOARD_THEME` 快照漂移护栏——**常量在 data.ts，不在 storyboard.ts**）+ `scripts/storyboard.test.ts`
- Modify: `scripts/shot/verify-sequential.ts` + `scripts/storyboard.ts`（§12 #6 负对照自动化：篡改参考图 → mismatch + 非零退出）
- Modify: `scripts/render.ts`（`--all-steps`：**参数而非改常量**——`SAMPLE_STEPS_MAX` 同时服务每次渲染的重采；且在模板 deck 上是 no-op，测试须用 **≥4 步的 fixture**）
- Modify: `research-notes/07-design-draft.md`（§12 M5b 行 + M5 遗留 #4/#6）、`research-notes/KNOWN-ISSUES.md`（K-76 因果修正 / K-82① ② ③ / K-83 / K-79 指针）
- Test: 全量回归

- [ ] **Step 1-2: 三条各自先写失败测试再实现**：
  - 主题快照漂移 → 改 `tokens.css` 一个色值 → 护栏必须报；
  - 负对照 → 篡改一张参考图 → `--verify-sequential` 必须 mismatch + 非零退出（**跑完还原**）；
  - `--all-steps` → ≥4 步 fixture 上采样面确实扩大；**判据口径修正**：负样本从"每对必须不同"改为"**有动画的步必须有非恒等对** + 静态步如实计数"（全 deck 化会把它弱化成"至少一对不同"）。
- [ ] **Step 3: 全量收口**：`npx vitest run`（**先热浏览器臂**，K-83）/ `tsc` / `npm run check` / `build` / `scaffold-smoke` / 真机两条成片（默认 + `--no-subs`）
- [ ] **Step 4: 文档**（先落盘再删工作区）：**明写三处裁决与更正**——① `--no-subs` 默认开是对 spec §9 "`--subs` 开关"字面的**默认值翻转**（理由：字幕天然进视频、与预览一致）；② **K-76 不因 `--all-steps` 收窄**（双渲测的是可复现性，不是"声明窗口 vs 真实播放"——要收窄需另测 `document.getAnimations().finishTime`，归 M6）；③ K-82③ 状态与阈值（**≥50ms 起手静音 + dwell ≥50ms** 触发；已修，含 +30ms 判别力反证）；④ K-79 的指针改指本计划 Task 4。
- [ ] **Step 5: Commit** `feat(M5b): 收口（主题快照护栏 + 负对照自动化 + --all-steps 可选扩面 + 文档裁决）`

---

## 执行环境注意

- M5a 既有约束照旧：**`npm run render -- …` 的 `--` 必带**；`--concurrency` 别开大；本机负载常高
- **Task 1 是唯一人工闸门**（用户审片 + 金样确认）
- **T4 的两个坑已由质检实测钉死**：`openSession` 恒加 `headless=1`（录不出东西）；`recordVideo` 出 webm/VP8/25fps/无音轨/时长按墙钟——实现者**不得**再走"取最简者"的自由裁量
- 本计划**不做**：真实 TTS provider（M6）、E2E（M6）、skill 封装命名（M7）

## 自检记录（writing-plans Self-Review · v2）

1. **Spec coverage**：§9（字幕进片 T3 / SRT T2 / 导出按钮+服务 T5）、§8 步骤 4（T4）、§11.2（金样 T1）、§12 #4（T6）、#6（T6）✓；M5a 交接的 K-82③（T1）、K-79（T4）、K-76（T6 的**因果修正**而非伪收窄）✓。不存在本计划覆盖不到的规格条目；"不做"三项归 M6/M7。
2. **两轮质检的修订（v1 → v2）**：采纳 **6 条 Critical + 14 条 Important**——C1#1/C1#2（实时捕获两条死因 → T4 全面重写 + **useAudioPlayer 产品缺陷**）、C2/I5（金样移出 templates）、C3（`runRender` 注入面改名 + 进度注入）、C4/I6（`--all-steps` 与 K-76 的错误因果断开）、C5（`synthesizeMockAudio` 追加字段 + T1 Files 补 CLI 两文件）、I1（K-82③ 的锚点修法按实测原型重写 + **在参考轨上找 onset** + 判别力反证）、I2（recordVideo 三条前提皆不成立）、I3（降级不得失声）、I4（导出服务定成 Vite 中间件）、I7（`?noSubs` 归一进 verify 重采）、I8（`--srt` 语义/空白串口径/入口按钮是新建/金样消费归属/M4 破坏性指引 → 指引只用 `npm run render`）。
3. **Placeholder scan**：无 TBD；接口给签名；两处曾写"取最简者"的（T4 录制路、T5 服务形态）已按实测**定死**，不再是裁量。
4. **Type consistency**：`MockAudioProfile`（T1）、`SrtCue`（T2 → T6 金样）、`REALTIME_LAUNCH_ARGS`/`RealtimeOptions`（T4）、`ExportJob`（T5）、`withNoSubs`（T3 → capture/verify 双端）。
5. **已知取舍**：① 金样入库绑定人工确认，T1 可能以 `DONE_WITH_CONCERNS` 收尾（设计意图）；② 降级产物不做帧级自校验（按定义不可确定复现）——但**必须**做"帧两两不同"的防假绿判据；③ 降级 A/V 同步为近似（画面墙钟、音轨时间轴），已登记；④ `--all-steps` 保持可选（默认全量会把每次渲染墙钟抬高一个量级——实测单帧重采中位 50ms）。
