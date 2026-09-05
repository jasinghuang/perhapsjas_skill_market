// 缓推（有限时长 draw(t)，Ruling P3-3）：对容器做缓慢缩放平移，终态冻结。
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { durationMs, MotionDuration } from "../motion";

export interface KenBurnsProps {
  src?: string;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function KenBurns({ src, duration = "mid", className = "", ...rest }: KenBurnsProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // 氛围长时长系数 ×10（Ruling M2b-1）：动效 token 档位 × 系数，系数写组件注释
    const durMs = durationMs(el, duration) * 10;
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      const scale = 1 + 0.12 * progress;
      const x = -2 + 4 * progress;
      el.style.transform = `scale(${scale}) translate(${x}%, 0)`;
    }, durMs);
    return () => h.dispose();
  }, [src, duration]);

  return (
    <div className={`cdp-kenburns ${className}`} data-testid={rest["data-testid"]}>
      <div
        ref={innerRef}
        className="cdp-kenburns-inner"
        style={src ? { backgroundImage: `url(${src})` } : undefined}
      >
        {src ? null : <div className="cdp-kenburns-placeholder">素材待补</div>}
      </div>
    </div>
  );
}
