/**
 * realtime.browser.test.ts（M5b Task 4）：实时捕获降级的**真机臂**（真 Vite + 真 Chromium +
 * 真录屏 + 真 ffmpeg 转码/mux）。
 *
 * 为什么必须真机：本文件取证的是"**录出来的画面真的在走**"这句话——而"时长对 + 产物名带后缀 +
 * 日志有原因"这三条判据在**冻在第 0 步的定格画面**上**全部会绿**（两轮质检的实测结论）。
 * 故这里只认真机读数，且带一条有牙的判据：**首/中/末帧 md5 两两不同**。
 *
 * 三条读数：
 *   1. **裸 `?auto=1` 会话里游标真的前进**（`cursorTrace` 观测到 s0 → s1）——自驱推进链没被
 *      headless/render 摘掉，`audio.play()` 也没被自动播放策略拒（`REALTIME_LAUNCH_ARGS`）；
 *   2. **产物 mp4 首/中/末帧 md5 两两不同**（防"定格画面假绿"的唯一判据；只判时长在恒帧上恒真）；
 *   3. 命名/时长/音轨：`<slug>.realtime.mp4`、声明时长 = `timeline.totalMs`、实测时长与之对得上、
 *      mux 后产物**真的有音轨流**（降级不失声——I3）。
 *
 * 环境约定（逐条照抄 frames.browser.test.ts 踩平的坑，别绕过）：
 *   · 本文件跑在 jsdom（vitest 的 setupFiles 是全局的）；**不得**在文件任何位置写出
 *     environment 标记字面量——vitest 全文扫描（含注释）；
 *   · playwright 的 Node 侧入口在 jsdom 里缺 `TransformStream` → 先补全局再让它加载；
 *   · `startServe` 会在本进程里加载 Vite → esbuild，esbuild 的 invariant 要求
 *     `new TextEncoder().encode("") instanceof Uint8Array` 用**本 realm** 的 Uint8Array（见下）。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chapters } from "../../src/chapters/manifest";
import { stageConfig } from "../../src/engine/runtime-config";
import { withRenderMode } from "../check/headless";
import { startServe, type ServeHandle } from "../check/serve";
import { synthesizeMockAudio } from "./audio";
import { runFfmpeg } from "./encode";
import { captureRealtime, realtimeOutputPath, realtimeUrl, type RealtimeResult } from "./realtime";
import { buildTimeline, type Timeline } from "./timeline";
import { scanAnimationWindows } from "./window-scan";

// ── 环境补齐（必须在任何 startServe / chromium 之前；见文件头） ──

/** 跨 realm 的 esbuild invariant：encode 的返回值须由**本 realm** 的 Uint8Array 构造。 */
class RealmTextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    const src = super.encode(input);
    const out = new Uint8Array(src.length); // 长度重载 → 普通 ArrayBuffer 背板（本 realm）
    out.set(src);
    return out;
  }
}
(globalThis as { TextEncoder?: unknown }).TextEncoder = RealmTextEncoder;
(globalThis as { TextDecoder?: unknown }).TextDecoder = NodeTextDecoder;
(globalThis as { TransformStream?: unknown }).TransformStream ??= NodeTransformStream;

// ── 夹具 ──

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

