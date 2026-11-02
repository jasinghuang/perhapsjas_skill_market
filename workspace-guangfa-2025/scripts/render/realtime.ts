// M5b Task 4 实时捕获降级（§8 step 4：seek 断言失败 → 实时捕获模式兜底出片）——确定性链路的
// **逃生舱**：真播放（墙钟）+ 录屏 + 同一份确定性音轨 mux，出一条"能交给人的片子"。
//
// ## 两条死因是**实测**钉死的（质检 #2 C1#1/C1#2），实现不得再走"取最简者"的裁量
//
//   ① **不能复用 `openSession`**：它恒加 `headless=1`（`withHeadless`），而 `App.tsx` 的守卫
//      `if (renderMode || params.has("headless")) return;` 直接摘掉自驱推进链——录出来是**冻在
//      第 0 步的静止画面**（时长/产物名/日志全对，只有画面是死的）。故本模块 `chromium.launch`
//      直调 + `browser.newContext` 自开会话，URL 只允许**裸 `?auto=1`**（`assertRealtimeUrl` 挡两条）。
//   ② **必须开 `--autoplay-policy=no-user-gesture-required`**：裸 `?auto=1` 下 Chromium 的自动
//      播放策略会拒 `audio.play()`（`NotAllowedError: the user didn't interact with the document
//      first`）。质检实测（**A 修复之前**）：不加这条 flag 时游标 30 秒都停在 (0,0)——`play()` 的
//      rejection 被吞掉且不武装任何计时器，整条推进链没有事件源。
//      ⚠️ **因果已随 A 更新（评审 M5④）**：`useAudioPlayer` 现在被拒时武装估时兜底 ⇒ 缺这条 flag
//      **不再冻死**，而是退化为"按估时节奏推进"——画面照走，但节奏来自文本估时，与 mux 进来的
//      **确定性音轨**（按真实音频时长合成）对不上 ⇒ 产物音画逐步漂移。故这条 flag 仍然必须开：
//      它保的是"画面按**真实音频**节奏走"这个前提，不是"能不能出片"。
//
// ## 为什么 `recordVideo` 必须带 `size`
//
// Playwright 的 `recordVideo` **不传 size 会缩到 800×450**（实测）——产物与"精确 1080p"契约
// 差一个量级。故 `size` 逐字取 `opts.viewport`。
//
// ## 录制 → 成片的四步（每一步都有实测依据）
//
//   1. 录：`recordVideo` 出的是 **webm / VP8 / 25fps / 无音轨**；录制窗口 = `totalMs + 尾部余量`
//      （页面装载与步间抖动；见 `realtimeRecordMs`）。录制期间同时**采样游标**（`window.__presentation`
//      桥在 dev 下总是装的）：轨迹是"画面真的在走"的现场证据，也是"定格假绿"的现场拦截
//      ——多步 deck 上一动不动的轨迹当场 throw（详见 `recordWithCursorTrace`）。
//   2. 落盘：`await context.close()` 之后才 `await video.path()`（Playwright 的录像在页/上下文
//      关闭时才写完；早取会拿到半截文件）。
//   3. 转码 + mux（一次 ffmpeg）：webm → **mp4 / 30fps / CFR / yuv420p**，音轨用**同一份确定性
//      音轨**（`audioTrack` = encode 出的 `audio.m4a`）——降级**不失声**；`audioTrack === null`
//      时日志明写"本次降级产物无声"。
//   4. `-shortest`：视频按墙钟录、音轨按时间轴，两者长度天然不等——收在较短的一侧（音轨）让
//      产物时长回到时间轴口径附近。
//
// ## 已知取舍（KNOWN-ISSUES 登记：实时捕获的 A/V 同步是**近似的**）
//
// 画面按**墙钟**走（真播放），音轨按**时间轴**合成——两者的对齐依赖"页面自驱节奏 ≈ 时间轴表"
// （同源的 `estimateNarrationMs` / `resolveHoldMs` / 起播时机），**逐帧不做同刻比对的保证**。
// 降级产物按定义不可确定复现（同一 deck 两次录制的字节不同），故**不做**帧级自校验——代价由
// "帧两两不同"的验收判据（realtime.browser.test.ts）+ 产物名后缀 + 响亮日志兜底。
//
// 依赖方向：scripts/render.ts → 本模块 → scripts/shot/session.ts（软渲参数与浏览器缺失指引，
// 不 import capture.ts）+ scripts/render/encode.ts（ffmpeg/ffprobe 命令面）；**不 import
// scripts/render.ts**（反向 import 会成环）。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowserContext, Page } from "playwright";
import {
  SOFTWARE_GL_ARGS,
  chromiumMissingError,
  isMissingBrowserError,
} from "../shot/session";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, probeDurationMs, runFfmpeg } from "./encode";
import type { Timeline } from "./timeline";

