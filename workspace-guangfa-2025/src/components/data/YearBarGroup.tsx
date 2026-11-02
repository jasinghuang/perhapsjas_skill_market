import type { CSSProperties } from "react";

/** 年份柱组（S21 双年对比收编）：每柱 4px 墨框 + 高 = value / max（容器高基准），
    柱宽走 --year-bar-w（默认 140px）；tone = muted（surface-2 灰）/ accent（accent-1 绿）。
    组容器 height: 100%（% 柱高的解析基准——父级须给显式高度）。 */

export interface YearBar {
  value: number;
  tone: "muted" | "accent";
  "data-testid"?: string;
}

export interface YearBarGroupProps {
  bars: YearBar[];
  /** 柱高百分比基准（100% = max） */
  max: number;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function YearBarGroup({ bars, max, className = "", style, ...rest }: YearBarGroupProps) {
  return (
    <div className={`cdp-year-bar-group ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      {bars.map((bar, i) => (
        <div
          key={i}
          className={`cdp-year-bar cdp-year-bar-${bar.tone}`}
          style={{ height: `${(bar.value / max) * 100}%` }}
          data-testid={bar["data-testid"]}
        />
      ))}
    </div>
  );
}
