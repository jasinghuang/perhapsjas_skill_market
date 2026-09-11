/**
 * headless：无头 pass 编排（M3b Task 7，§11.1 #16「无头 seek pass」的落地）。
 *
 * 流程：自起 Vite（或显式 `--url` 复用）→ `?render=1&headless=1` 开会话（**创建即冻结 +
 * 干净帧**，Global Constraints 的"确定性优先"）→ 开场显式 `jumpTo(0,0)` + `ready()` →
 * `expandSpecs(chapters)` 逐 step：`jumpToStep` → `readyWithTimeout` → `readCursor` 校验
 * （复用 `assertCursorMatch`，越界被 stepper 静默 clamp 时不至于悄悄检查错帧）→ 采数据
 * （溢出收集器 + `audit()` 动画审计）→ 归 Finding。
 *
 * ## #16 三断言（计划逐条，本文件是唯一实现点）
 *
 * ① **console**：blocker **只认 `pageerror` 与 `console.error`**（本页脚本来源）；
 *    `m.location().url` 非本页脚本的浏览器 Log 类消息（弃用告警 / CSP / 非 passive 监听器）
 *    → **info 并计数**，不报 warning。
 *    **监听自导航前挂起**（`openSession({ beforeGoto })`，修复轮 1 / I1）：页面装载期
 *    （Vite client / React 首帧挂载 / 首步 effect）的事件在 `openSession` 返回前就已发完
 *    ——晚挂即永久丢失（实测：`useEffect(…, [])` 里的 `console.error` 曾整条漏报）。
 *    归因窗口 = **每步在"该步采集完成"时取走并清空缓冲**：
 *      · **首步窗口 = 页面装载 → 首步采集完成**（含装载期与开场 `jumpTo(0,0)`）；
 *      · 其余步窗口 = 上一步采集完成 → 本步采集完成（含本步 `jumpTo→ready`）。
 *    即每步只对"自上次取走以来"的消息负责——上一步的消息不会被重算到下一步头上
 *    （跨步不累积、不迁移）；**没有任何消息被无条件丢弃**，噪音靠分级（log/info 级忽略、
 *    warning 级计 info、error 级才判 blocker）而不是靠丢窗口。
 *    ⚠ 如实标注两处口径（修复轮 1 / M2 更正）：
 *      · 报错文本说的"该步窗口"包含 `jumpTo→ready` 渲染期——章节层的 console.error 绝大多数
 *        正发生在**该步挂载渲染/effect** 时；只认 `ready()` 之后的字面读法抓不到它们。
 *      · 两步之间滞后的消息会算进**下一步**（窗口边界是"采集完成"而非"导航开始"）。
 * ② **被画布截断** → blocker（`collectors.ts` 的 `COLLECT_OVERFLOW_SRC`）。
 * ③ **动画逃逸**：`audit.unownedRunning > 0` 或 render 下 `audit.running > 0` → **blocker**；
 *    `unowned > 0` 但**未在跑**（CSS transition 残影）→ **warning** 并列 hints
 *    （收窄理由：一刀切会把任何 CSS transition 判成逃逸）。
 *
 * ## 非空护栏（Global Constraints 唯一定级）
 *
 * `examined === 0` 在**收集器级**（全 deck 累计）→ blocker（收集器什么都没检查到）；
 * **步级零元素合法**（该步没有这类元素）。收集器自身另有"找不到画布根 → blocker"
 * （那是"收集器没有检查面"，与"这一步没有元素"不同——见 collectors.ts）。
 * Task 8 起**按收集器分列**（T7 评审 M5）：合计句会把"某个收集器整体失效"掩在别家的大数字里，
 * 故溢出 / 安全边距 / 对比度各要一次自己的护栏，读数也分列输出。
 *
 * ## Task 8 追加的三条（§11.1 #20 / #18 / #14 的无头半边）
 *
 * 逐 step 的两条（与 #16 的溢出收集器同批采集，归位语义相同）：
 *   · **#20 文字安全边距**（warning，`COLLECT_SAFE_MARGINS_SRC`）——参数 `SAFE_MARGIN_ARGS`
 *     由 `safeMarginArgs(stageConfig.safeArea, stageConfig.dims)` 构造：安全带的每个数字都来自
 *     单一源 `src/engine/safe-area.ts`（本文件与收集器都不出现 96/112/934 的副本）。
 *   · **#18 对比度**（warning，`COLLECT_CONTRAST_SRC`）——`CONTRAST_ARGS`（自身底色优先 +
 *     transparent 才祖先链采样；渐变/图片背景 → info）。
 * 全套步跑完后做一次的：
 *   · **#14 字体加载**（blocker 半边 + 无主题字体文本 → info，`COLLECT_FONTS_SRC`）——
 *     字体加载**跨步累积**，逐 step 采会读出半张脸；中止（游标失配）时**不判**：
 *     部分步的使用面会造出"加载了没人用"的假 blocker（读数额外标注）。
 *
 * ## Task 9 追加的两条（§11.1 #17 / #19 节奏检查）
 *
 * 判据在 `tempo.ts`（纯函数，单测面）；本文件只负责"给数据"与"归袋"：
 *   · **#19 音频段 ≥15s**（warning，durations 扫描）——**开浏览器之前**先跑（不需要浏览器），
 *     故"无 step 可跑"的早退路径照样出结论；
 *   · **#17 动画窗口 vs 音频**（warning）——逐 step 采集 `audit().windowMs`（帧键 = `frameKey`），
 *     全套步跑完后判一次（与 #14 同款"跑完再判"）。口径是**声明面比较**（注册表声明上界 vs
 *     音频时长；render 冻结态下无从实测播放时长）——见 tempo.ts 文件头。
 * 音频对位**与分镜同源**（`resolveAudioMs` 从 storyboard/data.ts 外提导出）；durations 缺失 =
 * 合法态（两条都静默不报）；文件读坏 = 读数 + 跳过（真因归 fast 层的音频完整性条目，不两处判级）。
 *
 * ## 环境前置
 *
 * 需要 Chromium（`npx playwright install chromium`，snapshot 在 session.ts 的错误文案里）；
 * 默认**自起** Vite，从不探活复用外部服务（见 serve.ts 文件头的实测教训）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import type { ChapterDef } from "../../src/chapters/manifest";
import type { AnimationAudit } from "../../src/engine/cursorBridge";
import { stageConfig } from "../../src/engine/runtime-config";
import { normalizeDurations, resolveAudioMs, type AudioDurations } from "../storyboard/data";
import {
  assertCursorMatch,
  auditAnimations,
  expandSpecs,
  jumpToStep,
  openSession,
  readCursor,
  readyWithTimeout,
  withHeadless,
  type Session,
  type ShotSpec,
} from "../shot/session";
import {
  COLLECT_CONTRAST_SRC,
  COLLECT_FONTS_SRC,
  COLLECT_OVERFLOW_SRC,
  COLLECT_SAFE_MARGINS_SRC,
  CONTRAST_ARGS,
  CONTRAST_RULE,
  FONT_RULE,
  SAFE_MARGIN_RULE,
  STAGE_SELECTOR,
  diffFamilies,
  safeMarginArgs,
  unionFamilies,
  type CollectorFinding,
  type CollectorResult,
  type FontsSample,
} from "./collectors";
import { FindingBag, type Finding } from "./findings";
import { startServe, type ServeHandle } from "./serve";
import {
  MIN_SEGMENT_MS,
  audioTempoStats,
  checkAnimationWindow,
  checkAudioTempo,
  frameKey,
  type TempoFrame,
} from "./tempo";

// ── 接口（接口约定 3：跨任务冻结面） ──

export interface HeadlessOptions {
  /** 显式指定才复用外部服务；缺省 = 进程内自起（见 serve.ts） */
  url?: string;
  chapters: readonly ChapterDef[];
  repoRoot: string;
  /** 只跑指定章节（调试；会改变跨步累积量——#14 字体面在 Task 8 依赖全量跑） */
  only?: readonly number[];
}

