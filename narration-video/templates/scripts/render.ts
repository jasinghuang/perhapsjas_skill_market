// M5a Task 7 编排层：`npm run render` —— 把 T1~T6 的五段接成**一条命令**：
//
//   [--mock-audio → 音轨 + durations] → 窗口预扫 → buildTimeline → captureFrames → encode → verify
//
// **顺序是实测定的，不是风格**（逐条见各段文件头）：
//   · `--mock-audio` 必须最早——它产出 `public/audio-durations.json`，而时间轴表的每步时长从那里读
//     （晚一步就是在用上一轮/不存在的时长算片子）；
//   · 窗口预扫在 buildTimeline **之前**——`animMsByStep` 是时间轴的入参（T2 是它的唯一生产者）；
//   · 拍帧 → 编码 → 自校验是产物流水线，半步都换不得位置。
//
// ## 三段联动只认同一张（子）时间轴表（T5/T6 挣来的接线约束）
//
//   · `captureFrames(specs, {timeline})`：帧数/时刻表/窗口来源——specs 就是这张表的 steps 投影；
//   · `encodeVideo({stepMsByStep, segments})`：**两个数组都从 `timeline.steps` 取**
//     （`stepMsByStep = steps.map(s => s.stepMs)`、`segments[i].stepMs = steps[i].stepMs`）。
//     T5 有护栏：两处 stepMs 不一致即在第一条 ffmpeg 命令之前 throw；
//   · `verifyRender({timeline, segments})`：`segments` 必传（T6 的边界断言拿音轨段当时间轴步边界的
//     载体），且 `viewport` / `softwareGL` 必须与 captureFrames 那次**逐字相同**（它会重开会话重采）。
//
// `--only` 的口径：**传子时间轴**（T6 的 verify 不裁剪）。子表不是"原表过滤一下就完"——
// 它的 `startMs` / `totalMs` 必须按被渲的步**重算**（沿用全表前缀和 = 拿错位的边界去判产物，
// 见 `selectTimeline`）。captureFrames 自己的 `only` 是 specs 下标语义（另一条路，本层不用）。
//
// ## 自起 Vite（M3b 的 `startServe`）
//
// 复用 `scripts/check/serve.ts`：**默认永不复用外部服务**（探活即复用会静默检查别人的项目——
// K-54），端口占用由 Vite 自己 +1。不提供 `--url`：预扫/拍帧的 viewport 取自 `stageConfig.dims`，
// 指向别的项目就会"视口不随 URL 走"（T2 评审点名）——渲染链只跑本仓模板。
//
// ## loader-hooks 必挂（模块副作用，见文件末的 import 顺序）
//
// 非 vitest 环境下 manifest 的 React/CSS 链要 node 侧加载钩子才不崩（`scripts/storyboard.ts:26` 的先例）。
//
// ## 无音频 deck 明示，不静默
//
// `public/audio-durations.json` 不存在 = 未跑 TTS 的合法态：打印"未合成音频，按估时出片（无声）"，
// 每步音轨用 `anullsrc` 段顶（`encode.buildAudioFilterComplex`）。**不合法**的是"有 mp3 没时长"
// 或"有时长没 mp3"——那两条是 Ruling R4 的静默降级（按估时算时长 + atrim 把真人声截断，而帧数/
// 时长/边界三条自校验全绿），故 `buildAudioSegments` 直接 throw。
//
// ## 依赖方向
//
// scripts/render.ts → scripts/render/*（只 import，不改各模块内部）+ scripts/check（serve/headless）
// + scripts/shot（会话面）+ scripts/storyboard/data（音频对位口径，同一份）+ src/engine
// （stageConfig/hold）。src/ 不反向 import scripts/。

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import "./check/loader-hooks"; // 模块副作用：非 vitest 环境注册 .css/.json/资产加载钩子（manifest React 链）
import { withRenderMode } from "./check/headless";
import { startServe, type ServeHandle } from "./check/serve";
import {
  MOCK_AUDIO_DEFAULT,
  MOCK_AUDIO_REALISTIC,
  synthesizeMockAudio,
  type MockAudioProfile,
  type SynthesizeMockAudioResult,
} from "./render/audio";
import {
  encodeVideo,
  type AudioSegment,
  type EncodeOptions,
  type EncodeResult,
} from "./render/encode";
import {
  captureFrames,
  frameDir,
  framePaths,
  frameTimes,
  paintAndSettle,
  type CaptureFramesOptions,
  type CapturedStep,
  type FrameSpec,
} from "./render/frames";
import { buildTimeline, type Timeline, type TimelineStep } from "./render/timeline";
import { buildSrtCues, renderSrt } from "./render/srt";
import {
  captureRealtime,
  realtimeUrl,
  type RealtimeOptions,
  type RealtimeResult,
} from "./render/realtime";
import { scanAnimationWindows, type WindowScanResult } from "./render/window-scan";
import {
  sampledFrames,
  verifyRender,
  type RenderVerifyReport,
  type SampledFrame,
  type VerifyOptions,
} from "./render/verify";
import { jumpToStep, openSession, readyWithTimeout, seekTo, withHeadless, withNoSubs } from "./shot/session";
import {
  hasAudio,
  normalizeDurations,
  normalizeTiming,
  type AudioDurations,
  type TimingFile,
} from "./storyboard/data";
import type { StageDims } from "../src/engine/useStageScale";
import { stageConfig } from "../src/engine/runtime-config";

// ── 常量 ──

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
/** 模板根（scripts/../）——默认输出目录与章节/音频目录的锚点（与 storyboard.ts 同款） */
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
/** 默认输出根：`<模板根>/render/`（`/render/` 已 gitignore；**前导斜杠**锚定模板根） */
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, "render");
/** 章节目录（timing.json 的读取锚点） */
const CHAPTERS_SUBDIR = path.join("src", "chapters");
/** mock 音轨/真 TTS 的 mp3 目录（与 App 的 `/audio/<folder>/<step>.mp3` 同构） */
const AUDIO_SUBDIR = path.join("public", "audio");
/** 时长表（T1 时间轴的实测来源） */
const DURATIONS_SUBDIR = path.join("public", "audio-durations.json");
/** 默认并发（每 worker 一个浏览器进程——本机负载常高，别开大） */
const DEFAULT_CONCURRENCY = 2;

// ── 接口 ──

/** 命令行用法错误（与"渲染执行异常"区分：前者是调用姿势问题，后者是链路上某段炸了）。 */
export class RenderUsageError extends Error {}

