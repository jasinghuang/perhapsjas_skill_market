import { createPrimitive } from "../_internal/factory";

/** 正文。variants: plain / lede（大号导语） */
export const BodyCopy = createPrimitive("body-copy", {
  tag: "p",
  variants: ["plain", "lede"],
  defaultVariant: "plain",
});
