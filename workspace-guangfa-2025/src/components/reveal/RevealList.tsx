// 列表逐条揭示（原版 list-reveal 的组件化 + 铁律 6）：
// 全部条目的状态（active/pending）纯派生自 activeCount——f(step) 从头可复演；
// 新激活条目 mount 触发入场动画（revealAnim 自接，Ruling P3-1）。
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { RevealPreset, revealAnim, staggerMs } from "../_internal/motion";

export interface RevealListProps {
  items: string[];
  /** 已揭示条数（章节层传 step 派生值，如 step + 1） */
  activeCount: number;
  preset?: RevealPreset;
  variant?: "plain" | "numbered";
  className?: string;
  "data-testid"?: string;
}

export function RevealList({ items, activeCount, preset = "rise", variant = "plain", className = "", ...rest }: RevealListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const step = staggerMs(el);
    const handles: AnimHandle[] = [];
    el.querySelectorAll<HTMLElement>(".cdp-reveal-list-item-active").forEach((item, i) => {
      const h = revealAnim(item, preset, "mid", i * step);
      if (h) handles.push(h);
    });
    return () => handles.forEach((h) => h.dispose());
  }, [items, activeCount, preset]);

  return (
    <div
      ref={listRef}
      className={`cdp-reveal-list cdp-reveal-list-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className={
            i < activeCount ? "cdp-reveal-list-item cdp-reveal-list-item-active" : "cdp-reveal-list-item cdp-reveal-list-item-pending"
          }
        >
          {variant === "numbered" ? <span className="cdp-reveal-list-index">{String(i + 1).padStart(2, "0")}</span> : null}
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}
