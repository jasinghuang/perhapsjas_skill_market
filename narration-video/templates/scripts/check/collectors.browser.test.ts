/**
 * collectors.browser.test.ts（M3b Task 8）：#20 文字安全边距 / #18 对比度 / #14 字体加载
 * 三个**收集器本体**的真浏览器 fixture。
 *
 * 为什么必须真浏览器（不是"更真实更好"，是 jsdom 根本做不到）：
 *   · `getBoundingClientRect()` 在 jsdom 恒零矩形（没有布局引擎）→ 安全边距判据无从触发；
 *   · 没有 `document.elementFromPoint`（没有命中测试）→ 对比度的祖先链采样无从触发；
 *   · 没有 `document.fonts`（没有字体集）→ #14 的 loaded / used 两张清单无从触发。
 * 在 jsdom 里 stub 这一切，等于把期望值当答案写死（只测减法）。纯判据另有 Node 单测
 * （collectors.test.ts），真 tsx 路径另有子进程护栏（同文件末节）。
 *
 * 环境约定（逐条复刻 scripts/shot/session.browser.test.ts 踩平的坑，别绕过）：
 *   · 本文件跑在 jsdom（vitest 的 setupFiles 是全局的）；**不得**在文件任何位置写出
 *     environment 标记字面量——vitest 全文扫描（含注释）；
 *   · playwright 的 Node 侧入口在 jsdom 里缺 TransformStream（playwright-core 的
 *     mcpBundle 直接引用）——下方先补全局，再动态 import playwright；
 *   · 一个 describe 共用**一次** `chromium.launch()`（一次 launch 约 1-2s，逐用例 launch 太贵）。
 *
 * fixture 覆盖面（brief 清单逐条）：带内文本 / 越界文本 / 自绘深底徽章 / 反色卡 /
 * caption 子树 / 渐变背景 / `<svg><text>` / 空文本 div / 带与不带 chrome 标记。
 */

import { TransformStream as WebTransformStream } from "node:stream/web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CAPTION_LAYER_SELECTOR,
  CHROME_BAND_SELECTOR,
  COLLECT_CONTRAST_SRC,
  COLLECT_FONTS_SRC,
  COLLECT_SAFE_MARGINS_SRC,
  CONTRAST_ARGS,
  CONTRAST_RULE,
  FONT_RULE,
  SAFE_MARGIN_RULE,
  STAGE_SELECTOR,
  contrastRatio,
  safeMarginArgs,
  type CollectorResult,
  type FontsCollectorResult,
} from "./collectors";

// jsdom 缺 TransformStream（Node 有）——playwright-core 加载期就要它。补在**动态 import 之前**。
(globalThis as { TransformStream?: unknown }).TransformStream ??= WebTransformStream;

type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

const SAFE_AREA = { chrome: 64, content: 96, top: 112, contentBottom: 934 };
const DIMS = { width: 1920, height: 1080 };

/** 安全带参数：与 headless 同源（safeMarginArgs），只把画布选择器留在 fixture 自己的舞台上。 */
const MARGIN_ARGS = safeMarginArgs(SAFE_AREA, DIMS);

/**
 * 固定夹具页（1920×1080 舞台钉在 0,0——画布相对坐标 === 视口坐标，期望值可手算）。
 *
 * 文本元素清单（含直接可见文本的 10 个；caption 与空 div 是**排除面**）：
 *   #inside 带内 / #badge 自绘深底徽章 / #invert-card 反色卡 / #low 浅灰底浅灰字 /
 *   #half-low 大字档 3.89 / #small-low 小字档 3.89 / #grad 渐变底 / <svg><text> /
 *   #chrome-marked 带标记 @80 / #chrome-unmarked 未标记 @80
 */
