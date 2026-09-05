import { describe, expect, it } from "vitest";
import { REQUIRED_TOKENS, validateTheme } from "./theme-validate";

const VALID_CSS = `:root {
  --surface: #fff; --surface-2: #eee; --surface-3: #111;
  --text: #111; --text-2: #444; --text-mute: #777; --text-faint: #aaa;
  --accent-1: #c00; --rule: #111; --shell: #000;
  --shadow-card: 0 0 0 #000; --shadow-card-sm: 0 0 0 #000; --shadow-stage: 0 0 0 #000;
  --t-display-1: 1px; --t-display-2: 1px; --t-h1: 1px; --t-h2: 1px;
  --t-h3: 1px; --t-body: 1px; --t-label: 1px;
  --space-1: 1px; --space-2: 1px; --space-3: 1px; --space-4: 1px;
  --space-5: 1px; --space-6: 1px; --grid-gutter: 1px;
  --dur-fast: 1ms; --dur-mid: 1ms; --dur-slow: 1ms;
  --ease-in: linear; --ease-out: linear; --ease-emph: linear; --stagger: 1ms;
  --card-bg: #fff; --card-border: 0; --card-radius: 0px; --r-card: 0px;
  --r-pill: 0px; --border-w: 1px;
  --table-border: 0; --table-head-bg: #fff; --table-head-text: #fff; --table-zebra: #fff;
  --rule-w: 1px; --rule-style: solid;
  --badge-bg: #fff; --badge-text: #000;
  --hero-num-font: serif; --hero-num-weight: 400; --hero-num-track: 0em;
  --decor-family: dot;
  --caption-bg: #fff; --caption-stroke: #000; --caption-text: #000; --caption-radius: 0px; --caption-size: 1px;
  --font-display-cn: sans-serif; --font-display-en: sans-serif;
  --font-body: sans-serif; --font-mono: monospace;
  --stage-pad-x: 1px; --stage-pad-y: 1px;
}`;

describe("主题校验器", () => {
  it("必填 token 全定义时通过（errors 空）", () => {
    const r = validateTheme(VALID_CSS, { name: "t", mood: "x" });
    expect(r.errors).toEqual([]);
  });

  it("缺任一必填 token 报错并点名", () => {
    const css = VALID_CSS.replace("--accent-1: #c00;", "");
    const r = validateTheme(css, { name: "t" });
    expect(r.errors).toContain("缺少必填 token: --accent-1");
  });

  it("var() 引用 ⊆ 主题定义：未定义引用报错并点名", () => {
    const r = validateTheme(VALID_CSS, { name: "t" }, ["--not-defined-anywhere"]);
    expect(r.errors.some((e) => e.includes("--not-defined-anywhere"))).toBe(true);
  });

  it("合法 var() 引用不报错", () => {
    const r = validateTheme(VALID_CSS, { name: "t" }, ["--accent-1", "--t-h1"]);
    expect(r.errors).toEqual([]);
  });

  it("theme.json 缺 name 报错", () => {
    const r = validateTheme(VALID_CSS, {});
    expect(r.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("REQUIRED_TOKENS 覆盖设计 16+ 必填", () => {
    expect(REQUIRED_TOKENS.length).toBeGreaterThanOrEqual(16);
    expect(REQUIRED_TOKENS).toContain("--accent-1");
    expect(REQUIRED_TOKENS).toContain("--dur-fast");
    expect(REQUIRED_TOKENS).toContain("--decor-family");
    // 终审 I-1：表头文字语义 token（墨底表头需奶油文字）
    expect(REQUIRED_TOKENS).toContain("--table-head-text");
  });
});
