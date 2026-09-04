import { createPrimitive } from "../factory";

/** 舞台留白容器（§5.1 --stage-pad-x/y 的消费端，v1 由主题内部固定） */
export const StagePad = createPrimitive("stage-pad", {
  tag: "div",
  variants: ["default"],
  defaultVariant: "default",
});
