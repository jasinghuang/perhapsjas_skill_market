// M5a Task 4 帧流捕捉：把每一步的**动画窗口逐帧 seek 出来截成 PNG**，静置段复用单帧
// （设计 §8 步骤 2 / §8.1 的"静置期单帧复用"与"step 级并行"）。
//
// 入参是 T1 的时间轴表（窗口已由 T2 预扫冻进 `animMs`）与 T3 的桥 seek 面；出参是
// `<outDir>/frames/<chapterId>/<step>/<%04d>.png` 帧目录 + `CapturedStep[]`（T5 的 concat 清单、
// T6 的自校验消费）。
//
// ## 硬约束（前序任务逐条挣来的，别丢）
//
// 1. **同源断言（assertWindowMatch）**：捕捉期从页面读到的窗口必须 `===` 时间轴里的值，不等即
//    throw。这是"窗口预扫 / 帧流采集两趟各说各话"的**唯一防线**——两趟各自都能"成功"，只有
//    把两个读数摆在一起才能发现它们不一致（窗口错 ⇒ 帧流错：多截少截帧 ⇒ 成片与音轨错位，
//    静置帧冻结在窗口中途 ⇒ 成片比音轨短）。
// 2. **帧数只认 `timeline.frameCount`**：本模块**不重算** `⌈animMs×fps/1000⌉`（那条式子只在
//    timeline.ts 有一份，重抄即漂移）。`framePaths` / `frameTimes` 只做"把 frameCount 拆成
//    窗口拍 + 静置拍"与"生成 frameCount 条路径"。
//    ⚠️ `window-scan` 的 `frameCountByStep` 是**注册表容量**（诊断），不是帧数——别用它。
// 3. **泄漏告警（Ruling R7）**：每步审计面 `unowned > 0` 或 render 下 `running > 0` → 该步记
//    `warnings`（列 `unownedHints`）并打到 stderr。纯章节层泄漏动画的步会读到 `windowMs=0`
//    （成片冻住）而自校验全绿——这个告警是唯一能看见它的地方（见 leakWarnings）。
// 4. **静置帧规则**：窗口拍 `k ∈ [0, frameCount−1)` 走 `seek(k·1000/fps)`；`holdMs > 0` 时最后
//    一张 `seek(animMs)`（时间轴已把这张算进 `frameCount`）。"落盘张数 === frameCount"由三重
//    保证：framePaths 生成 frameCount 条路径（1 起编）→ **写前清目录**（上一次渲的残留会让
//    张数变多）→ **写后回读目录**（assertFrameCountOnDisk；张数对不代表是同一批帧）。
// 5. **并行**：每 worker 一个 `openSession`（= **每 worker 一个浏览器进程**：`openSession`
//    内部是 `chromium.launch()`，无法共享），worker 池按 `partition(specs, concurrency)` 分片，
//    `concurrency` 默认 2。**worker 失败即整轮失败**（allSettled 汇总后 throw——不静默跳过任何步）。
//
// ## 只有渲染态才有定义
//
// URL 必须带 render 参数（`withRenderMode`，scripts/check/headless.ts）：非渲染态下动画自主
// 播放，seek 定位到截图之间动画还在走（截图是移动靶），帧流不再确定——故入口直接 throw。
//
// ## 逐帧的"落定"时序
//
// `seek` 是同步写样式/画布（cursorBridge.seek 契约），但**截图截的是合成器那一拍**：seek 之后
// 等两拍 rAF（paintAndSettle）再截，保证落盘的那张就是刚 seek 到的那一拍。
// **落定有上限**（`settleWithTimeout`，T7 收口）：`page.evaluate` 不吃 Playwright 的默认超时，
// 页面不产帧时帧流会永久挂住——vitest 有 300s 用例兜底，CLI 没有，故包一层 `Promise.race`。
//
// ## 依赖方向
//
// scripts/render → scripts/shot（会话面：含 `softwareGL` 的启动参数面）+ scripts/check
// （泄漏判据**复用** headless 的 `animationEscapeVerdict`——同一 predicate，不重抄）
// + src/engine（stageConfig、审计类型）。src/ 不反向 import scripts/。

