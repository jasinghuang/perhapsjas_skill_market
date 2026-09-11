import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { RevealText, RevealList, StepSequence, StaggerRow } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("揭示组", () => {
  it("RevealText 逐词拆分 + 动画注册 + 卸载 dispose", () => {
    const { container, unmount } = render(<RevealText text="你好 世界 再见" />);
    const spans = container.querySelectorAll(".cdp-reveal-text-word");
    expect(spans).toHaveLength(3);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("RevealList activeCount 纯派生状态（铁律 6）", () => {
    const { container, rerender } = render(
      <RevealList items={["甲", "乙", "丙"]} activeCount={1} />,
    );
    expect(container.querySelectorAll(".cdp-reveal-list-item-active")).toHaveLength(1);
    expect(container.querySelectorAll(".cdp-reveal-list-item-pending")).toHaveLength(2);
    // f(step) 重演：activeCount 变化 = 纯派生，无 DOM 增量变异
    rerender(<RevealList items={["甲", "乙", "丙"]} activeCount={2} />);
    expect(container.querySelectorAll(".cdp-reveal-list-item-active")).toHaveLength(2);
  });

  it("RevealList numbered 变体带序号", () => {
    const { container } = render(
      <RevealList items={["甲", "乙"]} activeCount={2} variant="numbered" />,
    );
    expect(container.querySelectorAll(".cdp-reveal-list-index")).toHaveLength(2);
  });

  it("StepSequence 步骤状态纯派生（done/active/pending）", () => {
    const { container, rerender } = render(
      <StepSequence
        steps={[{ title: "一" }, { title: "二" }, { title: "三" }]}
        currentStep={1}
      />,
    );
    expect(container.querySelectorAll(".cdp-step-seq-done")).toHaveLength(1);
    expect(container.querySelectorAll(".cdp-step-seq-active")).toHaveLength(1);
    expect(container.querySelectorAll(".cdp-step-seq-pending")).toHaveLength(1);
    rerender(
      <StepSequence
        steps={[{ title: "一" }, { title: "二" }, { title: "三" }]}
        currentStep={2}
      />,
    );
    expect(container.querySelectorAll(".cdp-step-seq-done")).toHaveLength(2);
  });

  it("StepSequence cards 变体渲染描述", () => {
    const { getByTestId } = render(
      <StepSequence
        steps={[{ title: "一", desc: "描述" }]}
        currentStep={0}
        variant="cards"
        data-testid="seq"
      />,
    );
    expect(getByTestId("seq")).toHaveTextContent("描述");
  });

  it("StaggerRow：默认变体类名 + 子元素原样渲染（stagger 走引擎）", () => {
    const { getByTestId } = render(
      <StaggerRow stagger reveal="rise" data-testid="sr"><span>一</span><span>二</span></StaggerRow>,
    );
    expect(getByTestId("sr").className).toContain("cdp-stagger-row");
    expect(getByTestId("sr").children).toHaveLength(2);
  });
});
