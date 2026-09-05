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
    const h = waapi(
      el,
      [{ transform: "scaleX(0)" }, { transform: `scaleX(${ratio})` }],
      { duration: durationMs(el, "mid"), easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "both" },
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
          // brief 自洽修正：测试契约钉住单一 active 节点（activeIndex=2 时仍恰 1 个
          // .cdp-timeline-point-active），brief 实现段 i <= activeIndex 会点亮 3 个。
          <div
            key={i}
            className={
              i === activeIndex
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