import * as fs from "node:fs";
import type { Page } from "playwright";
import type { AnimationAudit } from "../../src/engine/cursorBridge";
import { stageConfig } from "../../src/engine/runtime-config";
import { animationEscapeVerdict } from "../check/headless";
import {
  assertChapterId,
  assertCursor,
  assertCursorMatch,
  assertCursorStill,
  auditAnimations,
  jumpToStep,
  openSession,
  readCursor,
  readyWithTimeout,
  seekTo,
  type ShotSpec,
} from "../shot/session";
import type { Timeline, TimelineStep as Step } from "./timeline";

// ── 接口（计划接口约定 4：跨任务冻结面） ──

/** 帧流的一步：游标坐标 + 章节目录名（帧目录 `frames/<chapterId>/<step>/` 的组成部分）。 */
export interface FrameSpec extends ShotSpec {
  chapterId: string;
}

/**
 * 一步的捕捉结果。`dir` 是**相对 outDir** 的帧目录（T5 的 concat 清单落在 `<outDir>/` 根，
 * 相对路径按清单文件所在目录解析——故给相对形）。
 *
 * `warnings` 是**追加字段**（M4-3 款"追加字段不破坏既有调用方"，主 agent 批准）：承载 Ruling R7
 * 的泄漏告警（每步一条人类可读整串，含定位与 unownedHints）。干净步 = 空数组（字段恒在，
 * 消费方不必区分 undefined）；T7 的 CLI 负责把它们打到 stderr。
 */
export interface CapturedStep extends FrameSpec {
  dir: string;
  frameCount: number;
  animMs: number;
  holdMs: number;
  /** 静置帧 seek 时刻（M6 字幕切块；与 TimelineStep.holdFrameMs 同值直传——编码层据此分块时长） */
  holdFrameMs: readonly number[];
  warnings?: readonly string[];
}

export interface CaptureFramesOptions {
  /** 页面基址；**必须已带 render 参数**（调用方用 `withRenderMode` 拼；headless 由 openSession 归一） */
  url: string;
  outDir: string;
  timeline: Timeline;
  /** 并行 worker 数（默认 2；每 worker 一个浏览器进程——本机负载常高，别开大） */
  concurrency?: number;
  /** 默认 `stageConfig.dims`（3:4 档案不是常量 1920×1080） */
  viewport?: { width: number; height: number };
  /** 软件渲染（§11.2 跨机像素稳定）：默认 false = 与既有管线逐字节相同的启动参数；渲染 CLI 传 true */
  softwareGL?: boolean;
  /** 调试：只渲 `specs` 下标的这些步（encode/verify 同步只处理这些步）。越界/为空 → throw */
  only?: readonly number[];
}

// ── 纯函数（单测面） ──

/**
 * 帧目录（**相对 outDir**）：`frames/<chapterId>/<step>`。
 * chapterId 走 session 的白名单（挡空串/分隔符/`.`/`..`——它直接进路径，且**写前清目录**要 rm
 * 这个路径）；step 走游标校验。拼接用 "/" 手拼（与 session.shotPath 同款取舍 3：该字符串同时
 * 是 T5 清单里的相对引用，反斜杠不进约定）。
 */
export function frameDir(chapterId: string, step: number): string {
  assertChapterId(chapterId, "frameDir：chapterId");
  assertCursor(step, "frameDir：step");
  return `frames/${chapterId}/${step}`;
}

/**
 * 帧文件清单：`<dir>/<%04d>.png`，**1 起编**（第 1 张 0001，第 frameCount 张补零到 4 位）。
 *
 * 非空护栏（throw）：`frameCount` 非正整数时清单为空——该步在成片里**凭空消失**（T5 的 concat
 * 清单少一段、T6 的断言按 ΣframeCount 算却对不上），而每一步都"成功"，故在入口就炸。
 */
