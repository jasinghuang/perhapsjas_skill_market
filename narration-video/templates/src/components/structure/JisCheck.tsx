import type { CSSProperties } from "react";

/** JIS 勾选框（S15 规格表收编）：24×24（var(--space-3)）墨框方块；
    checked = 墨底 + cream 对勾（CSS 几何 L 形 3px 左/下边框 rotate -45deg——保视觉迁移）。 */

export interface JisCheckProps {
  checked: boolean;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function JisCheck({ checked, className = "", style, ...rest }: JisCheckProps) {
  return (
    <div
      className={`cdp-jis-check ${checked ? "cdp-jis-check-checked" : ""} ${className}`.trim()}
      style={style}
      aria-hidden="true"
      data-testid={rest["data-testid"]}
    >
      {checked ? <div className="cdp-jis-check-mark" /> : null}
    </div>
  );
}
