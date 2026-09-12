// M5a Task 2 窗口预扫：动画窗口（`animMs`）的**唯一生产者**——整条渲染链的每步时长都从
// 这张表来（`buildTimeline` 的 `animMsByStep`）。它错了不会有人喊：窗口全 0 → 每步退化成
// 一张静态图（成片还是能出、"自校验"也全绿），窗口偏小 → 成片比音轨短、`-shortest` 把音频截掉。
// 故本模块的**错误契约是严格**（与消费面相反，见下）。
//
// ## 语义：声明面，不是实测播放时长
//
// 读数取自桥的 `audit().windowMs` = 引擎动画注册表声明的最大时长（`animationWindowMs()`）：
// render 态（`?render=1`）下动画"创建即冻结"，没有任何"实际播放了多少"可观测——声明上界
// 就是本流程的窗口（设计 §8.1 的取舍 ①）。`frameCountByStep` 是同一审计面的注册表容量
// （诊断用：某步窗口非 0 却没注册动画、或窗口 0 而注册表非空，报告里一眼看得出）。
//
// ## 与 `scripts/check/headless.ts` 的关系（**不是复用，是有意的双点采集**）
//
// 无头门禁的 #17（动画窗口 vs 音频）里有一段同款逐 step 采集，但它**内联在 `runHeadlessPass`
// 里**（与 console 窗口、收集器、finding 分级缠在一起），外提会改动 M3b 已验收的门禁编排。
// 本模块自建采集，T4 的捕捉期同源断言（`captured.animMs === timeline.animMs`）是两处读数
// 一致性的兜底——**真出现漂移就是抓到 bug**（例如一方忘了开场复位），不是设计冗余。
//
// ## 流程（每步一次，全程单会话）
//
// `openSession`（补 headless 归一；viewport 取 `stageConfig.dims`——3:4 档案不是 1920×1080）
// → 开场 `jumpTo(0,0)` + ready（防 localStorage 游标恢复的起点漂移）→ 逐 step：
// `jumpToStep` → `readyWithTimeout` → **游标回读**（`assertCursorMatch`）→ `auditAnimations`
// → 汇总 `flattenWindowScan`。会话由本模块 finally 关（失败路径不泄漏浏览器进程）。
//
// **URL 的渲染态由调用方给**：T7 用 `withRenderMode`（`scripts/check/headless.ts`）拼
// `?render=1`——本模块不代为归一（归一逻辑只此一份，重抄即漂移；headless 侧同此分工）。
//
// ## 依赖方向
//
// scripts/render → scripts/shot（会话面）+ src/engine（`stageConfig`）：仓库既有惯例
// （`scripts/ → src/`），本模块不被 src/ 反向 import。
//
// ## 何时该 throw
//
// 本模块是**生产面**：读数与 manifest 对不上、页面把游标带走了、页面给的数字是 NaN——
// 一律 throw（宁炸不静默）。宽松兜底（缺位当 0）是**消费面** `timeline.ts` 的契约
// （手写输入也得能渲染），两者有意不对称。

import { stageConfig } from "../../src/engine/runtime-config";
import {
  assertCursorMatch,
  auditAnimations,
  expandSpecs,
  jumpToStep,
  openSession,
  readCursor,
  readyWithTimeout,
} from "../shot/session";

// ── 接口（计划接口约定 3：跨任务冻结面） ──

export interface WindowScanResult {
  /** [chapterIndex][step] → 动画窗口 ms（`buildTimeline` 的 `animMsByStep` 就是这个形状） */
  animMsByStep: number[][];
  /** 同序：预扫时的注册表容量（诊断用，不参与时间轴计算） */
  frameCountByStep: number[][];
}

export interface ScanAnimationWindowsOptions {
  /**
   * 页面基址。headless 参数由 `openSession` 归一（幂等）；**渲染态（`render=1`）由调用方拼**
   * （T7：`withRenderMode(serve.url)`）——见文件头的分工说明。
   */
  url: string;
  /** 章节 manifest 的投影（结构上兼容 `ChapterDef`）：`steps` 即该章的窗口表长度 */
  chapters: readonly WindowScanChapter[];
}

export interface WindowScanChapter {
  steps: number;
}

/** 单步读数（页面审计面 → 纯函数入参；既是采集的中间形态，也是单测面）。 */
export interface WindowReading {
  chapter: number;
  step: number;
  /** `audit().windowMs`：注册表声明的最大时长（ms） */
  windowMs: number;
  /** `audit().registry`：注册表容量（诊断用） */
  frameCount: number;
}

// ── 纯函数（单测面） ──

/**
 * 非空护栏：`chapters` 为空**必须** throw，不能产出空表。
 *
 * 空表的现实成因几乎都是"manifest 没加载成功"（CLI 忘了挂 loader-hooks / import 失败被吞），
 * 而空表一路传下去的样子是：`animMsByStep = []` → 每步窗口读 0 → 全片静态帧 → 时长结构
 * 全错但**每一步都"成功"**（渲染器不会报错，自校验只看帧数与时长是否自洽——它们自洽）。
 * 这是本流程最贵的一种静默降级，故在入口就炸。
 */
