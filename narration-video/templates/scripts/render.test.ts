// M5a Task 7 单测：`npm run render` 的 CLI 面——参数解析（用法错误的载体）、子时间轴
// （`--only` 与 timeline/encode/verify 的联动）、音频段装配（音画同源的输入面）、
// 每步进度行、编排顺序与"无音频明示"。
//
// 真机臂（自起 Vite + Chromium + ffmpeg 出片）不在此处：那是 `npm run render --mock-audio`
// 的收口冒烟与 T4/T5/T6 三个 *.browser.test.ts 的事务。本文件钉住的是**接线**——
// 三段联动（帧流 / 编码 / 自校验）的取值来源必须是**同一张（子）时间轴表**，
// 以及"用法错误不得静默"的纪律（未知 flag → 退出码 2 的载体）。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { EncodeOptions, EncodeResult } from "./render/encode";
import type { CaptureFramesOptions, CapturedStep, FrameSpec } from "./render/frames";
import type { Timeline, TimelineStep } from "./render/timeline";
import { sampledFrames } from "./render/verify";
import {
  DEFAULT_OUT_DIR,
  RENDER_USAGE,
  RenderUsageError,
  assertAudioDurationAlignment,
  assertWindowTableShape,
  buildAudioSegments,
  determinismPairs,
  parseArgs,
  renderCli,
  runRender,
  selectTimeline,
  stepLine,
  type RenderArgs,
  type RenderChapter,
  type RenderDeps,
  type RenderIo,
} from "./render";

// ── 夹具 ──

/** 模板 example 章节的实况（T1/T5/T6 的同一条算例）：step 0 带 KenBurns、step 2 无声过场。 */
const CHAPTERS: RenderChapter[] = [
  { id: "example", folder: "01-example", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] },
];

const TIMINGS = { example: { dwell: { "1": 600 } } };
const WINDOW_TABLE = [[3000, 0, 0]];

/** 期望时间轴（与 T1 单测逐字一致：3400 / 2350 / 1900，总 7650；帧数 91 / 1 / 1）。 */
const EXPECTED_STEP_MS = [3400, 2350, 1900];

/** 合成时间轴（纯函数面用：不碰 fs/网络）。 */
function makeTimeline(steps: Array<Partial<TimelineStep> & { chapterId: string; step: number }>): Timeline {
  let startMs = 0;
  const full = steps.map((s) => {
    const stepMs = s.stepMs ?? 1000;
    const out: TimelineStep = {
      chapter: s.chapter ?? 0,
      step: s.step,
      chapterId: s.chapterId,
      startMs,
      audioMs: s.audioMs ?? null,
      animMs: s.animMs ?? 0,
      dwellMs: s.dwellMs ?? 400,
      stepMs,
      frameCount: s.frameCount ?? 1,
      holdMs: s.holdMs ?? stepMs,
    };
    startMs += stepMs;
    return out;
  });
  return { steps: full, totalMs: startMs, fps: 30 };
}

const tmpDirs: string[] = [];

