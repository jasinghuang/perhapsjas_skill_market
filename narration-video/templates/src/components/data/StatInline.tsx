import type { CSSProperties } from "react";
import { HeroNumber } from "./HeroNumber";
import { Kicker } from "../text/Kicker";

export interface StatInlineProps {
  /** HeroNumber 大数字（--t-display-2，HeroNumber 同款字阶） */
  value: string;
  /** Kicker 标签（与大数字同一行，右对齐贴卡右缘） */
  label: string;
  /** 描述一句（--t-body 28px + font-weight 600 + 墨色——仅加粗，无底色框） */
  desc: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** 统计内联卡（二十九轮 F1 新建——BY THE NUMBERS 专用；S15 KEY METRICS 保持 StatCell 绿底块不动）。
    结构 = 首行（HeroNumber 大数字左 + Kicker 标签右——space-between 同基线，标签右缘贴卡右缘）
    + desc（600 加粗墨色、无底色框）；无序号角标、无 delta。
    格体 Card 风格（4px 墨框 + cream 底）零阴影——网格单元纪律；
    内衬紧凑 var(--space-3)（比 StatCell 的 --space-4 矮）。 */
export function StatInline({ value, label, desc, className = "", style, ...rest }: StatInlineProps) {
  return (
    <div className={`cdp-stat-inline ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      <div className="cdp-stat-inline-head">
        <HeroNumber value={value} />
        <Kicker variant="plain" className="cdp-stat-inline-label">
          {label}
        </Kicker>
      </div>
      <p className="cdp-stat-inline-desc">{desc}</p>
    </div>
  );
}
