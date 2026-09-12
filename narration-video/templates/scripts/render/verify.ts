// M5a Task 6 渲染产物自校验：设计 §8.1 的"渲染正确是**验证出来的**，不是相信跑完了"。
//
// 输入是一个 mp4 + 帧目录 + 时间轴表；输出是**逐条读数 + 失败项**（RenderVerifyReport）。
// 本模块只读、不改产物、不修数据——发现不一致就报红，不猜、不兜。
//
// ## 为什么必须有（前五条链路各自都能"成功"）
//
// T1~T5 每一步都能自洽地跑完并产出"看起来对"的东西：**总时长对而音画错位**（某一轨整体平移）、
// **帧数对而内容错**（渲的是别的 t / 别的步）、音轨被 `-shortest` 截掉尾部……这些故障都不让
// 任何一步报错。而**恒定 A/V 偏移在总时长 / 帧数 / 帧率三项上完全不可见**（三者都只对"总量"
// 敏感）：偏移 100ms 时三条照样全绿。故本模块的判据分两层——
//   · 总量层：时长 / 帧数 / 帧率 / 音轨总长 / PNG 总数（便宜，抓粗错）
//   · **边界层**：视频内容边界（步起点）与音轨边界（步起点）——抓"总量对而错位"这一类，
//     它是这类故障**唯一**的护栏（离线可判、不依赖人耳人眼）
//   · 内容层：跨会话同刻重采 → 与产物帧目录**同帧 md5 逐字节**比对（抓"帧数对而内容错"）
//
// ## 容差口径（全部来自 T5 三轮实测，逐条见 task-5-report.md §六；**不要自己发明**）
//
// | 判据 | 口径 | 依据 |
// |---|---|---|
// | 成片总时长 | `max(1/fps, 21.3ms)`（= 33.3ms @30fps） | 真 deck 逐字命中 7.650000；AAC 帧对齐 1024/48000 |
// | 视频 `nb_frames` | **±3 帧** | T5 实测 −2.1 帧：mux 的 `-shortest` 在音轨末端丢 1~2 个视频包（±1 会红） |
// | `r_frame_rate` | **严格 `30/1`** | 缺 `-fps_mode cfr` 时输出 VFR |
// | 音轨总长 | **±2 个 AAC 帧（42.7ms）** | 真 deck +8.67ms；30 步向量 −35ms（整帧对齐的零头） |
// | **视频内容边界** | **±4 帧（133ms）** | G1 实测上界 89.3ms（≡2.7 帧）：25fps 包层网格 ±18ms **有界** + cfr 重采样加 1.5~2.7 帧，**已证非线性累积**（N=30 斜率≈0） |
// | **音轨边界** | **±10ms（紧口径）** | 音轨不吸附帧网格：实测样本级对齐 0~3ms；沿用 4 帧会**真过松** |
//
// ⚠️ 视频边界的 ±4 帧**不是**可以省的一条：它是"恒定 A/V 偏移"唯一的探测器（见上）。
//
// ## 判据怎么测出来的（不用"期望值当答案"）
//
// · **视频**：把成片解成 96×54 灰度签名序列 → 相邻帧平均绝对差信号 → 在期望步起点 ±15 帧内取
//   argmax（内容跳变点）。判据是"**跳变点出现在哪一帧**"，不是"我看了一眼觉得对"。
//   显著性（峰值/中位比）不足时**跳过该边界**（相邻两步画面可能本就相同）并记一行——
//   一条都测不到才报红。
// · **音轨**：把产品音轨解成 PCM，与**独立构造**的理想波形（逐段 decode mp3 → 按 stepMs 截/补 →
//   顺序拼接，Node 侧自己算，不复用 ffmpeg 滤镜图）在**每个步起点**做窗口对齐：
//   窗口**跨过边界**（±50ms）⇒ 边界两侧内容一般不同 ⇒ 偏移可判（纯稳态单频会有等价偏移族，
//   此时报出的是下界）。判据两条：**零偏移的代价值不值得信**（对齐判据）+ 该处的相关性
//   （内容判据：段挂错/丢失）。
// · **跨会话同刻重采**：`min(3, 步数)` 个步（**必含首末步**），每步首帧 + 末帧（静置帧落在
//   animMs）→ **独立** `openSession`（另一个浏览器进程）→ `jumpTo` → `seek(t)` → 截帧 →
//   与产物帧目录**同帧 md5 逐字节**比对。T4 已实测"独立会话同一 t 逐字节一致"（frames.browser
//   test 的确定性臂），故不一致只可能来自产物侧（帧被换/被改/是别的 t）。
//
// ## 依赖方向
//
// scripts/render → scripts/render（frames/encode/timeline 的既有面，复用而不重抄：帧目录名走
// `frameDir`/`framePaths`、第 j 帧的时刻走 `frameTimes`、音轨规格常量走 encode）+ scripts/shot
// （会话面）+ src/engine（stageConfig）。src/ 不反向 import scripts/。
//
// ## T7 消费面（brief 之外补的两点，写在明处）
//
// 1. `segments` **必传**（与 encode 同源同序）：音轨边界/内容判据靠它构造理想波形；不给就只剩
//    ffprobe 那两条总量判据——而总量判据对偏移不可见。缺它 → throw（不让"少一半验证"静默发生）。
// 2. `--only` 场景：本模块只认传进来的 `timeline`/`segments`，**不做子表裁剪**——T7 用被渲的
//    步构造子表（steps + totalMs 都是子表的）再传进来，两条口径才同源。

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { stageConfig } from "../../src/engine/runtime-config";
import { withRenderMode } from "../check/headless";
import { jumpToStep, openSession, readyWithTimeout, seekTo } from "../shot/session";
import { AUDIO_SAMPLE_RATE, ffmpegMissingMessage, type AudioSegment } from "./encode";
import { assertFrameCountOnDisk, frameDir, framePaths, frameTimes } from "./frames";
import type { Timeline } from "./timeline";

// ── 接口（计划接口约定 6：跨任务冻结面） ──

/** 产物自校验报告。`lines` 是**全部**读数与失败项（人类可读、按检查序）；`failures` 是其子集。 */
export interface RenderVerifyReport {
  ok: boolean;
  lines: string[];
  failures: string[];
}

/** ffprobe 摘要（`-show_entries format=duration:stream=… -of json` 的解析结果）。 */
export interface FfprobeSummary {
  durationSec: number;
  /** 视频流；null = 成片没有视频流（parseProbeJson 会 throw，此字段恒非空——留给"将来放开"的口） */
  video: { codec: string; nbFrames: number; rFrameRate: string } | null;
  /** 音轨流；null = 成片没有音轨（**要报红的一条**，不是解析失败） */
  audio: {
    codec: string;
    durationSec: number;
    sampleRate: number;
    channels: number;
  } | null;
}

