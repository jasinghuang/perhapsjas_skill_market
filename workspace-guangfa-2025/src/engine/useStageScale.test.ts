import { describe, expect, it } from "vitest";
import { computeScale } from "./useStageScale";

describe("computeScale（缩放纯函数，舞台任意视口 bulletproof）", () => {
  it("16:9 舞台塞进 16:9 视口 = 1", () => {
    expect(computeScale(1920, 1080, { width: 1920, height: 1080 })).toBe(1);
  });
  it("小视口等比缩小取 min", () => {
    expect(computeScale(960, 1080, { width: 1920, height: 1080 })).toBeCloseTo(0.5);
  });
  it("3:4 舞台（1080×1440）在 16:9 视口里由高度决定", () => {
    expect(computeScale(1920, 1080, { width: 1080, height: 1440 })).toBeCloseTo(0.75);
  });
});
