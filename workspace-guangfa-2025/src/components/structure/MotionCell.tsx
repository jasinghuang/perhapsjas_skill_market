import type { CSSProperties, ReactNode } from "react";

/** 动效展示格（S09 动效实验室收编）：surface 底 + 4px surface-3 墨框 + mono 标签 + 居中展示区。
    尺寸（width/height）由消费端 style 提供——网格构图属消费端职责。 */

export interface MotionCellProps {
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function MotionCell({ label, children, className = "", style, ...rest }: MotionCellProps) {
  return (
    <div className={`cdp-motion-cell ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      <span className="cdp-motion-cell-label">{label}</span>
      <div className="cdp-motion-cell-body">{children}</div>
    </div>
  );
}
