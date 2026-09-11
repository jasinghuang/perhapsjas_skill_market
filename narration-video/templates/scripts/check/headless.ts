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
 *    归因窗口 = **该步期间**：开场（页面装载 + 开场挂载）的消息在开场 `ready()` 后丢弃；
 *    此后每步在"该步采集完成"时**取走并清空**缓冲——即每步只对"自上次取走以来"的消息负责，
 *    上一步的消息不会被重算到下一步头上（跨步不累积、不迁移）。
 *    ⚠ 刻意收窄/放宽的两处（如实标注）：
 *      · **包含该步自己的 jumpTo→ready 窗口**（不只是 ready 之后）：章节层的 console.error
 *        绝大多数发生在**该步挂载渲染/effect** 时——正是 jumpTo 触发的。若把它算作"框架期"
 *        丢弃，这条断言就只剩"等页面静止后再报错才算"，等于漏掉它要抓的东西。
 *      · **不含首帧装载期**：页面装载（Vite client / React 挂载）的消息一律丢弃（框架期噪音）。
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
 *
 * ## 环境前置
 *
 * 需要 Chromium（`npx playwright install chromium`，snapshot 在 session.ts 的错误文案里）；
 * 默认**自起** Vite，从不探活复用外部服务（见 serve.ts 文件头的实测教训）。
 */

import type { Page } from "playwright";
import type { ChapterDef } from "../../src/chapters/manifest";
import type { AnimationAudit } from "../../src/engine/cursorBridge";
import { stageConfig } from "../../src/engine/runtime-config";
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
  COLLECT_OVERFLOW_SRC,
  STAGE_SELECTOR,
  type CollectorFinding,
  type CollectorResult,
} from "./collectors";
import { FindingBag, type Finding } from "./findings";
import { startServe, type ServeHandle } from "./serve";

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
    message: `${describeEvent(e)}——该步就绪后本步期间抛出的报错（#16 ①：无头 pass 逐 step 断言）`,
  }));
  const notes = infos.map((e) => `${where} · [info] ${describeEvent(e)}`);
  return { findings, notes };
}

/** 溢出收集器结果 → findings / notes（#16 ②；定位到步 + 元素描述）。 */
export function overflowVerdict(
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

/** 收集器级非空护栏（全 deck 累计 examined === 0 → blocker）；> 0 → null。 */
export function examinedGuard(totalExamined: number): Finding | null {
  if (totalExamined > 0) return null;
  return {
    rule: "收集器非空护栏",
    severity: "blocker",
    location: STAGE_SELECTOR,
    message:
      `全 deck 累计 examined === 0——溢出收集器在整个 pass 里没检查到任何元素` +
      `（画布根 ${STAGE_SELECTOR} 选择器失配 / 页面未挂载 / 收集器本身失效）；` +
      `拒绝把"什么都没查"当作"没有问题"`,
  };
}

/** 单步归因（纯函数：真机采集与单测走同一份判据）。 */
export function judgeStep(sample: StepSample, ctx: JudgeContext): StepVerdict {
  const parts = [
    consoleVerdict(sample.spec, sample.chapterId, sample.consoleEvents, ctx.pageUrl),
    overflowVerdict(sample.spec, sample.chapterId, sample.overflow),
    animationEscapeVerdict(sample.audit, { renderMode: ctx.renderMode }),
  ];
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
async function collectOverflow(page: Page): Promise<CollectorResult> {
  const raw = await page.evaluate(
    `(${COLLECT_OVERFLOW_SRC})(${JSON.stringify(COLLECT_ARGS)})`,
  );
  return raw as CollectorResult;
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
  if (specs.length === 0) {
    bag.addNote("#16 无头 pass：无 step 可跑（chapters 为空或 only 过滤后为空）——未开浏览器");
    return bag;
  }

  let serve: ServeHandle | null = null;
  let session: Session | null = null;
  let stepsRun = 0;
  let totalExamined = 0;
  let blockerMsgs = 0;
  let infoMsgs = 0;

  try {
    const baseUrl = opts.url ?? (serve = await startServe({ repoRoot: opts.repoRoot })).url;
    const pageUrl = withHeadless(withRenderMode(baseUrl));
    // 自起的 server 把端口写进 note（端口被占时 Vite 自动 +1——报告要能看出查的是哪个端口）
    bag.addNote(`#16 无头 pass 基址：${pageUrl}（${opts.url === undefined ? "进程内自起" : "显式 --url 复用"}）`);

    session = await openSession({ url: pageUrl, viewport: stageConfig.dims });
    const page = session.page;
    const window = new ConsoleWindow();
    wireConsole(page, window);

    // 开场复位（计划 Global Constraints / I12）：防 localStorage 游标恢复的起点漂移
    // （同一 context 的第二个页面实测开局在 step 2）。
    await jumpToStep(page, { chapter: 0, step: 0 });
    await readyWithTimeout(page, frameLocation({ chapter: 0, step: 0 }, chapterIds[0] ?? "#0"));
    window.clear(); // 框架期（页面装载 + 开场挂载）的消息丢弃

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

      // 采集顺序固定：DOM 收集器 → 动画审计 → 取走窗口内消息（窗口 = 上一步取走之后至此刻，
      // 含该步自己的 jumpTo→ready 渲染期——见文件头 ① 的两处如实标注）。
      const overflow = await collectOverflow(page);
      const audit = await auditAnimations(page);
      const events = window.drain();

      const triage = triageConsoleEvents(events, pageUrl);
      blockerMsgs += triage.blockers.length;
      infoMsgs += triage.infos.length;

      const verdict = judgeStep(
        { spec, chapterId, consoleEvents: events, overflow, audit },
        { pageUrl, renderMode: true },
      );
      bag.addAll(verdict.findings);
      for (const n of verdict.notes) bag.addNote(n);

      totalExamined += overflow.examined;
      stepsRun += 1;
    }

    if (aborted !== null) {
      bag.addNote(`#16 无头 pass：在 ${aborted} 中止（游标失配后，其余步的逐 step 归因不再可信）——已跑 ${stepsRun} 步`);
    }
    const guard = examinedGuard(totalExamined);
    if (guard !== null) bag.add(guard);
    bag.addNote(
      `#16 采集读数：已跑 ${stepsRun} 步；元素检查面累计 examined ${totalExamined}；` +
        `本页脚本报错 ${blockerMsgs} 条 / info ${infoMsgs} 条（不含开场装载期）`,
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
