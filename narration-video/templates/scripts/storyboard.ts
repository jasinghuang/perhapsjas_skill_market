// M4 Task 3 编排层：`npm run storyboard` —— 读章节 manifest + public/audio-durations.json +
// 各章 src/chapters/<folder>/timing.json → buildStoryboardData → 逐帧截图（captureSteps）→
// 分镜门禁（零动画 + 帧数校验 + Ruling M4-2 氛围豁免）→ 写 storyboard/index.html +
// storyboard/storyboard.json（+ shots/），可选 --verify-sequential 做顺序/独立 mount 字节比对。
//
// 关键取舍（实现者报告）：
//   1. **截图 URL = ?render=1 + ?headless=1**（withHeadless 保 query）：render 模式给干净帧
//      （noUi 去播放控制条）+ 动画"创建即冻结"，caption 保留。注意"创建即冻结"**仍计入**引擎
//      注册表——门禁的计数语义不变（氛围步依旧计数 > 0，须声明 ambient）。
//   2. **门禁不用 capture 的 assertNoAnimations 一刀切**（计划 §实现规格 2）：氛围微动必须逐帧
//      按 timing.json 声明豁免，故本层收动画计数自行判定（gateStoryboard）。
//   3. **默认输出目录锚在模板根**（scripts/../storyboard）而非 cwd：`npm run storyboard` 与
//      `npx tsx scripts/storyboard.ts`（任意 cwd）产出同一处；`--out` 的相对路径按 cwd 解析
//      （CLI 常规语义）。
//   4. **blocker 也写产出**：门禁未过时 index.html/storyboard.json 照写（红条 + 逐帧徽标正是
//      给人看的排查材料），退出码 1 负责"拒绝通过"。
//   5. **--verify-sequential 复用主流程截图作独立 mount 参考**（见 verify-sequential.ts 取舍 1），
//      只新增键盘顺序推进这一条路径；氛围步免比对并注明（Ruling M4-2）。
//   6. **dev server 不自动起**（计划 §执行环境注意）：连接失败由 capture/verify 给 "先 npm run dev"
//      指引。

import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import "./check/loader-hooks"; // 模块副作用：非 vitest 环境注册 .css/.json/资产加载钩子（manifest React 链，终审 M-6）
import { captureSteps, expandSpecs, withHeadless } from "./shot/capture";
import { ambientKey, summarizeVerification, verifySequential } from "./shot/verify-sequential";
import {
  buildStoryboardData,
  gateStoryboard,
  hasBlockers,
  type StoryboardChapter,
  type StoryboardData,
  type TimingFile,
} from "./storyboard/data";
import { renderStoryboardHtml } from "./storyboard/html";

// ── 常量 ──

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 模板根（scripts/../..）——默认输出与章节目录的锚点 */
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "storyboard");
const CHAPTERS_DIR = path.join(REPO_ROOT, "src", "chapters");
const DURATIONS_PATH = path.join(REPO_ROOT, "public", "audio-durations.json");
/** 分镜截图 URL：render 模式（干净帧 + 动画创建即冻结）+ 桥安装条件（headless） */
const STORYBOARD_URL = "http://localhost:5174/?render=1";

export interface StoryboardArgs {
  outDir: string;
  verifySequential: boolean;
}

/** 参数解析（未知 flag = 响亮失败，不静默忽略——拼错的 flag 只会让产出悄悄不对）。 */
export function parseArgs(argv: readonly string[], cwd: string): StoryboardArgs {
  let outDir = DEFAULT_OUT_DIR;
  let verifySequential = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--out 需要一个目录参数（例：--out ./storyboard）");
      outDir = path.resolve(cwd, value);
    } else if (arg === "--verify-sequential") {
      verifySequential = true;
    } else {
      throw new Error(
        `未知参数 ${arg}——可用：--out <dir>（默认 <模板根>/storyboard）、--verify-sequential`,
      );
    }
  }
  return { outDir, verifySequential };
}

// ── 输入读取 ──

interface ManifestChapter {
  id: string;
  folder: string;
  steps: number;
  narrations: string[];
}

/** 章节 manifest（动态 import：loader-hooks 先于本链注册——tsx 下 CSS/资产 import 才不炸）。 */
async function loadChapters(): Promise<ManifestChapter[]> {
  const mod = (await import("../src/chapters/manifest")) as unknown as {
    chapters: ManifestChapter[];
  };
  return mod.chapters;
}

