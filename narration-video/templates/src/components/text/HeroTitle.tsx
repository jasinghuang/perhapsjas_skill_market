import type { CSSProperties, ReactNode } from "react";
import { createPrimitive } from "../_internal/factory";
import type { MotionDuration, RevealPreset } from "../_internal/motion";

export interface HeroTitleProps {
  /** 字阶档位（消费 --t-display-1/--t-display-2/--t-h1/--t-h2；默认 display-1） */
  size?: "display-1" | "display-2" | "h1" | "h2";
  /** 双语双行（十七轮 F1）：latin 行（Archivo Black uppercase）+ cn 行（Noto Sans SC 900）；两者都给时渲染双行 */
  latin?: string;
  cn?: string;
  variant?: "plain" | "stamp";
  reveal?: RevealPreset;
  duration?: MotionDuration;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "data-testid"?: string;
}

// Ruling P2-6：Base 必须在模块作用域（函数体内新建会导致子树重挂、动画注册表状态丢失）
const Base = createPrimitive("hero-title", {
  tag: "h1",
  variants: ["plain", "stamp"],
  defaultVariant: "plain",
});

const SIZE_CLASSES: Record<NonNullable<HeroTitleProps["size"]>, string> = {
  "display-1": "cdp-hero-title-size-display-1",
  "display-2": "cdp-hero-title-size-display-2",
  h1: "cdp-hero-title-size-h1",
  h2: "cdp-hero-title-size-h2",
};

/** 大标题（§6.2 文字组）。variants: plain（字阶直排）/ stamp（墨底白字印戳式硬阴影）；
    size = 字阶 token 档位（十轮 F2 组件增强）；latin+cn = 双语双行（十七轮 F1），仅 children 时行为不变（向后兼容） */
export function HeroTitle({ size = "display-1", latin, cn, variant, className = "", children, ...rest }: HeroTitleProps) {
  const content =
    latin && cn ? (
      <>
        <span className="cdp-hero-title-latin">{latin}</span>
        <span className="cdp-hero-title-cn">{cn}</span>
      </>
    ) : (
      children
    );
  return (
    <Base variant={variant} className={[SIZE_CLASSES[size], className].filter(Boolean).join(" ")} {...rest}>
      {content}
    </Base>
  );
}
