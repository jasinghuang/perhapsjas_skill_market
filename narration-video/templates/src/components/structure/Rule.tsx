import { createPrimitive } from "../_internal/factory";

/** 分割线（§5.1 --rule-w/--rule-style 的消费端）。variants: solid / dashed */
export const Rule = createPrimitive("rule", {
  tag: "hr",
  variants: ["solid", "dashed"],
  defaultVariant: "solid",
});
