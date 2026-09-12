/**
 * verify.browser.test.ts（M5a Task 6）：自校验的**真机臂**——对一份真产物（真 Chromium 渲帧 +
 * 真 ffmpeg 出片）跑 `verifyRender`，再逐条反证它的判据是活的。
 *
 * 为什么必须真机：本文件取证的是"§8.1 的渲染产物自校验**真的能抓故障**"这句话本身。
 * 纯函数面（verify.test.ts）证的是判据的算术；这里证的是**判据接在真产物上还有没有信号**——
 * 视频内容边界的跳变峰值、音轨与理想波形的样本级对齐、跨会话重采的逐字节一致，三者都只有
 * 真 Chromium + 真 ffmpeg 才拿得到。故本文件不手写任何中间产物：mock 音轨 → 窗口预扫 →
 * 时间轴表 → 帧流（93 帧）→ 出片，与 T5 的真机臂同一条链。
 *
 * 四条判据：
 *   1. **正臂**：verifyRender(真产物).ok === true，且读数逐条贴出来（报告要的是读数，不是"绿了"）；
 *   2. **负臂 A（帧目录）**：篡改一张**被采样到的** PNG（1 字节）→ 必须红（跨会话同刻重采那条）；
 *   3. **负臂 B（清单）**：去掉 concat 清单末尾的重复行 → 重出片 → 必须红（成片比音轨短、
 *      `-shortest` 把音轨截掉，T5 实测 6.100000 / 183 帧）；
 *   4. **负臂 C（恒定 A/V 偏移）**：音轨整体晚 100ms（首段补静音、尾部同长截掉）→ **总时长 /
 *      帧数 / 帧率三条全绿而音轨边界条红**——这条正是"边界断言是唯一护栏"的证明。
 *
 * 环境约定（照抄 encode.browser.test.ts 的文件头，见其说明）：本文件跑在 jsdom；**不得**写出
 * environment 标记字面量（vitest 全文扫描含注释）；playwright 的 Node 侧入口缺 `TransformStream`
 * → 先补全局；`startServe` 会在本进程里加载 Vite → esbuild 要求**本 realm** 的 Uint8Array。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chapters } from "../../src/chapters/manifest";
import { withRenderMode } from "../check/headless";
import { startServe, type ServeHandle } from "../check/serve";
import { hasAudio } from "../storyboard/data";
import { AUDIO_DIR, synthesizeMockAudio } from "./audio";
import {
  AUDIO_TRACK_NAME,
  CONCAT_LIST_NAME,
  VIDEO_TRACK_NAME,
  encodeVideo,
  runFfmpeg,
} from "./encode";
import { captureFrames, type FrameSpec } from "./frames";
import { buildTimeline, type Timeline } from "./timeline";
import { sampledFrames, verifyRender, type RenderVerifyReport } from "./verify";
import { scanAnimationWindows } from "./window-scan";

// ── 环境补齐（必须在任何 startServe / openSession 之前；见文件头） ──

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

const tmpDirs: string[] = [];

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `verify-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

/** 独立读数（与被测代码无关的一条通路：ffprobe 直接看产物）。 */
function probe(file: string): { durationMs: number; frames: number; rate: string; audioMs: number } {
  const json = JSON.parse(
    execFileSync(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_type,nb_frames,r_frame_rate,duration", "-of", "json", file],
      { encoding: "utf8" },
    ),
  ) as { format: { duration: string }; streams: Array<Record<string, string>> };
  const video = json.streams.find((s) => s.codec_type === "video")!;
  const audio = json.streams.find((s) => s.codec_type === "audio")!;
  return {
    durationMs: Number.parseFloat(json.format.duration) * 1000,
    frames: Number.parseInt(video.nb_frames, 10),
    rate: video.r_frame_rate,
    audioMs: Number.parseFloat(audio.duration) * 1000,
  };
}

/** 把报告逐行打到测试输出（报告要的是读数，不是"绿了"）。 */
function dump(label: string, report: RenderVerifyReport): void {
  console.log(`\n[verify ${label}] ok=${report.ok}`);
  for (const line of report.lines) console.log(`  ${line}`);
}

let serve: ServeHandle | undefined;
let url = "";
let repoRoot = "";
let outDir = "";
let output = "";
let timeline: Timeline;
let capturedFrameCount = 0;
let firstReport: RenderVerifyReport;

