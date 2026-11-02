/**
 * check-fast：M3a 静态门禁入口（§11.1 check:fast 层）——编排 Task 1-5 扫描器 +
 * 主题层（validateTheme）+ 组件层（lintComponentCss）+ 终审扩展断言：
 *
 * 编排顺序（FindingBag 报告按插入序分组列出）：
 *   1. 章节层文件收集（fs walk src/chapters/**\/*.tsx|.css，排除 *.test.* 与 node_modules）
 *      → scanChapterCss + scanChapterTsx（零文件跳过——扫描器有非空护栏）
 *   2. scanNarrations（chapters manifest 动态 import 处理 React 链）
 *   3. scanAssets（repoRoot + chapters）
 *   4. 主题层 validateTheme（Ruling P4-6：fs 读取 tokens.css 与 theme.json，不用 ?raw；
 *      referencedVars 从组件与章节 CSS 提取传入）→ errors 转 blocker Finding
 *   5. 组件层 lintComponentCss（动态 import contract-lint——纯 TS 可 import）
 *   6. 防失同步断言（Ruling P4-2）：tokens.css --dur-fast/mid/slow 解析值（ms）===
 *      motion.ts durationMs fallback 字面量 300/700/1400，不等 → blocker
 *   7. 三方同步断言（manifest.ts 单一真相源）：manifest ↔ index.ts（CSS 装配路径 + 导出名，
 *      双向）→ blocker；manifest ↔ StyleGuide.tsx（组件 JSX 覆盖，缺 <Name 用法）→ blocker。
 *      下级防线：contract-lint 的 RAW↔manifest 完整性断言在模块作用域 throw（见其文件头）
 *   8. Ruling P4-9：public/audio-durations.json 存在时条目数 === 总非空 narrations 数，
 *      不等 → blocker（在入口层做——跨章聚合是编排层关注点，scanner-assets 不动）
 *
 * tsx（node）不能解析 Vite 的 `?raw`/`.css`/资产导入（ERR_UNKNOWN_FILE_EXTENSION）——
 * 模块作用域经 loader-hooks 注册 .css 文本 + png/svg/jpg/jpeg 占位 + json 解析
 * 加载钩子（仅非 vitest 环境注册；细节与边界见 loader-hooks.ts 头注释）。
 * scanner-css 自身已按 Ruling P4-6 弃 ?raw 改 fs（见 scanner-css.ts 头注释）。
 *
 * CLI 入口：`import.meta.url` 与 `process.argv[1]`（realpath 对齐）比对判断是否
 * CLI 直跑——被 import 时不触发 process.exit（测试可安全 import）。CLI 直跑时
 * 异常经 try/catch 转可读报告（formatCrashMessage）——资产 import 等 import 链
 * 崩溃不再泄裸栈（终审 M-6 兜底）。
 *
 * 纯 TS、无 DOM 依赖——tsx（node）与 vitest 双环境消费。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ChapterDef } from "../../src/chapters/manifest";
import { COMPONENTS, cssPathOf, type ComponentEntry } from "../../src/components/manifest";
import { validateTheme } from "../../src/theme/theme-validate";
import { FindingBag, type Finding } from "./findings";
import "./loader-hooks"; // 模块副作用：非 vitest 环境注册资产/样式加载钩子（终审 M-6）
import { scanChapterCss } from "./scanner-css";
import { scanChapterTsx } from "./scanner-tsx";
import { scanNarrations } from "./scanner-text";
import { scanAssets } from "./scanner-assets";

// ── 常量 ──

/** 模板根（scripts/check/../..）——repoRoot 默认值。 */
// 注意不用 `new URL(rel, import.meta.url)`——vitest 的 jsdom 全局 URL 对 file: 基址
// 会解析成 http://localhost:3000 虚拟 origin；fileURLToPath + path 双环境皆稳。
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

/**
 * 防失同步对照（Ruling P4-2）：tokens.css --dur-* 解析值必须 === motion.ts
 * durationMs fallback 字面量（`tier === "fast" ? 300 : tier === "mid" ? 700 : 1400`）。
 * 双处显式声明正是护栏本体——重复声明 + 断言，改动只动一侧即 blocker。
 */