export function framePaths(dir: string, frameCount: number): string[] {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error(
      `framePaths：frameCount ${frameCount} 非法（须为正整数）——空清单 = 该步在成片里凭空消失` +
        `（concat 清单少一段、自校验的 ΣframeCount 对不上），而流程不会自己报错；宁炸不静默`,
    );
  }
  const base = dir.replace(/[/\\]+$/, "");
  return Array.from(
    { length: frameCount },
    (_, i) => `${base}/${String(i + 1).padStart(4, "0")}.png`,
  );
}

/**
 * 逐帧时刻表（ms，步内相对时间）：前 `frameCount − (holdMs>0 ? 1 : 0)` 拍是窗口拍
 * `k·1000/fps`（k 从 0 起），`holdMs > 0` 时最后一张落在 `animMs`（静置/末态复用那一张）。
 *
 * **张数恒等于 `frameCount`**（输入即时间轴的值，本函数不重算窗口帧数——硬约束 2）。
 * `animMs` 只在"静置拍落在哪"这一处出现：holdMs>0 的步，末帧要盖住窗口之后的整段（静置 + 垫），
 * 画面停在窗口末态，故取 `animMs` 而不是别的值。
 */
export function frameTimes(
  frameCount: number,
  animMs: number,
  fps: number,
  holdFrameMs: readonly number[],
): number[] {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error(`frameTimes：frameCount ${frameCount} 非法（须为正整数）`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`frameTimes：fps ${fps} 非法（须为有限正数）`);
  }
  if (!Number.isFinite(animMs) || animMs < 0) {
    throw new Error(`frameTimes：animMs ${animMs} 非法（须为有限非负数，ms）`);
  }
  for (const t of holdFrameMs) {
    if (!Number.isFinite(t) || t < 0) {
      throw new Error(`frameTimes：holdFrameMs 含非法值 ${t}（须为有限非负数，ms）`);
    }
  }
  const windowFrames = frameCount - holdFrameMs.length;
  if (windowFrames < 0) {
    throw new Error(`frameTimes：holdFrameMs 长度 ${holdFrameMs.length} > frameCount ${frameCount}——静置帧不可能多过总帧数`);
  }
  const times: number[] = [];
  for (let k = 0; k < windowFrames; k++) times.push((k * 1000) / fps);
  times.push(...holdFrameMs);
  return times;
}

/**
 * 轮转分片（worker 池的唯一分片点）：第 i 片拿 `items[i], items[i+groups], …`。
 * 覆盖全部条目、互不重叠（这两条是"不静默漏步"的一半——另一半是装配后按 index 装回 + 缺口断言）。
 * 轮转而非连续切块：帧数按步差异极大（91 帧的动画步 vs 1 帧的静态步），连续切块会把重步堆在
 * 同一片；分片数多于条目时多出的片为空（消费方跳过空片，不为它开浏览器）。
 */
export function partition<T>(items: readonly T[], groups: number): T[][] {
  if (!Number.isInteger(groups) || groups < 1) {
    throw new Error(
      `partition：groups ${groups} 非法（须为正整数）——0 片 = 一步都不渲的空跑；` +
        `CLI 的 --concurrency 0 由 CLI 层归一为 1（计划 T7），本层不替它猜`,
    );
  }
  const out: T[][] = Array.from({ length: groups }, () => []);
  items.forEach((item, i) => out[i % groups].push(item));
  return out;
}

/**
 * 同源断言（硬约束 1）：捕捉期页面读到的窗口必须等于时间轴里的值。
 *
 * 为什么是"唯一防线"：预扫（T2）与采集（本模块）各自都能完整"成功"——只有把两个读数摆在一起
 * 才发现不一致。窗口偏小 ⇒ 成片比音轨短（mux `-shortest` 截掉音频）；窗口偏大 ⇒ 静置帧落在
 * 动画没走完的地方、成片与音轨错位。两者都不会让任何一步报错。
 */
