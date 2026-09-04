import { createPrimitive } from "../factory";

/** 小标签（章节号/栏目名）。variants: block（墨底白字方标）/ pill（胶囊） */
export const Kicker = createPrimitive("kicker", {
  tag: "div",
  variants: ["block", "pill"],
  defaultVariant: "block",
});