function tmpRepo(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `render-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

/** 铺开一个最小可渲仓库：章节 timing.json（CLI 从 disk 读，与分镜同源）+ 可选音频产物。 */
function seedRepo(
  repo: string,
  opts: { durations?: unknown; files?: string[]; timing?: unknown } = {},
): void {
  const dir = path.join(repo, "src", "chapters", "01-example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(opts.timing ?? TIMINGS.example));
  if (opts.durations === undefined) return;
  fs.mkdirSync(path.join(repo, "public"), { recursive: true });
  fs.writeFileSync(path.join(repo, "public", "audio-durations.json"), JSON.stringify(opts.durations));
  for (const rel of opts.files ?? []) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "not-a-real-mp3");
  }
}

// ── 参数解析 ──

describe("parseArgs（未知 flag = 响亮失败：用法错误的唯一载体）", () => {
  it("默认：全量出片到 <模板根>/render，并发 2，不合成音轨、不做确定性终验", () => {
    const args = parseArgs([], "/tmp/cwd");
    expect(args).toEqual({
      outDir: DEFAULT_OUT_DIR,
      mockAudio: false,
      concurrency: 2,
      only: undefined,
      verifyDeterminism: false,
      help: false,
    });
    expect(path.isAbsolute(DEFAULT_OUT_DIR)).toBe(true);
    expect(path.basename(DEFAULT_OUT_DIR)).toBe("render");
  });

  it("未知 flag → RenderUsageError（退出码 2 的载体；拼错的 flag 不得静默忽略）", () => {
    expect(() => parseArgs(["--moc-audio"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--moc-audio"], "/tmp")).toThrow(/未知参数 --moc-audio/);
  });

  it("缺值 / 空值 → RenderUsageError（--concurrency / --only / --out 各一条）", () => {
    expect(() => parseArgs(["--concurrency"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--only"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--out"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--out="], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--only="], "/tmp")).toThrow(RenderUsageError);
  });

  it("--concurrency 0 归 1（计划 T7：0/负数会除零或空跑，CLI 层归一）；负数/非整数 → 用法错误", () => {
    expect(parseArgs(["--concurrency", "0"], "/tmp").concurrency).toBe(1);
    expect(parseArgs(["--concurrency=3"], "/tmp").concurrency).toBe(3);
    expect(() => parseArgs(["--concurrency", "-1"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--concurrency", "2.5"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--concurrency", "two"], "/tmp")).toThrow(RenderUsageError);
  });

  it("--only 2,0 → 升序去重 [0,2]（成片顺序只由 step 序定，不由命令行次序定）", () => {
    expect(parseArgs(["--only", "2,0"], "/tmp").only).toEqual([0, 2]);
    expect(parseArgs(["--only=1,1"], "/tmp").only).toEqual([1]);
    expect(() => parseArgs(["--only", "0,"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--only", "a"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--only", "1.5"], "/tmp")).toThrow(RenderUsageError);
  });

  it("--out 相对路径按 cwd 解析（CLI 常规语义）；绝对路径原样", () => {
    expect(parseArgs(["--out", "out"], "/tmp/cwd").outDir).toBe("/tmp/cwd/out");
    expect(parseArgs(["--out", "/abs/out"], "/tmp/cwd").outDir).toBe("/abs/out");
  });

  it("--mock-audio / --verify-determinism / --help 三个开关", () => {
    const args = parseArgs(["--mock-audio", "--verify-determinism", "-h"], "/tmp");
    expect([args.mockAudio, args.verifyDeterminism, args.help]).toEqual([true, true, true]);
  });

  it("RENDER_USAGE 列出全部 flag（用法文案与解析器同源）", () => {
    for (const flag of ["--mock-audio", "--only", "--concurrency", "--out", "--verify-determinism", "--help"]) {
      expect(RENDER_USAGE).toContain(flag);
    }
  });
});

// ── 子时间轴（--only 的唯一载体） ──

describe("selectTimeline（--only → 子时间轴：encode/verify 都拿它，绝不拿全表比对）", () => {
  const full = makeTimeline([
    { chapterId: "a", step: 0, stepMs: 3400, frameCount: 91, animMs: 3000, holdMs: 400 },
    { chapterId: "a", step: 1, stepMs: 2350 },
    { chapterId: "b", step: 0, stepMs: 1900, chapter: 1 },
  ]);

  it("不给 only → 原表（同一引用，不做无谓复制）", () => {
    expect(selectTimeline(full, undefined)).toBe(full);
  });

  it("子表：startMs/totalMs 按被渲的步**重算**（沿用全表起点 = 拿错位的时间轴做边界断言）", () => {
    const sub = selectTimeline(full, [2]);
    expect(sub.steps.map((s) => [s.chapterId, s.step, s.startMs, s.stepMs])).toEqual([["b", 0, 0, 1900]]);
    expect(sub.totalMs).toBe(1900);
    expect(sub.fps).toBe(30);

    const pair = selectTimeline(full, [0, 2]);
    expect(pair.steps.map((s) => s.startMs)).toEqual([0, 3400]);
    expect(pair.totalMs).toBe(5300);
  });

  it("子表的每步仍是原表那一份（窗口/帧数不重算——只裁剪与重算前缀和）", () => {
    const sub = selectTimeline(full, [0]);
    expect(sub.steps[0].animMs).toBe(3000);
    expect(sub.steps[0].frameCount).toBe(91);
    expect(sub.steps[0].holdMs).toBe(400);
  });

  it("越界 / 空 only → throw（空跑或拿别的步顶替都会让产物与自校验一起自洽地错）", () => {
    expect(() => selectTimeline(full, [3])).toThrow(/越界/);
    expect(() => selectTimeline(full, [])).toThrow(/空/);
  });
});

// ── 输入面的两条护栏（Ruling R4 / T1 minor ①） ──

describe("assertAudioDurationAlignment（Ruling R4：durations 对不上 = 该步静默改用估时 + atrim 截断真音频）", () => {
  it("durations 缺失（未跑 TTS 的合法态）→ 通过", () => {
    expect(() => assertAudioDurationAlignment(CHAPTERS, null)).not.toThrow();
  });
  it("逐章条目数 == 非空 narrations 数 → 通过", () => {
    expect(() => assertAudioDurationAlignment(CHAPTERS, { example: [1750, 1750] })).not.toThrow();
  });
  it("条目数不符 / 缺章节键 → throw（带章节与本数）", () => {
    expect(() => assertAudioDurationAlignment(CHAPTERS, { example: [1750] })).toThrow(/example/);
    expect(() => assertAudioDurationAlignment(CHAPTERS, { other: [1750, 1750] })).toThrow(/example/);
  });
  it("接受 folder 键（与 resolveAudioMs 同源口径）；扁平数组形态按总数校验", () => {
    expect(() => assertAudioDurationAlignment(CHAPTERS, { "01-example": [1750, 1750] })).not.toThrow();
    expect(() => assertAudioDurationAlignment(CHAPTERS, [1750, 1750])).not.toThrow();
    expect(() => assertAudioDurationAlignment(CHAPTERS, [1750])).toThrow(/条目数/);
  });
});

describe("assertWindowTableShape（T1 minor ①：预扫表缺位会被静默读成窗口 0 = 成片冻住）", () => {
  it("对位一致 → 通过", () => {
    expect(() => assertWindowTableShape(WINDOW_TABLE, CHAPTERS)).not.toThrow();
  });
  it("章数 / 章内步数不符 → throw", () => {
    expect(() => assertWindowTableShape([], CHAPTERS)).toThrow(/example/);
    expect(() => assertWindowTableShape([[3000, 0]], CHAPTERS)).toThrow(/example/);
  });
});

// ── 音频段装配（音画同源的输入面） ──

describe("buildAudioSegments（每步一段：有 mp3 用文件、无声步 null）", () => {
  const timeline = makeTimeline([
    { chapterId: "example", step: 0, stepMs: 3400, audioMs: 1750 },
    { chapterId: "example", step: 1, stepMs: 2350 },
    { chapterId: "example", step: 2, stepMs: 1900 },
  ]);

  it("有实测时长 + mp3 在 → 给绝对路径；空 narration 步 → null（anullsrc 段）", () => {
    const { segments, silent } = buildAudioSegments({
      chapters: CHAPTERS,
      timeline,
      audioRoot: "/repo/public/audio",
      exists: (file) => file.endsWith("0.mp3"),
    });
    expect(segments.map((s) => s.stepMs)).toEqual([3400, 2350, 1900]);
    expect(segments[0].mp3).toBe("/repo/public/audio/01-example/0.mp3");
    expect(segments[1].mp3).toBeNull(); // 该步未合成（durations 缺这条）
    expect(segments[2].mp3).toBeNull(); // 无声过场（空 narration）
    expect(silent).toEqual([1]);
  });

  it("每段的 stepMs 逐条取自时间轴表（音画同源的唯一接口）", () => {
    const { segments } = buildAudioSegments({
      chapters: CHAPTERS,
      timeline,
      audioRoot: "/repo/public/audio",
      exists: (file) => file.endsWith("0.mp3"),
    });
    expect(segments.map((s) => s.stepMs)).toEqual(timeline.steps.map((s) => s.stepMs));
  });

  it("durations 有实测时长但 mp3 不在 → throw（成片会静默少一段人声）", () => {
    expect(() =>
      buildAudioSegments({ chapters: CHAPTERS, timeline, audioRoot: "/repo/public/audio", exists: () => false }),
    ).toThrow(/mp3/);
  });

  it("mp3 在但没有实测时长 → throw（时长按估时算、atrim 把真人声截断，且自校验看不见）", () => {
    const noAudioMs = makeTimeline([
      { chapterId: "example", step: 0, stepMs: 3400 },
      { chapterId: "example", step: 1, stepMs: 2350 },
      { chapterId: "example", step: 2, stepMs: 1900 },
    ]);
    expect(() =>
      buildAudioSegments({ chapters: CHAPTERS, timeline: noAudioMs, audioRoot: "/repo/public/audio", exists: () => true }),
    ).toThrow(/durations/);
  });
});

// ── 进度行 ──

describe("stepLine（每步一行：章节 id · 帧数 · 步长 · 音频状态）", () => {
  it("有声步：音频 N ms；未合成 / 无声过场分开陈述（不是静默）", () => {
    const timeline = makeTimeline([
      { chapterId: "example", step: 0, stepMs: 3400, frameCount: 91, audioMs: 1750 },
      { chapterId: "example", step: 1, stepMs: 2350 },
      { chapterId: "example", step: 2, stepMs: 1900 },
    ]);
    expect(stepLine(timeline.steps[0], CHAPTERS[0].narrations[0])).toBe(
      "[render] 章节 example 第 0 步 · 91 帧 · 3400ms · 音频 1750ms",
    );
    expect(stepLine(timeline.steps[1], CHAPTERS[0].narrations[1])).toBe(
      "[render] 章节 example 第 1 步 · 1 帧 · 2350ms · 无声（未合成）",
    );
    expect(stepLine(timeline.steps[2], CHAPTERS[0].narrations[2])).toBe(
      "[render] 章节 example 第 2 步 · 1 帧 · 1900ms · 无声过场",
    );
  });
});

// ── 负样本（"两个不同 t 必须不同"——确定性终验的判据有牙证明） ──

describe("determinismPairs（负样本：同一步内两个不同 t 的产物帧必须不同）", () => {
  it("按采样步成对取首末帧；md5 由注入的读取器给（不碰真 PNG）", () => {
    const timeline = makeTimeline([
      { chapterId: "a", step: 0, stepMs: 3400, frameCount: 91, animMs: 3000, holdMs: 400 },
    ]);
    const sampled = sampledFrames(timeline); // T6 的采样口径（必含首末帧）
    const read: string[] = [];
    const pairs = determinismPairs(sampled, "/out", timeline, (file) => {
      read.push(file);
      return file.endsWith("0001.png") ? "md5-first" : "md5-last";
    });
    expect(pairs).toEqual([
      { label: "章节 a 第 0 步", tA: 0, tB: 3000, md5A: "md5-first", md5B: "md5-last", identical: false },
    ]);
    expect(read).toEqual(["/out/frames/a/0/0001.png", "/out/frames/a/0/0091.png"]);
  });

  it("两端帧相同 → identical（对称动画/静帧不该被当成不一致）；单帧步不成对", () => {
    const still = makeTimeline([
      { chapterId: "a", step: 0, stepMs: 3400, frameCount: 91, animMs: 3000, holdMs: 400 },
      { chapterId: "a", step: 1, stepMs: 1900, frameCount: 1 },
    ]);
    const pairs = determinismPairs(sampledFrames(still), "/out", still, () => "same");
    expect(pairs.map((p) => p.identical)).toEqual([true]);
  });
});

// ── 编排（注入式 deps：不启浏览器、不起 Vite、不跑 ffmpeg） ──

interface Recorded {
  calls: string[];
  capture?: { specs: readonly FrameSpec[]; opts: CaptureFramesOptions };
  encode?: EncodeOptions;
  verify?: import("./render/verify").VerifyOptions;
  determinism?: import("./render").DeterminismOptions;
}

function makeDeps(
  repo: string,
  rec: Recorded,
  over: Partial<RenderDeps> = {},
): RenderDeps {
  return {
    repoRoot: repo,
    loadChapters: async () => CHAPTERS,
    synthesizeMockAudio: async () => {
      rec.calls.push("mock");
      return { files: [], durationsFile: "public/audio-durations.json", durations: {}, staleFiles: [] };
    },
    startServe: async () => {
      rec.calls.push("serve");
      return { url: "http://localhost:5174/", stop: async () => void rec.calls.push("serve:stop") };
    },
    scanAnimationWindows: async () => {
      rec.calls.push("scan");
      return { animMsByStep: [[3000, 0, 0]], frameCountByStep: [[1, 0, 0]] };
    },
    captureFrames: async (specs, opts) => {
      rec.calls.push("capture");
      rec.capture = { specs, opts };
      // 假帧流：形状与真实现一致（T5 只吃 dir/frameCount/holdMs/animMs）
      return specs.map((spec): CapturedStep => {
        const step = opts.timeline.steps.find((s) => s.chapter === spec.chapter && s.step === spec.step)!;
        return {
          ...spec,
          dir: `frames/${spec.chapterId}/${spec.step}`,
          frameCount: step.frameCount,
          animMs: step.animMs,
          holdMs: step.holdMs,
          warnings: spec.chapter === 0 && spec.step === 1 ? ["第 1 步有泄漏动画"] : [],
        };
      });
    },
    encodeVideo: async (opts) => {
      rec.calls.push("encode");
      rec.encode = opts;
      const out: EncodeResult = {
        output: opts.output,
        listPath: path.join(opts.outDir, "concat.txt"),
        videoPath: path.join(opts.outDir, "video.mp4"),
        audioPath: path.join(opts.outDir, "audio.m4a"),
      };
      return out;
    },
    verifyRender: async (opts) => {
      rec.calls.push("verify");
      rec.verify = opts;
      return { ok: true, lines: ["自校验读数"], failures: [] };
    },
    runDeterminism: async (opts) => {
      rec.calls.push("determinism");
      rec.determinism = opts;
      return { ok: true, lines: ["确定性读数"], failures: [] };
    },
    ...over,
  };
}

function makeIo(): { io: RenderIo; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { io: { log: (l) => void lines.push(l), error: (l) => void errors.push(l) }, lines, errors };
}

describe("runRender 编排（顺序 = mock 音轨 → 窗口预扫 → 拍帧 → 编码 → 自校验）", () => {
  it("顺序与产物路径：自起 Vite → 逐段调用；render/<slug>.mp4 + 中间产物在 render/<slug>/", async () => {
    const repo = tmpRepo("order");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io, lines } = makeIo();
    const code = await runRender(
      { outDir: path.join(repo, "render"), mockAudio: true, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec),
      io,
    );

    expect(rec.calls).toEqual(["mock", "serve", "scan", "capture", "encode", "verify", "serve:stop"]);
    expect(code).toBe(0);
    expect(rec.encode?.output).toBe(path.join(repo, "render", "presentation.mp4"));
    expect(rec.encode?.outDir).toBe(path.join(repo, "render", "presentation"));
    expect(rec.verify?.output).toBe(rec.encode?.output);
    // 三处消费的都是同一张（子）时间轴表；视口/软渲与 captureFrames 那次逐字相同（T6 的接线约束）
    expect(rec.verify?.timeline).toBe(rec.capture?.opts.timeline);
    expect(rec.capture?.opts.viewport).toEqual({ width: 1920, height: 1080 });
    expect(rec.verify?.viewport).toEqual(rec.capture?.opts.viewport);
    expect(rec.capture?.opts.softwareGL).toBe(true);
    expect(rec.verify?.softwareGL).toBe(true);
    // 渲染态 URL（captureFrames 直接 throw 非渲染态；预扫/verify 同样吃它）
    expect(rec.capture?.opts.url).toContain("render=1");
    // 每步一行进度（成片口径的读数）
    expect(lines.filter((l) => l.startsWith("[render] 章节"))).toEqual([
      "[render] 章节 example 第 0 步 · 91 帧 · 3400ms · 音频 1750ms",
      "[render] 章节 example 第 1 步 · 1 帧 · 2350ms · 音频 1750ms",
      "[render] 章节 example 第 2 步 · 1 帧 · 1900ms · 无声过场",
    ]);
  });

  it("两条数组都取自时间轴且逐条同源（T5 有护栏：stepMs 双源不一致即 throw）", async () => {
    const repo = tmpRepo("sync");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    await runRender(
      { outDir: path.join(repo, "render"), mockAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec),
      io,
    );
    expect(rec.encode?.stepMsByStep).toEqual(EXPECTED_STEP_MS);
    expect(rec.encode?.segments.map((s) => s.stepMs)).toEqual(EXPECTED_STEP_MS);
    expect(rec.verify?.segments.map((s) => s.stepMs)).toEqual(EXPECTED_STEP_MS);
    expect(rec.encode?.fps).toBe(30);
  });

  it("--only 0：captureFrames / encode / verify 只处理被渲的步（自校验不拿全表比对）", async () => {
    const repo = tmpRepo("only");
    seedRepo(repo, { durations: { example: [1750, 1750] }, files: ["public/audio/01-example/0.mp3"] });
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    await runRender(
      { outDir: path.join(repo, "render"), mockAudio: false, concurrency: 2, only: [0], verifyDeterminism: false, help: false },
      makeDeps(repo, rec),
      io,
    );
    expect(rec.capture?.specs).toEqual([{ chapter: 0, step: 0, chapterId: "example" }]);
    expect(rec.encode?.stepMsByStep).toEqual([3400]);
    expect(rec.encode?.segments).toEqual([{ mp3: path.join(repo, "public/audio/01-example/0.mp3"), stepMs: 3400 }]);
    expect(rec.verify?.timeline.steps.map((s) => s.step)).toEqual([0]);
    expect(rec.verify?.timeline.totalMs).toBe(3400);
  });

  it("无音频 deck：明示「未合成音频，按估时出片（无声）」，全 null 段照常出片", async () => {
    const repo = tmpRepo("noaudio");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io, lines } = makeIo();
    const code = await runRender(
      { outDir: path.join(repo, "render"), mockAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec),
      io,
    );
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("未合成音频，按估时出片（无声）"))).toBe(true);
    expect(rec.encode?.segments.map((s) => s.mp3)).toEqual([null, null, null]);
  });

  it("warnings 整串打到 stderr（R7 泄漏告警的出口）；自校验失败 → 退出码 1", async () => {
    const repo = tmpRepo("warn");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io, errors, lines } = makeIo();
    const code = await runRender(
      { outDir: path.join(repo, "render"), mockAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec, {
        verifyRender: async (opts) => {
          rec.calls.push("verify");
          rec.verify = opts;
          return { ok: false, lines: ["成片时长不符"], failures: ["[失败] 成片时长不符"] };
        },
      }),
      io,
    );
    expect(code).toBe(1);
    expect(errors.some((l) => l.includes("第 1 步有泄漏动画"))).toBe(true);
    expect(errors.some((l) => l.includes("[失败] 成片时长不符"))).toBe(true);
    expect(lines.some((l) => l.includes("成片时长不符"))).toBe(true);
  });

  it("--verify-determinism 才跑确定性终验，且拿到同一张子时间轴", async () => {
    const repo = tmpRepo("det");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const args: RenderArgs = {
      outDir: path.join(repo, "render"),
      mockAudio: false,
      concurrency: 2,
      only: [0, 1],
      verifyDeterminism: true,
      help: false,
    };
    const code = await runRender(args, makeDeps(repo, rec), io);
    expect(code).toBe(0);
    expect(rec.calls).toEqual(["serve", "scan", "capture", "encode", "verify", "determinism", "serve:stop"]);
    expect(rec.determinism?.timeline.steps.map((s) => s.step)).toEqual([0, 1]);
    expect(rec.determinism?.softwareGL).toBe(true);
    expect(rec.determinism?.url).toContain("render=1");
  });

  it("确定性地验不过 → 退出码 1（终验是门，不是报表）", async () => {
    const repo = tmpRepo("detred");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const code = await runRender(
      { outDir: path.join(repo, "render"), mockAudio: false, concurrency: 2, only: undefined, verifyDeterminism: true, help: false },
      makeDeps(repo, rec, {
        runDeterminism: async (opts) => {
          rec.calls.push("determinism");
          rec.determinism = opts;
          return { ok: false, lines: [], failures: ["[失败] 第 0 步某帧不一致"] };
        },
      }),
      io,
    );
    expect(code).toBe(1);
  });

  it("durations 对不上 → 入口就 throw（不给「静默改用估时 + atrim 截断真音频」留活口）", async () => {
    const repo = tmpRepo("mismatch");
    seedRepo(repo, { durations: { example: [1750] }, files: ["public/audio/01-example/0.mp3"] });
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    await expect(
      runRender(
        { outDir: path.join(repo, "render"), mockAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
        makeDeps(repo, rec),
        io,
      ),
    ).rejects.toThrow(/example/);
  });
});

// ── CLI 入口（退出码：0 过 / 1 运行时失败 / 2 用法错误） ──

describe("renderCli（退出码约定与 check 入口一致）", () => {
  it("--help → 0 且不跑管线（用法错误才是 2）", async () => {
    const { io, lines } = makeIo();
    expect(await renderCli(["--help"], io)).toBe(0);
    expect(lines.join("\n")).toContain("--mock-audio");
  });

  it("未知 flag → 2（不跑管线）", async () => {
    const { io } = makeIo();
    expect(await renderCli(["--nope"], io)).toBe(2);
  });
});
