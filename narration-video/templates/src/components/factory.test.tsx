import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createPrimitive } from "./factory";
import { registrySize, setRenderMode } from "../engine/animationRuntime";

const Demo = createPrimitive("demo", {
  tag: "div",
  variants: ["plain", "invert"],
  defaultVariant: "plain",
});

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

// jsdom 无 WAAPI：原型级 stub（同 motion.test.ts 的 FakeAnim 模式）。
// 否则 revealAnim 因 typeof el.animate !== "function" 直接返回 null，注册表恒空。
class FakeAnim {
  currentTime = 0;
  playState: "paused" | "running" | "finished" = "paused";
  constructor(public opts: KeyframeAnimationOptions) {}
  play() { this.playState = "running"; }
  pause() { this.playState = "paused"; }
}

const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  Element.prototype.animate = (k: unknown, opts: KeyframeAnimationOptions) =>
    new FakeAnim(opts) as unknown as Animation;
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
  // vitest 未开 globals，RTL 不自动注册 cleanup（见 Stage.test.tsx 注释），必须手动清理
  cleanup();
});

describe("createPrimitive 工厂", () => {
  it("默认变体类名 = cdp cdp-demo cdp-demo-plain", () => {
    const { getByTestId } = render(<Demo data-testid="x">hi</Demo>);
    expect(getByTestId("x").className).toContain("cdp");
    expect(getByTestId("x").className).toContain("cdp-demo");
    expect(getByTestId("x").className).toContain("cdp-demo-plain");
  });

  it("指定变体生效", () => {
    const { getByTestId } = render(<Demo variant="invert" data-testid="x">hi</Demo>);
    expect(getByTestId("x").className).toContain("cdp-demo-invert");
  });

  it("reveal 动画注册进引擎注册表，卸载时 dispose", () => {
    const { getByTestId, unmount } = render(
      <Demo reveal="fade" duration="fast" data-testid="x">hi</Demo>,
    );
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("无 reveal 时不注册动画", () => {
    const { unmount } = render(<Demo data-testid="x">hi</Demo>);
    expect(registrySize()).toBe(0);
    unmount();
  });

  it("stagger 下每个直接子元素各注册一个动画", () => {
    const { unmount, container } = render(
      <Demo reveal="rise" stagger data-testid="x">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </Demo>,
    );
    expect(container.children[0].children).toHaveLength(3);
    expect(registrySize()).toBe(3);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