function assertScannableChapters(chapters: readonly WindowScanChapter[], where: string): void {
  if (chapters.length === 0) {
    throw new Error(
      `${where}：chapters 为空——窗口预扫的空表会让每步动画窗口读 0（成片静默退化成静态帧流）；` +
        `请核对 chapters manifest 是否加载成功`,
    );
  }
}

/**
 * 逐 step 读数 → 窗口表（纯函数，可真机外单测）。
 *
 * 对位是**顺序对位**：读数须按 `expandSpecs` 的规范序（章节序 → 章内步序）逐条排列——
 * 顺序错了就是测错了帧，故逐条比对坐标，不符即 throw 并给出条号与双方坐标。
 * 长度不符 / `steps` 非法 / 页面给了 NaN·负数（跨 CDP 边界来的数字同样是不可信输入）同样 throw。
 */
export function flattenWindowScan(
  readings: readonly WindowReading[],
  chapters: readonly WindowScanChapter[],
): WindowScanResult {
  const where = "窗口预扫";
  assertScannableChapters(chapters, where);
  // 规范序 = 帧集合的唯一展开点（expandSpecs，与 capture/门禁同序）；steps 非法在此 throw
  const specs = expandSpecs(chapters);
  if (readings.length !== specs.length) {
    throw new Error(
      `${where}：读数条数 ${readings.length} ≠ 总步数 ${specs.length}（Σ chapters.steps）——` +
        `少一条即少一帧的窗口（该步成片冻住），多一条即对位全错；宁炸不静默`,
    );
  }

  const animMsByStep: number[][] = chapters.map(() => []);
  const frameCountByStep: number[][] = chapters.map(() => []);

  readings.forEach((r, i) => {
    const want = specs[i];
    if (r.chapter !== want.chapter || r.step !== want.step) {
      throw new Error(
        `${where}：第 ${i} 条读数坐标 章节 ${r.chapter} 第 ${r.step} 步 ≠ 规范序的 ` +
          `章节 ${want.chapter} 第 ${want.step} 步——读数顺序即对位（章节序 → 章内步序），` +
          `错位说明中途有步被跳过或页面把游标带走了`,
      );
    }
    if (!Number.isFinite(r.windowMs) || r.windowMs < 0) {
      throw new Error(
        `${where}：第 ${i} 条读数的 windowMs ${r.windowMs} 非法（须为有限非负数，ms）——` +
          `NaN/Infinity 会顺着 stepMs 污染整张时间轴（下游按 NaN 算时长）`,
      );
    }
    if (!Number.isInteger(r.frameCount) || r.frameCount < 0) {
      throw new Error(
        `${where}：第 ${i} 条读数的 frameCount ${r.frameCount} 非法（须为非负整数，注册表容量）`,
      );
    }
    animMsByStep[r.chapter].push(r.windowMs);
    frameCountByStep[r.chapter].push(r.frameCount);
  });

  return { animMsByStep, frameCountByStep };
}

// ── 真机采集（会话面） ──

/**
 * 预扫每步的动画窗口。空 `chapters` → 开浏览器**之前**就 reject（护栏见 assertScannableChapters）。
 *
 * 单会话顺序驱动（不开并行：窗口采集是秒级操作，浏览器启动才是成本，且并行会引入
 * "两个页面互不干扰"的额外断言面——帧流（T4）那层才有并行的收益）。
 */
export async function scanAnimationWindows(
  opts: ScanAnimationWindowsOptions,
): Promise<WindowScanResult> {
  assertScannableChapters(opts.chapters, "scanAnimationWindows");
  const specs = expandSpecs(opts.chapters);
  // viewport 取 stageConfig.dims（Global Constraints 的 3:4 档案：不是常量 1920×1080）
  const session = await openSession({ url: opts.url, viewport: stageConfig.dims });
  try {
    const page = session.page;
    // 开场复位：防 localStorage 游标恢复把起点挪到别的步（同一 context 的第二个页面实测开局 step 2）
    await jumpToStep(page, { chapter: 0, step: 0 });
    await readyWithTimeout(page, "窗口预扫：开场复位（章节 0 第 0 步）");

    const readings: WindowReading[] = [];
    for (const spec of specs) {
      const where = `窗口预扫：章节 ${spec.chapter} 第 ${spec.step} 步`;
      await jumpToStep(page, spec);
      await readyWithTimeout(page, where);
      // 游标回读：越界被 stepper 静默 clamp（要 (0,3) 得 (0,2)）时，采到的是**别的帧**的窗口
      // ——那是"这张表错了但没人知道"的典型入口，故与 capture/门禁同一判据（assertCursorMatch）。
      assertCursorMatch(spec, await readCursor(page));
      const audit = await auditAnimations(page);
      readings.push({
        chapter: spec.chapter,
        step: spec.step,
        windowMs: audit.windowMs,
        frameCount: audit.registry,
      });
    }

    return flattenWindowScan(readings, opts.chapters);
  } finally {
    await session.close();
  }
}
