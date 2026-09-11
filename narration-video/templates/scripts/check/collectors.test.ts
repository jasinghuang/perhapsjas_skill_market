/**
 * collectors 单测（M3b Task 7：overflow 收集器的最小面 + 源码串载体契约）。
 *
 * 测什么、不测什么（诚实标注）：
 *   · **源码串安全**（无反引号 / `${` / `__name`）与 `fromSrc` 同源——这是 tsx `keepNames`
 *     陷阱的直接守门（真机判别力另见文件末的子进程护栏：vitest 不做 keepNames，进程内测不出）；
 *   · **收集器判据**在 jsdom 里用**注入矩形**测（jsdom 不做布局，getBoundingClientRect 恒零矩形）：
 *     负样本（越界元素 → blocker）、反向护栏（被裁剪祖先包住的越界 → 不报）、非空护栏
 *     （无画布根 → examined 0 → blocker）。真布局下的判据由 Step 5 的真机正反样本取证
 *     （Task 8 另起 collectors.browser.test.ts 走真浏览器 fixture——见计划 Task 8 测试策略）。
 *   · **真机 tsx 子进程护栏**：子进程跑 `page.evaluate("(SRC)(args)")` 真实 CLI 路径，
 *     断言不抛 `__name is not defined`（需要 Chromium；缺失时给出安装指引）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAPTION_LAYER_SELECTOR,
  CHROME_BAND_SELECTOR,
  COLLECT_CONTRAST_SRC,
  COLLECT_FONTS_SRC,
  COLLECT_OVERFLOW_SRC,
  COLLECT_SAFE_MARGINS_SRC,
  CONTRAST_RULE,
  FONT_RULE,
  OVERFLOW_RULE,
  PAGE_OVERFLOW_RULE,
  SAFE_MARGIN_RULE,
  SAFE_MARGIN_TOLERANCE_PX,
  STAGE_SELECTOR,
  contrastRatio,
  diffFamilies,
  fromSrc,
  outOfBandPx,
  safeBand,
  safeMarginArgs,
  type Band,
  type CollectorResult,
} from "./collectors";

const CHECK_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(CHECK_DIR, "../..");

// ── 测试夹具：jsdom 无布局 → 注入矩形 ──

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 注入 getBoundingClientRect（jsdom 不做布局，恒零矩形，测不出判据）。 */
function stubRect(el: Element, rect: Rect): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

/** 画布根 + 其矩形（画布 = 1920×1080 舞台，与 stageConfig.dims 同量级）。 */
function mountStage(): HTMLDivElement {
  const stage = document.createElement("div");
  stage.setAttribute("data-testid", "stage-frame");
  document.body.appendChild(stage);
  stubRect(stage, { left: 0, top: 0, width: 1920, height: 1080 });
  return stage;
}

function collect(args: Record<string, unknown> = {}): CollectorResult {
  return fromSrc<(a: Record<string, unknown>) => CollectorResult>(COLLECT_OVERFLOW_SRC)(args);
}

afterEach(() => {
  document.body.innerHTML = "";
  // innerWidth/scrollWidth 的注入复位（jsdom 默认 1024×768；scrollWidth 恒 0）
  Reflect.deleteProperty(document.documentElement, "scrollWidth");
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
  Reflect.deleteProperty(window, "innerWidth");
  Reflect.deleteProperty(window, "innerHeight");
});

// ── 源码串载体契约（Global Constraints：tsx keepNames 陷阱） ──

describe("收集器源码串载体", () => {
  it("源码串不含反引号 / ${ / __name（String.raw 模板安全 + 注入物不得进串）", () => {
    expect(COLLECT_OVERFLOW_SRC.includes("`")).toBe(false);
    expect(COLLECT_OVERFLOW_SRC.includes("${")).toBe(false);
    expect(COLLECT_OVERFLOW_SRC.includes("__name")).toBe(false);
  });

  it("fromSrc：取出的是同一个可调用实现（Node 侧与浏览器侧同一文本）", () => {
    const fn = fromSrc<(a: unknown) => unknown>(COLLECT_OVERFLOW_SRC);
    expect(typeof fn).toBe("function");
    const out = fn({}) as CollectorResult;
    expect(Array.isArray(out.findings)).toBe(true);
    expect(typeof out.examined).toBe("number");
  });

  it("默认画布选择器 = STAGE_SELECTOR（缺省参数与 TS 侧常量不得漂移）", () => {
    expect(COLLECT_OVERFLOW_SRC).toContain(STAGE_SELECTOR);
    expect(STAGE_SELECTOR).toBe('[data-testid="stage-frame"]');
  });
});

