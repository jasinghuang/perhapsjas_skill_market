# M2a-1 Token 架构 + 组件库第一批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M1 引擎上落地三层 token 架构（基础/语义/动效，中性占位值）与组件库第一批（文字/数据/结构三组 14 个组件 + 组件工厂），带组件契约测试与双画布冒烟。

**Architecture:** 组件全部经 **createPrimitive 工厂**生产（变体类名 + token 驱动样式 + 动画预设走 M1 引擎 waapi/canvasAnim 注册表），每个组件 = 一个配置 + 一份 components/ 内 CSS（只消费 token，零裸值——契约测试机器执行）。主题值在 M2b 用 creative-mode 覆盖，本计划只用中性占位值验证契约。

**Tech Stack:** 继承 M1（Vite 5 + React 18.3.1 + TS 5.5 + Vitest 2 + jsdom）。

**Spec:** `../07-design-draft.md`（§5 token 契约、§6 组件库五铁律、§11.1 #9/#10 门禁条款）。

## Global Constraints

- **三层 token**：基础（色/字阶/间距阶/动效）→ 语义（卡片/表格/分割线/徽章/大数字/装饰语言/字幕）→ 组件 token（v1 留空位）（§5.1）
- **动效 token 数值化**：`--dur-fast/mid/slow` + `--ease-in/out/emph` + `--stagger`（§5.1）
- 强调色多槽位：`--accent-1` 必填、`--accent-2/3/4` 可选（§5.4 修正 1）；本计划只用 accent-1
- 装饰语言 `--decor-family` 六族：dot/bar/ring/polygon/block/stamp（§5.4 修正 2）
- **组件五铁律**（§6.1）：①动画必经引擎运行时（animationRuntime.waapi/canvasAnim）；②Canvas 走 draw(t) 帧函数；③章节层禁裸样式；④动画属性白名单（opacity/transform/色彩/clip-path/stroke-dashoffset——**白名单扩展裁定见下**）；⑤stagger 用逐子元素延迟动画实现（Ruling 8 后 seek 直接映射 currentTime，delay 语义正确）
- 每组件 **≥2 变体**、动画预设（fade/rise/wipe）走动效档位（§6.4 缺点 1）
- 组件样式只存在于 components/ 内、只消费 token（§6.4 缺点 4 物理隔离）；契约测试机器执行
- 主题校验：必填 token 全定义 + 章节/组件 var() 引用 ⊆ 主题定义（§11.1 #10）
- 组件卸载必须 dispose 动画注册（M1 终审 Recommendation）
- M2a 中性占位值只是契约验证载体，**不代表最终视觉**（M2b creative-mode 覆盖）

**计划裁定（执行时按此，执行后由控制器同步进设计文档）**：
- Ruling P2-1: 动画属性白名单扩展一项 **stroke-dashoffset**（DonutMeter 的 SVG 描边动画不触发重排，属安全表现属性；设计 §6.1 铁律 4 原文未列）。代价若错：无——SVG 表现属性动画与逐帧 seek 完全兼容。
- Ruling P2-2: 组件的 CSS 文件放 `components/<name>/<name>.css`，由 `components/index.ts` 统一 import——章节层永不直接引组件 CSS（物理隔离的落点）。
- Ruling P2-3: `--accent-2/3/4` 与 `--decor-family` 六族在 M2b 首套主题启用；本计划契约只校验槽位存在性（--accent-1 必填、--decor-family 必填）。

## File Structure（本计划新建）

```
narration-video/templates/src/
  theme/
    tokens.css              # 三层 token 骨架（中性占位值）
    theme.json              # 主题元数据（name/mood/描述）
    theme-validate.ts       # 主题校验器（必填 token 全定义 + var() 引用 ⊆ 定义）
  components/
    factory.tsx             # createPrimitive 组件工厂
    motion.ts               # 动效档位读取 + 预设 keyframes + reveal 挂载助手
    index.ts                # 组件统一导出（import 各组件 css）
    text/HeroTitle.tsx  text/HeroTitle.css   # 文字组
    text/Kicker.tsx     text/Kicker.css
    text/BodyCopy.tsx   text/BodyCopy.css
    text/QuoteBlock.tsx text/QuoteBlock.css
    data/HeroNumber.tsx data/HeroNumber.css  # 数据组
    data/Counter.tsx    data/Counter.css
    data/BarGrow.tsx    data/BarGrow.css
    data/DonutMeter.tsx data/DonutMeter.css
    data/StatCard.tsx   data/StatCard.css
    structure/Card.tsx  structure/Card.css    # 结构组
    structure/Rule.tsx  structure/Rule.css
    structure/Grid.tsx  structure/Grid.css
    structure/StagePad.tsx structure/StagePad.css
    structure/Table.tsx structure/Table.css
```

---

### Task 1: token 骨架 + 主题校验器

**Files:**
- Create: `narration-video/templates/src/theme/tokens.css`
- Create: `narration-video/templates/src/theme/theme.json`
- Create: `narration-video/templates/src/theme/theme-validate.ts`
- Test: `narration-video/templates/src/theme/theme-validate.test.ts`

**Interfaces:**
- Produces: `validateTheme(tokensCss: string, themeJson: unknown): { errors: string[] }`（errors 空 = 通过；本计划 M3a 门禁与 M2b 主题替换都会消费）；`REQUIRED_TOKENS: string[]`（必填清单）；tokens.css 的全部槽位（组件 CSS 消费）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/theme/theme-validate.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { REQUIRED_TOKENS, validateTheme } from "./theme-validate";

const VALID_CSS = `:root {
  --surface: #fff; --surface-2: #eee; --surface-3: #111;
  --text: #111; --text-2: #444; --text-mute: #777; --text-faint: #aaa;
  --accent-1: #c00; --rule: #111; --shell: #000;
  --shadow-card: 0 0 0 #000; --shadow-stage: 0 0 0 #000;
  --t-display-1: 1px; --t-display-2: 1px; --t-h1: 1px; --t-h2: 1px;
  --t-h3: 1px; --t-body: 1px; --t-label: 1px; --t-micro: 1px;
  --space-1: 1px; --space-2: 1px; --space-3: 1px; --space-4: 1px;
  --space-5: 1px; --space-6: 1px; --grid-gutter: 1px;
  --dur-fast: 1ms; --dur-mid: 1ms; --dur-slow: 1ms;
  --ease-in: linear; --ease-out: linear; --ease-emph: linear; --stagger: 1ms;
  --card-bg: #fff; --card-border: 0; --card-radius: 0px; --r-card: 0px;
  --r-pill: 0px; --border-w: 1px;
  --table-border: 0; --table-head-bg: #fff; --table-zebra: #fff;
  --rule-w: 1px; --rule-style: solid;
  --badge-bg: #fff; --badge-text: #000;
  --hero-num-font: serif; --hero-num-weight: 400; --hero-num-track: 0em;
  --decor-family: dot;
  --caption-bg: #000; --caption-text: #fff; --caption-radius: 0px; --caption-size: 1px;
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
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/theme/theme-validate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/theme/theme.json`：