export function assertWindowMatch(expectedMs: number, capturedMs: number, where: string): void {
  if (capturedMs !== expectedMs) {
    throw new Error(
      `${where}：捕捉期读到的动画窗口 ${capturedMs}ms ≠ 时间轴里的 ${expectedMs}ms——` +
        `窗口预扫与帧流采集两趟各说各话（本断言是唯一防线）。帧流按时间轴的窗口截，` +
        `两处不一致时落盘的帧流必然与音轨错位；请核对 URL 指向的 deck 与时间轴同源、` +
        `以及两次采集之间章节是否被改过`,
    );
  }
}

/**
 * 泄漏告警（Ruling R7）：判据是**门禁 #16 ③ 的同一 predicate**——`animationEscapeVerdict`
 * （scripts/check/headless.ts）的三个分支合起来 ≡ `unowned > 0 || (render && running > 0)`。
 * 复用而不是重抄：门禁侧改了判据，这里跟着走（frames.test.ts 的四张审计形状是那条复用的
 * 行程开关——门禁改判据会让它红）。**严重度不同**：门禁把 `unownedRunning>0` / render 下
 * `running>0` 升级为 blocker（不过 = 不能汇报），渲染期只记 warning（不阻断出片，但每步可见）。
 *
 * 为什么必须有（R7 的由来）：纯章节层泄漏的动画（手写 animate / CSS 动画）**不在引擎注册表里**
 * ⇒ 该步 `windowMs = 0` ⇒ 时间轴按 0 窗口算 ⇒ 成片那一步冻成一张静态图。而帧数、时长、自校验
 * 全都自洽（它们只看时间轴自己），**没有任何下游能发现**——这条 warning 是唯一能看见它的地方。
 * 因此 hints（`unownedHints`）必须一并列出来：那是排查者唯一的定位线索。
 */
export function leakWarnings(
  audit: AnimationAudit,
  opts: { renderMode: boolean; where: string },
): string[] {
  const { findings } = animationEscapeVerdict(audit, { renderMode: opts.renderMode });
  return findings.map((f) => `${opts.where}：${f.message}`);
}

/**
 * 渲染态判据：URL 是否带 render 参数（**has 语义**，不是取值——与 App.tsx 的
 * `params.has("render")`、headless 的 `withRenderMode` 逐字一致；`?render=0` 也算）。
 */
export function isRenderMode(url: string): boolean {
  return new URL(url).searchParams.has("render");
}

/**
 * 落盘回读（硬约束 4 的第三重）：目录里的 **PNG** 名单必须**逐条等于**计划清单。
 *
 * 只数张数不够：编号错位、换了扩展名、上一次渲的残留（帧数变小的步）都可能是"N 张"却不是同一批帧。
 * 写前清目录是这条成立的前提（见 captureStep 的 rmSync）。
 *
 * **只认 `*.png`**（非 PNG 的杂物不参与计数）：帧目录里落一个 `.DS_Store`（macOS 上浏览过
 * `render/` 就会）不该让下一次渲染失败——那是个只会浪费排查时间的假警报；而帧流的完整性只由
 * PNG 这批文件承载（T5 的清单逐条引用它们）。
 */
export function assertFrameCountOnDisk(
  dir: string,
  paths: readonly string[],
  where: string,
): void {
  const want = paths.map((p) => p.slice(p.lastIndexOf("/") + 1)).sort();
  const onDisk = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".png"))
    .sort();
  if (onDisk.length !== want.length || onDisk.some((n, i) => n !== want[i])) {
    throw new Error(
      `${where}：落盘帧数与计划不符——期望 ${want.length} 张（${want[0]}…${want[want.length - 1]}），` +
        `实际 ${onDisk.length} 张${onDisk.length > 0 ? `（${onDisk[0]}…${onDisk[onDisk.length - 1]}）` : ""}` +
        `——截图漏拍/被覆盖/上次残留都会落到这里（帧目录是 concat 清单的直接输入）`,
    );
  }
}

// ── 单步 / 单 worker / 编排 ──

