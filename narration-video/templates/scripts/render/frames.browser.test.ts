/**
 * frames.browser.test.ts（M5a Task 4）：帧流捕捉的**真机臂**（真 Chromium + 真模板应用 + 真落盘 PNG）。
 *
 * 为什么 fixture 是**真应用**而不是手写 HTML（与 session/collectors 两个 browser 测试的分野）：
 *   本文件取证的是"example 三步 deck 的帧流"——91 帧那条读数（KenBurns duration="fast" ×10 =
 *   3000ms 窗口 + 400ms 垫）只有真章节组件 + 真时间轴表才产得出来；手写 HTML 里自己 animate
 *   一个 div 是拿期望值当答案（自证）。唯一的例外是第 4 条（R7 泄漏告警的**接线**）——那条取证
 *   的是"审计面读数 → warnings 通道"这段管线，与 deck 长什么样无关，故用最小夹具页（**不复用**
 *   session.browser.test.ts 的那份：它缺 seek，而补它要动 M3b 已验收的文件）。
 *
 * 环境约定（T7/T8 踩平 + T2 新增，逐条照抄 window-scan.browser.test.ts）：
 *   · 本文件跑在 jsdom（vitest 的 setupFiles 是全局的）；**不得**在文件任何位置写出
 *     environment 标记字面量——vitest 全文扫描（含注释）；
 *   · playwright 的 Node 侧入口在 jsdom 里缺 `TransformStream` → 先补全局再让它加载；
 *   · `startServe` 会在本进程里加载 Vite → esbuild，esbuild 的 invariant 要求
 *     `new TextEncoder().encode("") instanceof Uint8Array` 用**本 realm** 的 Uint8Array（见下）。
 *
 * 四条判据：
 *   1. 三步 deck：帧目录张数 == `timeline.frameCount`（真读数 91 + 1 + 1 = 93），且
 *      `captured.animMs === timeline.animMs`（**同源断言**——窗口预扫与帧流采集两趟一致）；
 *   2. **确定性（强判据）**：同一 (step, t) 在两个**独立会话**里各截一次 → 逐字节相同；
 *      **负样本** t=0 与 t=1500 的帧必须不同（动画根本没画时，"两拍一致"会假绿）；
 *   3. **同源断言的负臂**：把时间轴里的窗口改坏 → reject 且**一张帧都不落**（fail fast）；
 *   4. **R7 泄漏告警的接线**：夹具页报 unowned > 0 → 该步 warnings 含 hints（stderr 也打出来）。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chapters } from "../../src/chapters/manifest";
import { stageConfig } from "../../src/engine/runtime-config";
import { withRenderMode } from "../check/headless";
import { startServe, type ServeHandle } from "../check/serve";
import { jumpToStep, openSession, readyWithTimeout, seekTo } from "../shot/session";
import { captureFrames, type FrameSpec } from "./frames";
import { buildTimeline, type Timeline } from "./timeline";
import { scanAnimationWindows } from "./window-scan";

// ── 环境补齐（必须在任何 startServe / openSession 之前；见文件头） ──

/** 跨 realm 的 esbuild invariant：encode 的返回值须由**本 realm** 的 Uint8Array 构造。 */
class RealmTextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    const src = super.encode(input);
    const out = new Uint8Array(src.length); // 长度重载 → 普通 ArrayBuffer 背板（本 realm）
    out.set(src);
    return out;
  }
}
(globalThis as { TextEncoder?: unknown }).TextEncoder = RealmTextEncoder;
(globalThis as { TextDecoder?: unknown }).TextDecoder = NodeTextDecoder;
(globalThis as { TransformStream?: unknown }).TransformStream ??= NodeTransformStream;

// ── 夹具 ──

const tmpDirs: string[] = [];