export interface VerifyOptions {
  /** 产物 mp4 路径 */
  output: string;
  /** 中间产物目录（帧目录 = `<outDir>/frames/…`，与 captureFrames/encodeVideo 同一个） */
  outDir: string;
  timeline: Timeline;
  /** 页面基址；**必须已带 render 参数**（同 captureFrames；本模块用 withRenderMode 归一） */
  url: string;
  /**
   * 与 captured **同序同长**的音轨段（T5 `encodeVideo` 的同一个数组）——音轨边界/内容判据
   * 用它构造理想波形。**必传**（见文件头"T7 消费面"）：缺了只剩总量判据，而总量判据对
   * "总时长对而音画错位"完全不可见。
   */
  segments: readonly AudioSegment[];
  /** 视口；**必须与 captureFrames 的相同**（默认 `stageConfig.dims`），否则重采的像素不可比 */
  viewport?: { width: number; height: number };
  /** 软件渲染开关；**必须与 captureFrames 的相同**（默认 false = 既有管线的启动参数） */
  softwareGL?: boolean;
  /** 覆盖 ffmpeg / ffprobe 可执行（测试用；默认 PATH 上的同名命令） */
  ffmpegPath?: string;
  ffprobePath?: string;
}

/** 帧数/PNG 数口径：Σ `frameCount`（**≠** mp4 帧数——CFR 把静置帧复制成多帧）。空表 → throw。 */
export function expectedPngTotal(timeline: Timeline): number {
  if (timeline.steps.length === 0) {
    throw new Error(
      "expectedPngTotal：时间轴表为空——0 张 PNG 是坏数据不是缺省态（NaN 式的「对上了」会把「一步都没渲」放过去）；宁炸不静默",
    );
  }
  return timeline.steps.reduce((n, s) => n + s.frameCount, 0);
}

/** mp4 帧数口径：`round(totalMs×fps/1000)`（与 PNG 口径**分开**，两条从来不相等）。空表 → throw。 */
export function expectedMp4Frames(timeline: Timeline, fps: number): number {
  if (timeline.steps.length === 0) {
    throw new Error("expectedMp4Frames：时间轴表为空——空表的「期望帧数」没有定义；宁炸不静默");
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`expectedMp4Frames：fps ${fps} 非法（须为有限正数）`);
  }
  return Math.round((timeline.totalMs * fps) / 1000);
}

/**
 * 总量层判据：时长 / 帧数 / 帧率 / 音轨总长（+ 成片规格两条）。返回**失败项**（空数组 = 全绿）。
 *
 * 全部按"期望值 − 实测值"换算成失败项文本，逐条带容差与偏差量（报告要能一眼看出差多少）。
 */
export function checkProbe(probe: FfprobeSummary, timeline: Timeline, fps: number): string[] {
  const failures: string[] = [];
  const expectedMs = timeline.totalMs;
  const expectedFrames = expectedMp4Frames(timeline, fps);

  const durationMs = probe.durationSec * 1000;
  const durationTolMs = durationToleranceMs(fps);
  if (Math.abs(durationMs - expectedMs) > durationTolMs) {
    failures.push(
      `成片时长 ${probe.durationSec.toFixed(6)}s（${durationMs.toFixed(1)}ms）与时间轴 Σ步长 ` +
        `${(expectedMs / 1000).toFixed(6)}s（${expectedMs.toFixed(1)}ms）不符：差 ` +
        `${(durationMs - expectedMs).toFixed(1)}ms，容差 ±${durationTolMs.toFixed(1)}ms` +
        `（= max(1 帧 ${(1000 / fps).toFixed(1)}ms, AAC 帧对齐 21.3ms)）`,
    );
  }

  if (probe.video === null) {
    failures.push("成片没有视频流——ffprobe 只读到音轨（编码/ mux 少映射了一路？）");
  } else {
    const frames = probe.video.nbFrames;
    if (Math.abs(frames - expectedFrames) > MP4_FRAME_TOLERANCE) {
      failures.push(
        `视频帧数 nb_frames=${frames} 与 round(totalMs×fps/1000)=${expectedFrames} 不符：差 ` +
          `${frames - expectedFrames} 帧，容差 ±${MP4_FRAME_TOLERANCE} 帧` +
          `（mux 的 -shortest 在音轨末端丢 1~2 个视频包是**正常**的：T5 实测 −2.1 帧）`,
      );
    }
    const wantRate = `${fps}/1`;
    if (probe.video.rFrameRate !== wantRate) {
      failures.push(
        `视频帧率 r_frame_rate=${JSON.stringify(probe.video.rFrameRate)} ≠ ${wantRate}` +
          `（缺 -fps_mode cfr 时输出是 VFR：帧数/时长都不可复现）`,
      );
    }
  }

  if (probe.audio === null) {
    failures.push("成片没有音轨流——每一步的 mux 都会「成功」，而成片是哑的");
  } else {
    const audioMs = probe.audio.durationSec * 1000;
    if (Math.abs(audioMs - expectedMs) > AUDIO_LENGTH_TOLERANCE_MS) {
      failures.push(
        `音轨时长 ${probe.audio.durationSec.toFixed(6)}s（${audioMs.toFixed(1)}ms）与时间轴 Σ步长 ` +
          `${(expectedMs / 1000).toFixed(6)}s 不符：差 ${(audioMs - expectedMs).toFixed(1)}ms，容差 ` +
          `±${AUDIO_LENGTH_TOLERANCE_MS.toFixed(1)}ms（2 个 AAC 帧 = 1024/48000 的尾对齐）` +
          `——音轨被 -shortest 截掉就是这条红`,
      );
    }
    if (probe.audio.sampleRate !== AUDIO_SAMPLE_RATE) {
      failures.push(
        `音轨采样率 ${probe.audio.sampleRate}Hz ≠ ${AUDIO_SAMPLE_RATE}Hz（成片规格：跨机 TTS 的` +
          `44.1k/单声道由音轨图的 aformat 归一，这里是对归一的回读）`,
      );
    }
    if (probe.audio.channels !== 2) {
      failures.push(`音轨声道数 ${probe.audio.channels} ≠ 2（成片规格：encodeVideo 的 -ac 2）`);
    }
  }
  return failures;
}

