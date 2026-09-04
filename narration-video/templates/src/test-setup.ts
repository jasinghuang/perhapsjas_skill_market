import { afterEach, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom 无 WAAPI：全局测试基建 stub（Ruling P2-11，T4-T6 组件测试直接复用）。
// 原型级 stub（与 motion.test.ts / factory.test.tsx 的 FakeAnim 模式一致），
// 否则 revealAnim 因 typeof el.animate !== "function" 直接返回 null，注册表恒空。
class FakeAnim {
  currentTime = 0;
  playState: "paused" | "running" | "finished" = "paused";
  constructor(public opts: KeyframeAnimationOptions) {}
  play() { this.playState = "running"; }
  pause() { this.playState = "paused"; }
}

const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  Element.prototype.animate = (k: unknown, opts: KeyframeAnimationOptions) =>
    new FakeAnim(opts) as unknown as Animation;
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
});
