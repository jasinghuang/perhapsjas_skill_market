// M5a Task 5 编码：**音画同步的构造保证在这里兑现或破产**（设计 §8 / §8.1）。
//
// 入参是 T4 的帧流（`CapturedStep[]`，帧目录已落盘）+ T1 的时间轴表（每步 stepMs）；出参是
// 一个 mp4。两轨都出自**同一张时间轴表**——视频每步的时长由清单里的 duration 声明，音轨每段
// 由 `atrim` 切到同一个 stepMs，故"总时长 = Σ步长"是构造出来的，不是对齐出来的。
//
// ## 视频轨：concat 清单的形状是**实测**定的（R2 矩阵，真 deck 形状 91/1/1；读数见 task-5-report.md）
//
// concat 子 demuxer（image2）默认 25fps ⇒ 时间基 1/25 ⇒ 每个包的位置被量化到 **0.04s 网格**。
// 逐条实测结论（不是从计划抄的）：
//
// 1. `duration` 给的是**它前面那条 `file`**（concatdec 的 `file->user_duration`）——写反了整条
//    时间线就错；
// 2. 每个包的**位置**= 前面所有声明时长之和（µs 精度累加），只在呈现时被舍到网格 ⇒ 误差是
//    **每次独立舍入**（±半格），**不累积**；实测步起点 0 / 3.400 / 5.760（理想 0/3.400/5.750）；
// 3. **清单末条 `file` 的 duration 会被丢弃**——没有任何后续条目来消费它。最小复现：
//    单图 + `duration 5` 出片 0.033333s（1 帧）；末尾再补一条同样的 `file` → 5.033333s。
//    真 deck 里这一步是 step2 的 1.9s 静置：丢了它，成片比音轨短 1.55s，mux 的 `-shortest`
//    会把**音轨尾部截掉**（实测：无末尾重复行 → 成片 6.100000，期望 7.650000）。
//    故清单**必须**以一条无 duration 的重复行收尾（代价：尾部多出 1/framerate，见下）；
// 4. **重复行只能落在清单最后一行**：中段重复行自己没有 duration ⇒ 后续条目的起点算出
//    `AV_NOPTS_VALUE`（实测步 1 的包 pts = −9.2e12），步 2 起点漂到 5.68，出片 9.133333
//    （计划的"每步一条重复行"就是这么崩的）。所以"每步重复末行"被本实现排除，测试钉死；
// 5. **末帧时长用 R3 的统一式** `max(0, stepMs/1000 − (frameCount−1)/fps)`——不是计划式的
//    `holdMs/1000 − 1/fps`。原因：计划式假设每步末尾都有一条重复行来补那 1/fps，而结论 4 说
//    那条路走不通；R3 式让**每步声明的总时长逐字等于 stepMs**，于是 step 起点累加恰好是 Σ stepMs
//    （实测 3.400/5.750 命中网格）。计划式在单条收尾重复行的构造下每步少 1/fps（实测步 0 =
//    3.3667 而非 3.4），30 步累计 ~1s。
//    ⚠️ 式里的 `stepMs` **必须是真的 stepMs**（调用方逐字传入，见 `buildVideoConcatList` 的
//    `stepMsByStep`）。从 `CapturedStep` 反推只能拿 `frameCount/fps`（窗口帧数向上取整的时长）
//    顶替——`stepMs < 窗口帧时长`（`dwell ≤ slack`）时每步多 slack、**逐步累加**（修复轮 1 的 F1：
//    `dwell:0` 三步声明 6600ms vs 时间轴 6540ms）。
// 6. 尾部那条重复行的**超额超发**（实测成片尾部 9.500000 vs 理想 7.650000，+1.85s；不是
//    1/framerate 的量级）。它是**安全方向**：`-shortest` 把成片切到音轨的末端（= Σ stepMs，
//    实测 7.650000 逐字命中），超发部分被丢掉；反向（欠发）才会截掉音轨尾部，那才是要防的。
//
// **不用 `option framerate N` 改子 demuxer 时间基**（brief 要求试）：实测能改网格（1/30、1/1000
// 都生效）。**一致加在每一行**（含收尾重复行）可用且不坏——包层 0/3.400/5.733/7.633，成片与
// 默认网格**同长**（dur=9.500000 / nb=285），内容边界也基本不变（0/3367/5700 vs 0/3367/5733）。
// 塌陷（6.367 的尾重复起点、6.966667 的成片）只出现在**混用时间基**时——option 漏在收尾重复行上，
// 那一条的时间基与其余条目不同。结论：一致性可保但**收益为零**（边界不改善），不引入这个额外
// 约束；保留默认 25fps 网格 + §六 的容差口径。
//
// ## 音轨：单次 `filter_complex`（**不**分段编码后 concat）
//
// 分段 `-c copy` concat 每步漂 ~7ms、30 步累计 ~210ms（T1 评审实测）；单次图里
// `[i:a]…,apad,atrim=0:<stepMs/1000>` 逐段切到**时间轴的 stepMs**，一次 `concat` 收口后只编一遍
// AAC。段长**不吸附到帧网格**：音轨是时间的基准，吸到 1/30 网格反而让每步与时间轴错位且累积。
//
// ## mux：`-c copy -shortest`
//
// 视频轨尾部超发（结论 6）、音轨尾部有 AAC 帧对齐的零头 ⇒ 用 `-shortest` 收到较短的一侧。
// 实测：`-c copy -t` 夹不住（会溢出），`-shortest` 把成片收在 Σ stepMs 上。
//
// ## 依赖方向
//
// scripts/render → scripts/render（同树）+ node 内置。ffmpeg/ffprobe 命令面也在这里
// （`runFfmpeg` / `probeDurationMs` 供 audio.ts 复用——"找不到二进制要给 brew 指引"只此一份）。

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CapturedStep } from "./frames";

