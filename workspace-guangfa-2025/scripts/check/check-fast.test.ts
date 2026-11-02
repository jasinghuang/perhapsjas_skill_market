/**
 * check-fast.test.ts：M3a 门禁入口编排测试（TDD 双护栏：负样本 + 干净夹具）。
 *
 * 夹具策略：tmp 目录构造"最小合规项目"（真实 tokens.css/theme.json/fonts.css/
 * components/index.ts 拷贝 + 一个干净章节 + 注入式 chapters），各用例按需打补丁
 * （坏 CSS / 坏 narrations / 死链 / 坏 durations / 缺装配）。chapters 显式注入——
 * 跳过 manifest 动态 import（React 链），夹具无需完整组件树。
 *
 * 编排顺序 = dispatch 规格 1-8：章节 CSS/TSX → narrations → assets → 主题 →
 * 组件 → 防失同步 → 清单对比 → P4-9 durations 条目数。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ChapterDef } from "../../src/chapters/manifest";
import { COMPONENTS } from "../../src/components/manifest";
import {
  assertManifestIndexSync,
  assertStyleGuideCoverage,
  extractCssImports,
  extractExportNames,
  extractJsxUsages,
  formatCrashMessage,
  runCheckFast,
} from "./check-fast";

// ── 夹具 ──

/** 模板根（scripts/check/../..）——真实 tokens.css/theme.json/fonts.css/index.ts 的来源。 */
// 注意不用 new URL(rel, import.meta.url)：vitest 的 jsdom 全局 URL 对 file: 基址会
// 解析成 http://localhost:3000 虚拟 origin（模块作用域实测踩坑）。
const TEMPLATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface FixtureOptions {
  /** 章节 CSS 内容（默认干净：token 化色值）。 */
  chapterCss?: string;
  /** tokens.css 补丁（防失同步 / 主题契约负样本）。 */
  tokensPatch?: (real: string) => string;
  /** components/index.ts 补丁（三方同步负样本）。 */
  indexTsPatch?: (real: string) => string;
  /** src/StyleGuide.tsx 补丁（组件覆盖负样本）。 */
  styleGuideTsxPatch?: (real: string) => string;
  /** SKILL.md 内容（死链负样本）。 */
  skillMd?: string;
  /** public/audio-durations.json 原始内容（P4-9 负样本）。 */
  durations?: string;
  /** public/audio/01-demo/ 下 mp3 文件数（配合 durations 使 #13 数量一致）。 */
  mp3s?: number;
}

const fixtureRoots: string[] = [];

function makeFixture(o: FixtureOptions = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-fast-"));
  fixtureRoots.push(root);
  const real = (rel: string): string => fs.readFileSync(path.join(TEMPLATE_ROOT, rel), "utf8");
  // src/chapters/01-demo：一个干净章节（tsx 无违规、css 默认 token 化）
  const chDir = path.join(root, "src", "chapters", "01-demo");
  fs.mkdirSync(chDir, { recursive: true });
  fs.writeFileSync(path.join(chDir, "index.tsx"), "export const placeholder = 1;\n");
  fs.writeFileSync(path.join(chDir, "index.css"), o.chapterCss ?? "color: var(--text);\n");
  // src/theme：真实 tokens/theme.json/fonts.css 拷贝（按需打补丁）
  fs.mkdirSync(path.join(root, "src", "theme"), { recursive: true });
  const tokens = real("src/theme/tokens.css");
  fs.writeFileSync(path.join(root, "src", "theme", "tokens.css"), o.tokensPatch ? o.tokensPatch(tokens) : tokens);
  fs.writeFileSync(path.join(root, "src", "theme", "theme.json"), real("src/theme/theme.json"));
  fs.writeFileSync(path.join(root, "src", "theme", "fonts.css"), real("src/theme/fonts.css"));
  // src/components：真实 index.ts 拷贝（清单对比断言的对象）
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  const indexTs = real("src/components/index.ts");
  fs.writeFileSync(path.join(root, "src", "components", "index.ts"), o.indexTsPatch ? o.indexTsPatch(indexTs) : indexTs);
  // src/StyleGuide.tsx：真实拷贝（组件覆盖断言的对象，只读源文本、不执行）
  const sgTsx = real("src/StyleGuide.tsx");
  fs.writeFileSync(path.join(root, "src", "StyleGuide.tsx"), o.styleGuideTsxPatch ? o.styleGuideTsxPatch(sgTsx) : sgTsx);
  // 文档 / 音频（可选）
  if (o.skillMd !== undefined) fs.writeFileSync(path.join(root, "SKILL.md"), o.skillMd);
  if (o.durations !== undefined) {
    fs.mkdirSync(path.join(root, "public"), { recursive: true });
    fs.writeFileSync(path.join(root, "public", "audio-durations.json"), o.durations);
  }
  if (o.mp3s !== undefined) {
    const audioDir = path.join(root, "public", "audio", "01-demo");
    fs.mkdirSync(audioDir, { recursive: true });
    for (let i = 0; i < o.mp3s; i++) fs.writeFileSync(path.join(audioDir, `step-${i}.mp3`), "");
  }
  return root;
}

