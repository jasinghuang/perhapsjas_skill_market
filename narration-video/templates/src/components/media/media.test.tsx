import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { Figure, TypedTerminal, PathDraw } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => {
  setRenderMode(false);
  cleanup();
});

describe("素材承载组", () => {
  it("Figure 无 src 渲染 placeholder 卡（诚实原则）", () => {
    const { getByTestId } = render(<Figure caption="截图" data-testid="f" />);
    expect(getByTestId("f")).toHaveTextContent("截图");
    expect(getByTestId("f").querySelector(".cdp-figure-placeholder")).not.toBeNull();
  });

  it("Figure frame 变体 + reveal 动画注册与 dispose", () => {
    const { unmount } = render(<Figure variant="frame" reveal="wipe" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("TypedTerminal 打字走帧函数（canvasAnim 注册 + dispose）", () => {
    const { getByTestId, unmount } = render(
      <TypedTerminal lines={["第一行", "第二行"]} data-testid="t" />,
    );
    expect(getByTestId("t")).toHaveTextContent("第一行");
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("PathDraw 路径自绘走 waapi（stroke-dashoffset 白名单）+ dispose", () => {
    const { container, unmount } = render(
      <PathDraw d="M0 0 L100 100" duration="fast" />,
    );
    expect(container.querySelector("path")).not.toBeNull();
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("PathDraw filled 变体不注册动画（纯填充）", () => {
    const { container, unmount } = render(<PathDraw d="M0 0 L10 10" variant="filled" />);
    expect(registrySize()).toBe(0);
    // P3-11：filled 必须真填充——根 svg 带变体类，CSS 据此覆盖 fill: none
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass("cdp-path-draw", "cdp-path-draw-filled");
    unmount();
  });

  it("Figure 三变体类名渲染（frame/bare/plain——十四轮 F4）", () => {
    const { getByTestId } = render(
      <div>
        <Figure variant="frame" data-testid="f1" />
        <Figure variant="bare" data-testid="f2" />
        <Figure variant="plain" data-testid="f3" />
      </div>,
    );
    expect(getByTestId("f1").className).toContain("cdp-figure-frame");
    expect(getByTestId("f2").className).toContain("cdp-figure-bare");
    expect(getByTestId("f3").className).toContain("cdp-figure-plain");
  });

  it("Figure ratio prop 挂 ratio 类名 + placeholder 文案", () => {
    const { getByTestId } = render(<Figure ratio="3 / 4" caption="图" data-testid="fr" />);
    const fig = getByTestId("fr");
    expect(fig.className).toContain("cdp-figure-ratio");
    expect(fig.querySelector(".cdp-figure-placeholder-text")!.textContent).toBe("素材待补");
    expect(fig.querySelector(".cdp-figure-caption")!.textContent).toBe("图");
  });
});
