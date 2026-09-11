import { createPrimitive } from "../_internal/factory";

export interface NumberPillProps {
  number: string;
  variant?: "plain" | "accent" | "invert";
  className?: string;
  "data-testid"?: string;
}

// Ruling P2-6：Base 在模块作用域
const Base = createPrimitive("number-pill", {
  tag: "span",
  variants: ["plain", "accent", "invert"],
  defaultVariant: "plain",
});

/** 药丸序号（十轮 F4 新组件）：999 圆角 pill + 2px 墨框（参考 topbar pill 的 2px 档）+ mono 数字。
    variants: plain（透明底墨字墨框）/ accent（accent-1 底 cream 字）/ invert（墨底 cream 字） */
export function NumberPill({ number, variant = "plain", ...rest }: NumberPillProps) {
  return (
    <Base variant={variant} className={rest.className} data-testid={rest["data-testid"]}>
      {number}
    </Base>
  );
}
