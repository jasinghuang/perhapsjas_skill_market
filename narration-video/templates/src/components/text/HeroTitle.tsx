import { createPrimitive } from "../factory";

/** 大标题（§6.2 文字组）。variants: plain（字阶直排）/ stamp（墨底白字印戳式硬阴影） */
export const HeroTitle = createPrimitive("hero-title", {
  tag: "h1",
  variants: ["plain", "stamp"],
  defaultVariant: "plain",
});
