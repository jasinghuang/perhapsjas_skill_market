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

/** 阶梯基数与步进（二十九轮 F4 v4）：位置高度一致（底缘共线——容器底部锚定，不再 translateY 错落）；
    卡片高度递增 = 基数 180 + i × 步进 40（180/220/260，底部对齐、顶部阶梯轮廓）；顶部橙条（--accent-3）高 14px
    贴卡内上缘（CSS 内同值预留）。 */
export const STAIR_BASE = 180;
export const STAIR_STEP = 40;

/** 阶梯卡组（二十五轮 F4 收编；二十九轮 F4 v4 重设计）。
    删除 NumberPill 序号与卡间上升箭头（v3 保留）；卡内 = 顶部 accent-3 橙条（14px，贴卡内上缘、4px 墨框内）
    + HeroNumber 值 + mono 注（文字经 padding-top 预留向下避让橙条）。
    "上升"感用卡片高度表达：三卡位置高度一致（同一水平线，不再错落）、卡高逐级递增 180/220/260
    （底部对齐、顶部阶梯轮廓——左低右高）。
    Card 风格 4px 墨框 + 全卡同色 cream 底（二十六轮 F3）+ 零阴影（网格单元纪律）。 */
export function StepStairs({ items, className = "", style, ...rest }: StepStairsProps) {
  return (
    <div className={`cdp-step-stairs ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      {items.map((item, i) => (
        <div
          key={`${item.value}-${i}`}
          className="cdp-step-stairs-card"
          style={{ height: STAIR_BASE + i * STAIR_STEP }}
        >
          <HeroNumber value={item.value} />
          {item.note ? <span className="cdp-step-stairs-note">{item.note}</span> : null}
        </div>
      ))}
    </div>
  );
}