/**
 * 校验一份渲染产物：总量层（ffprobe）→ 帧目录（逐条回读）→ 视频内容边界 → 音轨边界/内容 →
 * 跨会话同刻重采。**全部判据都跑**（不因前一条红就跳过后面——一次跑完能拿到全部证据），
 * 逐条成行返回；`ok = failures.length === 0`。
 *
 * 硬故障（产物不存在 / 空表 / segments 与步数不符 / ffprobe 读不出 JSON 或没有视频流 /
 * 浏览器缺失）**直接 throw**：那些是"校验没跑起来"，不是"产物有问题"，混进 failures 会让人
 * 以为产物被验过了。
 */
export async function verifyRender(opts: VerifyOptions): Promise<RenderVerifyReport> {
  const lines: string[] = [];
  const failures: string[] = [];
  const add = (line: string): void => void lines.push(line);
  const bad = (line: string): void => {
    lines.push(line);
    failures.push(line);
  };

  // ── 护栏（早于任何 ffmpeg / 浏览器） ──
  const timeline = opts.timeline;
  const fps = timeline.fps;
  if (timeline.steps.length === 0) {
    throw new Error("verifyRender：时间轴表为空——没有可校验的东西（空跑会「全绿」）；宁炸不静默");
  }
  if (opts.segments.length !== timeline.steps.length) {
    throw new Error(
      `verifyRender：segments ${opts.segments.length} 段 ≠ 时间轴 ${timeline.steps.length} 步` +
        `——段与步必须同序同长（音轨边界按步起点对齐；长度不符时后半程拿的是别的段的波形，` +
        `而"每步都对得上"的读数照样能绿）；宁炸不静默`,
    );
  }
  // 【终审修复波 2026-09-12（I2）】**数值**一致性：计划的接口约定 6（执行期更正块）承诺
  // "长度/数值不符即 throw"，但此前只查了**长度**——`segments[i].stepMs` 全程未被读取
  // （理想波形走 `timeline.steps[i].stepMs`），于是"数值必须相等"是**假承诺**。M5b 会直接消费本
  // 接口（SRT 时间码 / 导出服务复用本编排），故在护栏层把承诺兑现（与 encode 的 G2 同款口径）。
  // 位置刻意**早于** `existsSync(产物)`：形状与数值是纯数据契约，不该要求先有产物才能验。
  timeline.steps.forEach((step, index) => {
    const segment = opts.segments[index]!;
    if (segment.stepMs !== step.stepMs) {
      throw new Error(
        `verifyRender：segments[${index}].stepMs ${segment.stepMs} ≠ 时间轴第 ${index} 步（章节 ` +
          `${step.chapterId} 第 ${step.step} 步）的 stepMs ${step.stepMs}——两者同源同序（第 k 段就是` +
          `第 k 步），数值不符时音轨边界/内容判据比的是另一条时间轴，而"每步都对得上"的读数照样能绿；` +
          `宁炸不静默`,
      );
    }
  });
  if (!fs.existsSync(opts.output)) {
    throw new Error(`verifyRender：产物不存在：${opts.output}——没有产物就没有"验证"可言`);
  }

  // ── 1) 总量层（ffprobe 独立读数） ──
  const probe = parseProbeJson(runFfprobe(opts.output, opts.ffprobePath), opts.output);
  const expectedFrames = expectedMp4Frames(timeline, fps);
  add(
    `成片 ${probe.durationSec.toFixed(6)}s（时间轴 Σ步长 ${(timeline.totalMs / 1000).toFixed(6)}s，` +
      `差 ${(probe.durationSec * 1000 - timeline.totalMs).toFixed(1)}ms，容差 ±${durationToleranceMs(fps).toFixed(1)}ms）`,
  );
  add(
    probe.video === null
      ? "视频流：ffprobe 没读到"
      : `视频流 ${probe.video.codec}：nb_frames=${probe.video.nbFrames}（期望 ${expectedFrames}，` +
        `差 ${probe.video.nbFrames - expectedFrames} 帧，容差 ±${MP4_FRAME_TOLERANCE} 帧）、` +
        `r_frame_rate=${probe.video.rFrameRate}（须严格 ${fps}/1）`,
  );
  add(
    probe.audio === null
      ? "音轨流：ffprobe 没读到"
      : `音轨流 ${probe.audio.codec}/${probe.audio.sampleRate}Hz/${probe.audio.channels}ch：` +
        `${probe.audio.durationSec.toFixed(6)}s（时间轴 ${(timeline.totalMs / 1000).toFixed(6)}s，` +
        `差 ${(probe.audio.durationSec * 1000 - timeline.totalMs).toFixed(1)}ms，` +
        `容差 ±${AUDIO_LENGTH_TOLERANCE_MS.toFixed(1)}ms）`,
  );
  for (const f of checkProbe(probe, timeline, fps)) bad(`[失败] ${f}`);

  // ── 2) 帧目录：逐条 == framePaths（复用 T4 的回读判据，不重抄） ──
  let pngOnDisk = 0;
  let frameDirsOk = true;
  for (const step of timeline.steps) {
    const dir = frameDir(step.chapterId, step.step);
    const abs = path.join(opts.outDir, dir);
    const where = `帧目录 ${dir}`;
    if (!fs.existsSync(abs)) {
      bad(`[失败] ${where}：目录不存在（这一段的帧没落盘）`);
      frameDirsOk = false;
      continue;
    }
    try {
      assertFrameCountOnDisk(abs, framePaths(dir, step.frameCount), where);
    } catch (e) {
      bad(`[失败] ${e instanceof Error ? e.message : String(e)}`);
      frameDirsOk = false;
    }
    pngOnDisk += fs.readdirSync(abs).filter((n) => n.endsWith(".png")).length;
  }
  const wantPng = expectedPngTotal(timeline);
  if (frameDirsOk) {
    add(
      `帧目录：${timeline.steps.length} 步逐条相符，共 ${pngOnDisk} 张 PNG（Σ frameCount = ${wantPng}；` +
        `mp4 帧数是 ${expectedFrames}——CFR 把静置帧复制成多帧，两条口径从不相等）`,
    );
  } else {
    add(`帧目录：共 ${pngOnDisk} 张 PNG（Σ frameCount = ${wantPng}）——上面逐条列了不符处`);
  }

  // ── 3) 视频内容边界（唯一的"错位"护栏） ──
  const videoFrames = decodeGrayFrames(opts.output, opts.ffmpegPath);
  const vReadings = videoBoundaryReadings(frameDiffSeries(videoFrames), timeline, fps);
  const vChecked = checkBoundaries(
    vReadings,
    (VIDEO_BOUNDARY_TOLERANCE_FRAMES * 1000) / fps,
    "视频内容边界",
    `±${VIDEO_BOUNDARY_TOLERANCE_FRAMES} 帧`,
  );
  for (const l of vChecked.lines) add(l);
  for (const f of vChecked.failures) bad(f);
  if (vReadings.length > 0 && vChecked.judged === 0) {
    bad(
      `[失败] 视频内容边界：${vReadings.length} 条边界一条都没测到（成片里找不到任何显著的内容` +
        `跳变）——要么整条视频是同一张画面，要么帧流与时间轴不是同一份 deck；宁炸不静默`,
    );
  }
  // 【终审修复波 2026-09-12（M1）】可判面为**空** ≠ 绿：边界是"步与步之间"的内容跳变，单步表
  // （`--only 0` 这类子时间轴）压根没有边界可测——此前这一层**静默缺席**，读报告的人会把
  // "没看见这条"读成"这条绿了"。明写一行，别让空集冒充通过。
  if (vReadings.length === 0) {
    add(
      `[跳过] 视频内容边界：本表只有 ${timeline.steps.length} 步——边界是"步与步之间"的内容跳变，` +
        `单步表没有可判面（**既不是绿也不是红**；--only 选单步时会走到这里）。` +
        `要判偏移请至少渲两步`,
    );
  }

  // ── 4) 音轨边界 + 内容（理想波形在 Node 侧独立构造） ──
  const productPcm = decodePcm(opts.output, opts.ffmpegPath);
  const idealPcm = buildIdealPcm(opts.segments, timeline, opts.ffmpegPath);
  const aReadings = audioBoundaryReadings(idealPcm, productPcm, timeline, AUDIO_SAMPLE_RATE);
  const aChecked = checkBoundaries(aReadings, AUDIO_BOUNDARY_TOLERANCE_MS, "音轨边界", `±${AUDIO_BOUNDARY_TOLERANCE_MS}ms`);
  for (const l of aChecked.lines) add(l);
  for (const f of aChecked.failures) bad(f);
  if (aChecked.judged === 0 && hasSignal(idealPcm)) {
    bad(
      "[失败] 音轨边界：每一步的起点都没测到（理想波形有内容、却没有任何一条边界能对齐）" +
        "——音轨与时间轴不是同一条；宁炸不静默",
    );
  }

  // ── 5) 内容层：跨会话同刻重采 + 同帧 md5（抓"帧数对而内容错"） ──
  await recaptureCompare(opts, lines, failures);

  return { ok: failures.length === 0, lines, failures };
}