// ── 接口（计划接口约定 5：跨任务冻结面） ──

/** 一步的音轨段：`mp3 = null` = 无声步（空 narration，用 lavfi 静音源）。 */
export interface AudioSegment {
  mp3: string | null;
  /** 该步时长（ms）——**必须**是时间轴表里的 stepMs（音画同源的唯一接口） */
  stepMs: number;
}

export interface EncodeOptions {
  /** 产物 mp4 路径 */
  output: string;
  /** 中间产物目录：concat 清单落在它的**根**（清单里的相对路径按清单文件所在目录解析） */
  outDir: string;
  captured: readonly CapturedStep[];
  /**
   * 与 `captured` **同序同长**的**真 stepMs**（ms）：视频轨每步的时长声明就取自它。
   * T7 手里就是 `timeline.steps.map(s => s.stepMs)`——别用 `captured` 反推（见文件头结论 5）。
   */
  stepMsByStep: readonly number[];
  /** 与 `captured` **同序同长**（帧流第 k 步 ↔ 音轨第 k 段） */
  segments: readonly AudioSegment[];
  fps: number;
  /** 覆盖 ffmpeg 可执行（测试用；默认 PATH 上的 ffmpeg） */
  ffmpegPath?: string;
}

export interface EncodeResult {
  output: string;
  /** concat 清单（调试/审计：它是视频轨时长的唯一声明处） */
  listPath: string;
  videoPath: string;
  audioPath: string;
}

/** 音频规格常量（音轨图与输出参数共用的单一源，不写字面量两遍）。 */
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
/** 归一化滤镜：跨机 TTS mp3 可能是 44.1k / 单声道，concat 要求各段同规格 ⇒ 逐段先归一。 */
const AUDIO_NORMALIZE = `aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo`;
/** 静音源（无声步的输入；`anullsrc` 是无限长，靠图里的 atrim 收口）。 */
const NULL_SOURCE = `anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=stereo`;

/** 失败时带上 ffmpeg"最后几行 stderr"（几百行 filter 日志里跟错了最费时间）。 */
const STDERR_TAIL = 12;

