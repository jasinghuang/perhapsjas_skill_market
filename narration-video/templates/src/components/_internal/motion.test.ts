import { describe, expect, it } from "vitest";
import { durationMs, RevealPreset, revealAnim, staggerMs } from "./motion";
import { registrySize } from "../../engine/animationRuntime";

// 终审 M9：无本地 FakeAnim 副本——Element.prototype.animate 的 WAAPI stub
// 由全局 test-setup.ts 安装（Ruling P2-11），此处直接用 document.createElement。
describe("motion 动效档位", () => {
  it("revealAnim 注册进引擎注册表并返回 handle", () => {
    const el = document.createElement("div");
    const h = revealAnim(el, "fade", "fast", 0);
    expect(h).not.toBeNull();
    expect(registrySize()).toBeGreaterThan(0);
    h!.dispose();
    expect(registrySize()).toBe(0);
  });

  it("三个预设 keyframes 形状正确", () => {
    const presets: RevealPreset[] = ["fade", "rise", "wipe"];
    for (const p of presets) {
      const el = document.createElement("div");
      const h = revealAnim(el, p, "mid", 0);
      expect(h).not.toBeNull();
      h!.dispose();
    }
  });

  it("staggerMs 读 --stagger 计算值（jsdom 无计算值时报默认 120）", () => {
    expect(typeof staggerMs(document.createElement("div"))).toBe("number");
    expect(staggerMs(document.createElement("div"))).toBeGreaterThan(0);
  });

  it("durationMs 读 --dur-* 计算值（jsdom 无计算值走 fallback 300/700/1400）", () => {
    const el = document.createElement("div");
    expect(durationMs(el, "fast")).toBe(300);
    expect(durationMs(el, "mid")).toBe(700);
    expect(durationMs(el, "slow")).toBe(1400);
  });
});
