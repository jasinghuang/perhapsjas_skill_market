// Before / After 分屏对比（§6.2 结构组；十九轮 F4 收编——原 showcase S13 双 Card + 中缝圆章拼装组件化）。
// 单一整体面板：4px 墨框 + 24px 双层硬阴影；内部两半 grid 1fr 1fr 直接相接（无中缝线）；
// 左半 cream-2 底（before 条目颜色消费 --split-before-text，默认墨色——showcase 以 scope 覆写为灰语义）；
// 右半 accent-1 绿底 + cream 条目右对齐；中央 absolute VS 圆章（pink 圆 140px + 4px 墨框 + cream 大字 + 24px 墨硬阴影）压交界。
import type { CSSProperties } from "react";

export interface SplitCompareProps {
  /** 左半条目（before——灰色语义由 --split-before-text 消费端决定） */
  before: string[];
  /** 右半条目（after——cream 色右对齐） */
  after: string[];
  beforeTitle?: string;
  afterTitle?: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function SplitCompare({
  before,
  after,
  beforeTitle = "BEFORE",
  afterTitle = "AFTER",
  className = "",
  style,
  ...rest
}: SplitCompareProps) {
  return (
    <div className={`cdp-split-compare ${className}`} style={style} data-testid={rest["data-testid"]}>
      <div className="cdp-split-compare-half cdp-split-compare-before">
        <div className="cdp-split-compare-title">{beforeTitle}</div>
        <ul className="cdp-split-compare-list">
          {before.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="cdp-split-compare-half cdp-split-compare-after">
        <div className="cdp-split-compare-title">{afterTitle}</div>
        <ul className="cdp-split-compare-list">
          {after.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="cdp-split-compare-seal" aria-hidden="true">
        VS
      </div>
    </div>
  );
}