const DUR_FALLBACK = [
  { token: "--dur-fast", fallbackMs: 300 },
  { token: "--dur-mid", fallbackMs: 700 },
  { token: "--dur-slow", fallbackMs: 1400 },
] as const;

// ── 接口 ──

export interface CheckFastOptions {
  /** 项目根（默认 = 脚本所在模板根，scripts/check/../..）。fs 类扫描器的注入点。 */
  repoRoot?: string;
  /** 注入式测试路径：显式提供 chapters 时跳过 manifest 动态 import（React 链）。 */
  chapters?: ChapterDef[];
}

interface ManifestModule {
  chapters: ChapterDef[];
}

interface ContractLintModule {
  lintComponentCss: () => string[];
  COMPONENT_CSS: Array<{ file: string; css: string }>;
  extractVarRefs: (css: string) => string[];
}

// ── 章节层文件收集 ──

interface ChapterFiles {
  tsx: Array<{ path: string; source: string }>;
  css: Array<{ path: string; css: string }>;
}

/** fs walk src/chapters/**\/*.tsx|.css（排除 *.test.* 与 node_modules），路径相对 repoRoot。 */
function collectChapterFiles(repoRoot: string): ChapterFiles {
  const out: ChapterFiles = { tsx: [], css: [] };
  const dir = path.join(repoRoot, "src", "chapters");
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") stack.push(p);
      } else if (ent.isFile() && !ent.name.includes(".test.")) {
        if (ent.name.endsWith(".tsx")) {
          out.tsx.push({ path: path.relative(repoRoot, p), source: fs.readFileSync(p, "utf8") });
        } else if (ent.name.endsWith(".css")) {
          out.css.push({ path: path.relative(repoRoot, p), css: fs.readFileSync(p, "utf8") });
        }
      }
    }
  }
  out.tsx.sort((a, b) => a.path.localeCompare(b.path));
  out.css.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

// ── 主题层（Ruling P4-6：fs 读取，不用 ?raw） ──

function readThemeTokens(repoRoot: string, bag: FindingBag): string | null {
  const p = path.join(repoRoot, "src", "theme", "tokens.css");
  if (!fs.existsSync(p)) {
    bag.add({
      rule: "主题契约",
      severity: "blocker",
      location: "src/theme/tokens.css",
      message: "主题 tokens 文件缺失（validateTheme 与防失同步断言无法执行）",
    });
    return null;
  }
  return fs.readFileSync(p, "utf8");
}

function readThemeJson(repoRoot: string, bag: FindingBag): unknown | null {
  const p = path.join(repoRoot, "src", "theme", "theme.json");
  if (!fs.existsSync(p)) {
    bag.add({
      rule: "主题契约",
      severity: "blocker",
      location: "src/theme/theme.json",
      message: "主题描述文件缺失",
    });
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    bag.add({
      rule: "主题契约",
      severity: "blocker",
      location: "src/theme/theme.json",
      message: `theme.json 解析失败（${e instanceof Error ? e.message : String(e)}）`,
    });
    return null;
  }
}

// ── 防失同步断言（Ruling P4-2） ──

function assertDurationDesync(tokensCss: string): Finding[] {
  const findings: Finding[] = [];
  for (const { token, fallbackMs } of DUR_FALLBACK) {
    const m = new RegExp(`${token}\\s*:\\s*([\\d.]+)ms`).exec(tokensCss);
    const parsed = m ? parseFloat(m[1]) : Number.NaN;
    if (Number.isNaN(parsed) || parsed !== fallbackMs) {
      findings.push({
        rule: "防失同步",
        severity: "blocker",
        location: "src/theme/tokens.css",
        message: m
          ? `${token} 解析值 ${m[1]}ms ≠ motion.ts durationMs fallback 字面量 ${fallbackMs}ms` +
            "（300/700/1400 双处声明必须同值，Ruling P4-2）"
          : `${token} 缺失 ≠ motion.ts durationMs fallback 字面量 ${fallbackMs}ms（Ruling P4-2）`,
      });
    }
  }
  return findings;
}

