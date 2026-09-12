# M3a 静态门禁（check:fast 15 项 + 终审扩展）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设计 §11.1 的静态扫描 15 项 + 终审扩展项 + 视觉规则 V1-V14 的可机器化部分，实现为 `npm run check`（check:fast 层）——persistent findings gate + exit code，blocker 不过 = 不能汇报完成。

**Architecture:** 一个 tsx 脚本 `scripts/check-fast.ts`（复用现有 lintCssText/lintComponentCss/validateTheme 内核）+ 章节层扫描器（CSS/TSX AST）+ 夹具驱动的负样本与 false-positive 测试。扫描范围 = 章节层（chapters/ 的 CSS/TSX/SVG 属性）+ 组件层（contract-lint 已有）+ 主题层（validateTheme 已有）。

**Tech Stack:** 继承（tsx 已装）；新增 typescript compiler API 用法（typescript 包已装）。

**Spec:** `../07-design-draft.md`（§11.1 静态扫描表、§11.2 负样本、§12b 视觉规则集）。

## Global Constraints

- 扫描范围 = 章节层 CSS 文件 + TSX inline style + SVG 属性（§11.1 堵旁路）
- blocker 不过 = exit 非零 = 不能汇报完成；warning 计入报告、汇报时逐条说明（§11.1）
- **门禁测试双护栏**（终审流程教训，强制）：每个验证器测试含【故意违规负样本】+【输入非空护栏】
- 组件目录（components/）由既有 contract-lint 管（本计划接线不重写）；主题层由 validateTheme 管（接线）
- 复用内核：lintCssText（contract-lint 导出）、validateTheme（theme-validate）、extractVarRefs
- 视觉规则机器化子集（§12b）：V3 字幕结尾禁标点（narrations 文本）、V4 最小字号 ≥24px（章节层 CSS font-size 裸值 <24 报错）
- 白名单豁免与设计一致（§11.1 #2 white/black 例外、#6 token 化渐变豁免、Table 紧凑豁免不在本层）

## File Structure（本计划新建）

```
narration-video/templates/
  scripts/check-fast.ts          # 门禁入口（findings 模型 + 扫描器编排 + exit code）
  scripts/check/scanner-css.ts   # 章节层 CSS 扫描器（复用 lintCssText 内核扩展）
  scripts/check/scanner-tsx.ts   # 章节层 TSX/AST 扫描器（typescript API）
  scripts/check/scanner-text.ts  # narrations 文本扫描（反 AI 味 + 字幕标点 + manifest 一致性）
  scripts/check/scanner-assets.ts# 资源类检查（外链/音频完整性/字体声明/文档 lint）
  scripts/check/findings.ts      # Finding 模型 + 分级 + 报告渲染
  scripts/check/__fixtures__/    # 负样本夹具 + false-positive 集
  scripts/check/check-fast.test.ts # 门禁测试（夹具驱动 + 双护栏）
  package.json                   # check 脚本替换占位
```

---

### Task 1: findings 模型 + 报告渲染

**Files:**
- Create: `narration-video/templates/scripts/check/findings.ts`
- Test: `narration-video/templates/scripts/check/findings.test.ts`

**Interfaces:**
- Produces: `Severity = "blocker" | "warning"`、`Finding { rule: string; severity: Severity; location: string; message: string }`、`FindingBag { add(f); hasBlockers(): boolean; render(): string }`、`exitCode(): number`（blocker 存在 = 1）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { FindingBag } from "./findings";