// ── 常量（计划接口约定 4） ──

/**
 * 实时捕获专用启动参数（照 `SOFTWARE_GL_ARGS` 款：单测直接断言这一份，让"到底开了什么 flag"
 * 有唯一答案）。
 *
 * `--autoplay-policy=no-user-gesture-required` 是**死因②**的解药：无头/自动化会话里没有用户
 * 手势，Chromium 缺省拒绝 `audio.play()`。⚠️ 因果随 A（`useAudioPlayer` 的估时兜底）更新：
 * 缺它**不再冻死**，而是让画面退化成**估时节奏**——与 mux 进来的确定性音轨对不上（见文件头 ②）。
 */
export const REALTIME_LAUNCH_ARGS: readonly string[] = ["--autoplay-policy=no-user-gesture-required"];

/** 录制窗口的尾部余量（ms）：页面装载 + 步间抖动；产物随后被 `-shortest` 收到音轨长度 */
export const REALTIME_TAIL_MS = 1200;

/** 转码帧率：与确定性成片同口径（recordVideo 的 webm 是 25fps） */
export const REALTIME_FPS = 30;

/** 游标采样间隔（ms）：够密（步长约 2s 量级）又不至于让 evaluate 抢走渲染时间 */
export const REALTIME_SAMPLE_MS = 250;

/**
 * 定格判据所需的最小观测窗口（ms）：窗口短于它时"没动"**不能**判成"画面是死的"。
 *
 * 门槛的由来：deck 的首步是"一段口播 + 入场动画"量级（模板 deck 首步 3400ms），而 `--only`
 * 的子表可以短到几百 ms（窗口 = 声明时长 + 尾部余量）——那种窗口里页面本来就还没走到第 1 步。
 * 真 deck 的任何真实窗口（哪怕只渲一步的 3400+1200）都远在这条线之上，故它不削弱判据，
 * 只挡掉"把健康页面判死"这一类假红（评审 M1）。
 */
export const REALTIME_MIN_JUDGE_MS = 3000;

/** 降级产物后缀（`<slug>.realtime.mp4`）：降级**必须看得见**——名字是最先被看见的那行 */
export const REALTIME_SUFFIX = ".realtime";

// ── 接口（计划接口约定 4：跨任务冻结面） ──

/** 日志面（结构上与 `render.ts` 的 `RenderIo` 同形——本模块不反向 import 编排层） */
export interface RealtimeIo {
  log(text: string): void;
  error(text: string): void;
}

export interface RealtimeOptions {
  /** **裸 `?auto=1`**（不得带 headless / render——两条都摘掉页面自驱推进链，见文件头） */
  url: string;
  outDir: string;
  slug: string;
  /** 时间轴（**子表**：`--only` 时与帧流/自校验同一张）——声明时长与录制窗口的唯一出处 */
  timeline: Timeline;
  /** 确定性音轨（encode 出的 `audio.m4a`）——降级不得失声；null = 本次产物无声（日志明写） */
  audioTrack: string | null;
  viewport: { width: number; height: number };
  /** 软件渲染（§11.2）；缺省 false = 只带 `REALTIME_LAUNCH_ARGS` */
  softwareGL?: boolean;
  /** 日志面（缺省 console）；注入让编排层与单测拿同一份输出 */
  io?: RealtimeIo;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface RealtimeResult {
  /** 产物路径 `<outDir>/<slug>.realtime.mp4` */
  file: string;
  /** 声明时长 = `timeline.totalMs`（时间轴口径；不是墙钟录制窗口，也不是实测读数） */
  declaredMs: number;
  /** ffprobe 实测时长（ms） */
  durationMs: number;
  /**
   * 录制会话内的游标轨迹（去重后的顺序观测；桥不可用时为空数组）。
   *
   * **这是"画面真的在走"的现场证据**：定格画面下轨迹只有一项（甚至为空）。多步 deck 上一动不动
   * 会在录制结束时 throw（见 recordWithCursorTrace）——降级最怕的"时长对、产物名对、日志对、
   * 画面是死的"假绿在这里被拦下。
   */
  cursorTrace: readonly { chapter: number; step: number }[];
}

// ── 纯函数（单测面） ──

/**
 * 裸 `?auto=1` 归一：**清掉基址带的一切 query**，只留 auto。
 *
 * 为什么不能"保留既有 query"（与 `withHeadless` 那种幂等叠加不同）：`?render=1` 与 `headless=1`
 * 都会摘掉自驱推进链（死因①），`?auto=1&render=1` 拼出来的会话就是个定格画面。渲染链的基址
 * `serve.url` 本身不带 query，但归一写在这里=**任何调用点都不可能漏**。
 */
export function realtimeUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.search = "";
  u.searchParams.set("auto", "1");
  return u.toString();
}