/** 每一步一个独立的临时 outDir（帧目录是产物；测试不往工作区写东西）。 */
function tempOutDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `frames-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

function md5(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/** 帧目录 → 按文件名排序的 md5 清单（帧流的"逐字节"面）。 */
function frameMd5s(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => md5(path.join(dir, f)));
}

let serve: ServeHandle | undefined;
let url = "";
let timeline: Timeline;
let specs: FrameSpec[];

beforeAll(async () => {
  serve = await startServe();
  url = withRenderMode(serve.url); // 渲染态（T7 同款）：?render=1 创建即冻结
  const scan = await scanAnimationWindows({ url, chapters });
  timeline = buildTimeline({
    chapters,
    durations: null, // 模板无 public/audio-durations.json（未合成，合法态）
    timings: { example: chapters[0].timing },
    animMsByStep: scan.animMsByStep,
  });
  specs = timeline.steps.map((s) => ({ chapter: s.chapter, step: s.step, chapterId: s.chapterId }));
}, 120_000);

afterAll(async () => {
  await serve?.stop();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("帧流真机臂", () => {
  it("三步 deck：帧目录张数 == timeline.frameCount（91+1+1），captured.animMs === timeline.animMs", async () => {
    const outDir = tempOutDir("deck");
    const captured = await captureFrames(specs, { url, outDir, timeline, concurrency: 2 });

    // 返回面：顺序 == specs 序（帧流的顺序即产物顺序，T5 的 concat 清单直接照抄）
    expect(captured.map((c) => [c.chapter, c.step, c.chapterId])).toEqual([
      [0, 0, "example"],
      [0, 1, "example"],
      [0, 2, "example"],
    ]);

    // 真读数（与 T1/T2 的算术独立对得上）：step 0 窗口 3000ms（KenBurns fast×10）→ 窗口拍 90 +
    // 静置拍 1 = 91 帧；两个静态步各 1 帧（holdMs>0 的静置拍，t=0）
    expect(timeline.steps.map((s) => s.animMs)).toEqual([3000, 0, 0]);
    expect(timeline.steps.map((s) => s.frameCount)).toEqual([91, 1, 1]);
    expect(timeline.steps.map((s) => s.holdMs > 0)).toEqual([true, true, true]);

    // 落盘面：**帧目录张数 == timeline.frameCount**（不是"看着差不多"——逐条相等）
    for (const [i, c] of captured.entries()) {
      const step = timeline.steps[i];
      const stepDir = path.join(outDir, c.dir);
      const files = fs.readdirSync(stepDir).sort();
      expect(files).toHaveLength(step.frameCount);
      expect(files[0]).toBe("0001.png"); // 1 起编
      expect(files[files.length - 1]).toBe(`${String(step.frameCount).padStart(4, "0")}.png`);
      // 同源断言（硬约束 1）：捕捉期读到的窗口 === 时间轴里的值；帧数也只认时间轴
      expect(c.animMs).toBe(step.animMs);
      expect(c.frameCount).toBe(step.frameCount);
      expect(c.holdMs).toBe(step.holdMs);
    }
    expect(captured.reduce((n, c) => n + c.frameCount, 0)).toBe(93); // 与 T6 的 expectedPngTotal 同口径

    // R7：真 deck 无泄漏 → 每步 warnings 是**空数组**（字段恒在；也顺带钉住"这条通道被走过"）
    expect(captured.map((c) => c.warnings)).toEqual([[], [], []]);
  }, 300_000);

  it("确定性（强判据）：跨独立会话同一 t 逐字节一致；负样本 t=0 与 t=1500 必须不同", async () => {
    // 两个独立的 captureFrames 运行 = 两组独立的 openSession（两个不同的浏览器进程），
    // 不是同一页连拍——"同一页连拍一致"只证明页面没动过，证明不了可重放。
    const dirA = tempOutDir("det-a");
    const dirB = tempOutDir("det-b");
    await captureFrames(specs, { url, outDir: dirA, timeline, only: [0], concurrency: 1 });
    await captureFrames(specs, { url, outDir: dirB, timeline, only: [0], concurrency: 1 });

    const a = frameMd5s(path.join(dirA, "frames/example/0"));
    const b = frameMd5s(path.join(dirB, "frames/example/0"));
    expect(a).toHaveLength(91);
    expect(a).toEqual(b); // 91 帧逐字节相同（含 t=1500 的第 46 张）

    // 负样本（判据的另一半）：动画**真的在画**。t=0 ↔ t=1500（45·1000/30 → 第 46 张）必须不同；
    // 若这一条绿着，而上面那条也绿——只能说明整条帧流是死图（两拍一致毫无意义）。
    expect(a[0]).not.toBe(a[45]);
    // 窗口内不是"只有那张不同"的巧合：整段帧流确实在变
    expect(new Set(a).size).toBeGreaterThan(10);

    // 第三拍（补上面两条都抓不到的那类错——**系统性偏一拍**）：
    // 独立会话里只 seek(1500) 截一张，与流里的第 46 张逐字节比对。若 seek→截图之间截的是
    // 上一拍（或整条流管线一致地偏一拍），两条"跨会话一致"照样全绿，只有这条会红。
    const directDir = tempOutDir("det-direct");
    const directFile = path.join(directDir, "direct.png");
    const session = await openSession({ url, viewport: stageConfig.dims });
    try {
      await jumpToStep(session.page, { chapter: 0, step: 0 });
      await readyWithTimeout(session.page, "独立采样：章节 0 第 0 步");
      await seekTo(session.page, 1500);
      await session.page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      await session.page.screenshot({ path: directFile });
    } finally {
      await session.close();
    }
    expect(md5(directFile)).toBe(a[45]);
  }, 300_000);

  it("同源断言负臂：时间轴窗口与捕捉期读数不符 → reject，且一张帧都不落（fail fast）", async () => {
    const outDir = tempOutDir("same-source");
    // 把 step 0 的窗口改坏（少 1000ms）：页面仍报 3000ms → 两趟各说各话
    const doctored: Timeline = {
      ...timeline,
      steps: timeline.steps.map((s, i) => (i === 0 ? { ...s, animMs: s.animMs - 1000 } : s)),
    };
    await expect(
      captureFrames(specs, { url, outDir, timeline: doctored, only: [0], concurrency: 1 }),
    ).rejects.toThrow(/两趟各说各话/);
    // 断言读在帧循环之前：不白截 91 张，也不留半个目录
    expect(fs.existsSync(path.join(outDir, "frames/example/0"))).toBe(false);
  }, 120_000);

  it("worker 失败即整轮失败：一个 worker 炸了，不许被别家的成功兜住（并发 2 两片各一步）", async () => {
    const outDir = tempOutDir("worker-fail");
    // 只渲两个静态步（各 1 帧，便宜）；两片各一步 → step 1 的 worker 正常、step 2 的 worker 炸
    const doctored: Timeline = {
      ...timeline,
      steps: timeline.steps.map((s, i) => (i === 2 ? { ...s, animMs: 1000 } : s)),
    };
    const err = await captureFrames(specs, {
      url,
      outDir,
      timeline: doctored,
      only: [1, 2],
      concurrency: 2,
    }).then(
      () => "(没炸——不该发生)",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(err).toMatch(/整轮失败/);
    expect(err).toMatch(/worker #1/); // 炸的那一片（step 2）
    expect(err).toMatch(/章节 0 第 2 步/); // 聚合的是那一步的定位，不是笼统的"渲染失败"
    // 正常那片（step 1）的帧确实落了盘，但整轮照样失败——**不返回半份结果**
    expect(fs.readdirSync(path.join(outDir, "frames/example/1"))).toEqual(["0001.png"]);
    expect(fs.existsSync(path.join(outDir, "frames/example/2"))).toBe(false);
  }, 120_000);
});

// ── R7 泄漏告警的接线（最小夹具页：取证的是"审计面 → warnings 通道"，与 deck 内容无关） ──

const servers: http.Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/**
 * 夹具页：最小游标桥（六成员齐备，含 T3 的 `seek`——session.browser.test.ts 那份缺它，
 * 而补它要动 M3b 已验收的文件，故本文件自带一份），`audit()` 恒报一个**章节层泄漏**动画
 * （unowned=1 + hints），`windowMs=0`（泄漏动画不在注册表里 ⇒ 窗口读 0 ⇒ 成片那一步会冻住）。
 */
async function serveLeakFixture(): Promise<string> {
  const html = [
    "<!doctype html><html><body><div class='leak-run'>leak</div><script>",
    "window.__presentation = {",
    "  jumpTo: function () {}, getState: function () { return { chapter: 0, step: 0 }; },",
    "  ready: function () { return Promise.resolve(); }, animations: function () { return 1; },",
    "  audit: function () { return { waapi: 1, owned: 0, unowned: 1, unownedRunning: 0, unownedHints: ['.leak-run'], running: 0, registry: 0, windowMs: 0 }; },",
    "  seek: function () {}",
    "};",
    "</script></body></html>",
  ].join("\n");
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}/`;
}