/** 落定等待上限（ms）：超时即炸而不是永久挂住（见 `settleWithTimeout`）。 */
export const PAINT_SETTLE_TIMEOUT_MS = 5_000;

/**
 * 等 `p` 落定；超过 `ms` → 抛带 `where` 定位的错误。
 *
 * 为什么必须有这个上限（T4 评审点名，T7 收口落地）：`page.evaluate` **不吃** Playwright 的
 * 默认超时——页面不产帧时（合成器停摆 / 渲染被冻结 / 页面停在了别的 URL）等落定会**永久挂住**。
 * vitest 全套还有 300s 的用例兜底，`npm run render` 的 CLI **没有**——它会一直挂着，不报错、
 * 不退出，看起来像"渲染很慢"。上限取 5s：正常落定是两拍 rAF（毫秒级），5s 只会在真出问题时命中。
 */
export async function settleWithTimeout<T>(p: Promise<T>, ms: number, where: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `${where}：等两拍 rAF 落定超时（${ms}ms）——page.evaluate 不吃 Playwright 的默认超时，` +
              `页面不产帧时帧流会永久挂住（渲染态未冻结 / 合成器停摆 / 页面停在了别的 URL）；` +
              `宁炸不静默（CLI 没有 vitest 的用例超时兜底）`,
          ),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer); // 落定后就撤掉定时器：不给 event loop 留悬挂的 handle
  }
}

/**
 * 等两拍 rAF：`seek` 之后截图前的那一下"落定"。
 *
 * seek 是同步写样式/画布，但截图截的是**合成器的那一拍**——不等一拍就可能落盘上一拍（第 k 张
 * 帧里是第 k−1 个 t 的画面，整条帧流系统性偏一拍，且两趟采集会一致地偏，跨会话逐字节检查反而
 * 全绿）。两拍：第一拍的 rAF 回调跑完才轮到 paint，第二拍回调时上一拍已产出。
 *
 * `where` 只进超时错误文案，**已导出**：T7 的确定性终验（scripts/render.ts）逐帧重采要同一份
 * 落定语义——两处各写一份 evaluate 就是两条会漂移的时序。
 */
export async function paintAndSettle(page: Page, where: string): Promise<void> {
  // 废帧强制光栅（M6 字体竞态的根治半面）：极端负载下 rAF 回调 ≠ paint——本帧的
  // 光栅化会触发字幕换块引发的**字体子集按需加载**（fontsource 只加载实际用到的
  // 字形区间）。若先查 fonts 再截图，加载可能还没开始，截图落在 fallback 字形上
  // 且落点随负载随机 → 跨会话重采 md5 不一致（全量真机臂实测复现）。
  await settleWithTimeout(
    (async () => {
      await page.screenshot(); // 废帧（不落盘）：强制一次完整光栅
      await page.evaluate(async () => {
        const twoFrames = () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        // 稳定等待：连续两轮"非 loading"才放行（loading 时等 fonts.ready 重来，
        // 最多 6 轮——超时由外层 settleWithTimeout 兜底）
        for (let round = 0, stable = 0; round < 6 && stable < 2; round++) {
          await twoFrames();
          const loading = document.fonts.status === "loading";
          if (loading) {
            await document.fonts.ready;
            stable = 0;
          } else {
            stable++;
          }
        }
      });
    })(),
    PAINT_SETTLE_TIMEOUT_MS,
    `${where} 的落定（废帧强制光栅 + 字体子集稳定等待）`,
  );
}

/** 单帧：seek(t) → 等一拍落定 → 截图（不做 `animations: "disabled"`，同 capture.ts 取舍 1）。 */
async function shootAt(page: Page, tMs: number, file: string, where: string): Promise<void> {
  await seekTo(page, tMs);
  await paintAndSettle(page, where);
  await page.screenshot({ path: file });
}

