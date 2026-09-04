import { describe, expect, it } from "vitest";
import { lintComponentCss } from "./contract-lint";

describe("组件契约 lint（§6.4 缺点 4 物理隔离 + §11.1 #9）", () => {
  it("组件 CSS 零违规（禁裸色/禁裸字体/禁裸动画时长）", () => {
    expect(lintComponentCss()).toEqual([]);
  });
});