// ── 三方同步断言（manifest.ts = 单一真相源；组件库结构规范化 2/3） ──
//
// 三级防线（让「漏挂」类错误从结构上不可能；报告断言清单同此口径）：
//   ① contract-lint.ts 模块作用域 throw：RAW（44 份 `?raw`）键集 ≡ manifest cssPath 集——
//      缺一即炸（最贴近 CSS 文本的一层；负样本见 contract-lint.test.ts）
//   ② 本文件三方同步断言：manifest ↔ index.ts（CSS 装配路径 + 导出名，双向）
//      × manifest ↔ StyleGuide.tsx（组件 JSX 覆盖；防「导出但目录页漏挂」重演）
//   ③ 双护栏负样本：①的键名改写、②的漏装配/漏导出/删用法各自钉红
//
// 断言只吃「源文本」参数（不碰 fs）——负样本直接喂坏文本；解析不到（空集）→ throw 而非静默通过。

const CSS_IMPORT_RE = /import\s+["']\.\/([^"']+\.css)["']/g;
const EXPORT_FROM_RE = /export\s*\{([^}]*)\}\s*from\s*["']\.[^"']*["']/g;
// `<Name` 后接空白 / `/` / `>`——比裸子串紧一档（`<CardX` 不误判为 Card 的用法）
const JSX_USAGE_RE = /<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g;

/** index.ts 源码 → CSS 装配路径集合（`import "./<组>/<导出名>.css"`；`../theme/*` 导入不属组件 CSS）。 */
export function extractCssImports(indexSrc: string): Set<string> {
  const found = [...indexSrc.matchAll(CSS_IMPORT_RE)].map((m) => m[1]);
  if (found.length === 0) {
    throw new Error(
      '三方同步：src/components/index.ts 解析不到任何 `import "./*.css"` 装配（非空护栏——拒绝静默通过）',
    );
  }
  return new Set(found);
}

/** index.ts 源码 → 组件导出名集合（`export { A, B } from "./<组>"`）。 */
export function extractExportNames(indexSrc: string): Set<string> {
  const found = [...indexSrc.matchAll(EXPORT_FROM_RE)].flatMap((m) =>
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (found.length === 0) {
    throw new Error(
      '三方同步：src/components/index.ts 解析不到任何 `export { … } from "./<组>"`（非空护栏——拒绝静默通过）',
    );
  }
  return new Set(found);
}

/** StyleGuide.tsx 源码 → JSX 用法名集合（大小写敏感）。 */
export function extractJsxUsages(styleGuideSrc: string): Set<string> {
  const found = [...styleGuideSrc.matchAll(JSX_USAGE_RE)].map((m) => m[1]);
  if (found.length === 0) {
    throw new Error(
      "组件覆盖：src/StyleGuide.tsx 解析不到任何 JSX 组件用法（非空护栏——拒绝静默通过）",
    );
  }
  return new Set(found);
}

/** manifest ↔ index.ts：CSS 装配路径 + 导出名，双向差集 → blocker。 */
export function assertManifestIndexSync(
  entries: readonly ComponentEntry[],
  indexSrc: string,
): Finding[] {
  const findings: Finding[] = [];
  const loc = "src/components/index.ts";
  const manifestPaths = entries.map(cssPathOf);
  const indexPaths = extractCssImports(indexSrc);
  for (const p of manifestPaths) {
    if (!indexPaths.has(p)) {
      findings.push({
        rule: "三方同步",
        severity: "blocker",
        location: loc,
        message: `manifest 组件 CSS ${p} 未在 index.ts 装配（漏挂——§6.2 章节层唯一零件来源缺样式）`,
      });
    }
  }
  for (const p of indexPaths) {
    if (!manifestPaths.includes(p)) {
      findings.push({
        rule: "三方同步",
        severity: "blocker",
        location: loc,
        message: `index.ts 装配 ${p} 未入 manifest（幽灵装配——manifest.ts 才是装配清单真相源）`,
      });
    }
  }
  const manifestExports = entries.map((c) => c.export);
  const indexExports = extractExportNames(indexSrc);
  for (const e of manifestExports) {
    if (!indexExports.has(e)) {
      findings.push({
        rule: "三方同步",
        severity: "blocker",
        location: loc,
        message: `manifest 组件 ${e} 未在 index.ts 导出（章节层不可消费）`,
      });
    }
  }
  for (const e of indexExports) {
    if (!manifestExports.includes(e)) {
      findings.push({
        rule: "三方同步",
        severity: "blocker",
        location: loc,
        message: `index.ts 导出 ${e} 未入 manifest（失同步——新增组件先改 manifest.ts）`,
      });
    }
  }
  return findings;
}

/** manifest ↔ StyleGuide.tsx：每个组件的导出名必须有 JSX 用法（防「导出但目录页漏挂」重演）。 */
export function assertStyleGuideCoverage(
  entries: readonly ComponentEntry[],
  styleGuideSrc: string,
): Finding[] {
  const usages = extractJsxUsages(styleGuideSrc);
  return entries
    .filter((c) => !usages.has(c.export))
    .map((c) => ({
      rule: "组件覆盖",
      severity: "blocker" as const,
      location: "src/StyleGuide.tsx",
      message: `组件 ${c.export} 未在 styleguide 展示（缺 <${c.export} 用法——防「导出但漏挂」重演）`,
    }));
}

/** 断言输入文件读取：缺失 → blocker（可报告的门禁失败），不 throw。 */
function readSyncTarget(repoRoot: string, rel: string, rule: string, hint: string, bag: FindingBag): string | null {
  const p = path.join(repoRoot, rel);
  if (!fs.existsSync(p)) {
    bag.add({ rule, severity: "blocker", location: rel, message: hint });
    return null;
  }
  return fs.readFileSync(p, "utf8");
}

// ── Ruling P4-9：audio-durations.json 条目数 === 总非空 narrations 数 ──

/** 条目数判定：数组 → length；对象 → 各数组值长度之和；其他 → null（格式未定，响亮失败）。 */
function countDurationEntries(parsed: unknown): number | null {
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    let sum = 0;
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) return null;
      sum += v.length;
    }
    return sum;
  }
  return null;
}

