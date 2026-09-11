import { createPrimitive } from "../factory";

/** 错峰入场行包装（S08 竖屏素材行收编；十二轮 F3 语义）：factory stagger 原语对直接子元素
    逐个错峰 reveal（铁律 5——逐子延迟，delay 语义正确）；子元素 mount 时固定。
    布局（display/gap 等行构图）与 reveal/duration/stagger 档由消费端 props/style 提供。 */
export const StaggerRow = createPrimitive("stagger-row", {
  tag: "div",
  variants: ["default"],
  defaultVariant: "default",
});
