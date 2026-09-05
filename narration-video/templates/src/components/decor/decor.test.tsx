import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { DecorDot, DecorBar, DecorRing } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("装饰组", () => {
  it("三组件默认渲染 + 类名约定", () => {
    const { getByTestId } = render(
      <div>
        <DecorDot data-testid="a" />
        <DecorBar data-testid="b" />
        <DecorRing data-testid="c" />
      </div>,
    );
    expect(getByTestId("a").className).toContain("cdp-decor-dot");
    expect(getByTestId("b").className).toContain("cdp-decor-bar");
    expect(getByTestId("c").className).toContain("cdp-decor-ring");
  });

  it("变体生效（各 ≥2）", () => {
    const { getByTestId } = render(
      <div>
        <DecorDot variant="glow" data-testid="a" />
        <DecorBar variant="accent" data-testid="b" />
        <DecorRing variant="filled" data-testid="c" />
      </div>,
    );
    expect(getByTestId("a").className).toContain("cdp-decor-dot-glow");
    expect(getByTestId("b").className).toContain("cdp-decor-bar-accent");
    expect(getByTestId("c").className).toContain("cdp-decor-ring-filled");
  });

  it("reveal 走引擎、卸载 dispose", () => {
    const { unmount } = render(<DecorDot reveal="fade" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