/** 单步捕捉（一个 worker 内顺序执行；`)` 内的每个 await 失败即整轮失败）。 */
async function captureStep(
  page: Page,
  spec: FrameSpec,
  step: Step,
  opts: CaptureFramesOptions,
  renderMode: boolean,
): Promise<CapturedStep> {
  const where = `章节 ${spec.chapter} 第 ${spec.step} 步（${spec.chapterId}）`;

  await jumpToStep(page, spec);
  await readyWithTimeout(page, where);
  // 游标回读：越界被 stepper 静默 clamp（要 (0,3) 得 (0,2)）→ 之后截的是**别的帧**的图
  assertCursorMatch(spec, await readCursor(page));

  // 同源断言读在最前：窗口对不上就没有"这一拍该截什么"可言，先炸（不白截 91 张）
  const auditAtCapture = await auditAnimations(page);
  assertWindowMatch(step.animMs, auditAtCapture.windowMs, where);

  // 归位（M5 遗留 #2）：render 态 canvasAnim 创建即冻结、**从未 draw**，DOM 停在"未 draw 初始态"
  // （T3 实测 .cdp-kenburns-inner 的 transform 是 none，而 t=0 组合态是 scale(1) translate(-2%,0)）。
  // 帧循环的首拍也是 t=0（幂等）——显式保留是为了让"未 seek 的初始态"在代码里没有生存空间。
  await seekTo(page, 0);

  const dir = frameDir(spec.chapterId, spec.step);
  const framesRoot = `${opts.outDir.replace(/[/\\]+$/, "")}/frames`;
  const writeDir = `${framesRoot}/${spec.chapterId}/${spec.step}`;
  // 清目录前的兜底（rmSync 是破坏性操作）：路径必须仍在 <outDir>/frames/ 之内。
  // chapterId 已过白名单（无分隔符/`.`/`..`）、step 已过游标校验，这条是"万一"的那层保险。
  if (!writeDir.startsWith(`${framesRoot}/`)) {
    throw new Error(`${where}：帧目录越界（${writeDir} 不在 ${framesRoot}/ 内）——拒绝清目录`);
  }
  const paths = framePaths(writeDir, step.frameCount);
  const times = frameTimes(step.frameCount, step.animMs, opts.timeline.fps, step.holdFrameMs);

  // 写前清目录：上一次渲的残留帧（帧数变小的步）会让"落盘张数 === frameCount"变成假话
  fs.rmSync(writeDir, { recursive: true, force: true });
  fs.mkdirSync(writeDir, { recursive: true });
  for (let i = 0; i < paths.length; i++) await shootAt(page, times[i], paths[i], where);
  assertFrameCountOnDisk(writeDir, paths, where);

  // 泄漏告警（R7）：读在帧循环**之后**——它要看见的是这一整段捕捉期里的动画状态；同时它也是
  // 每步最后一次审计读数（同源断言的读数在循环前，两者各自独立取值，不互相兜底）
  const warnings = leakWarnings(await auditAnimations(page), { renderMode, where });
  for (const w of warnings) console.warn(`[frames] ${w}`);

  // 截图后回读：截图窗口里页面自驱推进会把游标带走（落盘的是别的步，而帧数照样对得上）
  assertCursorStill(spec, await readCursor(page));

  return {
    chapter: spec.chapter,
    step: spec.step,
    chapterId: spec.chapterId,
    dir,
    frameCount: step.frameCount,
    // 捕捉期读到的窗口（已被 assertWindowMatch 证明 === 时间轴的值）——不是时间轴值的复制，
    // 这样"两趟一致"是**测出来的**，而不是把同一个变量抄两遍
    animMs: auditAtCapture.windowMs,
    holdMs: step.holdMs,
    holdFrameMs: step.holdFrameMs,
    warnings,
  };
}

interface IndexedSpec {
  spec: FrameSpec;
  index: number;
  step: Step;
}

