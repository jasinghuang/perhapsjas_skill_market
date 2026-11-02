/**
 * check：**全量门禁入口**（M3b Task 7）——`npm run check` = fast 静态层 + 无头 pass。
 *
 * 编排（两层各产一个 FindingBag，报告按 fast → 无头的插入序合并）：
 *   1. `runCheckFast()`（M3a 的 15 项静态层，逐字未动；迭代期仍走 `npm run check:fast`）
 *   2. `runHeadlessPass()`（§11.1 #16 的无头 seek pass：自起 Vite + `?render=1&headless=1` 逐 step）
 *   3. `bag.merge(无头袋)` → `render("门禁报告（fast + 无头）")` → `process.exit(bag.exitCode())`
 *
 * 标志位（`--url` / `--no-headless`）见 parseArgs——未知标志**抛错**而不是静默忽略：门禁的
 * 命令行打错字若被吞掉，等于悄悄缩小了检查面（"宁炸不静默"）。
 *
 * 依赖方向：check.ts → check-fast.ts（同时连带注册 loader-hooks 的资产/样式加载钩子，
 * 故 manifest 的动态 import 在 tsx 下可用）、check.ts → headless.ts → serve.ts / collectors.ts
 * / ../shot/session.ts。反向无依赖。
 *
 * 环境前置：需要 Chromium（`npx playwright install chromium`）；Vite 由本进程自起
 * （端口占用时 Vite 自动 +1，**从不**探活复用外部服务——见 serve.ts 文件头）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ChapterDef } from "../../src/chapters/manifest";
import { formatCrashMessage, runCheckFast } from "./check-fast"; // 副作用：注册 loader-hooks
import { FindingBag } from "./findings";
import { runHeadlessPass, type HeadlessOptions } from "./headless";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

/** 全量报告标题（区分于 check:fast 的默认"静态门禁报告"）。 */
export const CHECK_REPORT_TITLE = "门禁报告（fast + 无头）";

/** `--no-headless`（调试口）的报告标题：标题必须如实反映"这一轮查了什么"。 */
export const CHECK_FAST_ONLY_TITLE = "门禁报告（fast，无头已跳过）";

// ── 接口 ──

export interface CheckOptions {
  /** 显式指定才复用外部服务（透传无头层）；缺省 = 无头层进程内自起 Vite */
  url?: string;
  /** false = 只跑 fast（`--no-headless` 调试口）；缺省 true */
  headless?: boolean;
  repoRoot?: string;
  /** 注入式测试路径：显式提供 chapters 时两层都用它（不动态 import manifest） */
  chapters?: ChapterDef[];
}

export interface CheckDeps {
  /** 注入式测试路径（默认 = runCheckFast） */
  runFast?: (opts: { repoRoot: string; chapters?: ChapterDef[] }) => Promise<FindingBag>;
  /** 注入式测试路径（默认 = runHeadlessPass） */
  runHeadless?: (opts: HeadlessOptions) => Promise<FindingBag>;
}

export interface CheckArgs {
  url?: string;
  headless: boolean;
  help?: boolean;
}

// ── 命令行解析 ──

/** 命令行用法错误（与"门禁执行异常"区分：前者是调用姿势问题，后者是扫描器/浏览器炸了）。 */
export class CliUsageError extends Error {}

/** 未知标志 / 缺值 → throw（见文件头：打错字不得静默缩小检查面）。 */
export function parseArgs(argv: readonly string[]): CheckArgs {
  const out: CheckArgs = { headless: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-headless") {
      out.headless = false;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--url") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(
          "--url 缺参数值：用法 `--url http://localhost:5174`（显式复用已运行的 dev server）",
        );
      }
      out.url = value;
      i += 1;
    } else if (arg.startsWith("--url=")) {
      const value = arg.slice("--url=".length);
      if (value === "") throw new CliUsageError("--url 缺参数值：用法 `--url=http://localhost:5174`");
      out.url = value;
    } else {
      throw new CliUsageError(`未知参数 ${arg}——支持的标志：--url <url> / --no-headless / --help`);
    }
  }
  return out;
}

export const CHECK_USAGE = [
  "用法：tsx scripts/check/check.ts [--url <url>] [--no-headless] [--help]",
  "  （npm run check 即本入口；迭代期用 npm run check:fast 只跑静态层）",
  "  --url <url>     复用已运行的 dev server（缺省：进程内自起 Vite，永不复用外部服务）",
  "  --no-headless   只跑 fast 静态层（调试口；报告标题会如实标注「无头已跳过」）",
  "  --help          打印本用法",
].join("\n");

// ── 编排 ──

/** chapters 动态 import（与 check-fast 同源：manifest 是章节层的单一真相源）。 */
async function loadChapters(): Promise<ChapterDef[]> {
  const mod = (await import("../../src/chapters/manifest")) as { chapters: ChapterDef[] };
  return mod.chapters;
}

/**
 * 全量门禁：fast 层 → 无头层 → 合并。返回合并后的袋子（调用方决定怎么渲染/退出）。
 * 任一层抛错则整体抛出（CLI 入口转可读报告）——半份报告比不报更危险。
 */
export async function runCheck(opts: CheckOptions = {}, deps: CheckDeps = {}): Promise<FindingBag> {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const runFast = deps.runFast ?? ((o) => runCheckFast(o));
  const bag = await runFast({ repoRoot, chapters: opts.chapters });
  if (opts.headless === false) return bag;

  const chapters = opts.chapters ?? (await loadChapters());
  const runHeadless = deps.runHeadless ?? runHeadlessPass;
  const headlessBag = await runHeadless({ url: opts.url, chapters, repoRoot });
  bag.merge(headlessBag);
  return bag;
}

/** 报告标题（如实反映这一轮查了什么）。 */
export function reportTitle(args: Pick<CheckArgs, "headless">): string {
  return args.headless ? CHECK_REPORT_TITLE : CHECK_FAST_ONLY_TITLE;
}

export interface CheckIo {
  log(text: string): void;
  error(text: string): void;
}

/**
 * CLI 主体（可注入 deps/io——单测不启浏览器、不起 Vite）。返回退出码，由调用方 process.exit。
 */
export async function runCheckCli(
  argv: readonly string[],
  options: { deps?: CheckDeps; io?: CheckIo } = {},
): Promise<number> {
  const io: CheckIo = options.io ?? { log: console.log, error: console.error };
  const args = parseArgs(argv);
  if (args.help === true) {
    io.log(CHECK_USAGE);
    return 0;
  }
  const bag = await runCheck({ url: args.url, headless: args.headless }, options.deps);
  io.log(bag.render(reportTitle(args)));
  return bag.exitCode();
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
    try {
      process.exit(await runCheckCli(process.argv.slice(2)));
    } catch (e) {
      if (e instanceof CliUsageError) {
        // 用法错误不是"门禁崩溃"：直说 + 打用法，退出码 2（与 blocker 的 1 区分）
        console.error(`${e.message}\n${CHECK_USAGE}`);
        process.exit(2);
      }
      // 与 check:fast 同款兜底：import 链崩溃不泄裸栈（formatCrashMessage 复用同一处文案）
      console.error(formatCrashMessage(e));
      process.exit(1);
    }
  })();
}
