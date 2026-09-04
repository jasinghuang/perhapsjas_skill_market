import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allFinished,
  animationWindowMs,
  canvasAnim,
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

  it("seekAll 对全部动画生效且不为负", () => {
    let seeked = 0;
    const h = register({ durationMs: 100, seek: () => { seeked++; }, isFinished: () => false, pause: () => {}, play: () => {} });
    seekAll(-5);
    seekAll(10);
    expect(seeked).toBe(2);
    h.dispose();
  });
});