// ── 容差常量（口径的唯一出处；测试逐条钉住） ──

/** mp4 `nb_frames` 容差（帧）：T5 实测 −2.1 帧（`-shortest` 丢 1~2 个视频包），±1 会红。 */
export const MP4_FRAME_TOLERANCE = 3;
/** 视频内容边界容差（帧）：G1 实测上界 89.3ms（≡2.7 帧）+ ~1.5 帧余量。 */
export const VIDEO_BOUNDARY_TOLERANCE_FRAMES = 4;
/** 音轨边界容差（ms）：**紧口径**——音轨不吸附帧网格，实测样本级对齐 0~3ms。 */
export const AUDIO_BOUNDARY_TOLERANCE_MS = 10;
/** 一个 AAC 帧（ms）：1024 样点 / 48kHz。 */
export const AAC_FRAME_MS = (1024 / 48000) * 1000;
/** 音轨总长容差（ms）：2 个 AAC 帧（尾对齐的零头）。 */
export const AUDIO_LENGTH_TOLERANCE_MS = 2 * AAC_FRAME_MS;
/** 总时长容差（ms）：max(1 帧, AAC 帧对齐) —— 见口径表。 */
export function durationToleranceMs(fps: number): number {
  return Math.max(1000 / fps, AAC_FRAME_MS);
}

// ── 视频边界：逐帧签名差分 + 窗口内 argmax ──

/** 视频边界的搜索半径（帧）：±15 帧 ≈ ±500ms——比容差宽得多，超容差的偏移才看得见。 */
export const VIDEO_BOUNDARY_SEARCH_FRAMES = 15;
/** 跳变的显著性阈值：窗口内峰值 / 中位 ≥ 此值才算"这里有个内容跳变"。 */
export const BOUNDARY_MIN_RATIO = 3;
/** 灰度签名尺寸（宽×高）：96×54 下 20 倍缩图仍能分辨文字块，一帧 5184 字节（解码很便宜）。 */
export const SIGNATURE_WIDTH = 96;
export const SIGNATURE_HEIGHT = 54;

export interface BoundaryPeak {
  index: number;
  peak: number;
  median: number;
  ratio: number;
}

/** 逐帧签名 → 相邻帧平均绝对差（d[0] = 0：首帧没有前帧可比）。 */
export function frameDiffSeries(frames: readonly Uint8Array[]): Float64Array {
  const out = new Float64Array(frames.length);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const cur = frames[i];
    if (prev.length !== cur.length) {
      throw new Error(`frameDiffSeries：第 ${i} 帧长度 ${cur.length} ≠ 前一帧 ${prev.length}`);
    }
    let sum = 0;
    for (let k = 0; k < cur.length; k++) sum += Math.abs(cur[k] - prev[k]);
    out[i] = sum / cur.length;
  }
  return out;
}

/** 窗口 [`center`±`radius`] 内的最大跳变点 + 峰值/中位比（显著性）。 */
export function findBoundaryFrame(
  diffs: ArrayLike<number>,
  center: number,
  radius: number,
): BoundaryPeak {
  const n = diffs.length;
  if (n === 0) throw new Error("findBoundaryFrame：空信号（0 帧的成片）");
  const lo = Math.max(0, center - radius);
  const hi = Math.min(n - 1, center + radius);
  let index = lo;
  let peak = -Infinity;
  const window: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const v = diffs[i];
    window.push(v);
    if (v > peak) {
      peak = v;
      index = i;
    }
  }
  window.sort((a, b) => a - b);
  const mid = window.length >> 1;
  const median = window.length % 2 === 1 ? window[mid] : (window[mid - 1] + window[mid]) / 2;
  return { index, peak, median, ratio: peak / Math.max(median, Number.EPSILON) };
}

/** 一条边界读数（视频/音轨共用形状）。 */
export interface BoundaryReading {
  /** 边界的人类可读定位（如 `步 example#0→example#1`） */
  label: string;
  /** 时间轴里的期望值（ms） */
  expectedMs: number;
  /** 产物里的实测值（ms）；null = **跳过**（无法定位：无显著跳变 / 静音窗口）——不参与判定 */
  actualMs: number | null;
  /** 读数补充（跳变帧 / 相关性 / 跳过成因） */
  detail: string;
  /** 非偏移类的确定失败（如"音轨内容与时间轴不符"）：有它就直接报红 */
  failure?: string;
}

/**
 * 视频内容边界读数：**步 1 起的 n−1 条**（步 0 的起点没有"前一帧"可比，不设边界）。
 * 每条取期望帧位 ±15 帧内跳变信号的 argmax；显著性不足 → 跳过（记成因）。
 */
