// 时间轴自绘（§6.2 功能组）：生长线（scaleX waapi）+ 节点状态纯派生（铁律 6）。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { durationMs } from "../motion";

export interface TimelineTrackProps {
  points: string[];
  activeIndex: number;
  variant?: "line" | "nodes";
  className?: string;
  "data-testid"?: string;
}

export function TimelineTrack({ points, activeIndex, variant = "line", className = "", ...rest }: TimelineTrackProps) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const ratio = points.length <= 1 ? 0 : activeIndex / (points.length - 1);
    // 终审 I-3：easing 硬编码改读 --ease-out（同 BarGrow/DonutMeter，fallback 与 tokens.css 同值）
    const easing =
      getComputedStyle(el).getPropertyValue("--ease-out").trim() || "cubic-bezier(0,0,0.2,1)";
    const h = waapi(
      el,
      [{ transform: "scaleX(0)" }, { transform: `scaleX(${ratio})` }],
      { duration: durationMs(el, "mid"), easing, fill: "both" },
    );
    return () => h.dispose();
  }, [points.length, activeIndex]);

  return (
    <div
      className={`cdp-timeline cdp-timeline-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      <div className="cdp-timeline-track">
        <div ref={fillRef} className="cdp-timeline-fill" />
      </div>
      <div className="cdp-timeline-points">
        {points.map((p, i) => (
          // 二十九轮 F3 裁决翻转（P3-13 用户拍板）：单节点点亮语义 → 累计点亮——
          // i <= activeIndex 全部点亮（已走过的稿/镜/画亮、未完成的不亮）。
          // 生长线比例逻辑不变（ratio = activeIndex / (n-1)）。
          <div
            key={i}
            className={
              i <= activeIndex
                ? "cdp-timeline-point cdp-timeline-point-active"
                : "cdp-timeline-point"
            }
          >
            <span className="cdp-timeline-dot" />
            <span className="cdp-timeline-label">{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
