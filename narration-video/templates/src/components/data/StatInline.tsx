import type { CSSProperties } from "react";
import { HeroNumber } from "./HeroNumber";
import { Kicker } from "../text/Kicker";

export interface StatInlineProps {
  /** HeroNumber 大数字（--t-display-2，HeroNumber 同款字阶） */
  value: string;
  /** Kicker 标签（pill 药丸变体——与大数字同一行，右对齐贴卡右缘） */
  label: string;
  /** 描述一句（--t-body 28px + font-weight 600 + 墨色——仅加粗，无底色框；左对齐、紧贴大数字下） */
  desc: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** 统计内联卡（二十九轮 F1 新建——BY THE NUMBERS 专用；S15 KEY METRICS 保持 StatCell 绿底块不动。
    三十轮 F2 v2 编排协调）。
    结构 = 首行（HeroNumber 大数字左 + Kicker pill 药丸标签右——space-between 同行、药丸垂直居中对齐
    大数字行盒、标签右缘贴卡右缘）+ desc（600 加粗墨色、无底色框、左对齐）；无序号角标、无 delta。
    三十轮 F2 规格：标签 Kicker pill 变体（2px 墨框 999 圆角 + 8/16 衬垫——组件自身规格，零覆写）；
    数字→desc gap 收紧 --space-2 → --space-1（8px，desc 上移贴近大数字）；
    卡高 = 内容自然高 + 卡内安全边距 var(--space-3) 24px 四周（不再 space-between 拉伸）。
    格体 Card 风格（4px 墨框 + cream 底）零阴影——网格单元纪律。 */
export function StatInline({ value, label, desc, className = "", style, ...rest }: StatInlineProps) {
  return (
    <div className={`cdp-stat-inline ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
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
