import { createPrimitive } from "../_internal/factory";

/** 装饰圆点（发光强调点）。variants: plain / glow */
export const DecorDot = createPrimitive("decor-dot", {
  tag: "span",
  variants: ["plain", "glow"],
  defaultVariant: "plain",
});
