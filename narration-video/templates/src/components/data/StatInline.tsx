import type { CSSProperties } from "react";
import { HeroNumber } from "./HeroNumber";
import { Kicker } from "../text/Kicker";

export interface StatInlineProps {
  /** HeroNumber 大数字（--t-display-2，HeroNumber 同款字阶） */
  value: string;
  /** Kicker 标签（pill 药丸变体——与大数字同一行，右对齐贴卡右缘；墨底白字药丸系组件内 CSS 定稿） */
  label: string;
  /** 描述一句（--t-body 28px + font-weight 400 + 墨色——不粗、无底色框；左对齐、与大数字间距 24px） */
  desc: string;
  /** 对角绿填充（三十一轮 F1 定稿）：true = accent-1 绿底 + cream 字（TL/BR 对角卡）；false = cream 底墨字 */
  filled?: boolean;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** 统计内联卡（二十九轮 F1 新建——BY THE NUMBERS 专用；S15 KEY METRICS 保持 StatCell 绿底块不动。
    三十轮 F2 v2 编排协调；三十一轮 F1 v3 定稿）。
    结构 = 首行（HeroNumber 大数字左 + Kicker pill 墨底白字药丸右——space-between 同行、药丸顶部与
    大数字顶部对齐（flex-start）、标签右缘贴卡右缘）+ desc（400 不粗墨色、无底色框、左对齐）；无序号角标、无 delta。
    三十一轮 F1 规格：filled 对角绿填充（accent-1 底 + cream 字——TL/BR 对角卡，经 --text 覆写贯通子件）；
    标签 pill 墨底白字（surface-3 墨底 + cream 字 + 999 圆角——组件内 CSS 定稿，token 化，零 dev 覆写）；
    数字→desc gap var(--space-3) 24px（三十轮 8px 的 3 倍）；desc 去粗 600 → 400；
    卡高 = 内容自然高 + 卡内安全边距 var(--space-4) 32px 四周（三十轮 24px 再高一点）。
    格体 Card 风格（4px 墨框 + cream 底）零阴影——网格单元纪律。 */
export function StatInline({
  value,
  label,
  desc,
  filled = false,
  className = "",
  style,
  ...rest
}: StatInlineProps) {
  return (
    <div
      className={`cdp-stat-inline${filled ? " cdp-stat-inline-filled" : ""} ${className}`.trim()}
      style={style}
      data-testid={rest["data-testid"]}
    >
      <div className="cdp-stat-inline-head">
        <HeroNumber value={value} />
        <Kicker variant="pill" className="cdp-stat-inline-label">
          {label}
        </Kicker>
      </div>
      <p className="cdp-stat-inline-desc">{desc}</p>
    </div>
  );
}
