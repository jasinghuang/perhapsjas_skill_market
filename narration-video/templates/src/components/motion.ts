// 动效档位与预设（§5.1 动效 token 的组件层消费入口）。
// 所有动画必经引擎注册表（铁律 1）；时长/缓动从主题动效 token 读取，零硬编码。

import { AnimHandle, waapi } from "../engine/animationRuntime";

export type MotionDuration = "fast" | "mid" | "slow";
export type RevealPreset = "fade" | "rise" | "wipe";

const DUR_TOKEN: Record<MotionDuration, string> = {
  fast: "--dur-fast",
  mid: "--dur-mid",
  slow: "--dur-slow",
};

const EASE_TOKEN: Record<MotionDuration, string> = {
  fast: "--ease-in",
  mid: "--ease-out",
  slow: "--ease-emph",
};

const KEYFRAMES: Record<RevealPreset, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  rise: [
    { opacity: 0, transform: "translateY(24px)" },
    { opacity: 1, transform: "translateY(0)" },
  ],
  wipe: [
    { clipPath: "inset(0 0 100% 0)" },
    { clipPath: "inset(0 0 0 0)" },
  ],
};

/** 从元素计算样式读 token 并解析为 ms */
function readTokenMs(el: Element, token: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const n = parseFloat(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

export { readTokenMs };

/** 从元素计算样式读动效档位时长（ms）。组件动画时长的唯一合法来源（§5.1 动效 token，I1）。
 * fallback 链与 §5.1 tokens.css 同值：fast 300 / mid 700 / slow 1400。 */
export function durationMs(el: Element, tier: MotionDuration): number {
  return readTokenMs(el, DUR_TOKEN[tier], tier === "fast" ? 300 : tier === "mid" ? 700 : 1400);
}

export function staggerMs(el: Element): number {
  return readTokenMs(el, "--stagger", 120);
}

/** 入场动画：走引擎注册表；返回 handle 供调用方 dispose（卸载清理，终审 Recommendation） */
export function revealAnim(
  el: Element,
  preset: RevealPreset,
  duration: MotionDuration,
  delayMs: number,
): AnimHandle | null {
  if (typeof el.animate !== "function") return null;
  const dur = durationMs(el, duration);
  const easing = getComputedStyle(el).getPropertyValue(EASE_TOKEN[duration]).trim() || "linear";
  return waapi(el, KEYFRAMES[preset], {
    duration: dur,
    delay: delayMs,
    easing,
    fill: "both",
  });
}
