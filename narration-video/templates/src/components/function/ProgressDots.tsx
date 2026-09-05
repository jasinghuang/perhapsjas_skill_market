// 步骤进度点（§6.2 功能组）：on 状态纯派生自 current（铁律 6）。
import { createPrimitive } from "../factory";

export interface ProgressDotsProps {
  total: number;
  current: number;
  variant?: "dots" | "bars";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("progress-dots", {
  tag: "div",
  variants: ["dots", "bars"],
  defaultVariant: "dots",
});

export function ProgressDots({ total, current, variant = "dots", className, ...rest }: ProgressDotsProps) {
  // brief 自洽修正：测试契约钉住 bars 变体渲染 .cdp-progress-bar（brief 实现段
  // 只渲染 .cdp-progress-dot，与测试矛盾）——子元素基类随 variant 切换，on 类同构派生。
  const itemCls = variant === "bars" ? "cdp-progress-bar" : "cdp-progress-dot";
  return (
    <Base variant={variant} className={className} data-testid={rest["data-testid"]}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i <= current ? `${itemCls} ${itemCls}-on` : itemCls} />
      ))}
    </Base>
  );
}
