import { createPrimitive } from "../_internal/factory";

/** 主角块（十六轮 F3 收编 S1 marker-block）：4px 墨框 + 24px 双层硬阴影 + padding 32/48。
    variants: plain（cream 底墨字）/ accent（accent-2 pink 底 cream 字）/ invert（surface-3 墨底 cream 字——
    二十二轮 F1 封面主角块用墨底，符合主题墨线语言；规则：封面/主角卡片主色不用粉红） */
export const MarkerBlock = createPrimitive("marker-block", {
  tag: "div",
  variants: ["plain", "accent", "invert"],
  defaultVariant: "plain",
});
