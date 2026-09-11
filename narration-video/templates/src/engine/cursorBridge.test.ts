import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canvasAnim } from "./animationRuntime";
import {
  animations,
  audit,
  installBridge,
  ready,
  shouldInstallBridge,
  uninstallBridge,
  type AnimationAudit,
  type PresentationBridge,
} from "./cursorBridge";

// 全局测试基建（test-setup.ts）的 rAF 是"不执行回调"的 no-op 捕获桩——本文件要验证
// ready() 的帧等待可确定 flush，故覆盖为同步执行版。双 rAF 链条里回调只 resolve，
// 下一次排帧发生在 promise 微任务之后（非回调内嵌套），不会自递归。
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  uninstallBridge();
  document.body.innerHTML = "";
  // 用例内按需 stub 的浏览器能力不残留到后续文件/用例
  Reflect.deleteProperty(document, "fonts");
  Reflect.deleteProperty(document, "getAnimations");
});

/** 排空微任务：一个真实宏任务回合后，promise 链必然全部落定（本文件不用假计时器） */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stubFonts(readyPromise: Promise<unknown>): void {
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: readyPromise } });
}

/** 全零审计面（M3b Task 5 追加成员；形状与 AnimationAudit 逐字一致） */
function emptyAudit(): AnimationAudit {
  return {
    waapi: 0,
    owned: 0,
    unowned: 0,
    unownedRunning: 0,
    unownedHints: [],
    registry: 0,
    windowMs: 0,
    running: 0,
  };
}

function makeBridge(overrides: Partial<PresentationBridge> = {}): PresentationBridge {
  return {
    jumpTo: vi.fn(),
    getState: () => ({ chapter: 0, step: 0 }),
    ready: async () => {},
    animations: () => 0,
    audit: emptyAudit,
    ...overrides,
  };
}

/**
 * 可手动泵帧的 rAF 桩（**判别时序用**）：回调入队不执行，只有 pump() 才走一帧。
 * 不能用同步执行桩——那样"帧窗口"会塌缩到 ready() 调用瞬间（首帧回调在 Promise.all
 * 走到图像等待之前就跑完了），"帧先行 vs 三路并发"的差异被抹平，用例丧失判别力。
 */
function pumpableFrames(onFrame?: (frameNo: number) => void) {
  const queue: FrameRequestCallback[] = [];
  let frameNo = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  return {
    pending: () => queue.length,
    pump() {
      frameNo += 1;
      onFrame?.(frameNo); // 帧窗口内的 DOM 变动（模拟 React commit 挂载新图）
      for (const cb of queue.splice(0)) cb(0);
    },
  };
}

/** 造一张"未完成"的图：jsdom 不真实拉取资源，complete 翻转 + load/error 事件由测试驱动 */
function pendingImage(): { img: HTMLImageElement; load: () => void; fail: () => void } {
  const img = document.createElement("img");
  let complete = false;
  Object.defineProperty(img, "complete", { configurable: true, get: () => complete });
  document.body.appendChild(img);
  return {
    img,
    load: () => {
      complete = true;
      img.dispatchEvent(new Event("load"));
    },
    fail: () => img.dispatchEvent(new Event("error")),
  };
}

describe("cursorBridge · 安装/卸载", () => {
  it("仅显式 installBridge 才暴露：模块导入本身不安装（生产守卫的底线）", () => {
    expect(window.__presentation).toBeUndefined();
    expect(typeof installBridge).toBe("function");
    expect(typeof uninstallBridge).toBe("function");
  });

  it("installBridge 后 window.__presentation 可用，jumpTo/getState 透传", () => {
    let pos = { chapter: 1, step: 2 };
    const jumpTo = vi.fn((c: number, s: number) => {
      pos = { chapter: c, step: s };
    });
    installBridge(makeBridge({ jumpTo, getState: () => ({ ...pos }) }));

    const bridge = window.__presentation;
    expect(bridge).toBeDefined();
    bridge!.jumpTo(3, 4);
    expect(jumpTo).toHaveBeenCalledWith(3, 4);
    expect(bridge!.getState()).toEqual({ chapter: 3, step: 4 });
  });

  it("uninstallBridge 清空引用（App effect cleanup 语义）", () => {
    installBridge(makeBridge());
    expect(window.__presentation).toBeDefined();
    uninstallBridge();
    expect(window.__presentation).toBeUndefined();
    // 幂等：重复卸载不抛
    expect(() => uninstallBridge()).not.toThrow();
  });

  it("重复安装以最后一次为准（再次卸载即清空）", () => {
    const first = makeBridge();
    const second = makeBridge();
    installBridge(first);
    installBridge(second);
    expect(window.__presentation).toBe(second);
    uninstallBridge();
    expect(window.__presentation).toBeUndefined();
  });
});

