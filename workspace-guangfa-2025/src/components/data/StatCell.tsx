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
  /** 描述样式四档（二十七轮 F4 迭代；二十八轮 F3 定稿）：block = accent-1 绿底 cream 字（无边框，用户选定方案，
      默认档） / pill = 4px 墨框药丸（--r-pill 999）+ 600 加粗 / pillFilled = accent-1 绿填充药丸 cream 字（无边框）
      / plain = 无底无框。pill/pillFilled 保留为组件能力（styleguide 展示），展示页不再使用 */
  descStyle?: "plain" | "block" | "pill" | "pillFilled";
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

/** descStyle 档位 → CSS 类（pillFilled 映射 kebab 类名——descStyle 字面 camelCase 与 CSS 命名约定解耦） */
const DESC_STYLE_CLASS: Record<NonNullable<StatCellProps["descStyle"]>, string> = {
  plain: "cdp-stat-cell-desc-plain",
  block: "cdp-stat-cell-desc-block",
  pill: "cdp-stat-cell-desc-pill",
  pillFilled: "cdp-stat-cell-desc-pill-filled",
};
export function StatCell({
  index,
  value,
  label,
  desc,
  descStyle = "block",
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
      <p className={`cdp-stat-cell-desc ${DESC_STYLE_CLASS[descStyle]}`}>{desc}</p>
    </div>
  );
}
