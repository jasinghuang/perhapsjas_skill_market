import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { DEFAULT_HOLD_MS } from "./engine/constants";
// 桥的模块函数（M5a Task 3）：App 的安装对象直接引用它们——引用相等即"接线未走样"的判据。
import { animations, audit, ready, seek } from "./engine/cursorBridge";

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
    // M3b Task 5：audit 为追加成员（jsdom 无 WAAPI 查询面 → waapi 恒 0）
    expect(typeof bridge!.audit).toBe("function");
    expect(bridge!.audit().waapi).toBe(0);

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

  it("M5a Task 3：桥成员集合 ⊇ 六方法，seek 直连模块实现（前五者引用未变）", () => {
    render(<App />);
    const bridge = window.__presentation!;
    for (const k of ["jumpTo", "getState", "ready", "animations", "audit", "seek"] as const) {
      expect(typeof bridge[k], `桥缺成员：${k}`).toBe("function");
    }
    // 追加而不破坏：ready/animations/audit/seek 仍是模块函数的**同一引用**（App 直接引用，
    // 不包一层壳）；jumpTo/getState 是安装期闭包，其行为由上方两条既有用例钉住。
    expect(bridge.ready).toBe(ready);
    expect(bridge.animations).toBe(animations);
    expect(bridge.audit).toBe(audit);
    expect(bridge.seek).toBe(seek);
  });

  it("守卫为假时不安装（生产构建不暴露）：installBridge 不被调用", async () => {
    // vitest 里 import.meta.env.DEV 恒为 true（vite 静态替换），App 层无法真跑"非 dev 分支"，
    // 故用 mock 把 shouldInstallBridge 压成 false 来验证接线面确实受守卫控制。
    vi.resetModules();
    const installBridge = vi.fn();
    vi.doMock("./engine/cursorBridge", () => ({
      shouldInstallBridge: () => false,
      installBridge,
      uninstallBridge: vi.fn(),
      ready: () => Promise.resolve(),
      animations: () => 0,
      // 桥面语义的替身（App 只把它们装进 installBridge 参数）：成员名与 PresentationBridge 对齐
      audit: () => ({ waapi: 0, owned: 0, unowned: 0, unownedRunning: 0, unownedHints: [], registry: 0, windowMs: 0, running: 0 }),
      // M5a Task 3 追加的必填成员（替身必须同步：与 makeBridge() 同一份成员集合）
      seek: vi.fn(),
    }));

    const { default: GuardedApp } = await import("./App");
    render(<GuardedApp />);

    expect(installBridge).not.toHaveBeenCalled();
    expect(window.__presentation).toBeUndefined();

    // 还原：mock 与模块缓存不留到后续用例（afterEach 的 cleanup 已卸载本用例的 App）
    vi.doUnmock("./engine/cursorBridge");
    vi.resetModules();
  });
});

describe("App 装配 · 无头/渲染不自驱（M3b Task 6）", () => {
  // params/renderMode 是 App.tsx 模块作用域读一次的量 → 必须先改 URL 再造模块
  const mockPlayer = () => {
    const playStep = vi.fn();
    vi.doMock("./engine/useAudioPlayer", () => ({
      // 五个成员缺一不可（App 解构了 playStep/resume/pause/stop 并读 playing）
      useAudioPlayer: () => ({
        playing: false,
        playStep,
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
      }),
    }));
    return playStep;
  };

  afterEach(() => {
    // 复位：mock 与 URL 都不留到后续用例（?headless=1 残留会让下一个用例假红）
    vi.doUnmock("./engine/useAudioPlayer");
    vi.resetModules();
    window.history.replaceState({}, "", "/");
  });

  it("?headless=1 不武装自驱推进链：playStep 不被调用", async () => {
    window.history.replaceState({}, "", "/?headless=1");
    vi.resetModules();
    const playStep = mockPlayer();
    const { default: HeadlessApp } = await import("./App");
    render(<HeadlessApp />);
    expect(playStep).not.toHaveBeenCalled();
  });

  it("?render=1（无 headless）不武装自驱推进链：playStep 不被调用（守卫 render 支路的防御锁）", async () => {
    // 当前不可达（capture.ts / verify-sequential.ts 都走 openSession，而它恒追加 headless=1），
    // 但守卫是 OR：若将来有人把它改成只判 headless，本用例是 ?render=1 静默恢复自驱的唯一警报。
    window.history.replaceState({}, "", "/?render=1");
    vi.resetModules();
    const playStep = mockPlayer();
    const { default: RenderApp } = await import("./App");
    render(<RenderApp />);
    expect(playStep).not.toHaveBeenCalled();
  });

  it("无 query 时行为不变：进入即 playStep 一次", async () => {
    window.history.replaceState({}, "", "/");
    vi.resetModules();
    const playStep = mockPlayer();
    const { default: PlainApp } = await import("./App");
    render(<PlainApp />);
    expect(playStep).toHaveBeenCalledTimes(1);
  });
});

describe("App 装配 · 停留垫解析（M5a Task 1）", () => {
  // 与"无头/渲染不自驱"同法：拦下 useAudioPlayer，直接读 playStep 的实参（hold 的唯一出口）
  const mockPlayer = () => {
    const playStep = vi.fn();
    vi.doMock("./engine/useAudioPlayer", () => ({
      useAudioPlayer: () => ({
        playing: false,
        playStep,
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
      }),
    }));
    return playStep;
  };

  afterEach(() => {
    vi.doUnmock("./engine/useAudioPlayer");
    vi.resetModules();
    window.history.replaceState({}, "", "/");
  });

  it("holdMs 走解析：01-example/timing.json 的 dwell 覆盖进 playStep（不再是硬编码常量）", async () => {
    vi.resetModules();
    const playStep = mockPlayer();
    const { default: PlainApp } = await import("./App");
    render(<PlainApp />);

    // step 0 无覆盖 → 引擎默认 400ms
    expect(playStep).toHaveBeenLastCalledWith(
      "这是第一句口播",
      "/audio/01-example/0.mp3",
      DEFAULT_HOLD_MS,
      expect.any(Function),
    );

    // step 1 有覆盖（timing.json 的 dwell{"1":600}）→ 600ms，硬编码时这里会是 400
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(playStep).toHaveBeenLastCalledWith(
      "这是第二句口播",
      "/audio/01-example/1.mp3",
      600,
      expect.any(Function),
    );
    expect(playStep).toHaveBeenCalledTimes(2);
  });
});