describe("cursorBridge · 安装条件（生产守卫）", () => {
  it("?headless=1（含任意 URL 参数序）在非 dev 下安装", () => {
    expect(shouldInstallBridge(new URLSearchParams("headless=1"), false)).toBe(true);
    expect(shouldInstallBridge(new URLSearchParams("a=1&headless=1&b=2"), false)).toBe(true);
    // 存在性判定：headless=0 亦视为显式开启（与 App 既有 params.has 语义一致）
    expect(shouldInstallBridge(new URLSearchParams("headless"), false)).toBe(true);
  });

  it("非 dev 且无 headless 参数 → 不安装（生产构建不暴露）", () => {
    expect(shouldInstallBridge(new URLSearchParams(""), false)).toBe(false);
    expect(shouldInstallBridge(new URLSearchParams("render=1"), false)).toBe(false);
    expect(shouldInstallBridge(new URLSearchParams("Headless=1"), false)).toBe(false);
  });

  it("dev 模式安装（无需 headless 参数）", () => {
    expect(shouldInstallBridge(new URLSearchParams(""), true)).toBe(true);
  });
});

describe("cursorBridge · ready()", () => {
  it("jsdom 无 document.fonts / 无未完成图像时正常 resolve（guard 不挂起）", async () => {
    expect((document as { fonts?: unknown }).fonts).toBeUndefined(); // 前提：jsdom 真无此 API
    await expect(ready()).resolves.toBeUndefined();
  });

  it("等 document.fonts.ready 落定后才 resolve", async () => {
    let release!: () => void;
    stubFonts(new Promise<void>((resolve) => (release = resolve)));

    let settled = false;
    const p = ready().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false); // 字体未就绪：不 resolve

    release();
    await p;
    expect(settled).toBe(true);
  });

  it("字体 Promise 被拒绝也不挂死（截图管线继续）", async () => {
    stubFonts(Promise.reject(new Error("font load failed")));
    await expect(ready()).resolves.toBeUndefined();
  });

  it("等未完成图像：load 后才 resolve", async () => {
    const { load } = pendingImage();

    let settled = false;
    const p = ready().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false); // 图像未完成：不 resolve

    load();
    await p;
    expect(settled).toBe(true);
  });

  it("图像 error 也放行（坏图不挂死整条管线）", async () => {
    const { fail } = pendingImage();
    const p = ready().then(() => "settled");
    await flush();
    fail();
    await expect(p).resolves.toBe("settled");
  });

  it("判别：调用时现存图全 complete、唯一新图在帧窗口内挂载 → 仍被等待（帧先行的判据）", async () => {
    // 这条用例专门区分"帧先行"与"三路并发"两种实现：并发实现会在**调用瞬间**扫图
    // （此刻一张图都没有 → 立即放行），随后帧窗口内挂载的图被静默漏等、ready() 提前 resolve。
    // M5 逐帧 seek / M3b 无头 pass 的真实用法正是这个形态（jumpTo 后新一步的图随 commit 出现）。
    // 泵帧桩是判别的必要条件（同步执行桩会让帧窗口塌缩到调用瞬间，见 pumpableFrames 注释）。
    let late: ReturnType<typeof pendingImage> | null = null;
    const frames = pumpableFrames((frameNo) => {
      if (frameNo === 1) late = pendingImage();
    });
    expect(document.images.length).toBe(0); // 调用 ready() 时：无未完成图

    let settled = false;
    const p = ready().then(() => {
      settled = true;
    });
    await flush();
    expect(frames.pending()).toBe(1); // 帧已排、未走
    expect(settled).toBe(false);

    frames.pump(); // 第一帧：新图在帧窗口内挂载（React commit 位）
    await flush();
    expect(late).not.toBeNull();
    expect(document.images.length).toBe(1);
    expect(settled).toBe(false);

    frames.pump(); // 第二帧
    await flush();
    // 判据：并发实现此时已 resolve（它调用瞬间扫过图，此后不再重采）——漏等这张新图
    expect(settled).toBe(false);

    late!.load();
    await p;
    expect(settled).toBe(true);
  });

  it("帧窗口内挂载的新图与调用时已在等的图，两者都被等（jumpTo → React commit 时序）", async () => {
    let late: ReturnType<typeof pendingImage> | null = null;
    const frames = pumpableFrames((frameNo) => {
      if (frameNo === 1) late = pendingImage();
    });
    const probe = pendingImage(); // 调用时已在等的未完成图

    let settled = false;
    const p = ready().then(() => {
      settled = true;
    });
    await flush();
    frames.pump(); // 第一帧：帧窗口内挂载新图
    await flush(); // 放行微任务 → 第二帧才排上（泵帧之间必须 flush，否则空泵）
    frames.pump();
    await flush();
    expect(settled).toBe(false);
    expect(document.images.length).toBe(2);

    probe.load();
    await flush();
    expect(settled).toBe(false); // 只剩帧窗口内挂载的那张

    late!.load();
    await p;
    expect(settled).toBe(true);
  });
});

