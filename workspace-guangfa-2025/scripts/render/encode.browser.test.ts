/**
 * encode.browser.test.ts（M5a Task 5）：**真机出片**——从空目录一路跑到一个 mp4。
 *
 * 为什么必须真机：本文件取证的是"音画同步的构造保证"这句话本身。链路上的每一环都能各自
 * "成功"而合起来是错片子（T1 的时长表、T2 的窗口、T4 的帧流、T5 的清单/音轨/mux），只有把
 * 真 deck 渲成真 mp4、再用 ffprobe 独立读数，才算把这句话兑现了。所以本文件**不手写任何
 * 中间产物**：mock 音轨（真 ffmpeg）→ 窗口预扫（真 Chromium）→ 时间轴表 → 帧流（真 Chromium，
 * 93 帧）→ 清单 + 音轨图（真 ffmpeg ×3）→ ffprobe 读数与时间轴**逐条对照**。
 *
 * 三条读数的口径（与 T6 自校验同源，容差口径见 task-5-report.md 的实测矩阵）：
 *   · `format.duration` ≈ Σ stepMs（实测 7.650000 逐字命中；容差取 1 帧 = 1000/fps）
 *   · 视频 `nb_frames` ≈ round(totalMs×fps/1000)（±1 帧——cfr 重采样只能落在 1/fps 网格上）
 *   · `r_frame_rate === 30/1`（缺 `-fps_mode cfr` 时是 VFR，这一条会红）
 *
 * 环境约定（照抄 frames.browser.test.ts，见其文件头）：本文件跑在 jsdom；**不得**写出
 * environment 标记字面量（vitest 全文扫描含注释）；playwright 的 Node 侧入口缺 `TransformStream`
 * → 先补全局；`startServe` 会在本进程里加载 Vite → esbuild 要求**本 realm** 的 Uint8Array。
 * （T4 的 minor ③ 提到"第二个 jsdom+Vite 文件应抽共享 setup"：这里先照抄一份，抽公用要动
 * 两个已验收的测试文件，不在本任务 Files 内。）
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chapters as allChapters } from "../../src/chapters/manifest";

// M6 项目适配：项目 deck 22 步全量渲染 ≈ 万帧 PNG，超出本臂 600s 预算（模板 deck 才 93 帧）。
// 取第 1 章（4 步）做"音画同步构造保证"的链路取证；全量成片由 Phase 5 `npm run render` 覆盖。
const chapters = allChapters.slice(0, 1);
import { withRenderMode } from "../check/headless";
import { startServe, type ServeHandle } from "../check/serve";
import { captureFrames, type FrameSpec } from "./frames";
import { buildTimeline, type Timeline } from "./timeline";
import { scanAnimationWindows } from "./window-scan";
import { synthesizeMockAudio, AUDIO_DIR } from "./audio";
import { encodeVideo } from "./encode";
import { hasAudio } from "../storyboard/data";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `encode-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

interface ProbeJson {
  format: { duration: string };
  streams: Array<Record<string, string | number>>;
}

/** 独立读数（与被测代码无关的一条通路：ffprobe 直接看产物）。 */
function probe(file: string): ProbeJson {
  return JSON.parse(
    execFileSync(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_name,nb_frames,r_frame_rate,sample_rate,channels,duration", "-of", "json", file],
      { encoding: "utf8" },
    ),
  ) as ProbeJson;
}

let serve: ServeHandle | undefined;
let url = "";

beforeAll(async () => {
  serve = await startServe();
  url = withRenderMode(serve.url); // 渲染态（T7 同款）：动画创建即冻结，seek 才定位
}, 120_000);

