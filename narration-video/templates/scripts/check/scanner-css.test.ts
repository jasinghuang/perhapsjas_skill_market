import { describe, expect, it } from "vitest";
import { scanChapterCss } from "./scanner-css";

describe("章节层 CSS 扫描器", () => {
  it("非空护栏：输入 css 数组非空才扫描，空数组报错", () => {
    expect(() => scanChapterCss([])).toThrow();
  });

  it("负样本：裸色/裸字体/裸时长/渐变/emoji/小字号全命中", () => {
    const r = scanChapterCss([{
      path: "chapters/01/x.css",
      css: `color: #f00; font-family: Arial; animation-duration: 2s; background: linear-gradient(#f0f, #00f); /* 😀 */ font-size: 20px;`,
    }]);
    const rules = r.map((f) => f.rule);
    expect(rules).toContain("禁硬编码色");
    expect(rules).toContain("禁硬编码字体");
    expect(rules).toContain("禁裸动画时长");
    expect(rules).toContain("禁裸紫粉渐变");
    expect(rules).toContain("禁emoji");
    // brief 笔误修正：rules 是 string[]，f.rule 恒 undefined，须在 r（Finding[]）上断言
    expect(r.some((f) => f.rule === "最小字号" && f.severity === "warning")).toBe(true);
  });

  it("false-positive：token 化渐变/var() 颜色/合法字阶/white-black 全通过", () => {
    const r = scanChapterCss([{
      path: "chapters/01/x.css",
      css: `color: var(--text); background: var(--gradient-brand); font-family: var(--font-body); color: white; color: black; font-size: var(--t-h3);`,
    }]);
    expect(r).toEqual([]);
  });

  it("字阶成员校验：28px 在阶内通过、29px 不在阶内 warning", () => {
    const inScale = scanChapterCss([{ path: "c.css", css: "font-size: 28px;" }]);
    expect(inScale.filter((f) => f.rule === "字阶成员")).toHaveLength(0);
    const outScale = scanChapterCss([{ path: "c.css", css: "font-size: 29px;" }]);
    expect(outScale.some((f) => f.rule === "字阶成员" && f.severity === "warning")).toBe(true);
  });

  // Interfaces 段列有 #5b（间距 px ∈ --space，warning），brief 测试块未覆盖——补充钉住
  it("间距成员校验：24/8/16px ∈ --space 通过、10px 不在集合 warning（#5b）", () => {
    const ok = scanChapterCss([{ path: "c.css", css: "margin: 24px; padding: 8px 16px; gap: 0;" }]);
    expect(ok.filter((f) => f.rule === "间距成员")).toHaveLength(0);
    const bad = scanChapterCss([{ path: "c.css", css: "margin: 10px;" }]);
    expect(bad.some((f) => f.rule === "间距成员" && f.severity === "warning")).toBe(true);
  });
});