describe("cursorBridge · animations()（Ruling M4-1：WAAPI + 引擎注册表）", () => {
  it("jsdom 无 document.getAnimations → 0（guard 归 0，注册表亦空）", () => {
    expect((document as { getAnimations?: unknown }).getAnimations).toBeUndefined();
    expect(animations()).toBe(0);
  });

  it("有 document.getAnimations 时计入其计数", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [{}, {}, {}] as unknown as Animation[],
    });
    expect(animations()).toBe(3);
  });

  it("canvasAnim（rAF 帧函数逃生舱）计入总数——只算 getAnimations 会漏检", () => {
    // 非执行 rAF 桩：canvasAnim 创建即播会排帧，执行版桩会在帧回调里自递归
    vi.stubGlobal("requestAnimationFrame", () => 0);
    expect(animations()).toBe(0);

    const anim = canvasAnim(() => {}, 400);
    // jsdom 无 getAnimations → 这 1 个全部由注册表贡献
    expect(animations()).toBeGreaterThanOrEqual(1);
    // 实时读注册表（不是快照）：dispose 后归零
    anim.dispose();
    expect(animations()).toBe(0);
  });

  it("计数 = document.getAnimations() + 引擎注册表（两者之和）", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [{}, {}] as unknown as Animation[],
    });
    const anim = canvasAnim(() => {}, 400);
    expect(animations()).toBe(3);
    anim.dispose();
    expect(animations()).toBe(2);
  });

  it("零动画 → 0（Phase 3 静态版门禁判据）", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    expect(animations()).toBe(0);
  });
});

describe("cursorBridge · audit()（M3b Task 5 追加面）", () => {
  it("形状冻结：恰好 8 个字段（接口约定逐字，多/少都红）", () => {
    expect(Object.keys(audit()).sort()).toEqual(Object.keys(emptyAudit()).sort());
  });

  it("jsdom 常态（无 getAnimations）不抛：WAAPI 面全 0，注册表项照报", () => {
    expect((document as { getAnimations?: unknown }).getAnimations).toBeUndefined();
    expect(audit()).toEqual(emptyAudit());
  });

  it("合成 WAAPI 面 + 注册表：waapi/running/hints 与 registry/windowMs 同报（归因口径）", () => {
    // 非执行 rAF 桩：canvasAnim 创建即播会排帧
    vi.stubGlobal("requestAnimationFrame", () => 0);
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [
        { playState: "running", effect: null },
        { playState: "paused", effect: null },
        { playState: "finished", effect: null },
      ],
    });
    const anim = canvasAnim(() => {}, 900);

    expect(audit()).toEqual({
      waapi: 3,
      owned: 0, // 3 条全未打标（引擎 waapi 适配器没参与）——泄漏面
      unowned: 3,
      unownedRunning: 1,
      unownedHints: ["waapi:(no-target)", "waapi:(no-target)", "waapi:(no-target)"],
      registry: 1, // canvasAnim 不计入 WAAPI 面，只在此处
      windowMs: 900,
      running: 1,
    });

    anim.dispose();
    expect(audit().registry).toBe(0);
    expect(audit().windowMs).toBe(0);
  });

  it("追加而不破坏：audit 经 window.__presentation 可调用，四方法契约仍在", () => {
    installBridge(makeBridge({ audit }));
    const bridge = window.__presentation;
    expect(bridge).toBeDefined();
    expect(typeof bridge!.audit).toBe("function");
    expect(bridge!.audit()).toEqual(audit());
    // 冻结的四方法逐字仍在（jumpTo/getState 透传已由安装面用例钉住）
    expect(typeof bridge!.jumpTo).toBe("function");
    expect(typeof bridge!.getState).toBe("function");
    expect(typeof bridge!.ready).toBe("function");
    expect(typeof bridge!.animations).toBe("function");
  });
});
