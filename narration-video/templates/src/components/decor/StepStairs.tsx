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

/** 阶梯基数与步进（二十八轮 F4 v3）：卡片尺寸全等（统一高 STAIR_BASE、等宽 flex:1）；
    位置阶梯 = 逐卡 translateY 上抬 0/24/48（左低右高）；顶部橙条（--accent-3）高 14px
    贴卡内上缘（CSS --stair-bar-h 同源）。 */
export const STAIR_BASE = 220;
export const STAIR_STEP = 24;

/** 阶梯卡组（二十五轮 F4 收编；二十八轮 F4 v3 重设计）。
    删除 NumberPill 序号与卡间上升箭头；卡内 = 顶部 accent-3 橙条（14px，贴卡内上缘、4px 墨框内）
    + HeroNumber 值 + mono 注（文字经 padding-top 预留向下避让橙条）。
    "上升"感用位置高度表达：卡片等高等宽，左低右高——逐卡 translateY(0/-24/-48) 上抬（24px 步进）。
    Card 风格 4px 墨框 + 全卡同色 cream 底（二十六轮 F3）+ 零阴影（网格单元纪律）。 */
export function StepStairs({ items, className = "", style, ...rest }: StepStairsProps) {
  return (
    <div className={`cdp-step-stairs ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      {items.map((item, i) => (
        <div
          key={`${item.value}-${i}`}
          className="cdp-step-stairs-card"
          style={{ height: STAIR_BASE, transform: `translateY(${-i * STAIR_STEP}px)` }}
        >
          <HeroNumber value={item.value} />
          {item.note ? <span className="cdp-step-stairs-note">{item.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