// ── console 采集（页面事件 → 可判定的原始消息） ──

export interface RawConsoleEvent {
  kind: "pageerror" | "console";
  /** console 的 type（pageerror 恒 "error"）；Playwright 取值为 "log" | "warning" | "error" | … */
  level: string;
  text: string;
  /** console 的 source url（pageerror 无从取得 → 空串） */
  locationUrl: string;
}

/** 消息缓冲（归因窗口的载体）：`drain()` 取走并清空；`clear()` 丢弃（框架期/中止时）。 */
export class ConsoleWindow {
  private events: RawConsoleEvent[] = [];

  push(event: RawConsoleEvent): void {
    this.events.push(event);
  }

  drain(): RawConsoleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  clear(): void {
    this.events = [];
  }

  size(): number {
    return this.events.length;
  }
}

/**
 * 该 console 消息是否来自**本页脚本**（#16 ①的归因判据）。
 * 判据（宁可把噪音降级也不误判为 blocker 的方向写在明处）：
 *   · 空 URL / 非 http(s)（data: / about: / chrome:）→ 浏览器自身日志；
 *   · 异源 → 不是本页；
 *    · 与**文档 URL 同址**（含 query）→ 浏览器上报（CSP / 弃用告警常挂文档 URL）或内联脚本；
 *    · 同源且路径像脚本（.js/.mjs/.cjs/.ts/.tsx/.jsx 扩展名，或 Vite 的 `/@…` 虚拟模块）
 *      → 本页脚本。
 */