export function ffmpegMissingMessage(bin: string): string {
  return (
    `找不到 ${bin}——渲染管线（合成音轨 / 编码 mp4）依赖 ffmpeg 与 ffprobe。\n` +
    `  macOS：brew install ffmpeg（装完确认 /opt/homebrew/bin 在 PATH 上）\n` +
    `  Linux：apt install ffmpeg（或系统包管理器）\n` +
    `当前可执行：${bin}`
  );
}

function stderrTail(stderr: string): string {
  const lines = stderr.trimEnd().split("\n");
  return lines.slice(-STDERR_TAIL).join("\n");
}

/**
 * 跑一次 ffmpeg（同步）：非零退出即 throw（带 stderr 尾部），二进制缺失给 brew 指引。
 * 同步而非异步：三条命令串行、每条都是几秒量级，且**失败即整轮失败**（不给"半份产物"留活口）。
 */
export function runFfmpeg(args: readonly string[], ffmpegPath = "ffmpeg"): void {
  const r = spawnSync(ffmpegPath, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error !== undefined) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(ffmpegMissingMessage(ffmpegPath));
    throw new Error(`ffmpeg 启动失败（${ffmpegPath}）：${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `ffmpeg 退出码 ${r.status}：${ffmpegPath} ${args.join(" ")}\n${stderrTail(r.stderr ?? "")}`,
    );
  }
}

/**
 * ffprobe 实测时长（ms）。**不猜、不算**：durations.json 里写的是这个读数
 * （T1 的时间轴表只吃实测值；估时公式是"未合成"那条兜底路，不冒充实测）。
 */
export function probeDurationMs(file: string, ffprobePath = "ffprobe"): number {
  const r = spawnSync(
    ffprobePath,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  if (r.error !== undefined) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(ffmpegMissingMessage(ffprobePath));
    throw new Error(`ffprobe 启动失败（${ffprobePath}）：${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`ffprobe 退出码 ${r.status}：${file}\n${stderrTail(r.stderr ?? "")}`);
  }
  const sec = Number.parseFloat(r.stdout.trim());
  if (!Number.isFinite(sec) || sec < 0) {
    throw new Error(`ffprobe 读数非法：${JSON.stringify(r.stdout)}（${file}）——宁炸不猜`);
  }
  return Math.round(sec * 1000);
}

// ── 视频清单（纯函数） ──

/** 一步的末帧时长（秒）——R3 的原式：`max(0, stepMs/1000 − (frameCount−1)/fps)`。
 *
 *  `stepMs` 是**调用方逐字传入的真值**（`stepMsByStep`），不是从 `CapturedStep` 反推的：
 *  T4 的接口没有 `stepMs`，反推只能拿 `frameCount/fps`（窗口帧数向上取整的时长）顶替——
 *  `stepMs < 窗口帧时长`（`dwell ≤ slack`，`slack ∈ [0, 1/fps)`）时每步多出 slack 并**逐步累加**
 *  （修复轮 1 的 F1：`dwell:0` 三步声明 6600ms vs 时间轴 6540ms）。修法就是把它变成必传参数，
 *  让"真 stepMs 从哪来"在签名上无法回避。
 */
function lastFrameDurationSec(step: CapturedStep, stepMs: number, fps: number): number {
  return Math.max(0, stepMs / 1000 - (step.frameCount - 1) / fps);
}

/** concat 清单里的一条路径：单引号包裹（ffmpeg 的 concat 语法）。 */
function concatFileLine(relPath: string): string {
  if (relPath.includes("'")) {
    throw new Error(
      `concat 清单路径含单引号：${relPath}——清单用 '路径' 包裹，含引号的路径会把清单解析成别的` +
        `文件（帧目录名由 T4 的 chapterId 白名单约束，正常到不了这里）；宁炸不静默`,
    );
  }
  return `file '${relPath}'`;
}

