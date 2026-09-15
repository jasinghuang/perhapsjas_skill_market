# Figma 组件库镜像 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 narration-video/templates 的 44 组件 + token 体系镜像到 Figma 文件（key `S0ca2PukTI731lj9jFtCsX`），服务设计复用与 AI 工具链。

**Architecture:** 三阶段。repo 内写 spec 生成器（tokens.css → tokens.dtcg.json；manifest+组件源码+CSS → components-spec.json），经 Figma MCP 的 use_figma 按 spec 程序化创建 variables 与组件集，最后数量/视觉/拖用三重校验。spec JSON 落 repo，幂等可重跑。

**Tech Stack:** TypeScript + tsx + vitest（repo 现有 devDeps，**不新增依赖**）；Figma MCP（plugin:figma:figma 的 use_figma，每次调用前必须先加载 `figma:figma-use` skill）；Playwright（devDeps 现有，用于视觉对照与 SVG 抓取）。

**Spec:** `docs/superpowers/specs/2026-09-15-figma-component-library-design.md`（本计划从 spec 立论，执行者需同读）

## Global Constraints

- Figma 目标文件 key：`S0ca2PukTI731lj9jFtCsX`（URL `https://www.figma.com/design/S0ca2PukTI731lj9jFtCsX/styleguide`）
- 组件总数 44；组序与归属以 `narration-video/templates/src/components/manifest.ts` 的 `GROUPS` + `COMPONENTS` 为唯一事实来源
- 每个变量的 code syntax（WEB）= 其 tokens.css 原名（如 `--card-bg`），Dev Mode 输出零翻译差
- 组件结构纪律：全 auto layout、fill/stroke/字号/间距/圆角 100% 绑变量、禁止绝对定位快照
- 动效组件只建终态，description 标注"动效终态，动画参数见 motion collection"
- 不新增 npm 依赖；所有生成器代码跑在 `npx tsx` / `npx vitest run`（工作目录 `narration-video/templates/`）
- use_figma 任务前必须 `Skill(figma:figma-use)`；若 skill 给出的 API 用法与本计划 JS 片段冲突，以 skill 为准
- git 提交信息用中文，末行加 `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- 中间产物落盘路径：`narration-video/templates/scripts/figma-export/out/`（tokens.dtcg.json、components-spec.json、apply 分片、进度记录）

## 代码库关键背景（执行者必读）

| 事实 | 出处 | 对本计划的意义 |
|---|---|---|
| 组件 = `createPrimitive(name, {tag, variants, defaultVariant})` + 同目录 CSS | `src/components/_internal/factory.tsx`；如 `structure/Card.tsx` 仅 7 行 | 变体与结构的主信号源是工厂参数和 CSS，不是 JSX |
| 手写组件无静态 variants（约 25 个） | 如 `text/DeltaText.tsx`（无 variant prop，按文本正则自动着色） | 变体提取需三信号交叉：工厂参数 + props 字面量联合类型 + StyleGuide testid |
| CSS 几乎全 token 引用 | `structure/Card.css`：`background: var(--card-bg)` 等 | CSS→Figma 结构映射主要是"声明→绑变量" |
| 变体类名模式 `.cdp-<class>-<variant>` | `Card.css` 的 `.cdp-card-invert` | 变体差异 = 变体后缀类的覆盖声明 |
| loader-hooks 使组件动态 import 在 tsx 可用 | `scripts/check/loader-hooks.ts`（check-fast.ts:42 以副作用引入） | 生成器可 `import "./loader-hooks"` 后 import 组件模块 |
| StyleGuide 用 `data-testid="semantic-<class>-<variant>"` 标记变体格 | `StyleGuide.tsx:594-645` | 变体组合的交叉验证源 |
| tokens.css 共 ~75 个声明，含 alias（`var(--x)` 值）与复合值 | `src/theme/tokens.css` | 解析器输入 |
| vitest 覆盖 scripts/ 目录 | `scripts/check/check-fast.test.ts` 存在，`npm test` = `vitest run` | 测试直接放 `scripts/figma-export/` |

## File Structure

```
narration-video/templates/scripts/figma-export/
├── types.ts                  # TokenRecord / DtcgToken / VariantInfo / ComponentSpec 等全部共享类型
├── tokens-parse.ts           # tokens.css 文本 → TokenRecord[]
├── tokens-map.ts             # collection/group/scope 三张映射表（设计的直译，纯常量）
├── variants-extract.ts       # 组件源码文本 → VariantInfo（工厂参数 + props + testid 三信号）
├── css-parse.ts              # 组件 CSS 文本 → CssRule[]（选择器 + 声明 + token 引用解析）
├── build-tokens-spec.ts      # 入口 1：产出 out/tokens.dtcg.json
├── build-components-spec.ts  # 入口 2：产出 out/components-spec.json
├── build-apply-scripts.ts    # 入口 3：spec → out/apply-*.mjs 分片（喂给 use_figma 的 JS）
├── *.test.ts                 # 各解析器/生成器的 vitest
└── out/                      # 产物（.gitignore 除外：两个 spec JSON 入库，分片不入库）
```

职责边界：types.ts 只放类型；三个解析器（tokens/variants/css）互不依赖、各自可测；三个 build 入口组合解析器产出 JSON；build-apply-scripts 把 spec 编译成自包含 JS 分片（分片内嵌数据，执行时不读文件系统）。

---

### Task 1: 脚手架与共享类型

**Files:**
- Create: `narration-video/templates/scripts/figma-export/types.ts`
- Create: `narration-video/templates/scripts/figma-export/types.test.ts`
- Create: `narration-video/templates/scripts/figma-export/out/.gitkeep`
- Modify: `narration-video/templates/.gitignore`（若不存在则创建：忽略 `scripts/figma-export/out/apply-*.mjs` 与 `progress-*.json`，保留两个 spec JSON）

**Interfaces:**
- Produces（后续所有任务消费的类型，名字逐字使用）:

```typescript
/** tokens.css 解析出的原始记录 */
export interface TokenRecord {
  name: string;            // "--card-bg"
  rawValue: string;        // "var(--surface)" 或 "#1f8a4c"
  aliasOf: string | null;  // "var(--surface)" → "--surface"；非 alias 为 null
  description: string;     // 该声明上方最近的 /* */ 注释，无则 ""
  line: number;            // 行号（诊断用）
}

/** 类型推断结果——决定 Figma 变量类型 */
export type FigmaVarKind = "COLOR" | "FLOAT" | "STRING";

/** spec JSON 里一个变量的完整描述 */
export interface TokenSpec {
  collection: "color" | "size-type" | "motion";
  group: string;           // "primitive" | "semantic" | "type-size" | ...
  name: string;            // collection 内唯一名："card-bg"（斜杠分组路径段）
  kind: FigmaVarKind;
  /** 原始值（非 alias）：COLOR → "#rrggbb"；FLOAT → 数值；STRING → 字符串 */
  value: string | number | null;
  aliasPath: string | null; // alias 目标的 spec 内路径："primitive/surface"
  codeSyntaxWeb: string;   // "--card-bg"
  scopes: string[];        // Figma VariableScope 枚举名数组
  figmaMotion?: { type: "TIME" | "EASING" }; // motion collection 专用
  notes?: string;          // 特殊说明（纯白定稿偏离、fallback 栈等）
}

