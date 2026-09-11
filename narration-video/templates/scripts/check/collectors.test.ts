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
  COLLECT_OVERFLOW_SRC,
  OVERFLOW_RULE,
  PAGE_OVERFLOW_RULE,
  STAGE_SELECTOR,
  fromSrc,
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