export function isPageScriptLocation(locationUrl: string, pageUrl: string): boolean {
  if (locationUrl === "") return false;
  let target: URL;
  let page: URL;
  try {
    target = new URL(locationUrl);
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return false;
  if (target.origin !== page.origin) return false;
  if (target.pathname === page.pathname) return false; // 文档自身 URL：浏览器上报 / 内联
  if (target.pathname.startsWith("/@")) return true; // Vite 虚拟模块（/@vite/client 等）
  return /\.(?:js|mjs|cjs|ts|tsx|jsx)$/.test(target.pathname);
}

export interface ConsoleTriage {
  blockers: RawConsoleEvent[];
  infos: RawConsoleEvent[];
}

/**
 * 分级（#16 ①）：pageerror 与本页 console.error → blocker；其余**可计数**的（浏览器 Log 类、
 * 本页 console.warn）→ info；log/debug/info 级别直接忽略（不是本断言的关注面）。
 */
export function triageConsoleEvents(
  events: readonly RawConsoleEvent[],
  pageUrl: string,
): ConsoleTriage {
  const blockers: RawConsoleEvent[] = [];
  const infos: RawConsoleEvent[] = [];
  for (const e of events) {
    if (e.kind === "pageerror") {
      blockers.push(e);
      continue;
    }
    if (e.level === "error") {
      if (isPageScriptLocation(e.locationUrl, pageUrl)) blockers.push(e);
      else infos.push(e); // 浏览器 Log 类：info 并计数（不报 warning）
      continue;
    }
    if (e.level === "warning") infos.push(e);
  }
  return { blockers, infos };
}

// ── 纯判据（归 Finding / 分级） ──

export interface StepVerdict {
  /** 判级项（进 FindingBag，blocker 决定退出码） */
  findings: Finding[];
  /** 计数项（info：不可判定 / 环境噪音 / 采集面读数——展示但不进退出码） */
  notes: string[];
}

export interface StepSample {
  spec: ShotSpec;
  chapterId: string;
  consoleEvents: readonly RawConsoleEvent[];
  overflow: CollectorResult;
  audit: AnimationAudit;
  /** #20 文字安全边距（Task 8 追加；缺省 = 该步未采 → 跳过这一面，旧调用方/单测不必改） */
  safeMargins?: CollectorResult;
  /** #18 对比度（Task 8 追加；同上） */
  contrast?: CollectorResult;
}

export interface JudgeContext {
  pageUrl: string;
  /** render 模式（本 pass 恒 true；留参数是为了"render 下 running 才是 blocker"这条判据可测） */
  renderMode: boolean;
}

/** 步定位（finding 的 location 前缀——报告要能直接指出"哪一步"）。 */
export function frameLocation(spec: ShotSpec, chapterId: string): string {
  return `章节 ${spec.chapter} 第 ${spec.step} 步（${chapterId}）`;
}

/** 单条消息 → 人类可读行（文本截断，防巨型堆栈撑爆报告）。 */
function describeEvent(e: RawConsoleEvent): string {
  const text = e.text.length > 300 ? `${e.text.slice(0, 300)}…` : e.text;
  const where = e.locationUrl === "" ? "" : `（来源 ${e.locationUrl}）`;
  return `${text}${where}`;
}

/** console 面 → findings / notes（#16 ①）。 */
export function consoleVerdict(
  spec: ShotSpec,
  chapterId: string,
  events: readonly RawConsoleEvent[],
  pageUrl: string,
): StepVerdict {
  const { blockers, infos } = triageConsoleEvents(events, pageUrl);
  const where = frameLocation(spec, chapterId);
  const findings: Finding[] = blockers.map((e) => ({
    rule: e.kind === "pageerror" ? "运行期报错" : "控制台报错",
    severity: "blocker" as const,
    location: `${where} · ${e.kind === "pageerror" ? "pageerror" : "console.error"}`,
    // 文案与实际窗口一致（修复轮 1 / M2：此前写"该步就绪后本步期间"，而报出的消息几乎都发生在
    // ready() **之前**——该步窗口含 jumpTo→ready，首步还含页面装载期）。
    message:
      `${describeEvent(e)}——该步窗口（首步自页面装载起、其后自上一步采集完成起；` +
      `含本步 jumpTo→ready 渲染期）内抛出的本页脚本报错（#16 ①：无头 pass 逐 step 断言）`,
  }));
  const notes = infos.map((e) => `${where} · [info] ${describeEvent(e)}`);
  return { findings, notes };
}

/**
 * 收集器结果 → findings / notes（收集器级通用：溢出 / 安全边距 / 对比度共用同一归位语义——
 * 定位到步 + 元素描述；info 档走 note 通道，计数但不进退出码）。
 */
export function collectorVerdict(
  spec: ShotSpec,
  chapterId: string,
  result: CollectorResult,
): StepVerdict {
  const where = frameLocation(spec, chapterId);
  const findings: Finding[] = [];
  const notes: string[] = [];
  for (const cf of result.findings as readonly CollectorFinding[]) {
    if (cf.severity === "info") {
      notes.push(`${where} · [info] ${cf.rule} ${cf.location} ${cf.message}`);
      continue;
    }
    findings.push({
      rule: cf.rule,
      severity: cf.severity,
      location: `${where} · ${cf.location}`,
      message: cf.message,
    });
  }
  return { findings, notes };
}

/** 溢出收集器结果 → findings / notes（#16 ②；`collectorVerdict` 的具名别名，T7 面不动）。 */
export function overflowVerdict(
  spec: ShotSpec,
  chapterId: string,
  result: CollectorResult,
): StepVerdict {
  return collectorVerdict(spec, chapterId, result);
}

/** #14 的判定输入：加载面（终帧读一次）+ 使用面（**全 deck 并集**）+ 读数。 */
export interface FontsVerdictInput {
  /** `document.fonts` 中 `status === "loaded"` 的家族（**全 deck 跑完后**读一次：加载跨步累积） */
  loadedFamilies: readonly string[];
  /** 渲染文本用到的家族（**全 deck 跨步并集**：`unionFamilies` 求，不是末帧那一张脸） */
  usedFamilies: readonly string[];
  fontFaceCount: number;
  familyCount: number;
  /** 全 deck 采样面累计（读数：渲染文本元素数） */
  examined: number;
}

/**
 * #14 字体面 → findings / notes（Task 8；**无步定位**：字体加载跨步累积，全套步跑完后才判一次）。
 *
 * 判据（修复轮 1 / C1 重新推导，语义写死在这里）：
 *   · **使用面 = 全 deck 跨步并集**。字体是惰性加载的，`status === "loaded"` 本身就是"曾经被
 *     用过"的证明；只采末帧会把"只在开场步出现的 display 字体 / 只在代码步出现的 mono"判成
 *     "加载了没人用"——真实 deck 上必假报（评审复现）。故每 step 采一次、Node 侧求并集。
 *   · `loaded ⊄ used` → **blocker**（真"加载了没人用"：主题声明与真实排版漂移）。这条在并集
 *     语义下**更难触发但没消失**——eager-load（`document.fonts.load`）、伪元素
 *     `::before/::after` 的字形、canvas `fillText`、采样时不可见的节点都会让字体 loaded
 *     却不进使用面，故消息里给出这些诊断方向。
 *   · `loaded` 为空 → **info**（不是 blocker）：全 deck 没有主题字体**被加载**，判据没有可判定的
 *     面。这是原"`examined === 0` → info"逃逸口在并集语义下的**替代物**——原逃逸口是为
 *     "只采末帧"兜底而存在（末帧可能恰好没有主题字体文本），并集语义下它既没必要、又会**掩盖**
 *     真 blocker（`loaded` 非空却没进使用面时 `examined` 也可能是 0），故按"加载面为空"重新定。
 */
export function fontsVerdict(input: FontsVerdictInput): StepVerdict {
  const missing = diffFamilies(input.loadedFamilies, input.usedFamilies);
  if (missing.length > 0) {
    return {
      findings: [
        {
          rule: FONT_RULE,
          severity: "blocker",
          location: `#14 ${FONT_RULE}（全 deck 跑完后的单次判定：加载面 ${input.loadedFamilies.length} 个 / 使用面并集 ${input.usedFamilies.length} 个）`,
          message:
            `字体已加载但全 deck 无渲染文本使用：${missing.join("、")}——status === "loaded" 的家族` +
            `必须被渲染文本实际用到（否则主题声明、字体加载面与真实排版已经漂移）；` +
            `若这些家族只出现在伪元素（::before/::after）字形、canvas fillText、或采样时不可见的节点里，` +
            `本检查的采样面看不到它们——请先确认是不是这类加载来源`,
        },
      ],
      notes: [],
    };
  }
  if (input.loadedFamilies.length === 0) {
    return {
      findings: [],
      notes: [
        `#14 ${FONT_RULE} · [info] 全 deck 没有任何主题字体被加载（status === "loaded" 的家族 0 个；` +
          `FontFace ${input.fontFaceCount} 条 / 去重家族 ${input.familyCount}，采样面 ${input.examined} 个文本元素，` +
          `使用面并集 ${input.usedFamilies.length} 个家族）——渲染文本全走系统/UA 字体，` +
          `"加载面 ⊆ 使用面"没有可判定的面（info 而非 blocker：这不是缺陷态，是读数为零）`,
      ],
    };
  }
  return { findings: [], notes: [] };
}

/**
 * 动画逃逸判据（#16 ③）：
 *   · `unownedRunning > 0`（未注册动画正在跑）→ blocker；
 *   · render 下 `running > 0`（render 模式创建即冻结，任何 running 都是异常）→ blocker；
 *   · `unowned > 0` 未在跑（CSS transition 残影等）→ warning + hints（不判 blocker）。
 */
export function animationEscapeVerdict(
  audit: AnimationAudit,
  opts: { renderMode: boolean },
): StepVerdict {
  const findings: Finding[] = [];
  const hints = audit.unownedHints.length > 0 ? `；定位：${audit.unownedHints.join("、")}` : "";
  if (audit.unownedRunning > 0) {
    findings.push({
      rule: "动画逃逸",
      severity: "blocker",
      location: "动画审计",
      message:
        `未注册动画正在运行：unowned ${audit.unowned}（其中运行中 ${audit.unownedRunning}）/ ` +
        `waapi ${audit.waapi}——章节层手写 animate 或 CSS 动画绕过了引擎运行时` +
        `（§11.1 #4 的注册表覆盖断言）${hints}`,
    });
  } else if (opts.renderMode && audit.running > 0) {
    findings.push({
      rule: "动画逃逸",
      severity: "blocker",
      location: "动画审计",
      message:
        `render 模式下仍有动画在运行：running ${audit.running} / waapi ${audit.waapi}——` +
        `render 模式创建即冻结，running > 0 说明有动画绕过了引擎的冻结路径${hints}`,
    });
  } else if (audit.unowned > 0) {
    findings.push({
      rule: "动画逃逸",
      severity: "warning",
      location: "动画审计",
      message:
        `存在未注册动画（当前未运行）：unowned ${audit.unowned} / waapi ${audit.waapi}` +
        `——多为 CSS transition 残影；若这些动画会真的跑起来，请改走引擎运行时` +
        `（§11.1 #4）${hints}`,
    });
  }
  return { findings, notes: [] };
}

/**
 * 收集器级非空护栏（**通用**：某个收集器全 deck 累计 examined === 0 → blocker）；> 0 → null。
 * Task 8 起**按收集器分列**（T7 评审 M5 的建议）：合计数字会把"某个收集器整体失效"掩在
 * 别家的大数字里，故每个收集器各要一次自己的护栏。
 */
export function collectorExaminedGuard(
  label: string,
  examined: number,
  hint: string,
): Finding | null {
  if (examined > 0) return null;
  return {
    rule: "收集器非空护栏",
    severity: "blocker",
    location: STAGE_SELECTOR,
    message:
      `全 deck 累计 examined === 0——${label}在整个 pass 里没检查到任何${hint}` +
      `（画布根 ${STAGE_SELECTOR} 选择器失配 / 页面未挂载 / 收集器本身失效）；` +
      `拒绝把"什么都没查"当作"没有问题"`,
  };
}

/** 溢出收集器的非空护栏（#16 ②；`collectorExaminedGuard` 的具名别名，文案逐字保留）。 */
export function examinedGuard(totalExamined: number): Finding | null {
  return collectorExaminedGuard("溢出收集器", totalExamined, "元素");
}

/** 单步归因（纯函数：真机采集与单测走同一份判据）。 */
export function judgeStep(sample: StepSample, ctx: JudgeContext): StepVerdict {
  const parts = [
    consoleVerdict(sample.spec, sample.chapterId, sample.consoleEvents, ctx.pageUrl),
    overflowVerdict(sample.spec, sample.chapterId, sample.overflow),
    animationEscapeVerdict(sample.audit, { renderMode: ctx.renderMode }),
  ];
  // Task 8 追加的两面：缺省（旧调用方/单测未采）即跳过——不假装查过
  if (sample.safeMargins !== undefined) {
    parts.push(collectorVerdict(sample.spec, sample.chapterId, sample.safeMargins));
  }
  if (sample.contrast !== undefined) {
    parts.push(collectorVerdict(sample.spec, sample.chapterId, sample.contrast));
  }
  const findings: Finding[] = [];
  const notes: string[] = [];
  for (const p of parts) {
    findings.push(...p.findings);
    notes.push(...p.notes);
  }
  return { findings, notes };
}

// ── 编排 ──

/** 收集器参数（画布 = Stage.tsx 的 stage-frame；容差 1px 防布局取整的亚像素假报）。 */
const COLLECT_ARGS = { canvasSelector: STAGE_SELECTOR, tolerancePx: 1 };

/**
 * #20 参数：安全带的每个数字都来自单一源 `src/engine/safe-area.ts`（本文件与收集器都不出现
 * 96/112/934 的副本），坐标换算用 `stageConfig.dims`（画布 px ≠ DOM px 时靠它折算）。
 */
const SAFE_MARGIN_ARGS = safeMarginArgs(stageConfig.safeArea, stageConfig.dims);

/** URL 追加 `render=1`（幂等：已带则原样——与 `withHeadless` 同款归一语义）。 */
export function withRenderMode(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("render")) u.searchParams.set("render", "1");
  return u.toString();
}

