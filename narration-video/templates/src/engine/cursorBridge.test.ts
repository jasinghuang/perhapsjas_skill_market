import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  animations,
  installBridge,
  ready,
  shouldInstallBridge,
  uninstallBridge,
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

function makeBridge(overrides: Partial<PresentationBridge> = {}): PresentationBridge {
  return {
    jumpTo: vi.fn(),
    getState: () => ({ chapter: 0, step: 0 }),
    ready: async () => {},
    animations: () => 0,
    ...overrides,
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

  it("帧等待期间新挂载的图像同样被等待（jumpTo → React commit 时序）", async () => {
    let late: ReturnType<typeof pendingImage> | null = null;
    let frames = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames += 1;
      if (frames === 1) {
        // 模拟 React 在 commit 中挂载新一步的图：双 rAF 之后才可见
        late = pendingImage();
      }
      cb(0);
      return 0;
    });
    const probe = pendingImage(); // 首帧即已存在的未完成图
    let settled = false;
    const p = ready().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    expect(document.images.length).toBe(2); // 新挂载的图确实在 DOM 里

    probe.load();
    await flush();
    expect(settled).toBe(false); // 只剩后挂载的那张

    late!.load();
    await p;
    expect(settled).toBe(true);
  });
});

describe("cursorBridge · animations()", () => {
  it("jsdom 无 document.getAnimations → 0（分镜门禁的降级口径）", () => {
    expect((document as { getAnimations?: unknown }).getAnimations).toBeUndefined();
    expect(animations()).toBe(0);
  });

  it("有 document.getAnimations 时返回计数", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [{}, {}, {}] as unknown as Animation[],
    });
    expect(animations()).toBe(3);
  });

  it("零动画 → 0（Phase 3 静态版门禁判据）", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });
    expect(animations()).toBe(0);
  });
});
