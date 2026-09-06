import { createPrimitive } from "../factory";

/** 小标签（章节号/栏目名）。variants: plain（透明底无衬垫，颜色继承——十三轮一致性收编）/ block（墨底白字方标）/ pill（胶囊） */
export const Kicker = createPrimitive("kicker", {
  tag: "div",
  variants: ["plain", "block", "pill"],
  defaultVariant: "block",
});