function checkAudioDurations(repoRoot: string, chapters: ChapterDef[]): Finding[] {
  const p = path.join(repoRoot, "public", "audio-durations.json");
  if (!fs.existsSync(p)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return [
      {
        rule: "音频完整性",
        severity: "blocker",
        location: "public/audio-durations.json",
        message: `解析失败（${e instanceof Error ? e.message : String(e)}）——#13 契约破坏`,
      },
    ];
  }
  const entries = countDurationEntries(parsed);
  const expected = chapters.reduce(
    (sum, ch) => sum + ch.narrations.filter((n) => n.trim() !== "").length,
    0,
  );
  if (entries === null) {
    return [
      {
        rule: "音频完整性",
        severity: "blocker",
        location: "public/audio-durations.json",
        message: "条目数无法判定——格式须为时长数组或 chapterId→时长数组对象（#13，Ruling P4-9）",
      },
    ];
  }
  if (entries !== expected) {
    return [
      {
        rule: "音频完整性",
        severity: "blocker",
        location: "public/audio-durations.json",
        message: `条目数 ${entries} ≠ 总非空 narrations ${expected}（#13 durations 条目数必须与 narrations 一致，Ruling P4-9）`,
      },
    ];
  }
  return [];
}

// ── 组件层违规消息 → Finding 转换（lintComponentCss 返回 "file:line 消息" 字符串） ──

function componentViolationToFinding(msg: string): Finding {
  const m = /^([^:\s]+:\d+)\s+([\s\S]*)$/.exec(msg);
  return m
    ? { rule: "组件契约", severity: "blocker", location: `src/components/${m[1]}`, message: m[2] }
    : { rule: "组件契约", severity: "blocker", location: "src/components", message: msg };
}

// ── 入口 ──

