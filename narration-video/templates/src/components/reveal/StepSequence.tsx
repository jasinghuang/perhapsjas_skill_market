// 步骤序列（铁律 6 的落点 + 设计 #3 的"步骤动画"）：
// done/active/pending 状态纯派生自 currentStep——渲染独立 mount 从头可复演；
// 激活步骤的标记 mount 触发入场动画。
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { revealAnim, staggerMs } from "../_internal/motion";

export interface StepSeqStep {
  title: string;
  desc?: string;
}

export interface StepSequenceProps {
  steps: StepSeqStep[];
  currentStep: number;
  variant?: "plain" | "cards";
  className?: string;
  "data-testid"?: string;
}

export function StepSequence({ steps, currentStep, variant = "plain", className = "", ...rest }: StepSequenceProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const step = staggerMs(el);
    const handles: AnimHandle[] = [];
    el.querySelectorAll<HTMLElement>(".cdp-step-seq-active .cdp-step-seq-marker").forEach((m, i) => {
      const h = revealAnim(m, "fade", "fast", i * step);
      if (h) handles.push(h);
    });
    return () => handles.forEach((h) => h.dispose());
  }, [steps, currentStep]);

  return (
    <div
      ref={rootRef}
      className={`cdp-step-seq cdp-step-seq-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      {steps.map((s, i) => {
        const state = i < currentStep ? "done" : i === currentStep ? "active" : "pending";
        return (
          <div key={i} className={`cdp-step-seq-item cdp-step-seq-${state}`}>
            <span className="cdp-step-seq-marker" />
            <div>
              <div className="cdp-step-seq-title">{s.title}</div>
              {variant === "cards" && s.desc ? <div className="cdp-step-seq-desc">{s.desc}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