/** 录制 URL 的入口守卫（死因①的拦截点）：缺 auto、带 headless、带 render 三者都 throw。 */
export function assertRealtimeUrl(url: string): void {
  const u = new URL(url);
  if (u.searchParams.has("headless")) {
    throw new Error(
      `实时捕获 URL 不得带 headless（${url}）——App.tsx 的守卫会因此摘掉自驱推进链，` +
        `录出来是**冻在第 0 步的静止画面**（实测死因①）`,
    );
  }
  if (u.searchParams.has("render")) {
    throw new Error(
      `实时捕获 URL 不得带 render（${url}）——?render=1 下动画创建即冻结且推进链被摘掉，` +
        `录出来同样是定格画面（实测死因①）`,
    );
  }
  if (!u.searchParams.has("auto")) {
    throw new Error(
      `实时捕获 URL 必须带 ?auto=1（${url}）——页面靠它从第 0 步起播；` +
        `没有它游标停在起点，产物只有一帧`,
    );
  }
}

/** 产物路径：`<outDir>/<slug>.realtime.mp4`（尾部斜杠归一；"/" 手拼，与既有产物路径同款）。 */
export function realtimeOutputPath(outDir: string, slug: string): string {
  return `${outDir.replace(/[/\\]+$/, "")}/${slug}${REALTIME_SUFFIX}.mp4`;
}

/** 声明时长 = 时间轴总长（降级产物唯一的"应该多长"口径；实测读数另走 ffprobe）。 */
export function realtimeDeclaredMs(timeline: Timeline): number {
  return timeline.totalMs;
}

/** 录制窗口（ms）= 时间轴总长 + 尾部余量（页面装载/步间抖动；见文件头四步）。 */
export function realtimeRecordMs(timeline: Timeline): number {
  return timeline.totalMs + REALTIME_TAIL_MS;
}

/**
 * 录制 webm → 成片 mp4 的 ffmpeg 命令行（**一条命令**：转码 + mux）。
 *
 * 形状逐条有据：`-map 0:v:0` 显式选视频（webm 里可能另有数据流）；`-fps_mode cfr -r 30`
 * 把 25fps 的 VFR 录像重采样成与确定性成片同口径的定帧率；`-pix_fmt yuv420p` 是 h264 的
 * 播放器兼容底线；音轨走 `-c:a aac` 同规格（`AUDIO_SAMPLE_RATE`/`AUDIO_CHANNELS` 与 encode
 * 同源）；`-shortest` 收在较短一侧（视频按墙钟录得比音轨长）。`audioTrack === null` 时不加音轨
 * 输入也不加 `-shortest`（没有第二路可收）。
 */
export function buildRealtimeFfmpegArgs(opts: {
  video: string;
  audioTrack: string | null;
  output: string;
  /** 声明时长（`timeline.totalMs`）——产物在输出侧被 `-t` 收到它 */
  durationMs: number;
}): string[] {
  const withAudio = opts.audioTrack !== null;
  const args = ["-v", "error", "-i", opts.video];
  if (withAudio) args.push("-i", opts.audioTrack as string);
  args.push("-map", "0:v:0");
  if (withAudio) args.push("-map", "1:a:0");
  args.push(
    "-fps_mode", "cfr",
    "-r", String(REALTIME_FPS),
    "-c:v", "libx264",
    // 逃生舱要"快"：1080p 默认 preset 的编码时间是录制时长的数倍，降级路径等不起
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
  );
  if (withAudio) {
    args.push(
      "-c:a", "aac",
      "-ar", String(AUDIO_SAMPLE_RATE),
      "-ac", String(AUDIO_CHANNELS),
      "-shortest",
    );
  }
  // `-t` = 输出侧硬顶到**声明时长**：有音轨时 `-shortest` 已收在音轨那侧，两者一致；
  // **无音轨时它是唯一的上界**——录制窗口 = 声明 + 尾部余量 + 装载时间，不顶住就会出一条
  // 比 `declaredMs` 长一截的"无声超长片"（声明与产物对不上账）。
  args.push("-t", (opts.durationMs / 1000).toFixed(3));
  args.push(opts.output, "-y");
  return args;
}

