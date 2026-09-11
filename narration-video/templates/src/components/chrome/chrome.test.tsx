import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { TimelineTrack, ProgressDots } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("功能组", () => {
  describe("TimelineTrack", () => {
    it("TimelineTrack 节点数与累计点亮状态（二十九轮 F3：i <= activeIndex 全部点亮——P3-13 裁决翻转）", () => {
      const { container, rerender } = render(
        <TimelineTrack points={["A", "B", "C"]} activeIndex={0} />,
      );
      expect(container.querySelectorAll(".cdp-timeline-point")).toHaveLength(3);
      // 累计点亮：activeIndex=0 → 点亮第 1 个
      expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(1);
      rerender(<TimelineTrack points={["A", "B", "C"]} activeIndex={2} />);
      // 累计点亮：activeIndex=2 → 点亮 3 个（已走过的全部亮，未完成的不亮）
      expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(3);
      rerender(<TimelineTrack points={["A", "B", "C"]} activeIndex={1} />);
      // 累计点亮：activeIndex=1 → 点亮 2 个（第 3 个未完成不亮）
      expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(2);
    });

    it("TimelineTrack 生长线动画注册 + dispose", () => {
      const { unmount } = render(<TimelineTrack points={["A", "B"]} activeIndex={1} />);
      expect(registrySize()).toBeGreaterThan(0);
      unmount();
      expect(registrySize()).toBe(0);
    });
  });

  describe("ProgressDots", () => {
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
});
