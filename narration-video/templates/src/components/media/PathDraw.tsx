// SVG 路径自绘（原版核心视觉演示之一）：pathLength 归一化 + stroke-dashoffset 动画（白名单 P2-1）。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 500, mid: 1200, slow: 2400 };

export interface PathDrawProps {
  d: string;
  duration?: MotionDuration;
  variant?: "stroke" | "filled";
  className?: string;
  "data-testid"?: string;
}

export function PathDraw({ d, duration = "mid", variant = "stroke", className = "", ...rest }: PathDrawProps) {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (variant !== "stroke") return;
    const el = pathRef.current;
    if (!el) return;
    const durMs = DUR_FALLBACK[duration];
    const h = waapi(
      el,
      [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
      { duration: durMs, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "forwards" },
    );
    return () => h.dispose();
  }, [d, duration, variant]);

  return (
    <svg
      viewBox="0 0 100 100"
      className={`cdp-path-draw ${className}`}
      data-testid={rest["data-testid"]}
    >
      <path
        ref={pathRef}
        d={d}
        pathLength={1}
        className="cdp-path-draw-path"
        style={
          variant === "stroke"
            ? { strokeDasharray: 1, strokeDashoffset: 1 }
            : { strokeDasharray: undefined, strokeDashoffset: 0 }
        }
      />
    </svg>
  );
}
