import type { CSSProperties } from "react";
import { HeroNumber } from "./HeroNumber";
import { Kicker } from "../text/Kicker";

export interface StatCellProps {
  /** mono 角标（/01 式，头行左侧） */
  index: string;
  /** HeroNumber 大数字 */
  value: string;
  /** Kicker 标签（可含口径说明） */
  label: string;
  /** 描述一句（突出样式：--t-body 28px + font-weight 600） */
  desc: string;
  /** 涨跌标签（可选；头行右置，与角标同一行右侧） */
  delta?: string;
  /** 涨跌语义色（A股规则——二十四轮全局落地）：up = accent-3 橙（涨）/ down = accent-1 绿（跌）；默认 up */
  deltaTone?: "up" | "down";
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** 统计格（二十五轮 F5 收编——原展示页 S3/S20 统计格组件化）。
    结构 = 头行（mono 角标左 + delta 涨跌标签右置）+ HeroNumber 大数字 + Kicker 标签 + desc 突出样式；
    格体 Card 风格（4px 墨框 + cream 底）零阴影——网格单元纪律。
    填充配色由消费端 scope() 注入（S3 对角绿填充先例，组件本体不改） */
export function StatCell({
  index,
  value,
  label,
  desc,
  delta,
  deltaTone = "up",
  className = "",
  style,
  ...rest
}: StatCellProps) {
  return (
    <div className={`cdp-stat-cell ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      <div className="cdp-stat-cell-head">
        <span className="cdp-stat-cell-index">{index}</span>
        {delta ? (
          <span className={`cdp-stat-cell-delta cdp-stat-cell-delta-${deltaTone}`}>{delta}</span>
        ) : null}
      </div>
      <HeroNumber value={value} />
      <Kicker variant="plain" className="cdp-stat-cell-label">
        {label}
      </Kicker>
      <p className="cdp-stat-cell-desc">{desc}</p>
    </div>
  );
}
