import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_HOLD_MS } from "./engine/constants";
// 桥的模块函数（M5a Task 3）：App 的安装对象直接引用它们——引用相等即"接线未走样"的判据。
import { animations, audit, ready, seek } from "./engine/cursorBridge";

// M6（真实素材项目）适配：本套件测的是**引擎装配**，与项目自身章节内容无关。
// 模板原版把真实 manifest 当 deck fixture（断言 scene-0/1/2、示例口播）——项目换章即红。
// 修法：manifest 全程 mock 成 01-example（模板的引擎验证章，含 KenBurns 步 + 空 narration 步 +
// dwell 覆盖步——引擎语义需要的三种步形态它都有），断言逐字不变。
// 模板根治（测试专用 fixture 章进模板）记 KNOWN-ISSUES K-101，M7 回模板。
// 注意必须用 vi.mock（vitest 会**提升**到 import 之前）：vi.doMock 不提升，
// 静态 import App 会先于 mock 执行拿到真 manifest（本文件曾在全量跑时因此红 7 条）。
vi.mock("./chapters/manifest", async () => {
  const { ExampleChapter, exampleNarrations, exampleTiming } = await import("./chapters/01-example");
  return {
    chapters: [
      {
        id: "example",
        folder: "01-example",
        steps: exampleNarrations.length,
        narrations: exampleNarrations,
        timing: exampleTiming,
        Component: ExampleChapter,
      },
    ],
  };
});

// vi.mock 被 vitest 提升到所有 import 之前——下面的静态 import 也会拿到 mock 过的 manifest
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
        // M6 字幕切块追加成员（App 预览分支会订阅音频时钟）
        subscribeTick: () => () => {},
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

// M5b T3 评审 I1 的**页面侧一半**：`--no-subs` 的失效是**静默**的（参数名写歪 → 管线全绿、
// 产物照带字幕——verify 比的是"产物帧 vs 重采帧"，两侧同错即同绿），故参数名必须被钉住。
// 写侧（CLI 归一写的字面量 `no-subs`）在 `scripts/shot/session.test.ts` 的 withNoSubs 三条；
// 本组钉读侧：App.tsx 读的就是那个名字 + 极性是"有参数 = 无字幕"。
describe("App 装配 · 字幕开关（M5b T3 I1：参数名同一性 + 极性）", () => {
  afterEach(() => {
    vi.resetModules();
    window.history.replaceState({}, "", "/");
  });

  it("?no-subs=1 → 字幕层不在 DOM（CLI 写的参数名与页面读的必须是同一个）", async () => {
    window.history.replaceState({}, "", "/?no-subs=1");
    vi.resetModules();
    const { default: NoSubsApp } = await import("./App");
    render(<NoSubsApp />);
    expect(screen.queryByTestId("caption-layer")).not.toBeInTheDocument();
  });

  it("负臂：不带参数（= CLI 不给 --no-subs）→ 字幕层照常进片", async () => {
    window.history.replaceState({}, "", "/");
    vi.resetModules();
    const { default: PlainApp } = await import("./App");
    render(<PlainApp />);
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第一句口播");
  });
});

