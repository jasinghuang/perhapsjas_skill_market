import { createPrimitive } from "../factory";

/** 引用块。variants: rule（左粗条）/ block（强调色底块） */
export const QuoteBlock = createPrimitive("quote-block", {
  tag: "blockquote",
  variants: ["rule", "block"],
  defaultVariant: "rule",
});
