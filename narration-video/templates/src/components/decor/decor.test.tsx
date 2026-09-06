import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { DecorDot, DecorBar, DecorRing, StackedBlocks, MarkerBlock } from "./";

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

  it("StackedBlocks 渲染 4 方块 + 类名约定", () => {
    const { getByTestId } = render(<StackedBlocks data-testid="stack" />);
    expect(getByTestId("stack").className).toContain("cdp-stacked-blocks");
    expect(getByTestId("stack").querySelectorAll(".cdp-stacked-block")).toHaveLength(4);
  });

  it("MarkerBlock 三变体类名 + 子内容渲染（十六轮 F3；二十二轮 F1 补 invert）", () => {
    const { getByTestId } = render(
      <div>
        <MarkerBlock data-testid="m1">CREATIVE</MarkerBlock>
        <MarkerBlock variant="accent" data-testid="m2">创意模式</MarkerBlock>
        <MarkerBlock variant="invert" data-testid="m3">墨底</MarkerBlock>
      </div>,
    );
    expect(getByTestId("m1").className).toContain("cdp-marker-block");
    expect(getByTestId("m1").className).toContain("cdp-marker-block-plain");
    expect(getByTestId("m1").textContent).toBe("CREATIVE");
    expect(getByTestId("m2").className).toContain("cdp-marker-block-accent");
    expect(getByTestId("m2").textContent).toBe("创意模式");
    expect(getByTestId("m3").className).toContain("cdp-marker-block-invert");
    expect(getByTestId("m3").textContent).toBe("墨底");
  });
});
