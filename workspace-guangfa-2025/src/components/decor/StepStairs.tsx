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

/** 阶梯基数与步进（三十轮 F1 规格重算）：卡内安全边距 = 四周统一 var(--space-3) 24px（文字内容对卡内缘
    最小留空；顶部 = 橙条 14px + 24px 预留，左右下 = 24px——CSS 内同值）。
    内容自然高 = 数字行盒 91.2（--t-display-2 96px × 0.95）+ gap 8（--space-1）+ 注 24（--t-label 单行）；
    最短卡所需高 = 4 框 + 38 顶 + 91.2 + 8 + 24 + 24 底 + 4 框 = 193.2 → 基数取 200（内容底距卡底实测 30.8 ≥ 24）。
    卡高序列 200/240/280（步进 40 保持），底缘共线 + 顶部阶梯轮廓（左低右高）。 */
export const STAIR_BASE = 200;
export const STAIR_STEP = 40;

/** 阶梯卡组（二十五轮 F4 收编；二十九轮 F4 v4 重设计；三十轮 F1 安全边距规格 + 卡高重算）。
    删除 NumberPill 序号与卡间上升箭头（v3 保留）；卡内 = 顶部 accent-3 橙条（14px，贴卡内上缘、4px 墨框内）
    + HeroNumber 值 + mono 注（文字经 padding-top 预留向下避让橙条）。
    "上升"感用卡片高度表达：三卡位置高度一致（同一水平线，不再错落）、卡高逐级递增 200/240/280
    （底部对齐、顶部阶梯轮廓——左低右高）。
    三十轮 F1 规格：卡内安全边距四周统一 var(--space-3) 24px（顶部 = 橙条 14 + 24）——最矮卡
    内容底距卡底 ≥ 24px（含注自然行数），高度序列按内容需要重算（见 STAIR_BASE/STAIR_STEP）。
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