const FIXTURE_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  "html, body { margin: 0; padding: 0; overflow: hidden; }",
  'body { font-family: "Probe Used", sans-serif; }',
  "</style></head><body>",
  `<div data-testid="stage-frame" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden;background:#ffffff">`,
  `<div id="inside" style="position:absolute;left:200px;top:200px;width:400px;height:60px;color:#111111;font-size:32px">带内文本</div>`,
  `<div id="badge-wrap" style="position:absolute;left:200px;top:300px;background:#ffffff">`,
  `<span id="badge" style="background:#111111;color:#ffffff;padding:8px 16px;font-size:32px">深底徽章</span>`,
  `</div>`,
  `<div id="invert-card" style="position:absolute;left:200px;top:380px;width:400px;height:100px;background:#1a1a1a;color:#f5f0e6;font-size:32px;font-family:'Probe Quoted',sans-serif">反色卡</div>`,
  `<div id="low" style="position:absolute;left:200px;top:520px;width:400px;height:60px;background:#dddddd;color:#eeeeee;font-size:32px">浅灰底浅灰字</div>`,
  `<div id="half-low" style="position:absolute;left:200px;top:600px;width:400px;height:60px;background:#ffffff;color:#818181;font-size:32px">大字档 3.89</div>`,
  `<div id="small-low" style="position:absolute;left:200px;top:680px;width:400px;height:40px;background:#ffffff;color:#818181;font-size:16px">小字档 3.89</div>`,
  `<div id="grad" style="position:absolute;left:200px;top:740px;width:400px;height:60px;background:linear-gradient(90deg,#000000,#ffffff);color:#333333;font-size:32px">渐变上文字</div>`,
  `<svg id="svgbox" style="position:absolute;left:200px;top:800px;width:400px;height:60px"><text x="0" y="40" style="font-size:32px;fill:#111111">SVG 文本</text></svg>`,
  `<div id="empty" style="position:absolute;left:200px;top:880px;width:400px;height:40px"></div>`,
  `<div id="chrome-marked" data-safe-band="chrome" style="position:absolute;left:80px;top:20px;color:#111111;font-size:32px">chrome 顶栏</div>`,
  `<div id="chrome-unmarked" style="position:absolute;left:80px;top:60px;color:#111111;font-size:32px">未标记顶栏</div>`,
  `<div class="caption-layer" style="position:absolute;left:10px;top:1040px"><span id="caption" style="background:#ffffff;color:#eeeeee;font-size:40px">字幕不该被检查</span></div>`,
  `</div>`,
  "</body></html>",
].join("\n");

/** 夹具里"含直接可见文本"的元素数（#20/#18 的 examined 期望值；caption 与空 div 不算）。 */
const TEXT_ELEMENTS = 10;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: DIMS });
}, 120_000);

afterAll(async () => {
  if (browser !== undefined) await browser.close();
});

/** 装夹具 + 跑一个收集器（与 headless 同款调用形式：`(SRC)(args)` 源码串载体）。 */
async function runOnFixture<T>(src: string, args: unknown): Promise<T> {
  await page.setContent(FIXTURE_HTML);
  return (await page.evaluate(`(${src})(${JSON.stringify(args)})`)) as T;
}

/** 只换 `document.fonts` 的假面（真字体集里没有 @font-face，做不出 loaded 面）。 */
const FAKE_FONTS_SETUP = `Object.defineProperty(document, "fonts", {
  configurable: true,
  value: {
    forEach: function (cb) {
      var faces = [
        { family: "Probe Used", status: "loaded" },
        { family: "Probe Used", status: "loaded" },
        { family: '"Probe Quoted"', status: "loaded" },
        { family: "Probe Unused", status: "loaded" },
        { family: "Probe Unloaded", status: "unloaded" }
      ];
      for (var i = 0; i < faces.length; i++) cb(faces[i], i, this);
    }
  }
});`;

const FAKE_FONTS_ONLY_UNLOADED = `Object.defineProperty(document, "fonts", {
  configurable: true,
  value: {
    forEach: function (cb) {
      cb({ family: "Probe Unloaded", status: "unloaded" }, 0, this);
    }
  }
});`;

/** 拆掉假面（own property 删掉后自动落回 Document.prototype 的真实访问器）。 */
const FAKE_FONTS_TEARDOWN = `delete document.fonts;`;

// ── #20 文字安全边距 ──

describe("#20 文字安全边距（真布局）", () => {
  it("带内文本不报；越界文本按内容带量化（左 16px、上 52px）+ 附 chrome 标记指引", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_SAFE_MARGINS_SRC, MARGIN_ARGS);

    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.rule).toBe(SAFE_MARGIN_RULE);
    expect(f.severity).toBe("warning");
    expect(f.location).toContain("#chrome-unmarked");
    expect(f.message).toContain("左 16px");
    expect(f.message).toContain("上 52px");
    // 默认从严的代价要写在脸上：未标记的顶栏文字被报成内容带越界，误报消息里给出口
    expect(f.message).toContain('data-safe-band="chrome"');
  });

  it("带标记按 64 判、不带按 96 判（同位置两条路径，不是死分支）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_SAFE_MARGINS_SRC, MARGIN_ARGS);
    const locations = out.findings.map((f) => f.location).join(" ");
    // 两者同在 left:80px：chrome 带（64）内 → 不报；内容带（96）外 → 报
    expect(locations).not.toContain("#chrome-marked");
    expect(locations).toContain("#chrome-unmarked");
  });

  it("caption 子树不计入；空文本 div 不计入；SVG <text> 计入", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_SAFE_MARGINS_SRC, MARGIN_ARGS);
    // caption 在 left:10px / top:1040px——不排除的话必然是一条越界
    expect(out.findings.some((f) => f.location.includes("caption"))).toBe(false);
    expect(out.findings.some((f) => f.location.includes("#empty"))).toBe(false);
    expect(out.examined).toBe(TEXT_ELEMENTS); // 含 <svg><text>，不含空 div 与 caption
  });

  it("非空护栏：examined = 文本元素数（不是画布元素数，也不是命中数）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_SAFE_MARGINS_SRC, MARGIN_ARGS);
    expect(out.examined).toBe(TEXT_ELEMENTS);
    expect(out.examined).toBeGreaterThan(0);
  });

  it("选择器与 headless 同源：带内元素一个都不报（误报面为 0 才是这条检查可用的前提）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_SAFE_MARGINS_SRC, MARGIN_ARGS);
    const ids = out.findings.map((f) => f.location).join(" ");
    for (const id of ["#inside", "#badge", "#invert-card", "#low", "#half-low", "#small-low", "#grad"]) {
      expect(ids).not.toContain(id);
    }
  });
});

