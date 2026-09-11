// M4 截图模块（时间机器核心，§7 决策 1）——Playwright 逐帧捕捉 + 零动画断言。
//
// 职责：连接 dev server 上已安装游标桥（Task 1 的 window.__presentation）的页面，按
// (chapter, step) 逐帧：jumpTo → ready() → [零动画断言] → 截图（1920×1080 × DSF 1 = 精确
// 1080p）。消费方：storyboard 生成器（M4 Task 3）、无头门禁（M3b）、渲染管线（M5）——
// 接口约定跨计划冻结，签名逐字落实（见 capture.test.ts 的纯函数护栏）。
//
// 关键取舍（实现者报告）：
//   1. **ready() 必须包 timeout**：桥的契约无内建超时（见 cursorBridge.ts 文件头），停滞的
//      load 会永久挂起。本模块包 10s 并带 chapter/step 定位；超时拒绝后浏览器由 finally 关掉。
//   2. **playwright 延迟 import**（`await import("playwright")`）：纯函数（expandSpecs /
//      shotPath / 错误文案）单测在 jsdom 里跑，不因顶层 import 拉起 playwright-core 的
//      加载与类型面之外的副作用——只有真要开浏览器时才加载。
//   3. **截图不做 animations: "disabled"**（Playwright 的 CSS 动画快进选项）：那会把"页面
//      里还有动画"这个事实按回图里（假绿）；零动画由 animations() 断言把关，截图只记录
//      已定下来的状态（M5 非分镜模式 assertNoAnimations=false 时同理）。
//   4. **截图尺寸 = viewport 裁剪**（不 fullPage）：fullPage 在页面可滚动时会产出高于 1080
//      的图，"精确 1080p"的约定即由此失守。
//   5. **shotPath 用 "/" 手拼**（非 path.join）：该字符串同时是 storyboard.json / index.html
//      的相对引用（分镜页离线可开），反斜杠不进约定；FS 侧 Windows 也认 "/"。
//   6. **chapterIds 为追加字段且 specs 非空时必传**（评审 F1 裁决）：冻结契约（计划 §2）的
//      CaptureOptions 只有 4 个字段，但输出约定要求 `shots/<chapterId>/<step>.png`
//      （chapterId = 章节 id 如 "example"，非数字下标），而 ShotSpec 只有数字游标。
//      此处追加可选字段，**缺省不再是静默数字下标而是 throw**——静默退化会产出与约定
//      不符、事后无人察觉的路径（宁炸不静默）。传 `chapters.map(c => c.id)`。
//   7. **游标回读（评审 F2）+ chapterId 白名单（评审 F3）**：跳转越界被 stepper 静默
//      clamp（要 (5,3) 得 (0,2)）→ 截图悄悄落错帧，故 ready() 后回读 getState 比对；
//      chapterId 直接进输出路径，白名单挡空串 / 分隔符 / `.` `..`（防写出目录外）。
//
// 环境前置：dev server 已运行（连接失败给出 "先 npm run dev" 指引，不自动起服——M5 编排器
// 再考虑自起）；`npx playwright install chromium` 首次执行（浏览器缺失抛可读指引错误）。

import * as fs from "node:fs";
import * as path from "node:path";
import type { Browser, Page } from "playwright";

// ── 冻结契约（计划 §2 接口约定，逐字） ──

export interface ShotSpec {
  chapter: number;
  step: number;
}

export interface CaptureOptions {
  url: string;
  outDir: string;
  /** 默认 1920×1080（1080p 分镜约定） */
  viewport?: { width: number; height: number };
  /** 分镜模式 true（零动画门禁）；默认 false（M5 渲染逐帧 seek 时光标停在中途不为 0） */
  assertNoAnimations?: boolean;
  /** 增补（见文件头取舍 6）：章节目录名——`shots/<chapterId>/<step>.png`。
   *  **specs 非空时必传**（评审 F1）：缺省不再是静默数字下标，而是 throw——目录名是分镜页
   *  相对引用的组成部分，静默退化会产出与约定不符、事后无人察觉的路径。传 `chapters.map(c => c.id)`。 */
  chapterIds?: readonly string[];
}

export interface CaptureResult extends ShotSpec {
  file: string;
  animations: number;
}

// ── 常量 ──

export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 } as const;

/** ready() 等待上限（桥无内建超时——消费方必须包；见文件头取舍 1） */
export const READY_TIMEOUT_MS = 10_000;

/** 浏览器缺失时的安装命令（错误文案与测试共用同一常量——改文案不会单侧漂移） */
export const CHROMIUM_INSTALL_HINT = "npx playwright install chromium";

// ── 纯函数（可单测面） ──