describe("R7 泄漏告警（真机接线）", () => {
  it("页面报 unowned > 0 → 该步 warnings 含 unownedHints，且同一串打到 stderr（唯一能看见它的地方）", async () => {
    const fixture = await serveLeakFixture();
    const outDir = tempOutDir("leak");
    const leakTimeline: Timeline = {
      fps: 30,
      totalMs: 1000,
      steps: [
        {
          chapter: 0,
          step: 0,
          chapterId: "leak",
          startMs: 0,
          audioMs: null,
          animMs: 0,
          dwellMs: 1000,
          stepMs: 1000,
          frameCount: 1,
          holdMs: 1000,
        },
      ],
    };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let warned = "";
    const captured = await captureFrames([{ chapter: 0, step: 0, chapterId: "leak" }], {
      url: withRenderMode(fixture),
      outDir,
      timeline: leakTimeline,
      concurrency: 1,
    }).finally(() => {
      // 先取快照再还原：vitest 的 mockRestore 会清掉 mock.calls（实测踩过，读出来是空串）
      warned = spy.mock.calls.flat().join("\n");
      spy.mockRestore();
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].warnings).toHaveLength(1);
    expect(captured[0].warnings?.[0]).toContain("章节 0 第 0 步（leak）");
    expect(captured[0].warnings?.[0]).toContain(".leak-run"); // hints 必须列出来（排查的唯一线索）
    expect(warned).toContain(".leak-run"); // stderr 通道（CLI 跑渲染时人眼能看见的那条）
    // 帧照出（告警不阻断出片）：泄漏步的窗口是 0 ⇒ 只有静置那一张
    expect(fs.readdirSync(path.join(outDir, "frames/leak/0"))).toEqual(["0001.png"]);
  }, 120_000);
});
