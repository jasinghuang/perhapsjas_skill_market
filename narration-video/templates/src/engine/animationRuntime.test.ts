import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allFinished,
  animationWindowMs,
  canvasAnim,
  describeUnownedAnimations,
  register,
  registrySize,
  resumeAll,
  seekAll,
  setRenderMode,
  waapi,
} from "./animationRuntime";

interface FakeAnimState {
  currentTime: number;
  playState: "paused" | "running" | "finished";
}

class FakeAnim {
  state: FakeAnimState = { currentTime: 0, playState: "paused" };
  cancelCalls = 0;
  // WAAPI Animation.currentTime 顶层属性代理到 state，供断言观察实现写入的 currentTime
  get currentTime(): number {
    return this.state.currentTime;
  }
  set currentTime(v: number) {
    this.state.currentTime = v;
  }
  play() {
    this.state.playState = "running";
  }
  pause() {
    this.state.playState = "paused";
  }
  finish() {
    this.state.playState = "finished";
  }
  cancel() {
    this.cancelCalls++;
  }
}

function makeWaapiStub(): { el: Element; anim: FakeAnim } {
  const anim = new FakeAnim();
  const el = {
    animate: (_k: unknown, _opts: KeyframeAnimationOptions) => {
      anim.state.currentTime = 0;
      return anim as unknown as Animation;
    },
  };
  return { el: el as unknown as Element, anim };
}

beforeEach(() => {
  setRenderMode(false);
});
afterEach(() => {
  setRenderMode(false);
  vi.unstubAllGlobals();
  // 用例内按需 stub 的 WAAPI 查询面不残留到后续用例（jsdom 本无此 API）
  Reflect.deleteProperty(document, "getAnimations");
});