export interface RenderArgs {
  /** 输出根目录（产物 `render/<slug>.mp4` + 中间产物 `render/<slug>/`） */
  outDir: string;
  /** 先合成 mock 音轨（T5 的 `synthesizeMockAudio`：lavfi 正弦 + ffprobe 实测时长表） */
  mockAudio: boolean;
  /** 拟真档音轨形状（`MOCK_AUDIO_REALISTIC`：起手静音 120ms / 44100 / 单声道）——只在 `mockAudio` 时生效 */
  realisticAudio: boolean;
  /** 帧流并发（**0 归 1**：0/负数会除零或空跑） */
  concurrency: number;
  /** 只渲这些步（specs 下标：章节序 → 章内步序；升序去重后的**子时间轴**） */
  only?: number[];
  /** 确定性终验：独立会话重采采样步 → 与产物帧逐字节比对 + "两个不同 t 必须不同"的负样本 */
  verifyDeterminism: boolean;
  /**
   * `--no-srt`：**不写**字幕副产物（缺省 = 写 `<outDir>/<slug>.srt`）。
   *
   * 与 `only?` 同款：缺省（undefined）= 默认行为，只有显式 `--no-srt` 才是 true——
   * 这是个**否定式**开关（"没给" ≠ "给了 false"），与 `--no-subs` 一样是"关掉默认开的东西"。
   * 口径：SRT 是**纯文本副产物**（narrations × 时间轴表），与画面无关——`--no-subs` 不影响它。
   */
  noSrt?: boolean;
  /**
   * `--no-subs`：出**无字幕版**（缺省 = 字幕进片，`Stage` 的框架级闸门）。
   *
   * 与 `noSrt?` 同款否定式开关（缺省 undefined = 默认行为），但**两者是两件事**，不得互相复用：
   *   · `noSubs` = **画面**里不挂字幕层（`?no-subs=1` → `Stage` 不渲染 `CaptionLayer`）——
   *     它改的是像素，故帧流/自校验重采/确定性终验都吃同一份归一 URL；
   *   · `noSrt` = 不写**文本副产物** `<outDir>/<slug>.srt`（纯派生，与画面无关）。
   * 交叉组合合法：`--no-subs` 仍然写 SRT（字幕文本不因画面免了就不给），`--no-srt` 也照常有字幕画面。
   */
  noSubs?: boolean;
  /**
   * `--no-fallback`：确定性链路失败时**不**走实时捕获降级（M5b T4 的逃生舱，缺省 = 降级）。
   *
   * 与 `noSubs?` / `noSrt?` 同款否定式开关（缺省 undefined = 默认行为），但关掉的是**失败路径**：
   * 缺省下 seek 断言抛错或自校验未过都会降级出 `<slug>.realtime.mp4`（响亮：产物名 + 日志）；
   * 给上它 = 严格模式（失败照旧抛 / 退出码 1），适合"我要的就是确定性产物"的场合。
   */
  noFallback?: boolean;
  help: boolean;
}

/** 章节 manifest 在本层的最小投影（结构上兼容 `ChapterDef`；注入式测试不必拖进 React 链）。 */
export interface RenderChapter {
  id: string;
  folder: string;
  steps: number;
  narrations: readonly string[];
}

/** 进程输出面（注入式：单测不打印）。 */
export interface RenderIo {
  log(text: string): void;
  error(text: string): void;
}

/**
 * 可注入的依赖（单测路径：**不启浏览器、不起 Vite、不跑 ffmpeg**）。缺省 = 真实现。
 * 形状与各模块的公开签名一致（`typeof` 取型，改了签名这里就编译不过——不会单侧漂移）。
 */
export interface RenderDeps {
  /** 模板根（章节 timing.json / public/ 的锚点）；默认 `scripts/../` */
  repoRoot?: string;
  loadChapters?: () => Promise<RenderChapter[]>;
  synthesizeMockAudio?: (opts: {
    chapters: readonly RenderChapter[];
    repoRoot: string;
    profile?: MockAudioProfile;
  }) => Promise<SynthesizeMockAudioResult>;
  startServe?: (opts: { repoRoot: string }) => Promise<ServeHandle>;
  scanAnimationWindows?: (opts: {
    url: string;
    chapters: readonly { steps: number }[];
  }) => Promise<WindowScanResult>;
  captureFrames?: (specs: readonly FrameSpec[], opts: CaptureFramesOptions) => Promise<CapturedStep[]>;
  encodeVideo?: (opts: EncodeOptions) => Promise<EncodeResult>;
  verifyRender?: (opts: VerifyOptions) => Promise<RenderVerifyReport>;
  /** 失败降级（M5b T4）：verify 未过 / seek 断言抛错 → 实时捕获出片（`--no-fallback` 关） */
  realtimeCapture?: (opts: RealtimeOptions) => Promise<RealtimeResult>;
  runDeterminism?: (opts: DeterminismOptions) => Promise<DeterminismReport>;
  /**
   * 进度上报（M5b T5，M4-3 款追加字段）：导出服务（页面按钮，§9）拿它做进度条。
   *
   * 粒度 = **帧流阶段落齐的步数**（`total` = 本张子时间轴的步数），顺序恒为
   * `(0,total)` → 帧流期间每落齐一步报一次 → `(total,total)`。读数来自产物本身
   * （`frameStepsDone`：mtime ≥ 捕捉起点的末帧才算"本次落齐"），**不是猜的**，也不参与任何判据。
   *
   * 两条边界：① 降级路径（T4）不补 `(total,total)`——帧流没走完就不谎报走完（产物由 done 态的
   * 产物名说明）；② `RenderIo` 的文本行不够用（没有结构化读数面），故这里是**注入字段**。
   */
  onProgress?: (done: number, total: number) => void;
}

// ── 命令行解析 ──

export const RENDER_USAGE = [
  "用法：tsx scripts/render.ts [--mock-audio] [--realistic-audio] [--only <i,j,…>] [--concurrency <n>] [--out <dir>] [--no-subs] [--no-srt] [--verify-determinism] [--help]",
  "  （npm run render 即本入口；自起 Vite + Chromium 逐帧 seek 出 mp4，前置 ffmpeg）",
  "  ⚠️ 经 npm 传 flag 必须加 --（npm 11 会把 --mock-audio 当成 npm 自己的配置项、不转发给脚本；",
  "     漏了它 = mock 分支根本不跑，只在 stderr 留一条 Unknown cli config）：",
  "     npm run render -- --mock-audio",
  "  --mock-audio          先合成 mock 音轨（lavfi 正弦 + ffprobe 实测时长 → public/audio/ + public/audio-durations.json）",
  "  --realistic-audio     拟真档音轨形状（起手静音 120ms / 44100Hz / 单声道——真 TTS 的典型形状）；须与 --mock-audio 同用",
  "  --only <i,j,…>        只渲这些步（specs 下标：章节序 → 章内步序；编码/自校验同步只处理这些步）",
  "  --concurrency <n>     帧流并发（默认 2；每 worker 一个浏览器进程——本机负载常高，别开大）",
  "  --out <dir>           输出根目录（默认 <模板根>/render）：出片 <dir>/<slug>.mp4，中间产物 <dir>/<slug>/",
  "  --no-subs             出无字幕版（默认**字幕进片**：框架字幕层在 .stage-frame 内，整视口截图天然带它）；",
  "                        归一成 ?no-subs=1 喂**帧流/自校验重采/确定性终验同一份 URL**（漏一处即假红）；",
  "                        只关画面字幕层——SRT 是文本副产物，--no-subs 不影响它",
  "  --no-srt              不写字幕副产物（默认写 <dir>/<slug>.srt：narrations × 时间轴表纯派生；",
  "                        与画面无关——--no-subs 不影响它），只影响 SRT 落盘",
  "  --verify-determinism  确定性终验：独立会话重采采样步 → 与产物帧逐字节比对 + 负样本（两个不同 t 必须不同）",
  "  --no-fallback         确定性链路失败（自校验未过 / seek 断言抛错）时**不走**实时捕获降级；",
  "                        缺省 = 降级出 <dir>/<slug>.realtime.mp4（实时播放 + 录屏 + 同一份音轨 mux；",
  "                        A/V 同步是近似的，见 KNOWN-ISSUES）；给上它 = 严格模式（失败即抛 / 退出码 1）",
  "  --help                打印本用法",
].join("\n");