/** 游标合法性：非负整数。非法 = 断言而非静默跳过（跳过的帧会被分镜门禁的帧数校验抓，但
 *  那是下游的噪音——错误应在入口就带定位说清楚）。 */
function assertCursor(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} ${value} 非法（须为非负整数）`);
  }
}

/**
 * 章节 manifest → 全 (chapter, step) 列表（分镜帧集合的唯一展开点）。
 * 顺序：章节序 → 章内步序（分镜页与门禁的帧数校验都按此序）。空 chapters → 空列表。
 * `steps` 非法（负数 / 非整数 / NaN）→ throw：宁炸不静默少帧。
 */
export function expandSpecs(chapters: readonly { steps: number }[]): ShotSpec[] {
  const out: ShotSpec[] = [];
  chapters.forEach((c, ci) => {
    assertCursor(c.steps, `expandSpecs：第 ${ci} 章的 steps`);
    for (let s = 0; s < c.steps; s++) out.push({ chapter: ci, step: s });
  });
  return out;
}

/** 章节 id 白名单（评审 F3）：同时挡掉空串、路径分隔符与 `.`/`..`——id 直接进输出路径，
 *  不做守卫就能用 `../../etc/x` 把图写到输出目录之外。 */
const CHAPTER_ID_RE = /^[A-Za-z0-9._-]+$/;

function assertChapterId(chapterId: string, label: string): void {
  if (!CHAPTER_ID_RE.test(chapterId) || chapterId === "." || chapterId === "..") {
    throw new Error(
      `${label} ${JSON.stringify(chapterId)} 非法（只允许 [A-Za-z0-9._-]，且不得为 "." / ".."——` +
        `它直接进输出路径 shots/<chapterId>/）`,
    );
  }
}

/** 输出路径约定（计划 §4）：`<outDir>/shots/<chapterId>/<step>.png`（"/" 手拼，见取舍 5；id 守卫见 F3） */
export function shotPath(outDir: string, chapterId: string, step: number): string {
  assertChapterId(chapterId, "shotPath：chapterId");
  assertCursor(step, "shotPath：step");
  return `${outDir.replace(/[/\\]+$/, "")}/shots/${chapterId}/${step}.png`;
}

/**
 * 回读校验（评审 F2）：`jumpTo` 越界会被 stepper **静默 clamp**（useStepper.clamp——要
 * (5,3) 给你 (0,2)），于是截图悄悄落到别的帧上。期望 ≠ 实际即 throw，带双方坐标。
 * 抽成纯函数是为了单测（浏览器路径在 captureOne 里调它，冒烟另有真机反证）。
 * 注意：必须 `await ready()` **之后**才回读——getState 是 commit-lagging（见 cursorBridge 契约）。
 */
export function assertCursorMatch(
  expected: ShotSpec,
  actual: { chapter: number; step: number },
): void {
  if (actual.chapter !== expected.chapter || actual.step !== expected.step) {
    throw new Error(
      `游标回读不符：期望 章节 ${expected.chapter} 第 ${expected.step} 步，` +
        `实际 章节 ${actual.chapter} 第 ${actual.step} 步——越界游标被 stepper 静默 clamp` +
        `（useStepper.clamp），此帧会截到错的画面；请核对 spec 是否在 manifest 范围内`,
    );
  }
}

/**
 * 归一 URL 到桥的安装条件（URL 含 headless=1——`params.has` 语义，值不重要）。
 * 已有 headless 参数则原样（幂等）；不再手拼 `url + "?headless=1"`——调用方 URL 自带
 * query（如 ?auto=1）时那种拼法会产出 `?auto=1?headless=1` 的坏 URL。
 */
export function withHeadless(url: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("headless")) u.searchParams.set("headless", "1");
  return u.toString();
}

/** Playwright 的"浏览器没装"错误判定（其余错误原样透传，不吞真因）。 */
export function isMissingBrowserError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /Executable doesn't exist|download new browsers/i.test(e.message);
}

/** 浏览器缺失 → 可读指引错误（含安装命令与原始细节）。 */
export function chromiumMissingError(cause?: unknown): Error {
  const detail =
    cause instanceof Error ? cause.message : cause === undefined ? "" : String(cause);
  return new Error(
    `未找到 Chromium 浏览器（模板已精确锁定 playwright 版本，缓存可跨项目复用）——首次运行前请执行：\n` +
      `    ${CHROMIUM_INSTALL_HINT}\n` +
      (detail ? `原始错误：${detail}` : ""),
  );
}

// ── 浏览器侧驱动（薄封装） ──

/** 延迟 import（取舍 2）：纯函数单测不拉起 playwright。 */
async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch();
  } catch (e) {
    // 只有"浏览器缺失"转指引错误；其余（如沙箱/权限）原样抛，保留真因。
    if (isMissingBrowserError(e)) throw chromiumMissingError(e);
    throw e;
  }
}

/** 等桥安装（页面加载完 → React effect 装桥）。失败给出"URL 没带 headless / 页面没起来"指引。 */
async function waitForBridge(page: Page, url: string): Promise<void> {
  try {
    await page.waitForFunction(() => window.__presentation !== undefined, undefined, {
      timeout: READY_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `页面未安装 window.__presentation 桥（${url}）——确认 URL 带 ?headless=1、` +
        `dev server 在运行、且页面渲染无异常（桥在 App 挂载后安装）`,
    );
  }
}

/** ready() + 10s 超时（取舍 1）：超时错误带 chapter/step 定位。 */
async function readyWithTimeout(page: Page, where: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `ready() 超时（${READY_TIMEOUT_MS}ms）：${where} 未就绪——` +
              `页面仍在等 fonts.ready / 图像 load（桥无内建超时，由消费方包）`,
          ),
        ),
      READY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([page.evaluate(() => window.__presentation!.ready()), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** goto 的错误转换：连不上 = 没起 dev server（不自动起服，给指引）。 */
async function gotoOrExplain(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE/.test(detail)) {
      throw new Error(`无法连接 ${url}——请先 \`npm run dev\`（模板 dev server 默认 5174）。原始错误：${detail}`);
    }
    throw e;
  }
}

