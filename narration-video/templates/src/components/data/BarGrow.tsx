// Ruling M2b-3（I1 收敛）：BarGrow 收敛到引擎 waapi 适配器——
// 删除内联 register/seek/isFinished 块，dispose cancel 与 isFinished「>」语义随适配器自动一致；
// 时长读 --dur-* 动效 token，easing 读 --ease-out（fallback 与 tokens.css 同值）。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { durationMs, MotionDuration } from "../motion";

export interface BarGrowProps {
  /** 0-1 */
  value: number;
  variant?: "solid" | "accent";
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function BarGrow({ value, variant = "solid", duration = "mid", className = "", ...rest }: BarGrowProps) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    // 横条生长：transform scaleX 0→value（动画属性白名单）
    const easing =
      getComputedStyle(el).getPropertyValue("--ease-out").trim() || "cubic-bezier(0,0,0.2,1)";
    const h = waapi(
      el,
      [{ transform: "scaleX(0)" }, { transform: `scaleX(${value})` }],
      { duration: durationMs(el, duration), easing, fill: "both" },
    );
    return () => h.dispose();
  }, [value, duration]);

  return (
    <div
      className={`cdp-bar-grow cdp-bar-grow-${variant} ${className}`}
      data-testid={rest["data-testid"]}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
    >
      <div ref={fillRef} className="cdp-bar-grow-fill" />
    </div>
  );
}
