import { describe, expect, it } from "vitest";
import { COMPONENT_CSS, lintCdpPrefix, lintComponentCss, lintCssText } from "./contract-lint";

describe("组件契约 lint（§6.4 缺点 4 物理隔离 + §11.1 #9）", () => {
  it("组件 CSS 零违规（禁裸色/禁裸字体/禁裸动画时长）", () => {
    expect(lintComponentCss()).toEqual([]);
  });

  // 终审 C1 护栏：vitest 下 `?raw` 曾因 test.css 缺省(false)被 stub 成空串，
  // lint 扫空串恒绿。此测试钉住「每份组件 CSS 真实文本非空」，
  // 且必须恰好 44 份（36 + 三十四轮 M2b 收编 8 内部件，磁盘实数为准）——
  // 杜绝假绿复现（§6.4 缺点 4 物理隔离）。
  it("护栏：44 份组件 CSS 的 ?raw 文本全部非空（防 lint 假绿）", () => {
    expect(COMPONENT_CSS.length).toBe(44);
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
  it("lintComponentCss === 遍历 COMPONENT_CSS 调 lintCssText + lintCdpPrefix 的并集", () => {
    const direct = COMPONENT_CSS.flatMap(({ file, css }) => [
      ...lintCssText(css, file),
      ...lintCdpPrefix(css, file),
    ]);
    expect(lintComponentCss()).toEqual(direct);
  });
});

describe("lintCdpPrefix 类名前缀门禁（§6.4 缺点 4 物理隔离的类名侧）", () => {
  it("负样本：裸元素选择器「div」命中", () => {
    const v = lintCdpPrefix("div {\n  color: red;\n}\n", "t.css");
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("t.css:1");
    expect(v[0]).toContain("div");
  });

  it("负样本：非 cdp 类名「.other-class」命中", () => {
    const v = lintCdpPrefix(".other-class {\n  color: red;\n}\n", "t.css");
    expect(v).toHaveLength(1);
    expect(v[0]).toContain(".other-class");
  });

  it("负样本：多行逗号选择器里夹带裸类名 → 只命中违规片段 + 行号定位", () => {
    const v = lintCdpPrefix(".cdp-a,\n.sneaky {\n  color: red;\n}\n", "t.css");
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("t.css:2");
    expect(v[0]).toContain(".sneaky");
  });

  it("正样本：.cdp-x / 后代选择器 / 多行逗号选择器通过", () => {
    expect(lintCdpPrefix(".cdp-x {\n  color: var(--text);\n}\n", "t.css")).toEqual([]);
    expect(lintCdpPrefix(".cdp-x > .cdp-y {\n  color: var(--text);\n}\n", "t.css")).toEqual([]);
    expect(lintCdpPrefix(".cdp-a,\n.cdp-b {\n  color: var(--text);\n}\n", "t.css")).toEqual([]);
  });

  it("正样本：块注释与行尾注释不参与判定（行号仍准）", () => {
    expect(lintCdpPrefix("/* div { color: red; } */\n.cdp-x {\n  color: var(--text); /* .nope { } */\n}\n", "t.css")).toEqual([]);
    const v = lintCdpPrefix("/* div { } */\ndiv {\n  color: red;\n}\n", "t.css");
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("t.css:2");
  });

  it("正样本：@media 前导不判定、内部规则照查；@keyframes 内部整体跳过", () => {
    expect(lintCdpPrefix("@media (min-width: 800px) {\n.cdp-x {\n  color: var(--text);\n}\n}\n", "t.css")).toEqual([]);
    const v = lintCdpPrefix("@media (min-width: 800px) {\n.bare {\n  color: red;\n}\n}\n", "t.css");
    expect(v).toHaveLength(1);
    expect(v[0]).toContain(".bare");
    expect(lintCdpPrefix("@keyframes spin {\nfrom {\n  opacity: 0;\n}\nto {\n  opacity: 1;\n}\n}\n", "t.css")).toEqual([]);
  });

  it("负样本：声明的值里出现花括号不误判（声明体只累积、遇 } 重置）", () => {
    expect(lintCdpPrefix(".cdp-x {\n  color: var(--text);\n}\n.cdp-y {\n  color: var(--text-2);\n}\n", "t.css")).toEqual([]);
  });

  it("回归护栏：真实 44 份组件 CSS 零违规（现库全 .cdp-* 前缀）", () => {
    const all = COMPONENT_CSS.flatMap(({ file, css }) => lintCdpPrefix(css, file));
    expect(all).toEqual([]);
  });
});