describe("App 装配 · 导出接线（M5b Task 5）", () => {
  // 相对路径 `/__export/*` 是**同源**的载体：中间件随 dev server 启动，端口就是页面自己的
  // ⇒ 无跨源、无预检、无端口发现。故这里对 fetch 的实参逐字断言（Stage 的 EXPORT_ROUTES
  // 与 vite-plugins/export-service.ts 的挂载点由两侧测试各自钉死，任一侧改名即红）。
  const okJson = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
  const idleBody = { state: "idle", progress: { done: 0, total: 0 } };

  /** 微任务推进（假计时器只管 setTimeout；promise 链要显式放行）。 */
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const stubFetch = () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("挂载即探活：GET /__export/status（相对路径）；服务可达且 idle → 按钮 idle", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(okJson(idleBody));
    render(<App />);
    // 同步就有按钮（idle 态），不用等探活
    expect(screen.getByTestId("btn-export")).toHaveTextContent("导出");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/__export/status");
    expect(screen.queryByTestId("export-hint")).not.toBeInTheDocument();
  });

  it("点导出 → POST /run → 轮询 /status → done 出下载口；进度取自服务端", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(okJson(idleBody)) // 挂载探活
      .mockResolvedValueOnce(okJson({ state: "running", progress: { done: 0, total: 0 } })) // POST
      .mockResolvedValueOnce(okJson({ state: "running", progress: { done: 1, total: 3 } })) // 轮询 #1
      .mockResolvedValueOnce(okJson({ state: "done", progress: { done: 3, total: 3 }, message: "presentation.mp4" })); // 轮询 #2

    render(<App />);
    await flush();
    fireEvent.click(screen.getByTestId("btn-export"));
    await flush();

    expect(fetchMock.mock.calls[1][0]).toBe("/__export/run");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(screen.getByTestId("btn-export")).toBeDisabled(); // running 中不可再触发
    expect(screen.getByTestId("export-progress")).toHaveTextContent("1/3");

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByTestId("link-export-file")).toHaveAttribute("href", "/__export/file");
    expect(screen.getByTestId("export-message")).toHaveTextContent("presentation.mp4");
    expect(screen.getByTestId("btn-export")).not.toBeDisabled(); // done 后可再导一次
  });

  it("409（已有一次在跑）不是错误：按 running 继续轮询到 done", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(okJson(idleBody))
      .mockResolvedValueOnce(okJson({ error: "已有一次导出在跑" }, 409))
      .mockResolvedValueOnce(okJson({ state: "done", progress: { done: 3, total: 3 } }));
    render(<App />);
    await flush();
    fireEvent.click(screen.getByTestId("btn-export"));
    await flush();
    expect(screen.queryByTestId("export-message")).not.toBeInTheDocument();
    expect(screen.getByTestId("link-export-file")).toBeInTheDocument();
  });

  it("服务端 failed → 页面显示原因（按钮可重试）", async () => {
    const fetchMock = stubFetch();
    fetchMock
      .mockResolvedValueOnce(okJson(idleBody))
      .mockResolvedValueOnce(okJson({ state: "running", progress: { done: 0, total: 0 } }))
      .mockResolvedValueOnce(okJson({ state: "failed", progress: { done: 1, total: 3 }, message: "渲染退出码 1" }));
    render(<App />);
    await flush();
    fireEvent.click(screen.getByTestId("btn-export"));
    await flush();
    expect(screen.getByTestId("export-message")).toHaveTextContent("渲染退出码 1");
    expect(screen.getByTestId("btn-export")).not.toBeDisabled();
  });

  it("探活失败（没有导出服务）→ 启动指引：命令行 + 复制命令", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockRejectedValue(new TypeError("Failed to parse URL"));
    render(<App />);
    await flush();
    expect(screen.getByTestId("export-hint")).toHaveTextContent("npm run render");
    // 复制命令是可选能力（jsdom / 非安全上下文没有 clipboard）：没有也不能炸
    fireEvent.click(screen.getByTestId("btn-export-copy"));
  });

  it("探活拿到非本服务的体（静态托管回 index.html / 别的东西）→ 同样按不可达处理", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValue(okJson({ hello: "world" }));
    render(<App />);
    await flush();
    expect(screen.getByTestId("export-hint")).toBeInTheDocument();
  });

  it("点导出时服务已没了（dev server 关掉）→ 降级成启动指引", async () => {
    const fetchMock = stubFetch();
    fetchMock.mockResolvedValueOnce(okJson(idleBody)); // 挂载时还在
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")); // 点下去时已经没了
    render(<App />);
    await flush();
    expect(screen.queryByTestId("export-hint")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("btn-export"));
    await flush();
    expect(screen.getByTestId("export-hint")).toHaveTextContent("npm run render");
  });

  it("渲染态（?render=1）不探活：控制条整体不在，导出按钮也不在", async () => {
    window.history.replaceState({}, "", "/?render=1");
    vi.resetModules();
    const fetchMock = stubFetch();
    const { default: RenderApp } = await import("./App");
    render(<RenderApp />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("btn-export")).not.toBeInTheDocument();
    window.history.replaceState({}, "", "/");
    vi.resetModules();
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
        // M6 字幕切块追加成员（App 预览分支会订阅音频时钟）
        subscribeTick: () => () => {},
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
