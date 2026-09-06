import type { CSSProperties } from "react";
import { HeroNumber } from "../data/HeroNumber";
import { NumberPill } from "../text/NumberPill";

export interface StepStairsItem {
  /** 序号（NumberPill 数字，如 "01"） */
  label: string;
  /** HeroNumber 大数字值 */
  value: string;
  /** mono 注（可选） */
  note?: string;
}

export interface StepStairsProps {
  items: StepStairsItem[];
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** 阶梯卡组（二十五轮 F4 收编——原展示页 S19 简报三错落阶梯方块组件化）。
    N 张卡横向排布，左低右高阶梯（每卡 marginTop 步进 24px 自末卡回推——可审计实现：
    逐卡 computed y 递减 24px）；Card 风格 4px 墨框 + 全卡同色 cream 底（二十六轮 F3：删除墨/cream 交替）+ 零阴影（网格单元纪律）。
    卡内 = NumberPill 序号 + HeroNumber 值 + mono 注。 */
export function StepStairs({ items, className = "", style, ...rest }: StepStairsProps) {
  return (
    <div className={`cdp-step-stairs ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      {items.map((item, i) => (
        <div
          key={item.label}
          className="cdp-step-stairs-card"
          style={{ marginTop: (items.length - 1 - i) * 24 }}
        >
          <NumberPill number={item.label} variant="accent" />
          <HeroNumber value={item.value} />
          {item.note ? <span className="cdp-step-stairs-note">{item.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