beforeAll(async () => {
  serve = await startServe();
  url = withRenderMode(serve.url); // 渲染态（T7 同款）
  repoRoot = tempDir("repo");
  outDir = tempDir("render");

  // 1) 音轨（真 ffmpeg）→ 2) 时间轴表（真窗口预扫 + 真 durations）→ 3) 帧流（真 Chromium）
  const audio = await synthesizeMockAudio({ chapters, repoRoot });
  const scan = await scanAnimationWindows({ url, chapters });
  const durations = JSON.parse(fs.readFileSync(path.join(repoRoot, audio.durationsFile), "utf8"));
  timeline = buildTimeline({
    chapters,
    durations,
    timings: { example: chapters[0].timing },
    animMsByStep: scan.animMsByStep,
  });
  const specs: FrameSpec[] = timeline.steps.map((s) => ({
    chapter: s.chapter,
    step: s.step,
    chapterId: s.chapterId,
  }));
  const captured = await captureFrames(specs, { url, outDir, timeline, concurrency: 2 });
  capturedFrameCount = captured.reduce((n, c) => n + c.frameCount, 0);

  // 4) 出片
  const folder = chapters[0].folder;
  const segments = timeline.steps.map((s) => ({
    mp3: hasAudio(chapters[s.chapter].narrations[s.step])
      ? path.join(repoRoot, AUDIO_DIR, folder, `${s.step}.mp3`)
      : null,
    stepMs: s.stepMs,
  }));
  output = path.join(outDir, "example.mp4");
  await encodeVideo({
    outDir,
    output,
    captured,
    segments,
    stepMsByStep: timeline.steps.map((s) => s.stepMs),
    fps: timeline.fps,
  });
}, 900_000);

