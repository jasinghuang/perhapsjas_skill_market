import { describe, expect, it } from "vitest";
import { scanChapterCss, tokenizeCss } from "./scanner-css";

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

// M3b 门禁可信度收紧：声明级状态机（K-10 跨行值不逃逸 / K-12 字符串内 /* 不置注释态）。
// 前两条为新增判别力用例（行级预处理下必红）；后三条为回退护栏（既有语义等价保留，必须绿）。
describe("章节层 CSS 扫描器 · 声明级状态机（M3b）", () => {
  it("跨行声明值：续行的裸色不逃逸（K-10）", () => {
    const css = `.cdp-x {\n  box-shadow:\n    4px 4px 0 rgba(0, 0, 0, 0.2);\n}`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    // 归属 = 声明起始行（stylelint 同款）：违规值在第 3 行，报告落在第 2 行
    expect(f.some((x) => x.rule === "禁硬编码色" && x.location === "a.css:2")).toBe(true);
  });

  it("字符串内的 /* 不置注释态：后续声明照常检查（K-12）", () => {
    const css = `.cdp-x {\n  content: "/*";\n  color: #ff0000;\n}`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    expect(f.some((x) => x.rule === "禁硬编码色" && x.location === "a.css:3")).toBe(true);
  });

  it("注释内的裸色仍不误报", () => {
    const css = `/* box-shadow: 0 0 0 rgba(0,0,0,.2); */\n.cdp-x { color: var(--ink); }`;
    expect(scanChapterCss([{ path: "a.css", css }])).toEqual([]);
  });

  it("选择器/规则头不参与色值判定（假阳性钉死——pink/orange/purple/gold 都在命名色表内）", () => {
    expect(scanChapterCss([{ path: "a.css", css: `.purple-card { color: var(--text); }` }])).toEqual([]);
    expect(scanChapterCss([{ path: "a.css", css: `.pink-card { background: var(--surface); }` }])).toEqual([]);
    expect(scanChapterCss([{ path: "a.css", css: `.orange-bar { color: var(--ink); }` }])).toEqual([]);
    expect(scanChapterCss([{ path: "a.css", css: `#gold { color: var(--ink); }` }])).toEqual([]);
  });

  it("tokenizeCss 非空护栏：空输入产出空数组（不抛）", () => {
    expect(tokenizeCss("")).toEqual([]);
  });

  // 接手实现者审读补钉（超出 brief 字面 5 用例，理由见 task-1-report「审读发现」）：
  // ① 行号逐字符跟随——段内多行注释的换行不得被漏计（重数段文本会少算注释里的换行）。
  it("声明起始行归属：段内多行注释的换行同样计数（行号跟随扫描，不重数段文本）", () => {
    const css = `.cdp-x {\n  /* 说明\n     续行 */\n  color: #ff0000;\n}`;
    expect(tokenizeCss(css).map((d) => d.line)).toEqual([4]);
    const f = scanChapterCss([{ path: "a.css", css }]);
    expect(f.filter((x) => x.rule === "禁硬编码色").map((x) => x.location)).toEqual(["a.css:4"]);
  });

  // ② 未闭合引号（CSS bad-string）不再吞掉文件余下全部内容：抑制面收窄到「下一个 token
  // 边界之前」——坏字符串里的 `;` 不构成边界，故该边界**可跨行**（不是"只吞到行末"）。
  it("未闭合字符串不再吞掉文件余下全部：下一个 token 边界之后照常检查（可跨行）", () => {
    const css = `.cdp-x {\n  content: "oops\n}\n.cdp-y { color: #ff0000; }`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    expect(f.filter((x) => x.rule === "禁硬编码色").map((x) => x.location)).toEqual(["a.css:4"]);
  });
});

// 修复轮 1（评审 I-1）：`(` 无界 + 字符串外转义未跳过 → 「括号深度永不为 0」的静默漏检面
// （与 K-12 同型：一处状态泄漏 ⇒ 后续全部边界失效 ⇒ 零 finding）。
describe("章节层 CSS 扫描器 · 修复轮 1（括号深度泄漏面）", () => {
  it("未闭合括号（@media 前导少一个 `)`）不吞掉后续声明：该报的裸色必须被报", () => {
    const css = `@media (min-width: 900px {\n.a { color: #f00; }\n}\n.b { color: #0f0; }`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    // 行级旧实现同输入报 a.css:2 + a.css:4——修复后不得回归为漏检
    expect(f.filter((x) => x.rule === "禁硬编码色").map((x) => x.location)).toEqual([
      "a.css:2",
      "a.css:4",
    ]);
  });

  it("选择器内的转义括号（`.foo\\(`，合法 CSS）不改变括号深度：整文件照常检查", () => {
    const css = `.foo\\( { color: #f00; }\n.bar { color: #0f0; }`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    expect(f.filter((x) => x.rule === "禁硬编码色").map((x) => x.location)).toEqual([
      "a.css:1",
      "a.css:2",
    ]);
  });
});