describe("动画运行时注册表", () => {
  it("register 后可见、dispose 后移除", () => {
    const h = register({ durationMs: 1000, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    expect(registrySize()).toBe(1);
    h.dispose();
    expect(registrySize()).toBe(0);
  });

  it("render 模式下创建即冻结（不允许自主播放）", () => {
    setRenderMode(true);
    let playCalls = 0;
    const h = register({ durationMs: 500, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => { playCalls++; } });
    expect(playCalls).toBe(0);
    h.dispose();
  });

  it("waapi 适配器：seek 直接映射 currentTime 并 clamp 到 total", () => {
    const { el, anim } = makeWaapiStub();
    const h = waapi(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000, delay: 200 });
    h.seek(0);
    expect(anim.state.currentTime).toBe(0);
    h.seek(500);
    expect(anim.state.currentTime).toBe(500); // 直接映射：t 即 currentTime（WAAPI 时间轴已内置 delay）
    h.seek(9999);
    expect(anim.state.currentTime).toBe(1200); // clamp 到 total = delay + duration
    h.dispose();
  });

  it("waapi 适配器：dispose 反注册并 cancel 底层动画", () => {
    const { el, anim } = makeWaapiStub();
    const h = waapi(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000 });
    expect(registrySize()).toBe(1);
    expect(anim.cancelCalls).toBe(0);
    h.dispose();
    expect(anim.cancelCalls).toBe(1); // dispose 必须真正取消底层动画（DonutMeter/工厂 reveal 依赖）
    expect(registrySize()).toBe(0);
  });

  it("waapi 适配器：iterations 计入总时长（durationMs = delay + duration × iterations，P3-7）", () => {
    const { el: elA } = makeWaapiStub();
    const h3 = waapi(elA, [{ opacity: 0 }, { opacity: 1 }], { duration: 1600, iterations: 3 });
    expect(h3.durationMs).toBe(4800); // Breathe 呼吸 3 轮：delay(0) + 1600 × 3
    h3.dispose();

    const { el: elB } = makeWaapiStub();
    const hDelayed = waapi(elB, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000, delay: 200, iterations: 3 });
    expect(hDelayed.durationMs).toBe(3200); // delay 只计一次：200 + 1000 × 3
    hDelayed.dispose();
  });

  it("waapi 适配器：iterations 下 finished 边界随总时长平移（P3-7）", () => {
    const { el } = makeWaapiStub();
    const h = waapi(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1600, iterations: 3 });
    h.seek(4799.5); // 总时长(4800)前 0.5ms：仍在播放，未 finished
    expect(h.isFinished()).toBe(false);
    h.seek(4800); // 总时长：finished
    expect(h.isFinished()).toBe(true);
    h.dispose();
  });

  it("animationWindowMs = 各动画结束时间的最大值", () => {
    const a = register({ durationMs: 1000, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    const b = register({ durationMs: 2000, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    expect(animationWindowMs()).toBe(2000);
    a.dispose();
    b.dispose();
    expect(animationWindowMs()).toBe(0);
  });

  it("allFinished：全部结束才为 true", () => {
    const a = register({ durationMs: 100, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    const b = register({ durationMs: 100, seek: () => {}, isFinished: () => true, pause: () => {}, play: () => {} });
    expect(allFinished()).toBe(false);
    a.dispose();
    expect(allFinished()).toBe(true);
    b.dispose();
  });

  it("resumeAll 在 render 模式下不恢复播放", () => {
    setRenderMode(true);
    let playCalls = 0;
    const h = register({ durationMs: 100, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => { playCalls++; } });
    resumeAll();
    expect(playCalls).toBe(0);
    h.dispose();
  });

  it("canvasAnim：seek 调用 draw(t) 并 clamp 到时长", () => {
    const calls: number[] = [];
    const h = canvasAnim((t) => calls.push(t), 500);
    h.seek(200);
    h.seek(9999);
    expect(calls).toEqual([200, 500]);
    expect(h.isFinished()).toBe(true);
    h.dispose();
  });

  it("canvasAnim：play 走 rAF 真实时钟，draw 收到递增 t，到点终态停（P3-12）", () => {
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
    // 手动捕获回调 + 手动推进时间戳（避免 vi.useFakeTimers 与 rAF 的冲突）
    const advance = (ts: number) => {
      const batch = pending.splice(0);
      for (const { id, cb } of batch) if (!cancelled.has(id)) cb(ts);
    };

    const calls: number[] = [];
    const h = canvasAnim((t) => calls.push(t), 500);

    h.play();
    advance(1000); // 首帧建立基准
    advance(1100);
    advance(1250);
    expect(calls).toEqual([0, 100, 250]);

    advance(1600); // 250 + 500 → clamp 到时长，终态 draw(500) 后停（不再排帧）
    expect(calls).toEqual([0, 100, 250, 500]);
    expect(pending.length).toBe(0);
    expect(h.isFinished()).toBe(true);

    h.dispose();
  });

  it("canvasAnim：pause 取消挂起帧不再 draw；seek 手动 draw 并重置时钟基准（P3-12）", () => {
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
    const advance = (ts: number) => {
      const batch = pending.splice(0);
      for (const { id, cb } of batch) if (!cancelled.has(id)) cb(ts);
    };

    const calls: number[] = [];
    const h = canvasAnim((t) => calls.push(t), 500);

    h.play();
    advance(1000);
    const pendingId = pending[0].id;
    h.pause();
    expect(cancelled.has(pendingId)).toBe(true); // pause 取消了挂起帧
    advance(9999); // 被取消的帧不执行：不再有 draw
    expect(calls).toEqual([0]);

    h.seek(300); // seek 手动 draw + 重置时钟基准
    expect(calls).toEqual([0, 300]);

    h.play(); // play 从 seek 位置继续
    advance(5000); // 首帧：基准帧，t = 300
    advance(5100);
    expect(calls).toEqual([0, 300, 300, 400]);

    h.dispose();
  });

  it("canvasAnim：非 render 模式创建即排帧，draw 收到递增 t（I-1 预览触发断链修复）", () => {
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
    const advance = (ts: number) => {
      const batch = pending.splice(0);
      for (const { id, cb } of batch) if (!cancelled.has(id)) cb(ts);
    };

    const calls: number[] = [];
    const h = canvasAnim((t) => calls.push(t), 500);

    // 创建即开始排帧（无需外部 play）：预览模式组件 mount 后粒子/打字等立即驱动
    expect(pending.length).toBeGreaterThanOrEqual(1);

    advance(1000); // 首帧建立基准，t = 0
    advance(1100); // t = 100
    expect(calls).toEqual([0, 100]);

    h.dispose();
  });

  it("canvasAnim：render 模式创建不排帧（创建即冻结的确定性边界不变）", () => {
    setRenderMode(true);
    let scheduled = 0;
    vi.stubGlobal("requestAnimationFrame", () => {
      scheduled++;
      return scheduled;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const h = canvasAnim(() => {}, 500);
    expect(scheduled).toBe(0); // 渲染器只走 seek，不排 rAF

    h.dispose();
  });

  it("seekAll 对全部动画生效且不为负", () => {
    let seeked = 0;
    const h = register({ durationMs: 100, seek: () => { seeked++; }, isFinished: () => false, pause: () => {}, play: () => {} });
    seekAll(-5);
    seekAll(10);
    expect(seeked).toBe(2);
    h.dispose();
  });
});

describe("describeUnownedAnimations（M3b Task 5 · audit 的 WAAPI 面）", () => {
  interface ProbeAnim {
    playState: "paused" | "running" | "finished" | "idle";
    currentTime: number;
    effect: { target: unknown } | null;
    animationName?: string;
    play(): void;
    pause(): void;
    cancel(): void;
  }

  function probeAnim(target: unknown, animationName?: string): ProbeAnim {
    const anim: ProbeAnim = {
      playState: "paused",
      currentTime: 0,
      effect: { target },
      play: () => {
        anim.playState = "running";
      },
      pause: () => {
        anim.playState = "paused";
      },
      cancel: () => {
        anim.playState = "idle";
      },
    };
    if (animationName !== undefined) anim.animationName = animationName;
    return anim;
  }

  /** 假 WAAPI 查询面：document.getAnimations() 返回给定数组（jsdom 本无此 API） */
  function stubAnimations(anims: unknown[]): void {
    Object.defineProperty(document, "getAnimations", { configurable: true, value: () => anims });
  }

  /** 经引擎 waapi() 创建的动画（走打标路径）：元素 animate 返回可观察替身 */
  function engineAnim(opts: KeyframeAnimationOptions = { duration: 100 }): {
    handle: ReturnType<typeof waapi>;
    anim: ProbeAnim;
  } {
    let made: ProbeAnim | null = null;
    const el = document.createElement("div");
    Object.defineProperty(el, "animate", {
      configurable: true,
      value: () => {
        made = probeAnim(el);
        return made as unknown as Animation;
      },
    });
    const handle = waapi(el, [{ opacity: 0 }, { opacity: 1 }], opts);
    return { handle, anim: made as unknown as ProbeAnim };
  }

  it("非空护栏（jsdom 常态）：无 document.getAnimations → 全 0 且不抛", () => {
    expect((document as { getAnimations?: unknown }).getAnimations).toBeUndefined();
    expect(() => describeUnownedAnimations()).not.toThrow();
    expect(describeUnownedAnimations()).toEqual({
      waapi: 0,
      owned: 0,
      unowned: 0,
      unownedRunning: 0,
      running: 0,
      unownedHints: [],
    });
  });

  it("unowned = 未打标动画；引擎 waapi() 创建的计入 owned", () => {
    const { handle, anim } = engineAnim();
    expect(anim.playState).toBe("running"); // 非 render：创建即播（底层动画真在跑）
    stubAnimations([anim, probeAnim(null), probeAnim(null, "slide-in")]);

    const a = describeUnownedAnimations();
    expect(a.waapi).toBe(3);
    expect(a.owned).toBe(1); // 经 waapi() 创建 → 已打标
    expect(a.unowned).toBe(2); // 未打标 → 归因到章节层泄漏面
    handle.dispose();
  });

  it("unownedHints：WAAPI 取 effect.target 可读选择器、CSS 动画取 animationName；至多 5 条", () => {
    const target = document.createElement("div");
    target.id = "stage";
    target.className = "slide active extra"; // 类名至多取 2 个（hint 要短）
    stubAnimations([
      probeAnim(target),
      probeAnim(null, "ken-burns"),
      probeAnim(null),
      probeAnim(null),
      probeAnim(null),
      probeAnim(null),
    ]);

    const a = describeUnownedAnimations();
    expect(a.unowned).toBe(6);
    expect(a.unownedHints).toHaveLength(5); // 超出的同类信息不再重复（门禁报错够定位即可）
    expect(a.unownedHints[0]).toBe("waapi:div#stage.slide.active");
    expect(a.unownedHints[1]).toBe("css:ken-burns");
  });

  it("怪异 target 不抛：文本节点 / 无 target / 无 tagName，逐层给兜底定位", () => {
    stubAnimations([
      probeAnim(document.createTextNode("t")),
      probeAnim(null),
      { playState: "paused", effect: null },
      { playState: "paused", effect: {} },
      probeAnim({ nodeType: 1 }), // 元素形但无 tagName
    ]);

    const a = describeUnownedAnimations();
    expect(a.unowned).toBe(5);
    expect(a.unownedHints).toEqual([
      "waapi:#text",
      "waapi:(no-target)",
      "waapi:(no-target)",
      "waapi:(no-target)",
      "waapi:(element)",
    ]);
  });

  it("怪异 target 不抛（续）：getAttribute 抛错 / null 条目——审计面绝不因单条怪异数据崩", () => {
    stubAnimations([
      probeAnim({
        nodeType: 1,
        tagName: "DIV",
        getAttribute: () => {
          throw new Error("boom");
        },
      }),
      null,
    ]);

    expect(() => describeUnownedAnimations()).not.toThrow();
    expect(describeUnownedAnimations().unownedHints).toEqual(["waapi:div", "waapi:(no-target)"]);
  });

  it("巨型 className 不撑爆单条 hint（截断，报告不刷屏）", () => {
    const huge = document.createElement("span");
    huge.className = "c".repeat(5000);
    stubAnimations([probeAnim(huge)]);
    expect(describeUnownedAnimations().unownedHints[0].length).toBeLessThan(200);
  });

  it("running / unownedRunning 只数 playState==='running'；render 模式下引擎动画恒 paused", () => {
    const { handle, anim: engine } = engineAnim(); // 非 render：创建即播
    const runningForeign = probeAnim(null);
    runningForeign.play();
    stubAnimations([engine, runningForeign, probeAnim(null)]);

    const a = describeUnownedAnimations();
    expect(a.running).toBe(2); // 引擎 1 + 未打标 running 1（paused 的不数）
    expect(a.unownedRunning).toBe(1); // running 里未打标的只有 1
    handle.dispose();

    // render 模式：waapi() 创建即冻结（register 内 pause）→ 引擎动画不进 running
    setRenderMode(true);
    const frozen = engineAnim();
    expect(frozen.anim.playState).toBe("paused");
    stubAnimations([frozen.anim, runningForeign]);
    const b = describeUnownedAnimations();
    expect(b.owned).toBe(1);
    expect(b.running).toBe(1);
    expect(b.unownedRunning).toBe(1);
    frozen.handle.dispose();
  });
});