afterEach(() => {
  while (fixtureRoots.length > 0) {
    fs.rmSync(fixtureRoots.pop()!, { recursive: true, force: true });
  }
});

// ── 注入式 chapters（跳过 manifest 动态 import 的 React 链） ──

const GOOD_CHAPTERS: ChapterDef[] = [
  { id: "demo", folder: "01-demo", steps: 1, narrations: ["这是口播"], Component: () => null },
];
const BAD_CHAPTERS: ChapterDef[] = [
  { id: "demo", folder: "01-demo", steps: 2, narrations: ["这是口播"], Component: () => null },
];

// ── 编排 ──

describe("check-fast 入口编排", () => {
  it("负样本：违规 CSS + 坏 narrations + 死链 → 对应 blocker + exitCode 1", async () => {
    const root = makeFixture({
      chapterCss: "color: #f00;\n",
      skillMd: "见 [缺失文档](missing.md)\n",
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: BAD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.exitCode()).toBe(1);
    const out = bag.render();
    expect(out).toContain("[blocker] 禁硬编码色");
    expect(out).toContain("[blocker] manifest一致性");
    expect(out).toContain("[warning] 文档死链");
    // 全量精确：blocker 2（禁硬编码色 + manifest一致性）、warning 2（文档死链 + 音频完整性降级）
    expect(out.startsWith("静态门禁报告：共 4 项（blocker 2，warning 2）")).toBe(true);
  });

  it("干净夹具 → 零 blocker，exitCode 0（未合成音频 warning 为合法态）", async () => {
    const bag = await runCheckFast({ repoRoot: makeFixture(), chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(false);
    expect(bag.exitCode()).toBe(0);
    const out = bag.render();
    expect(out).toContain("blocker 0");
    // 主题契约 / 防失同步 / 三方同步 / 组件覆盖 / 组件 lint 全部静默通过（零相应 finding）
    expect(out).not.toContain("主题契约");
    expect(out).not.toContain("防失同步");
    expect(out).not.toContain("三方同步");
    expect(out).not.toContain("组件覆盖");
    expect(out).not.toContain("禁硬编码色");
    expect(out).not.toContain("禁硬编码字体");
    expect(out).not.toContain("禁裸动画时长");
  });
});

// ── 防失同步断言（Ruling P4-2） ──

describe("防失同步断言（tokens.css --dur-* === fallback 字面量 300/700/1400）", () => {
  it("真实 tokens.css（300/700/1400）通过——干净夹具零 防失同步 finding", async () => {
    const bag = await runCheckFast({ repoRoot: makeFixture(), chapters: GOOD_CHAPTERS });
    expect(bag.render()).not.toContain("防失同步");
  });

  it("坏值 tokens.css（--dur-fast: 250ms）→ blocker 防失同步 + exitCode 1", async () => {
    const root = makeFixture({
      tokensPatch: (real) => real.replace("--dur-fast: 300ms", "--dur-fast: 250ms"),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.exitCode()).toBe(1);
    expect(bag.render()).toContain("[blocker] 防失同步");
  });
});

// ── 三方同步断言（manifest ↔ index.ts ↔ StyleGuide.tsx；组件库结构规范化 2/3） ──

describe("三方同步断言 A：manifest ↔ index.ts（CSS 路径 + 导出名，双向）", () => {
  it("真实 index.ts 与 manifest 一致通过——干净夹具零 三方同步 finding", async () => {
    const bag = await runCheckFast({ repoRoot: makeFixture(), chapters: GOOD_CHAPTERS });
    expect(bag.render()).not.toContain("三方同步");
  });

  it("负样本 B1a：index.ts 漏装配一份组件 CSS → blocker 三方同步（manifest 有 index 无）", async () => {
    const root = makeFixture({
      indexTsPatch: (real) => real.replace('import "./text/HeroTitle.css";\n', ""),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.exitCode()).toBe(1);
    const out = bag.render();
    expect(out).toContain("[blocker] 三方同步");
    expect(out).toContain("text/HeroTitle.css 未在 index.ts 装配");
  });

  it("负样本 B1a′：index.ts 装配幽灵 CSS（路径写错）→ 双向两条 blocker", async () => {
    const root = makeFixture({
      indexTsPatch: (real) => real.replace('import "./text/HeroTitle.css";', 'import "./text/HeroTitleX.css";'),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    const out = bag.render();
    expect(out).toContain("text/HeroTitle.css 未在 index.ts 装配");
    expect(out).toContain("text/HeroTitleX.css 未入 manifest");
  });

  it("负样本 B1b：index.ts 漏一个组件导出名 → blocker 三方同步（manifest 有 index 无）", async () => {
    const root = makeFixture({
      indexTsPatch: (real) =>
        real.replace("export { HeroTitle, Kicker,", "export { Kicker,"),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    const out = bag.render();
    expect(out).toContain("[blocker] 三方同步");
    expect(out).toContain("组件 HeroTitle 未在 index.ts 导出");
  });

  it("负样本 B1b′：index.ts 多一个幽灵导出名 → blocker 三方同步（index 有 manifest 无）", async () => {
    const root = makeFixture({
      indexTsPatch: (real) =>
        real.replace("export { HeroTitle, Kicker,", "export { HeroTitle, GhostWidget, Kicker,"),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.render()).toContain("导出 GhostWidget 未入 manifest");
  });

  it("index.ts 整文件缺失 → blocker 三方同步（可报告失败，不 throw）", async () => {
    const root = makeFixture();
    fs.rmSync(path.join(root, "src", "components", "index.ts"));
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.render()).toContain("[blocker] 三方同步");
  });
});

describe("三方同步断言 B：manifest ↔ StyleGuide.tsx（组件 JSX 覆盖）", () => {
  it("真实 StyleGuide.tsx 覆盖全部 44 组件——干净夹具零 组件覆盖 finding", async () => {
    const bag = await runCheckFast({ repoRoot: makeFixture(), chapters: GOOD_CHAPTERS });
    expect(bag.render()).not.toContain("组件覆盖");
  });

  it("负样本 B2：删掉 MarkerBlock 的 JSX 用法 → blocker 组件覆盖（防漏挂重演）", async () => {
    const root = makeFixture({
      styleGuideTsxPatch: (real) => real.replace(/<MarkerBlock/g, "<MarkerBlockX"),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.exitCode()).toBe(1);
    const out = bag.render();
    expect(out).toContain("[blocker] 组件覆盖");
    expect(out).toContain("组件 MarkerBlock 未在 styleguide 展示");
  });

  it("StyleGuide.tsx 整文件缺失 → blocker 组件覆盖（可报告失败，不 throw）", async () => {
    const root = makeFixture();
    fs.rmSync(path.join(root, "src", "StyleGuide.tsx"));
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.render()).toContain("[blocker] 组件覆盖");
  });
});

// ── 解析器纯函数 + 非空护栏（空/解析不到 → throw，拒绝静默通过） ──

describe("三方同步解析器（纯函数 + 非空护栏）", () => {
  it("extractCssImports：提取 `./x.css` 装配，忽略 ../theme 导入", () => {
    const src = 'import "../theme/tokens.css";\nimport "./text/HeroTitle.css";\n';
    expect([...extractCssImports(src)]).toEqual(["text/HeroTitle.css"]);
  });

  it("extractExportNames：提取 `export { A, B } from \"./<组>\"` 具名导出", () => {
    expect([...extractExportNames('export { A, B } from "./text";\n')]).toEqual(["A", "B"]);
  });

  it("extractJsxUsages：`<Card` 命中、`<CardX` 不误判、`Record<GroupId, …>` 类型实参不算用法", () => {
    const src = "const x: Record<GroupId, string> = {};\n<Card>\n<CardX />\n<EChart\n  option={1}\n/>\n";
    const usages = extractJsxUsages(src);
    expect(usages.has("Card")).toBe(true);
    expect(usages.has("CardX")).toBe(true); // 自身是独立用法名，但不等于 Card
    expect(usages.has("EChart")).toBe(true);
    expect(usages.has("GroupId")).toBe(false);
  });

  it("非空护栏：空/解析不到 → throw 而非静默通过", () => {
    expect(() => extractCssImports("// 没有装配")).toThrow(/非空护栏/);
    expect(() => extractExportNames("// 没有导出")).toThrow(/非空护栏/);
    expect(() => extractJsxUsages("// 没有 JSX")).toThrow(/非空护栏/);
    expect(() => assertManifestIndexSync(COMPONENTS, "")).toThrow(/非空护栏/);
    expect(() => assertStyleGuideCoverage(COMPONENTS, "const x = 1;\n")).toThrow(/非空护栏/);
  });

  it("负样本：空 manifest + 非空源 → 全部条目报「幽灵装配/幽灵导出」", () => {
    const indexSrc = 'import "./text/HeroTitle.css";\nexport { HeroTitle } from "./text";\n';
    const findings = assertManifestIndexSync([], indexSrc);
    expect(findings.map((f) => f.message).join("\n")).toContain("未入 manifest");
    expect(findings.every((f) => f.rule === "三方同步" && f.severity === "blocker")).toBe(true);
  });

  it("组件覆盖：manifest 条目在 StyleGuide 无用法 → 每条一个 blocker（rule=组件覆盖）", () => {
    const entries = [
      { export: "Card", group: "structure" as const, class: "card" },
      { export: "Ghost", group: "structure" as const, class: "ghost" },
    ];
    const findings = assertStyleGuideCoverage(entries, "<Card>\n");
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("组件覆盖");
    expect(findings[0].message).toContain("组件 Ghost 未在 styleguide 展示");
  });
});

// ── Ruling P4-9：audio-durations.json 条目数 === 总非空 narrations 数 ──

describe("P4-9 音频时长清单条目数比对", () => {
  it("条目数 ≠ 总非空 narrations 数 → blocker 音频完整性（配 1 个 mp3 使 #13 本身一致）", async () => {
    const root = makeFixture({
      durations: JSON.stringify({ demo: [1.2, 3.4] }),
      mp3s: 1,
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.render()).toContain("[blocker] 音频完整性");
  });

  it("条目数一致 → 零 blocker（durations 1 条 + 1 个 mp3 + 1 条非空 narration）", async () => {
    const root = makeFixture({
      durations: JSON.stringify({ demo: [1.2] }),
      mp3s: 1,
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(false);
    expect(bag.exitCode()).toBe(0);
  });
});

// ── 主题层接线（Ruling P4-6：fs 读取 validateTheme） ──

describe("主题层接线（validateTheme via fs）", () => {
  it("tokens.css 缺必填 token（--text）→ blocker 主题契约 + exitCode 1", async () => {
    const root = makeFixture({
      // 行尾带 /* ink */ 注释，不能锚 $——删到分号为止即抹掉定义
      tokensPatch: (real) => real.replace(/^(\s*)--text:\s*[^;]+;/m, ""),
    });
    const bag = await runCheckFast({ repoRoot: root, chapters: GOOD_CHAPTERS });
    expect(bag.hasBlockers()).toBe(true);
    expect(bag.exitCode()).toBe(1);
    expect(bag.render()).toContain("[blocker] 主题契约");
  });
});

// ── CLI 入口判断（import.meta.url vs process.argv[1]） ──

describe("CLI 入口判断", () => {
  it("作为库被 import（非 CLI 入口）不触发 process.exit", async () => {
    const exitSpy = vi.spyOn(process, "exit");
    vi.resetModules();
    const mod = await import("./check-fast");
    expect(mod.runCheckFast).toBeTypeOf("function");
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

// ── CLI 崩溃转可读报告（终审 M-6：资产 import 兜底——非裸栈、含指引） ──

describe("CLI 异常转可读报告（formatCrashMessage，终审 M-6）", () => {
  it("未知文件扩展名错误 → 资产 import 指引（含 public/ 口径，不泄裸栈）", () => {
    const m = formatCrashMessage(new Error('Unknown file extension ".webp" for /x/hero.webp'));
    expect(m).toContain("public/");
    expect(m).toContain("资产");
    expect(m).not.toContain("    at ");
  });

  it("文件缺失错误 → 导入文件缺失指引 + 原始错误透传", () => {
    const m = formatCrashMessage(new Error("Cannot find module './hero.png'"));
    expect(m).toContain("缺失");
    expect(m).toContain("原始错误");
    expect(m).toContain("./hero.png");
  });

  it("其他异常 → 门禁执行异常通用报告（原始错误透传）", () => {
    const m = formatCrashMessage(new Error("扫描器炸了"));
    expect(m).toContain("门禁");
    expect(m).toContain("扫描器炸了");
  });
});
