/**
 * echarts-theme 测试：tokens.css → ECharts theme 主题生成器（Plan 4.5 收编 Task 1）。
 *
 * 双护栏：
 *  1. tokens 注入式可测（不 import echarts，纯字符串进出）；
 *  2. 真实 tokens.css 同源断言——主题改档门禁自动跟随，宁炸不假绿
 *     （与 token-scale.ts 同哲学；终审 C1 教训）。
 *
 * 文件路径：module 相对路径直指 src/theme/tokens.css（vitest jsdom 环境兼容，
 * 不用 new URL(rel, import.meta.url)——jsdom 全局 URL 会把 file: 解析成虚拟 origin）。
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildEchartsTheme } from "./echarts-theme";

/** FIXTURE_A：已知值主题（注释里埋假 --accent-1 色值，false-positive 护栏）。 */
const FIXTURE_A = `:root {
  /* --accent-1: #ff0000; 注释色值不得污染解析（false-positive 护栏） */
  --accent-1: #1f8a4c;
  --accent-2: #f06ca8;
  --accent-3: #e85a1f;
  --accent-4: #f5c518;
  --surface-2: #e4dcc4;
  --text-2: #2a2a2a;
  --rule: #0f0f0f;
  --font-body: "Space Grotesk", "Noto Sans SC", sans-serif;
}`;

/** FIXTURE_B：另一组已知值（换主题随动对照）。 */
const FIXTURE_B = `:root {
  --accent-1: #123456;
  --accent-2: #abcdef;
  --accent-3: #654321;
  --accent-4: #fedcba;
  --surface-2: #eeeeee;
  --text-2: #3b3b3b;
  --rule: #101010;
  --font-body: "JetBrains Mono", monospace;
}`;

/** 真实 tokens.css（同源护栏——主题改档门禁自动跟随）。 */
const TOKENS_CSS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../theme/tokens.css",
);
let realTokensCss: string;
try {
  realTokensCss = readFileSync(TOKENS_CSS_FILE, "utf8");
} catch (e) {
  throw new Error(
    `echarts-theme.test：无法读取 src/theme/tokens.css（${TOKENS_CSS_FILE}）——` +
      `宁炸不假绿（${e instanceof Error ? e.message : String(e)}）`,
  );
}

/** 从 css 中剔除某个 token 声明（缺失 token → throw 用例的构造器）。 */
function dropToken(css: string, token: string): string {
  return css.replace(new RegExp(`${token}\\s*:[^;]+;`), "");
}

