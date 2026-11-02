import { describe, expect, it } from "vitest";
import { seededRandom } from "./seededRandom";

describe("SeededRandom（§8.1 确定性随机）", () => {
  it("同 seed 产生同序列", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("不同 seed 产生不同序列", () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    expect(a()).not.toBe(b());
  });

  it("值域 [0, 1)", () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("序列长度无限且稳定（不依赖 Date/随机源）", () => {
    const rnd = seededRandom(9);
    const first20 = Array.from({ length: 20 }, () => rnd());
    const again = seededRandom(9);
    expect(Array.from({ length: 20 }, () => again())).toEqual(first20);
  });

  // 金样值（Ruling P3-9）：标准 mulberry32 参考值（P3T1 评审验证）——
  // 钉死算法实现，错误常数/错位实现在此现形。
  it("金样值：seed=42 前 3 个输出与标准 mulberry32 参考值一致", () => {
    const rnd = seededRandom(42);
    expect([rnd(), rnd(), rnd()]).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
    ]);
  });
});