// ── #18 对比度 ──

describe("#18 对比度（真浏览器：自身底色优先 + 祖先链采样）", () => {
  it("自绘深底徽章取自身底色（#111/#fff = 21:1），不是祖先白底（否则会是 1:1 假 warning）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
    const locations = out.findings.map((f) => f.location).join(" ");
    expect(locations).not.toContain("#badge");
    expect(locations).not.toContain("#invert-card"); // 反色卡同理：墨底奶油字
    expect(out.findings.every((f) => f.rule === CONTRAST_RULE)).toBe(true);
  });

  it("阈值分档 largePx=24：同一颜色大字档通过（3.89 ≥ 3）、小字档报 warning（3.89 < 4.5）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
    const warnings = out.findings.filter((f) => f.severity === "warning");
    const where = warnings.map((f) => f.location).join(" ");
    expect(where).not.toContain("#half-low"); // 32px：大字档 3:1
    expect(where).toContain("#small-low"); // 16px：小字档 4.5:1

    // 量化输出是**实际比值**，且与 Node 侧同一份判据算出的值逐位一致（同一文本的硬证据）
    const expected = contrastRatio({ r: 0x81, g: 0x81, b: 0x81 }, { r: 255, g: 255, b: 255 });
    const small = warnings.find((f) => f.location.includes("#small-low"))!;
    expect(small.message).toContain(String(Math.round(expected * 100) / 100));
    expect(small.message).toContain("4.5:1");
  });

  it("浅灰底浅灰字 → warning（1.17:1）+ 量化前景/背景与字号", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
    const low = out.findings.find((f) => f.location.includes("#low"));
    expect(low).toBeDefined();
    expect(low!.severity).toBe("warning");
    const expected = contrastRatio({ r: 238, g: 238, b: 238 }, { r: 221, g: 221, b: 221 });
    expect(low!.message).toContain(String(Math.round(expected * 100) / 100));
    expect(low!.message).toContain("32px");
  });

  it("渐变 / 图片背景记 info 不报 warning（不可判定 ≠ 违规，且要计数）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
    const grad = out.findings.find((f) => f.location.includes("#grad"));
    expect(grad).toBeDefined();
    expect(grad!.severity).toBe("info"); // 不是 warning：背景不可由色值判定
    expect(out.findings.filter((f) => f.severity === "warning").some((f) => f.location.includes("#grad"))).toBe(false);
  });

  it("caption 子树不计入（框架级字幕带的对比度由框架自己守），examined = 文本元素数", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
    expect(out.findings.some((f) => f.location.includes("caption"))).toBe(false);
    expect(out.examined).toBe(TEXT_ELEMENTS);
  });

  it("祖先链采样真的走了：透明底色元素判到舞台的白底（#111 on #fff 合格，无假 warning）", async () => {
    const out = await runOnFixture<CollectorResult>(COLLECT_CONTRAST_SRC, CONTRAST_ARGS);
    const locations = out.findings.map((f) => f.location).join(" ");
    expect(locations).not.toContain("#inside");
    expect(locations).not.toContain("svg");
    expect(locations).not.toContain("chrome-marked");
  });

  it("背景不收敛（舞台自身半透明、祖先链上没有不透明底色）→ info，不当成某个色值硬算", async () => {
    await page.setContent(
      [
        '<!doctype html><html><head><style>html, body { margin: 0; padding: 0; }</style></head><body>',
        `<div data-testid="stage-frame" style="position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden;background:rgba(255,255,255,0.5)">`,
        `<div id="ghost" style="position:absolute;left:200px;top:200px;color:#111111;font-size:32px">半透明底上的文字</div>`,
        `</div></body></html>`,
      ].join("\n"),
    );
    const out = (await page.evaluate(
      `(${COLLECT_CONTRAST_SRC})(${JSON.stringify(CONTRAST_ARGS)})`,
    )) as CollectorResult;
    expect(out.examined).toBe(1);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("info"); // 不可判定：不猜背景
    expect(out.findings[0].message).toContain("不收敛");
  });
});