```json
{
  "name": "m2a-neutral-placeholder",
  "nameZh": "中性占位（M2b 将替换为 creative-mode）",
  "mood": "契约验证用中性值，不代表最终视觉",
  "bestFor": "组件契约测试"
}
```

`narration-video/templates/src/theme/tokens.css`（中性占位值，结构即契约）：

```css
/* 三层 token 骨架（M2a 契约验证用中性占位值；M2b 覆盖为 creative-mode 值）。
   组件与章节只认变量名，不认值——本文件的结构是契约，值是皮肤。 */
:root {
  /* ── 基础 · 色 ── */
  --surface: #f7f5ef;
  --surface-2: #eeeae0;
  --surface-3: #1a1a1a;
  --text: #1a1a1a;
  --text-2: #55524a;
  --text-mute: #8a867c;
  --text-faint: #b5b1a6;
  /* 强调色多槽位（§5.4 修正 1）：accent-1 必填，2/3/4 可选（M2b 启用） */
  --accent-1: #c9501f;
  --accent-1-dark: #a33f16;
  --rule: #1a1a1a;
  --shell: #0b0b0b;

  /* ── 基础 · 阴影语言（支持偏移实色硬阴影，§5.4 修正 3） ── */
  --shadow-card: 6px 6px 0 rgba(26, 26, 26, 0.9);
  --shadow-stage: 0 8px 40px rgba(0, 0, 0, 0.35);

  /* ── 基础 · 字阶 ── */
  --t-display-1: 128px;
  --t-display-2: 96px;
  --t-h1: 72px;
  --t-h2: 56px;
  --t-h3: 40px;
  --t-body: 28px;
  --t-label: 24px;
  --t-micro: 18px;

  /* ── 基础 · 间距阶 ── */
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 48px;
  --space-6: 64px;
  --grid-gutter: 28px;

  /* ── 基础 · 动效（数值化，§5.1） ── */
  --dur-fast: 300ms;
  --dur-mid: 700ms;
  --dur-slow: 1400ms;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-emph: cubic-bezier(0.2, 0.9, 0.3, 1.2);
  --stagger: 120ms;

  /* ── 语义 · 卡片 ── */
  --card-bg: var(--surface);
  --card-border: 1px solid var(--text);
  --card-radius: 0px;
  --r-card: 0px;
  --r-pill: 999px;
  --border-w: 1px;

  /* ── 语义 · 表格 ── */
  --table-border: 1px solid var(--text);
  --table-head-bg: var(--surface-2);
  --table-zebra: var(--surface-2);

  /* ── 语义 · 分割线 ── */
  --rule-w: 2px;
  --rule-style: solid;

  /* ── 语义 · 徽章 ── */
  --badge-bg: var(--surface-3);
  --badge-text: var(--surface);

  /* ── 语义 · 大数字性格 ── */
  --hero-num-font: var(--font-display-en);
  --hero-num-weight: 900;
  --hero-num-track: -0.02em;

  /* ── 语义 · 装饰语言（六族：dot/bar/ring/polygon/block/stamp） ── */
  --decor-family: dot;

  /* ── 语义 · 字幕 ── */
  --caption-bg: rgba(10, 10, 10, 0.82);
  --caption-text: #f5f2ea;
  --caption-radius: 8px;
  --caption-size: 30px;

  /* ── 字体四坑位 ── */
  --font-display-cn: "PingFang SC", "Noto Sans SC", sans-serif;
  --font-display-en: "Archivo", "Arial Black", sans-serif;
  --font-body: "Space Grotesk", "PingFang SC", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;

  /* ── 舞台留白（v1 由主题内部固定、不对章节开放，§5.1） ── */
  --stage-pad-x: 96px;
  --stage-pad-y: 64px;
}
```

`narration-video/templates/src/theme/theme-validate.ts`：

```ts
// 主题校验器（§11.1 #10 的校验内核）：必填 token 全定义 + var() 引用 ⊆ 主题定义。
// M3a 门禁与本计划契约测试共用同一实现。

export const REQUIRED_TOKENS: string[] = [
  // 基础 · 色
  "--surface", "--surface-2", "--surface-3",
  "--text", "--text-2", "--text-mute", "--text-faint",
  "--accent-1", "--rule", "--shell",
  // 阴影
  "--shadow-card", "--shadow-stage",
  // 字阶
  "--t-display-1", "--t-display-2", "--t-h1", "--t-h2", "--t-h3",
  "--t-body", "--t-label", "--t-micro",
  // 间距
  "--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6",
  "--grid-gutter",
  // 动效
  "--dur-fast", "--dur-mid", "--dur-slow",
  "--ease-in", "--ease-out", "--ease-emph", "--stagger",
  // 语义
  "--card-bg", "--card-border", "--card-radius", "--r-card", "--r-pill", "--border-w",
  "--table-border", "--table-head-bg", "--table-zebra",
  "--rule-w", "--rule-style",
  "--badge-bg", "--badge-text",
  "--hero-num-font", "--hero-num-weight", "--hero-num-track",
  "--decor-family",
  "--caption-bg", "--caption-text", "--caption-radius", "--caption-size",
  // 字体
  "--font-display-cn", "--font-display-en", "--font-body", "--font-mono",
  // 舞台
  "--stage-pad-x", "--stage-pad-y",
];

const VAR_RE = /var\(\s*(--[\w-]+)/g;
const DEFINED_RE = /(--[\w-]+)\s*:/g;

function definedTokens(css: string): Set<string> {
  const set = new Set<string>();
  for (const m of css.matchAll(DEFINED_RE)) set.add(m[1]);
  return set;
}

export function validateTheme(
  tokensCss: string,
  themeJson: unknown,
  referencedVars: string[] = [],
): { errors: string[] } {
  const errors: string[] = [];
  const defined = definedTokens(tokensCss);

  if (!themeJson || typeof themeJson !== "object" || !("name" in themeJson)) {
    errors.push("theme.json 缺少 name 字段");
  }

  for (const t of REQUIRED_TOKENS) {
    if (!defined.has(t)) errors.push(`缺少必填 token: ${t}`);
  }

  for (const ref of referencedVars) {
    if (!defined.has(ref)) errors.push(`var() 引用未在主题中定义: ${ref}`);
  }

  // 主题内部 var() 引用（如 --card-bg: var(--surface)）也必须闭合
  for (const m of tokensCss.matchAll(VAR_RE)) {
    const name = m[1];
    if (!defined.has(name) && name !== "var") errors.push(`主题内部未定义引用: ${name}`);
  }

  return { errors };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/theme/theme-validate.test.ts`