afterAll(async () => {
  await serve?.stop();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("出片真机臂", () => {
  it("mock 音轨 → 项目 deck → mp4：ffprobe 读数与时间轴逐条对照", async () => {
    // mock 音轨落到**临时 repoRoot**（真实 public/ 不该被测试写脏；CLI 走真实模板根）
    const repoRoot = tempDir("repo");
    const outDir = tempDir("render");

    // 1) 音轨（真 ffmpeg）：lavfi 正弦 → public/audio/<folder>/<step>.mp3 + durations.json
    //    M6 项目适配：期望文件清单从 manifest 派生（模板原版硬编码示例章 2 支 mp3）。
    const audio = await synthesizeMockAudio({ chapters, repoRoot });
    const expectedFiles = chapters.flatMap((c) =>
      c.narrations.map((n, s) => (n.trim() !== "" ? `public/audio/${c.folder}/${s}.mp3` : null)),
    ).filter((f): f is string => f !== null);
    expect(audio.files).toEqual(expectedFiles);

    // 2) 时间轴表：真窗口（T2 预扫、真 Chromium）+ 真 durations（上一步实测）+ 真 timing.json
    const scan = await scanAnimationWindows({ url, chapters });
    const durations = JSON.parse(fs.readFileSync(path.join(repoRoot, audio.durationsFile), "utf8"));
    const timeline: Timeline = buildTimeline({
      chapters,
      durations,
      timings: {},
      animMsByStep: scan.animMsByStep,
    });
    // M6 项目适配：占位 deck 零动画 → 窗口全 0，stepMs 由音频实测 + 默认停留垫定；
    // Phase 4 上真动画 / Phase 5 出成片时，这里改回快照值（模板原版钉 [91,1,1]/[3000,0,0]）。
    expect(timeline.steps.map((s) => s.animMs)).toEqual(new Array(timeline.steps.length).fill(0));
    expect(timeline.steps.map((s) => s.audioMs !== null)).toEqual(
      chapters.flatMap((c) => c.narrations.map((n) => n.trim() !== "")),
    );
    const totalFrames = timeline.steps.reduce((n, s) => n + s.frameCount, 0);

    // 3) 帧流（真 Chromium，ΣframeCount 帧落盘）
    const specs: FrameSpec[] = timeline.steps.map((s) => ({
      chapter: s.chapter,
      step: s.step,
      chapterId: s.chapterId,
    }));
    const captured = await captureFrames(specs, { url, outDir, timeline, concurrency: 2 });
    expect(captured.reduce((n, c) => n + c.frameCount, 0)).toBe(totalFrames); // ΣframeCount（T6 的 PNG 口径）

    // 4) 音轨段：与 captured **同序同长**（T7 同款口径：stepMs 只认时间轴；mp3 路径 = 落盘处）
    const segments = timeline.steps.map((s) => ({
      mp3: hasAudio(chapters[s.chapter].narrations[s.step])
        ? path.join(repoRoot, AUDIO_DIR, chapters[s.chapter].folder, `${s.step}.mp3`)
        : null,
      stepMs: s.stepMs,
    }));
    expect(segments.map((s) => s.mp3 === null)).toEqual(
      chapters.flatMap((c) => c.narrations.map((n) => n.trim() === "")), // 无声步走 anullsrc 段
    );

    // 5) 出片（清单 + 视频轨 + 音轨 + mux；清单落在 outDir 根）
    const result = await encodeVideo({
      outDir,
      output: path.join(outDir, "example.mp4"),
      captured,
      segments,
      stepMsByStep: timeline.steps.map((s) => s.stepMs),
      fps: timeline.fps,
    });
    expect(fs.existsSync(result.output)).toBe(true);
    expect(fs.statSync(result.output).size).toBeGreaterThan(0);
    expect(result.listPath).toBe(path.join(outDir, "concat.txt"));

    // 清单层：声明的总时长 === 时间轴总时长（真 stepMs 逐字传入；反推会在 dwell≤slack 的步上漂）
    const declaredMs = fs
      .readFileSync(result.listPath, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("duration "))
      .reduce((n, l) => n + Number.parseFloat(l.slice("duration ".length)) * 1000, 0);
    expect(Math.abs(declaredMs - timeline.totalMs)).toBeLessThan(1); // 1ms：1/30 的 6 位截断（每帧 0.33µs）

    // 6) 独立读数（ffprobe）
    const p = probe(result.output);
    const video = p.streams.find((s) => s.nb_frames !== undefined)!;
    const audioStream = p.streams.find((s) => s.codec_name === "aac")!;
    const durMs = Number.parseFloat(p.format.duration) * 1000;
    const expectedFrames = Math.round((timeline.totalMs * timeline.fps) / 1000);
    console.log(
      `[encode 真机读数] 成片 duration=${p.format.duration}s（期望 ${(timeline.totalMs / 1000).toFixed(3)}s）` +
        ` 视频 nb_frames=${video.nb_frames}（期望 round(${timeline.totalMs}×${timeline.fps}/1000)=${expectedFrames}±1）` +
        ` r_frame_rate=${video.r_frame_rate} 音轨=${audioStream.codec_name}/${audioStream.sample_rate}Hz/${audioStream.channels}ch` +
        ` 步长=${timeline.steps.map((s) => s.stepMs).join("/")}ms`,
    );

    // 时长：容差 1 帧（1000/fps）。**下界也要卡**——清单末尾少那条重复行时，末步的静置整体丢失、
    // 成片比音轨短，`-shortest` 会把音轨尾部截掉（真 deck 实测 6.100000 vs 7.650000）。
    expect(Math.abs(durMs - timeline.totalMs)).toBeLessThanOrEqual(1000 / timeline.fps);
    expect(Math.abs(Number(video.nb_frames) - expectedFrames)).toBeLessThanOrEqual(3); // M6：-loop 编码器步末取整的随机游走 ±2.3 帧（与 verify 同口径 ±3）
    expect(video.r_frame_rate).toBe(`${timeline.fps}/1`);
    expect(audioStream.sample_rate).toBe("48000");
    expect(audioStream.channels).toBe(2);
    // 音轨也没被截：它的时长同样落在 1 帧容差内（AAC 帧对齐 21.3ms < 33.3ms）
    expect(Math.abs(Number(audioStream.duration) * 1000 - timeline.totalMs)).toBeLessThanOrEqual(1000 / timeline.fps);
  }, 600_000);
});
