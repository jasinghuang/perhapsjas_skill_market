/**
 * window-scan.browser.test.ts（M5a Task 2）：窗口预扫的**真机臂**（真 Chromium + 真模板应用）。
 *
 * 为什么 fixture 是**真应用**而不是手写 HTML（与 session/collectors 两个 browser 测试的分野）：
 *   本文件取证的是"example 三步的窗口读数"——那条读数（KenBurns duration="fast" ×10 = 3000ms）
 *   只有真章节组件才注册得出来；手写 HTML 里自己 animate 一个 div 是拿期望值当答案（自证）。
 *   服务用 `scripts/check/serve.ts` 的 `startServe()`（自起 Vite）：与无头门禁 / T7 渲染 CLI
 *   同一条起服路径（默认**不复用**外部服务——本机 5174 上常常是别人的项目，见该文件头；
 *   端口被占 Vite 自动 +1，实测本次跑在 5175）。
 *
 * 环境约定（T7/T8 已踩平的坑，逐条照做）+ 本任务新踩的一条：
 *   · 本文件跑在 jsdom（vitest 的 setupFiles 是全局的）；**不得**在文件任何位置写出
 *     environment 标记字面量——vitest 全文扫描（含注释）；
 *   · playwright 的 Node 侧入口在 jsdom 里缺 `TransformStream`（playwright-core 的 mcpBundle
 *     直接引用）——下方先补全局，再让它加载；
 *   · **TextEncoder/TextDecoder 的 realm 补齐（本任务新增）**：`startServe` 会在本进程里加载
 *     Vite → esbuild，而 esbuild 加载期做 invariant 检查
 *     `new TextEncoder().encode("") instanceof Uint8Array`——jsdom 的 TextEncoder（与 Node 的
 *     都不是本 realm 的）跨 realm 返回 false，直接抛 "your JavaScript environment is broken"。
 *     补一个 encode 返回值用**本 realm** 的 Uint8Array 构造的 TextEncoder 即可（见下）。
 *
 * 两臂：① 真 example 三步 → `[[3000, 0, 0]]`（与 M3b 实测一致）且能直接喂 buildTimeline；
 *       ② 负臂——manifest 声明多于页面实际步数时**必须 reject**（越界游标被 stepper 静默
 *       clamp：没有回读校验就会悄悄把别的帧的窗口写进表里，成片时长全错而无人发现）。
 */

import { TransformStream as NodeTransformStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chapters } from "../../src/chapters/manifest";
import { withRenderMode } from "../check/headless";
import { startServe, type ServeHandle } from "../check/serve";
import { scanAnimationWindows } from "./window-scan";
import { buildTimeline } from "./timeline";

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

let serve: ServeHandle | undefined;
let url = "";

beforeAll(async () => {
  serve = await startServe();
  url = withRenderMode(serve.url); // 渲染态（T7 同款）：?render=1 创建即冻结
}, 120_000);

afterAll(async () => {
  await serve?.stop();
});

describe("窗口预扫真机臂", () => {
  // M6 项目适配：模板原版断言示例章形状 [[3000,0,0]]——消费者项目换章后正臂红。
  // 本项目 deck = 6 章 21 步（Phase 1.5 占位，零动画）。Phase 4 章节上真动画后，
  // 本断言更新为实值（正臂继续钉"扫描读数与 buildTimeline 同源"这条语义）。
  it("项目 deck（21 步占位）→ animMsByStep === 21×0（零动画），且直接喂 buildTimeline 同值", async () => {
    const scan = await scanAnimationWindows({ url, chapters });

    const zeros = chapters.map((c) => new Array(c.steps).fill(0));
    // 实况读数：占位章无任何组件动画 → 窗口全 0
    expect(scan.animMsByStep).toEqual(zeros);
    // 注册表容量（诊断用，同序）：每步注册 0 个帧函数动画
    expect(scan.frameCountByStep).toEqual(zeros);

    // 生产者的消费面：这张表就是 buildTimeline 的 animMsByStep（形状/同源一次证完）
    const timeline = buildTimeline({
      chapters,
      durations: null, // 未合成音频（合法态）
      timings: {},
      animMsByStep: scan.animMsByStep,
    });
    expect(timeline.steps.map((s) => s.animMs)).toEqual(zeros.flat());
  }, 120_000);

  it("负臂：manifest 步数多于页面实际 → reject（越界 clamp 不许静默测错帧）", async () => {
    await expect(
      scanAnimationWindows({ url, chapters: [{ steps: 5 }] }),
    ).rejects.toThrow(/游标回读不符/);
  }, 120_000);
});