/** 一个 worker：一个会话（= 一个浏览器进程）+ 一组步，顺序捕捉；失败向上抛（整轮失败）。 */
async function runWorker(
  group: readonly IndexedSpec[],
  opts: CaptureFramesOptions,
  renderMode: boolean,
  viewport: { width: number; height: number },
): Promise<Array<{ index: number; captured: CapturedStep }>> {
  // 空片不为它开浏览器（分片数 > 步数时会出现）
  if (group.length === 0) return [];
  const session = await openSession({
    url: opts.url,
    viewport,
    softwareGL: opts.softwareGL === true,
  });
  try {
    const out: Array<{ index: number; captured: CapturedStep }> = [];
    for (const { spec, index, step } of group) {
      out.push({ index, captured: await captureStep(session.page, spec, step, opts, renderMode) });
    }
    return out;
  } finally {
    await session.close();
  }
}

/** 时间轴里取该步（渲的不是这张表里的帧 = 整个产物对不上账，宁炸）。 */
function timelineStepFor(timeline: Timeline, spec: FrameSpec): Step {
  const step = timeline.steps.find((s) => s.chapter === spec.chapter && s.step === spec.step);
  if (step === undefined) {
    throw new Error(
      `帧流捕捉：时间轴表里没有 章节 ${spec.chapter} 第 ${spec.step} 步——帧流只渲时间轴里的步` +
        `（表是 T1 由 manifest + durations + timing.json + 窗口表算出来的唯一时长源）；` +
        `请核对 specs 是否由 timeline.steps 构造`,
    );
  }
  if (step.chapterId !== spec.chapterId) {
    throw new Error(
      `帧流捕捉：章节 ${spec.chapter} 第 ${spec.step} 步的 chapterId 不符——spec 给的是` +
        ` ${JSON.stringify(spec.chapterId)}，时间轴表里是 ${JSON.stringify(step.chapterId)}；` +
        `帧目录名（frames/<chapterId>/…）是 T5 清单的相对引用，对不上就是引到别的目录`,
    );
  }
  return step;
}

/** `only` → 待渲的下标集合（按 specs 序；顺序即产物顺序——不按调用方给的次序，否则成片会乱序）。 */
function selectIndices(specs: readonly FrameSpec[], only: readonly number[] | undefined): number[] {
  if (only === undefined) return specs.map((_, i) => i);
  const wanted = new Set<number>();
  for (const i of only) {
    if (!Number.isInteger(i) || i < 0 || i >= specs.length) {
      throw new Error(
        `captureFrames：only 下标 ${i} 非法（须是 specs 的整数下标，specs 长度 ${specs.length}）` +
          `——越界下标会静默渲零步（调试开关最坏的体验），宁炸`,
      );
    }
    wanted.add(i);
  }
  if (wanted.size === 0) {
    throw new Error("captureFrames：only 为空——一步都不渲的空跑（成片会没有帧可编码）");
  }
  return specs.map((_, i) => i).filter((i) => wanted.has(i));
}

/**
 * 捕捉帧流：`specs` 的每一步 → `frames/<chapterId>/<step>/<%04d>.png`，返回按 `specs` 序的
 * `CapturedStep[]`（`only` 时只含被渲的步，顺序仍是 specs 序）。
 *
 * 全部护栏在**开浏览器之前**（fail fast：参数错不该先花一次浏览器启停）——空 specs / 非渲染态
 * URL / 重复步 / 时间轴缺步 / chapterId 不符 / concurrency 非法 / only 越界或为空 / frameCount 非法。
 *
 * 并行：`partition` 轮转分片 → 每片一个 worker（一个浏览器进程，`concurrency` 默认 2）→
 * `allSettled` 汇总：**任一 worker 失败即整轮 throw**（聚合全部失败原因；不静默跳过任何步）。
 * 结果按原下标装回，故与 worker 数、分片方式无关（顺序只由 specs 定）。
 */