/**
 * 帧清单（相对 `<outDir>` 根；T4 的 `CapturedStep.dir` 就是相对形）。
 *
 * 每步：`frameCount` 条 `file`，前 `frameCount−1` 条 `duration 1/fps`，末条用 R3 的统一式
 * （`stepMs` 取 `stepMsByStep` 的第 index 个——**真 stepMs，不许反推**，见结论 5）；
 * **整份清单的最后一行**是无 duration 的末帧重复（结论 3：末条 `file` 的 duration 会被丢弃）。
 * 中段不放重复行（结论 4：会产出 NOPTS 包），`encode.test.ts` 各用例把这几条钉死。
 */
export function buildVideoConcatList(
  captured: readonly CapturedStep[],
  fps: number,
  stepMsByStep: readonly number[],
): string {
  if (captured.length === 0) {
    throw new Error(
      "buildVideoConcatList：captured 为空——空清单 = 成片没有一段来自本 deck（而 ffmpeg 会`成功`" +
        "产出一个 0 帧的 mp4），宁炸不静默",
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`buildVideoConcatList：fps ${fps} 非法（须为有限正数）——它决定每帧的 duration`);
  }
  if (stepMsByStep.length !== captured.length) {
    throw new Error(
      `buildVideoConcatList：stepMsByStep 长度 ${stepMsByStep.length} ≠ captured ${captured.length}` +
        `——两者**同序同长**（第 k 个时长就是第 k 步的）：长度不符时后半程每步都拿的是别的步的` +
        `时长，而总时长、帧数、帧率三条自校验还都能对上`,
    );
  }
  const frameSec = 1 / fps;
  const lines: string[] = [];
  let lastPath = "";
  captured.forEach((s, index) => {
    const stepMs = stepMsByStep[index];
    if (!Number.isFinite(stepMs) || stepMs <= 0) {
      throw new Error(
        `buildVideoConcatList：第 ${index} 步（${s.dir}）的 stepMs ${stepMs} 非法（须为有限正数，ms）` +
          `——它决定这一步在成片里的长度（时间轴表的读数，一帧都排不下：${1000 / fps}ms）`,
      );
    }
    if (!Number.isInteger(s.frameCount) || s.frameCount <= 0) {
      throw new Error(
        `buildVideoConcatList：${s.dir} 的 frameCount ${s.frameCount} 非法（须为正整数）` +
          `——空步在成片里凭空消失（T4 的 framePaths 同款护栏，这里再挡一次）`,
      );
    }
    if (!Number.isFinite(s.holdMs) || s.holdMs < 0) {
      throw new Error(
        `buildVideoConcatList：${s.dir} 的 holdMs ${s.holdMs} 非法（须为有限非负数，ms）`,
      );
    }
    for (let i = 1; i <= s.frameCount; i++) {
      const p = `${s.dir.replace(/[/\\]+$/, "")}/${String(i).padStart(4, "0")}.png`;
      const isLast = i === s.frameCount;
      lines.push(concatFileLine(p));
      lines.push(`duration ${(isLast ? lastFrameDurationSec(s, stepMs, fps) : frameSec).toFixed(6)}`);
      lastPath = p;
    }
  });
  // 收尾重复行（无 duration）：让最后一条真实条目的 duration 生效（结论 3）。
  lines.push(concatFileLine(lastPath));
  return lines.join("\n") + "\n";
}

// ── 音轨图（纯函数） ──

/**
 * 把 `buildAudioFilterComplex` 的输入声明切成 argv。
 *
 * 为什么不是简单 `split(" ")`：mp3 路径由调用方给（T7 拼 `<repoRoot>/public/audio/…`），
 * 项目目录带空格（`…/My Deck/…`）并不罕见——朴素切分会把一条路径劈成两个参数，而 ffmpeg 的
 * 报错是一句难懂的 "No such file"。故声明里的单引号**参与切分**：引号内的空格不切。
 */
export function splitInputSpecs(specs: readonly string[]): string[] {
  const out: string[] = [];
  for (const spec of specs) {
    let cur = "";
    let quoted = false;
    let started = false;
    for (const ch of spec) {
      if (ch === "'") {
        quoted = !quoted;
        started = true;
        continue;
      }
      if (!quoted && /\s/.test(ch)) {
        if (started || cur !== "") {
          out.push(cur);
          cur = "";
          started = false;
        }
        continue;
      }
      cur += ch;
      started = true;
    }
    if (started || cur !== "") out.push(cur);
  }
  return out;
}