// ── 浏览器侧（真机） ──

const DEFAULT_IO: RealtimeIo = { log: console.log, error: console.error };

/** 读游标（桥不可用时 null——不因观测面缺失把录制拖死；判据见 recordWithCursorTrace）。 */
async function readCursor(page: Page): Promise<{ chapter: number; step: number } | null> {
  try {
    return await page.evaluate(() => {
      const bridge = window.__presentation;
      if (!bridge) return null;
      return bridge.getState();
    });
  } catch {
    return null;
  }
}

/**
 * 定格判据（纯函数，单测面）：**有牙，但不误伤"窗口太短"**。
 *
 * 时长、产物名、日志三条在定格画面上**全部会绿**（两轮质检的实测结论），只有"游标轨迹"是
 * 画面真的在走的直接读数。但"没动"要判成"画面是死的"，前提是**窗口里本来就该动**：
 *
 *   · 单步 deck ⇒ 没有第二步可观测，不做判据（返回空）；
 *   · **一次观测都没有** ⇒ 只告警（桥不可用 = 观测面缺失 ≠ 画面是死的；逃生舱仍要出片）；
 *   · 观测窗口短于 `REALTIME_MIN_JUDGE_MS` ⇒ 只告警（`--only` 的子表可以短到几百 ms，"没动"
 *     与"还停在第 0 步/页面还没走到第 1 步"不可区分——评审 M1 的探针就踩这条）；
 *   · 以上都不成立、窗口够长却**一步未动** ⇒ fatal（拦截定格假绿）。
 *
 * 文案带现场读数（子表首步 / 观测窗口 / 观测次数）：判错时读者要能一眼看出是哪一类。
 */
export function judgeTrace(
  trace: readonly { chapter: number; step: number }[],
  recordMs: number,
  timeline: Timeline,
): { warn?: string; fatal?: string } {
  const first = timeline.steps[0];
  const where =
    `子表首步 章节 ${first?.chapter ?? "?"} 第 ${first?.step ?? "?"} 步（${first?.stepMs ?? 0}ms）· ` +
    `观测窗口 ${recordMs}ms · 观测 ${trace.length} 次：` +
    `${trace.map((s) => `章节 ${s.chapter} 第 ${s.step} 步`).join(" → ") || "（无）"}`;
  if (trace.length === 0) {
    return {
      warn:
        "[realtime] 录制期间**没有任何游标观测**（window.__presentation 桥不可用——页面不是 " +
        "dev server 供的，或桥被生产构建摘掉）——无法证明画面在走；产物按「未验证」读" +
        "（命名后缀与日志已标注降级）",
    };
  }
  if (timeline.steps.length <= 1) return {}; // 单步 deck：没有第二步可观测
  if (recordMs < REALTIME_MIN_JUDGE_MS) {
    return {
      warn:
        `[realtime] 观测窗口短于定格判据的下限 ${REALTIME_MIN_JUDGE_MS}ms（${where}）——"没动"与` +
        `"还停在第 0 步"不可区分，本次**不判定格**；产物按「未验证」读`,
    };
  }
  if (trace.length <= 1) {
    return {
      fatal:
        `实时捕获期间游标**一步都没动**（${where}）——产物多半是定格画面。两条实测死因：` +
        `① URL 带了 headless / render（自驱推进链被摘掉）；② 缺 --autoplay-policy=` +
        `no-user-gesture-required（play() 被策略拒——A 修复后它不再冻死，而是退化成**估时节奏**，` +
        `与 mux 进来的确定性音轨对不上）。宁炸不交一帧死画面`,
    };
  }
  return {};
}

/** 录 `recordMs` 墙钟，其间按 `REALTIME_SAMPLE_MS` 采样游标（去重后的顺序轨迹），末了交判据。 */
async function recordWithCursorTrace(
  page: Page,
  recordMs: number,
  timeline: Timeline,
  io: RealtimeIo,
): Promise<{ chapter: number; step: number }[]> {
  const trace: { chapter: number; step: number }[] = [];
  const deadline = Date.now() + recordMs;
  while (Date.now() < deadline) {
    const state = await readCursor(page);
    if (state !== null) {
      const last = trace[trace.length - 1];
      if (!last || last.chapter !== state.chapter || last.step !== state.step) trace.push(state);
    }
    await page.waitForTimeout(REALTIME_SAMPLE_MS);
  }
  const verdict = judgeTrace(trace, recordMs, timeline);
  if (verdict.warn !== undefined) io.error(verdict.warn);
  if (verdict.fatal !== undefined) throw new Error(verdict.fatal);
  return trace;
}

