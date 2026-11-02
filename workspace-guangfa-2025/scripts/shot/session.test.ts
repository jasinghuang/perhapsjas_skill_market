// M3b Task 3 会话模块单测（K-21）：冻结面 + 内联 evaluate 外提的两个消费改造护栏。
//
// 单测面刻意**不启浏览器**（与 capture.test.ts 同策略：jsdom 里跑纯函数与薄封装）：
//   · 页面侧驱动（openSession）靠真机冒烟与 storyboard/verify 两条实跑路径反证；
//   · **例外（M3b Task 7 修复轮 1 / I1）**：`beforeGoto` 导航前钩子的**调用顺序**用 playwright
//     替身钉死在本文件（"监听必须早于 goto"是这条修复的全部要点）；其**真机两臂**在
//     `session.browser.test.ts`——jsdom 环境里 `vi.importActual("playwright")` 会炸
//     （playwright-core 的 mcpBundle 需要 jsdom 里没有的 TransformStream），真浏览器用例
//     必须跑在 node 环境（同 Task 8 的 collectors.browser.test.ts 约定）；
//   · jumpToStep / readCursor / readAnimations 用最小 Page 替身钉住"页面侧回调调了哪座桥的
//     哪个方法、参数怎么传"——这三条正是 capture.ts 原先内联的 evaluate，外提后必须逐字等价。

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import * as session from "./session";
import {
  jumpToStep,
  openSession,
  readAnimations,
  readCursor,
  seekTo,
  withHeadless,
  withNoSubs,
} from "./session";

describe("withHeadless：URL 归一（幂等 + 保留既有 query）", () => {
  it("无 query → 追加 ?headless=1", () => {
    expect(withHeadless("http://localhost:5174")).toBe("http://localhost:5174/?headless=1");
  });

  it("既有 query 保留（?render=1 不被吞——分镜的干净帧模式）", () => {
    expect(withHeadless("http://a:1/?render=1")).toBe("http://a:1/?render=1&headless=1");
  });

  it("已含 headless → 原样（幂等：openSession 内部再归一也不翻倍）", () => {
    expect(withHeadless("http://a:1/?headless=1")).toBe("http://a:1/?headless=1");
    expect(withHeadless(withHeadless("http://a:1/?render=1"))).toBe("http://a:1/?render=1&headless=1");
  });
});

// M5b T3 评审 I1 的**会话侧一半**：`--no-subs` 的参数名同一性零覆盖——`session.ts` 写什么参数名、
// `src/App.tsx` 就读什么参数名，两侧各写一个**字面量**，任一侧改名都是**静默失效**（管线全绿、
// 产物带字幕：verify 比的是"产物帧 vs 重采帧"，两侧同错即同绿）。这里把写侧的字面量钉死；
// 读侧的一半在 `src/App.test.tsx`（`?no-subs=1` → 字幕层不在 DOM）。
describe("withNoSubs：URL 归一（参数名 = 页面读的那个字面量；幂等 + 保留既有 query）", () => {
  it("无 query → 追加 ?no-subs=1（**参数名不得改**：改了 App.tsx 就静默读不到、字幕照进片）", () => {
    expect(withNoSubs("http://localhost:5174")).toBe("http://localhost:5174/?no-subs=1");
  });

  it("既有 query 保留（?render=1 / headless 不被吞——渲染链三个消费者吃同一份 URL）", () => {
    expect(withNoSubs("http://a:1/?render=1")).toBe("http://a:1/?render=1&no-subs=1");
    expect(withNoSubs("http://a:1/?render=1&headless=1")).toBe(
      "http://a:1/?render=1&headless=1&no-subs=1",
    );
  });

  it("已含 no-subs → 原样（幂等：降级路径 realtimeUrl 之后再加也不会翻倍）", () => {
    expect(withNoSubs("http://a:1/?no-subs=1")).toBe("http://a:1/?no-subs=1");
    expect(withNoSubs(withNoSubs("http://a:1/?render=1"))).toBe("http://a:1/?render=1&no-subs=1");
  });
});

