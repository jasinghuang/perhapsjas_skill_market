import { createPrimitive } from "../_internal/factory";

/** 小标签（章节号/栏目名）。variants: plain（透明底无衬垫，颜色继承——十三轮一致性收编）/ block（墨底白字方标）/ pill（2px 墨框 999 圆角药丸——三十轮 F2 定 2px 框） */
export const Kicker = createPrimitive("kicker", {
  tag: "div",
  variants: ["plain", "block", "pill"],
  defaultVariant: "block",
});