/** 组件变体信息（三信号合并产物） */
export interface VariantInfo {
  export: string;          // manifest 的 export 名
  group: string;           // manifest 的 group id
  className: string;       // manifest 的 class 段（"card"）
  /** variant 属性表：属性名 → 值列表。大多数组件只有 {"variant": ["plain", ...]} */
  variantProps: Record<string, string[]>;
  defaultVariant: string;  // "plain"
  /** 非 variant 的组件属性（Figma text/number 属性候选） */
  contentProps: { name: string; sample: string }[]; // 如 StatCard: [{name:"number", sample:"+47%"},{name:"label",sample:"打开率"}]
  motionFinalState: boolean; // true = 动效终态组件
  signals: { factory: boolean; propsInterface: boolean; testid: string[] }; // 三信号来源记录
}

/** CSS 解析产物 */
export interface CssRule {
  selector: string;        // ".cdp-card-invert"
  declarations: { prop: string; value: string; tokenRef: string | null }[]; // tokenRef: "var(--surface)" → "--surface"
}

/** components-spec.json 里一个组件条目 */
export interface ComponentSpec {
  export: string; group: string; className: string;
  page: string;            // "03 Structure 结构"
  figmaName: string;       // "Card"（= export）
  descriptionZh: string;   // 组件源码头注释第一行
  variants: VariantInfo;
  css: CssRule[];
  special?: "echart-svg" | "stage-1080p" | "none";
}
```

- [ ] **Step 1: 写类型编译测试**

```typescript
// types.test.ts —— 类型本身无可运行逻辑，用编译期断言锁形状
import type { TokenRecord, TokenSpec, VariantInfo, CssRule, ComponentSpec } from "./types";

const t: TokenRecord = { name: "--x", rawValue: "#fff", aliasOf: null, description: "", line: 1 };
const s: TokenSpec = { collection: "color", group: "primitive", name: "surface", kind: "COLOR", value: "#efe9d9", aliasPath: null, codeSyntaxWeb: "--surface", scopes: ["FRAME_FILL"] };
const v: VariantInfo = { export: "Card", group: "structure", className: "card", variantProps: { variant: ["plain"] }, defaultVariant: "plain", contentProps: [], motionFinalState: false, signals: { factory: true, propsInterface: false, testid: [] } };
const c: CssRule = { selector: ".cdp-card", declarations: [{ prop: "background", value: "var(--card-bg)", tokenRef: "--card-bg" }] };
const cs: ComponentSpec = { export: "Card", group: "structure", className: "card", page: "03 Structure 结构", figmaName: "Card", descriptionZh: "卡片", variants: v, css: [c], special: "none" };
console.log(t, s, v, c, cs); // 引用防 tree-shake
```

- [ ] **Step 2: 建 types.ts（上文接口逐字落盘）并跑测试**

Run: `cd narration-video/templates && npx vitest run scripts/figma-export/types.test.ts`
Expected: PASS（编译通过即过）

- [ ] **Step 3: 建 out/ 目录 + .gitignore 规则 + Commit**

```bash
cd narration-video/templates
mkdir -p scripts/figma-export/out && touch scripts/figma-export/out/.gitkeep
printf 'scripts/figma-export/out/apply-*.mjs\nscripts/figma-export/out/progress-*.json\n' >> .gitignore
git add scripts/figma-export/ .gitignore
git commit -m "feat(figma-export): 脚手架与共享类型

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: tokens.css 解析器

**Files:**
- Create: `narration-video/templates/scripts/figma-export/tokens-parse.ts`
- Test: `narration-video/templates/scripts/figma-export/tokens-parse.test.ts`

**Interfaces:**
- Consumes: `TokenRecord`（Task 1）
- Produces: `parseTokensCss(cssText: string): TokenRecord[]`（纯函数，无 IO）

- [ ] **Step 1: 写失败测试（用真实 tokens.css 的代表性片段）**

```typescript
// tokens-parse.test.ts
import { readFileSync } from "node:fs";
import { parseTokensCss } from "./tokens-parse";

const REAL = readFileSync("src/theme/tokens.css", "utf8");

describe("parseTokensCss", () => {
  it("解析真实 tokens.css：75 条声明", () => {
    const records = parseTokensCss(REAL);
    expect(records.length).toBe(75); // 以 wc 实测为准，执行时先数一遍再改此常量
  });
  it("识别 alias", () => {
    const card = parseTokensCss(REAL).find(r => r.name === "--card-bg")!;
    expect(card.aliasOf).toBe("--surface");
  });
  it("识别硬值 + 上方注释为 description", () => {
    const a1 = parseTokensCss(REAL).find(r => r.name === "--accent-1")!;
    expect(a1.aliasOf).toBeNull();
    expect(a1.rawValue).toBe("#1f8a4c");
  });
  it("复合值保留原文（shadow/border 不进变量，但解析不炸）", () => {
    const sh = parseTokensCss(REAL).find(r => r.name === "--shadow-card")!;
    expect(sh.rawValue).toContain("24px 24px 0");
    expect(sh.aliasOf).toBeNull(); // 复合值不算 alias
  });
  it("字体栈识别", () => {
    const f = parseTokensCss(REAL).find(r => r.name === "--font-body")!;
    expect(f.rawValue).toContain("Space Grotesk");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run scripts/figma-export/tokens-parse.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现解析器**

```typescript
// tokens-parse.ts —— 简单 CSS 声明解析（tokens.css 结构规整，无需完整 CSS parser）
import type { TokenRecord } from "./types";

const VAR_LINE = /^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/;
const COMMENT = /^\s*\/\*\s*(.+?)\s*\*\/\s*$/;

export function parseTokensCss(cssText: string): TokenRecord[] {
  const out: TokenRecord[] = [];
  let pendingComment = "";
  let inRoot = false;
  cssText.split("\n").forEach((line, i) => {
    const n = i + 1;
    if (/^\s*:root\s*\{/.test(line)) { inRoot = true; return; }
    if (inRoot && /^\s*\}/.test(line)) { inRoot = false; return; }
    const c = line.match(COMMENT);
    if (c) { pendingComment = c[1]; return; }
    const m = line.match(VAR_LINE);
    if (!inRoot || !m) return;
    const rawValue = m[2].trim();
    // alias 判定：值是单一 var(--x) 引用（首尾无其他 token）。复合值（shadow 等）不算。
    const alias = rawValue.match(/^var\((--[\w-]+)\)$/);
    out.push({ name: m[1], rawValue, aliasOf: alias ? alias[1] : null, description: pendingComment, line: n });
    pendingComment = ""; // 注释只贴紧邻的下一条声明
  });
  return out;
}
```

- [ ] **Step 4: 跑测试通过（75 若与实测不符，先 `grep -c '^\s*--' src/theme/tokens.css` 校正）**

Run: `npx vitest run scripts/figma-export/tokens-parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/figma-export/tokens-parse.ts scripts/figma-export/tokens-parse.test.ts
git commit -m "feat(figma-export): tokens.css 解析器（alias/注释/复合值识别）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: collection 映射表 + DTCG spec 生成器

**Files:**
- Create: `narration-video/templates/scripts/figma-export/tokens-map.ts`（纯常量）
- Create: `narration-video/templates/scripts/figma-export/build-tokens-spec.ts`
- Test: `narration-video/templates/scripts/figma-export/build-tokens-spec.test.ts`
- Produces: `narration-video/templates/scripts/figma-export/out/tokens.dtcg.json`

**Interfaces:**
- Consumes: `parseTokensCss`（Task 2）、`TokenSpec`（Task 1）
- Produces: `buildTokenSpecs(records: TokenRecord[]): TokenSpec[]`；入口 main 产出 `out/tokens.dtcg.json`

