import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { durationMs, MotionDuration } from "../_internal/motion";

const R = 54;
const CIRC = 2 * Math.PI * R;

export interface DonutMeterProps {
  /** 0-1 */
  value: number;
  label?: string;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function DonutMeter({ value, label, duration = "mid", className = "", ...rest }: DonutMeterProps) {
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    // 环形描边：stroke-dashoffset 动画（Ruling P2-1 白名单扩展）
    const target = CIRC * (1 - value);
    // I1：easing 硬编码 cubic-bezier 一并改读 --ease-out（同 PathDraw，fallback 与 tokens.css 同值）
    const easing =
      getComputedStyle(el).getPropertyValue("--ease-out").trim() || "cubic-bezier(0,0,0.2,1)";
    const h = waapi(
      el,
      [
        { strokeDashoffset: CIRC },
        { strokeDashoffset: target },
      ],
      { duration: durationMs(el, duration), easing, fill: "both" },
    );
    return () => h.dispose();
  }, [value, duration]);

  return (
    <div className={`cdp-donut ${className}`} data-testid={rest["data-testid"]}>
      <svg width="144" height="144" viewBox="0 0 144 144">
        <circle cx="72" cy="72" r={R} className="cdp-donut-track" />
        <circle
          ref={circleRef}
          cx="72"
          cy="72"
          r={R}
          className="cdp-donut-arc"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC}
        />
      </svg>
      {label ? <div className="cdp-donut-label">{label}</div> : null}
    </div>
  );
}
