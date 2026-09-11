import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string | null = null;
  ended = false;
  onended: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(public cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  // jsdom 无 ResizeObserver（Stage → useStageScale 挂载即用），与 Stage.test.tsx 同法桩掉
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  FakeAudio.instances = [];
  FakeResizeObserver.instances = [];
  localStorage.clear();
  // Ruling 5: 空 narration 步的兜底 setTimeout（1500ms）用假计时器接住，避免真实计时器泄漏到测试后
  vi.useFakeTimers();
});

afterEach(() => {
  // vitest 未开 globals，RTL 不自动注册 cleanup（见 Stage.test.tsx 注释），必须手动清理
  cleanup();
  vi.useRealTimers();
  // 用例内 stubGlobal（如 rAF 捕获桩）不留存到后续用例；beforeEach 会重新装好 Audio/ResizeObserver
  vi.unstubAllGlobals();
});

describe("App 装配", () => {
  it("渲染当前章节场景 + 框架层字幕", () => {
    render(<App />);
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第一句口播");
  });

  it("方向键推进场景（开发调试，藏在无 UI 模式之外不影响）", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-1")).toBeInTheDocument();
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第二句口播");
  });

  it("停止按钮回到起点", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByTestId("btn-stop"));
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
  });

  it("停止后停在起点静止：不回零重播、不自动推进", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("btn-stop"));
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
    // 核心语义 1：停止后音频被清空，不回起点重播
    expect(FakeAudio.instances[0].src).toBe("");
    // 核心语义 2：时间推进后仍停在 scene-0，不自动推进到 scene-1
    vi.advanceTimersByTime(5000);
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
    expect(screen.queryByTestId("scene-1")).not.toBeInTheDocument();
  });

  it("空 narration 步不显示字幕", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-2")).toBeInTheDocument();
    expect(screen.queryByTestId("caption-layer")).not.toBeInTheDocument();
  });

  it("含帧函数组件的步骤能自动推进（I-1：canvasAnim 预览触发断链挂死修复）", () => {
    // rAF 捕获桩：手动排帧（fake timers 只管 setTimeout，rAF 回调手动驱动，两者互不干扰）
    const pending: Array<{ id: number; cb: FrameRequestCallback }> = [];
    const cancelled = new Set<number>();
    let nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId++;
      pending.push({ id, cb });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.add(id);
    });
    const advanceFrame = (ts: number) => {
      const batch = pending.splice(0);
      for (const { id, cb } of batch) if (!cancelled.has(id)) cb(ts);
    };

    render(<App />);
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();

    // KenBurns duration="fast" → 4000ms：挂载即排帧（断链修复后的触发点）
    expect(pending.length).toBeGreaterThanOrEqual(1);

    // 手动驱动 rAF 到 KenBurns 终态：draw 到 t=durMs，isFinished 变 true，不再排帧
    advanceFrame(1000); // 首帧建立时间基准，t = 0
    advanceFrame(1000 + 4000); // t 达 durMs → 终态 draw(4000) 后停
    expect(pending.length).toBe(0);

    // 音频结束 → afterAnimations 轮询发现全部 finished → 停留垫（DEFAULT_HOLD_MS）→ 自动推进
    act(() => {
      FakeAudio.instances[0].onended?.();
    });
    act(() => {
      vi.advanceTimersByTime(400 + 50);
    });
    expect(screen.getByTestId("scene-1")).toBeInTheDocument();
  });
});

describe("App 装配 · 游标桥（M4）", () => {
  it("dev 模式安装 window.__presentation（无 headless 参数也装）：jumpTo 直达 + getState 反映游标", () => {
    // vitest 下 import.meta.env.DEV === true → 走 dev 分支（生产分支的判据由
    // cursorBridge.test.ts 的 shouldInstallBridge 纯函数单测钉住）
    expect(import.meta.env.DEV).toBe(true);
    render(<App />);

    const bridge = window.__presentation;
    expect(bridge).toBeDefined();
    expect(typeof bridge!.animations).toBe("function");
    expect(typeof bridge!.ready).toBe("function");

    act(() => bridge!.jumpTo(0, 1));
    expect(screen.getByTestId("scene-1")).toBeInTheDocument();
    expect(bridge!.getState()).toEqual({ chapter: 0, step: 1 });

    act(() => bridge!.jumpTo(0, 0));
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
    expect(bridge!.getState()).toEqual({ chapter: 0, step: 0 });
  });

  it("卸载即拆除：桥不残留到页面之外", () => {
    const { unmount } = render(<App />);
    expect(window.__presentation).toBeDefined();
    unmount();
    expect(window.__presentation).toBeUndefined();
  });
});
