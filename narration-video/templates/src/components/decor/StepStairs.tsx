import type { CSSProperties } from "react";
import { HeroNumber } from "../data/HeroNumber";

export interface StepStairsItem {
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

/** 阶梯基数与步进（二十七轮 F3）：卡片高度逐级递增 220/248/276...（底部对齐、顶部阶梯上升）。
    CSS 上升箭头几何与之同源（rise 框高 = STAIR_STEP，折线由低卡顶沿升至邻卡顶沿）。 */
export const STAIR_BASE = 220;
export const STAIR_STEP = 28;

/** 阶梯卡组（二十五轮 F4 收编；二十七轮 F3 重设计）。
    删除 NumberPill 序号（组件不再渲染序号）；卡内 = HeroNumber 值 + mono 注。
    "上升"感用设计体现：卡片高度逐级递增（右卡更高 220/248/276，底部对齐、顶部阶梯上升）
    + 卡间 CSS 几何上升箭头（短线折线 + 45° 角头，位于 gap 内指向更高卡、不压卡）。
    Card 风格 4px 墨框 + 全卡同色 cream 底（二十六轮 F3）+ 零阴影（网格单元纪律）。 */
export function StepStairs({ items, className = "", style, ...rest }: StepStairsProps) {
  return (
    <div className={`cdp-step-stairs ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      {items.map((item, i) => (
        <div key={`${item.value}-${i}`} className="cdp-step-stairs-card" style={{ height: STAIR_BASE + i * STAIR_STEP }}>
          <HeroNumber value={item.value} />
          {item.note ? <span className="cdp-step-stairs-note">{item.note}</span> : null}
          {i < items.length - 1 ? <span className="cdp-step-stairs-rise" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}