- [ ] **Step 1: 写失败测试**

```typescript
// build-tokens-spec.test.ts
import { readFileSync } from "node:fs";
import { parseTokensCss } from "./tokens-parse";
import { buildTokenSpecs } from "./build-tokens-spec";

const records = parseTokensCss(readFileSync("src/theme/tokens.css", "utf8"));

describe("buildTokenSpecs", () => {
  it("排除复合值 token（shadow 族/border 复合/rule-style）——它们不进 Figma 变量", () => {
    const specs = buildTokenSpecs(records);
    expect(specs.find(s => s.codeSyntaxWeb === "--shadow-card")).toBeUndefined();
    expect(specs.find(s => s.codeSyntaxWeb === "--card-border")).toBeUndefined();
    expect(specs.find(s => s.codeSyntaxWeb === "--rule-style")).toBeUndefined();
    expect(specs.find(s => s.codeSyntaxWeb === "--table-border")).toBeUndefined();
  });
  it("alias 映射到 spec 路径", () => {
    const specs = buildTokenSpecs(records);
    const card = specs.find(s => s.codeSyntaxWeb === "--card-bg")!;
    expect(card.aliasPath).toBe("primitive/surface");
    expect(card.value).toBeNull();
  });
  it("每个变量 code syntax = CSS 原名、scope 非空", () => {
    const specs = buildTokenSpecs(records);
    for (const s of specs) { expect(s.codeSyntaxWeb).toMatch(/^--/); expect(s.scopes.length).toBeGreaterThan(0); }
  });
  it("motion collection：duration 单位换算为秒", () => {
    const specs = buildTokenSpecs(records);
    const fast = specs.find(s => s.codeSyntaxWeb === "--dur-fast")!;
    expect(fast.value).toBe(0.3); // 300ms → 0.3s
    expect(fast.figmaMotion?.type).toBe("TIME");
  });
  it("字体栈只留主字体，notes 记 fallback", () => {
    const specs = buildTokenSpecs(records);
    const body = specs.find(s => s.codeSyntaxWeb === "--font-body")!;
    expect(body.value).toBe("Space Grotesk");
    expect(body.notes).toContain("Noto Sans SC");
  });
  it("caption-bg 记录纯白定稿偏离", () => {
    const specs = buildTokenSpecs(records);
    const cb = specs.find(s => s.codeSyntaxWeb === "--caption-bg")!;
    expect(cb.value).toBe("#ffffff");
    expect(cb.notes).toContain("纯白");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run scripts/figma-export/build-tokens-spec.test.ts` → FAIL

- [ ] **Step 3: 落 tokens-map.ts（spec §3.1 树的直译）**

```typescript
// tokens-map.ts —— spec §3.1 的直译：token 名 → {collection, group, scopes}。
// 完整清单从 spec 树逐条抄录；此处展示结构，执行时必须补全全部 ~70 条（抄 spec，不许自创）。
export const TOKEN_MAP: Record<string, { collection: "color" | "size-type" | "motion"; group: string; scopes: string[] }> = {
  // color / primitive
  "--surface":    { collection: "color", group: "primitive", scopes: ["FRAME_FILL", "SHAPE_FILL"] },
  "--surface-2":  { collection: "color", group: "primitive", scopes: ["FRAME_FILL", "SHAPE_FILL"] },
  "--surface-3":  { collection: "color", group: "primitive", scopes: ["FRAME_FILL", "SHAPE_FILL"] },
  "--text":       { collection: "color", group: "primitive", scopes: ["TEXT_FILL"] },
  "--text-2":     { collection: "color", group: "primitive", scopes: ["TEXT_FILL"] },
  "--text-mute":  { collection: "color", group: "primitive", scopes: ["TEXT_FILL"] },
  "--text-faint": { collection: "color", group: "primitive", scopes: ["TEXT_FILL"] },
  "--accent-1":   { collection: "color", group: "primitive", scopes: ["ALL_FILLS", "STROKE_COLOR"] },
  // …（accent-1-dark/2/2-dark/3/4、rule、shell 同型补全）
  // color / semantic
  "--card-bg":        { collection: "color", group: "semantic", scopes: ["FRAME_FILL", "SHAPE_FILL"] },
  "--badge-bg":       { collection: "color", group: "semantic", scopes: ["FRAME_FILL", "SHAPE_FILL"] },
  "--badge-text":     { collection: "color", group: "semantic", scopes: ["TEXT_FILL"] },
  "--table-head-bg":  { collection: "color", group: "semantic", scopes: ["FRAME_FILL"] },
  "--table-head-text":{ collection: "color", group: "semantic", scopes: ["TEXT_FILL"] },
  "--table-zebra":    { collection: "color", group: "semantic", scopes: ["FRAME_FILL"] },
  "--caption-bg":     { collection: "color", group: "semantic", scopes: ["FRAME_FILL"] },
  "--caption-stroke": { collection: "color", group: "semantic", scopes: ["STROKE_COLOR"] },
  "--caption-text":   { collection: "color", group: "semantic", scopes: ["TEXT_FILL"] },
  "--split-before-text": { collection: "color", group: "semantic", scopes: ["TEXT_FILL"] },
  // size-type / type-size（FONT_SIZE scope）
  "--t-display-1": { collection: "size-type", group: "type-size", scopes: ["FONT_SIZE"] },
  // …（t-display-2/h1/h2/h3/body/label 同型）
  // size-type / space（GAP + PADDING + 宽高）
  "--space-1": { collection: "size-type", group: "space", scopes: ["GAP", "PADDING", "WIDTH", "HEIGHT"] },
  // …（space-2..6、grid-gutter、stage-pad-x/y、headline-gap）
  // size-type / radius
  "--r-card":        { collection: "size-type", group: "radius", scopes: ["CORNER_RADIUS"] },
  "--r-pill":        { collection: "size-type", group: "radius", scopes: ["CORNER_RADIUS"] },
  "--caption-radius":{ collection: "size-type", group: "radius", scopes: ["CORNER_RADIUS"] },
  // size-type / semantic（尺寸）
  "--border-w": { collection: "size-type", group: "semantic", scopes: ["STROKE_WEIGHT"] },
  "--rule-w":   { collection: "size-type", group: "semantic", scopes: ["STROKE_WEIGHT"] },
  // …（split-min-w、split-seam-pad、seal-size、year-bar-w、caption-size：WIDTH/HEIGHT scope）
  // size-type / font
  "--font-display-cn": { collection: "size-type", group: "font", scopes: ["FONT_FAMILY"] },
  "--font-display-en": { collection: "size-type", group: "font", scopes: ["FONT_FAMILY"] },
  "--font-body":       { collection: "size-type", group: "font", scopes: ["FONT_FAMILY"] },
  "--font-mono":       { collection: "size-type", group: "font", scopes: ["FONT_FAMILY"] },
  "--hero-num-font":   { collection: "size-type", group: "font", scopes: ["FONT_FAMILY"] },
  "--hero-num-weight": { collection: "size-type", group: "font", scopes: ["FONT_WEIGHT"] },
  "--hero-num-track":  { collection: "size-type", group: "font", scopes: ["LETTER_SPACING"] },
  "--decor-family":    { collection: "size-type", group: "decor-family", scopes: [] },
  // motion
  "--dur-fast": { collection: "motion", group: "duration", scopes: [] },
  // …（dur-mid/dur-slow/stagger）
  "--ease-in":   { collection: "motion", group: "easing", scopes: [] },
  // …（ease-out/ease-emph）
};

/** 不进 Figma 变量的复合 token（spec §3.3） */
export const EXCLUDED_TOKENS = new Set(["--shadow-card", "--shadow-card-sm", "--shadow-stage", "--card-border", "--table-border", "--rule-style"]);
```