describe("session 冻结面（接口约定 1：M5 与无头门禁的消费契约）", () => {
  it("导出面齐备（缺一个即破跨计划契约）", () => {
    for (const k of [
      "openSession",
      "readyWithTimeout",
      "jumpToStep",
      "readCursor",
      "readAnimations",
      "seekTo",
      "expandSpecs",
      "shotPath",
      "assertCursorMatch",
      "assertCursorStill",
      "withHeadless",
      // M5b Task 3 追加（接口约定 3 点名）：URL 归一到无字幕版；M5b T6 补进冻结面清单
      // （K-62② 的同型先例：接口约定点了名的成员就该在"存在性 ⊆"清单里防误删）
      "withNoSubs",
      "isMissingBrowserError",
      "chromiumMissingError",
      "CHROMIUM_INSTALL_HINT",
      "READY_TIMEOUT_MS",
      "DEFAULT_VIEWPORT",
    ]) {
      expect(k in session, `session 缺导出：${k}`).toBe(true);
    }
  });

  it("常量语义不变（迁移不得改形：安装命令字面量 / 超时 / 1080p 视口）", () => {
    expect(session.CHROMIUM_INSTALL_HINT).toBe("npx playwright install chromium");
    expect(session.READY_TIMEOUT_MS).toBe(10_000);
    expect(session.DEFAULT_VIEWPORT).toEqual({ width: 1920, height: 1080 });
  });

  it("依赖单向：session.ts 源码不 import ./capture（否则运行期成环炸链接）", () => {
    // 用 fileURLToPath 而非 new URL(rel, import.meta.url)：jsdom 环境的 URL 全局把相对路径
    // 解析成 http://localhost:3000/...（实测），只有 fileURLToPath 拿到真实文件路径。
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, "session.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/capture["']/);
  });
});

describe("capture.ts 再导出面（K-21 迁移不得破向后兼容）", () => {
  it("冻结契约仍可 import（含 captureSteps 自身）", async () => {
    const cap = await import("./capture");
    for (const k of [
      "expandSpecs",
      "shotPath",
      "assertCursorMatch",
      "assertCursorStill",
      "withHeadless",
      "chromiumMissingError",
      "CHROMIUM_INSTALL_HINT",
      "READY_TIMEOUT_MS",
      "DEFAULT_VIEWPORT",
      "captureSteps",
    ]) {
      expect(k in cap, `capture 缺导出：${k}`).toBe(true);
    }
  });

  it("再导出 = 同一绑定（非第二份真相：常量改了单侧不漂移）", async () => {
    const cap = await import("./capture");
    expect(cap.withHeadless).toBe(session.withHeadless);
    expect(cap.shotPath).toBe(session.shotPath);
    expect(cap.expandSpecs).toBe(session.expandSpecs);
    expect(cap.assertCursorMatch).toBe(session.assertCursorMatch);
    expect(cap.assertCursorStill).toBe(session.assertCursorStill);
    expect(cap.isMissingBrowserError).toBe(session.isMissingBrowserError);
    expect(cap.chromiumMissingError).toBe(session.chromiumMissingError);
    expect(cap.READY_TIMEOUT_MS).toBe(session.READY_TIMEOUT_MS);
    expect(cap.CHROMIUM_INSTALL_HINT).toBe(session.CHROMIUM_INSTALL_HINT);
    expect(cap.DEFAULT_VIEWPORT).toBe(session.DEFAULT_VIEWPORT);
  });
});

// ── 页面侧薄封装（最小 Page 替身；不启浏览器） ──

interface StubCall {
  fn: (arg?: unknown) => unknown;
  arg: unknown;
}

function stubPage(result?: unknown): { page: Page; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const page = {
    evaluate: async (fn: (arg?: unknown) => unknown, arg?: unknown) => {
      calls.push({ fn, arg });
      return result;
    },
  };
  return { page: page as unknown as Page, calls };
}

/** 装一座最小桥（只实现本次断言用到的方法），返回后由调用方按需读回。 */
function installStubBridge(bridge: Record<string, unknown>): void {
  (window as unknown as { __presentation?: unknown }).__presentation = bridge;
}