/** 页面事件 → RawConsoleEvent（pageerror 的 message/stack 取一行，防巨型堆栈）。 */
function wireConsole(page: Page, window: ConsoleWindow): void {
  page.on("pageerror", (err) => {
    const name = err.name === "" ? "" : `${err.name}: `;
    const text = `${name}${err.message}`.split("\n")[0];
    window.push({ kind: "pageerror", level: "error", text, locationUrl: "" });
  });
  page.on("console", (m) => {
    window.push({ kind: "console", level: m.type(), text: m.text(), locationUrl: m.location().url });
  });
}

/** 收集器 evaluate 调用（源码串载体——见 collectors.ts 文件头：真函数会被 tsx 的 __name 污染）。 */
async function collectFrom(page: Page, src: string, args: unknown): Promise<CollectorResult> {
  const raw = await page.evaluate(`(${src})(${JSON.stringify(args)})`);
  return raw as CollectorResult;
}

async function collectOverflow(page: Page): Promise<CollectorResult> {
  return collectFrom(page, COLLECT_OVERFLOW_SRC, COLLECT_ARGS);
}

// ── #17/#19 的数据面（Task 9） ──

/**
 * `public/audio-durations.json` 读取（#17/#19 的音频对位输入）。
 *   缺文件 → null（未跑 TTS 的合法态：两条都不报，读数里如实标注）；
 *   读坏（JSON / 形态非法）→ null + 一条**读数**——**不在此判级**：同一事实（#13/Ruling P4-9）
 *   的真因与 blocker 判定在 fast 层的"音频完整性"条目，两处判红只会等级打架。
 */