describe("findings 模型", () => {
  it("blocker 决定 exit code 1，否则 0", () => {
    const a = new FindingBag();
    expect(a.exitCode()).toBe(0);
    a.add({ rule: "r", severity: "warning", location: "f.ts:1", message: "m" });
    expect(a.exitCode()).toBe(0);
    a.add({ rule: "r2", severity: "blocker", location: "f.ts:2", message: "m2" });
    expect(a.exitCode()).toBe(1);
    expect(a.hasBlockers()).toBe(true);
  });

  it("render 输出分级清单（含计数与非空护栏语义）", () => {
    const a = new FindingBag();
    a.add({ rule: "禁硬编码色", severity: "blocker", location: "chapters/01/x.css:3", message: "裸色值 #f00" });
    a.add({ rule: "字阶校验", severity: "warning", location: "chapters/01/x.css:7", message: "字号 20px 低于最小字号 24px" });
    const out = a.render();
    expect(out).toContain("[blocker]");
    expect(out).toContain("[warning]");
    expect(out).toContain("禁硬编码色");
    expect(out).toContain("chapters/01/x.css:3");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** → RED（模块不存在）
- [ ] **Step 3: 写实现**（findings.ts：FindingBag 类，add 追加、render 分组列出、exitCode）
- [ ] **Step 4: 跑测试确认通过** → GREEN
- [ ] **Step 5: Commit** `feat(M3a): findings 模型与报告渲染`

---

### Task 2: 章节层 CSS 扫描器（复用 lintCssText 内核扩展）

**Files:**
- Create: `narration-video/templates/scripts/check/scanner-css.ts`
- Modify: `narration-video/templates/src/components/contract-lint.ts`（若 lintCssText 需扩展豁免参数——保持零改动优先）
- Test: `narration-video/templates/scripts/check/scanner-css.test.ts`

**Interfaces:**
- Consumes: `lintCssText`（contract-lint 导出）
- Produces: `scanChapterCss(cssFiles: { path: string; css: string }[]): Finding[]`——规则：禁硬编码色（#2，white/black 豁免）/禁硬编码字体（#3）/禁裸动画时长（#4 CSS 部分）/禁裸紫粉渐变（#6，token 化渐变豁免）/禁 emoji（#6b）/字阶成员校验（#5 warning：font-size 裸 px ∉ 字阶集合）/间距 px ∈ --space（#5b warning）/**V4 最小字号 ≥24px**（font-size 裸值 <24 → warning）

- [ ] **Step 1: 写失败测试**（负样本 + 非空护栏 + false-positive 集）：

```ts
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
    expect(rules.some((f) => f.rule === "最小字号" && f.severity === "warning")).toBe(true);
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
});
```

- [ ] **Step 2: 跑测试确认失败** → RED
- [ ] **Step 3: 写实现**（scanner-css.ts：逐行扫描，规则如上；字阶集合从 tokens.css 解析或硬编码档位清单与主题校验器同源——实现时选同源方案）
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Commit** `feat(M3a): 章节层 CSS 扫描器（色/字体/动画/渐变/emoji/字阶/最小字号）`

---

### Task 3: 章节层 TSX/AST 扫描器

**Files:**
- Create: `narration-video/templates/scripts/check/scanner-tsx.ts`
- Test: `narration-video/templates/scripts/check/scanner-tsx.test.ts`

**Interfaces:**
- Produces: `scanChapterTsx(files: { path: string; source: string }[]): Finding[]`——规则：inline style 色值（#2 旁路）/SVG 属性 fill·stroke 色值（#2 旁路）/黑名单 AST（#7：setTimeout/setInterval/Math.random/performance.now/requestAnimationFrame/new Date()——引擎目录豁免）/无限循环动画（#8：CSS 侧已查，此处查 JS 内 `iterations: Infinity` 字面量）/**JS easing 字面量**（终审扩展：组件外章节层 `cubic-bezier(` 裸值）

- [ ] **Step 1: 写失败测试**（负样本：inline style 色、SVG fill、setTimeout、iterations: Infinity、cubic-bezier 裸值；false-positive：engine/ 目录豁免、组件目录豁免、合法 var()）
- [ ] **Step 2: RED → Step 3: 实现（typescript API 或健壮正则——实现者按可靠性选择，报告说明）→ Step 4: GREEN**
- [ ] **Step 5: Commit** `feat(M3a): 章节层 TSX/AST 扫描器（inline/SVG 旁路 + 黑名单 + 无限动画 + JS easing）`

---

### Task 4: narrations 文本扫描 + manifest 一致性

**Files:**
- Create: `narration-video/templates/scripts/check/scanner-text.ts`
- Test: `narration-video/templates/scripts/check/scanner-text.test.ts`

**Interfaces:**
- Consumes: chapters manifest（import）
- Produces: `scanNarrations(chapters: ChapterDef[]): Finding[]`——规则：manifest 声明制一致性（#1：steps === narrations.length 由 manifest define 保证，此处校验导入无坏数据）/文案反 AI 味（#11 warning：五类句式正则——"说白了/本质上/恰恰/反而/正是因为/归根结底/我必须"等）/字幕结尾禁标点（V3：narrations 每句末字符 ∉ 。，、》……）/

- [ ] **Step 1: 写失败测试**（负样本：坏 steps、AI 味句、"这是一句口播。" 结尾句号；false-positive：正常口播句）
- [ ] **Step 2-4: RED/GREEN 流程**
- [ ] **Step 5: Commit** `feat(M3a): narrations 文本扫描（反AI味 + 字幕标点 + manifest 一致性）`

---

### Task 5: 资源类检查

**Files:**
- Create: `narration-video/templates/scripts/check/scanner-assets.ts`
- Test: `narration-video/templates/scripts/check/scanner-assets.test.ts`

**Interfaces:**
- Produces: `scanAssets(repoRoot: string, chapters: ChapterDef[]): Finding[]`——规则：禁外部网络资源（#12：章节层 http(s):// URL）/**音频完整性**（#13：narrations.length === public/audio/<id>/*.mp3 数 === audio-durations.json 条目数）/**字体声明=加载**（#14 静态部分：theme.json fonts.declared vs fonts.css @import 对照）/**文档完整性 lint**（#15：SKILL.md/references 引用的相对路径与节标题存在——v1 只查路径存在性）

- [ ] **Step 1: 写失败测试**（负样本：外链 img、音频缺文件、字体声明未加载、文档死链；false-positive：合法相对路径/localhost dev 例外）
- [ ] **Step 2-4: RED/GREEN 流程**
- [ ] **Step 5: Commit** `feat(M3a): 资源类检查（外链/音频完整性/字体声明/文档 lint）`

---

### Task 6: 主题与组件契约接线 + 终审扩展断言

**Files:**
- Create: `narration-video/templates/scripts/check/check-fast.ts`（入口编排 Task 1-5 扫描器）
- Test: `narration-video/templates/scripts/check/check-fast.test.ts`

**Interfaces:**
- Consumes: validateTheme（theme-validate）、lintComponentCss（contract-lint）、全部扫描器
- Produces: `runCheckFast(opts?: { chapterFiles?: ...; repoRoot?: string }): { bag: FindingBag }`（可测试注入路径）；CLI 入口打印报告 + process.exit(exitCode)

- [ ] **Step 1: 写失败测试**（编排测试：合法项目零 blocker；故意注入一条违规 CSS → exitCode 1 + 报告含定位；**防失同步断言**：tokens.css --dur-* 解析值 === durationMs fallback 300/700/1400；**清单对比断言**：contract-lint COMPONENT_CSS 文件名集合 === index.ts CSS import 集合）
- [ ] **Step 2-4: RED/GREEN 流程**
- [ ] **Step 5: 修改 package.json**：`"check": "tsx scripts/check-fast.ts"`（替换占位 echo）
- [ ] **Step 6: Commit** `feat(M3a): check-fast 入口编排 + 防失同步/清单对比断言 + check 命令接线`

---

### Task 7: 夹具负样本 + false-positive 集（门禁自检）

**Files:**
- Create: `narration-video/templates/scripts/check/__fixtures__/bad/`（每类 blocker 至少一个违规样例：bad-color.css/bad-tsx.tsx/bad-narration.ts/bad-assets...）
- Create: `narration-video/templates/scripts/check/__fixtures__/good/`（false-positive 集：list-reveal 派生写法章节、token 化渐变、合法 var()、合法字阶、正常口播句）
- Test: `narration-video/templates/scripts/check/fixtures.test.ts`

**Interfaces:**
- Produces: 夹具集（门禁的回归保障——"检查的检查"）

- [ ] **Step 1: 写失败测试**：`fixtures.test.ts` 断言——bad/ 每个样例文件至少触发一条 blocker（逐文件断言）；good/ 全部零 blocker（false-positive 护栏）
- [ ] **Step 2: 跑确认失败**（bad 夹具未建/扫描器漏抓 → RED）
- [ ] **Step 3: 建夹具**（bad/ 按 15 项 blocker 逐类埋违规——至少覆盖：#2 色/#3 字体/#4 动画/#7 黑名单/#8 无限/#12 外链/#13 音频/#14 字体声明/#1 manifest；good/ 覆盖已知 false-positive 场景）
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Commit** `feat(M3a): 门禁夹具（负样本 + false-positive 集）`

---

### Task 8: 全量集成验证 + 收口

- [ ] **Step 1: 全量测试**：`npx vitest run`（131 + 本计划新增 ≈ 20+ 项全绿）+ `npx tsc --noEmit`
- [ ] **Step 2: 真实项目自检**：`npm run check` 跑模板自身（预期：warning 若干可接受、零 blocker——模板自身是合规标杆；若有 blocker 排查修复）
- [ ] **Step 3: 脚手架接线**：scaffold.sh 拷贝 scripts/check/ 与夹具（脚手架模板复制范围包含 scripts/）；冒烟脚本补断言 `npm run check` 在 scaffold 产物上 exit 0
- [ ] **Step 4: Commit** `feat(M3a): 门禁全量集成 + 脚手架接线`

---

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：§11.1 静态扫描 15 项——#1(T4)/#2(T2+T3)/#3(T2)/#4(T2 CSS+T3 JS)/#5(T2)/#6(T2)/#7(T3)/#8(T3)/#9(T6 接线既有)/#10(T6 接线)/#11(T4)/#12(T5)/#13(T5)/#14(T5)/#15(T5) 全覆盖；终审扩展（JS easing T3/防失同步 T6/清单对比 T6/双护栏全部任务）；§12b 机器化子集（V3 T4/V4 T2）。M3b 无头 pass 不在本计划（Plan 5 随 M4）。
2. **Placeholder scan**：无 TBD；每个任务含完整测试代码。
3. **Type consistency**：`Finding/FindingBag`（Task 1 定义 → 全部扫描器消费）；`scanChapterCss(files: {path, css}[])`、`scanChapterTsx(files: {path, source}[])`、`scanNarrations(chapters)`、`scanAssets(repoRoot, chapters)` 签名各任务一致；`runCheckFast(opts)` 注入式可测。
