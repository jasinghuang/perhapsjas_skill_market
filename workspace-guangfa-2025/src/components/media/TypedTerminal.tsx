// 打字机（Ruling P3-2：v1 不含闪烁光标——无限动画禁令）。
// 打字过程 = 有限 canvasAnim 帧函数：draw(t) 只依赖 t 与捕获值，可 seek。
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { durationMs, MotionDuration } from "../_internal/motion";

export interface TypedTerminalProps {
  lines: string[];
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function TypedTerminal({ lines, duration = "mid", className = "", ...rest }: TypedTerminalProps) {
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const full = lines.join("\n");
    // 打字语义长时长系数 ×3（Ruling M2b-1）：动效 token 档位 × 系数，系数写组件注释
    const durMs = durationMs(el, duration) * 3;
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      const count = Math.round(full.length * progress);
      el.textContent = full.slice(0, count);
    }, durMs);
    return () => h.dispose();
  }, [lines.join("|"), duration]);

  return (
    <div className={`cdp-terminal ${className}`} data-testid={rest["data-testid"]}>
      <div ref={textRef} className="cdp-terminal-text">
        {lines[0]}
      </div>
    </div>
  );
}
