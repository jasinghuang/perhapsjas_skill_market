import { useEffect, useRef } from "react";
// Ruling P2-7：ESM 顶层导入（require 在 ESM 下危险）；死代码 AnimHandle IIFE 已删除，
// 只保留直接 register 路径。
import { register } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 300, mid: 700, slow: 1400 };

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
    if (!el || typeof el.animate !== "function") return;
    // 横条生长：transform scaleX 0→value（动画属性白名单）
    const a = el.animate(
      [{ transform: "scaleX(0)" }, { transform: `scaleX(${value})` }],
      { duration: DUR_FALLBACK[duration], easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "both" },
    );
    // 注册进引擎（铁律 1）
    const handle = register({
      durationMs: DUR_FALLBACK[duration],
      seek: (tMs) => { a.currentTime = Math.min(DUR_FALLBACK[duration], Math.max(0, tMs)); },
      // currentTime 类型为 CSSNumberish，比较前 Number 强转（与 engine waapi 适配器一致）
      isFinished: () => Number(a.currentTime ?? 0) >= DUR_FALLBACK[duration] - 0.5,
      pause: () => a.pause(),
      play: () => a.play(),
    });
    return () => {
      // 卸载 dispose 纪律：反注册之外必须真正 cancel 底层动画，
      // 否则 prop 变化时旧动画在引擎控制外继续跑。
      handle.dispose();
      a.cancel();
    };
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