Expected: PASS（6 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/theme
git commit -m "feat(M2a): 三层 token 骨架 + 主题校验器（必填 token + var 闭合）"
```

---

### Task 2: 动效档位与预设（motion.ts）

**Files:**
- Create: `narration-video/templates/src/components/motion.ts`
- Test: `narration-video/templates/src/components/motion.test.ts`

**Interfaces:**
- Consumes: `waapi`（M1 animationRuntime）、tokens.css 的动效 token
- Produces: `MotionDuration = "fast" | "mid" | "slow"`、`RevealPreset = "fade" | "rise" | "wipe"`、`revealAnim(el, preset, duration, delayMs): AnimHandle | null`（走引擎注册表，卸载 dispose 由调用方）、`staggerMs(): number`（读 --stagger 计算值）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/motion.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { RevealPreset, revealAnim, staggerMs } from "./motion";
import { registrySize } from "../engine/animationRuntime";

class FakeAnim {
  currentTime = 0;
  playState: "paused" | "running" | "finished" = "paused";
  constructor(public opts: KeyframeAnimationOptions) {}
  play() { this.playState = "running"; }
  pause() { this.playState = "paused"; }
}

function stubElement(): HTMLElement {
  const el = document.createElement("div");
  el.animate = (k: unknown, opts: KeyframeAnimationOptions) =>
    new FakeAnim(opts) as unknown as Animation;
  return el;
}

afterEach(() => {
  // 清理测试残留注册
  const { seekAll } = require("../engine/animationRuntime");
});

describe("motion 动效档位", () => {
  it("revealAnim 注册进引擎注册表并返回 handle", () => {
    const el = stubElement();
    const h = revealAnim(el, "fade", "fast", 0);
    expect(h).not.toBeNull();
    expect(registrySize()).toBeGreaterThan(0);
    h!.dispose();
    expect(registrySize()).toBe(0);
  });

  it("三个预设 keyframes 形状正确", () => {
    const presets: RevealPreset[] = ["fade", "rise", "wipe"];
    for (const p of presets) {
      const el = stubElement();
      const h = revealAnim(el, p, "mid", 0);
      expect(h).not.toBeNull();
      h!.dispose();
    }
  });

  it("staggerMs 读 --stagger 计算值（jsdom 无计算值时报默认 120）", () => {
    expect(typeof staggerMs(document.createElement("div"))).toBe("number");
    expect(staggerMs(document.createElement("div"))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/motion.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/components/motion.ts`：

```ts
// 动效档位与预设（§5.1 动效 token 的组件层消费入口）。
// 所有动画必经引擎注册表（铁律 1）；时长/缓动从主题动效 token 读取，零硬编码。

import { AnimHandle, waapi } from "../engine/animationRuntime";

export type MotionDuration = "fast" | "mid" | "slow";
export type RevealPreset = "fade" | "rise" | "wipe";

const DUR_TOKEN: Record<MotionDuration, string> = {
  fast: "--dur-fast",
  mid: "--dur-mid",
  slow: "--dur-slow",
};

const EASE_TOKEN: Record<MotionDuration, string> = {
  fast: "--ease-in",
  mid: "--ease-out",
  slow: "--ease-emph",
};

const KEYFRAMES: Record<RevealPreset, Keyframe[]> = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  rise: [
    { opacity: 0, transform: "translateY(24px)" },
    { opacity: 1, transform: "translateY(0)" },
  ],
  wipe: [
    { clipPath: "inset(0 0 100% 0)" },
    { clipPath: "inset(0 0 0 0)" },
  ],
};

/** 从元素计算样式读 token 并解析为 ms */
function readTokenMs(el: Element, token: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(token).trim();
  const n = parseFloat(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

export function staggerMs(el: Element): number {
  return readTokenMs(el, "--stagger", 120);
}

/** 入场动画：走引擎注册表；返回 handle 供调用方 dispose（卸载清理，终审 Recommendation） */
export function revealAnim(
  el: Element,
  preset: RevealPreset,
  duration: MotionDuration,
  delayMs: number,
): AnimHandle | null {
  if (typeof el.animate !== "function") return null;
  const dur = readTokenMs(el, DUR_TOKEN[duration], duration === "fast" ? 300 : duration === "mid" ? 700 : 1400);
  const easing = getComputedStyle(el).getPropertyValue(EASE_TOKEN[duration]).trim() || "linear";
  return waapi(el, KEYFRAMES[preset], {
    duration: dur,
    delay: delayMs,
    easing,
    fill: "both",
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/motion.test.ts`
Expected: PASS（3 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components
git commit -m "feat(M2a): 动效档位映射（token 驱动时长缓动 + 三预设）"
```

---

### Task 3: createPrimitive 组件工厂

**Files:**
- Create: `narration-video/templates/src/components/factory.tsx`
- Test: `narration-video/templates/src/components/factory.test.tsx`

**Interfaces:**
- Consumes: `revealAnim/staggerMs`（Task 2）、`registrySize`（M1）
- Produces: `PrimitiveProps { variant, reveal, duration, stagger, className, style, children }`、`createPrimitive(name, config): ComponentType<PrimitiveProps>`——后续组件任务的唯一生产手段；`PrimitiveComponent` 渲染 `<Tag className={"cdp cdp-<name> cdp-<name>-<variant>"}>`

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/factory.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { createPrimitive } from "./factory";
import { registrySize, setRenderMode } from "../engine/animationRuntime";

const Demo = createPrimitive("demo", {
  tag: "div",
  variants: ["plain", "invert"],
  defaultVariant: "plain",
});

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("createPrimitive 工厂", () => {
  it("默认变体类名 = cdp cdp-demo cdp-demo-plain", () => {
    const { getByTestId } = render(<Demo data-testid="x">hi</Demo>);
    expect(getByTestId("x").className).toContain("cdp");
    expect(getByTestId("x").className).toContain("cdp-demo");
    expect(getByTestId("x").className).toContain("cdp-demo-plain");
  });

  it("指定变体生效", () => {
    const { getByTestId } = render(<Demo variant="invert" data-testid="x">hi</Demo>);
    expect(getByTestId("x").className).toContain("cdp-demo-invert");
  });

  it("reveal 动画注册进引擎注册表，卸载时 dispose", () => {
    const { getByTestId, unmount } = render(
      <Demo reveal="fade" duration="fast" data-testid="x">hi</Demo>,
    );
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("无 reveal 时不注册动画", () => {
    const { unmount } = render(<Demo data-testid="x">hi</Demo>);
    expect(registrySize()).toBe(0);
    unmount();
  });

  it("stagger 下每个直接子元素各注册一个动画", () => {
    const { unmount, container } = render(
      <Demo reveal="rise" stagger data-testid="x">
        <div>a</div>
        <div>b</div>
        <div>c</div>
      </Demo>,
    );
    expect(container.children[0].children).toHaveLength(3);
    expect(registrySize()).toBe(3);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/factory.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/components/factory.tsx`：