const tmpDirs: string[] = [];

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `realtime-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

function md5(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/** 抽一帧（`-ss` 在 `-i` 前 = 输入侧定位）→ 落 PNG 的 md5。 */
function frameMd5(file: string, ms: number, outDir: string, tag: string): string {
  const png = path.join(outDir, `frame-${tag}.png`);
  execFileSync(FFMPEG, [
    "-v", "error",
    "-ss", (ms / 1000).toFixed(3),
    "-i", file,
    "-frames:v", "1",
    png,
    "-y",
  ]);
  return md5(png);
}

/** 独立读数（与被测代码无关的一条通路：ffprobe 直接看产物）。 */
function probeOutput(file: string): { durationMs: number; hasVideo: boolean; hasAudio: boolean; audioMs: number } {
  const json = JSON.parse(
    execFileSync(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", file],
      { encoding: "utf8" },
    ),
  ) as { format: { duration: string }; streams: Array<Record<string, string>> };
  const video = json.streams.find((s) => s.codec_type === "video");
  const audio = json.streams.find((s) => s.codec_type === "audio");
  return {
    durationMs: Number.parseFloat(json.format.duration) * 1000,
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    audioMs: audio ? Number.parseFloat(audio.duration) * 1000 : 0,
  };
}

let serve: ServeHandle | undefined;
let repoRoot = "";
let outDir = "";
let timeline: Timeline;
let audioTrack = "";

beforeAll(async () => {
  repoRoot = tempDir("repo");
  outDir = tempDir("out");
  serve = await startServe();

  // 与渲染链同源的一次组装：mock 音轨（真 mp3 + 实测 durations）→ 窗口预扫 → 时间轴表
  const audio = await synthesizeMockAudio({ chapters, repoRoot });
  const scan = await scanAnimationWindows({ url: withRenderMode(serve.url), chapters });
  const durations = JSON.parse(fs.readFileSync(path.join(repoRoot, audio.durationsFile), "utf8"));
  timeline = buildTimeline({
    chapters,
    durations,
    timings: { example: chapters[0].timing },
    animMsByStep: scan.animMsByStep,
    profileHoldMs: stageConfig.holdMs,
  });
  console.log(
    `\n[realtime 夹具] 时间轴 Σ ${timeline.steps.map((s) => s.stepMs).join(" + ")} = ${timeline.totalMs}ms` +
      `（录制窗口 ${(timeline.totalMs + 1200) / 1000}s）`,
  );

  // 确定性音轨的替身：与 encode 出的 audio.m4a 同规格（aac / 48k / 立体声），长度 = 声明时长。
  // 真机臂就此**不**依赖整条确定性编码链（那要 93 帧 + 出片），只依赖"有一路真音轨可 mux"。
  audioTrack = path.join(outDir, "audio.m4a");
  runFfmpeg(
    [
      "-v", "error",
      "-f", "lavfi",
      "-i", "anullsrc=r=48000:cl=stereo",
      "-t", (timeline.totalMs / 1000).toFixed(3),
      "-c:a", "aac",
      "-ar", "48000",
      "-ac", "2",
      audioTrack,
      "-y",
    ],
    FFMPEG,
  );
}, 900_000);

afterAll(async () => {
  await serve?.stop();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("实时捕获真机臂", () => {
  it("裸 ?auto=1 会话里游标真的前进（s0 → s1），录出的 mp4 首/中/末帧两两不同", async () => {
    const lines: string[] = [];
    const errors: string[] = [];
    const res: RealtimeResult = await captureRealtime({
      url: realtimeUrl(serve!.url), // 裸 ?auto=1（headless/render 会被 assertRealtimeUrl 当场拦）
      outDir,
      slug: "example",
      timeline,
      audioTrack,
      viewport: stageConfig.dims,
      io: { log: (l) => void lines.push(l), error: (l) => void errors.push(l) },
      ffmpegPath: FFMPEG,
      ffprobePath: FFPROBE,
    });
    for (const l of lines) console.log(`  ${l}`);

    // ① 游标**真的前进**（录制会话内的现场观测——定格画面上这条必然失败）
    console.log(`[realtime 游标轨迹] ${JSON.stringify(res.cursorTrace)}`);
    expect(res.cursorTrace[0]).toEqual({ chapter: 0, step: 0 });
    expect(res.cursorTrace.some((s) => s.chapter === 0 && s.step === 1)).toBe(true);
    expect(res.cursorTrace.length).toBeGreaterThan(1);

    // ② 首/中/末帧 md5 两两不同（防定格画面假绿的唯一判据：只判时长在恒帧上恒真）
    const first = frameMd5(res.file, 0, outDir, "first");
    const mid = frameMd5(res.file, res.durationMs / 2, outDir, "mid");
    const last = frameMd5(res.file, res.durationMs - 150, outDir, "last");
    console.log(`[realtime 帧 md5] 首 ${first}\n                  中 ${mid}\n                  末 ${last}`);
    expect(new Set([first, mid, last]).size).toBe(3); // 两两不同

    // ③ 命名 / 声明时长 / 实测 / 音轨（降级不失声）
    expect(res.file).toBe(realtimeOutputPath(outDir, "example"));
    expect(res.file).toContain(".realtime.mp4");
    expect(res.declaredMs).toBe(timeline.totalMs);
    const probe = probeOutput(res.file);
    console.log(
      `[realtime 产物读数] duration=${probe.durationMs.toFixed(1)}ms 声明=${res.declaredMs}ms ` +
        `ffprobe=${res.durationMs.toFixed(1)}ms 音轨=${probe.audioMs.toFixed(1)}ms ${probe.hasAudio ? "含音轨" : "无音轨"}`,
    );
    expect(probe.hasVideo).toBe(true);
    expect(probe.hasAudio).toBe(true); // mux 真的接上了（I3：降级不得失声）
    expect(Math.abs(res.durationMs - res.declaredMs)).toBeLessThan(300);
    expect(lines.join("\n")).toContain("含确定性音轨");
    expect(errors).toEqual([]);
  }, 900_000);
});