const USAGE_FLAGS =
  "--mock-audio / --realistic-audio / --only / --concurrency / --out / --no-subs / --no-srt / --verify-determinism / --no-fallback / --help";

/** 并发数：非负整数（`0` 归 1——0/负数会除零或空跑；归一发生在 CLI 层，见 frames.partition 的注释）。 */
function parseConcurrency(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) {
    throw new RenderUsageError(`${flag} 需要一个非负整数（实为 ${JSON.stringify(value)}）`);
  }
  return Number.parseInt(value, 10) === 0 ? 1 : Number.parseInt(value, 10);
}

/**
 * `--only` 的取值：逗号分隔的 specs 下标。**升序去重**——成片顺序只由 step 序定，
 * 不由命令行次序定（`captureFrames` 的 `selectIndices` 也是这个口径；两处不一致会让子表与
 * 帧流对不上）。
 */
function parseOnly(value: string, flag: string): number[] {
  const parts = value.split(",");
  const out = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new RenderUsageError(
        `${flag} 需要一个逗号分隔的步下标列表（实为 ${JSON.stringify(value)}；例：--only 0,2）`,
      );
    }
    out.add(Number.parseInt(part, 10));
  }
  return [...out].sort((a, b) => a - b);
}

/** 参数解析（未知 flag = 响亮失败，不静默忽略——拼错的 flag 只会让产出悄悄不对）。 */
export function parseArgs(argv: readonly string[], cwd: string): RenderArgs {
  const out: RenderArgs = {
    outDir: DEFAULT_OUT_DIR,
    mockAudio: false,
    realisticAudio: false,
    concurrency: DEFAULT_CONCURRENCY,
    only: undefined,
    verifyDeterminism: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const takeValue = (): string => {
      if (inline !== undefined) {
        if (inline === "") throw new RenderUsageError(`${name} 缺参数值`);
        return inline;
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new RenderUsageError(`${name} 缺参数值`);
      }
      i += 1;
      return value;
    };
    switch (name) {
      case "--mock-audio":
        out.mockAudio = true;
        break;
      case "--realistic-audio":
        out.realisticAudio = true;
        break;
      case "--verify-determinism":
        out.verifyDeterminism = true;
        break;
      case "--no-subs":
        out.noSubs = true;
        break;
      case "--no-srt":
        out.noSrt = true;
        break;
      case "--no-fallback":
        out.noFallback = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--concurrency":
        out.concurrency = parseConcurrency(takeValue(), name);
        break;
      case "--only":
        out.only = parseOnly(takeValue(), name);
        break;
      case "--out":
        out.outDir = path.resolve(cwd, takeValue());
        break;
      default:
        throw new RenderUsageError(`未知参数 ${arg}——支持的标志：${USAGE_FLAGS}`);
    }
  }
  // `--realistic-audio` 是 `--mock-audio` 的**修饰**（音轨形状只在合成那一刻有意义）：
  // 单给它什么都不生产，静默忽略等于让用户以为"拟真档出片了"。顺序无关，故在循环后判。
  if (out.realisticAudio && !out.mockAudio) {
    throw new RenderUsageError(
      "--realistic-audio 只在 --mock-audio 同用时有意义（它改的是待合成音轨的形状）——" +
        "单给不会合成任何音轨；要出拟真档成片请写：npm run render -- --mock-audio --realistic-audio",
    );
  }
  return out;
}

// ── 输入读取（与 storyboard 侧同源：durations 口径与 timing 守卫都不另写一份） ──

