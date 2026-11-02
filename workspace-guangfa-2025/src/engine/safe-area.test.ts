import { describe, expect, it } from "vitest";
import { SAFE_AREA_BASE, SAFE_AREA_BASE_DIMS, deriveSafeArea } from "./safe-area";

describe("安全框单一数字源（§12b V1 基准 + 档案比例折算）", () => {
  it("16:9 基准值 = 字面量（不用 SAFE_AREA_BASE 自比——恒真断言）", () => {
    expect(deriveSafeArea({ width: 1920, height: 1080 })).toEqual({
      chrome: 64,
      content: 96,
      top: 112,
      contentBottom: 934,
      captionTop: 958,
    });
  });

  it("3:4 比例折算（1080×1440）：水平按 W/1920、垂直按 H/1080 取整", () => {
    expect(deriveSafeArea({ width: 1080, height: 1440 })).toEqual({
      chrome: 36, // 64 × 0.5625
      content: 54, // 96 × 0.5625
      top: 149, // 112 × 4/3 = 149.33 → 取整
      contentBottom: 1245, // 934 × 4/3 = 1245.33 → 取整
      captionTop: 1277, // 958 × 4/3 = 1277.33 → 取整
    });
  });

  it("基准常量与折算函数自洽（防双处漂移：改一边必红）", () => {
    expect(deriveSafeArea(SAFE_AREA_BASE_DIMS)).toEqual(SAFE_AREA_BASE);
  });

  it("形状冻结：恰好 5 字段（brief 冻结面，不得增删）", () => {
    expect(Object.keys(SAFE_AREA_BASE).sort()).toEqual([
      "captionTop",
      "chrome",
      "content",
      "contentBottom",
      "top",
    ]);
  });

  it("非空护栏：零/负/NaN 尺寸抛错", () => {
    expect(() => deriveSafeArea({ width: 0, height: 1080 })).toThrow();
    expect(() => deriveSafeArea({ width: 1920, height: 0 })).toThrow();
    expect(() => deriveSafeArea({ width: -1920, height: 1080 })).toThrow();
    expect(() => deriveSafeArea({ width: Number.NaN, height: 1080 })).toThrow();
    expect(() => deriveSafeArea({ width: 1920, height: Number.POSITIVE_INFINITY })).toThrow();
  });
});
