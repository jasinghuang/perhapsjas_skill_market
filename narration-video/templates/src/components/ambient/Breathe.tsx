// 呼吸微动（有限迭代，Ruling P3-3）：waapi iterations 有限值，渲染可 seek。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { durationMs } from "../motion";

export interface BreatheProps {
  cycles?: number;
  variant?: "pulse" | "glow";
  className?: string;
  "data-testid"?: string;
}

export function Breathe({ cycles = 3, variant = "pulse", className = "", ...rest }: BreatheProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = waapi(
      el,
      [
        { transform: "scale(1)", opacity: 0.85 },
        { transform: "scale(1.06)", opacity: 1 },
        { transform: "scale(1)", opacity: 0.85 },
      ],
      { duration: durationMs(el, "slow"), iterations: cycles, easing: "ease-in-out", fill: "both" },
    );
    return () => h.dispose();
  }, [cycles, variant]);

  return (
    <div
      ref={ref}
      className={`cdp-breathe cdp-breathe-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    />
  );
}
