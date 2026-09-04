import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { createPrimitive } from "../factory";
import { MotionDuration } from "../motion";

export interface HeroNumberProps {
  value: string;
  variant?: "plain" | "accent";
  /** true = 数字从 0 滚动到目标值（帧函数逃生舱，铁律 2） */
  countUp?: boolean;
  duration?: MotionDuration;
  "data-testid"?: string;
}

function parseLeadNumber(value: string): number | null {
  const m = value.match(/^-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 300, mid: 700, slow: 1400 };

// Ruling P2-6：Base 必须在模块作用域——放函数体内每次渲染新建组件类型，
// React 视为不同组件导致子树重挂（动画/注册表状态全部丢失）。
const Base = createPrimitive("hero-number", {
  tag: "div",
  variants: ["plain", "accent"],
  defaultVariant: "plain",
});

export function HeroNumber({ value, variant = "plain", countUp, duration = "mid", ...rest }: HeroNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!countUp) return;
    const el = spanRef.current;
    if (!el) return;
    const target = parseLeadNumber(value);
    if (target === null) return;
    const durMs = DUR_FALLBACK[duration];
    // draw(t)：t ∈ [0, durMs] → 进度 → 数值（帧函数逃生舱，可 seek）
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      const shown = Math.round(target * progress);
      el.textContent = String(shown) + value.replace(/^-?\d+(\.\d+)?/, "");
    }, durMs);
    return () => h.dispose();
  }, [countUp, value, duration]);

  return (
    <Base variant={variant} data-testid={rest["data-testid"]}>
      <span ref={spanRef} className="cdp-hero-number-value">{value}</span>
    </Base>
  );
}