export async function captureFrames(
  specs: readonly FrameSpec[],
  opts: CaptureFramesOptions,
): Promise<CapturedStep[]> {
  // ── 护栏（全部早于 openSession） ──
  if (specs.length === 0) {
    throw new Error(
      "captureFrames：specs 为空——渲出零帧是静默降级（帧目录空、concat 清单空，成片没有一段" +
        "来自本 deck），而下游每一步都会成功；宁炸不静默",
    );
  }
  const renderMode = isRenderMode(opts.url);
  if (!renderMode) {
    throw new Error(
      `captureFrames：URL 不在渲染态（缺 render 参数）：${opts.url}——非渲染态下动画自主播放，` +
        `seek 定位到截图之间动画还在走（截图是移动靶），帧流不再确定；请用 withRenderMode(url)` +
        `（scripts/check/headless.ts 已导出）拼 URL`,
    );
  }
  const concurrency = opts.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `captureFrames：concurrency ${concurrency} 非法（须为正整数）——0/负数会一步都不渲或除零；` +
        `CLI 的 --concurrency 0 由 CLI 层归一为 1（计划 T7）`,
    );
  }

  const chosen = selectIndices(specs, opts.only);
  const seen = new Set<string>();
  const indexed: IndexedSpec[] = chosen.map((index) => {
    const spec = specs[index];
    const where = `captureFrames：章节 ${spec.chapter} 第 ${spec.step} 步`;
    // 先验 spec 自身的形状（游标 + chapterId 白名单，帧目录名的唯一来源也是写前清目录的目标），
    // 再与时间轴对表（缺步 / chapterId 不符）——错误文案按"谁的问题"分层
    assertCursor(spec.chapter, `${where}的 chapter`);
    assertCursor(spec.step, `${where}的 step`);
    const dir = frameDir(spec.chapterId, spec.step);
    const key = `${spec.chapter}:${spec.step}`;
    if (seen.has(key)) {
      throw new Error(
        `${where}：specs 里有重复的 章节 ${spec.chapter} 第 ${spec.step} 步——同一步渲两遍` +
          `（同一帧目录被写两次、成片里那一段出现两次），而张数/时长自校验都照样通过`,
      );
    }
    seen.add(key);
    const step = timelineStepFor(opts.timeline, spec);
    // 帧数/时刻表护栏（空清单 = 该步在成片里凭空消失）：在开浏览器之前就炸（真正的清单在
    // captureStep 里生成，这里只是提前过一遍这两条纯函数，错误带定位且不晚于开浏览器）
    framePaths(dir, step.frameCount);
    frameTimes(step.frameCount, step.animMs, opts.timeline.fps, step.holdFrameMs);
    return { spec, index, step };
  });

  // ── 并行（每 worker 一个浏览器进程） ──
  const viewport = opts.viewport ?? stageConfig.dims;
  const groups = partition(indexed, concurrency);
  const settled = await Promise.allSettled(
    groups.map((group) => runWorker(group, opts, renderMode, viewport)),
  );
  const failed = settled
    .map((r, i) => ({ r, i }))
    .filter((x): x is { r: PromiseRejectedResult; i: number } => x.r.status === "rejected");
  if (failed.length > 0) {
    const detail = failed
      .map(({ r, i }) => {
        const steps = groups[i]
          .map(({ spec }) => `章节 ${spec.chapter} 第 ${spec.step} 步`)
          .join("、");
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        return `  · worker #${i}（${steps}）：${reason}`;
      })
      .join("\n");
    throw new Error(
      `帧流捕捉失败：${failed.length}/${groups.length} 个 worker 出错（整轮失败——不静默跳过任何步）\n${detail}`,
    );
  }

  // 结果按**原下标**装回（顺序只由 specs 定，与分片方式、worker 数无关）
  const byIndex = new Map<number, CapturedStep>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const { index, captured } of r.value) byIndex.set(index, captured);
  }
  const assembled = indexed.map(({ index }) => byIndex.get(index));
  const missing = assembled.filter((c) => c === undefined).length;
  if (missing > 0) {
    // 不会发生（worker 要么全成要么整轮 throw）；留在这里是防"装配悄悄少步"这类改动变成静默
    throw new Error(
      `帧流捕捉：装配后缺步 ${missing} 个（渲回 ${byIndex.size} 步，期望 ${indexed.length} 步）——` +
        `specs 与 worker 的装回对不上，宁炸`,
    );
  }
  return assembled as CapturedStep[];
}