// ── 非空护栏（收集器级 examined === 0 → blocker） ──

describe("非空护栏：examined === 0（收集器级）", () => {
  it("无画布根（空 DOM）→ examined 0 且 blocker（收集器什么都没检查）", () => {
    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.examined).toBe(0);
    const blocker = out.findings.find((f) => f.severity === "blocker");
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain(STAGE_SELECTOR);
  });

  it("缺省参数（args 为空对象）同样走非空护栏——不抛", () => {
    const out = collect({});
    expect(out.examined).toBe(0);
    expect(out.findings.some((f) => f.severity === "blocker")).toBe(true);
  });
});

// ── 负样本：越界元素 → blocker「被画布截断」 ──

describe("负样本：越界元素被画布截断", () => {
  it("左侧越界 200px → blocker + 量化 200px（定位含元素描述）", () => {
    const stage = mountStage();
    const el = document.createElement("div");
    el.id = "probe";
    el.textContent = "溢出文本";
    stage.appendChild(el);
    stubRect(el, { left: -200, top: 40, width: 400, height: 60 });

    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.examined).toBe(1);
    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.rule).toBe(OVERFLOW_RULE);
    expect(f.severity).toBe("blocker");
    expect(f.message).toContain("200");
    expect(f.location).toContain("#probe");
  });

  it("右侧 / 上侧 / 下侧越界各报一条（量化值取各边最大值）", () => {
    const stage = mountStage();
    const right = document.createElement("div");
    stage.appendChild(right);
    stubRect(right, { left: 1800, top: 100, width: 200, height: 100 }); // right 越 80
    const bottom = document.createElement("div");
    stage.appendChild(bottom);
    stubRect(bottom, { left: 10, top: 1000, width: 100, height: 120 }); // bottom 越 40

    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.examined).toBe(2);
    expect(out.findings).toHaveLength(2);
    expect(out.findings.every((f) => f.severity === "blocker")).toBe(true);
    expect(out.findings[0].message).toContain("80");
    expect(out.findings[1].message).toContain("40");
  });

  it("容差内的亚像素差异不报（布局取整不得制造假 blocker）", () => {
    const stage = mountStage();
    const el = document.createElement("div");
    stage.appendChild(el);
    stubRect(el, { left: -0.4, top: 0, width: 1920.4, height: 1080 });

    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.examined).toBe(1);
    expect(out.findings).toEqual([]);
  });
});

// ── 反向护栏：被裁剪祖先包住的越界元素不报（KenBurns 放大型假阳性钉死） ──

describe("反向护栏：裁剪祖先内的越界元素不报", () => {
  it("overflow:hidden 祖先内的放大元素（KenBurns 型）不报——否则每次缩放都是假 blocker", () => {
    const stage = mountStage();
    const clipper = document.createElement("div");
    clipper.className = "cdp-kenburns";
    clipper.style.overflow = "hidden";
    stage.appendChild(clipper);
    stubRect(clipper, { left: 0, top: 0, width: 600, height: 400 });
    const inner = document.createElement("div");
    clipper.appendChild(inner);
    // scale(1.12) 的实况：内层矩形越出画布右侧
    stubRect(inner, { left: -20, top: -20, width: 700, height: 460 });

    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.examined).toBe(2); // 仍然"看过"这两个元素（examined 是检查面，不是命中数）
    expect(out.findings).toEqual([]);
  });

  it("画布自身不在被检之列（它的 overflow:hidden 就是截断者，不是被截断者）", () => {
    mountStage();
    // 画布矩形与"画布内容"不重合也不构成 finding（examined 不含画布本身）
    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.examined).toBe(0);
    expect(out.findings).toEqual([]);
  });
});

