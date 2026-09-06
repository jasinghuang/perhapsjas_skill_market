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
 *   7. 清单对比断言：contract-lint COMPONENT_CSS file 集合 === index.ts CSS import
 *      集合（fs 读 index.ts 提取 import "./xxx.css"），不等 → blocker
 *   8. Ruling P4-9：public/audio-durations.json 存在时条目数 === 总非空 narrations 数，
 *      不等 → blocker（在入口层做——跨章聚合是编排层关注点，scanner-assets 不动）
 *
 * tsx（node）不能解析 Vite 的 `?raw`/`.css` 导入（ERR_UNKNOWN_FILE_EXTENSION）——
 * 模块作用域经 node:module registerHooks 注册 .css 文本加载钩子（仅非 vitest 环境：
 * vitest 走 Vite 管线原生支持，且钩子会干扰测试管线）。scanner-css 自身已按
 * Ruling P4-6 弃 ?raw 改 fs（见 scanner-css.ts 头注释）。
 *
 * CLI 入口：`import.meta.url` 与 `process.argv[1]`（realpath 对齐）比对判断是否
 * CLI 直跑——被 import 时不触发 process.exit（测试可安全 import）。
 *
 * 纯 TS、无 DOM 依赖——tsx（node）与 vitest 双环境消费。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { registerHooks } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ChapterDef } from "../../src/chapters/manifest";
import { validateTheme } from "../../src/theme/theme-validate";
import { FindingBag, type Finding } from "./findings";
import { scanChapterCss } from "./scanner-css";
import { scanChapterTsx } from "./scanner-tsx";
import { scanNarrations } from "./scanner-text";
import { scanAssets } from "./scanner-assets";

// ── tsx（node）CSS 钩子：.css 文件按"默认导出文本"加载（?raw 与副作用 import 皆通） ──

if (!process.env.VITEST) {
  if (typeof registerHooks !== "function") {
    throw new Error(
      "check-fast：node:module.registerHooks 不可用（需 Node ≥ 22.15）——tsx 运行需 CSS 钩子加载 React 链",
    );
  }
  registerHooks({
    load(url, context, nextLoad) {
      const clean = url.split("?")[0];
      if (url.startsWith("file:") && clean.endsWith(".css")) {
        return {
          format: "module",
          source: `export default ${JSON.stringify(fs.readFileSync(fileURLToPath(clean), "utf8"))}`,
          shortCircuit: true,
        };
      }
      return nextLoad(url, context);
    },
  });
}

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

// ── 清单对比断言（COMPONENT_CSS === index.ts CSS import 集合） ──

function assertComponentCssParity(repoRoot: string, contractFiles: string[]): Finding[] {
  const findings: Finding[] = [];
  const indexPath = path.join(repoRoot, "src", "components", "index.ts");
  if (!fs.existsSync(indexPath)) {
    findings.push({
      rule: "清单对比",
      severity: "blocker",
      location: "src/components/index.ts",
      message: "组件出口文件缺失，无法对比 COMPONENT_CSS 装配清单",
    });
    return findings;
  }
  const indexSrc = fs.readFileSync(indexPath, "utf8");
  // 只提取 `./xxx.css` 形态（tokens.css 的 ../ 导入不属组件 CSS）
  const indexImports = new Set(
    [...indexSrc.matchAll(/import\s+["']\.\/([^"']+\.css)["']/g)].map((m) => m[1]),
  );
  const contract = new Set(contractFiles);
  for (const f of contract) {
    if (!indexImports.has(f)) {
      findings.push({
        rule: "清单对比",
        severity: "blocker",
        location: "src/components/index.ts",
        message: `契约组件 CSS ${f} 未在 index.ts 装配（COMPONENT_CSS 与 index.ts 失同步）`,
      });
    }
  }
  for (const f of indexImports) {
    if (!contract.has(f)) {
      findings.push({
        rule: "清单对比",
        severity: "blocker",
        location: "src/components/index.ts",
        message: `index.ts 装配 ${f} 未入契约 COMPONENT_CSS（失同步）`,
      });
    }
  }
  return findings;
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

  // 7) 清单对比断言
  addAll(assertComponentCssParity(repoRoot, contractLint.COMPONENT_CSS.map((c) => c.file)));

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

if (isCliEntry()) {
  void (async () => {
    const bag = await runCheckFast();
    console.log(bag.render());
    process.exit(bag.exitCode());
  })();
}