/** 单步：跳游标 → 等就绪 → 回读校验 → 零动画断言 → 截图。 */
async function captureOne(
  page: Page,
  spec: ShotSpec,
  opts: CaptureOptions,
  chapterId: string,
): Promise<CaptureResult> {
  const where = `章节 ${spec.chapter} 第 ${spec.step} 步`;

  await page.evaluate(
    ({ chapter, step }) => window.__presentation!.jumpTo(chapter, step),
    { chapter: spec.chapter, step: spec.step },
  );
  await readyWithTimeout(page, where);

  // 回读必须在 ready() 之后（getState 是 commit-lagging，跳转刚落定时读到的是跳转前的位置）。
  assertCursorMatch(spec, await page.evaluate(() => window.__presentation!.getState()));

  const animations = await page.evaluate(() => window.__presentation!.animations());
  if (opts.assertNoAnimations === true && animations > 0) {
    throw new Error(
      `零动画断言失败（分镜阶段禁动画混入）：${where} 检出 ${animations} 个动画——` +
        `WAAPI（document.getAnimations）与引擎注册表之和须为 0（Ruling M4-1）；` +
        `该步的动画属渲染阶段（M5 逐帧 seek），分镜帧须为静帧`,
    );
  }

  const file = shotPath(opts.outDir, chapterId, spec.step);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });

  return { chapter: spec.chapter, step: spec.step, file, animations };
}

/**
 * 逐帧捕捉：单浏览器单页面，specs 顺序即产出顺序。
 * 空 specs → 空结果（不开浏览器）；缺 chapterIds / 非法游标 / 非法 id → throw
 * （全部在**开浏览器之前**，fail fast：参数错误不该先花一次浏览器启停）。
 */
export async function captureSteps(
  specs: readonly ShotSpec[],
  opts: CaptureOptions,
): Promise<CaptureResult[]> {
  if (specs.length === 0) return [];

  const chapterIds = opts.chapterIds;
  if (chapterIds === undefined) {
    throw new Error(
      "captureSteps：缺 chapterIds（specs 非空时必传，评审 F1）——输出约定是 " +
        "shots/<chapterId>/<step>.png（chapterId = 章节 id 如 \"example\"，不是数字下标），" +
        "请传 chapters.map(c => c.id)（与 specs 的 chapter 下标对位）",
    );
  }
  for (const spec of specs) {
    assertCursor(spec.chapter, `captureSteps：坐标 chapter（章节 ${spec.chapter} 第 ${spec.step} 步）`);
    assertCursor(spec.step, `captureSteps：坐标 step（章节 ${spec.chapter} 第 ${spec.step} 步）`);
    const id = chapterIds[spec.chapter];
    if (id === undefined) {
      throw new Error(
        `captureSteps：chapterIds 无第 ${spec.chapter} 项（章节 ${spec.chapter} 第 ${spec.step} 步）` +
          `——chapterIds 须与章节 manifest 等长对位（chapters.map(c => c.id)）`,
      );
    }
    assertChapterId(id, `captureSteps：chapterIds[${spec.chapter}]`);
  }

  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const url = withHeadless(opts.url);
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await gotoOrExplain(page, url);
    await waitForBridge(page, url);

    const results: CaptureResult[] = [];
    for (const spec of specs) {
      results.push(await captureOne(page, spec, opts, chapterIds[spec.chapter]));
    }
    return results;
  } finally {
    await browser.close();
  }
}
