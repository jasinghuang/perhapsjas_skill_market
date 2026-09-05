import { createPrimitive } from "../factory";

/** 装饰圆环。variants: outline（描边）/ filled（实心） */
export const DecorRing = createPrimitive("decor-ring", {
  tag: "span",
  variants: ["outline", "filled"],
  defaultVariant: "outline",
});
