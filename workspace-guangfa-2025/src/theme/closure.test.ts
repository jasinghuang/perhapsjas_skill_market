import { describe, expect, it } from "vitest";
import { COMPONENT_CSS, extractVarRefs } from "../components/contract-lint";
import { validateTheme } from "./theme-validate";
import tokensCss from "./tokens.css?raw";
import themeJson from "./theme.json";

// 终审 I2：token 闭合承诺此前无测试护栏。本文件钉住两条：
//  1) 真实 tokens.css + theme.json 通过校验器（含主题内部 var 闭合分支）；
//  2) 组件 CSS 的全部 var() 引用 ⊆ tokens.css 定义（组件与主题之间闭合）。

describe("token 闭合护栏（真实文件）", () => {
  it("真实 tokens.css + theme.json 通过 validateTheme（errors 空，含内部 var 闭合）", () => {
    const r = validateTheme(tokensCss, themeJson);
    expect(r.errors).toEqual([]);
  });

  it("组件 CSS 的全部 var() 引用 ⊆ tokens.css 定义", () => {
    const allCss = COMPONENT_CSS.map((e) => e.css).join("\n");
    const refs = extractVarRefs(allCss);
    // 护栏：引用集非空——若 ?raw 假绿为空串，此断言立刻失败
    expect(refs.length).toBeGreaterThan(0);
    const r = validateTheme(tokensCss, themeJson, refs);
    expect(r.errors).toEqual([]);
  });
});
