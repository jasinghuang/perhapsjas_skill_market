import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createPrimitive } from "./factory";
import { registrySize, setRenderMode } from "../engine/animationRuntime";

const Demo = createPrimitive("demo", {
  tag: "div",
  variants: ["plain", "invert"],
  defaultVariant: "plain",
});

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

// 终审 M9：无本地 FakeAnim 副本——jsdom 无 WAAPI 的 Element.prototype.animate stub
// 与 RTL 全局 cleanup 均由全局 test-setup.ts 安装（Ruling P2-11 / P2-12）。
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
    const { unmount } = render(
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
