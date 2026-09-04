import { createPrimitive } from "../factory";

/** 卡片（§5.1 --card-* 的消费端）。variants: plain / invert（反色）/ accent（强调底） */
export const Card = createPrimitive("card", {
  tag: "div",
  variants: ["plain", "invert", "accent"],
  defaultVariant: "plain",
});