export function videoBoundaryReadings(
  diffs: ArrayLike<number>,
  timeline: Timeline,
  fps: number,
): BoundaryReading[] {
  const readings: BoundaryReading[] = [];
  for (let i = 1; i < timeline.steps.length; i++) {
    const prev = timeline.steps[i - 1];
    const step = timeline.steps[i];
    const expectedMs = step.startMs;
    const expectedIndex = Math.round((expectedMs * fps) / 1000);
    const peak = findBoundaryFrame(diffs, expectedIndex, VIDEO_BOUNDARY_SEARCH_FRAMES);
    const label = `步 ${prev.chapterId}#${prev.step}→${step.chapterId}#${step.step}`;
    // 中位为 0 时比值是 ∞（真 deck 的静置帧让窗口里半数以上帧差为 0）——别把浮点噪声印成读数
    const ratioText = peak.ratio < 1e6 ? peak.ratio.toFixed(2) : `∞（中位为 0）`;
    const why = `期望第 ${expectedIndex} 帧 ±${VIDEO_BOUNDARY_SEARCH_FRAMES} 帧内取跳变峰值（峰值 ${peak.peak.toFixed(2)}、中位 ${peak.median.toFixed(2)}、比 ${ratioText}，阈值 ${BOUNDARY_MIN_RATIO}）`;
    if (peak.ratio < BOUNDARY_MIN_RATIO) {
      readings.push({
        label,
        expectedMs,
        actualMs: null,
        detail: `${why}——该窗口内没有显著内容跳变：相邻两步画面可能本就相同，这条不参与判定`,
      });
      continue;
    }
    readings.push({
      label,
      expectedMs,
      actualMs: (peak.index * 1000) / fps,
      detail: `跳变在第 ${peak.index} 帧（${why}）`,
    });
  }
  return readings;
}

// ── 音轨边界：与理想波形的窗口对齐（样本级） ──

/** 对齐窗口的半宽（ms）：窗口**跨过**边界（±50ms）——边界两侧内容一般不同，偏移才可判。 */
export const AUDIO_ALIGNMENT_HALF_WINDOW_MS = 50;
/** 对齐搜索半径（ms）：±150ms（恒定 A/V 偏移的常见量级都在这以内）。 */
export const AUDIO_ALIGNMENT_SEARCH_MS = 150;
/** 粗扫步长（样本，= 1/3ms）：逐样本全扫是 200M 次/边界，粗扫 + 细扫等价且便宜。 */
export const AUDIO_ALIGNMENT_COARSE_STRIDE = 16;
/** "容差内的最优代价"允许比"全局最优代价"高出的倍数/绝对值（Int16 平均绝对差的底噪）。 */
export const AUDIO_ALIGNMENT_SLACK = 1.5;
export const AUDIO_ALIGNMENT_COST_FLOOR = 200;
/** 内容判据：容差内最优对齐处的相关系数下限（AAC 有损 + 同源内容，实测 ~0.99）。 */
export const AUDIO_CONTENT_MIN_CORRELATION = 0.6;

export interface AudioAlignmentReading {
  /** 定位到的偏移（ms，**正 = 产物内容比时间轴晚**）——aligned 时取容差内最优、否则取全局最优 */
  driftMs: number;
  /** 全局最优偏移（ms）：错位时的定位值（稳态单频内容会给出一族等价偏移，此时它是下界） */
  bestDriftMs: number;
  bestCost: number;
  acceptCost: number;
  /** 零偏移是否"值得信"：容差内的最优代价不显著高于全局最优 ⇒ 与时间轴对齐 */
  aligned: boolean;
  /** 容差内最优对齐处的相关系数（内容判据） */
  correlation: number;
  productRms: number;
  idealRms: number;
}