/** public/audio-durations.json（不存在 = null → 全步未合成降级；合法：未跑 TTS）。 */
function readAudioDurations(repoRoot: string): AudioDurations | null {
  const file = path.join(repoRoot, DURATIONS_SUBDIR);
  if (!fs.existsSync(file)) return null;
  try {
    return normalizeDurations(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (e) {
    throw new Error(
      `${DURATIONS_SUBDIR} 解析失败：${e instanceof Error ? e.message : String(e)}——` +
        `该文件是时间轴每步时长的实测来源（坏数据不静默）`,
    );
  }
}

/** 各章 src/chapters/<folder>/timing.json（可选文件；缺 = undefined → 全默认）。 */
function readTimings(
  chapters: readonly RenderChapter[],
  repoRoot: string,
): Record<string, TimingFile | undefined> {
  const out: Record<string, TimingFile | undefined> = {};
  for (const chapter of chapters) {
    const rel = path.join(CHAPTERS_SUBDIR, chapter.folder, "timing.json");
    const file = path.join(repoRoot, rel);
    if (!fs.existsSync(file)) {
      out[chapter.id] = undefined;
      continue;
    }
    try {
      // 顶层守卫与分镜/门禁同一份（storyboard/data.ts 的 normalizeTiming）：坏文件不静默当"没写"
      out[chapter.id] = normalizeTiming(JSON.parse(fs.readFileSync(file, "utf8")), chapter.folder);
    } catch (e) {
      throw new Error(
        `${rel} 解析失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return out;
}

/** 章节 manifest（动态 import：loader-hooks 先于本链注册——tsx 下 CSS/资产 import 才不炸）。 */
async function loadChapters(): Promise<RenderChapter[]> {
  const mod = (await import("../src/chapters/manifest")) as unknown as {
    chapters: RenderChapter[];
  };
  return mod.chapters;
}

// ── 纯函数（单测面） ──

/**
 * 子时间轴（`--only` 的唯一载体）：只保留被渲的步，且 `startMs` / `totalMs` **按子表重算**。
 *
 * 为什么必须重算：`verifyRender` 的边界断言拿 `step.startMs` 当"这一步该在第几帧/第几毫秒开始"
 * 的期望值（视频内容边界 + 音轨边界两条，是"总时长对而音画错位"的唯一护栏）。沿用全表的前缀和
 * ⇒ 期望值指向片子里**不存在**的位置 ⇒ 每条边界都报"错位"，或（更糟）恰好落在容差内而假绿。
 *
 * 顺序 = 升序（与 `captureFrames.selectIndices` 同口径）：成片顺序只由 step 序定。
 * 越界下标 / 空 only → throw（宁炸不静默：空跑或拿别的步顶替，产物与自校验会一起自洽地错）。
 */
export function selectTimeline(timeline: Timeline, only: readonly number[] | undefined): Timeline {
  if (only === undefined) return timeline;
  if (only.length === 0) {
    throw new Error(
      "selectTimeline：--only 为空——一步都不渲的空跑（成片会没有帧可编码）；宁炸不静默",
    );
  }
  const wanted = [...new Set(only)].sort((a, b) => a - b);
  let startMs = 0;
  const steps = wanted.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= timeline.steps.length) {
      throw new Error(
        `selectTimeline：--only 下标 ${index} 越界（本表 ${timeline.steps.length} 步，合法下标 0…` +
          `${timeline.steps.length - 1}）——越界下标会静默渲零步、或拿别的步顶替；宁炸不静默`,
      );
    }
    const step = timeline.steps[index];
    const shifted: TimelineStep = { ...step, startMs };
    startMs += step.stepMs;
    return shifted;
  });
  return { steps, totalMs: startMs, fps: timeline.fps };
}

/**
 * 窗口预扫表与 manifest 的对位（T1 minor ①：缺位在 `buildTimeline` 里被**宽松**读成窗口 0）。
 *
 * 宽松是消费面（手写输入也得能渲）的契约，代价是"预扫表少了半章"这种错误在时间轴里无声无息
 * ——该步退化成一张静态图，而帧数/时长/自校验全绿（它们只看时间轴自己）。故在 CLI 边界把
 * 形状钉死：两处共同的上界检查（T2 的 `flattenWindowScan` 是生产侧的那道）。
 */
export function assertWindowTableShape(
  animMsByStep: readonly (readonly number[])[],
  chapters: readonly { id: string; steps: number }[],
): void {
  if (animMsByStep.length !== chapters.length) {
    throw new Error(
      `窗口预扫表 ${animMsByStep.length} 章 ≠ manifest ${chapters.length} 章` +
        `（manifest：${chapters.map((c) => `${c.id} ${c.steps} 步`).join("、")}）——` +
        `缺位会被时间轴静默读成窗口 0（该步成片冻住）；宁炸不静默`,
    );
  }
  chapters.forEach((chapter, index) => {
    const row = animMsByStep[index] ?? [];
    if (row.length !== chapter.steps) {
      throw new Error(
        `窗口预扫表 章节 ${chapter.id}（下标 ${index}）${row.length} 个读数 ≠ ${chapter.steps} 步` +
          `——缺位会被时间轴静默读成窗口 0（该步成片冻住），多出的读数则说明对位已错；宁炸不静默`,
      );
    }
  });
}

/**
 * 音频时长表与 narrations 的对位（Ruling R4：T1 评审点名的 T7 责任）。
 *
 * 对不上时**不会**有人喊：`resolveAudioMs` 取不到的条目按"未合成"降级 ⇒ `buildTimeline` 改走
 * 估时 ⇒ 而 `buildAudioSegments` 会把真 mp3 按这个估时 `atrim` 截断 ⇒ 成片比人声短，且帧数/
 * 总时长/边界三条自校验**全绿**（它们只与时间轴自己对账）。故在入口就炸（口径与 `resolveAudioMs`
 * 同源：章节 id 优先、folder 兜底；扁平数组形态按总数）。
 */
export function assertAudioDurationAlignment(
  chapters: readonly RenderChapter[],
  durations: AudioDurations | null,
): void {
  if (durations === null) return; // 未跑 TTS 的合法态（调用方已明示"按估时出片（无声）"）
  if (Array.isArray(durations)) {
    const want = chapters.reduce((n, c) => n + c.narrations.filter(hasAudio).length, 0);
    if (durations.length !== want) {
      throw new Error(
        `音频时长条目数 ${durations.length} ≠ 总非空 narrations ${want}（扁平数组形态）——` +
          `取不到的条目会静默改用估时、再被 atrim 把真人声截断；请重跑 --mock-audio 或重新合成 TTS`,
      );
    }
    return;
  }
  const byChapter = durations as Record<string, readonly (number | null)[]>;
  for (const chapter of chapters) {
    const arr = byChapter[chapter.id] ?? byChapter[chapter.folder];
    const want = chapter.narrations.filter(hasAudio).length;
    if (arr === undefined) {
      throw new Error(
        `音频时长缺章节键 "${chapter.id}"（也试过 folder "${chapter.folder}"）——该章会静默` +
          `按未合成降级（时间轴走估时、真 mp3 被 atrim 截断，而自校验全绿）；` +
          `请重跑 --mock-audio 或重新合成 TTS`,
      );
    }
    if (arr.length !== want) {
      throw new Error(
        `章节 ${chapter.id}：音频时长条目数 ${arr.length} ≠ 非空 narrations ${want}——` +
          `按非空句顺序对位（P4-9 口径），多出/缺少的一条会让该章之后的步**整体错位**，` +
          `且时间轴与自校验会一起自洽地错；宁炸不静默`,
      );
    }
  }
}

/**
 * 每步一行的进度/计划读数：`[render] 章节 example 第 0 步 · 91 帧 · 3400ms · 音频 1750ms`。
 *
 * 音频尾巴分三态（**不是静默**）：有实测时长 / 有稿未合成（估时出片，无声）/ 无声过场（空 narration）。
 */
export function stepLine(step: TimelineStep, narration: string): string {
  const audio =
    step.audioMs !== null
      ? ` · 音频 ${step.audioMs}ms`
      : hasAudio(narration)
        ? " · 无声（未合成）"
        : " · 无声过场";
  return `[render] 章节 ${step.chapterId} 第 ${step.step} 步 · ${step.frameCount} 帧 · ${step.stepMs}ms${audio}`;
}

/**
 * 音频段（音轨图的入参）：每步一段，`mp3` 为绝对路径或 null（无声步 → `anullsrc`）。
 *
 * 三条规则（两条 throw 是 Ruling R4 的正面堵法）：
 *   · mp3 在 + 有实测时长 → 用文件；
 *   · **mp3 在但没实测时长 → throw**：时长按估时算、atrim 把真人声截断，而三条自校验全绿；
 *   · **有实测时长但 mp3 不在 → throw**：成片静默少一段人声（音轨用静音段顶）。
 * 两者都没有 = 未合成（合法，明示过）；空 narration 步不吃文件（App 那一步 audioSrc 就是 null）。
 */
export function buildAudioSegments(opts: {
  chapters: readonly RenderChapter[];
  timeline: Timeline;
  /** `<repoRoot>/public/audio` */
  audioRoot: string;
  /** 覆盖文件存在性判断（测试用；默认 fs.existsSync） */
  exists?: (file: string) => boolean;
}): { segments: AudioSegment[]; silent: number[] } {
  const exists = opts.exists ?? ((file: string) => fs.existsSync(file));
  const segments: AudioSegment[] = [];
  /** 本表序下标：有稿但无 mp3 的步（"未合成"，走估时；CLI 明示） */
  const silent: number[] = [];
  opts.timeline.steps.forEach((step, index) => {
    const chapter = opts.chapters[step.chapter];
    const narration = chapter?.narrations[step.step] ?? "";
    const where = `章节 ${step.chapterId} 第 ${step.step} 步（本表第 ${index} 步）`;
    const file = path.join(opts.audioRoot, chapter?.folder ?? step.chapterId, `${step.step}.mp3`);
    const hasFile = hasAudio(narration) && exists(file);
    const measured = step.audioMs !== null;
    if (hasFile && !measured) {
      throw new Error(
        `buildAudioSegments：${where} 的 mp3 在（${file}）但 ${DURATIONS_SUBDIR} 没有该步的实测时长` +
          `——时间轴会按估时算这一步，atrim 把真人声截断，而帧数/时长/边界三条自校验全绿（它们只` +
          `与时间轴自己对账）。请重跑 npm run render -- --mock-audio 或重新合成 TTS 刷新时长表`,
      );
    }
    if (!hasFile && measured) {
      throw new Error(
        `buildAudioSegments：${where} 有实测时长 ${step.audioMs}ms 但 mp3 不在（${file}）——` +
          `成片会静默少一段人声（音轨用静音段顶，而时长/帧数照旧自洽）；` +
          `请重跑 --mock-audio 或重新合成 TTS`,
      );
    }
    if (!hasFile && hasAudio(narration)) silent.push(index);
    segments.push({ mp3: hasFile ? file : null, stepMs: step.stepMs });
  });
  return { segments, silent };
}

// ── 确定性终验（--verify-determinism） ──

export interface DeterminismOptions {
  /** 页面基址（本函数自己 `withRenderMode`——与 verify 同款归一） */
  url: string;
  /** 中间产物目录（帧目录 = `<outDir>/frames/…`，与 captureFrames/encode 同一个） */
  outDir: string;
  timeline: Timeline;
  /** **必须与 captureFrames 那次相同**（重开会话重采，像素要可比） */
  viewport?: { width: number; height: number };
  /** **必须与 captureFrames 那次相同** */
  softwareGL?: boolean;
}

export interface DeterminismReport {
  ok: boolean;
  lines: string[];
  failures: string[];
}

/** 一对负样本读数：同一步内两个不同 t 的**产物帧**的 md5。 */
export interface DeterminismPair {
  label: string;
  tA: number;
  tB: number;
  md5A: string;
  md5B: string;
  /** 两端完全相同（对称动画 / 静帧）——这一对不提供"判据有牙"的证据 */
  identical: boolean;
}

/**
 * 负样本（"两个不同 t 必须不同"）：采样步的首帧（t=0）与末帧（静帧落在 `animMs`）。
 *
 * 为什么必须有：`--verify-determinism` 的主判据是"独立会话重采 == 产物帧"（md5 逐字节）。若帧流
 * 里两个不同 t 的画面本来就一样，这条判据**自证成立**——它证明不了"重采那一刻页面上真有内容"。
 * 判据来自 T4 的确定性臂（真机实测 t=0 ≠ t=1500），这里把它固化成 CLU 的一步。
 *
 * md5 读取器注入（单测不碰真 PNG）；单帧步（`frameCount = 1`）没有"两个 t"可判，不成对。
 */
export function determinismPairs(
  frames: readonly SampledFrame[],
  outDir: string,
  timeline: Timeline,
  md5: (file: string) => string,
): DeterminismPair[] {
  const byStep = new Map<string, SampledFrame[]>();
  for (const frame of frames) {
    const key = `${frame.chapter}:${frame.step}`;
    const group = byStep.get(key);
    if (group === undefined) byStep.set(key, [frame]);
    else group.push(frame);
  }
  const out: DeterminismPair[] = [];
  for (const group of byStep.values()) {
    if (group.length < 2) continue;
    const first = group[0];
    const last = group[group.length - 1];
    const step = timeline.steps.find((s) => s.chapter === first.chapter && s.step === first.step);
    if (step === undefined) {
      throw new Error(
        `determinismPairs：采样点（章节 ${first.chapter} 第 ${first.step} 步）不在时间轴表里——` +
          `采样点必须由 timeline.steps 构造（sampledFrames 的契约）；宁炸不静默`,
      );
    }
    const paths = framePaths(frameDir(step.chapterId, step.step), step.frameCount);
    const md5A = md5(path.join(outDir, paths[first.index]));
    const md5B = md5(path.join(outDir, paths[last.index]));
    out.push({
      label: `章节 ${step.chapterId} 第 ${step.step} 步`,
      tA: first.tMs,
      tB: last.tMs,
      md5A,
      md5B,
      identical: md5A === md5B,
    });
  }
  return out;
}

function md5File(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/**
 * 确定性终验（计划的 Step 5）：独立会话**重采采样步的整段帧流** → 与产物帧 md5 逐字节比对，
 * 外加"两个不同 t 必须不同"的负样本。
 *
 * 与 `verifyRender` 的跨会话重采（T6）**同源不同面**：T6 只比重采窗口里的首末两帧（自校验的
 * 一部分，每次渲染都跑）；本函数比**采样步的每一帧**（计划的双渲对比最小面），且把负样本
 * 单列成读数。序列（`jumpTo` → ready → 归位 `seek(0)` → `seek(t)` → 两拍 rAF → 截图）与 T4/T6
 * 逐字相同——同一份 `paintAndSettle`（含落定超时），不另写一份时序。
 *
 * 判据面为空的护栏：负样本成对数为 0（全 deck 都是单帧步）→ 报红，不静默"全绿"。
 */
export async function runDeterminism(opts: DeterminismOptions): Promise<DeterminismReport> {
  const lines: string[] = [];
  const failures: string[] = [];
  const timeline = opts.timeline;
  if (timeline.steps.length === 0) {
    throw new Error("runDeterminism：时间轴表为空——没有可重采的帧（空跑会「全绿」）；宁炸不静默");
  }

  // 采样步（与 T6 同一份口径：min(3, 步数)，必含首末步）
  const sampled = sampledFrames(timeline);
  const picked: TimelineStep[] = [];
  for (const point of sampled) {
    const step = timeline.steps.find((s) => s.chapter === point.chapter && s.step === point.step)!;
    if (!picked.includes(step)) picked.push(step);
  }

  // 负样本先判（判据有没有牙，先于它给出的任何"一致"结论）
  const pairs = determinismPairs(sampled, opts.outDir, timeline, md5File);
  for (const pair of pairs) {
    lines.push(
      pair.identical
        ? `负样本 ${pair.label}：t=${pair.tA}ms 与 t=${pair.tB}ms 的产物帧相同（md5 ${pair.md5A}）` +
            `——该步两端画面本就一样（对称动画 / 静帧），这一对不提供"判据有牙"的证据`
        : `负样本 ${pair.label}：t=${pair.tA}ms 与 t=${pair.tB}ms 的产物帧不同（md5 ${pair.md5A.slice(0, 8)}… ` +
            `vs ${pair.md5B.slice(0, 8)}…）——逐字节比对不是空转`,
    );
  }
  if (pairs.length === 0) {
    failures.push(
      `[失败] 负样本：${picked.length} 个采样步里没有一步有两个不同 t 的帧（全是单帧步）` +
        `——"重采逐字节一致"在这个 deck 上没有可判定的面；这不是产物错，是判据面为空（宁红不假绿）`,
    );
  } else if (pairs.every((p) => p.identical)) {
    failures.push(
      `[失败] 负样本：${pairs.length} 对"两个不同 t"的产物帧全部相同——"重采逐字节一致"退化为` +
        `空转判据（帧流可能根本没画动画：时间轴窗口全 0 / 动画没接进注册表）`,
    );
  }

  // 重采：整段帧流（采样步的每一帧）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-determinism-"));
  const session = await openSession({
    url: withRenderMode(opts.url),
    viewport: opts.viewport ?? stageConfig.dims,
    softwareGL: opts.softwareGL === true,
  });
  try {
    for (const step of picked) {
      const where = `章节 ${step.chapterId} 第 ${step.step} 步（t 逐帧重采）`;
      await jumpToStep(session.page, { chapter: step.chapter, step: step.step });
      await readyWithTimeout(session.page, `确定性终验：${where}`);
      await seekTo(session.page, 0); // 归位（M5 遗留 #2）：canvasAnim 创建即冻结、从未 draw
      const dir = frameDir(step.chapterId, step.step);
      const paths = framePaths(dir, step.frameCount);
      const times = frameTimes(step.frameCount, step.animMs, timeline.fps, step.holdMs);
      let mismatched = 0;
      for (let i = 0; i < paths.length; i++) {
        await seekTo(session.page, times[i]);
        await paintAndSettle(session.page, `${where} 第 ${i + 1} 帧`);
        const shot = path.join(tmpDir, `${step.chapterId}-${step.step}-${i}.png`);
        await session.page.screenshot({ path: shot });
        const product = path.join(opts.outDir, paths[i]);
        const at = `t=${times[i].toFixed(1)}ms`;
        if (!fs.existsSync(product)) {
          failures.push(`[失败] ${where} 第 ${i + 1} 帧（${at}）：产物帧不存在（${paths[i]}）`);
          mismatched += 1;
          continue;
        }
        const want = md5File(product);
        const got = md5File(shot);
        if (want !== got) {
          failures.push(
            `[失败] ${where} 第 ${i + 1} 帧（${at}）：产物 md5 ${want} ≠ 独立会话重采 ${got}` +
              `——同一 t 两趟不一致（双渲对比的最小面，说明这条链不确定）`,
          );
          mismatched += 1;
        }
      }
      if (mismatched === 0) {
        lines.push(`${where}：整段 ${paths.length} 帧重采逐字节相符（独立会话，另一浏览器进程）`);
      }
    }
  } finally {
    await session.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { ok: failures.length === 0, lines, failures };
}

// ── 进度上报（M5b T5：`RenderDeps.onProgress` 的**真实生产者**） ──
//
// 为什么生产者长这样（不是"取最简者"的裁量）：帧流的步级并行在 `captureFrames` **内部**
// （一次调用渲完所有步、按 worker 分片），编排层拿不到逐步回调；它能观测到的"某一步完成了"
// 只有一个**事实**：该步的产物帧在盘上**落齐**（且是**本次**写的）。故进度直接来自产物：
//
//   · `frameStepsDone`：数"本次落齐"的步数；
//   · `watchFrameProgress`：捕捉期间按拍上报增量（每落齐一步报一次）；
//   · 编排在捕捉返回后**补报** `(total, total)`——轮询一拍都可能没赶上（注入式依赖 / 快渲染），
//     "单调递增至 total"这条契约不得依赖轮询是否命中。
//
// 观测面**只读**产物、不出现在任何判据里：它坏了（读不到 / 目录不存在 / 帧数非法）只是少几次
// 中间读数，**不得**因此让一次渲染失败。

/** 帧流进度的轮询间隔（ms）：够密（1080p 一步数十秒量级）又不至于与帧流抢 I/O。 */
export const FRAME_PROGRESS_POLL_MS = 200;

/** 一步在进度面上的最小投影（只要"帧落哪、落几张"）。 */
export interface ProgressStep {
  chapterId: string;
  step: number;
  frameCount: number;
}

/**
 * 已落齐的步数（"本次"判据：末帧 mtime **不早于** `startedAtMs`）。
 *
 * 只 stat **每步的末帧**：`captureFrames` 的帧循环是顺序 await 的（写前清目录 → `0001…` 末帧），
 * 末帧在 = 该步帧流走完（"目录里就这几张"由帧流自己的 `assertFrameCountOnDisk` 保证，这里不必
 * 重复数——只读面越薄越不会被拖慢）。
 *
 * 陈旧帧（上一轮残留，mtime 早于本次起点）/ 还没落盘 / 观测不了，一律按"没落齐"算。
 */
export function frameStepsDone(opts: {
  /** 帧流输出根（= `captureFrames` 的 `outDir`；帧在 `<workDir>/frames/<chapterId>/<step>/`） */
  workDir: string;
  steps: readonly ProgressStep[];
  /** 本次捕捉的起点（ms epoch） */
  startedAtMs: number;
}): number {
  let done = 0;
  for (const step of opts.steps) {
    let last: string;
    try {
      const paths = framePaths(frameDir(step.chapterId, step.step), step.frameCount);
      last = paths[paths.length - 1];
    } catch {
      continue; // 帧数非法（时间轴不会产出这种步）——观测面不为它炸
    }
    try {
      if (fs.statSync(path.join(opts.workDir, last)).mtimeMs >= opts.startedAtMs) done += 1;
    } catch {
      // 还没落盘（正常情况下每一步都在落）/ 观测不了：不算
    }
  }
  return done;
}

/**
 * 捕捉期间按拍上报帧流进度；`stop()` 停下并**等循环退出**（stop 之后落齐的步不再产生读数）。
 *
 * 只在新落齐的步数**涨了**时报（同一读数不重复报——页面的进度条不该被同一个数反复刷新）。
 */
export function watchFrameProgress(opts: {
  workDir: string;
  steps: readonly ProgressStep[];
  startedAtMs: number;
  report(done: number, total: number): void;
  /** 轮询间隔（ms；缺省 `FRAME_PROGRESS_POLL_MS`） */
  pollMs?: number;
}): { stop(): Promise<void> } {
  const pollMs = opts.pollMs ?? FRAME_PROGRESS_POLL_MS;
  const total = opts.steps.length;
  let stopped = false;
  let reported = 0;
  /** 唤醒当前这一拍的等待（stop() 用它提前放行，免得收工还要等满一个间隔） */
  let wake: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const loop = (async () => {
    while (!stopped) {
      await new Promise<void>((resolve) => {
        wake = () => {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          resolve();
        };
        timer = setTimeout(() => {
          timer = null;
          resolve();
        }, pollMs);
      });
      wake = null;
      if (stopped) return;
      const done = frameStepsDone({
        workDir: opts.workDir,
        steps: opts.steps,
        startedAtMs: opts.startedAtMs,
      });
      if (done > reported) {
        reported = done;
        opts.report(done, total);
      }
    }
  })();

  return {
    stop: async () => {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}

// ── 编排 ──

const DEFAULT_IO: RenderIo = { log: console.log, error: console.error };

/**
 * 日志用路径（T7 修复轮 1，Minor 8）：`cwd` 之内给相对路径（短、可点），**之外给绝对路径**——
 * `--out` 指到仓库外时 `../../..` 的装饰串只增加噪音，读者还得自己数层数。
 */
export function displayPath(target: string, cwd = process.cwd()): string {
  const rel = path.relative(cwd, target);
  return rel === "" || rel.startsWith("..") ? target : rel;
}

function narrationOf(chapters: readonly RenderChapter[], step: TimelineStep): string {
  return chapters[step.chapter]?.narrations[step.step] ?? "";
}

/**
 * 全流程（可被测试复用——不含 process.exit）。返回退出码：0 全绿 / 1 自校验或终验未过。
 * 用法错误（退出码 2）在 `renderCli` 的解析层，本函数只看**执行**。
 */
export async function runRender(
  args: RenderArgs,
  deps: RenderDeps = {},
  io: RenderIo = DEFAULT_IO,
): Promise<number> {
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const chapters = await (deps.loadChapters ?? loadChapters)();
  if (chapters.length === 0) {
    throw new Error(
      "render：manifest 里一个章节都没有——空 deck 的出片是 0 帧的空跑（而每一步都会「成功」）；" +
        "宁炸不静默",
    );
  }

  // ── 1) mock 音轨（**必须最早**：durations 是它的产物，时间轴吃 durations） ──
  if (args.mockAudio) {
    const profile = args.realisticAudio ? MOCK_AUDIO_REALISTIC : MOCK_AUDIO_DEFAULT;
    const result = await (deps.synthesizeMockAudio ?? synthesizeMockAudio)({ chapters, repoRoot, profile });
    io.log(
      `[render] mock 音轨：写出 ${result.files.length} 个 mp3 → ${AUDIO_SUBDIR}/` +
        `（时长 ffprobe 实测 → ${result.durationsFile}；形状 ${
          args.realisticAudio ? "拟真档" : "缺省档"
        }：起手静音 ${profile.leadSilenceMs}ms / ${profile.sampleRate}Hz / ${profile.channels}ch）`,
    );
    for (const stale of result.staleFiles) {
      io.error(
        `[render] 目标目录里有本次未写出的 mp3（上次 deck 的残留 / 真 TTS 产物）：${stale}` +
          `——门禁 #13 会拦，本层不静默删用户资产`,
      );
    }
  }

  // ── 2) 时长表 + 对位断言（Ruling R4） ──
  const durations = readAudioDurations(repoRoot);
  if (durations === null) {
    io.log("[render] 未合成音频，按估时出片（无声）");
  } else {
    assertAudioDurationAlignment(chapters, durations);
  }
  const timings = readTimings(chapters, repoRoot);

  // ── 3) 自起 Vite（默认永不复用外部服务——见文件头） ──
  const serve = await (deps.startServe ?? ((o: { repoRoot: string }) => startServe(o)))({ repoRoot });
  try {
    // 显式归一（**不是**靠 openSession 内部补）：日志/进度行里打的就是这个 url，两处必须一致——
    // 只打 `?render=1` 而页面实际吃 `?render=1&headless=1`，排查时会把"带没带 headless"读错。
    // 同一组合在 `scripts/check/headless.ts:593`（无头 pass）也是这么写的；两个函数都幂等。
    // （注：`withHeadless` 的**定义与导出**在 `scripts/shot/session.ts`，headless.ts 只 import 它。）
    const baseUrl = withHeadless(withRenderMode(serve.url));
    // 字幕开关（M5b T3）的归一**只在这一处**：下面三个消费者吃同一个 `url`——帧流捕捉、自校验的
    // 跨会话重采（`recaptureCompare` 用 `opts.url`）、确定性终验（`runDeterminism`）。`withHeadless` /
    // `withRenderMode` / `withNoSubs` 都幂等且保留既有 query，故三段可叠、顺序无关。
    // 漏归一任何一处 = 重采那侧带着字幕层重拍 ⇒ 与"无字幕"的产物帧 md5 不符 ⇒ 对**正确产物**报假红
    //（成片无字幕、重采有字幕）；`--no-subs` 的成片能过自校验，正是这条归一在重采路径上生效的证据。
    const url = args.noSubs ? withNoSubs(baseUrl) : baseUrl;

    // ── 4) 窗口预扫（animMsByStep 的唯一生产者） ──
    const scan = await (deps.scanAnimationWindows ?? scanAnimationWindows)({ url, chapters });
    assertWindowTableShape(scan.animMsByStep, chapters);

    // ── 5) 时间轴表（成片每一段的时长都从它来）+ `--only` 子表 ──
    const timeline = buildTimeline({
      chapters,
      durations,
      timings,
      animMsByStep: scan.animMsByStep,
      profileHoldMs: stageConfig.holdMs,
    });
    const sub = selectTimeline(timeline, args.only);
    for (const step of sub.steps) io.log(stepLine(step, narrationOf(chapters, step)));

    // ── 6) 音轨段（与上面的时间轴同源；两条静默降级在这里 throw） ──
    const audioRoot = path.join(repoRoot, AUDIO_SUBDIR);
    const { segments, silent } = buildAudioSegments({ chapters, timeline: sub, audioRoot });
    if (silent.length > 0) {
      io.log(
        `[render] ${silent.length}/${sub.steps.length} 步有稿未合成（按估时出片，无声）：` +
          `${silent.map((i) => `第 ${sub.steps[i].step} 步`).join("、")}——用 --mock-audio 可占位出片`,
      );
    }

    // ── 7) 帧流（逐 step seek + 静置复用 + 页级并行） ──
    const workDir = path.join(args.outDir, stageConfig.slug);
    const output = path.join(args.outDir, `${stageConfig.slug}.mp4`);
    const specs: FrameSpec[] = sub.steps.map((s) => ({
      chapter: s.chapter,
      step: s.step,
      chapterId: s.chapterId,
    }));
    const viewport: StageDims = stageConfig.dims;
    io.log(
      `[render] 帧流捕捉：${specs.length} 步 · Σ ${sub.steps.reduce((n, s) => n + s.frameCount, 0)} 帧 · ` +
        `并发 ${args.concurrency} · 视口 ${viewport.width}×${viewport.height} · 软件渲染开 · ${url}`,
    );

    // 进度（M5b T5，导出服务的进度条）：total = 本张（子）时间轴的步数；帧流期间由产物落盘
    // 驱动逐步上报（`watchFrameProgress`），捕捉返回后**补报**终值（轮询没命中也要到 total）。
    // `startedAtMs` 必须取在调 captureFrames **之前**：mtime 早于它的帧是上一轮的残留。
    const onProgress = deps.onProgress;
    const progressWatch =
      onProgress === undefined
        ? undefined
        : watchFrameProgress({
            workDir,
            steps: sub.steps.map((s): ProgressStep => ({
              chapterId: s.chapterId,
              step: s.step,
              frameCount: s.frameCount,
            })),
            startedAtMs: Date.now(),
            report: onProgress,
          });
    onProgress?.(0, sub.steps.length);

    /**
     * 降级逃生舱（§8 step 4；M5b T4）：确定性链路失败 → 实时捕获出片。
     *
     * 位置在这里（时间轴/音轨段之后）：降级产物要**同一张子时间轴**（声明时长与录制窗口的出处）
     * 与**同一份确定性音轨**（`encode` 出的 audio.m4a——降级不失声；没走到编码则 null，日志明写）。
     * URL 用 `realtimeUrl(serve.url)` = **裸 `?auto=1`**，不是上面那条 `?render=1&headless=1`：
     * 后者的两条参数都会摘掉页面自驱推进链，录出来是定格画面（实测死因①）。
     * `--no-fallback` 时调用方不进来（严格模式）。
     */
    let encoded: EncodeResult | undefined;
    const degrade = async (reason: string): Promise<number> => {
      io.error(`[render] 确定性链路失败：${reason}`);
      io.log(`[render] 已降级为实时捕获（确定性链路失败：${reason}）`);
      let result: RealtimeResult;
      try {
        result = await (deps.realtimeCapture ?? captureRealtime)({
          // 裸 `?auto=1`（`realtimeUrl` 清掉基址一切 query 后只加 auto）。**`--no-subs` 例外地带进来**
          // （评审 I1）：它既不摘自驱推进链（`App.tsx` 的守卫只认 renderMode / headless），又改**像素**
          // （`Stage` 的框架级字幕闸门）——降级产物是"用户要的那条片子"，请求了无字幕版就得一路带到
          // 底，否则用户拿到的片子与请求不符、且没有任何一行日志说明。`withNoSubs` 幂等、保留既有 query。
          url: args.noSubs ? withNoSubs(realtimeUrl(serve.url)) : realtimeUrl(serve.url),
          outDir: args.outDir,
          slug: stageConfig.slug,
          timeline: sub,
          audioTrack: encoded?.audioPath ?? null,
          viewport,
          // 不做跨机像素稳定：降级产物按定义不可确定复现（§11.2 只对确定性成片负责）
          io,
        });
      } catch (e) {
        // 两侧原因都带上：只报降级的失败会让人以为是"逃生舱坏了"，而真因在确定性链路那侧
        throw new Error(
          `实时捕获降级也失败了——确定性链路：${reason}；降级：${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      io.log(
        `[render] 降级产物：${displayPath(result.file)}（声明 ${(result.declaredMs / 1000).toFixed(3)}s · ` +
          `实测 ${(result.durationMs / 1000).toFixed(3)}s）——实时捕获按墙钟走画面、按时间轴合成音轨，` +
          `A/V 同步是**近似的**且未做自校验（见 KNOWN-ISSUES）`,
      );
      if (encoded !== undefined) {
        // 自校验未过时 `<slug>.mp4` 已经在盘上（编码早于自校验）：它是**未通过自校验**的那一份，
        // 别让下游（导出服务/人）把它当交付物。不替用户删——删除是破坏性动作，只响亮地说清楚。
        io.error(
          `[render] 未通过（或未完成）自校验的成片仍在 ${displayPath(encoded.output)}——**不是**交付物` +
            `（交付物 = 上面的 .realtime.mp4）；本层不替用户删产物`,
        );
      }
      // 出片即成功：逃生舱的意义就是"仍能交给用户一条片子"；降级由产物名（.realtime）+ 上面
      // 两行响亮日志标注，想要严格模式用 --no-fallback
      return 0;
    };

    let captured: CapturedStep[];
    try {
      captured = await (deps.captureFrames ?? captureFrames)(specs, {
        url,
        outDir: workDir,
        timeline: sub,
        concurrency: args.concurrency,
        viewport,
        // 渲染 CLI 专属（§11.2 跨机像素稳定）：storyboard/门禁管线不开这条，它们只在本机消费
        softwareGL: true,
      });
    } catch (e) {
      await progressWatch?.stop(); // M5b T5：降级按墙钟录音、帧流不再落盘——观测先收工
      if (args.noFallback) throw e;
      // 真因逐字来自异常本身（`captureFrames` 的每条 throw 都自带"帧流捕捉：…"定位与步骤信息），
      // 本层**不再加前缀**——否则日志里出现"帧流捕捉失败：帧流捕捉失败：…"的叠字
      return await degrade(e instanceof Error ? e.message : String(e));
    }
    await progressWatch?.stop(); // 收到结果即收工（stop 之后落齐的步不再产生读数）
    onProgress?.(sub.steps.length, sub.steps.length);
    // R7 泄漏告警的出口：纯章节层泄漏动画的步会 windowMs=0（成片冻住）而自校验全绿——
    // 这条 warning 是唯一能看见它的地方，故整串打到 stderr（不截断）。
    for (const step of captured) {
      for (const warning of step.warnings ?? []) io.error(`[render] ${warning}`);
    }

    // ── 8) 编码（视频清单 + 单次 filter_complex 音轨 + mux） ──
    // 两个数组都从子时间轴取（T5 的护栏：两处 stepMs 不一致即在第一条 ffmpeg 命令前 throw）
    // 失败分类（M5b T4）：编码失败**不进**降级——降级自己也要 ffmpeg 与音轨产物，编码坏了
    // 降级同样出不了片（且降级的音轨正是这里产的）。失败照旧抛，由 CLI 报 1。
    encoded = await (deps.encodeVideo ?? encodeVideo)({
      output,
      outDir: workDir,
      captured,
      stepMsByStep: sub.steps.map((s) => s.stepMs),
      segments,
      fps: sub.fps,
    });
    io.log(
      `[render] 编码完成：${displayPath(encoded.output)}` +
        `（清单 ${path.basename(encoded.listPath)}）`,
    );

    // ── 8.5) SRT 副产物（M5b T2：narrations × **同一张子时间轴** 的纯派生；`--no-srt` 关） ──
    // 位置：紧跟编码之后（"渲染后写"）——成片在，字幕才跟着在（编码 throw 时不落孤零零一份 SRT）；
    // 与自校验的成败无关（字幕陈述的是**时间轴**，不是像素与采样）。
    // `--only` 时喂的是 `sub`：子片的 `startMs` 是按被渲的步重算过的，用全表 = 字幕指另一条时间轴。
    if (!args.noSrt) {
      const cues = buildSrtCues(sub, chapters);
      const srtFile = path.join(args.outDir, `${stageConfig.slug}.srt`);
      fs.mkdirSync(args.outDir, { recursive: true }); // 假编码（单测）不建目录；真编码只建 <outDir>/<slug>/
      fs.writeFileSync(srtFile, renderSrt(cues));
      io.log(
        `[render] 字幕副产物：${displayPath(srtFile)}（${cues.length} 条 · 与成片同一张时间轴）`,
      );
    } else {
      io.log("[render] 未写字幕（--no-srt）");
    }

    // ── 9) 产物自校验（总量层 + 帧目录 + 两类边界 + 跨会话同刻重采） ──
    let report: RenderVerifyReport;
    try {
      report = await (deps.verifyRender ?? verifyRender)({
        output,
        outDir: workDir,
        timeline: sub,
        url,
        segments,
        viewport,
        softwareGL: true,
      });
    } catch (e) {
      // 自校验自己抛错（跨会话重采的 seek 断言是典型）：与"判据报红"同属确定性链路失败
      if (args.noFallback) throw e;
      return await degrade(`自校验抛错：${e instanceof Error ? e.message : String(e)}`);
    }
    for (const line of report.lines) io.log(`[verify] ${line}`);
    for (const failure of report.failures) io.error(`[render] ${failure}`);
    // ── 9.5) 失败路径接线（M5b T4）：自校验未过 → 降级逃生舱（`--no-fallback` 时照旧报红退出） ──
    if (!report.ok && !args.noFallback) {
      return await degrade(
        `自校验未通过（${report.failures.length} 条失败：${report.failures[0] ?? "见上"}）`,
      );
    }
    let ok = report.ok;

    // ── 10) 确定性终验（可选：双渲对比 + 负样本） ──
    if (args.verifyDeterminism) {
      const determinism = await (deps.runDeterminism ?? runDeterminism)({
        url,
        outDir: workDir,
        timeline: sub,
        viewport,
        softwareGL: true,
      });
      for (const line of determinism.lines) io.log(`[determinism] ${line}`);
      for (const failure of determinism.failures) io.error(`[render] ${failure}`);
      ok = ok && determinism.ok;
    }

    io.log(
      ok
        ? `[render] OK：${displayPath(output)}（${(sub.totalMs / 1000).toFixed(3)}s）`
        : "[render] 未通过：见上（退出码 1）",
    );
    return ok ? 0 : 1;
  } finally {
    await serve.stop();
  }
}

// ── CLI 入口（退出码与 check/storyboard 同款：0 过 / 1 执行失败 / 2 用法错误） ──

export async function renderCli(
  argv: readonly string[],
  io: RenderIo = DEFAULT_IO,
  deps: RenderDeps = {},
): Promise<number> {
  let args: RenderArgs;
  try {
    args = parseArgs(argv, process.cwd());
  } catch (e) {
    if (e instanceof RenderUsageError) {
      io.error(`${e.message}\n${RENDER_USAGE}`);
      return 2;
    }
    throw e;
  }
  if (args.help) {
    io.log(RENDER_USAGE);
    return 0;
  }
  try {
    return await runRender(args, deps, io);
  } catch (e) {
    io.error(`[render] 执行失败：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

/** CLI 入口判断（import.meta.url vs process.argv[1]，realpath 对齐防 /private 与符号链接）。 */
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
  void renderCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