// ── #14 字体加载（无头半边） ──

describe("#14 字体加载（真浏览器：document.fonts 的 loaded 读法）", () => {
  it("真实 FontFaceSet（夹具页没有 @font-face）：loaded 空 → examined 0 → info（不是 blocker）", async () => {
    const out = await runOnFixture<FontsCollectorResult>(COLLECT_FONTS_SRC, {});
    expect(Array.isArray(out.loadedFamilies)).toBe(true);
    expect(out.loadedFamilies).toEqual([]);
    expect(out.examined).toBe(0);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("info");
    expect(out.findings[0].rule).toBe(FONT_RULE);
    expect(out.findings[0].message).toContain("无主题字体文本");
    // 使用面照样读出来（读数：全走 UA/系统字体也要看得见）
    expect(out.usedFamilies.join(" ")).toContain("Probe Used");
  });

  it("status==='loaded' 才算：unloaded 家族不进 loaded 面；loaded ⊄ used → blocker 带家族名清单", async () => {
    await page.setContent(FIXTURE_HTML);
    await page.evaluate(FAKE_FONTS_SETUP);
    const out = (await page.evaluate(
      `(${COLLECT_FONTS_SRC})(${JSON.stringify({})})`,
    )) as FontsCollectorResult;
    await page.evaluate(FAKE_FONTS_TEARDOWN);

    expect(out.fontFaceCount).toBe(5); // 317 条那类噪音的缩小版：同家族多 Face 要计数
    expect(out.familyCount).toBe(4); // 去重后 4 个家族
    expect(out.loadedFamilies).toEqual(["Probe Used", "Probe Quoted", "Probe Unused"]);
    expect(out.loadedFamilies).not.toContain("Probe Unloaded"); // 不过滤 status = 同义反复

    expect(out.findings).toHaveLength(1);
    const f = out.findings[0];
    expect(f.severity).toBe("blocker");
    // 差集面 = 冒号后、破折号前的那段（消息尾部的"已加载 N 个：…"是读数，不是差集）
    const missingPart = f.message.split("——")[0];
    expect(missingPart).toContain("Probe Unused"); // 加载了没人用
    expect(missingPart).not.toContain("Probe Quoted"); // 引号/大小写不制造假差集
    expect(missingPart).not.toContain("Probe Unloaded");
  });

  it("examined = 用主题字体的文本元素数（document.fonts 是文档级 → 使用面取整页渲染文本，含字幕）", async () => {
    await page.setContent(FIXTURE_HTML);
    await page.evaluate(FAKE_FONTS_SETUP);
    const out = (await page.evaluate(
      `(${COLLECT_FONTS_SRC})(${JSON.stringify({})})`,
    )) as FontsCollectorResult;
    await page.evaluate(FAKE_FONTS_TEARDOWN);
    // 10 个舞台内文本元素 + caption 的 span（框架级 chrome 也消费字体，故 #14 不排除它）
    expect(out.examined).toBe(TEXT_ELEMENTS + 1);
  });

  it("全 unloaded（正文全走 UA 默认字体的实况）→ examined 0 → info，不报 blocker", async () => {
    await page.setContent(FIXTURE_HTML);
    await page.evaluate(FAKE_FONTS_ONLY_UNLOADED);
    const out = (await page.evaluate(
      `(${COLLECT_FONTS_SRC})(${JSON.stringify({})})`,
    )) as FontsCollectorResult;
    await page.evaluate(FAKE_FONTS_TEARDOWN);

    expect(out.loadedFamilies).toEqual([]);
    expect(out.examined).toBe(0);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("info");
    expect(out.findings.some((f) => f.severity === "blocker")).toBe(false);
  });
});

// 与 headless 的接线口径（选择器/参数由 headless 显式传，收集器自身不猜）
describe("收集器参数与 headless 接线同源", () => {
  it("captionSelector / chromeSelector 是显式参数，与 TS 侧常量同源（收集器不内置猜测）", async () => {
    expect(MARGIN_ARGS.captionSelector).toBe(CAPTION_LAYER_SELECTOR);
    expect(MARGIN_ARGS.chromeSelector).toBe(CHROME_BAND_SELECTOR);
    expect(MARGIN_ARGS.canvasSelector).toBe(STAGE_SELECTOR);
    expect(CONTRAST_ARGS.canvasSelector).toBe(STAGE_SELECTOR);
  });
});