```tsx
// 组件工厂（§6.4 缺点 1 的机制落点）：每个组件 = 变体配置 + components/ 内 CSS。
// 统一处理：变体类名、token 驱动样式（样式在组件 CSS）、动画预设走引擎注册表、卸载 dispose。
// 铁律 5：stagger 用逐子元素延迟动画实现（Ruling 8 后 delay 语义正确）。

import {
  CSSProperties,
  ElementType,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { AnimHandle } from "../engine/animationRuntime";
import { MotionDuration, RevealPreset, revealAnim, staggerMs } from "./motion";

export interface PrimitiveProps {
  variant?: string;
  reveal?: RevealPreset;
  duration?: MotionDuration;
  /** true = 对直接子元素逐条揭示（stagger 消费 --stagger token） */
  stagger?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "data-testid"?: string;
}

export interface PrimitiveConfig {
  tag: ElementType;
  variants: string[];
  defaultVariant: string;
}

export type PrimitiveComponent = (props: PrimitiveProps) => ReactNode;

export function createPrimitive(
  name: string,
  config: PrimitiveConfig,
): PrimitiveComponent {
  const { tag: Tag, defaultVariant } = config;

  return function Primitive(props: PrimitiveProps) {
    const { variant = defaultVariant, reveal, duration = "mid", stagger, className = "", style, children } = props;
    const rootRef = useRef<HTMLElement | null>(null);
    const handlesRef = useRef<AnimHandle[]>([]);

    useEffect(() => {
      const el = rootRef.current;
      if (!el || !reveal) return;
      handlesRef.current = [];
      if (stagger && el.children.length > 0) {
        const step = staggerMs(el);
        Array.from(el.children).forEach((child, i) => {
          const h = revealAnim(child as HTMLElement, reveal, duration, i * step);
          if (h) handlesRef.current.push(h);
        });
      } else {
        const h = revealAnim(el, reveal, duration, 0);
        if (h) handlesRef.current.push(h);
      }
      return () => {
        handlesRef.current.forEach((h) => h.dispose());
        handlesRef.current = [];
      };
    }, [reveal, duration, stagger]);

    const classes = ["cdp", `cdp-${name}`, `cdp-${name}-${variant}`, className]
      .filter(Boolean)
      .join(" ");

    return (
      <Tag ref={rootRef} className={classes} style={style} data-testid={props["data-testid"]}>
        {children}
      </Tag>
    );
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/factory.test.tsx`
Expected: PASS（5 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/factory.tsx
git commit -m "feat(M2a): createPrimitive 组件工厂（变体+预设+stagger+dispose）"
```

---

### Task 4: 文字组（HeroTitle / Kicker / BodyCopy / QuoteBlock）

**Files:**
- Create: `narration-video/templates/src/components/text/HeroTitle.tsx` + `.css`
- Create: `narration-video/templates/src/components/text/Kicker.tsx` + `.css`
- Create: `narration-video/templates/src/components/text/BodyCopy.tsx` + `.css`
- Create: `narration-video/templates/src/components/text/QuoteBlock.tsx` + `.css`
- Test: `narration-video/templates/src/components/text/text.test.tsx`

**Interfaces:**
- Consumes: `createPrimitive`（Task 3）
- Produces: `HeroTitle { variant: "plain" | "stamp" }`、`Kicker { variant: "block" | "pill" }`、`BodyCopy { variant: "plain" | "lede" }`、`QuoteBlock { variant: "rule" | "block" }`（各带 PrimitiveProps 的 reveal/duration/stagger）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/text/text.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { HeroTitle, Kicker, BodyCopy, QuoteBlock } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("文字组组件", () => {
  it("四个组件默认变体渲染 + 类名约定", () => {
    const { getByTestId } = render(
      <div>
        <HeroTitle data-testid="t1">大标题</HeroTitle>
        <Kicker data-testid="t2">CHAPTER 01</Kicker>
        <BodyCopy data-testid="t3">正文</BodyCopy>
        <QuoteBlock data-testid="t4">引用</QuoteBlock>
      </div>,
    );
    expect(getByTestId("t1").className).toContain("cdp-hero-title");
    expect(getByTestId("t2").className).toContain("cdp-kicker");
    expect(getByTestId("t3").className).toContain("cdp-body-copy");
    expect(getByTestId("t4").className).toContain("cdp-quote-block");
  });

  it("每组件至少 2 个变体", () => {
    const { getByTestId } = render(
      <div>
        <HeroTitle variant="stamp" data-testid="t1">x</HeroTitle>
        <Kicker variant="pill" data-testid="t2">x</Kicker>
        <BodyCopy variant="lede" data-testid="t3">x</BodyCopy>
        <QuoteBlock variant="block" data-testid="t4">x</QuoteBlock>
      </div>,
    );
    expect(getByTestId("t1").className).toContain("cdp-hero-title-stamp");
    expect(getByTestId("t2").className).toContain("cdp-kicker-pill");
    expect(getByTestId("t3").className).toContain("cdp-body-copy-lede");
    expect(getByTestId("t4").className).toContain("cdp-quote-block-block");
  });

  it("reveal 走引擎注册表、卸载 dispose（抽 HeroTitle 验证）", () => {
    const { unmount } = render(<HeroTitle reveal="rise">x</HeroTitle>);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/text/text.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`HeroTitle.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 大标题（§6.2 文字组）。variants: plain（字阶直排）/ stamp（墨底白字印戳式硬阴影） */
export const HeroTitle = createPrimitive("hero-title", {
  tag: "h1",
  variants: ["plain", "stamp"],
  defaultVariant: "plain",
});
```

`HeroTitle.css`（组件样式只存在于 components/、只消费 token）：

```css
.cdp-hero-title {
  font-family: var(--font-display-cn), var(--font-display-en);
  font-size: var(--t-display-1);
  line-height: 1.05;
  color: var(--text);
  margin: 0;
}

.cdp-hero-title-stamp {
  display: inline-block;
  background: var(--surface-3);
  color: var(--surface);
  padding: var(--space-3) var(--space-4);
  box-shadow: var(--shadow-card);
}
```

`Kicker.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 小标签（章节号/栏目名）。variants: block（墨底白字方标）/ pill（胶囊） */
export const Kicker = createPrimitive("kicker", {
  tag: "div",
  variants: ["block", "pill"],
  defaultVariant: "block",
});
```

`Kicker.css`：

```css
.cdp-kicker {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  display: inline-block;
}

.cdp-kicker-block {
  background: var(--surface-3);
  color: var(--surface);
  padding: var(--space-1) var(--space-2);
}

.cdp-kicker-pill {
  border: 1px solid var(--text);
  color: var(--text);
  border-radius: var(--r-pill);
  padding: var(--space-1) var(--space-2);
}
```

`BodyCopy.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 正文。variants: plain / lede（大号导语） */
export const BodyCopy = createPrimitive("body-copy", {
  tag: "p",
  variants: ["plain", "lede"],
  defaultVariant: "plain",
});
```

`BodyCopy.css`：

```css
.cdp-body-copy {
  font-family: var(--font-body);
  font-size: var(--t-body);
  line-height: 1.5;
  color: var(--text-2);
  margin: 0;
}

