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
  /** 描述一句（--t-body 28px；二十六轮 F4：font-weight 600 → 400 去粗） */
  desc: string;
  /** 描述样式三档（二十六轮 F4）：plain = 现状无底无框 / block = --surface-2 底色块 + 4px 墨框 / pill = 2px 墨框药丸（--r-pill 999）。默认 plain */
  descStyle?: "plain" | "block" | "pill";
  /** 涨跌标签（可选；头行右置，与角标同一行右侧） */
  delta?: string;
  /** 涨跌语义色（A股规则——二十四轮全局落地）：up = accent-3 橙（涨）/ down = accent-1 绿（跌）；默认 up */
  deltaTone?: "up" | "down";
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** 统计格（二十五轮 F5 收编——原展示页 S3/S20 统计格组件化）。
    结构 = 头行（mono 角标左 + delta 涨跌标签右置）+ HeroNumber 大数字 + Kicker 标签 + desc（二十六轮 F4 去粗）；
    格体 Card 风格（4px 墨框 + cream 底）零阴影——网格单元纪律。
    填充配色由消费端 scope() 注入（S3 对角绿填充先例，组件本体不改） */
export function StatCell({
  index,
  value,
  label,
  desc,
  descStyle = "plain",
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
      <p className={`cdp-stat-cell-desc cdp-stat-cell-desc-${descStyle}`}>{desc}</p>
    </div>
  );
}