// ── 页面级溢出（documentElement 滚动面） ──

describe("页面级溢出：scrollWidth / scrollHeight 超出视口", () => {
  it("横向溢出 300px → blocker「页面溢出」（量化值）", () => {
    mountStage();
    Object.defineProperty(document.documentElement, "scrollWidth", { configurable: true, value: 2220 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1080 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });

    const out = collect({ canvasSelector: STAGE_SELECTOR });
    const f = out.findings.find((x) => x.rule === PAGE_OVERFLOW_RULE);
    expect(f).toBeDefined();
    expect(f!.severity).toBe("blocker");
    expect(f!.message).toContain("300");
  });

  it("viewport 内（scrollWidth === innerWidth）不报", () => {
    mountStage();
    Object.defineProperty(document.documentElement, "scrollWidth", { configurable: true, value: 1920 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 1080 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });

    const out = collect({ canvasSelector: STAGE_SELECTOR });
    expect(out.findings).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// M3b Task 8：三条新检查（#20 文字安全边距 / #18 对比度 / #14 字体加载）
//
// 纯判据（比值 / 越界 / 差集 / 安全带）在本文件走 Node 单测；**收集器本身**（要真布局、
// 真要命中测试、真要 document.fonts）走 `collectors.browser.test.ts` 的真浏览器 fixture——
// jsdom 不做布局（rect 恒零）、无 elementFromPoint、无 document.fonts，
// "在 jsdom 里 stub 一切"等于把期望写死当答案。
// ══════════════════════════════════════════════════════════════════════════

/** 基准档案安全框 + 画布尺寸（字面量：不 import runtime-config——本文件只验"带随单一源数字走"）。 */
const SAFE_BASE = { chrome: 64, content: 96, top: 112, contentBottom: 934 };
const DIMS_BASE = { width: 1920, height: 1080 };

describe("源码串：#20/#18/#14（与 #16 同规——String.raw 模板 + 注入物不得进串）", () => {
  const newSrcs: ReadonlyArray<[string, string]> = [
    ["COLLECT_SAFE_MARGINS_SRC", COLLECT_SAFE_MARGINS_SRC],
    ["COLLECT_CONTRAST_SRC", COLLECT_CONTRAST_SRC],
    ["COLLECT_FONTS_SRC", COLLECT_FONTS_SRC],
  ];

  it("三个收集器均不含反引号 / ${ / __name", () => {
    for (const [name, src] of newSrcs) {
      expect(src.includes("`"), `${name} 含反引号（String.raw 模板会被截断）`).toBe(false);
      expect(src.includes("${"), `${name} 含插值`).toBe(false);
      expect(src.includes("__name"), `${name} 含 tsx keepNames 的注入物`).toBe(false);
    }
  });

  it("fromSrc 取出的是可调用实现（Node 侧与浏览器侧同一份文本）", () => {
    for (const [name, src] of newSrcs) {
      expect(typeof fromSrc(src), `${name} 取不出函数`).toBe("function");
    }
  });

  it("选择器与规则名进了源码串（headless 显式传参的默认值与 TS 常量同源）", () => {
    expect(COLLECT_SAFE_MARGINS_SRC).toContain(CHROME_BAND_SELECTOR);
    expect(COLLECT_SAFE_MARGINS_SRC).toContain(CAPTION_LAYER_SELECTOR);
    expect(COLLECT_CONTRAST_SRC).toContain(CAPTION_LAYER_SELECTOR);
    expect(COLLECT_SAFE_MARGINS_SRC).toContain(SAFE_MARGIN_RULE);
    expect(COLLECT_CONTRAST_SRC).toContain(CONTRAST_RULE);
    expect(COLLECT_FONTS_SRC).toContain(FONT_RULE);
  });

  it("规则名与 §11.1 门禁清单的检查名一致（报告可逐条对照）", () => {
    expect(SAFE_MARGIN_RULE).toBe("文字安全边距");
    expect(CONTRAST_RULE).toBe("对比度");
    expect(FONT_RULE).toBe("字体加载");
  });
});

describe("非空护栏：#20/#18 各自 blocker（收集器级，不共用同一个累计口）", () => {
  it("#20 无画布根（空 DOM）→ examined 0 + blocker（宁炸不静默：没有检查面不等于没有违规）", () => {
    const out = fromSrc<(a: unknown) => CollectorResult>(COLLECT_SAFE_MARGINS_SRC)(
      safeMarginArgs(SAFE_BASE, DIMS_BASE),
    );
    expect(out.examined).toBe(0);
    expect(out.findings.some((f) => f.severity === "blocker")).toBe(true);
  });

  it("#18 无画布根 → examined 0 + blocker", () => {
    const out = fromSrc<(a: unknown) => CollectorResult>(COLLECT_CONTRAST_SRC)({
      canvasSelector: STAGE_SELECTOR,
    });
    expect(out.examined).toBe(0);
    expect(out.findings.some((f) => f.severity === "blocker")).toBe(true);
  });

  it("#20 安全带参数缺失 → blocker（数字单一源在 Node 侧，收集器不内置 96/112/934 的副本）", () => {
    const stage = document.createElement("div");
    stage.setAttribute("data-testid", "stage-frame");
    document.body.appendChild(stage);
    const out = fromSrc<(a: unknown) => CollectorResult>(COLLECT_SAFE_MARGINS_SRC)({
      canvasSelector: STAGE_SELECTOR,
    });
    expect(out.findings.some((f) => f.severity === "blocker")).toBe(true);
    expect(out.findings[0].message).toContain("contentBand");
  });
});

describe("纯判据 contrastRatio（WCAG 2.x 相对亮度比）", () => {
  const BLACK = { r: 0, g: 0, b: 0 };
  const WHITE = { r: 255, g: 255, b: 255 };

  it("黑/白 = 21:1、同色 = 1:1（两端锚定）", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10);
  });

  it("浅灰底浅灰字 < 3:1（§11.1 #18 的判别面：yellow-on-cream 同型）", () => {
    const r = contrastRatio({ r: 238, g: 238, b: 238 }, { r: 221, g: 221, b: 221 });
    expect(r).toBeLessThan(3);
    expect(r).toBeGreaterThan(1);
  });

  it("对称：ratio(fg, bg) === ratio(bg, fg)（WCAG 定义）", () => {
    const a = { r: 232, g: 90, b: 31 };
    const b = { r: 250, g: 245, b: 235 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("半透明前景先与背景合成（rgba 文字按实况判，不是拿 α 当黑）", () => {
    const half = contrastRatio({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE);
    expect(half).toBeCloseTo(contrastRatio({ r: 127.5, g: 127.5, b: 127.5 }, WHITE), 10);
  });
});

describe("纯判据 outOfBandPx（安全边距越界量化）", () => {
  const band: Band = { left: 96, right: 1824, top: 112, bottom: 934 };
  const inside = { left: 200, top: 200, right: 800, bottom: 400 };
  const ZERO = { left: 0, right: 0, top: 0, bottom: 0 };

  it("rect 越内容带底缘 40px → 量化值 40（其余边 0）", () => {
    expect(outOfBandPx({ ...inside, bottom: 974 }, band).bottom).toBe(40);
  });

  it("带内矩形 → 四边全 0", () => {
    expect(outOfBandPx(inside, band)).toEqual(ZERO);
  });

  it("零余量口径（T4 评审 Important-1 裁定）：底缘恰好 934.000 不算越界——不得用严格 < 或零容差", () => {
    expect(outOfBandPx({ ...inside, bottom: 934 }, band)).toEqual(ZERO);
  });

  it("亚像素容差 0.5px：≤0.5 不报；>0.5 报**原始量**（不扣容差）", () => {
    expect(outOfBandPx({ ...inside, bottom: 934.5 }, band)).toEqual(ZERO);
    expect(outOfBandPx({ ...inside, bottom: 934.6 }, band).bottom).toBeCloseTo(0.6, 6);
  });

  it("左/右/上三边同型（四边共用同一判据与容差）", () => {
    expect(outOfBandPx({ ...inside, left: 56 }, band).left).toBe(40);
    expect(outOfBandPx({ ...inside, right: 1864 }, band).right).toBe(40);
    expect(outOfBandPx({ ...inside, top: 72 }, band).top).toBe(40);
    expect(outOfBandPx({ ...inside, left: 95.6 }, band)).toEqual(ZERO);
  });

  it("NaN 不制造越界（未布局元素 → 全 0，方向与 #16 的 NaN 兜底一致）", () => {
    expect(outOfBandPx({ left: NaN, top: NaN, right: NaN, bottom: NaN }, band)).toEqual(ZERO);
  });
});

describe("纯判据 diffFamilies（#14：loaded 多出 used）", () => {
  it("loaded 多出 used → 返回该家族（带名字清单，报告可直接改主题/章节）", () => {
    expect(diffFamilies(["Archivo Black", "Space Grotesk"], ["Space Grotesk"])).toEqual([
      "Archivo Black",
    ]);
  });

  it("大小写 / 引号 / 首尾空白不制造假差集（CSS 家族名不区分大小写）", () => {
    expect(diffFamilies(['  "Noto Sans SC" '], ["noto sans sc"])).toEqual([]);
  });

  it("loaded 与 used 各自去重且保序（同一家族的多个子集 Face 只算一次）", () => {
    expect(diffFamilies(["A", "B", "A"], ["b", "b"])).toEqual(["A"]);
  });

  it("loaded 为空 → 空数组（全 deck 没有主题字体被加载是合法态，不是差集）", () => {
    expect(diffFamilies([], ["Times New Roman"])).toEqual([]);
  });
});

describe("安全带构造（数字单一源 src/engine/safe-area.ts + 档案尺寸）", () => {
  it("内容带 = 左/右 96、顶 112、底 934（绝对画布 px 的四缘形态）", () => {
    expect(safeBand(SAFE_BASE, DIMS_BASE, "content")).toEqual({
      left: 96,
      right: 1824,
      top: 112,
      bottom: 934,
    });
  });

  it("chrome 带 = 左/右 64，垂直不设限（chrome 本来就住在内容带之上，给它垂直约束会把 topbar 自己判成越界）", () => {
    expect(safeBand(SAFE_BASE, DIMS_BASE, "chrome")).toEqual({
      left: 64,
      right: 1856,
      top: 0,
      bottom: 1080,
    });
  });

  it("两条带在左右缘上真的不同（64 vs 96）——否则 fixture 的「带标记/不带标记」两路径是死分支", () => {
    const content = safeBand(SAFE_BASE, DIMS_BASE, "content");
    const chrome = safeBand(SAFE_BASE, DIMS_BASE, "chrome");
    const rect = { left: 80, top: 200, right: 400, bottom: 300 };
    expect(outOfBandPx(rect, chrome).left).toBe(0); // 80 ≥ 64：chrome 带内
    expect(outOfBandPx(rect, content).left).toBe(16); // 80 < 96：内容带越界 16px
  });

  it("safeMarginArgs：chromeSelector 必传且为 chrome 标记选择器（默认从严的依据面）", () => {
    const args = safeMarginArgs(SAFE_BASE, DIMS_BASE);
    expect(args.chromeSelector).toBe(CHROME_BAND_SELECTOR);
    expect(args.captionSelector).toBe(CAPTION_LAYER_SELECTOR);
    expect(args.canvasSelector).toBe(STAGE_SELECTOR);
    expect(args.canvasSize).toEqual(DIMS_BASE);
    expect(args.tolerancePx).toBe(SAFE_MARGIN_TOLERANCE_PX);
    expect(args.tolerancePx).toBeGreaterThan(0); // 零容差会把 934.000 判成越界（T4 裁定）
  });

  it("档案尺寸变化时同一份数字随画布走（3:4 折算值同样可用，本处只验带随尺寸）", () => {
    const tall = { chrome: 36, content: 54, top: 149, contentBottom: 1245 };
    expect(safeBand(tall, { width: 1080, height: 1440 }, "content")).toEqual({
      left: 54,
      right: 1026,
      top: 149,
      bottom: 1245,
    });
  });
});

// ── tsx 真机护栏（子进程；vitest 不做 keepNames，进程内测不出 __name 陷阱） ──
//
// 为什么必须**文件**子进程（实测，非推理）：`tsx --eval` 的转译路径**不做 keepNames**
// ——同一个"具名函数表达式"在 `--eval` 下 `toString()` 干净，在 `.ts` 文件里被改写成
// `__name(function describe(){…},"describe")`（本文件末条负控制即是那次实测的固化）。
// 所以护栏子进程必须写成**临时目录里的 .ts 文件**（`{"type":"module"}` 同真实语境），
// 否则护栏会在"收集器被改回真函数"的回归上恒绿——那也是 vitest 进程内看不见的那件事。

describe("tsx 子进程真机护栏（文件路径；keepNames 只在这条路径上生效）", () => {
  const TSX_CLI = path.join(TEMPLATE_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const PLAYWRIGHT_ENTRY = path.join(TEMPLATE_ROOT, "node_modules", "playwright", "index.mjs");
  const tmpDirs: string[] = [];

  afterEach(() => {
    while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  /** 子进程夹具：临时目录 + `{"type":"module"}`（CJS 语境下 tsx 转译形态不同） */
  function makeChild(lines: string[]): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "collectors-guard-"));
    tmpDirs.push(d);
    fs.writeFileSync(path.join(d, "package.json"), '{"type":"module"}');
    const child = path.join(d, "child.ts");
    fs.writeFileSync(child, lines.join("\n"));
    return child;
  }

  function runChild(child: string): { status: number | null; stdout: string; stderr: string } {
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.VITEST; // 子进程模拟真实 CLI 环境（loader-hooks 只在非 vitest 注册）
    const r = spawnSync(process.execPath, [TSX_CLI, child], {
      cwd: TEMPLATE_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env,
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  it("正：tsx 文件路径下 (SRC)(args) 进真实页面不抛 __name，且真机负样本被抓到", () => {
    const child = makeChild([
      "import { chromium } from " + JSON.stringify(PLAYWRIGHT_ENTRY) + ";",
      "import { COLLECT_OVERFLOW_SRC } from " +
        JSON.stringify(path.join(CHECK_DIR, "collectors.ts")) +
        ";",
      "void (async () => {",
      "  const browser = await chromium.launch();",
      "  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });",
      "  await page.setContent(" +
        JSON.stringify(
          '<div data-testid="stage-frame" style="width:1920px;height:1080px;overflow:hidden">' +
            '<div style="position:absolute;left:-200px;width:400px;height:60px">溢出文本</div></div>',
        ) +
        ");",
      "  const out = await page.evaluate(" +
        "    '(' + COLLECT_OVERFLOW_SRC + ')(' + JSON.stringify({ canvasSelector: '[data-testid=\"stage-frame\"]' }) + ')'," +
        "  );",
      "  console.log('COLLECT_OK ' + JSON.stringify(out));",
      "  await browser.close();",
      "})();",
    ]);
    const r = runChild(child);
    const combined = `${r.stdout}\n${r.stderr}`;
    expect(combined).not.toContain("__name is not defined");
    expect(r.status, `子进程退出码 ${r.status}\n${combined}`).toBe(0);
    const marker = "COLLECT_OK ";
    expect(r.stdout).toContain(marker);
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf(marker) + marker.length).trim());
    // 真机负样本：越界元素在真布局下必须被这条源码串抓到（否则护栏只是"不崩"）
    expect(parsed.examined).toBeGreaterThan(0);
    expect(parsed.findings.some((f: { severity: string }) => f.severity === "blocker")).toBe(true);
  }, 180_000);

  it("正（Task 8 三收集器）：tsx 文件路径下 #20/#18/#14 源码串进真实页面不抛 __name，判别力逐条成立", () => {
    // 一个元素同时踩两条检查（越界 + 低对比），另加一条必须被排除的 caption——一条夹具三面取证
    const fixture = [
      '<div data-testid="stage-frame" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden;background:#fff">',
      '<div style="position:absolute;left:56px;top:60px;color:#dddddd;background:#dddddd;font-size:32px">越界且低对比</div>',
      '<div class="caption-layer" style="position:absolute;left:8px;top:1000px"><span style="color:#eeeeee;background:#ffffff">字幕</span></div>',
      "</div>",
    ].join("");
    const child = makeChild([
      "import { chromium } from " + JSON.stringify(PLAYWRIGHT_ENTRY) + ";",
      "import { COLLECT_SAFE_MARGINS_SRC, COLLECT_CONTRAST_SRC, COLLECT_FONTS_SRC, CONTRAST_ARGS, safeMarginArgs } from " +
        JSON.stringify(path.join(CHECK_DIR, "collectors.ts")) +
        ";",
      "void (async () => {",
      "  const browser = await chromium.launch();",
      "  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });",
      "  await page.setContent(" + JSON.stringify(fixture) + ");",
      "  const safe = safeMarginArgs({ chrome: 64, content: 96, top: 112, contentBottom: 934 }, { width: 1920, height: 1080 });",
      "  const margins = await page.evaluate('(' + COLLECT_SAFE_MARGINS_SRC + ')(' + JSON.stringify(safe) + ')');",
      "  const contrast = await page.evaluate('(' + COLLECT_CONTRAST_SRC + ')(' + JSON.stringify(CONTRAST_ARGS) + ')');",
      "  const fonts = await page.evaluate('(' + COLLECT_FONTS_SRC + ')(' + JSON.stringify({}) + ')');",
      "  console.log('T8_OK ' + JSON.stringify({ margins, contrast, fonts }));",
      "  await browser.close();",
      "})();",
    ]);
    const r = runChild(child);
    const combined = `${r.stdout}\n${r.stderr}`;
    expect(combined).not.toContain("__name is not defined");
    expect(r.status, `子进程退出码 ${r.status}\n${combined}`).toBe(0);
    const marker = "T8_OK ";
    expect(r.stdout).toContain(marker);
    const parsed = JSON.parse(r.stdout.slice(r.stdout.indexOf(marker) + marker.length).trim()) as {
      margins: CollectorResult;
      contrast: CollectorResult;
      fonts: CollectorResult & { loadedFamilies: string[] };
    };
    // 真布局下的判别力（不是"没崩"就算过）：越界 + 低对比各报一条，caption 两条都不报
    expect(parsed.margins.examined).toBe(1);
    expect(parsed.margins.findings.some((f) => f.severity === "warning")).toBe(true);
    expect(parsed.margins.findings.some((f) => f.location.includes("caption"))).toBe(false);
    expect(parsed.contrast.examined).toBe(1);
    expect(parsed.contrast.findings.some((f) => f.severity === "warning")).toBe(true);
    // 真实 FontFaceSet（夹具无 @font-face）→ loaded 空 → examined 0 → info
    expect(parsed.fonts.loadedFamilies).toEqual([]);
    expect(parsed.fonts.examined).toBe(0);
    expect(parsed.fonts.findings[0]?.severity).toBe("info");
  }, 180_000);

  it("负控制：把「真函数」交给 page.evaluate 必然崩 __name（钉住护栏力度——它不是在防空气）", () => {
    // 这条是本次实测的固化：正是它证明"收集器必须走源码串"不是风格偏好。
    const child = makeChild([
      "import { chromium } from " + JSON.stringify(PLAYWRIGHT_ENTRY) + ";",
      "const collect = (args: { tagName: string }) => {",
      "  const inner = function describe(el: { tagName: string }) { return el.tagName; };",
      "  return inner(args);",
      "};",
      "void (async () => {",
      "  const browser = await chromium.launch();",
      "  const page = await browser.newPage();",
      "  await page.setContent('<div>x</div>');",
      "  console.log('FNSRC ' + collect.toString().includes('__name'));",
      "  try {",
      "    await page.evaluate(collect, { tagName: 'DIV' });",
      "    console.log('NO_TRAP');",
      "  } catch (e) {",
      "    console.log('TRAP ' + (e as Error).message.split('\\n')[0]);",
      "  }",
      "  await browser.close();",
      "})();",
    ]);
    const r = runChild(child);
    expect(r.stdout).toContain("FNSRC true"); // 真函数已被 keepNames 污染
    expect(r.stdout).toContain("__name is not defined"); // 且污染后果在浏览器里炸
  }, 180_000);
});
