import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { RevealPreset, revealAnim, staggerMs } from "./motion";
import { registrySize } from "../engine/animationRuntime";

class FakeAnim {
  currentTime = 0;
  playState: "paused" | "running" | "finished" = "paused";
  constructor(public opts: KeyframeAnimationOptions) {}
  play() { this.playState = "running"; }
  pause() { this.playState = "paused"; }
}

function stubElement(): HTMLElement {
  const el = document.createElement("div");
  el.animate = (k: unknown, opts: KeyframeAnimationOptions) =>
    new FakeAnim(opts) as unknown as Animation;
  return el;
}

describe("motion 动效档位", () => {
  it("revealAnim 注册进引擎注册表并返回 handle", () => {
    const el = stubElement();
    const h = revealAnim(el, "fade", "fast", 0);
    expect(h).not.toBeNull();
    expect(registrySize()).toBeGreaterThan(0);
    h!.dispose();
    expect(registrySize()).toBe(0);
  });

  it("三个预设 keyframes 形状正确", () => {
    const presets: RevealPreset[] = ["fade", "rise", "wipe"];
    for (const p of presets) {
      const el = stubElement();
      const h = revealAnim(el, p, "mid", 0);
      expect(h).not.toBeNull();
      h!.dispose();
    }
  });

  it("staggerMs 读 --stagger 计算值（jsdom 无计算值时报默认 120）", () => {
    expect(typeof staggerMs(document.createElement("div"))).toBe("number");
    expect(staggerMs(document.createElement("div"))).toBeGreaterThan(0);
  });
});
