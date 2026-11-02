import type { CSSProperties } from "react";
import { Card } from "./Card";
import { Kicker } from "../text/Kicker";
import { BodyCopy } from "../text/BodyCopy";

/** 流程步骤卡（S06 四步流程收编）：大 mono 序号 + Kicker 标题 + 描述一句。
    tone → 卡体配色：cream / pink（accent-2 墨字）/ yellow（accent-4 墨字）/ green（accent-1 cream 字）。
    高度等构图属性（height 320）留消费端 style——组件只管卡内排版。 */

export interface StepCardProps {
  /** 大 mono 序号（"01" 式） */
  index: string;
  title: string;
  desc: string;
  tone: "cream" | "pink" | "yellow" | "green";
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** tone → CSS 类（组件 CSS 以 token 语义命名：accent-N 映射进 CSS——零色名词进样式表；
    cream = 卡体原色，无附加类） */
const TONE_CLASS: Record<StepCardProps["tone"], string> = {
  cream: "",
  pink: "cdp-step-card-accent-2",
  yellow: "cdp-step-card-accent-4",
  green: "cdp-step-card-accent-1",
};

export function StepCard({ index, title, desc, tone, className = "", style, ...rest }: StepCardProps) {
  return (
    <Card
      variant={tone === "green" ? "accent" : "plain"}
      className={`cdp-step-card ${TONE_CLASS[tone]} ${className}`.trim()}
      style={style}
      data-testid={rest["data-testid"]}
    >
      <span className="cdp-step-card-index">{index}</span>
      <Kicker variant="plain" className="cdp-step-card-title">{title}</Kicker>
      <BodyCopy className="cdp-step-card-desc">{desc}</BodyCopy>
    </Card>
  );
}
