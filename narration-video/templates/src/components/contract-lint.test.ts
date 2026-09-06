import { describe, expect, it } from "vitest";
import { COMPONENT_CSS, lintComponentCss, lintCssText } from "./contract-lint";

describe("组件契约 lint（§6.4 缺点 4 物理隔离 + §11.1 #9）", () => {
  it("组件 CSS 零违规（禁裸色/禁裸字体/禁裸动画时长）", () => {
    expect(lintComponentCss()).toEqual([]);
  });

  // 终审 C1 护栏：vitest 下 `?raw` 曾因 test.css 缺省(false)被 stub 成空串，
  // lint 扫 30 个空串恒绿。此测试钉住「每份组件 CSS 真实文本非空」，
  // 且必须恰好 30 份（28 + 十轮 F3/F4 收编 StackedBlocks / NumberPill，磁盘实数为准）——
  // 杜绝假绿复现（§6.4 缺点 4 物理隔离）。
  it("护栏：30 份组件 CSS 的 ?raw 文本全部非空（防 lint 假绿）", () => {
    expect(COMPONENT_CSS.length).toBe(30);
    for (const { file, css } of COMPONENT_CSS) {
      expect(css.length, `?raw 为空串：${file}（test.css 未开启？）`).toBeGreaterThan(0);
    }
  });
});

describe("lintCssText 纯函数（终审 Recommendation 2：负样本钉住 lint 规则核心）", () => {
  it("负样本：裸色值命中违规", () => {
    const violations = lintCssText("color: #f00;", "t.css");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("t.css:1");
  });

  it("负样本：裸 font-family 命中违规", () => {
    const violations = lintCssText("font-family: Arial;", "t.css");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("t.css:1");
  });

  it("负样本：裸 animation-duration 命中违规", () => {
    const violations = lintCssText("animation-duration: 2s;", "t.css");
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("t.css:1");
  });

  it("正样本：var(--text) 走 token，零违规", () => {
    expect(lintCssText("color: var(--text);", "t.css")).toEqual([]);
  });

  it("正样本：var 走 token 的字体/时长声明零违规", () => {
    expect(
      lintCssText(
        "font-family: var(--font-body);\nanimation-duration: var(--dur-mid);",
        "t.css",
      ),
    ).toEqual([]);
  });

  it("逐行定位：违规行号正确", () => {
    const violations = lintCssText("color: var(--text);\nbackground: #000;", "t.css");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("t.css:2");
  });
});

describe("lintComponentCss 与 lintCssText 等价（重构护栏）", () => {
  it("lintComponentCss === 遍历 COMPONENT_CSS 调 lintCssText 的并集", () => {
    const direct = COMPONENT_CSS.flatMap(({ file, css }) => lintCssText(css, file));
    expect(lintComponentCss()).toEqual(direct);
  });
});