describe("jumpToStep / readCursor / readAnimations：内联 evaluate 外提（语义逐字等价）", () => {
  it("jumpToStep：页面侧回调调 window.__presentation.jumpTo(chapter, step)", async () => {
    const seen: Array<[number, number]> = [];
    installStubBridge({ jumpTo: (c: number, s: number) => seen.push([c, s]) });
    const { page, calls } = stubPage();
    await jumpToStep(page, { chapter: 2, step: 5 });
    expect(calls).toHaveLength(1);
    (calls[0].fn as (arg: unknown) => void)(calls[0].arg);
    expect(seen).toEqual([[2, 5]]);
  });

  it("jumpToStep：spec 以对象传入（页面侧不依赖位置参数顺序）", async () => {
    installStubBridge({ jumpTo: () => undefined });
    const { page, calls } = stubPage();
    await jumpToStep(page, { chapter: 0, step: 7 });
    expect(calls[0].arg).toEqual({ chapter: 0, step: 7 });
  });

  it("readCursor：页面侧回调读 window.__presentation.getState()，结果原样返回", async () => {
    const st = { chapter: 4, step: 2 };
    installStubBridge({ getState: () => st });
    const { page, calls } = stubPage(st);
    await expect(readCursor(page)).resolves.toEqual(st);
    expect((calls[0].fn as () => unknown)()).toEqual(st);
  });

  it("readAnimations：页面侧回调读 window.__presentation.animations()，0 也如实透传", async () => {
    installStubBridge({ animations: () => 7 });
    const { page, calls } = stubPage(0);
    await expect(readAnimations(page)).resolves.toBe(0);
    expect((calls[0].fn as () => unknown)()).toBe(7);
  });
});

describe("seekTo：M5a Task 3 追加的定位入口（渲染器唯一入口；截图前 seekTo(0) 归位）", () => {
  it("seekTo：页面侧回调调 window.__presentation.seek(tMs)，参数原样透传（clamp 归桥）", async () => {
    const seen: number[] = [];
    installStubBridge({ seek: (t: number) => seen.push(t) });
    const { page, calls } = stubPage();

    await seekTo(page, 1500);
    expect(calls).toHaveLength(1);

    // 0（每帧截图的归位值）与负数都原样送达：**唯一 clamp 点在桥**（seekAll(clamp)），
    // session 这层不做第二份限幅——两处各自 clamp 会让"谁改了参数"无从归因。
    await seekTo(page, 0);
    await seekTo(page, -5);
    expect(calls.map((c) => c.arg)).toEqual([1500, 0, -5]);

    // 回放三条页面侧回调（替身只记录不执行）→ 桥收到的就是这三个数，逐条不倒序不错位
    for (const c of calls) (c.fn as (arg: unknown) => void)(c.arg);
    expect(seen).toEqual([1500, 0, -5]);
  });
});

// ── 修复轮 1（I1）：openSession 的导航前钩子 beforeGoto ──
//
// 由来：页面**装载期**（Vite client / React 首帧挂载 / 首步 effect）的事件在 openSession
// 返回前就发完了（waitForBridge 等的是挂载后才装的桥）——晚挂监听即永久丢失。无头门禁的
// #16 ① 断言的正是这段窗口里的报错（评审实测：useEffect(…, []) 里的 console.error 整条漏报）。
//
// 本 describe 两条：① 调用顺序（playwright 替身，jsdom 内跑）；② 真机两臂（真浏览器 +
// 本地 http 夹具页）。替身与真机**分处两个 describe**——vi.mock 是文件级，替身会截胡真机臂。

const { pwCalls, pwLaunchArgs, pwLaunchFail } = vi.hoisted(() => ({
  pwCalls: [] as string[],
  /** launch 收到的参数（M5a Task 4：softwareGL 的启动参数面）——与 pwCalls 分开，不动 M3b 的定序断言 */
  pwLaunchArgs: [] as unknown[],
  /** 故障注入：none = 正常；flags = 带 args 的启动失败（模拟 Chromium 不认软渲 flag）；
   *  missing = 浏览器缺失；other = 其它启动失败（沙箱/权限一类，应原样抛） */
  pwLaunchFail: { mode: "none" as "none" | "flags" | "missing" | "other" },
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: async (opts?: { args?: readonly string[] }) => {
      pwLaunchArgs.push(opts);
      if (pwLaunchFail.mode === "missing") throw new Error("Executable doesn't exist at /x/chromium");
      if (pwLaunchFail.mode === "other") throw new Error("sandbox permission denied");
      if (pwLaunchFail.mode === "flags" && opts?.args !== undefined) {
        throw new Error("launch failed: unknown switch --use-gl=angle");
      }
      return {
        newPage: async () => {
          pwCalls.push("newPage");
          return {
            goto: async (url: string) => {
              pwCalls.push("goto:" + url);
            },
            waitForFunction: async () => {
              pwCalls.push("waitForFunction");
            },
            on: () => undefined,
            evaluate: async () => undefined,
          };
        },
        close: async () => undefined,
      };
    },
  },
}));