function loadAudioDurations(repoRoot: string, bag: FindingBag): AudioDurations | null {
  const p = path.join(repoRoot, "public", "audio-durations.json");
  if (!fs.existsSync(p)) return null;
  try {
    return normalizeDurations(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch (e) {
    bag.addNote(
      `#17/#19 音频对位跳过：public/audio-durations.json 读取失败` +
        `（${e instanceof Error ? e.message : String(e)}）——该文件的真因与判定由 fast 层的` +
        `"音频完整性"条目负责（同一事实不两处判级）`,
      "readout",
    );
    return null;
  }
}

/**
 * 无头 pass 主流程（返回 FindingBag——接口约定 3 冻结面；info 走 `addNote`）。
 * `specs` 为空（chapters 空 / only 过滤后空）→ 不开浏览器，返回空袋 + 一条 note。
 */
export async function runHeadlessPass(opts: HeadlessOptions): Promise<FindingBag> {
  const bag = new FindingBag();
  const chapterIds = opts.chapters.map((c) => c.id);
  const all = expandSpecs(opts.chapters);
  const specs = opts.only === undefined ? all : all.filter((s) => opts.only!.includes(s.chapter));

  // ── #17/#19 的数据面（Task 9）：**早退之前**先跑，故"无 step 可跑"的路径照样出 #19 结论 ──
  // 对位与分镜页同源（resolveAudioMs 外提导出）：空 narration 步不吃条目；数据警示
  // （条目数对不上 / 缺章节键）在这里是**读数**——条目数的 blocker 由 fast 层 P4-9 负责判级；
  // 而"缺章节键"（fast 层只看总数、不看键名）只能在这里露面：它正是"该章被判成无音频"的
  // 唯一线索，读数上报告才不至于让 #17/#19 的静默变成无法审计的缺席。
  const alignWarnings: string[] = [];
  const audioByChapter = resolveAudioMs(
    opts.chapters,
    loadAudioDurations(opts.repoRoot, bag),
    alignWarnings,
  );
  for (const w of alignWarnings) bag.addNote(`#17/#19 音频对位读数：${w}`, "readout");
  bag.addAll(checkAudioTempo(opts.chapters, audioByChapter, { minSegmentMs: MIN_SEGMENT_MS }));
  const tempoStats = audioTempoStats(audioByChapter);
  bag.addNote(
    tempoStats === null
      ? `#19 音频节奏读数：扫描 0 段（public/audio-durations.json 缺失或全未合成——合法态，不报；` +
          `下限 ${MIN_SEGMENT_MS}ms）`
      : `#19 音频节奏读数：扫描 ${tempoStats.segments} 段（min ${tempoStats.minMs}ms / ` +
          `max ${tempoStats.maxMs}ms，下限 ${MIN_SEGMENT_MS}ms）`,
    "readout",
  );

  if (specs.length === 0) {
    bag.addNote(
      "#16 无头 pass：无 step 可跑（chapters 为空或 only 过滤后为空）——未开浏览器",
      "readout",
    );
    return bag;
  }

  let serve: ServeHandle | null = null;
  let session: Session | null = null;
  let stepsRun = 0;
  // 各收集器的检查面**分列**（Task 8：合计会把"某个收集器整体失效"掩在别家的大数字里）
  const examinedBy = { overflow: 0, safeMargins: 0, contrast: 0 };
  // #14 的使用面逐帧切片（跑完后求并集）+ 采样面累计（修复轮 1 / C1）
  const fontUsedSets: string[][] = [];
  // #17 的逐帧采集面（帧键 → 注册表声明窗口；跑完后与音频对位比对一次）
  const windowByFrame = new Map<string, number>();
  let fontExamined = 0;
  let blockerMsgs = 0;
  let infoMsgs = 0;

  try {
    const baseUrl = opts.url ?? (serve = await startServe({ repoRoot: opts.repoRoot })).url;
    const pageUrl = withHeadless(withRenderMode(baseUrl));
    // 自起的 server 把端口写进读数（端口被占时 Vite 自动 +1——报告要能看出查的是哪个端口）
    bag.addNote(
      `#16 无头 pass 基址：${pageUrl}（${opts.url === undefined ? "进程内自起" : "显式 --url 复用"}）`,
      "readout",
    );

    // 监听必须**早于导航**（修复轮 1 / I1）：装载期（Vite client / React 首帧挂载 / 首步 effect）
    // 的事件在 openSession 返回前就发完了——晚挂即永久丢失。
    const window = new ConsoleWindow();
    session = await openSession({
      url: pageUrl,
      viewport: stageConfig.dims,
      beforeGoto: (page) => wireConsole(page, window),
    });
    const page = session.page;

    // 开场复位（计划 Global Constraints / I12）：防 localStorage 游标恢复的起点漂移
    // （同一 context 的第二个页面实测开局在 step 2）。**不丢窗口**：装载期到首步采集完成之间
    // 的消息全部归首步（(0,0)）——那正是"仅挂载期跑一次"的报错所在处（修复轮 1 / I1）。
    await jumpToStep(page, { chapter: 0, step: 0 });
    await readyWithTimeout(page, frameLocation({ chapter: 0, step: 0 }, chapterIds[0] ?? "#0"));

    let aborted: string | null = null;
    for (const spec of specs) {
      const chapterId = chapterIds[spec.chapter] ?? `#${spec.chapter}`;
      const where = frameLocation(spec, chapterId);

      await jumpToStep(page, spec);
      await readyWithTimeout(page, where);

      // 游标回读（复用 session 的判据）：越界被 stepper 静默 clamp 时，后面采的都不是要查的帧。
      try {
        assertCursorMatch(spec, await readCursor(page));
      } catch (e) {
        bag.add({
          rule: "游标失配",
          severity: "blocker",
          location: where,
          message: e instanceof Error ? e.message : String(e),
        });
        aborted = where;
        window.clear();
        break;
      }

      // 采集顺序固定：DOM 收集器（溢出 → 安全边距 → 对比度）→ 字体面**采样** → 动画审计 →
      // 取走窗口内消息（窗口 = 上一步取走之后至此刻，含该步自己的 jumpTo→ready 渲染期——
      // 见文件头 ① 的两处标注）。字体面每步都采（使用面要跨步求并集：见字体收集器的文件头）。
      const overflow = await collectOverflow(page);
      const safeMargins = await collectFrom(page, COLLECT_SAFE_MARGINS_SRC, SAFE_MARGIN_ARGS);
      const contrast = await collectFrom(page, COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
      const fontsSample = (await collectFrom(page, COLLECT_FONTS_SRC, {})) as FontsSample;
      const audit = await auditAnimations(page);
      windowByFrame.set(frameKey(spec.chapter, spec.step), audit.windowMs); // #17 采集面
      const events = window.drain();

      const triage = triageConsoleEvents(events, pageUrl);
      blockerMsgs += triage.blockers.length;
      infoMsgs += triage.infos.length;

      const verdict = judgeStep(
        { spec, chapterId, consoleEvents: events, overflow, safeMargins, contrast, audit },
        { pageUrl, renderMode: true },
      );
      bag.addAll(verdict.findings);
      // judge 的 notes = **info 级 finding**（浏览器 Log 类消息 / 收集器 info 档）
      for (const n of verdict.notes) bag.addNote(n, "info");

      examinedBy.overflow += overflow.examined;
      examinedBy.safeMargins += safeMargins.examined;
      examinedBy.contrast += contrast.examined;
      // #14 的使用面**逐步累积**（并集在跑完后求：字体惰性加载，"加载了没人用"必须按全 deck 判）
      fontUsedSets.push(fontsSample.usedFamilies);
      fontExamined += fontsSample.examined;
      stepsRun += 1;
    }

    // #14 字体面：**全部步跑完后判一次**（加载跨步累积 + 使用面 = 各步并集——`only` 模式读数
    // 不同，故只在整轮跑完时判）。中止时不判：部分步的使用面会造出"加载了没人用"的假 blocker。
    let fonts: FontsSample | null = null;
    let fontsUnion: string[] = [];
    if (aborted === null) {
      fonts = (await collectFrom(page, COLLECT_FONTS_SRC, {})) as FontsSample;
      fontUsedSets.push(fonts.usedFamilies); // 终帧也是采样面的一员（幂等：同一帧重复并入无副作用）
      fontExamined += fonts.examined;
      fontsUnion = unionFamilies(fontUsedSets);
      const fontVerdict = fontsVerdict({
        loadedFamilies: fonts.loadedFamilies,
        usedFamilies: fontsUnion,
        fontFaceCount: fonts.fontFaceCount,
        familyCount: fonts.familyCount,
        examined: fontExamined,
      });
      bag.addAll(fontVerdict.findings);
      for (const n of fontVerdict.notes) bag.addNote(n, "info");
    } else {
      bag.addNote(
        `#14 ${FONT_RULE}：未执行（pass 在 ${aborted} 中止——加载跨步累积 + 使用面按全 deck 并集判，` +
          `部分步的并集会造出"加载了没人用"的假 blocker）`,
        "readout",
      );
    }

    // #17 动画窗口 vs 音频（Task 9）：**逐帧采集完、全套步跑完后判一次**（与 #14 同款"跑完再判"）。
    // 判据吃的是已采到的帧——中止时只比已采部分（未跑到的帧按"未采集"不报，不在读数外假装查过）。
    const tempoFrames: TempoFrame[] = specs.map((s) => ({
      chapter: s.chapter,
      step: s.step,
      chapterId: chapterIds[s.chapter] ?? `#${s.chapter}`,
    }));
    bag.addAll(checkAnimationWindow(tempoFrames, windowByFrame, audioByChapter));
    const windowValues = [...windowByFrame.values()];
    bag.addNote(
      `#17 动画窗口读数：已采 ${windowByFrame.size} 帧的注册表声明窗口` +
        `（最大 ${windowValues.length === 0 ? 0 : Math.max(...windowValues)}ms）` +
        `——无音频的帧不参与比较（未合成 / 无声过场是合法态）` +
        (aborted === null ? "" : `；pass 在 ${aborted} 中止，未跑到的帧未被采集`),
      "readout",
    );

    if (aborted !== null) {
      bag.addNote(
        `#16 无头 pass：在 ${aborted} 中止（游标失配后，其余步的逐 step 归因不再可信）——已跑 ${stepsRun} 步`,
        "readout",
      );
    }
    // 非空护栏按**收集器级别**判定（Task 8）：三个逐 step 收集器各要一次自己的护栏。
    // #14 不在此列：它的逃逸口已重推为"加载面为空 → info"（修复轮 1 / C1）——判定在 Node 侧
    // `fontsVerdict`（不在收集器里），且示例章节实测 loaded 1 / used 并集 4 → 连 info 都没有；
    // 故这里既不需要、也不该给它加"examined === 0"的护栏（详见 collectors.ts 与 fontsVerdict）。
    for (const guard of [
      examinedGuard(examinedBy.overflow),
      collectorExaminedGuard(SAFE_MARGIN_RULE, examinedBy.safeMargins, "文本元素"),
      collectorExaminedGuard(CONTRAST_RULE, examinedBy.contrast, "文本元素"),
    ]) {
      if (guard !== null) bag.add(guard);
    }
    if (blockerMsgs > 0) {
      // 去歧义（修复轮 1 / M5）：StrictMode 双渲染让同一处渲染期报错记两条，属预期而非重复上报
      bag.addNote(
        "注：React StrictMode 双渲染会让同一处渲染期/挂载期报错记两条，属预期（不是重复上报）",
        "readout",
      );
    }
    const fontReadout =
      fonts === null
        ? "未执行（中止）"
        : `FontFace ${fonts.fontFaceCount} 条 / 去重家族 ${fonts.familyCount} / status==="loaded" ` +
          `${fonts.loadedFamilies.length}（${fonts.loadedFamilies.length === 0 ? "无" : fonts.loadedFamilies.join("、")}）` +
          ` / used **并集** ${fontsUnion.length}（${fontsUnion.length === 0 ? "无" : fontsUnion.join("、")}）` +
          ` / 采样面 ${fontExamined} 个文本元素（每步一次 + 终帧一次）`;
    bag.addNote(
      `#16 采集读数：已跑 ${stepsRun} 步；检查面 examined（**分列**——合计会把某个收集器整体失效` +
        `掩在别家的大数字里）：溢出 ${examinedBy.overflow} / 安全边距 ${examinedBy.safeMargins} / ` +
        `对比度 ${examinedBy.contrast}；#14 字体面：${fontReadout}；` +
        `本页脚本报错 ${blockerMsgs} 条 / 控制台 info ${infoMsgs} 条（窗口自页面装载起——` +
        `修复轮 1 / I1；不含 #18/#14 的收集器 info——那些在报告上方的 info 段里）`,
      "readout",
    );
    return bag;
  } finally {
    // 起服务/开浏览器都算稀缺资源：无论哪条路径失败都要收回（异常原样透传，不吞真因）。
    // 嵌套 finally：关浏览器自己失败也不得让自起的 Vite 泄漏（否则下一次运行端口又被占一格）。
    try {
      if (session !== null) await session.close();
    } finally {
      if (serve !== null) await serve.stop();
    }
  }
}
