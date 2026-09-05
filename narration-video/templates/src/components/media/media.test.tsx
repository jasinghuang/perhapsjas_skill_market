import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { Figure, TypedTerminal, PathDraw } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

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
    const { unmount } = render(<PathDraw d="M0 0 L10 10" variant="filled" />);
    expect(registrySize()).toBe(0);
    unmount();
  });
});
