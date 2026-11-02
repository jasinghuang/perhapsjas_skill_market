/**
 * session.browser.test.ts（M3b Task 7 修复轮 1 / I1）：`openSession` 的**导航前钩子**
 * `beforeGoto` 的**真机两臂**。
 *
 * 为什么必须单独一个文件：
 *   · 不能留在 `session.test.ts`：那里的 `vi.mock("playwright")` 是**文件级**的，真机臂会被
 *     替身截胡（实测：替身版的"真机臂"8ms 就"通过"了，其实一条消息都没产生）。
 *
 * 环境（两处实测坑，写在这里防返工）：
 *   · 本文件跑在 **jsdom**（vitest 的 `setupFiles` 是全局的，把 environment docblock 写成 node
 *     会撞上 `src/test-setup.ts` 的 `Element.prototype.animate` → "Element is not defined"；
 *     注意 vitest 会在文件**任意位置**扫描 environment 标记——注释里都别写出那个字面量）；
 *   · 但 playwright 的 Node 侧入口在 jsdom 里缺 `TransformStream`（`playwright-core` 的
 *     mcpBundle 直接引用它）——故在下方的**一个全局补齐**之后再让它加载。
 *
 * 取证的是 I1 的机制本身：页面**装载期**（早于 load、早于 React 挂载、早于桥安装）产生的
 * `console.error`，只有在 `page.goto` **之前**挂上监听才抓得到；`openSession` 返回之后再挂
 * 就是修复前的挂法——事件早已发完（`waitForBridge` 等的桥本身就是挂载后才装的）。
 *
 * 夹具页：本地 http（端口 0 由系统分配）+ inline script 抛一条 probe 报错 + 最小游标桥
 * （`window.__presentation`，让 `openSession` 的等桥通过）。两臂都用**真实的 openSession**，
 * 差别只在传不传钩子——这样"钩子确实在起作用"才是被证明的，而不是碰巧。
 */

import * as http from "node:http";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { afterEach, describe, expect, it } from "vitest";
import { openSession } from "./session";

// jsdom 缺 TransformStream（Node 有）——playwright-core 加载期就要它。补在**任何 openSession
// 调用之前**（session 对 playwright 是运行期动态 import，故此处补齐即可）。
(globalThis as { TransformStream?: unknown }).TransformStream ??= NodeTransformStream;

const servers: http.Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/** 夹具页：装载期（inline script，早于 load）抛一条 console.error，并装上最小游标桥。 */
async function serveMountProbe(): Promise<string> {
  const html = [
    "<!doctype html><html><body><script>",
    'console.error("probeA-mount-once-only");',
    "window.__presentation = {",
    "  jumpTo: function () {}, getState: function () { return { chapter: 0, step: 0 }; },",
    "  ready: function () { return Promise.resolve(); }, animations: function () { return 0; },",
    "  audit: function () { return { waapi: 0, owned: 0, unowned: 0, unownedRunning: 0, unownedHints: [], running: 0, registry: 0, windowMs: 0 }; }",
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

describe("beforeGoto 真机两臂（装载期消息必须在监听之内）", () => {
  it("传钩子 → 抓到装载期 console.error；不传（修复前的挂法）→ 抓不到", async () => {
    const url = await serveMountProbe();

    // 臂 A（修复后）：监听经 beforeGoto 在导航前挂上
    const withHook: string[] = [];
    const a = await openSession({
      url,
      beforeGoto: (page) => page.on("console", (m) => withHook.push(m.text())),
    });
    await a.close();
    expect(withHook).toContain("probeA-mount-once-only");

    // 臂 B（对照 = 修复前的挂法：等 openSession 返回之后再挂）
    const withoutHook: string[] = [];
    const b = await openSession({ url });
    b.page.on("console", (m) => withoutHook.push(m.text()));
    await b.close();
    expect(withoutHook).not.toContain("probeA-mount-once-only");
  }, 120_000);
});
