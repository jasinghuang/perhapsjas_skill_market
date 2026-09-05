// 文字揭示（MaskReveal 修复版的组件化）：逐词拆分为 span，逐子元素延迟动画。
// Ruling P3-1：动态拆分内容自接 revealAnim（不走工厂 stagger）。
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { RevealPreset, revealAnim, staggerMs } from "../motion";

export interface RevealTextProps {
  text: string;
  preset?: RevealPreset;
  variant?: "words" | "mask";
  className?: string;
  "data-testid"?: string;
}

export function RevealText({ text, preset = "rise", variant = "words", className = "", ...rest }: RevealTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const words = el.querySelectorAll<HTMLElement>(".cdp-reveal-text-word");
    const step = staggerMs(el);
    const handles: AnimHandle[] = [];
    words.forEach((w, i) => {
      const h = revealAnim(w, preset, "mid", i * step);
      if (h) handles.push(h);
    });
    return () => handles.forEach((h) => h.dispose());
  }, [text, preset]);

  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div
      ref={rootRef}
      className={`cdp-reveal-text cdp-reveal-text-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      {words.map((w, i) => (
        <span key={i} className="cdp-reveal-text-word">
          {w}
        </span>
      ))}
    </div>
  );
}