- [ ] **Step 4: 实现 build-tokens-spec.ts**

```typescript
// build-tokens-spec.ts
import * as fs from "node:fs";
import { parseTokensCss } from "./tokens-parse";
import { TOKEN_MAP, EXCLUDED_TOKENS } from "./tokens-map";
import type { TokenRecord, TokenSpec, FigmaVarKind } from "./types";

const HEX = /^#([0-9a-f]{3,8})$/i;
const PX = /^(-?[\d.]+)px$/;
const MS = /^(\d+)ms$/;
const FONT_STACK = /^(["'][^"']+"']|[\w-]+)\s*,/;

function inferKind(r: TokenRecord): FigmaVarKind | null {
  const v = r.rawValue;
  if (HEX.test(v)) return "COLOR";
  if (PX.test(v) || /^[\d.]+$/.test(v) || v.endsWith("em")) return "FLOAT";
  if (FONT_STACK.test(v)) return "STRING";
  if (MS.test(v) || /^cubic-bezier/.test(v)) return "FLOAT"; // motion：TIME/EASING 由 figmaMotion 标
  return null; // 复合值等 → 调用方排除
}

function hexToFigma(r: string): string { return r.length === 4 ? `#${r[1]}${r[1]}${r[2]}${r[2]}${r[3]}${r[3]}` : r; }

function cssName(name: string): string { return name.replace(/^--/, ""); }

