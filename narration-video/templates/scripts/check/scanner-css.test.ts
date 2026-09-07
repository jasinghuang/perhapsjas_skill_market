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

// 评审回归钉死（修复 commit 追加）：核心色规则切分漏检 + 注释/选择器误报
describe("章节层 CSS 扫描器 · 核心可靠性", () => {
  it("Finding 1：单行规则 .x { color: #f00; } 命中禁硬编码色", () => {
    const r = scanChapterCss([{ path: "c.css", css: ".x { color: #f00; }" }]);
    expect(r.some((f) => f.rule === "禁硬编码色" && f.severity === "blocker")).toBe(true);
  });

  it("Finding 2：/* pink */ 注释不误报禁硬编码色", () => {
    const r = scanChapterCss([{ path: "c.css", css: "/* pink 强调 */" }]);
    expect(r).toEqual([]);
  });

  it("Finding 2：.purple-card / #gold 选择器（inline 与 Allman 换行）不误报", () => {
    const inline = scanChapterCss([{ path: "c.css", css: ".purple-card { color: var(--text); }" }]);
    expect(inline).toEqual([]);
    const allman = scanChapterCss([{ path: "c.css", css: ".purple-card" }]);
    expect(allman).toEqual([]);
    const id = scanChapterCss([{ path: "c.css", css: "#gold" }]);
    expect(id).toEqual([]);
  });

  it("Finding 2：注释内 font-family / font-size 不误报", () => {
    const r = scanChapterCss([{ path: "c.css", css: "/* font-family: Arial; font-size: 20px; */" }]);
    expect(r).toEqual([]);
  });

  it("多行注释跨行不误报（剥离状态机）", () => {
    const r = scanChapterCss([{ path: "c.css", css: "/* 注释开始\npink 说明\n*/" }]);
    expect(r).toEqual([]);
  });

  it("white/black hex 形式豁免（#fff/#000/#FFF）", () => {
    const r = scanChapterCss([{ path: "c.css", css: "color: #fff; background: #000; border-color: #FFF;" }]);
    expect(r).toEqual([]);
  });

  it("var(--purple-500) 引用不误报命名色", () => {
    const r = scanChapterCss([{ path: "c.css", css: "color: var(--purple-500);" }]);
    expect(r).toEqual([]);
  });

  it("rgba(0,0,0,.35) 裸值仍为 blocker（white/black 豁免不覆盖 rgba）", () => {
    const r = scanChapterCss([{ path: "c.css", css: "box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);" }]);
    expect(r.some((f) => f.rule === "禁硬编码色" && f.severity === "blocker")).toBe(true);
  });

  it("font-size: 24px 边界通过（V4 下限 + 字阶成员双重豁免）", () => {
    const r = scanChapterCss([{ path: "c.css", css: "font-size: 24px;" }]);
    expect(r).toEqual([]);
  });
});

// 终审修复回归钉死：I-1（animation/transition 缩写时长 + CSS 侧 infinite）与
// M-1（全量 CSS 命名色表）。
describe("章节层 CSS 扫描器 · 终审修复（I-1 / M-1）", () => {
  it("负样本：animation/transition 缩写值内裸时长各命中禁裸动画时长 blocker（I-1）", () => {
    const r = scanChapterCss([{
      path: "c.css",
      css: "animation: spin 2s linear infinite;\ntransition: all 300ms ease;",
    }]);
    expect(r.filter((f) => f.rule === "禁裸动画时长" && f.severity === "blocker")).toHaveLength(2);
  });

  it("负样本：animation 缩写含 infinite / animation-iteration-count: infinite 各命中禁无限循环动画 blocker（I-1）", () => {
    const r = scanChapterCss([{
      path: "c.css",
      css: "animation: spin 2s linear infinite;\nanimation-iteration-count: infinite;",
    }]);
    expect(r.filter((f) => f.rule === "禁无限循环动画" && f.severity === "blocker")).toHaveLength(2);
  });

  it("false-positive：缩写 token 化时长 / 有限迭代 / 带数字 keyframe 名全部通过（I-1）", () => {
    const r = scanChapterCss([{
      path: "c.css",
      css: [
        "animation: var(--dur-mid) var(--ease-out);",
        "animation-iteration-count: 3;",
        "transition: var(--dur-fast) ease;",
        "animation: spin2 var(--dur-mid);",
      ].join("\n"),
    }]);
    expect(r).toEqual([]);
  });

  it("负样本：navy/teal 全量命名色表命中禁硬编码色 blocker（M-1）", () => {
    const r = scanChapterCss([{ path: "c.css", css: "color: navy;\nbackground: teal;" }]);
    expect(r.filter((f) => f.rule === "禁硬编码色" && f.severity === "blocker")).toHaveLength(2);
  });

  it("false-positive：--teal-500 token 名与 var(--teal-500) 引用不误报（M-1）", () => {
    const r = scanChapterCss([{ path: "c.css", css: "--teal-500: var(--ink); color: var(--teal-500);" }]);
    expect(r).toEqual([]);
  });
});
