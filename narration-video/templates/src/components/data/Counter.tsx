import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { durationMs, MotionDuration } from "../_internal/motion";

export interface CounterProps {
  to: number;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function Counter({ to, duration = "mid", className = "", ...rest }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const durMs = durationMs(el, duration);
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      el.textContent = String(Math.round(to * progress));
    }, durMs);
    return () => h.dispose();
  }, [to, duration]);

  return (
    <span ref={ref} className={`cdp-counter ${className}`} data-testid={rest["data-testid"]}>
      0
    </span>
  );
}