// 修复轮 1b（评审 ②）：`url()` 裸内容里的字面 `{` `}` 不得作 token 边界——内联 SVG data URI
// 被 `{` 切断后，碎片既不在 url() 内（URL_RE 剥不掉）又含裸色名 ⇒ blocker 级假阳性。
describe("章节层 CSS 扫描器 · 修复轮 1b（url() 内的字面括号不作边界）", () => {
  it("内联 SVG data URI（引号形态，含 `.x{fill:red}`）零 finding", () => {
    const css = `.cdp-x { background-image: url("data:image/svg+xml,<style>.x{fill:red}</style>"); }`;
    expect(scanChapterCss([{ path: "a.css", css }])).toEqual([]);
  });

  // 这一条才是本轮的真 RED：引号形态被字符串态意外保护，裸形态（CSS 合法）今天误报
  it("内联 SVG data URI（裸形态，含 `.x{fill:red}`）零 finding——不得把碎片当声明", () => {
    const css = `.cdp-x { background-image: url(data:image/svg+xml,<style>.x{fill:red}</style>); }`;
    expect(scanChapterCss([{ path: "a.css", css }])).toEqual([]);
  });

  // 反向护栏（防把门禁修软）：URL 态只吞 url() 内容，其后真实声明照常判且定位正确
  it("URL 态不吞后续声明：url() 之后的裸色仍被报且定位到第 2 行", () => {
    const css = `.cdp-x { background: url(a.svg); }\n.cdp-y { color: #ff0000; }`;
    expect(scanChapterCss([{ path: "a.css", css }])).toEqual([
      {
        rule: "禁硬编码色",
        severity: "blocker",
        location: "a.css:2",
        message: "裸色值（须走 var(--*) token，white/black 豁免）",
      },
    ]);
  });
});

// 修复轮 2（复审 F）：URL 态无重锚点 → 未闭合 `url(` 的 urlDepth 永不为 0 → 之后所有边界
// 失效 → 整文件零声明零 finding（与 I-1 同型的"畸形状态越界存活"）。终止条件：`)` / 空白 /
// 空内容里的结构 token（细则与取舍见 task-1-report「修复轮 2」）。
describe("章节层 CSS 扫描器 · 修复轮 2（URL 态终止条件）", () => {
  it("未闭合 url( 不吞掉后续声明（复审 F 向量）：该报的裸色必须被报且定位第 2 行", () => {
    const css = `@import url(a.css\n.b { color: #f00; }`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    // 父提交 2860a69 同输入报 a.css:2——修复后不得回归为漏检
    expect(f.filter((x) => x.rule === "禁硬编码色").map((x) => x.location)).toEqual(["a.css:2"]);
  });

  it("URL 态不跨行：`url(` 后紧跟换行同样退出（换行 = 行级重锚点）", () => {
    const css = `@import url(\n.b { color: #f00; }`;
    const f = scanChapterCss([{ path: "a.css", css }]);
    expect(f.filter((x) => x.rule === "禁硬编码色").map((x) => x.location)).toEqual(["a.css:2"]);
  });
});

// 修复轮 3（复审 N-1/N-2）：`url( … )` 的**前导/尾随空白是合法 CSS**（Chromium 实测
// `el.style.backgroundImage = "url( a/*b.png )"` 归一为合法 url），故空白不得终止 URL 态：
// 否则 url 内容里的字面 `/*` 会被当注释开头、吞掉其后全部（N-1，与 K-12 同型）；或空格一加
// 就让 1b 负样本回归假 blocker（N-2）。终止 = 配对 `)` ∪ 换行（`\n`/`\r`）∪ EOF
// ⇒ 不变量：URL 态最多存活到本行末。
describe("章节层 CSS 扫描器 · 修复轮 3（URL 态仅按换行/配对括号终止）", () => {
  it("N-1：url( a/*b.png ) 内的字面 `/*` 不得被当注释开头（后续声明必须仍被报）", () => {
    const css = `.a { background: url( a/*b.png ); }\n.b { color: #f00; /* 说明 */ }`;
    expect(scanChapterCss([{ path: "a.css", css }]).map((x) => x.location)).toEqual(["a.css:2"]);
    // 实务形态：`url( ../img/*.png )` / `url( icons/*.svg )` 同机制
    const practical = `.a { background: url( ../img/*.png ); }\n.b { color: #f00; }`;
    expect(scanChapterCss([{ path: "a.css", css: practical }]).map((x) => x.location)).toEqual([
      "a.css:2",
    ]);
  });

  it("N-1 变体：同段内 url 之后的真实声明照常检查（URL 态不得吞掉段内后续）", () => {
    const css = `.a { background: url( a/*b.png ); color: #f00; }`;
    expect(scanChapterCss([{ path: "a.css", css }]).map((x) => x.location)).toEqual(["a.css:1"]);
  });

  it("N-1 复审反例：url( x/*y ) 之后的行照常判（不得为漏）", () => {
    const css = `@import url( x/*y ); }\n.b { color: #f00; }`;
    expect(scanChapterCss([{ path: "a.css", css }]).map((x) => x.location)).toEqual(["a.css:2"]);
  });

  it("N-2：带空格的裸形态内联 SVG data URI 零 finding（1b 负样本的普通排版写法）", () => {
    const css = `.cdp-x { background-image: url( data:image/svg+xml,<style>.x{fill:red}</style> ); }`;
    expect(scanChapterCss([{ path: "a.css", css }])).toEqual([]);
  });
});
