import { createPrimitive } from "../factory";

/** 主角块（十六轮 F3 收编 S1 marker-block）：4px 墨框 + 24px 双层硬阴影 + padding 32/48。
    variants: plain（cream 底墨字）/ accent（accent-2 pink 底 cream 字——S1 用 accent） */
export const MarkerBlock = createPrimitive("marker-block", {
  tag: "div",
  variants: ["plain", "accent"],
  defaultVariant: "plain",
});
