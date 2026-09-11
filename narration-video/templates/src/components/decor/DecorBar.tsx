import { createPrimitive } from "../_internal/factory";

/** 装饰色条。variants: solid（墨色）/ accent（强调色） */
export const DecorBar = createPrimitive("decor-bar", {
  tag: "span",
  variants: ["solid", "accent"],
  defaultVariant: "solid",
});
