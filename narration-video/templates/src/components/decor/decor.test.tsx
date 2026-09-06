import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { DecorDot, DecorBar, DecorRing, StackedBlocks, MarkerBlock, StepStairs } from "./";

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

  it("StepStairs 渲染 N 卡 + 无序号 + 卡高递增 200/240/280 + 位置平齐无 translateY + 无上升箭头（三十轮 F1）", () => {
    const { getByTestId } = render(
      <StepStairs
        data-testid="stairs"
        items={[
          { value: "42%", note: "参与度提升" },
          { value: "2.7×" },
          { value: "25", note: "屏数" },
        ]}
      />,
    );
    const root = getByTestId("stairs");
    expect(root.className).toContain("cdp-step-stairs");
    const cards = root.querySelectorAll(".cdp-step-stairs-card");
    expect(cards).toHaveLength(3);
    // 卡高逐级递增 200/240/280（三十轮 F1 重算：卡内安全边距四周 24px + 最短卡内容底距 ≥24px——
    //   底缘共线 + 顶部阶梯轮廓——高度步进 40px 保持）
    expect((cards[0] as HTMLElement).style.height).toBe("200px");
    expect((cards[1] as HTMLElement).style.height).toBe("240px");
    expect((cards[2] as HTMLElement).style.height).toBe("280px");
    // 位置高度一致：不再 translateY 错落（同一水平线——二十九轮 F4 v4）
    expect((cards[0] as HTMLElement).style.transform).toBe("");
    expect((cards[1] as HTMLElement).style.transform).toBe("");
    expect((cards[2] as HTMLElement).style.transform).toBe("");
    // 无 NumberPill 序号（二十七轮 F3 删除——组件不再渲染序号）
    expect(root.querySelector(".cdp-number-pill")).toBeNull();
    // 无上升箭头（二十八轮 F4 v3 删除，v4 保留）
    expect(root.querySelectorAll(".cdp-step-stairs-rise")).toHaveLength(0);
    // 卡内两件套：HeroNumber 值 + mono 注（note 可选）
    expect(cards[0].querySelector(".cdp-hero-number-value")).toHaveTextContent("42%");
    expect(cards[0].querySelector(".cdp-step-stairs-note")).toHaveTextContent("参与度提升");
    expect(cards[1].querySelector(".cdp-step-stairs-note")).toBeNull();
  });
});