describe("buildEchartsTheme 主题生成器（tokens 注入式）", () => {
  it("token 映射：color = 四强调色解析值（精确相等）", () => {
    const theme = buildEchartsTheme(FIXTURE_A);
    expect(theme.color).toEqual(["#1f8a4c", "#f06ca8", "#e85a1f", "#f5c518"]);
  });

  it("token 映射：textStyle.fontFamily = --font-body 去引号（含 Space Grotesk）", () => {
    const theme = buildEchartsTheme(FIXTURE_A);
    expect(theme.textStyle.fontFamily).toContain("Space Grotesk");
    // 引号已剥离：ECharts 接受裸 font-family 串
    expect(theme.textStyle.fontFamily).not.toMatch(/["']/);
  });

  it("token 映射：axisLine 墨色 = --rule；splitLine = --surface-2；legend = --text-2", () => {
    const theme = buildEchartsTheme(FIXTURE_A);
    expect(theme.axisLine.lineStyle.color).toBe("#0f0f0f");
    expect(theme.splitLine.lineStyle.color).toBe("#e4dcc4");
    expect(theme.legend.textStyle.color).toBe("#2a2a2a");
  });

  it("主题语言：backgroundColor transparent（容器背景由主题 CSS 承担）、borderRadius 0（零圆角）", () => {
    const theme = buildEchartsTheme(FIXTURE_A);
    expect(theme.backgroundColor).toBe("transparent");
    expect(theme.itemStyle.borderRadius).toBe(0);
  });

  it("换主题随动：注入另一组 tokens → 输出随动（两套 tokensCss 对照）", () => {
    const a = buildEchartsTheme(FIXTURE_A);
    const b = buildEchartsTheme(FIXTURE_B);
    expect(b.color).toEqual(["#123456", "#abcdef", "#654321", "#fedcba"]);
    expect(b.textStyle.fontFamily).toContain("JetBrains Mono");
    expect(b.axisLine.lineStyle.color).toBe("#101010");
    // 对照：两套输出不得雷同（防「恒等输出」假绿）
    expect(b.color).not.toEqual(a.color);
    expect(b.axisLine.lineStyle.color).not.toBe(a.axisLine.lineStyle.color);
    expect(b.textStyle.fontFamily).not.toBe(a.textStyle.fontFamily);
  });

  it.each([
    "--accent-1",
    "--accent-2",
    "--accent-3",
    "--accent-4",
    "--font-body",
    "--rule",
    "--surface-2",
    "--text-2",
  ])("缺失 token %s → throw（防假绿）", (token) => {
    expect(() => buildEchartsTheme(dropToken(FIXTURE_B, token))).toThrow(token);
  });

  it("空串/纯空白输入 → throw（非空护栏）", () => {
    expect(() => buildEchartsTheme("")).toThrow();
    expect(() => buildEchartsTheme("   \n\t  ")).toThrow();
  });

  it("token 存在但值为空 → throw（解析失败防假绿）", () => {
    const broken = FIXTURE_B.replace("--rule: #101010;", "--rule: ;");
    expect(() => buildEchartsTheme(broken)).toThrow("--rule");
  });

  it("false-positive 护栏：注释内色值不污染解析", () => {
    // FIXTURE_A 注释里埋了 --accent-1: #ff0000; ——解析结果必须仍是真实值
    const theme = buildEchartsTheme(FIXTURE_A);
    expect(theme.color[0]).toBe("#1f8a4c");
    expect(theme.color).not.toContain("#ff0000");
    // 纯注释（无任何真实 token）→ 全部缺失 → throw
    const onlyComments = "/* --accent-1: #ff0000; --rule: #0f0f0f; */";
    expect(() => buildEchartsTheme(onlyComments)).toThrow();
  });

  it("var() 间接引用解析（同 tokens.css 语义：--accent-1: var(--a1)）", () => {
    const css = `:root {
      --a1: #11aa22;
      --accent-1: var(--a1);
      --accent-2: #f06ca8;
      --accent-3: #e85a1f;
      --accent-4: #f5c518;
      --surface-2: #e4dcc4;
      --text-2: #2a2a2a;
      --rule: #0f0f0f;
      --font-body: "Space Grotesk", sans-serif;
    }`;
    expect(buildEchartsTheme(css).color[0]).toBe("#11aa22");
  });

  it("var() 引用缺失/循环 → throw（宁炸不假绿）", () => {
    const missing = FIXTURE_B.replace("--accent-1: #123456;", "--accent-1: var(--nope);");
    expect(() => buildEchartsTheme(missing)).toThrow("--nope");
    // 独立构造纯循环（不可用 replace 内联注入——FIXTURE_B 原 --accent-2 声明
    // 按 CSS 级联 last-wins 会覆盖注入的循环声明，循环被拆解而不 throw）
    const cyclic = `:root {
      --accent-1: var(--accent-2);
      --accent-2: var(--accent-1);
      --accent-3: #e85a1f;
      --accent-4: #f5c518;
      --surface-2: #e4dcc4;
      --text-2: #2a2a2a;
      --rule: #0f0f0f;
      --font-body: "Space Grotesk", sans-serif;
    }`;
    expect(() => buildEchartsTheme(cyclic)).toThrow();
  });
});

describe("真实 tokens.css 同源（主题改档门禁自动跟随）", () => {
  it("真实 tokens.css 可生成主题：四色精确相等、fontFamily 含 Space Grotesk、axisLine 墨", () => {
    const theme = buildEchartsTheme(realTokensCss);
    expect(theme.color).toEqual(["#1f8a4c", "#f06ca8", "#e85a1f", "#f5c518"]);
    expect(theme.textStyle.fontFamily).toContain("Space Grotesk");
    expect(theme.axisLine.lineStyle.color).toBe("#0f0f0f");
    expect(theme.splitLine.lineStyle.color).toBe("#e4dcc4");
    expect(theme.legend.textStyle.color).toBe("#2a2a2a");
  });

  it("护栏：真实 tokens.css 读取非空（防 ?raw/读取 stub 假绿）", () => {
    expect(realTokensCss.length).toBeGreaterThan(0);
  });
});