export function buildTokenSpecs(records: TokenRecord[]): TokenSpec[] {
  const byName = new Map(records.map(r => [r.name, r]));
  const specs: TokenSpec[] = [];
  for (const r of records) {
    if (EXCLUDED_TOKENS.has(r.name)) continue;
    const map = TOKEN_MAP[r.name];
    if (!map) throw new Error(`tokens-map 缺条目: ${r.name}（tokens.css:${r.line}）——把 spec §3.1 树补全`);
    const kind = inferKind(r);
    const isMotion = map.collection === "motion";
    if (!kind && !isMotion) throw new Error(`无法推断类型: ${r.name} = ${r.rawValue}`);

    let value: string | number | null = null;
    let aliasPath: string | null = null;
    if (r.aliasOf) {
      const target = TOKEN_MAP[r.aliasOf];
      aliasPath = `${target.group}/${cssName(r.aliasOf)}`;
    } else if (isMotion && MS.test(r.rawValue)) {
      value = parseInt(r.rawValue) / 1000;
    } else if (kind === "COLOR") {
      value = hexToFigma(r.rawValue);
    } else if (kind === "FLOAT" && PX.test(r.rawValue)) {
      value = parseFloat(r.rawValue);
    } else if (kind === "FLOAT") {
      value = parseFloat(r.rawValue);
    } else if (kind === "STRING") {
      value = r.rawValue.split(",")[0].replace(/["']/g, "").trim();
    }
    specs.push({
      collection: map.collection, group: map.group, name: cssName(r.name), kind: kind ?? "FLOAT",
      value, aliasPath, codeSyntaxWeb: r.name, scopes: map.scopes,
      figmaMotion: isMotion ? { type: MS.test(r.rawValue) ? "TIME" : "EASING" } : undefined,
      notes: r.name === "--caption-bg" ? "用户定稿纯白（主动偏离设计稿）" : undefined,
    });
  }
  return specs;
}

// 入口：npx tsx scripts/figma-export/build-tokens-spec.ts
if (process.argv[1] && process.argv[1].endsWith("build-tokens-spec.ts")) {
  const records = parseTokensCss(fs.readFileSync("src/theme/tokens.css", "utf8"));
  const specs = buildTokenSpecs(records);
  // 每变量 notes 里补 fallback 栈（字体）
  for (const s of specs) if (s.kind === "STRING") {
    const rec = byName.get(`--${s.name}`)!;
    s.notes = `fallback: ${rec.rawValue}`;
  }
  fs.mkdirSync("scripts/figma-export/out", { recursive: true });
  fs.writeFileSync("scripts/figma-export/out/tokens.dtcg.json", JSON.stringify(specs, null, 2));
  console.log(`tokens.dtcg.json: ${specs.length} variables（${records.length - specs.length} 条复合值排除）`);
}
```

- [ ] **Step 5: 跑测试通过 + 跑入口 + 数量 sanity（`grep -c '^\s*--' src/theme/tokens.css` − 排除数 = spec 数）**

Run: `npx vitest run scripts/figma-export/build-tokens-spec.test.ts && npx tsx scripts/figma-export/build-tokens-spec.ts`
Expected: 测试 PASS；输出变量数 ≈ 69（75 − 6 排除）

- [ ] **Step 6: Commit**

```bash
git add scripts/figma-export/ && git commit -m "feat(figma-export): token spec 生成器（DTCG + codeSyntax/scope，排除复合值）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: use_figma 建 3 个 collection（Figma 侧第一个写操作）

**Files:**
- Create: `narration-video/templates/scripts/figma-export/build-apply-scripts.ts` 中 tokens 部分（本任务先实现 `emitTokensApply()`，组件部分 Task 8 补）
- Produces: `scripts/figma-export/out/apply-tokens.mjs`（自包含 JS，内嵌 tokens.dtcg.json 数据）

**Interfaces:**
- Consumes: `out/tokens.dtcg.json`（Task 3）
- Produces: 自包含 apply 分片；**幂等约定**：脚本开头按名字删除同名 collection 后重建（重跑安全）

- [ ] **Step 1: 实现 emitTokensApply（build-apply-scripts.ts 第一部分）**

```typescript
// build-apply-scripts.ts —— 把 spec 编译成喂给 use_figma 的自包含 JS 分片
import * as fs from "node:fs";
export function emitTokensApply(): string {
  const specs = JSON.parse(fs.readFileSync("scripts/figma-export/out/tokens.dtcg.json", "utf8"));
  return `// apply-tokens.mjs —— 在 Figma 目标文件执行（use_figma）。幂等：先删同名 collection。
const SPECS = ${JSON.stringify(specs)};
const NAME_OF = { color: "CDP · color", "size-type": "CDP · size-type", motion: "CDP · motion" };
// 1. 幂等清理
for (const c of figma.variables.collections) if (Object.values(NAME_OF).includes(c.name)) c.remove();
// 2. 建 collection（每 collection 单 mode，Professional 默认 3 mode 上限远够）
const cols = {};
for (const k of Object.keys(NAME_OF)) cols[k] = figma.variables.createVariableCollection(NAME_OF[k]);
const modeIdOf = c => c.modes[0].modeId;
// 3. 先建全部变量（非 alias），再回填 alias（两遍，避免顺序依赖）
const created = {};
for (const s of SPECS.filter(x => !x.aliasPath)) {
  const v = figma.variables.createVariable(\`\${s.group}/\${s.name}\`, cols[s.collection], s.kind);
  v.setValueForMode(modeIdOf(cols[s.collection]), s.figmaMotion?.type === "TIME" ? { unit: "SECONDS", value: s.value } : s.value);
  created[s.codeSyntaxWeb] = v;
}
for (const s of SPECS.filter(x => x.aliasPath)) {
  const target = Object.entries(created).find(([n]) => n === "--" + s.aliasPath.split("/")[1])?.[1];
  if (!target) throw new Error("alias 目标缺失: " + s.aliasPath);
  const v = figma.variables.createVariable(\`\${s.group}/\${s.name}\`, cols[s.collection], s.kind);
  v.setValueForMode(modeIdOf(cols[s.collection]), figma.variables.createVariableAlias(target));
  created[s.codeSyntaxWeb] = v;
}
// 4. code syntax + scopes + 描述
for (const s of SPECS) {
  const v = created[s.codeSyntaxWeb];
  v.codeSyntax = { WEB: s.codeSyntaxWeb };
  if (s.scopes.length) v.scopes = s.scopes;
  if (s.notes) v.description = s.notes;
}
figma.notify("tokens: " + SPECS.length + " variables, 3 collections ✓");
`;
}
// 入口
if (process.argv[1]?.endsWith("build-apply-scripts.ts")) {
  fs.writeFileSync("scripts/figma-export/out/apply-tokens.mjs", emitTokensApply());
  console.log("apply-tokens.mjs written");
}
```

- [ ] **Step 2: 生成分片 + 语法自检**

Run: `npx tsx scripts/figma-export/build-apply-scripts.ts && node --check scripts/figma-export/out/apply-tokens.mjs`
Expected: 分片写出，语法检查通过

- [ ] **Step 3: 执行（Figma 侧）**

先 `Skill(figma:figma-use)`，然后用 use_figma 在目标文件（file key `S0ca2PukTI731lj9jFtCsX`）执行 apply-tokens.mjs 全文。

- [ ] **Step 4: 读回对账**

用 use_figma 执行只读脚本：

```javascript
const cols = figma.variables.collections.filter(c => c.name.startsWith("CDP · "));
const counts = cols.map(c => ({ name: c.name, vars: c.variables.length }));
counts; // color ≈ 25、size-type ≈ 24、motion ≈ 7，合计 = tokens.dtcg.json 数
```

再抽 3 个变量用 MCP `get_variable_defs` 检查 code syntax：--card-bg / --font-body / --dur-fast。

- [ ] **Step 5: Commit（build-apply-scripts.ts 的 tokens 部分）**

```bash
git add scripts/figma-export/build-apply-scripts.ts
git commit -m "feat(figma-export): tokens apply 分片生成器 + Figma 三 collection 已建（对账通过）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: variants 三信号提取器

**Files:**
- Create: `narration-video/templates/scripts/figma-export/variants-extract.ts`
- Test: `narration-video/templates/scripts/figma-export/variants-extract.test.ts`

**Interfaces:**
- Consumes: `VariantInfo`（Task 1）；输入 = 组件 .tsx 源码文本 + StyleGuide.tsx 文本 + manifest COMPONENTS
- Produces: `extractVariants(manifestComponents, sourceOf, styleguideText): VariantInfo[]`

**三信号规则（写死在实现里）：**
1. 工厂信号：源码文本匹配 `variants: ["a", "b", ...]` → variantProps.variant
2. props 信号：`variant?: "a" | "b"`（或 `direction?:`、`tone?:` 等字面量联合）的属性名+值 → variantProps；`text?: string`/`number?: string` 类 → contentProps
3. testid 信号：StyleGuide 文本里 `semantic-<class>-<value>` 的 value 并集，与 1/2 交叉验证——工厂/props 有而目录没有的变体**保留**（目录可能压缩），目录有而 1/2 没有的**报 warning**（生成器不自创变体，人工裁决）

- [ ] **Step 1: 写失败测试**

```typescript
// variants-extract.test.ts
import { extractVariants } from "./variants-extract";
import { COMPONENTS } from "../../src/components/manifest";

const CARD_SRC = `import { createPrimitive } from "../_internal/factory";
export const Card = createPrimitive("card", { tag: "div", variants: ["plain", "invert", "accent"], defaultVariant: "plain" });`;
const STAT_SRC = `export interface StatCardProps { number: string; label: string; variant?: "plain" | "invert" | "accent"; }`;
const DELTA_SRC = `export interface DeltaTextProps { text: string; className?: string; }`;
const SG = `<Card variant="plain" data-testid="semantic-card-plain" />`;

describe("extractVariants", () => {
  it("工厂信号", () => {
    const [v] = extractVariants([{ export: "Card", group: "structure", class: "card" }], () => CARD_SRC, SG);
    expect(v.variantProps).toEqual({ variant: ["plain", "invert", "accent"] });
    expect(v.signals.factory).toBe(true);
  });
  it("props 信号 + contentProps", () => {
    const [v] = extractVariants([{ export: "StatCard", group: "data", class: "stat-card" }], () => STAT_SRC, "");
    expect(v.variantProps.variant).toEqual(["plain", "invert", "accent"]);
    expect(v.contentProps.map(c => c.name)).toEqual(["number", "label"]);
  });
  it("无变体组件（DeltaText）→ 空 variantProps，不报错", () => {
    const [v] = extractVariants([{ export: "DeltaText", group: "text", class: "delta-text" }], () => DELTA_SRC, "");
    expect(v.variantProps).toEqual({});
  });
  it("testid 交叉：目录独有的变体产生 warning 而非自创", () => {
    const warns: string[] = [];
    extractVariants([{ export: "X", group: "text", class: "x" }], () => "", `data-testid="semantic-x-foo"`, warns);
    expect(warns[0]).toContain("x");
  });
  it("真实 manifest 全量跑：44 个组件全有条目", () => {
    const all = extractVariants(COMPONENTS, (c) => require("node:fs").readFileSync(`src/components/${c.group}/${c.export}.tsx`, "utf8"), require("node:fs").readFileSync("src/StyleGuide.tsx", "utf8"));
    expect(all.length).toBe(44);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现提取器（正则三信号 + 动效终态清单）**

```typescript
// variants-extract.ts
import type { VariantInfo } from "./types";
import { readFileSync } from "node:fs";

/** 动效终态组件（spec §4.2：reveal 全组 + 动画语义组件） */
const MOTION_FINAL = new Set(["RevealText", "RevealList", "StepSequence", "StaggerRow", "Counter", "BarGrow", "DonutMeter", "YearBarGroup", "PathDraw", "TypedTerminal", "KenBurns", "Breathe", "SeededParticles", "ProgressDots", "TimelineTrack", "StepStairs"]);

const FACTORY_VARIANTS = /variants:\s*\[([^\]]*)\]/;
const PROP_UNION = /(\w+)\?\s*:\s*"([^"]+)"(?:\s*\|\s*"([^"]+)")+/g;
const CONTENT_PROP = /^\s*(\w+)\??\s*:\s*string/gm;
const TESTID = /data-testid="semantic-([\w-]+)-([\w-]+)"/g;

export function extractVariants(
  components: { export: string; group: string; class: string }[],
  sourceOf: (c: { group: string; export: string }) => string,
  styleguideText: string,
  warnings: string[] = [],
): VariantInfo[] {
  const sgVariants = new Map<string, Set<string>>();
  for (const m of styleguideText.matchAll(TESTID)) {
    const key = m[1]; (sgVariants.get(key) ?? sgVariants.set(key, new Set()).get(key)!).add(m[2]);
  }
  return components.map(c => {
    const src = sourceOf(c);
    const variantProps: Record<string, string[]> = {};
    let factory = false, propsInterface = false;
    const f = src.match(FACTORY_VARIANTS);
    if (f) { factory = true; variantProps.variant = [...f[1].matchAll(/"([^"]+)"/g)].map(x => x[1]); }
    for (const m of src.matchAll(PROP_UNION)) {
      if (m[1] === "variant" || ["direction", "tone", "state", "size"].includes(m[1])) {
        propsInterface = true;
        const values = m[0].slice(m[0].indexOf(":") + 1).match(/"([^"]+)"/g)!.map(s => s.slice(1, -1));
        if (!variantProps[m[1]]) variantProps[m[1]] = values;
      }
    }
    const contentProps = [...src.matchAll(CONTENT_PROP)].map(m => ({ name: m[1], sample: SAMPLES[m[1]] ?? "示例" })).filter(p => !["className"].includes(p.name));
    // testid 交叉校验
    const sg = sgVariants.get(c.class);
    if (sg) for (const val of sg) {
      const known = Object.values(variantProps).flat();
      if (!known.includes(val)) warnings.push(`目录有而源码无: ${c.export} = ${val}（人工裁决）`);
    }
    return {
      export: c.export, group: c.group, className: c.class, variantProps,
      defaultVariant: variantProps.variant?.[0] ?? "",
      contentProps, motionFinalState: MOTION_FINAL.has(c.export),
      signals: { factory, propsInterface, testid: sg ? [...sg] : [] },
    };
  });
}
const SAMPLES: Record<string, string> = { number: "+47%", label: "打开率", text: "示例文本", value: "+47%", title: "标题", lines: "npm install" };
export { readFileSync };
```

- [ ] **Step 4: 跑测试通过** → `npx vitest run scripts/figma-export/variants-extract.test.ts` PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/figma-export/variants-extract.ts scripts/figma-export/variants-extract.test.ts
git commit -m "feat(figma-export): variants 三信号提取器（工厂参数/props 枚举/testid 交叉）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 组件 CSS 解析器

**Files:**
- Create: `narration-video/templates/scripts/figma-export/css-parse.ts`
- Test: `narration-video/templates/scripts/figma-export/css-parse.test.ts`

**Interfaces:**
- Consumes: `CssRule`（Task 1）
- Produces: `parseComponentCss(cssText: string): CssRule[]`

- [ ] **Step 1: 写失败测试**

```typescript
// css-parse.test.ts
import { readFileSync } from "node:fs";
import { parseComponentCss } from "./css-parse";

const CARD = readFileSync("src/components/structure/Card.css", "utf8");

describe("parseComponentCss", () => {
  it("解析真实 Card.css：3 条规则", () => {
    expect(parseComponentCss(CARD).length).toBe(3);
  });
  it("token 引用解析", () => {
    const base = parseComponentCss(CARD).find(r => r.selector === ".cdp-card")!;
    const bg = base.declarations.find(d => d.prop === "background")!;
    expect(bg.tokenRef).toBe("--card-bg");
    const pad = base.declarations.find(d => d.prop === "padding")!;
    expect(pad.tokenRef).toBe("--space-4");
  });
  it("变体类选择器保留全名", () => {
    expect(parseComponentCss(CARD).map(r => r.selector)).toEqual([".cdp-card", ".cdp-card-invert", ".cdp-card-accent"]);
  });
  it("复合值声明（var(--shadow-card-sm)）tokenRef 原样", () => {
    const base = parseComponentCss(CARD).find(r => r.selector === ".cdp-card")!;
    expect(base.declarations.find(d => d.prop === "box-shadow")!.tokenRef).toBe("--shadow-card-sm");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → FAIL

- [ ] **Step 3: 实现（简单状态机：选择器行 { 声明行 } 注释跳过；`var(--x)` 提取 tokenRef，无则 null）**

```typescript
// css-parse.ts
import type { CssRule } from "./types";

export function parseComponentCss(cssText: string): CssRule[] {
  const out: CssRule[] = [];
  let current: CssRule | null = null;
  for (const rawLine of cssText.split("\n")) {
    const line = rawLine.replace(/\/\*.*?\*\//g, "").trim();
    if (!line) continue;
    const sel = line.match(/^(.+?)\s*\{$/);
    if (sel) { current = { selector: sel[1].trim(), declarations: [] }; continue; }
    if (line === "}") { if (current) out.push(current); current = null; continue; }
    const d = line.match(/^([\w-]+)\s*:\s*(.+?);?$/);
    if (d && current) {
      const ref = d[2].match(/var\((--[\w-]+)\)/);
      current.declarations.push({ prop: d[1], value: d[2].replace(/;$/, ""), tokenRef: ref ? ref[1] : null });
    }
  }
  return out;
}
```

- [ ] **Step 4: 跑测试通过** → PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/figma-export/css-parse.ts scripts/figma-export/css-parse.test.ts
git commit -m "feat(figma-export): 组件 CSS 解析器（选择器/声明/token 引用）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: components-spec.json 组装

**Files:**
- Create: `narration-video/templates/scripts/figma-export/build-components-spec.ts`
- Test: `narration-video/templates/scripts/figma-export/build-components-spec.test.ts`
- Produces: `scripts/figma-export/out/components-spec.json`

**Interfaces:**
- Consumes: `extractVariants`（Task 5）、`parseComponentCss`（Task 6）、manifest `GROUPS`/`COMPONENTS`
- Produces: `buildComponentSpecs(): ComponentSpec[]`；页面名规则 = `序号(两位) En 中文`（GROUPS 序 + labelEn/labelZh，如 `03 Structure 结构`）

- [ ] **Step 1: 写失败测试**

```typescript
// build-components-spec.test.ts
import { buildComponentSpecs } from "./build-components-spec";

describe("buildComponentSpecs", () => {
  it("44 个组件、页面名带数字前缀、figmaName = export 名", () => {
    const specs = buildComponentSpecs();
    expect(specs.length).toBe(44);
    const card = specs.find(s => s.export === "Card")!;
    expect(card.page).toBe("03 Structure 结构");
    expect(card.figmaName).toBe("Card");
    expect(card.css.length).toBeGreaterThan(0);
  });
  it("descriptionZh 来自组件源码头注释第一行", () => {
    const card = buildComponentSpecs().find(s => s.export === "Card")!;
    expect(card.descriptionZh).toContain("卡片");
  });
  it("EChart 标 special=echart-svg；StagePad 标 stage-1080p；动效组件 motionFinalState", () => {
    const specs = buildComponentSpecs();
    expect(specs.find(s => s.export === "EChart")!.special).toBe("echart-svg");
    expect(specs.find(s => s.export === "StagePad")!.special).toBe("stage-1080p");
    expect(specs.find(s => s.export === "KenBurns")!.variants.motionFinalState).toBe(true);
  });
  it("manifest 变体冲突清单为空或已知（warnings 打印）", () => {
    const warns: string[] = [];
    buildComponentSpecs(warns);
    console.log("warnings:", warns); // 人工过目：目录有而源码无的变体
  });
});
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现 build-components-spec.ts**

```typescript
// build-components-spec.ts
import * as fs from "node:fs";
import { COMPONENTS, GROUPS } from "../../src/components/manifest";
import { extractVariants } from "./variants-extract";
import { parseComponentCss } from "./css-parse";
import type { ComponentSpec } from "./types";

const SPECIALS: Record<string, ComponentSpec["special"]> = { EChart: "echart-svg", StagePad: "stage-1080p" };

export function buildComponentSpecs(warnings: string[] = []): ComponentSpec[] {
  const sg = fs.readFileSync("src/StyleGuide.tsx", "utf8");
  const srcOf = (c: { group: string; export: string }) => fs.readFileSync(`src/components/${c.group}/${c.export}.tsx`, "utf8");
  const variants = extractVariants(COMPONENTS, srcOf, sg, warnings);
  return variants.map((v, i) => {
    const entry = COMPONENTS[i];
    const css = parseComponentCss(fs.readFileSync(`src/components/${entry.group}/${entry.export}.css`, "utf8"));
    const g = GROUPS.find(g => g.id === entry.group)!;
    const head = srcOf(entry).match(/\/\*\*(.+?)\*\//s);
    return {
      ...v, className: v.className,
      page: `${String(GROUPS.indexOf(g) + 1).padStart(2, "0")} ${g.labelEn} ${g.labelZh}`,
      figmaName: entry.export,
      descriptionZh: head ? head[1].trim().split("\n")[0].replace(/^\s*\*?\s*/, "") : entry.export,
      css, special: SPECIALS[entry.export] ?? "none",
    };
  });
}

if (process.argv[1]?.endsWith("build-components-spec.ts")) {
  const warns: string[] = [];
  const specs = buildComponentSpecs(warns);
  fs.mkdirSync("scripts/figma-export/out", { recursive: true });
  fs.writeFileSync("scripts/figma-export/out/components-spec.json", JSON.stringify(specs, null, 2));
  console.log(`components-spec.json: ${specs.length} 组件；warnings ${warns.length} 条`);
  warns.forEach(w => console.log("  ⚠", w));
}
```

注意：`text/DeltaText.tsx` 等**没有对应 CSS 的组件**（纯 TSX 着色逻辑）——`fs.readFileSync` 会抛错。处理：catch ENOENT 则 `css: []`，其 Figma 结构由 apply 编译器特例处理（DeltaText = Text 节点 + 富文本着色说明进 description）。在实现里补：

```typescript
let css = [];
try { css = parseComponentCss(fs.readFileSync(`src/components/${entry.group}/${entry.export}.css`, "utf8")); } catch {}
```

- [ ] **Step 4: 跑测试 + 入口 + 人工过目 warnings**

Run: `npx vitest run scripts/figma-export/build-components-spec.test.ts && npx tsx scripts/figma-export/build-components-spec.ts`
Expected: PASS、44 组件；warnings 逐条人工裁决（补进 TOKEN 类映射或确认为目录命名差异），裁决结果记录在 spec JSON 的 notes 或计划执行记录里

- [ ] **Step 5: Commit**

```bash
git add scripts/figma-export/ && git commit -m "feat(figma-export): components-spec 组装器（44 组件 + 变体 + CSS 结构）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: apply 编译器（spec → use_figma JS）+ Card 样板

**Files:**
- Modify: `narration-video/templates/scripts/figma-export/build-apply-scripts.ts`（补 `emitPageScaffold()` 与 `emitComponentApply(group)`）
- Test: `narration-video/templates/scripts/figma-export/build-apply-scripts.test.ts`
- Produces: `out/apply-pages.mjs`（建 00-09 页）+ `out/apply-group-*.mjs`（每组一片，内嵌该组组件数据）

**Interfaces:**
- Consumes: `out/components-spec.json`（Task 7）
- Produces: 分片约定——每片开头按页名找/建 page、按组件名删旧重建（幂等）；组件构建 JS 的**通用模式**（每组件一致）：

```javascript
// 模式（apply 编译器对每个组件产出此结构的参数化实例，Card 为例）
const F = "Space Grotesk";            // 主字体（等每组件 css 的 font 声明解析，未声明用 body）
await figma.loadFontAsync({ family: F, style: "Regular" });
// 1. 每变体一个 Component
for (const val of ["plain", "invert", "accent"]) {
  const comp = figma.createComponent();
  comp.name = `variant=${val}`;       // 组件集内命名即属性
  comp.layoutMode = "VERTICAL"; comp.primaryAxisSizingMode = "AUTO"; counterAxisSizingMode = "AUTO";
  comp.paddingLeft = comp.paddingRight = comp.paddingTop = comp.paddingBottom = 32;
  await bindNumber(comp, "paddingLeft", "--space-4");   // setBoundVariable('paddingLeft', v)
  // fills 绑变量
  setFill(comp, val === "plain" ? "--card-bg" : val === "invert" ? "--surface-3" : "--accent-1");
  comp.strokes = [SOLID]; comp.strokeWeight = 4; await bindNumber(comp, "strokeWeight" , "--border-w");
  bindStroke(comp, "--text");
  comp.cornerRadius = 0; await bindNumber(comp, "cornerRadius", "--r-card");
  // 阴影：颜色绑变量、几何写死（spec §3.3）
  comp.effects = [shadow(12, "--accent-3", 0), shadow(12, "--surface-3", 4)];
  // 文本子节点 + text property
  const label = comp.findOne(n => n.type === "TEXT") /* …创建 Text，字号绑 --t-label */;
  comps.push(comp);
}
// 2. 合并为组件集
const set = figma.combineAsVariants(comps, pageFor("03 Structure 结构"));
set.name = "Card";
set.description = "卡片（cdp-card）";
```

其中 `bindNumber/bindStroke/setFill/shadow` 是分片内辅助函数（由编译器内联生成，绑定用 `figma.variables.getVariablesInLocalLibrary?` → 本文件直接 `figma.variables.collections` 里按 codeSyntaxWeb 找变量——分片内置 `findVar('--space-4')` 辅助）。

- [ ] **Step 1: 写失败测试（编译器输出的 JS 可被 node --check + 包含关键调用）**

```typescript
// build-apply-scripts.test.ts
import { emitPageScaffold, emitComponentApply } from "./build-apply-scripts";
import * as fs from "node:fs";

describe("emit", () => {
  it("页脚手架含 00 Foundation 与 09 Chart 图表", () => {
    const js = emitPageScaffold();
    expect(js).toContain("00 Foundation");
    expect(js).toContain("09 Chart 图表");
  });
  it("structure组分片：Card 三变体 + combineAsVariants + 绑定辅助", () => {
    const js = emitComponentApply("structure");
    expect(js).toContain('variant=');
    expect(js).toContain("combineAsVariants");
    expect(js.match(/combineAsVariants/g)!.length).toBe(9); // structure 组 9 组件
    fs.writeFileSync("scripts/figma-export/out/apply-group-structure.mjs", js);
  });
});
```

- [ ] **Step 2: 确认失败** → FAIL

- [ ] **Step 3: 实现两个 emit 函数**

实现要点（照此写，不是占位）：
- `emitPageScaffold()`：输出 JS——遍历 `["00 Foundation", ...GROUPS 序号页]`，`figma.createPage(name)` 若不存在（幂等）；删除默认 "Page 1" 若为空。
- `emitComponentApply(group)`：读 components-spec.json 过滤该组；对每组件按"通用模式"生成参数化 JS：变体列表来自 variantProps.variant（多属性时属性值用 `,` 连接成 `prop1=v1, prop2=v2` 命名，笛卡尔积只取 spec 里 CSS/源码实际支持的组合——**单属性组件占绝大多数，多属性仅在 props 信号出现时生成全组合**）；结构节点从 CssRule 生成——`.cdp-<class>` 基类的 padding/gap→layout 参数、background→fills、border→strokes、font/size→Text 参数，全部经 `bindXxx` 辅助绑 token；`.cdp-<class>-<variant>` 覆盖类的声明生成该变体的差异绑定。contentProps 生成 `addComponentProperty(name, 'TEXT', sample)`。motionFinalState 组件：description 加"动效终态，动画参数见 motion collection"。special=echart-svg：分片内该组件只建容器 frame + 占位说明文本（SVG 注入在 Task 12）。special=stage-1080p：frame 1920×1080。
- 编译器对 CSS 里**无法映射的声明**（grid、position、animation）收集进该组件 description 末尾的"代码差异注记"段（如实边界，不静默丢弃）。

- [ ] **Step 4: 测试通过 + node --check 全部分片** → PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/figma-export/ && git commit -m "feat(figma-export): apply 编译器（页脚手架 + 组分片 + 绑定辅助生成）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Figma 执行——页脚手架 + text 组 + data 组

**Files:** 无新文件（执行型任务）；产物在 Figma 侧

- [ ] **Step 1: 加载 `Skill(figma:figma-use)`**

- [ ] **Step 2: 执行 apply-pages.mjs（use_figma，目标文件 `S0ca2PukTI731lj9jFtCsX`）**

验收：get_metadata 列出 10 页（00-09）

- [ ] **Step 3: 生成并执行 apply-group-text.mjs → apply-group-data.mjs**

Run: `npx tsx scripts/figma-export/build-apply-scripts.ts --group text`（编译器入口补 `--group` 参数过滤）→ use_figma 执行分片

- [ ] **Step 4: 截图验收**

`get_screenshot` 截 text/data 页 → 与 Playwright 截 `?styleguide=1` 对应组比对（肉眼初检，正式对照在 Task 13）；明显偏差当场修分片重跑（幂等保证安全）

- [ ] **Step 5: 落盘进度 + Commit**

```bash
printf '{"pages":10,"done":["text","data"]}' > scripts/figma-export/out/progress-groups.json
git add scripts/figma-export/build-apply-scripts.ts  # 若执行中修了编译器
git commit -m "feat(figma): text+data 组 15 组件集已建（Figma 侧）

Co-Authored-By: Claude Code <noreply@anthropic.com>" || true
```

---

### Task 10: Figma 执行——structure + reveal + decor 组

同 Task 9 模式：`--group structure` → `--group reveal` → `--group decor`，逐组执行 + 截图初检 + progress 更新（22 组件，累计 37）。

SplitCompare（蒙版复杂）与 StackedBlocks/StepStairs 若编译器产出的结构明显失真：按 spec §7 允许退化为占位 frame + description 标注"手工精修"，记录到 progress-groups.json 的 `manual: [...]`。

Commit: `feat(figma): structure+reveal+decor 组 20 组件集已建`（带 Co-Authored-By）

---

### Task 11: Figma 执行——media + ambient + chrome 组 + EChart SVG 注入

同 Task 9 模式执行三个小组（8 组件）。

**EChart 特例（special=echart-svg）——SVG 获取步骤：**

1. Playwright 打开 `http://localhost:5174/?styleguide=1`（dev server 若停则 `npm run dev` 重起，端口以实际输出为准）
2. 执行 `document.querySelector('.cdp-echart svg')?.outerHTML` 取 SVG 字符串，存 `out/echart-sample.svg`
3. use_figma 执行注入 JS：`const svg = figma.createNodeFromSvg(SVG_STRING); svg.name="EChart sample (data illustrative)"; // 挂到 09 页 EChart 组件内`，description 标"数据示意"

Commit: `feat(figma): media+ambient+chrome 组 + EChart SVG 注入（44/44 组件集就位）`

---

### Task 12: 00 Foundation 页 + 组件文档补全

**Files:** 无新文件；编译器补 `emitFoundationPage()`

- [ ] **Step 1: 实现 emitFoundationPage()**：色板（3 collection 全变量按 group 排开：色块 + 名称 + hex + code syntax 文本）、字阶 7 档样字（"Aa 打开率 +47%"）、间距 7 档标尺条、动效三档说明文本（时长值文本，非动画）。输出 `out/apply-foundation.mjs` + `node --check`
- [ ] **Step 2: use_figma 执行**；验收：截图含全部色块（数量 = color collection 变量数）
- [ ] **Step 3: 全库 description 巡检**：use_figma 只读脚本断言 44 组件集 description 非空且含 `cdp-` class 名；动效组件含"终态"字样
- [ ] **Step 4: Commit** `feat(figma): Foundation 样张页 + 组件描述巡检通过`

---

### Task 13: 数量对账 + Dev Mode 体检

**Files:**
- Create: `narration-video/templates/scripts/figma-export/verify-counts.ts`（只读对账脚本，产出报告文本）

- [ ] **Step 1: 实现对账脚本**（use_figma 只读 JS 的生成器）：variables 总数/每 collection 数 vs tokens.dtcg.json；component set 数 vs 44；每组件集变体数 vs components-spec.json 的 variantProps 展开。输出 markdown 报告到 `out/verify-report.md`
- [ ] **Step 2: 执行 + 修复循环**：任何不匹配 → 修编译器/分片 → 重跑对应组（幂等）→ 直至全绿
- [ ] **Step 3: Dev Mode 体检**（人工，5 分钟）：桌面端打开文件，Dev Mode 选中 Card → Inspect 显示 `var(--card-bg)`、`var(--space-4)`；选中 HeroNumber → `var(--t-display-1)`。截图留档 `out/devmode-check.png`
- [ ] **Step 4: Commit** `feat(figma-export): 对账脚本 + 全量对账通过（spec 验收 1/2 条）`

---

### Task 14: 视觉对照 + 拖用 smoke + 收尾

- [ ] **Step 1: 视觉对照**：Playwright 逐组截 `?styleguide=1`（`page.screenshot` 或按组元素定位）vs Figma `get_screenshot` 各组页；并排放进 `out/compare/`，人工过目，差异清单记 `out/visual-diff.md`（含"接受的差异"如动效、密度压缩——StyleGuide 目录有字阶压缩覆写，属预期差异要注明）
- [ ] **Step 2: 拖用 smoke test**（人工）：新建空 Figma 文件 → 资产面板启用本文件库 → 拖 Card/DeltaText/EChart 实例 → 切 Card variant plain↔invert↔accent 正常 → 截图 `out/smoke.png`
- [ ] **Step 3: spec 状态更新**：spec 文档头部状态改"已实施（2026-09-XX）"，补实施结果摘要（变量数/组件数/已知差异指针）
- [ ] **Step 4: Commit + 收尾汇报**

```bash
git add docs/superpowers/specs/2026-09-15-figma-component-library-design.md narration-video/templates/scripts/figma-export/
git commit -m "feat(figma): 组件库镜像完成（44 组件集 + 3 collection，视觉对照与拖用验收通过）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **Spec 覆盖**：§3 token（Task 2-4）、§4.1 页面（Task 8-9）、§4.2 组件集（Task 5-11）、§5 流程（任务序即 Phase 序）、§6 验收 4 条（Task 13×2、14×2）、§7 风险（幂等/字体/EChart/退化路径/漂移各有落点）✓
- **类型一致**：TokenRecord/TokenSpec/VariantInfo/CssRule/ComponentSpec 全程同名；函数名 parseTokensCss/buildTokenSpecs/extractVariants/parseComponentCss/buildComponentSpecs/emitPageScaffold/emitComponentApply/emitFoundationPage 各任务引用一致 ✓
- **占位符扫描**：Task 3 的 TOKEN_MAP "…同型补全" 是**数据抄录指令**（来源=spec §3.1 树逐条），非逻辑占位；其余步骤均含可执行代码或精确操作 ✓
- **已知执行风险**：use_figma 的 Plugin API 细节（如 setBoundVariable 的属性名枚举、createVariableAlias 签名）以 figma-use skill 当场指导为准，分片模式不变
