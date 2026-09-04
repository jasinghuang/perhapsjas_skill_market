// 组件工厂（§6.4 缺点 1 的机制落点）：每个组件 = 变体配置 + components/ 内 CSS。
// 统一处理：变体类名、token 驱动样式（样式在组件 CSS）、动画预设走引擎注册表、卸载 dispose。
// 铁律 5：stagger 用逐子元素延迟动画实现（Ruling 8 后 delay 语义正确）。

import {
  CSSProperties,
  ElementType,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { AnimHandle } from "../engine/animationRuntime";
import { MotionDuration, RevealPreset, revealAnim, staggerMs } from "./motion";

export interface PrimitiveProps {
  variant?: string;
  reveal?: RevealPreset;
  duration?: MotionDuration;
  /** true = 对直接子元素逐条揭示（stagger 消费 --stagger token） */
  stagger?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "data-testid"?: string;
}

export interface PrimitiveConfig {
  tag: ElementType;
  variants: string[];
  defaultVariant: string;
}

export type PrimitiveComponent = (props: PrimitiveProps) => ReactNode;

export function createPrimitive(
  name: string,
  config: PrimitiveConfig,
): PrimitiveComponent {
  const { tag: Tag, defaultVariant } = config;

  return function Primitive(props: PrimitiveProps) {
    const { variant = defaultVariant, reveal, duration = "mid", stagger, className = "", style, children } = props;
    const rootRef = useRef<HTMLElement | null>(null);
    const handlesRef = useRef<AnimHandle[]>([]);

    useEffect(() => {
      const el = rootRef.current;
      if (!el || !reveal) return;
      handlesRef.current = [];
      if (stagger && el.children.length > 0) {
        const step = staggerMs(el);
        Array.from(el.children).forEach((child, i) => {
          const h = revealAnim(child as HTMLElement, reveal, duration, i * step);
          if (h) handlesRef.current.push(h);
        });
      } else {
        const h = revealAnim(el, reveal, duration, 0);
        if (h) handlesRef.current.push(h);
      }
      return () => {
        handlesRef.current.forEach((h) => h.dispose());
        handlesRef.current = [];
      };
    }, [reveal, duration, stagger]);

    const classes = ["cdp", `cdp-${name}`, `cdp-${name}-${variant}`, className]
      .filter(Boolean)
      .join(" ");

    return (
      <Tag ref={rootRef} className={classes} style={style} data-testid={props["data-testid"]}>
        {children}
      </Tag>
    );
  };
}