/**
 * 实时捕获降级：自开会话（裸 `?auto=1` + 自动播放放行）→ 录屏 → 落盘 → 转 mp4/30fps →
 * mux 确定性音轨 → `<slug>.realtime.mp4`。
 *
 * 失败即 throw（浏览器缺失给安装指引；定格轨迹见 recordWithCursorTrace）——**不留半份产物**：
 * 录到一半的 webm 在临时目录里，由本函数自己清掉。
 */
export async function captureRealtime(opts: RealtimeOptions): Promise<RealtimeResult> {
  assertRealtimeUrl(opts.url);
  const io = opts.io ?? DEFAULT_IO;
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const ffprobePath = opts.ffprobePath ?? "ffprobe";

  const output = realtimeOutputPath(opts.outDir, opts.slug);
  const declaredMs = realtimeDeclaredMs(opts.timeline);
  const recordMs = realtimeRecordMs(opts.timeline);
  const audioTrack = opts.audioTrack;

  if (audioTrack === null) {
    // 明写：降级链路里"没有音轨可 mux"是个**事实**，不是可以悄悄略过的细节
    io.log(
      "[realtime] 本次降级产物无声——确定性链路的音轨编码未产出（capture/encode 先失败），" +
        "没有 audio.m4a 可 mux",
    );
  }

  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({
      args: opts.softwareGL === true ? [...REALTIME_LAUNCH_ARGS, ...SOFTWARE_GL_ARGS] : [...REALTIME_LAUNCH_ARGS],
    });
  } catch (e) {
    // 与其他管线同款：浏览器缺失 → 安装指引；其余原样抛（保留真因）
    if (isMissingBrowserError(e)) throw chromiumMissingError(e);
    throw e;
  }

  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), "realtime-video-"));
  let trace: { chapter: number; step: number }[] = [];
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: opts.viewport.width, height: opts.viewport.height },
      deviceScaleFactor: 1,
      // size 必须逐字给：不传会缩到 800×450（实测）
      recordVideo: { dir: videoDir, size: { width: opts.viewport.width, height: opts.viewport.height } },
    });
    const page = await context.newPage();
    const video = page.video();
    if (video === null) {
      throw new Error(
        "实时捕获：录制会话没有 video 句柄（recordVideo 未生效）——检查 newContext 的 recordVideo.size",
      );
    }
    io.log(
      `[realtime] 录制会话（真播放 + 录屏）：${opts.url} · 视口 ${opts.viewport.width}×${opts.viewport.height} · ` +
        `窗口 ${(recordMs / 1000).toFixed(3)}s（声明 ${declaredMs}ms + 尾部 ${REALTIME_TAIL_MS}ms）· ` +
        `args ${JSON.stringify([...REALTIME_LAUNCH_ARGS])}`,
    );
    await page.goto(opts.url);
    trace = await recordWithCursorTrace(page, recordMs, opts.timeline, io);
    await context.close(); // 录像写完才拿得到路径
    const webm = await video.path();

    fs.mkdirSync(path.dirname(output), { recursive: true });
    runFfmpeg(buildRealtimeFfmpegArgs({ video: webm, audioTrack, output, durationMs: declaredMs }), ffmpegPath);
  } finally {
    // 收尾全在一个 finally 里：**定格判据 throw / video 句柄缺失 / ffmpeg 失败** 都覆盖——
    // 录像只在临时目录里过一趟（产物已 mp4 化），半截 webm 不该留在 /tmp（评审 M2）。
    // 顺序：先关（录像写完、句柄释放）再删——反过来的话浏览器还在往被删掉的目录里写。
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    fs.rmSync(videoDir, { recursive: true, force: true });
  }
  const durationMs = probeDurationMs(output, ffprobePath);

  io.log(
    `[realtime] 产物：${output}（声明 ${declaredMs}ms · 实测 ${durationMs}ms · ${REALTIME_FPS}fps · ` +
      `${audioTrack === null ? "无声" : "含确定性音轨"} · 游标轨迹 ` +
      `${trace.map((s) => `章节 ${s.chapter} 第 ${s.step} 步`).join(" → ") || "（无观测）"}）`,
  );

  return { file: output, declaredMs, durationMs, cursorTrace: trace };
}