.cdp-body-copy-lede {
  font-size: var(--t-h3);
  color: var(--text);
  font-weight: 600;
}
```

`QuoteBlock.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 引用块。variants: rule（左粗条）/ block（强调色底块） */
export const QuoteBlock = createPrimitive("quote-block", {
  tag: "blockquote",
  variants: ["rule", "block"],
  defaultVariant: "rule",
});
```

`QuoteBlock.css`：

```css
.cdp-quote-block {
  font-family: var(--font-display-cn), var(--font-display-en);
  font-size: var(--t-h2);
  line-height: 1.3;
  color: var(--text);
  margin: 0;
}

.cdp-quote-block-rule {
  border-left: var(--rule-w) var(--rule-style) var(--accent-1);
  padding-left: var(--space-4);
}

.cdp-quote-block-block {
  background: var(--accent-1);
  color: var(--surface);
  padding: var(--space-4) var(--space-5);
}
```

`text/index.ts`：

```ts
export { HeroTitle } from "./HeroTitle";
export { Kicker } from "./Kicker";
export { BodyCopy } from "./BodyCopy";
export { QuoteBlock } from "./QuoteBlock";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/text/text.test.tsx`
Expected: PASS（3 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/text
git commit -m "feat(M2a): 文字组组件（HeroTitle/Kicker/BodyCopy/QuoteBlock，各 2 变体）"
```

---

### Task 5: 数据组（HeroNumber / Counter / BarGrow / DonutMeter / StatCard）

**Files:**
- Create: `narration-video/templates/src/components/data/HeroNumber.tsx` + `.css`
- Create: `narration-video/templates/src/components/data/Counter.tsx` + `.css`
- Create: `narration-video/templates/src/components/data/BarGrow.tsx` + `.css`
- Create: `narration-video/templates/src/components/data/DonutMeter.tsx` + `.css`
- Create: `narration-video/templates/src/components/data/StatCard.tsx` + `.css`
- Create: `narration-video/templates/src/components/data/index.ts`
- Test: `narration-video/templates/src/components/data/data.test.tsx`