afterAll(async () => {
  await serve?.stop();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** 复用的校验调用（正臂与各负臂共用；viewport/softwareGL 与 captureFrames 相同）。 */
function verify(file: string, segments: readonly { mp3: string | null; stepMs: number }[]) {
  return verifyRender({ output: file, outDir, timeline, url, segments, ffmpegPath: FFMPEG, ffprobePath: FFPROBE });
}

describe("自校验真机臂", () => {
  it("正臂：真产物全绿，读数逐条（时长/帧数/帧率/音轨总长/PNG 数/视频边界/音轨边界/跨会话重采）", async () => {
    const folder = chapters[0].folder;
    const segments = timeline.steps.map((s) => ({
      mp3: hasAudio(chapters[s.chapter].narrations[s.step])
        ? path.join(repoRoot, AUDIO_DIR, folder, `${s.step}.mp3`)
        : null,
      stepMs: s.stepMs,
    }));

    firstReport = await verify(output, segments);
    dump("正臂", firstReport);

    expect(firstReport.ok).toBe(true);
    expect(firstReport.failures).toEqual([]);
    // 读数面：三条总量 + PNG 口径 + 两类边界 + 跨会话重采都在（不是"只要 ok 就完事"）
    const text = firstReport.lines.join("\n");
    expect(text).toContain(`Σ frameCount = ${capturedFrameCount}`); // 93
    expect(text).toMatch(/视频内容边界 .*→.*：实测/);
    expect(text).toMatch(/音轨边界 步 .* 起 @\d+ms：实测/);
    expect(text).toContain("逐字节相符");
  }, 900_000);

  it("负臂 A：篡改帧目录一张**被采样到的** PNG（1 字节）→ 跨会话同刻重采那条必须红", async () => {
    const point = sampledFrames(timeline)[1]; // 步 0 的静置末帧（frame 0091.png）
    const file = path.join(outDir, "frames", point.chapterId, String(point.step), `${String(point.index + 1).padStart(4, "0")}.png`);
    const original = fs.readFileSync(file);
    const doctored = Buffer.from(original);
    doctored[Math.floor(doctored.length / 2)] ^= 0xff; // 翻一个字节
    fs.writeFileSync(file, doctored);
    try {
      const folder = chapters[0].folder;
      const segments = timeline.steps.map((s) => ({
        mp3: hasAudio(chapters[s.chapter].narrations[s.step])
          ? path.join(repoRoot, AUDIO_DIR, folder, `${s.step}.mp3`)
          : null,
        stepMs: s.stepMs,
      }));
      const report = await verify(output, segments);
      dump("负臂 A（篡改 1 字节）", report);
      expect(report.ok).toBe(false);
      expect(report.failures.join("\n")).toMatch(/跨会话重采 .*md5/);
    } finally {
      fs.writeFileSync(file, original); // 还原
    }
  }, 900_000);

  it("负臂 B：去掉清单末尾的重复行 → 重出片 → 时长/帧数/音轨长必须红（T5 实测 6.100000 / 183）", async () => {
    const folder = chapters[0].folder;
    const segments = timeline.steps.map((s) => ({
      mp3: hasAudio(chapters[s.chapter].narrations[s.step])
        ? path.join(repoRoot, AUDIO_DIR, folder, `${s.step}.mp3`)
        : null,
      stepMs: s.stepMs,
    }));

    // 篡改：清单末行（收尾重复行，无 duration）删掉 —— 末步的静置时长整体丢失。
    // ⚠️ 清单里的帧路径是**相对清单文件所在目录**解析的（T5 的清单就落在 outDir 根），
    // 故篡改版必须写回 outDir（写到别处 ffmpeg 会报 "Impossible to open …/frames/…"）
    const listPath = path.join(outDir, CONCAT_LIST_NAME);
    const lines = fs.readFileSync(listPath, "utf8").trimEnd().split("\n");
    const tampered = tempDir("tampered-list");
    const tamperedList = path.join(outDir, "concat-tampered.txt");
    fs.writeFileSync(tamperedList, `${lines.slice(0, -1).join("\n")}\n`);

    // 视频轨重出（命令与 encodeVideo 的视频那一步同形）+ 重 mux：产物比音轨短，-shortest 截掉音轨尾
    const video = path.join(tampered, VIDEO_TRACK_NAME);
    runFfmpeg(
      ["-v", "error", "-f", "concat", "-safe", "0", "-i", tamperedList, "-fps_mode", "cfr", "-r", String(timeline.fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", video, "-y"],
      FFMPEG,
    );
    const tamperedOutput = path.join(tampered, "example-no-dupline.mp4");
    runFfmpeg(["-v", "error", "-i", video, "-i", path.join(outDir, AUDIO_TRACK_NAME), "-c", "copy", "-shortest", tamperedOutput, "-y"], FFMPEG);

    const p = probe(tamperedOutput);
    console.log(`\n[负臂 B 产物读数] duration=${p.durationMs.toFixed(1)}ms 视频帧数=${p.frames} 音轨=${p.audioMs.toFixed(1)}ms`);
    expect(p.durationMs).toBeLessThan(timeline.totalMs - 1000); // 确实短了一截（不是"改了但没变"）

    const report = await verify(tamperedOutput, segments);
    dump("负臂 B（去末重复行）", report);
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toMatch(/成片时长/);
    expect(report.failures.join("\n")).toMatch(/音轨时长/);
  }, 900_000);

  it("负臂 C：音轨整体晚 100ms（总长不变）→ 时长/帧数/帧率三条全绿、音轨边界必须红", async () => {
    const folder = chapters[0].folder;
    const segments = timeline.steps.map((s) => ({
      mp3: hasAudio(chapters[s.chapter].narrations[s.step])
        ? path.join(repoRoot, AUDIO_DIR, folder, `${s.step}.mp3`)
        : null,
      stepMs: s.stepMs,
    }));

    // 音轨整体平移 100ms：首段补静音 + 尾部同长截掉 ⇒ **容器总时长不变**（这正是要点）
    const shiftedDir = tempDir("shifted");
    const shiftedAudio = path.join(shiftedDir, AUDIO_TRACK_NAME);
    const totalSec = (timeline.totalMs / 1000).toFixed(6);
    runFfmpeg(
      ["-v", "error", "-i", path.join(outDir, AUDIO_TRACK_NAME), "-af", `adelay=100|100,atrim=0:${totalSec}`, "-c:a", "aac", "-ar", "48000", "-ac", "2", shiftedAudio, "-y"],
      FFMPEG,
    );
    const shiftedOutput = path.join(shiftedDir, "example-audio-late100.mp4");
    runFfmpeg(["-v", "error", "-i", path.join(outDir, VIDEO_TRACK_NAME), "-i", shiftedAudio, "-c", "copy", "-shortest", shiftedOutput, "-y"], FFMPEG);

    const p = probe(shiftedOutput);
    // 前提交代：总量三项**看不出**这个偏移（差在 1 帧/~3 帧/~2 AAC 帧的容差内）
    const base = probe(output);
    expect(Math.abs(p.durationMs - timeline.totalMs)).toBeLessThanOrEqual(1000 / timeline.fps);
    expect(Math.abs(p.frames - base.frames)).toBeLessThanOrEqual(3);

    const report = await verify(shiftedOutput, segments);
    dump("负臂 C（音轨晚 100ms）", report);
    expect(report.ok).toBe(false);
    const failures = report.failures.join("\n");
    expect(failures).toMatch(/音轨边界/);
    // **判据的分野**：总量三条一条都不许红——偏移在它们眼里不存在
    expect(failures).not.toMatch(/成片时长/);
    expect(failures).not.toMatch(/视频帧数/);
    expect(failures).not.toMatch(/视频帧率/);
  }, 900_000);
});
