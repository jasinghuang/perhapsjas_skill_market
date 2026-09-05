import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom 无 WAAPI：全局测试基建 stub（Ruling P2-11，T4-T6 组件测试直接复用）。
// 原型级 stub（终审 M9：motion.test.ts / factory.test.tsx 已删本地 FakeAnim 副本，
// 全库统一走此全局 stub），否则 revealAnim 因 typeof el.animate !== "function"
// 直接返回 null，注册表恒空。
class FakeAnim {
  currentTime = 0;
  playState: "paused" | "running" | "finished" | "idle" = "paused";
  constructor(public opts: KeyframeAnimationOptions) {}
  play() { this.playState = "running"; }
  pause() { this.playState = "paused"; }
  // 评审修复：BarGrow dispose 纪律调用底层 cancel()（WAAPI 标准接口），stub 需同型
  cancel() { this.playState = "idle"; }
}

const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  Element.prototype.animate = (k: unknown, opts: KeyframeAnimationOptions) =>
    new FakeAnim(opts) as unknown as Animation;
  // I-1 修复后 canvasAnim 非 render 模式创建即播：jsdom 原生 rAF 由真实 setInterval
  // 驱动，会在每个组件测试里留下跨测试的真实后台帧链（直至动画总时长）。
  // 全局替换为 no-op 捕获桩保确定性；需要帧驱动的测试（animationRuntime.test.ts /
  // App.test.tsx 集成）在用例内自行 stubGlobal 覆盖，不受影响。
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
});

// RTL 全局 cleanup（Ruling P2-12）：vitest 未开 globals，RTL 不自动注册，
// 组件测试不再需要 per-file 手动 cleanup。
afterEach(cleanup);