/** 章节 timing.json（可选文件；缺失 = undefined → 全默认）。解析失败给文件定位。 */
function readTimingFile(chapter: ManifestChapter): TimingFile | undefined {
  const file = path.join(CHAPTERS_DIR, chapter.folder, "timing.json");
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as TimingFile;
  } catch (e) {
    throw new Error(
      `${path.relative(REPO_ROOT, file)} 解析失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** public/audio-durations.json（不存在 = null → 全帧未合成降级；合法：未跑 TTS）。 */
function readAudioDurations(): unknown {
  if (!fs.existsSync(DURATIONS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DURATIONS_PATH, "utf8"));
  } catch (e) {
    throw new Error(
      `public/audio-durations.json 解析失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ── 报告 ──

function printFindings(data: StoryboardData): void {
  for (const f of data.findings) {
    console.log(`[${f.severity}] ${f.location} ${f.message}`);
  }
  for (const w of data.warnings) {
    console.log(`[warning] ${w}`);
  }
}

// ── 主流程 ──

export interface StoryboardRunResult {
  exitCode: number;
  data: StoryboardData;
  outDir: string;
}

/**
 * 全流程（可被 M5/测试复用——不含 process.exit）：截图 → 门禁 → 写产出 →（可选）一致性校验。
 */
export async function runStoryboard(
  args: StoryboardArgs,
  log: (line: string) => void = console.log,
): Promise<StoryboardRunResult> {
  const chapters = await loadChapters();
  const sbChapters: StoryboardChapter[] = chapters.map((c) => ({
    id: c.id,
    folder: c.folder,
    steps: c.steps,
    narrations: c.narrations,
  }));
  const timings: Record<string, TimingFile | undefined> = {};
  for (const c of chapters) timings[c.id] = readTimingFile(c);

  const durations = readAudioDurations();
  const plan = buildStoryboardData({ chapters: sbChapters, durations, timings });

  log(
    `[storyboard] 章节 ${chapters.length} 个 · 帧 ${plan.expectedFrames} 个 · 音频时长：` +
      (durations === null
        ? "public/audio-durations.json 不存在 → 全帧按未合成降级（合法：未跑 TTS）"
        : "取自 public/audio-durations.json"),
  );

  const specs = expandSpecs(chapters);
  const captured = await captureSteps(specs, {
    url: withHeadless(STORYBOARD_URL),
    outDir: args.outDir,
    chapterIds: chapters.map((c) => c.id), // Ruling M4-3：必传（shots/<chapterId>/<step>.png）
  });
  const gated = gateStoryboard(plan, captured);

  // 产出（blocker 也写——红条与逐帧徽标正是排查材料；退出码负责拒绝通过）
  fs.mkdirSync(args.outDir, { recursive: true });
  const htmlPath = path.join(args.outDir, "index.html");
  const jsonPath = path.join(args.outDir, "storyboard.json");
  fs.writeFileSync(htmlPath, renderStoryboardHtml(gated), "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(gated, null, 2) + "\n", "utf8");

  printFindings(gated);
  const blockers = gated.findings.filter((f) => f.severity === "blocker").length;
  const notes = gated.findings.filter((f) => f.severity === "note").length;
  const rel = (p: string): string => path.relative(process.cwd(), p) || p;
  log(
    `[storyboard] 门禁：${blockers > 0 ? "未通过" : "通过"}（blocker ${blockers}，note ${notes}，` +
      `帧数 ${captured.length}/${gated.expectedFrames}）`,
  );
  log(`[storyboard] 产出：${rel(htmlPath)} · ${rel(jsonPath)} · ${rel(path.join(args.outDir, "shots"))}/`);
  if (blockers > 0) {
    log(
      `[storyboard] 阻断原因见上：入场动画禁入静态版；氛围微动请在章节 timing.json 声明 ` +
        `"ambient": { "<step>": "<note>" }（Ruling M4-2）`,
    );
  }

  let exitCode = hasBlockers(gated) ? 1 : 0;

  if (args.verifySequential) {
    const ambientKeys = new Set(
      gated.frames
        .filter((f) => f.ambient !== null)
        .map((f) => ambientKey(f.chapter, f.step)),
    );
    const verdicts = await verifySequential({
      url: STORYBOARD_URL,
      specs,
      chapterIds: chapters.map((c) => c.id),
      ambientKeys,
      referenceDir: args.outDir,
      // 不一致时把两条路径的图落盘（全一致则不写任何东西）——差异现场留给排查
      diffDir: path.join(args.outDir, "verify"),
    });
    const report = summarizeVerification(verdicts);
    for (const line of report.lines) log(`[verify] ${line}`);
    if (report.exitCode !== 0) exitCode = 1;
  }

  return { exitCode, data: gated, outDir: args.outDir };
}

// ── CLI 入口（import.meta.url vs process.argv[1]，realpath 对齐防 /private 与符号链接） ──

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
  try {
    const args = parseArgs(process.argv.slice(2), process.cwd());
    runStoryboard(args)
      .then((result) => {
        process.exitCode = result.exitCode;
      })
      .catch((e: unknown) => {
        console.error(`[storyboard] 执行失败：${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
      });
  } catch (e) {
    console.error(`[storyboard] ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