**Interfaces:**
- Consumes: `createPrimitive`（Task 3）、`canvasAnim`（M1 帧函数逃生舱）、`revealAnim`（Task 2）
- Produces: `HeroNumber { value: string, variant: "plain" | "accent", countUp?: boolean }`、`Counter { to: number, duration?: MotionDuration }`、`BarGrow { value: number /* 0-1 */, variant: "solid" | "accent" }`、`DonutMeter { value: number /* 0-1 */, label?: string }`、`StatCard { number: string, label: string, variant: "plain" | "invert" | "accent" }`

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/data/data.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { HeroNumber, Counter, BarGrow, DonutMeter, StatCard } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("数据组组件", () => {
  it("HeroNumber 渲染数值 + 变体", () => {
    const { getByTestId } = render(
      <HeroNumber value="47%" variant="accent" data-testid="n" />,
    );
    expect(getByTestId("n")).toHaveTextContent("47%");
    expect(getByTestId("n").className).toContain("cdp-hero-number-accent");
  });

  it("Counter countUp 走帧函数逃生舱（canvasAnim 注册）", () => {
    const { unmount } = render(<Counter to={47} duration="fast" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("BarGrow 动画注册（waapi 生长）", () => {
    const { unmount } = render(<BarGrow value={0.7} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("DonutMeter 渲染 label + 动画注册", () => {
    const { getByTestId, unmount } = render(
      <DonutMeter value={0.42} label="转化率" data-testid="d" />,
    );
    expect(getByTestId("d")).toHaveTextContent("转化率");
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("StatCard 组合渲染数字与标签 + 三个变体", () => {
    const { getByTestId } = render(
      <StatCard number="+47%" label="增长" variant="invert" data-testid="s" />,
    );
    expect(getByTestId("s")).toHaveTextContent("+47%");
    expect(getByTestId("s")).toHaveTextContent("增长");
    expect(getByTestId("s").className).toContain("cdp-stat-card-invert");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/data/data.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`HeroNumber.tsx`（countUp 用 canvasAnim 帧函数）：

```tsx
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { createPrimitive } from "../factory";
import { MotionDuration } from "../motion";

export interface HeroNumberProps {
  value: string;
  variant?: "plain" | "accent";
  /** true = 数字从 0 滚动到目标值（帧函数逃生舱，铁律 2） */
  countUp?: boolean;
  duration?: MotionDuration;
  "data-testid"?: string;
}

function parseLeadNumber(value: string): number | null {
  const m = value.match(/^-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 300, mid: 700, slow: 1400 };

export function HeroNumber({ value, variant = "plain", countUp, duration = "mid", ...rest }: HeroNumberProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!countUp) return;
    const el = spanRef.current;
    if (!el) return;
    const target = parseLeadNumber(value);
    if (target === null) return;
    const durMs = DUR_FALLBACK[duration];
    // draw(t)：t ∈ [0, durMs] → 进度 → 数值（帧函数逃生舱，可 seek）
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      const shown = Math.round(target * progress);
      el.textContent = String(shown) + value.replace(/^-?\d+(\.\d+)?/, "");
    }, durMs);
    return () => h.dispose();
  }, [countUp, value, duration]);

  const Base = createPrimitive("hero-number", {
    tag: "div",
    variants: ["plain", "accent"],
    defaultVariant: "plain",
  });
  return (
    <Base variant={variant} data-testid={rest["data-testid"]}>
      <span ref={spanRef} className="cdp-hero-number-value">{value}</span>
    </Base>
  );
}
```

`HeroNumber.css`：

```css
.cdp-hero-number-value {
  font-family: var(--hero-num-font);
  font-weight: var(--hero-num-weight);
  letter-spacing: var(--hero-num-track);
  font-size: var(--t-display-2);
  line-height: 0.95;
  color: var(--text);
}

.cdp-hero-number-accent .cdp-hero-number-value {
  color: var(--accent-1);
}
```

`Counter.tsx`（纯帧函数计数，独立于 HeroNumber 的 countUp）：

```tsx
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 300, mid: 700, slow: 1400 };

export interface CounterProps {
  to: number;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function Counter({ to, duration = "mid", className = "", ...rest }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const durMs = DUR_FALLBACK[duration];
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      el.textContent = String(Math.round(to * progress));
    }, durMs);
    return () => h.dispose();
  }, [to, duration]);

  return (
    <span ref={ref} className={`cdp-counter ${className}`} data-testid={rest["data-testid"]}>
      0
    </span>
  );
}
```

`Counter.css`：

```css
.cdp-counter {
  font-family: var(--font-mono);
  font-size: var(--t-display-2);
  font-weight: 700;
  color: var(--text);
}
```

`BarGrow.tsx`：

```tsx
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 300, mid: 700, slow: 1400 };

export interface BarGrowProps {
  /** 0-1 */
  value: number;
  variant?: "solid" | "accent";
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function BarGrow({ value, variant = "solid", duration = "mid", className = "", ...rest }: BarGrowProps) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el || typeof el.animate !== "function") return;
    // 横条生长：transform scaleX 0→value（动画属性白名单）
    const h: AnimHandle = (() => {
      const a = el.animate(
        [{ transform: "scaleX(0)" }, { transform: `scaleX(${value})` }],
        { duration: DUR_FALLBACK[duration], easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "both" },
      );
      return {
        id: Symbol("bar"),
        durationMs: DUR_FALLBACK[duration],
        seek: (tMs) => {
          a.currentTime = Math.min(DUR_FALLBACK[duration], Math.max(0, tMs));
        },
        isFinished: () => (a.currentTime ?? 0) >= DUR_FALLBACK[duration] - 0.5,
        pause: () => a.pause(),
        play: () => a.play(),
        dispose: () => a.cancel(),
      };
    })();
    // 注册进引擎（铁律 1）：走 waapi 适配器更简单，但需要 keyframes 对象——直接用原生
    const { register } = require("../../engine/animationRuntime");
    const handle = register({
      durationMs: DUR_FALLBACK[duration],
      seek: (tMs) => { a.currentTime = Math.min(DUR_FALLBACK[duration], Math.max(0, tMs)); },
      isFinished: () => (a.currentTime ?? 0) >= DUR_FALLBACK[duration] - 0.5,
      pause: () => a.pause(),
      play: () => a.play(),
    });
    return () => handle.dispose();
  }, [value, duration]);

  return (
    <div
      className={`cdp-bar-grow cdp-bar-grow-${variant} ${className}`}
      data-testid={rest["data-testid"]}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
    >
      <div ref={fillRef} className="cdp-bar-grow-fill" />
    </div>
  );
}
```

> 注：以上实现内联了注册逻辑；若评审认为应改走 motion.ts 的 waapi 适配器封装，按评审意见收敛（waapi 适配器接收 keyframes+opts 更整洁）。

`BarGrow.css`：

```css
.cdp-bar-grow {
  height: var(--space-3);
  background: var(--surface-2);
  border: var(--card-border);
  overflow: hidden;
}

.cdp-bar-grow-fill {
  height: 100%;
  background: var(--surface-3);
  transform-origin: left center;
}

.cdp-bar-grow-accent .cdp-bar-grow-fill {
  background: var(--accent-1);
}
```

`DonutMeter.tsx`：

```tsx
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 300, mid: 700, slow: 1400 };
const R = 54;
const CIRC = 2 * Math.PI * R;

export interface DonutMeterProps {
  /** 0-1 */
  value: number;
  label?: string;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function DonutMeter({ value, label, duration = "mid", className = "", ...rest }: DonutMeterProps) {
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    // 环形描边：stroke-dashoffset 动画（Ruling P2-1 白名单扩展）
    const target = CIRC * (1 - value);
    const h = waapi(
      el,
      [
        { strokeDashoffset: CIRC },
        { strokeDashoffset: target },
      ],
      { duration: DUR_FALLBACK[duration], easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "both" },
    );
    return () => h.dispose();
  }, [value, duration]);

  return (
    <div className={`cdp-donut ${className}`} data-testid={rest["data-testid"]}>
      <svg width="144" height="144" viewBox="0 0 144 144">
        <circle cx="72" cy="72" r={R} className="cdp-donut-track" />
        <circle
          ref={circleRef}
          cx="72"
          cy="72"
          r={R}
          className="cdp-donut-arc"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC}
        />
      </svg>
      {label ? <div className="cdp-donut-label">{label}</div> : null}
    </div>
  );
}
```

`DonutMeter.css`：

```css
.cdp-donut {
  position: relative;
  width: 144px;
  height: 144px;
}

.cdp-donut-track {
  fill: none;
  stroke: var(--surface-2);
  stroke-width: 12;
}

.cdp-donut-arc {
  fill: none;
  stroke: var(--accent-1);
  stroke-width: 12;
  stroke-linecap: butt;
  transform: rotate(-90deg);
  transform-origin: center;
}

.cdp-donut-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-body);
  font-size: var(--t-label);
  color: var(--text-2);
}
```

`StatCard.tsx`（组合 Card + HeroNumber 语义；独立实现避免跨组依赖时序）：

```tsx
import { createPrimitive } from "../factory";

export interface StatCardProps {
  number: string;
  label: string;
  variant?: "plain" | "invert" | "accent";
  "data-testid"?: string;
}

const Base = createPrimitive("stat-card", {
  tag: "div",
  variants: ["plain", "invert", "accent"],
  defaultVariant: "plain",
});

export function StatCard({ number, label, variant = "plain", ...rest }: StatCardProps) {
  return (
    <Base variant={variant} data-testid={rest["data-testid"]}>
      <div className="cdp-stat-card-number">{number}</div>
      <div className="cdp-stat-card-label">{label}</div>
    </Base>
  );
}
```

`StatCard.css`：

```css
.cdp-stat-card {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-card);
  padding: var(--space-4);
}

.cdp-stat-card-number {
  font-family: var(--hero-num-font);
  font-weight: var(--hero-num-weight);
  letter-spacing: var(--hero-num-track);
  font-size: var(--t-display-2);
  line-height: 0.95;
  color: var(--text);
}

.cdp-stat-card-label {
  margin-top: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-mute);
}

.cdp-stat-card-invert {
  background: var(--surface-3);
}

.cdp-stat-card-invert .cdp-stat-card-number,
.cdp-stat-card-invert .cdp-stat-card-label {
  color: var(--surface);
}

.cdp-stat-card-accent {
  background: var(--accent-1);
}

.cdp-stat-card-accent .cdp-stat-card-number,
.cdp-stat-card-accent .cdp-stat-card-label {
  color: var(--surface);
}
```

`data/index.ts`：

```ts
export { HeroNumber } from "./HeroNumber";
export { Counter } from "./Counter";
export { BarGrow } from "./BarGrow";
export { DonutMeter } from "./DonutMeter";
export { StatCard } from "./StatCard";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/data/data.test.tsx`
Expected: PASS（5 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/data
git commit -m "feat(M2a): 数据组组件（HeroNumber/Counter/BarGrow/DonutMeter/StatCard）"
```

---

### Task 6: 结构组（Card / Rule / Grid / StagePad / Table）

**Files:**
- Create: `narration-video/templates/src/components/structure/Card.tsx` + `.css`
- Create: `narration-video/templates/src/components/structure/Rule.tsx` + `.css`
- Create: `narration-video/templates/src/components/structure/Grid.tsx` + `.css`
- Create: `narration-video/templates/src/components/structure/StagePad.tsx` + `.css`
- Create: `narration-video/templates/src/components/structure/Table.tsx` + `.css`
- Create: `narration-video/templates/src/components/structure/index.ts`
- Test: `narration-video/templates/src/components/structure/structure.test.tsx`

**Interfaces:**
- Consumes: `createPrimitive`（Task 3）
- Produces: `Card { variant: "plain" | "invert" | "accent" }`、`Rule { variant: "solid" | "dashed" }`、`Grid { variant: "even" | "half", columns?: number }`、`StagePad`（消费 --stage-pad-x/y）、`Table { rows: string[][], header?: string[], variant: "bordered" | "zebra" }`

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/structure/structure.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { Card, Rule, Grid, StagePad, Table } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("结构组组件", () => {
  it("五个组件默认渲染 + 类名约定", () => {
    const { getByTestId } = render(
      <StagePad data-testid="pad">
        <Card data-testid="c">卡片</Card>
        <Rule data-testid="r" />
        <Grid data-testid="g"><div>1</div><div>2</div></Grid>
        <Table data-testid="tb" header={["A", "B"]} rows={[["1", "2"]]} />
      </StagePad>,
    );
    expect(getByTestId("c").className).toContain("cdp-card");
    expect(getByTestId("r").className).toContain("cdp-rule");
    expect(getByTestId("g").className).toContain("cdp-grid");
    expect(getByTestId("tb").className).toContain("cdp-table");
  });

  it("Table 渲染表头与斑马纹变体", () => {
    const { getByTestId } = render(
      <Table
        variant="zebra"
        header={["名称", "值"]}
        rows={[["a", "1"], ["b", "2"]]}
        data-testid="tb"
      />,
    );
    expect(getByTestId("tb").querySelectorAll("thead th")).toHaveLength(2);
    expect(getByTestId("tb").querySelectorAll("tbody tr")).toHaveLength(2);
    expect(getByTestId("tb").className).toContain("cdp-table-zebra");
  });

  it("Card reveal 走引擎、卸载 dispose", () => {
    const { unmount } = render(<Card reveal="fade">x</Card>);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/structure/structure.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`Card.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 卡片（§5.1 --card-* 的消费端）。variants: plain / invert（反色）/ accent（强调底） */
export const Card = createPrimitive("card", {
  tag: "div",
  variants: ["plain", "invert", "accent"],
  defaultVariant: "plain",
});
```

`Card.css`：

```css
.cdp-card {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-card);
  padding: var(--space-4);
  color: var(--text);
}

.cdp-card-invert {
  background: var(--surface-3);
  color: var(--surface);
}

.cdp-card-accent {
  background: var(--accent-1);
  color: var(--surface);
}
```

`Rule.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 分割线（§5.1 --rule-w/--rule-style 的消费端）。variants: solid / dashed */
export const Rule = createPrimitive("rule", {
  tag: "hr",
  variants: ["solid", "dashed"],
  defaultVariant: "solid",
});
```

`Rule.css`：

```css
.cdp-rule {
  border: none;
  border-top: var(--rule-w) var(--rule-style) var(--rule);
  margin: var(--space-3) 0;
}

.cdp-rule-dashed {
  border-top-style: dashed;
}
```

`Grid.tsx`：

```tsx
import { createPrimitive } from "../factory";

export interface GridProps {
  variant?: "even" | "half";
  /** even 变体下的列数（half 固定 2 列） */
  columns?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  "data-testid"?: string;
}

const Base = createPrimitive("grid", {
  tag: "div",
  variants: ["even", "half"],
  defaultVariant: "even",
});

export function Grid({ variant = "even", columns = 3, style, ...rest }: GridProps) {
  const gridStyle: React.CSSProperties =
    variant === "even"
      ? { gridTemplateColumns: `repeat(${columns}, 1fr)`, ...style }
      : style ?? {};
  return (
    <Base variant={variant} style={gridStyle} data-testid={rest["data-testid"]} className={rest.className}>
      {rest.children}
    </Base>
  );
}
```

`Grid.css`：

```css
.cdp-grid {
  display: grid;
  gap: var(--grid-gutter);
}

.cdp-grid-half {
  grid-template-columns: 1fr 1fr;
}
```

`StagePad.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 舞台留白容器（§5.1 --stage-pad-x/y 的消费端，v1 由主题内部固定） */
export const StagePad = createPrimitive("stage-pad", {
  tag: "div",
  variants: ["default"],
  defaultVariant: "default",
});
```

`StagePad.css`：

```css
.cdp-stage-pad {
  position: absolute;
  inset: 0;
  padding: var(--stage-pad-y) var(--stage-pad-x);
  box-sizing: border-box;
}
```

`Table.tsx`：

```tsx
import { createPrimitive } from "../factory";

export interface TableProps {
  header?: string[];
  rows: string[][];
  variant?: "bordered" | "zebra";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("table", {
  tag: "table",
  variants: ["bordered", "zebra"],
  defaultVariant: "bordered",
});

export function Table({ header, rows, variant = "bordered", ...rest }: TableProps) {
  return (
    <Base variant={variant} data-testid={rest["data-testid"]} className={rest.className}>
      {header ? (
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Base>
  );
}
```

`Table.css`：

```css
.cdp-table {
  border-collapse: collapse;
  width: 100%;
  font-family: var(--font-body);
  font-size: var(--t-label);
  color: var(--text);
}

.cdp-table-bordered th,
.cdp-table-bordered td {
  border: var(--table-border);
  padding: var(--space-2) var(--space-3);
}

.cdp-table th {
  background: var(--table-head-bg);
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.cdp-table-zebra tbody tr:nth-child(even) {
  background: var(--table-zebra);
}
```

`structure/index.ts`：

```ts
export { Card } from "./Card";
export { Rule } from "./Rule";
export { Grid } from "./Grid";
export { StagePad } from "./StagePad";
export { Table } from "./Table";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/structure/structure.test.tsx`
Expected: PASS（3 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/structure
git commit -m "feat(M2a): 结构组组件（Card/Rule/Grid/StagePad/Table）"
```

---

### Task 7: 组件契约 lint + 统一导出 + 双画布冒烟

**Files:**
- Create: `narration-video/templates/src/components/index.ts`（统一导出 + import 各组件 css）
- Create: `narration-video/templates/src/components/contract-lint.ts`（组件 CSS token 纯度扫描）
- Create: `narration-video/templates/src/components/smoke.test.tsx`（全部组件双画布渲染冒烟）
- Test: `narration-video/templates/src/components/contract-lint.test.ts`

**Interfaces:**
- Consumes: 全部组件（Task 4-6）
- Produces: `components` 统一出口（章节层唯一合法零件来源，§6.2）；`lintComponentCss(): string[]`（违规清单，空 = 通过；M3a 门禁 #9 复用此实现）；`ALL_COMPONENTS` 清单（冒烟/门禁用）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/contract-lint.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { lintComponentCss } from "./contract-lint";

describe("组件契约 lint（§6.4 缺点 4 物理隔离 + §11.1 #9）", () => {
  it("组件 CSS 零违规（禁裸色/禁裸字体/禁裸动画时长）", () => {
    expect(lintComponentCss()).toEqual([]);
  });
});
```

`narration-video/templates/src/components/smoke.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { setRenderMode } from "../engine/animationRuntime";
import {
  HeroTitle, Kicker, BodyCopy, QuoteBlock,
  HeroNumber, Counter, BarGrow, DonutMeter, StatCard,
  Card, Rule, Grid, StagePad, Table,
} from "./index";

const STAGE_SIZES = [
  { width: 1920, height: 1080 }, // 16:9
  { width: 1080, height: 1440 }, // 3:4
];

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("双画布冒烟（§11.2 组件契约测试）", () => {
  for (const dims of STAGE_SIZES) {
    it(`全部组件在 ${dims.width}×${dims.height} 画布渲染无异常`, () => {
      const { container } = render(
        <div style={{ width: dims.width, height: dims.height }}>
          <StagePad>
            <Kicker>CHAPTER 01</Kicker>
            <HeroTitle reveal="fade">测试标题</HeroTitle>
            <BodyCopy variant="lede">导语</BodyCopy>
            <QuoteBlock>引用</QuoteBlock>
            <Grid variant="half">
              <StatCard number="47" label="增长" variant="accent" />
              <Card variant="invert">卡片</Card>
            </Grid>
            <HeroNumber value="+47%" />
            <Counter to={47} />
            <BarGrow value={0.7} />
            <DonutMeter value={0.42} label="转化率" />
            <Rule />
            <Table header={["A", "B"]} rows={[["1", "2"]]} variant="zebra" />
          </StagePad>
        </div>,
      );
      expect(container.querySelector(".cdp")).not.toBeNull();
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/contract-lint.test.ts src/components/smoke.test.tsx`
Expected: FAIL（contract-lint 模块不存在；smoke 依赖的 index.ts 不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/components/contract-lint.ts`：

```ts
// 组件契约 lint（§11.1 #9 内核）：组件 CSS 只消费 token——禁裸色值、禁裸 font-family、禁裸 animation-duration。
// M3a 门禁与本章节测试共用同一实现。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const COMPONENTS_DIR = resolve(__dirname, ".");

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RGB_RE = /rgba?\(/;
const HSL_RE = /hsla?\(/;
const NAMED_COLOR_RE = /\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|tomato|gold|silver)\b/;
const FONT_RE = /font-family\s*:\s*(?!var\()/;
const DUR_RE = /animation-duration\s*:\s*(?!var\()/;
const TRANSITION_DUR_RE = /transition-duration\s*:\s*(?!var\()/;

export function lintComponentCss(): string[] {
  const violations: string[] = [];
  walkCss(COMPONENTS_DIR, (file, css) => {
    const lines = css.split("\n");
    lines.forEach((line, i) => {
      const loc = `${relative(COMPONENTS_DIR, file)}:${i + 1}`;
      if (HEX_RE.test(line) || RGB_RE.test(line) || HSL_RE.test(line) || NAMED_COLOR_RE.test(line)) {
        violations.push(`${loc} 组件 CSS 出现裸色值（禁硬编码色，§11.1 #2）`);
      }
      if (FONT_RE.test(line)) {
        violations.push(`${loc} 组件 CSS 出现裸 font-family（须走 var(--font-*)，§11.1 #3）`);
      }
      if (DUR_RE.test(line) || TRANSITION_DUR_RE.test(line)) {
        violations.push(`${loc} 组件 CSS 出现裸动画时长（须走 var(--dur-*)，§11.1 #4）`);
      }
    });
  });
  return violations;
}

function walkCss(dir: string, onFile: (file: string, css: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkCss(full, onFile);
    } else if (entry.endsWith(".css")) {
      onFile(full, readFileSync(full, "utf-8"));
    }
  }
}
```

`narration-video/templates/src/components/index.ts`：

```ts
// 组件统一出口（§6.2 章节层唯一合法零件来源）+ 组件 CSS 装配（Ruling P2-2）
import "./text/HeroTitle.css";
import "./text/Kicker.css";
import "./text/BodyCopy.css";
import "./text/QuoteBlock.css";
import "./data/HeroNumber.css";
import "./data/Counter.css";
import "./data/BarGrow.css";
import "./data/DonutMeter.css";
import "./data/StatCard.css";
import "./structure/Card.css";
import "./structure/Rule.css";
import "./structure/Grid.css";
import "./structure/StagePad.css";
import "./structure/Table.css";

export { HeroTitle, Kicker, BodyCopy, QuoteBlock } from "./text";
export { HeroNumber, Counter, BarGrow, DonutMeter, StatCard } from "./data";
export { Card, Rule, Grid, StagePad, Table } from "./structure";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/contract-lint.test.ts src/components/smoke.test.tsx`
Expected: PASS（lint 空违规 + 2 画布冒烟全过）

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS（M1 的 41 项 + 本计划新增，共约 68 项）+ 零类型错误

- [ ] **Step 6: Commit**

```bash
git add narration-video/templates/src/components
git commit -m "feat(M2a): 组件统一出口 + 契约 lint + 双画布冒烟"
```

---

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：§5.1 三层 token（Task 1 全槽位 + 校验器）✓；§5.1 动效 token（Task 2）✓；§6.1 铁律 1/2/4/5（Task 2/3/5 的动画路径全部走引擎/帧函数/白名单/逐子元素 stagger）✓；§6.2 文字/数据/结构三组 14 组件 ✓（揭示/装饰/素材/氛围组在 Plan 3）；§6.4 缺点 1（≥2 变体）✓、缺点 4（组件 CSS 物理隔离 + lint）✓；§11.1 #9/#10 内核（Task 1/7）✓；终审 Recommendation（dispose 纪律，factory 统一卸载清理）✓。缺口（属后续计划）：M3a 门禁脚本本体、组件参考卡、CHAPTER-CRAFT、揭示/装饰/素材/氛围组。
2. **Placeholder scan**：无 TBD/TODO；每个任务含完整代码与测试。
3. **Type consistency**：`MotionDuration/RevealPreset`（Task 2 定义 → factory/数据组消费一致）；`createPrimitive(name, {tag, variants, defaultVariant})`（Task 3 定义 → Task 4/6 使用一致）；`lintComponentCss(): string[]`（Task 7 定义 → 契约测试与 M3a 复用）；`validateTheme(tokensCss, themeJson, referencedVars?)`（Task 1 → M2b/M3a 复用）。
4. **已知取舍**：BarGrow 内联注册逻辑（避免 waapi 适配器对纯 transform 动画的包装偏差），评审若要求收敛则走 motion.ts；tokens.css 中性占位值在 M2b 整体覆盖。