/** 均方根 + 平均绝对差 + 皮尔逊相关（都在 Int16 单位上）。 */
function rms(a: Int16Array, from: number, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = a[from + i];
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

function pearson(
  a: Int16Array,
  ao: number,
  b: Int16Array,
  bo: number,
  n: number,
): number {
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[ao + i];
    sb += b[bo + i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[ao + i] - ma;
    const y = b[bo + i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

/**
 * 一个步起点处的对齐度量（**判据是"零偏移值不值得信"**，不是"最小代价在哪"）。
 *
 * 为什么不是"取最小代价的偏移"：平稳内容（单频正弦）在窗口内与自身平移后的等价偏移**一族**
 * 同代价——取 argmin 会随机落在其中一条上，"看起来测到了偏移"其实是内容本身给不出信息。
 * 反过来问"零偏移的代价与全局最优代价相比如何"则没有这个歧义：
 *   · 对齐时两者相等（零偏移就是最优之一）→ 绿
 *   · 错位时（跨过边界的窗口里两侧内容一般不同）零偏移代价显著更高 → 红，并报出最优偏移
 */
export function measureAudioAlignment(opts: {
  ideal: Int16Array;
  product: Int16Array;
  atSample: number;
  halfWindowSamples: number;
  searchSamples: number;
  toleranceSamples: number;
  sampleRate: number;
}): AudioAlignmentReading {
  const { ideal, product, atSample, halfWindowSamples, searchSamples, toleranceSamples, sampleRate } = opts;
  const lo = Math.max(0, atSample - halfWindowSamples);
  const hi = Math.min(product.length, ideal.length, atSample + halfWindowSamples);
  const n = hi - lo;
  if (n <= 0) {
    throw new Error(`measureAudioAlignment：窗口为空（atSample ${atSample}，长度 ${n}）`);
  }
  const cost = (d: number): number => {
    if (lo - d < 0 || hi - d > ideal.length) return Infinity;
    let sum = 0;
    for (let m = 0; m < n; m++) sum += Math.abs(product[lo + m] - ideal[lo - d + m]);
    return sum / n;
  };
  // 粗扫（步长 stride）定盆 + 细扫（±stride）定谷：等价于逐样本全扫，代价少一个量级
  let coarseD = 0;
  let coarseCost = Infinity;
  for (let d = -searchSamples; d <= searchSamples; d += AUDIO_ALIGNMENT_COARSE_STRIDE) {
    const c = cost(d);
    if (c < coarseCost) {
      coarseCost = c;
      coarseD = d;
    }
  }
  let bestD = coarseD;
  let bestCost = coarseCost;
  for (let d = coarseD - AUDIO_ALIGNMENT_COARSE_STRIDE; d <= coarseD + AUDIO_ALIGNMENT_COARSE_STRIDE; d++) {
    const c = cost(d);
    if (c < bestCost) {
      bestCost = c;
      bestD = d;
    }
  }
  // 容差内的最优（决定"零偏移值不值得信"）——同代价时取**离零最近**的（最小修正量）
  let acceptD = 0;
  let acceptCost = Infinity;
  for (let d = -toleranceSamples; d <= toleranceSamples; d++) {
    const c = cost(d);
    if (c < acceptCost - Number.EPSILON || (Math.abs(c - acceptCost) <= Number.EPSILON && Math.abs(d) < Math.abs(acceptD))) {
      acceptCost = c;
      acceptD = d;
    }
  }
  const aligned = acceptCost <= bestCost * AUDIO_ALIGNMENT_SLACK + AUDIO_ALIGNMENT_COST_FLOOR;
  const chosen = aligned ? acceptD : bestD;
  return {
    driftMs: (chosen / sampleRate) * 1000,
    bestDriftMs: (bestD / sampleRate) * 1000,
    bestCost,
    acceptCost,
    aligned,
    correlation: pearson(product, lo, ideal, lo - chosen, n),
    productRms: rms(product, lo, n),
    idealRms: rms(ideal, lo, n),
  };
}

/**
 * 音轨边界读数：**每步起点一条**（含步 0——音轨的起点也要对得上）。
 *
 * 跳过（不参与判定）：窗口两侧都是静音（无声过场 / 未合成音频）、产物音轨短到放不下窗口。
 * 报红：· 产物该处静音而时间轴有内容（段丢失 / 被截）
 *        · 容差内最优对齐处相关性过低（内容不符：段挂错 / 段序错位）
 *        · 零偏移代价显著高于最优（与时间轴错位，报出定位到的偏移）
 */
export function audioBoundaryReadings(
  ideal: Int16Array,
  product: Int16Array,
  timeline: Timeline,
  sampleRate: number,
): BoundaryReading[] {
  const readings: BoundaryReading[] = [];
  const halfWindow = Math.round((AUDIO_ALIGNMENT_HALF_WINDOW_MS * sampleRate) / 1000);
  const search = Math.round((AUDIO_ALIGNMENT_SEARCH_MS * sampleRate) / 1000);
  const tolerance = Math.round((AUDIO_BOUNDARY_TOLERANCE_MS * sampleRate) / 1000);
  for (const step of timeline.steps) {
    const label = `步 ${step.chapterId}#${step.step} 起`;
    const expectedMs = step.startMs;
    const atSample = Math.round((expectedMs * sampleRate) / 1000);
    // 窗口取 [at−50ms, at+50ms)，截到两轨都有的范围（产物比时间轴短时窗口收窄，不越界）
    const lo = Math.max(0, atSample - halfWindow);
    const hi = Math.min(product.length, ideal.length, atSample + halfWindow);
    const n = hi - lo;
    if (n <= 0) {
      readings.push({
        label,
        expectedMs,
        actualMs: null,
        detail: "产物音轨短到该步起点之前放不下对齐窗口——音轨总长那条是它的判据",
      });
      continue;
    }
    const idealRms = rms(ideal, lo, n);
    const productRms = rms(product, lo, n);
    if (idealRms < SILENCE_RMS && productRms < SILENCE_RMS) {
      readings.push({
        label,
        expectedMs,
        actualMs: null,
        detail: "窗口两侧都是静音（无声过场 / 未合成音频）——这条不参与判定",
      });
      continue;
    }
    const a = measureAudioAlignment({
      ideal,
      product,
      atSample,
      halfWindowSamples: halfWindow,
      searchSamples: search,
      toleranceSamples: tolerance,
      sampleRate,
    });
    const numbers =
      `零偏移代价 ${a.acceptCost.toFixed(1)} vs 全局最优 ${a.bestCost.toFixed(1)}（@${a.bestDriftMs.toFixed(1)}ms）、` +
      `相关性 ${a.correlation.toFixed(3)}、RMS 产物 ${a.productRms.toFixed(0)} / 时间轴 ${a.idealRms.toFixed(0)}`;
    if (!a.aligned) {
      // 偏移判据（**主判据**）——actualMs 落在容差外由 checkBoundaries 报红；值是"全局最优"的定位，
      // 窗口内容是静音段/稳态单频时它只给出下界（等价偏移一族，见 measureAudioAlignment 的注释）
      readings.push({
        label,
        expectedMs,
        actualMs: expectedMs + a.driftMs,
        detail: numbers,
      });
      continue;
    }
    if (a.correlation < AUDIO_CONTENT_MIN_CORRELATION) {
      readings.push({
        label,
        expectedMs,
        actualMs: null,
        detail: numbers,
        failure:
          `音轨该处与时间轴不符（相关性 ${a.correlation.toFixed(3)}）——该步的段丢失 / 被截 / ` +
          `段挂错（产物比时间轴晚得多时本窗口也会落到还没内容的地方）`,
      });
      continue;
    }
    readings.push({
      label,
      expectedMs,
      // 实际的"内容起点" = 期望起点 + 定位到的偏移（正 = 晚）
      actualMs: expectedMs + a.driftMs,
      detail: numbers,
    });
  }
  return readings;
}

/** 静音判据（RMS，Int16 单位）：远低于任何有声内容，又不把 dither 当内容。 */
export const SILENCE_RMS = 20;

// ── checkBoundaries：偏移判定 + 跳过通道 ──

export interface BoundaryCheck {
  lines: string[];
  failures: string[];
  /** 参与判定的条数（actualMs 非 null 且无 failure） */
  judged: number;
}

/** 逐条成行：`judged` 条参与容差判定，`null` 的只记一行跳过（不误报成偏移）。 */
export function checkBoundaries(
  readings: readonly BoundaryReading[],
  toleranceMs: number,
  label: string,
  toleranceNote = `±${toleranceMs.toFixed(1)}ms`,
): BoundaryCheck {
  const lines: string[] = [];
  const failures: string[] = [];
  let judged = 0;
  for (const r of readings) {
    const where = `${label} ${r.label} @${r.expectedMs}ms`;
    if (r.failure !== undefined) {
      const line = `[失败] ${where}：${r.failure}（${r.detail}）`;
      lines.push(line);
      failures.push(line);
      continue;
    }
    if (r.actualMs === null) {
      lines.push(`[跳过] ${where}：${r.detail}`);
      continue;
    }
    judged++;
    const delta = r.actualMs - r.expectedMs;
    if (Math.abs(delta) > toleranceMs) {
      const line =
        `[失败] ${where}：实测 ${r.actualMs.toFixed(1)}ms，差 ${delta.toFixed(1)}ms ` +
        `超出容差 ${toleranceNote}（${r.detail}）`;
      lines.push(line);
      failures.push(line);
      continue;
    }
    lines.push(`${where}：实测 ${r.actualMs.toFixed(1)}ms，差 ${delta.toFixed(1)}ms（容差 ${toleranceNote}；${r.detail}）`);
  }
  return { lines, failures, judged };
}

// ── 跨会话同刻重采：采样点 + md5 比对 ──

/** 一个重采点：第 `index` 帧（0 起编）在页面上对应的 t。 */
export interface SampledFrame {
  chapter: number;
  step: number;
  chapterId: string;
  index: number;
  /** 该帧在页面上的 t（ms，步内相对）——`frameTimes` 的同一份口径 */
  tMs: number;
}

/** 采样步数上限（计划 §5 的取舍 ③：`min(3, 步数)`，**必含首末步**）。 */
export const SAMPLE_STEPS_MAX = 3;

/**
 * 跨会话重采的采样点：`min(3, 步数)` 个步（首/中/末，必含首末步），每步取**首帧 + 末帧**
 * （单帧步只取一张；末帧是静置帧，落在 `animMs`——它承载"窗口之后画面冻在哪一拍"）。
 */
export function sampledFrames(timeline: Timeline): SampledFrame[] {
  const steps = timeline.steps;
  if (steps.length === 0) {
    throw new Error("sampledFrames：时间轴表为空——没有可采样的帧；宁炸不静默");
  }
  const count = Math.min(SAMPLE_STEPS_MAX, steps.length);
  const picked: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = count === 1 ? 0 : Math.round((i * (steps.length - 1)) / (count - 1));
    if (picked[picked.length - 1] !== at) picked.push(at);
  }
  const out: SampledFrame[] = [];
  for (const at of picked) {
    const step = steps[at];
    const times = frameTimes(step.frameCount, step.animMs, timeline.fps, step.holdMs);
    const indices = step.frameCount > 1 ? [0, step.frameCount - 1] : [0];
    for (const index of indices) {
      out.push({
        chapter: step.chapter,
        step: step.step,
        chapterId: step.chapterId,
        index,
        tMs: times[index],
      });
    }
  }
  return out;
}

// ── ffprobe / ffmpeg 命令面 ──

const STDERR_TAIL = 12;

function stderrTail(stderr: string): string {
  const lines = stderr.trimEnd().split("\n");
  return lines.slice(-STDERR_TAIL).join("\n");
}

/** ffprobe 读数（`-of json`）——命令面就是 brief 给的那条 + 音轨总长/规格所需的两项。 */
export function runFfprobe(file: string, ffprobePath = "ffprobe"): string {
  const r = spawnSync(
    ffprobePath,
    [
      "-v", "error",
      "-show_entries",
      "format=duration:stream=codec_name,codec_type,nb_frames,r_frame_rate,duration,sample_rate,channels",
      "-of", "json",
      file,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.error !== undefined) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(ffmpegMissingMessage(ffprobePath));
    throw new Error(`ffprobe 启动失败（${ffprobePath}）：${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(`ffprobe 退出码 ${r.status}：${file}\n${stderrTail(r.stderr ?? "")}`);
  }
  return r.stdout;
}

/**
 * ffprobe JSON → 摘要。缺 `format.duration` / 没有视频流 → **throw**（没有画面时长/帧率就没有
 * 自校验可言）；没有音轨流 → `audio: null`（那是一条**要报红**的判据，交 checkProbe 说，
 * 不是解析失败——免得"成片是哑的"被一句 parse error 盖过去）。
 */
export function parseProbeJson(json: string, where: string): FfprobeSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`ffprobe 输出不是 JSON（${where}）：${e instanceof Error ? e.message : String(e)}`);
  }
  const root = parsed as { format?: { duration?: unknown }; streams?: unknown };
  const streams = Array.isArray(root.streams) ? (root.streams as Array<Record<string, unknown>>) : [];
  const durationSec = Number.parseFloat(String(root.format?.duration ?? ""));
  if (!Number.isFinite(durationSec)) {
    throw new Error(`ffprobe 读数缺 format.duration（${where}）：${JSON.stringify(json).slice(0, 200)}——宁炸不猜`);
  }
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (video === undefined) {
    throw new Error(
      `ffprobe 没有读到视频流（${where}）——成片只有音轨是编码/ mux 的硬故障，` +
        `本模块的帧数/帧率/边界判据全部无定义；宁炸不猜`,
    );
  }
  const nbFrames = Number.parseInt(String(video.nb_frames ?? ""), 10);
  if (!Number.isFinite(nbFrames)) {
    throw new Error(`ffprobe 视频流缺 nb_frames（${where}）：${JSON.stringify(video).slice(0, 200)}`);
  }
  const rFrameRate = String(video.r_frame_rate ?? "");
  if (rFrameRate === "") {
    throw new Error(`ffprobe 视频流缺 r_frame_rate（${where}）：${JSON.stringify(video).slice(0, 200)}`);
  }
  let audioSummary: FfprobeSummary["audio"] = null;
  if (audio !== undefined) {
    const audioDuration = Number.parseFloat(String(audio.duration ?? ""));
    audioSummary = {
      codec: String(audio.codec_name ?? ""),
      // 音轨流的 duration 一般都有；缺了就用容器时长顶（AAC 尾对齐的零头比容器差距小得多）
      durationSec: Number.isFinite(audioDuration) ? audioDuration : durationSec,
      sampleRate: Number.parseInt(String(audio.sample_rate ?? ""), 10),
      channels: Number.parseInt(String(audio.channels ?? ""), 10),
    };
  }
  return {
    durationSec,
    video: {
      codec: String(video.codec_name ?? ""),
      nbFrames,
      rFrameRate,
    },
    audio: audioSummary,
  };
}

/**
 * 跑一次 ffmpeg 并把 **stdout 字节**取回来（解码成 rawvideo / s16le 用；encode.ts 的 `runFfmpeg`
 * 是"只要退出码"的那份，用途不同）。错误文案复用 `ffmpegMissingMessage`（"缺二进制给 brew
 * 指引"只此一份）。
 */
function captureFfmpeg(args: readonly string[], ffmpegPath = "ffmpeg"): Buffer {
  const r = spawnSync(ffmpegPath, args, { maxBuffer: 512 * 1024 * 1024 });
  if (r.error !== undefined) {
    const code = (r.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(ffmpegMissingMessage(ffmpegPath));
    throw new Error(`ffmpeg 启动失败（${ffmpegPath}）：${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new Error(
      `ffmpeg 退出码 ${r.status}：${ffmpegPath} ${args.join(" ")}\n${stderrTail(String(r.stderr ?? ""))}`,
    );
  }
  return r.stdout as Buffer;
}

/**
 * 成片 → 灰度签名帧（`SIGNATURE_WIDTH`×`SIGNATURE_HEIGHT`，一帧一字节）。
 *
 * 分辨率**在 ffmpeg 侧缩**（不是在 Node 侧逐像素比）：1080p 不解成 1.4GB 的 rawvideo，
 * 一帧 5184 字节、8 秒成片 ~1.2MB——边界判据要的是"画面变没变"，不是像素级一致。
 */
export function decodeGrayFrames(file: string, ffmpegPath = "ffmpeg"): Uint8Array[] {
  const buf = captureFfmpeg(
    [
      "-v", "error",
      "-i", file,
      "-vf", `scale=${SIGNATURE_WIDTH}:${SIGNATURE_HEIGHT}`,
      "-pix_fmt", "gray",
      "-f", "rawvideo",
      "-",
    ],
    ffmpegPath,
  );
  const frameBytes = SIGNATURE_WIDTH * SIGNATURE_HEIGHT;
  if (buf.length === 0 || buf.length % frameBytes !== 0) {
    throw new Error(
      `成片解码出的字节数 ${buf.length} 不是 ${SIGNATURE_WIDTH}×${SIGNATURE_HEIGHT} 的整数倍` +
        `——签名解码没按预期工作（宁炸不猜，免得帧错位之后所有边界读数都是假的）`,
    );
  }
  const frames: Uint8Array[] = [];
  for (let at = 0; at < buf.length; at += frameBytes) {
    frames.push(new Uint8Array(buf.subarray(at, at + frameBytes)));
  }
  return frames;
}

/** 成片音轨 → 单声道 48kHz Int16 PCM（`-vn`：只取音轨；AAC 解码含 edit list 的补偿）。 */
export function decodePcm(file: string, ffmpegPath = "ffmpeg"): Int16Array {
  const buf = captureFfmpeg(
    ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(AUDIO_SAMPLE_RATE), "-f", "s16le", "-"],
    ffmpegPath,
  );
  if (buf.length % 2 !== 0) {
    throw new Error(`音轨解码出的字节数 ${buf.length} 不是 16bit 的整数倍`);
  }
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}

/** mp3 → 单声道 48kHz Int16 PCM（理想波形的来源；与音轨图的 aformat 同规格）。 */
function decodeMp3(file: string, ffmpegPath = "ffmpeg"): Int16Array {
  const buf = captureFfmpeg(
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(AUDIO_SAMPLE_RATE), "-f", "s16le", "-"],
    ffmpegPath,
  );
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}

/**
 * 理想音轨（**Node 侧独立构造**，不走 ffmpeg 的 filter_complex）：逐段
 * `decode mp3 → 截/补到 stepMs` → 顺序拼接；无声段（mp3 = null）= 等长静音。
 *
 * 与音轨图同构但**不同路**：图是 `[i:a]aformat,apad,atrim=0:<stepMs>` + concat，这里是
 * "取前 stepMs 个样本、不足补零"。两条独立路径给出的波形一致，才能说明音轨**内容**是按
 * 时间轴铺的——若复用图本身，"图写错了"会被自校验一起抄下来。
 */
export function buildIdealPcm(
  segments: readonly AudioSegment[],
  timeline: Timeline,
  ffmpegPath = "ffmpeg",
): Int16Array {
  const parts: Int16Array[] = [];
  let total = 0;
  segments.forEach((seg, i) => {
    const step = timeline.steps[i];
    if (step === undefined) {
      throw new Error(`buildIdealPcm：第 ${i} 段在时间轴里没有对应步——两者必须同序同长`);
    }
    const stepSamples = Math.round((step.stepMs * AUDIO_SAMPLE_RATE) / 1000);
    const part = new Int16Array(stepSamples);
    if (seg.mp3 !== null) {
      const pcm = decodeMp3(seg.mp3, ffmpegPath);
      part.set(pcm.subarray(0, Math.min(pcm.length, stepSamples)));
    }
    parts.push(part);
    total += stepSamples;
  });
  const out = new Int16Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function hasSignal(pcm: Int16Array): boolean {
  for (let i = 0; i < pcm.length; i += 7) if (Math.abs(pcm[i]) >= SILENCE_RMS) return true;
  return false;
}

function md5File(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/**
 * 跨会话同刻重采 → 与产物帧目录同帧 md5 逐字节比对（"帧数对而内容错"的唯一判据）。
 *
 * **独立** `openSession`（另一个浏览器进程）：同一页连拍一致只证明页面没动过，证明不了可重放。
 * 序列与 T4 的帧流同一套（`jumpTo` → ready → **归位 seek(0)** → `seek(t_j)` → 两拍 rAF → 截图）
 * ——T4 已实测"独立会话同一 t 逐字节一致"，所以这里的不一致只可能来自产物侧。
 */
async function recaptureCompare(
  opts: VerifyOptions,
  lines: string[],
  failures: string[],
): Promise<void> {
  const points = sampledFrames(opts.timeline);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-recapture-"));
  const push = (line: string, failed: boolean): void => {
    lines.push(line);
    if (failed) failures.push(line);
  };
  const session = await openSession({
    url: withRenderMode(opts.url),
    viewport: opts.viewport ?? stageConfig.dims,
    softwareGL: opts.softwareGL === true,
  });
  try {
    for (const p of points) {
      const dir = frameDir(p.chapterId, p.step);
      const step = opts.timeline.steps.find((s) => s.chapter === p.chapter && s.step === p.step)!;
      const file = framePaths(dir, step.frameCount)[p.index];
      const productFile = path.join(opts.outDir, file);
      const where = `跨会话重采 ${file}（t=${p.tMs.toFixed(1)}ms）`;
      if (!fs.existsSync(productFile)) {
        push(`[失败] ${where}：产物帧不存在`, true);
        continue;
      }
      await jumpToStep(session.page, { chapter: p.chapter, step: p.step });
      await readyWithTimeout(session.page, where);
      await seekTo(session.page, 0); // 归位（M5 遗留 #2）：canvasAnim 创建即冻结、从未 draw
      await seekTo(session.page, p.tMs);
      await session.page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      const shot = path.join(tmpDir, `${p.chapterId}-${p.step}-${p.index}.png`);
      await session.page.screenshot({ path: shot });
      const want = md5File(productFile);
      const got = md5File(shot);
      if (want !== got) {
        push(
          `[失败] ${where}：产物帧 md5 ${want} ≠ 独立会话重采 ${got}——产物帧不是这一刻该有的画面` +
            `（帧被换 / 被改 / 渲的是别的 t）`,
          true,
        );
      } else {
        lines.push(`${where}：md5 ${want} 逐字节相符`);
      }
    }
  } finally {
    await session.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