/**
 * 音轨 filter_complex：各段 `[i:a]归一,apad,atrim=0:<stepMs/1000>` → `concat=n=N:v=0:a=1[out]`。
 *
 * - `inputs`：**每段一条输入声明**（`inputs.length === segments.length`）——有声段 `-i '<mp3>'`，
 *   无声段 `-f lavfi -i anullsrc=r=48000:cl=stereo`。⚠️ brief Step 1 的示例断言把 `anullsrc`
 *   写在 `filter` 上，与同段 `inputs.length === 2` 不能同时成立（静音要么作输入、要么作图内源）；
 *   按 brief 散文"无声步用 anullsrc=r=48000:cl=stereo **输入**"取前者，断言落在 `inputs` 上。
 * - `apad` 只为有声段准备：TTS/mock mp3 短于步长是常态（静置垫、空窗），pad 到足再用 atrim 切齐；
 *   静音源本身无限长，不需要 pad。
 * - `atrim` 的秒用 `toFixed(6)`（µs 精度）逐字写 stepMs —— **不吸附帧网格**（音轨是时间基准）。
 * - `fps` 只做入参护栏（正有限）与错误文案的定位；它**不参与**段长计算，见上一条。
 */
export function buildAudioFilterComplex(
  segments: readonly AudioSegment[],
  fps: number,
): { inputs: string[]; filter: string } {
  if (segments.length === 0) {
    throw new Error(
      "buildAudioFilterComplex：段列表为空——音轨会是一段 0 长的空流（concat 少一路输入、mux 之后" +
        "成片没有音轨），而每一步都`成功`；宁炸不静默",
    );
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`buildAudioFilterComplex：fps ${fps} 非法（须为有限正数）`);
  }
  const inputs: string[] = [];
  const chains: string[] = [];
  segments.forEach((seg, i) => {
    if (!Number.isFinite(seg.stepMs) || seg.stepMs <= 0) {
      throw new Error(
        `buildAudioFilterComplex：第 ${i} 段的 stepMs ${seg.stepMs} 非法（须为有限正数，ms）` +
          `——零长段在 concat 里等于一个洞，而成片时长会少这一段（一帧都排不下：${1000 / fps}ms）`,
      );
    }
    if (seg.mp3 === null) {
      inputs.push(`-f lavfi -i ${NULL_SOURCE}`);
      chains.push(`[${i}:a]${AUDIO_NORMALIZE},atrim=0:${(seg.stepMs / 1000).toFixed(6)}[a${i}]`);
    } else {
      if (seg.mp3.trim() === "") {
        throw new Error(`buildAudioFilterComplex：第 ${i} 段的 mp3 是空串——要么给路径，要么给 null`);
      }
      if (seg.mp3.includes("'")) {
        // 与 concatFileLine 的单引号守卫对称：`-i '路径'` 里的撇号会把这条声明切裂，
        // 而 ffmpeg 报出来的是难归因的 "No such file"（项目目录叫 `John's Deck` 是很正常的事）
        throw new Error(
          `buildAudioFilterComplex：第 ${i} 段的 mp3 路径含单引号：${seg.mp3}——输入声明用 '路径' ` +
            `包裹，含引号的路径会被切成两个参数（ffmpeg 只报 "No such file"）；宁炸不静默`,
        );
      }
      inputs.push(`-i '${seg.mp3}'`);
      chains.push(
        `[${i}:a]${AUDIO_NORMALIZE},apad,atrim=0:${(seg.stepMs / 1000).toFixed(6)}[a${i}]`,
      );
    }
  });
  const labels = segments.map((_, i) => `[a${i}]`).join("");
  const filter = `${chains.join(";")};${labels}concat=n=${segments.length}:v=0:a=1[out]`;
  return { inputs, filter };
}