export async function runCheckFast(opts: CheckFastOptions = {}): Promise<FindingBag> {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const bag = new FindingBag();
  const addAll = (findings: Finding[]): void => {
    for (const f of findings) bag.add(f);
  };

  // 0) chapters：注入优先；否则动态 import 模板 manifest（React 链——tsx 下经 CSS 钩子）
  const chapters =
    opts.chapters ?? ((await import("../../src/chapters/manifest")) as unknown as ManifestModule).chapters;

  // 1) 章节层 CSS/TSX 扫描（零文件跳过——扫描器有非空护栏，空章节 CSS 是合法态）
  const chapterFiles = collectChapterFiles(repoRoot);
  if (chapterFiles.css.length > 0) addAll(scanChapterCss(chapterFiles.css));
  if (chapterFiles.tsx.length > 0) addAll(scanChapterTsx(chapterFiles.tsx));

  // 2) narrations 文本扫描（#1 manifest 一致性 / #11 反 AI 味 / V3 字幕标点）
  addAll(scanNarrations(chapters));

  // 3) 资源类检查（#12 外链 / #13 音频完整性 / #14 字体声明 / #15 文档死链）
  addAll(scanAssets(repoRoot, chapters));

  // 4) 主题层（validateTheme；referencedVars 从组件与章节 CSS 提取传入）
  const tokensCss = readThemeTokens(repoRoot, bag);
  const themeJson = readThemeJson(repoRoot, bag);
  const contractLint = (await import("../../src/components/contract-lint")) as unknown as ContractLintModule;
  const referencedVars = [
    ...contractLint.COMPONENT_CSS.flatMap((c) => contractLint.extractVarRefs(c.css)),
    ...chapterFiles.css.flatMap((f) => contractLint.extractVarRefs(f.css)),
  ];
  if (tokensCss !== null && themeJson !== null) {
    const { errors } = validateTheme(tokensCss, themeJson, [...new Set(referencedVars)]);
    for (const e of errors) {
      bag.add({ rule: "主题契约", severity: "blocker", location: "src/theme", message: e });
    }
  }

  // 5) 组件层契约 lint（dynamic import contract-lint——?raw 链经 CSS 钩子加载）
  addAll(contractLint.lintComponentCss().map(componentViolationToFinding));

  // 6) 防失同步断言（Ruling P4-2）
  if (tokensCss !== null) addAll(assertDurationDesync(tokensCss));

  // 7) 三方同步断言（manifest 单一真相源：manifest ↔ index.ts ↔ StyleGuide.tsx）
  const indexSrc = readSyncTarget(
    repoRoot,
    "src/components/index.ts",
    "三方同步",
    "组件出口文件缺失，无法对比 manifest 装配清单",
    bag,
  );
  if (indexSrc !== null) addAll(assertManifestIndexSync(COMPONENTS, indexSrc));
  const styleGuideSrc = readSyncTarget(
    repoRoot,
    "src/StyleGuide.tsx",
    "组件覆盖",
    "样式词典页缺失，无法校验组件展示覆盖（StyleGuide.tsx）",
    bag,
  );
  if (styleGuideSrc !== null) addAll(assertStyleGuideCoverage(COMPONENTS, styleGuideSrc));

  // 8) Ruling P4-9 音频时长清单条目数
  addAll(checkAudioDurations(repoRoot, chapters));

  return bag;
}

// ── CLI 入口判断（import.meta.url vs process.argv[1]，realpath 对齐防 /private 与符号链接） ──

function isCliEntry(): boolean {
  const arg = process.argv[1];
  if (arg === undefined) return false;
  try {
    return fs.realpathSync(path.resolve(arg)) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(arg) === fileURLToPath(import.meta.url);
  }
}

// ── CLI 崩溃转可读报告（终审 M-6 兜底：资产 import 等 import 链崩溃不泄裸栈） ──

/** 未知扩展名/模块缺失类错误 → 资产 import 指引；其余异常 → 门禁执行异常通用报告。 */
export function formatCrashMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const isImportChainCrash =
    /ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND|Unknown file extension|Cannot find module/i.test(
      msg,
    );
  const hint = isImportChainCrash
    ? "章节 import 链加载失败——资产 import 暂不支持（图片/音频等资产请走 public/ 目录引用；" +
      "css/png/svg/jpg/jpeg/json 已内置占位加载），或导入的文件缺失。"
    : "门禁执行异常（扫描器或 import 链崩溃）。";
  return `静态门禁异常终止：${hint}\n原始错误：${msg}`;
}

if (isCliEntry()) {
  void (async () => {
    try {
      const bag = await runCheckFast();
      console.log(bag.render());
      process.exit(bag.exitCode());
    } catch (e) {
      console.error(formatCrashMessage(e));
      process.exit(1);
    }
  })();
}