describe("beforeGoto：调用顺序（替身）", () => {
  it("钩子在 page.goto 之前调用——晚一步就漏掉整个装载期", async () => {
    pwCalls.length = 0;
    const session = await openSession({
      url: "http://fixture.test/",
      beforeGoto: (page) => {
        pwCalls.push("beforeGoto");
        expect(typeof page.on).toBe("function");
      },
    });
    expect(pwCalls).toEqual([
      "newPage",
      "beforeGoto",
      "goto:http://fixture.test/?headless=1",
      "waitForFunction",
    ]);
    await session.close();
  });

  it("不传钩子 → 顺序不变（既有调用方 capture/verify 行为零变化）", async () => {
    pwCalls.length = 0;
    const session = await openSession({ url: "http://fixture.test/" });
    expect(pwCalls).toEqual(["newPage", "goto:http://fixture.test/?headless=1", "waitForFunction"]);
    await session.close();
  });
});

// M5a Task 4（§11.2 软件渲染）：`softwareGL` 的启动参数面。
// 两条判据：① **默认 false = 无参 launch**（既有 capture/storyboard/verify 三条管线逐字节不变
// ——这是本字段唯一的回归面）；② 软渲 flag 不被接受时**退化为默认 GL**（不把渲染链拖死），
// 但"浏览器缺失"这条判据优先于退化重试（否则安装指引会被重试吞掉）。
describe("softwareGL：启动参数（M5a Task 4 追加；默认 false 逐字节不变）", () => {
  const launchArgsSeen = (): unknown[] =>
    pwLaunchArgs.map((o) => (o as { args?: unknown } | undefined)?.args);

  it("默认（不传）→ `launch()` 无参：既有管线行为零变化", async () => {
    pwLaunchArgs.length = 0;
    const s = await openSession({ url: "http://fixture.test/" });
    await s.close();
    expect(pwLaunchArgs).toEqual([undefined]);
  });

  it("显式 false → 与不传等价（无参）", async () => {
    pwLaunchArgs.length = 0;
    const s = await openSession({ url: "http://fixture.test/", softwareGL: false });
    await s.close();
    expect(pwLaunchArgs).toEqual([undefined]);
  });

  it("true → 传 SOFTWARE_GL_ARGS（软渲两件套；常量本身也钉住）", async () => {
    pwLaunchArgs.length = 0;
    const s = await openSession({ url: "http://fixture.test/", softwareGL: true });
    await s.close();
    expect(launchArgsSeen()).toEqual([[...session.SOFTWARE_GL_ARGS]]);
    expect([...session.SOFTWARE_GL_ARGS]).toEqual(["--use-gl=angle", "--use-angle=swiftshader"]);
  });

  it("软渲 flag 不被接受（launch 抛）→ 退化为默认 GL 重试，不抛错（渲染照出，且显式告警）", async () => {
    pwLaunchArgs.length = 0;
    pwLaunchFail.mode = "flags";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const s = await openSession({ url: "http://fixture.test/", softwareGL: true });
      await s.close();
      expect(launchArgsSeen()).toEqual([[...session.SOFTWARE_GL_ARGS], undefined]);
      expect(warn.mock.calls.flat().join("\n")).toContain("softwareGL 启动失败");
    } finally {
      warn.mockRestore();
      pwLaunchFail.mode = "none";
    }
  });

  it("浏览器缺失优先于退化（重试会吞掉安装指引）→ 抛指引错误，且不重试", async () => {
    pwLaunchArgs.length = 0;
    pwLaunchFail.mode = "missing";
    try {
      await expect(
        openSession({ url: "http://fixture.test/", softwareGL: true }),
      ).rejects.toThrow(/npx playwright install chromium/);
      expect(pwLaunchArgs).toHaveLength(1); // 只试了一次（没有第二次启动）
    } finally {
      pwLaunchFail.mode = "none";
    }
  });

  it("其它启动失败（沙箱/权限一类，非软渲路径）→ 原样抛、不重试（不吞真因）", async () => {
    pwLaunchArgs.length = 0;
    pwLaunchFail.mode = "other";
    try {
      await expect(openSession({ url: "http://fixture.test/" })).rejects.toThrow(
        /sandbox permission denied/,
      );
      expect(pwLaunchArgs).toHaveLength(1); // 没有第二次启动
    } finally {
      pwLaunchFail.mode = "none";
    }
  });
});
