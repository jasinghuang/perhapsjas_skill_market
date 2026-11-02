import type { CSSProperties } from "react";
import { NumberPill } from "../text/NumberPill";
import { Kicker } from "../text/Kicker";
import { BodyCopy } from "../text/BodyCopy";
import { DeltaText } from "../text/DeltaText";

/** 数据列条目（S24 亮点/经营数据两列共用收编）：accent 序号药丸 + 标题 + 一句描述。
    标题/描述过 DeltaText——文本内涨跌片段自动涨橙跌绿（24 轮 A股规则）。
    字号对 token：标题 --t-h3、描述 --t-body（与现状 34/24 的微差以 token 合规为准——报告记录在案）。 */

export interface DataItemRowProps {
  /** 序号（"01" 式，NumberPill accent） */
  index: string;
  title: string;
  desc: string;
  /** 序号药丸 testid（消费端审计钩子） */
  pillTestid?: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function DataItemRow({ index, title, desc, pillTestid, className = "", style, ...rest }: DataItemRowProps) {
  return (
    <div className={`cdp-data-item ${className}`.trim()} style={style} data-testid={rest["data-testid"]}>
      <NumberPill number={index} variant="accent" data-testid={pillTestid} />
      <div className="cdp-data-item-body">
        <Kicker variant="plain" className="cdp-data-item-title">
          <DeltaText text={title} />
        </Kicker>
        <BodyCopy className="cdp-data-item-desc">
          <DeltaText text={desc} />
        </BodyCopy>
      </div>
    </div>
  );
}
