import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { TimelineTrack, ProgressDots } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("功能组", () => {
  it("TimelineTrack 节点数与纯派生状态", () => {
    const { container, rerender } = render(
      <TimelineTrack points={["A", "B", "C"]} activeIndex={0} />,
    );
    expect(container.querySelectorAll(".cdp-timeline-point")).toHaveLength(3);
    expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(1);
    rerender(<TimelineTrack points={["A", "B", "C"]} activeIndex={2} />);
    expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(1);
  });

  it("TimelineTrack 生长线动画注册 + dispose", () => {
    const { unmount } = render(<TimelineTrack points={["A", "B"]} activeIndex={1} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("ProgressDots total/current 纯派生", () => {
    const { container, rerender } = render(<ProgressDots total={5} current={2} />);
    expect(container.querySelectorAll(".cdp-progress-dot")).toHaveLength(5);
    expect(container.querySelectorAll(".cdp-progress-dot-on")).toHaveLength(3);
    rerender(<ProgressDots total={5} current={4} />);
    expect(container.querySelectorAll(".cdp-progress-dot-on")).toHaveLength(5);
  });

  it("ProgressDots bars 变体", () => {
    const { container } = render(<ProgressDots total={3} current={1} variant="bars" />);
    expect(container.querySelectorAll(".cdp-progress-bar")).toHaveLength(3);
  });
});
