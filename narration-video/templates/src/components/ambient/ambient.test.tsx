import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, seekAll, setRenderMode } from "../../engine/animationRuntime";
import { Breathe, KenBurns, SeededParticles } from "./";

// Ruling P3-5：jsdom 无 canvas 2d 上下文（getContext("2d") 返回 null，动画不注册），
// 测试基建用原型 spy 返回最小 fake 2d 上下文（fillStyle 属性 + clearRect/beginPath/arc/fill
// 记录调用）；不加 node-canvas 依赖，生产代码不改（真实浏览器有 2d 上下文）。
interface FakeCtx2d {
  fillStyle: string;
  clearRectCalls: number[][];
  arcCalls: number[][];
  fillCalls: number;
  beginPathCalls: number;
  clearRect(...args: number[]): void;
  beginPath(): void;
  arc(...args: number[]): void;
  fill(): void;
}

function makeFakeCtx2d(): FakeCtx2d {
  const ctx: FakeCtx2d = {
    fillStyle: "",
    clearRectCalls: [],
    arcCalls: [],
    fillCalls: 0,
    beginPathCalls: 0,
    clearRect: (...args) => {
      ctx.clearRectCalls.push(args);
    },
    beginPath: () => {
      ctx.beginPathCalls++;
    },
    arc: (...args) => {
      ctx.arcCalls.push(args);
    },
    fill: () => {
      ctx.fillCalls++;
    },
  };
  return ctx;
}

let fakes: Map<HTMLCanvasElement, FakeCtx2d>;

beforeEach(() => {
  setRenderMode(false);
  fakes = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId === "2d") {
      const f = makeFakeCtx2d();
      fakes.set(this, f);
      return f as unknown as CanvasRenderingContext2D;
    }
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
  setRenderMode(false);
  vi.restoreAllMocks();
});

describe("氛围组（有限周期确定性微动）", () => {
  it("SeededParticles 同 seed 两次渲染产出相同粒子布局", () => {
    const a = render(<SeededParticles seed={42} count={20} />);
    const b = render(<SeededParticles seed={42} count={20} />);
    const canvasA = a.container.querySelector("canvas");
    const canvasB = b.container.querySelector("canvas");
    expect(canvasA).not.toBeNull();
    expect(canvasB).not.toBeNull();

    // 驱动一次 seek：draw(t) 绘制全部粒子，两次渲染的 arc 调用序列应完全一致
    seekAll(500);
    const ctxA = fakes.get(canvasA as HTMLCanvasElement);
    const ctxB = fakes.get(canvasB as HTMLCanvasElement);
    expect(ctxA?.arcCalls).toEqual(ctxB?.arcCalls);
    expect(ctxA?.fillCalls).toBe(20);
    expect(ctxB?.fillCalls).toBe(20);
    // P3-6：fillStyle 不得是 var() 字符串（jsdom 下回退中性占位值）
    expect(ctxA?.fillStyle).toBe("#c9501f");
    expect(ctxB?.fillStyle).toBe("#c9501f");
    a.unmount();
    b.unmount();
  });

  it("SeededParticles canvasAnim 注册 + dispose", () => {
    const { unmount } = render(<SeededParticles seed={1} count={5} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("Breathe 有限迭代（iterations 为有限值）+ dispose", () => {
    const { unmount } = render(<Breathe cycles={3} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("KenBurns 有限时长 canvasAnim + dispose", () => {
    const { unmount } = render(<KenBurns duration="mid" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