// ── 编排 ──

/** 清单文件名（落在 `<outDir>/` 根——相对路径按清单文件所在目录解析）。 */
export const CONCAT_LIST_NAME = "concat.txt";
export const VIDEO_TRACK_NAME = "video.mp4";
export const AUDIO_TRACK_NAME = "audio.m4a";

/**
 * 出片：清单 → 视频轨（concat + cfr 30）→ 音轨（单次 filter_complex + AAC）→ mux（`-shortest`）。
 *
 * 全部入参护栏都在**落盘之前**（fail fast：参数错不该先写半个目录）。三条命令串行、失败即抛，
 * 不留半份产物（T4 的"worker 失败即整轮失败"同款取舍）。
 */
export async function encodeVideo(opts: EncodeOptions): Promise<EncodeResult> {
  if (opts.captured.length === 0) {
    throw new Error(
      "encodeVideo：captured 为空——没有帧可编码（成片只剩音轨），宁炸不静默",
    );
  }
  if (opts.captured.length !== opts.segments.length) {
    throw new Error(
      `encodeVideo：帧流 ${opts.captured.length} 步 vs 音轨 ${opts.segments.length} 段——段数不符` +
        `（每步一段、同序：第 k 段切给第 k 步），否则音画的步边界从某一步起整体错位，而两轨各自` +
        `的时长还能对得上`,
    );
  }
  if (opts.stepMsByStep.length !== opts.captured.length) {
    throw new Error(
      `encodeVideo：stepMsByStep ${opts.stepMsByStep.length} 个 ≠ 帧流 ${opts.captured.length} 步` +
        `——每步的时长声明必须来自时间轴表（同序同长），反推 ` +
        `frameCount/fps 会在 dwell≤slack 的步上逐步累加`,
    );
  }
  // 清单与音轨图先构造（纯函数）：坏数据在这里就炸，不落到磁盘上
  const list = buildVideoConcatList(opts.captured, opts.fps, opts.stepMsByStep);
  const { inputs, filter } = buildAudioFilterComplex(opts.segments, opts.fps);

  fs.mkdirSync(opts.outDir, { recursive: true });
  // 产物目录：T7 传 `<模板根>/render/<slug>.mp4`，目录通常已存在；不存在时给 ffmpeg 一句
  // "No such file or directory" 太难归因（它是第三条命令才炸），这里先建好。
  fs.mkdirSync(path.dirname(opts.output), { recursive: true });
  const listPath = path.join(opts.outDir, CONCAT_LIST_NAME);
  const videoPath = path.join(opts.outDir, VIDEO_TRACK_NAME);
  const audioPath = path.join(opts.outDir, AUDIO_TRACK_NAME);
  fs.writeFileSync(listPath, list);

  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  runFfmpeg(
    [
      "-v", "error",
      "-f", "concat",
      "-safe", "0",
      "-i", listPath,
      // cfr：把"位置精确、间隔不匀"的 concat 包重采样成 30fps 定帧率流（缺它输出是 VFR，
      // 帧数/时长都不可复现）
      "-fps_mode", "cfr",
      "-r", String(opts.fps),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      videoPath,
      "-y",
    ],
    ffmpegPath,
  );

  runFfmpeg(
    [
      "-v", "error",
      ...splitInputSpecs(inputs),
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:a", "aac",
      "-ar", String(AUDIO_SAMPLE_RATE),
      "-ac", String(AUDIO_CHANNELS),
      audioPath,
      "-y",
    ],
    ffmpegPath,
  );

  // mux：两轨都已编码，`-c copy` 只搬运；`-shortest` 收在较短的一侧（视频尾部的超发在这里被丢掉）
  runFfmpeg(
    [
      "-v", "error",
      "-i", videoPath,
      "-i", audioPath,
      "-c", "copy",
      "-shortest",
      opts.output,
      "-y",
    ],
    ffmpegPath,
  );

  return { output: opts.output, listPath, videoPath, audioPath };
}
