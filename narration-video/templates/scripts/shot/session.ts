// M3b Task 3 会话模块（K-21）：浏览器会话的**唯一**启停入口 + 页面侧驱动薄封装。
//
// 由来（KNOWN-ISSUES K-21）：capture.ts 与 verify-sequential.ts 各自复刻了"launch →
// goto + 等桥安装 → ready 包超时"三段，任一处修 bug 都要改两遍（漂移面）；M3b 无头门禁
// （Task 7）与 M5 渲染管线还要再消费一遍。故收敛到本模块，两条既有路径改消费它。
//
// 依赖方向**单向**：capture.ts → session.ts、verify-sequential.ts → session.ts；
// session.ts **不得** import capture.ts（成环不会在 tsc 报错，但 esbuild/tsx 逐文件转译后
// 运行期会在链接/求值阶段炸）。
//
// 关键取舍（自 capture.ts 逐字搬移，语义一条不松）：
//   1. **ready() 必须包 timeout**：桥的契约无内建超时（见 cursorBridge.ts 文件头），停滞的
//      load 会永久挂起。本模块包 10s 并带 chapter/step 定位；超时拒绝后浏览器由消费方
//      finally（captureSteps / verifySequential）或 openSession 的失败清理关掉。
//   2. **playwright 延迟 import**（`await import("playwright")`）：纯函数（expandSpecs /
//      shotPath / 错误文案）单测在 jsdom 里跑，不因顶层 import 拉起 playwright-core 的
//      加载与类型面之外的副作用——只有真要开浏览器时才加载。
//   3. **shotPath 用 "/" 手拼**（非 path.join）：该字符串同时是 storyboard.json / index.html
//      的相对引用（分镜页离线可开），反斜杠不进约定；FS 侧 Windows 也认 "/"。
//   4. **游标回读（评审 F2）+ chapterId 白名单（评审 F3）**：跳转越界被 stepper 静默 clamp
//      （要 (5,3) 得 (0,2)）→ 截图悄悄落错帧，故 ready() 后回读 getState 比对；chapterId
//      直接进输出路径，白名单挡空串 / 分隔符 / `.` `..`（防写出目录外）。
//   5. **截图后回读（评审 F1）**：F2 的回读发生在 ready() 之后、截图之前——覆盖不了"截图
//      窗口里页面自驱推进（音频兜底估时 → next()）把游标带走"，故另有 assertCursorStill。
//      判据留在本模块，截图本身留在 capture.ts（会话模块不认识"输出路径"之外的分镜语义）。
//   6. **两处旧 readyWithTimeout 的超时文案本就不同**（capture 版含成因说明，verify 版没有），
//      合并后以本模块文案为准——verify 侧那行文案变化不属行为契约（判据与超时值不变）。
//
// 环境前置：dev server 已运行（连接失败给出 "先 npm run dev" 指引，不自动起服——M5 编排器
// 再考虑自起）；`npx playwright install chromium` 首次执行（浏览器缺失抛可读指引错误）。

import type { Browser, Page } from "playwright";

// ── 冻结契约（计划 §2 接口约定，逐字） ──

export interface ShotSpec {
  chapter: number;
  step: number;
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
export function assertCursor(value: number, label: string): void {
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

export function assertChapterId(chapterId: string, label: string): void {
  if (!CHAPTER_ID_RE.test(chapterId) || chapterId === "." || chapterId === "..") {
    throw new Error(
      `${label} ${JSON.stringify(chapterId)} 非法（只允许 [A-Za-z0-9._-]，且不得为 "." / ".."——` +
        `它直接进输出路径 shots/<chapterId>/）`,
    );
  }
}

/** 输出路径约定（计划 §4）：`<outDir>/shots/<chapterId>/<step>.png`（"/" 手拼，见取舍 3；id 守卫见 F3） */
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
 * 截图**后**回读（评审 F1）：判据同 assertCursorMatch，归因不同——截图窗口里游标被带走
 * 几乎只有一个原因：页面自驱推进（音频兜底估时 → next()，useAudioPlayer）在 ready() 与截图
 * 之间抢先。截到的是**别的步**，下游只看动画计数发现不了（计数可能照样是 0）。
 * 与 assertCursorMatch 分开是为了不让排查者把它误读成"游标被 clamp / 分镜内容有差"。
 */
export function assertCursorStill(expected: ShotSpec, actual: { chapter: number; step: number }): void {
  if (actual.chapter !== expected.chapter || actual.step !== expected.step) {
    throw new Error(
      `截图后游标已被带走：期望仍停在 章节 ${expected.chapter} 第 ${expected.step} 步，` +
        `实际已到 章节 ${actual.chapter} 第 ${actual.step} 步——页面自驱推进抢先（预览态音频兜底估时的` +
        `自动 next；本帧图可能已是别的步），不是顺序/独立 mount 有差。请让页面停在目标步再截` +
        `（?render=1 下动画冻结但音频兜底推进仍在跑）`,
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
export async function readyWithTimeout(page: Page, where: string): Promise<void> {
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

// ── 页面侧驱动（自 capture.ts 的内联 evaluate 外提——签名冻结，见接口约定 1） ──

/** 跳游标（jumpTo 是 React 状态更新；落定须 `await readyWithTimeout`，见 cursorBridge 契约）。 */
export async function jumpToStep(page: Page, spec: ShotSpec): Promise<void> {
  await page.evaluate(
    ({ chapter, step }) => window.__presentation!.jumpTo(chapter, step),
    { chapter: spec.chapter, step: spec.step },
  );
}

/** 读游标。**commit-lagging**：jumpTo 之后须先 await ready() 再读（见 cursorBridge 契约）。 */
export async function readCursor(page: Page): Promise<{ chapter: number; step: number }> {
  return page.evaluate(() => window.__presentation!.getState());
}

/** 读动画计数（WAAPI + 引擎注册表；Ruling M4-1）。0 是合法值，不折叠成 falsy。 */
export async function readAnimations(page: Page): Promise<number> {
  return page.evaluate(() => window.__presentation!.animations());
}

// ── 会话（接口约定 1：M5 与无头门禁共用的启停面） ──

export interface SessionOptions {
  /** 基址；headless 参数由 openSession 归一（幂等——已带则不翻倍） */
  url: string;
  /** 默认 DEFAULT_VIEWPORT（1920×1080） */
  viewport?: { width: number; height: number };
  /** 默认 1（"精确 1080p"契约） */
  deviceScaleFactor?: number;
}

export interface Session {
  page: Page;
  /** 关浏览器（隐式 context 一并关，见 openSession 注释） */
  close(): Promise<void>;
}

/**
 * 开会话：启动 Chromium → 建页（viewport + DSF）→ goto（连不上给"先 npm run dev"指引）→
 * 等桥安装。**失败路径自己收尾**（关浏览器）：此时调用方拿不到 Session，没人能替它关。
 *
 * 页面用 `browser.newPage(...)`（Playwright 会隐式建一个**全新 context**——localStorage 干净，
 * verifySequential 原先靠"全新 context"防的游标恢复漂移同样成立），故 close = 关浏览器即可。
 */
export async function openSession(opts: SessionOptions): Promise<Session> {
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const deviceScaleFactor = opts.deviceScaleFactor ?? 1;
  const url = withHeadless(opts.url);
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor });
    await gotoOrExplain(page, url);
    await waitForBridge(page, url);
    return { page, close: () => browser.close() };
  } catch (e) {
    // 起会话失败不泄漏浏览器进程（消费方的 finally 还没机会插手）。
    await browser.close().catch(() => undefined);
    throw e;
  }
}
