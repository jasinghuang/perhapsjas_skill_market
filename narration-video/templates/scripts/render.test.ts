// M5a Task 7 单测：`npm run render` 的 CLI 面——参数解析（用法错误的载体）、子时间轴
// （`--only` 与 timeline/encode/verify 的联动）、音频段装配（音画同源的输入面）、
// 每步进度行、编排顺序与"无音频明示"。
//
// 真机臂（自起 Vite + Chromium + ffmpeg 出片）不在此处：那是 `npm run render -- --mock-audio`
// 的收口冒烟与 T4/T5/T6 三个 *.browser.test.ts 的事务。本文件钉住的是**接线**——
// 三段联动（帧流 / 编码 / 自校验）的取值来源必须是**同一张（子）时间轴表**，
// 以及"用法错误不得静默"的纪律（未知 flag → 退出码 2 的载体）。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_AUDIO_DEFAULT, MOCK_AUDIO_REALISTIC, type MockAudioProfile } from "./render/audio";
import type { EncodeOptions, EncodeResult } from "./render/encode";
import { frameDir, framePaths } from "./render/frames";
import type { CaptureFramesOptions, CapturedStep, FrameSpec } from "./render/frames";
import { REALTIME_SUFFIX } from "./render/realtime";
import type { Timeline, TimelineStep } from "./render/timeline";
import { sampledFrames } from "./render/verify";
import {
  DEFAULT_OUT_DIR,
  FRAME_PROGRESS_POLL_MS,
  RENDER_USAGE,
  RenderUsageError,
  assertAudioDurationAlignment,
  assertWindowTableShape,
  buildAudioSegments,
  determinismPairs,
  displayPath,
  frameStepsDone,
  judgeNegativeSamples,
  parseArgs,
  pickDeliverable,
  renderCli,
  runRender,
  selectTimeline,
  stepLine,
  watchFrameProgress,
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
      realisticAudio: false,
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

  it("--realistic-audio 开关（M5b T1：拟真档 mock 的形状）", () => {
    expect(parseArgs(["--mock-audio", "--realistic-audio"], "/tmp").realisticAudio).toBe(true);
    expect(parseArgs(["--mock-audio"], "/tmp").realisticAudio).toBe(false);
  });

  // 拟真档是 `--mock-audio` 的**修饰**：单给它什么都不生产（没有音轨要合成），静默忽略等于骗人
  it("--realistic-audio 单给（没有 --mock-audio）→ 用法错误（不静默空转）", () => {
    expect(() => parseArgs(["--realistic-audio"], "/tmp")).toThrow(RenderUsageError);
    expect(() => parseArgs(["--realistic-audio"], "/tmp")).toThrow(/--mock-audio/);
  });

  it("RENDER_USAGE 列出全部 flag（用法文案与解析器同源）", () => {
    for (const flag of ["--mock-audio", "--realistic-audio", "--only", "--concurrency", "--out", "--verify-determinism", "--all-steps", "--help"]) {
      expect(RENDER_USAGE).toContain(flag);
    }
  });

  it("--all-steps 开关（M5b T6：扩采样面；**不是**改 SAMPLE_STEPS_MAX 常量）", () => {
    expect(parseArgs(["--all-steps"], "/tmp").allSteps).toBe(true);
    // 缺省 = 老行为（undefined，不是 false）：`SAMPLE_STEPS_MAX` 的 `min(3, 步数)` 采样面不动
    expect(parseArgs([], "/tmp").allSteps).toBeUndefined();
    // 它同时扩"每次渲染都跑的重采"与（给了 --verify-determinism 时的）确定性终验，
    // 故**不**要求与 --verify-determinism 同用（那种耦合会让单给变成静默空转或无谓的用法错误）
    expect(() => parseArgs(["--all-steps"], "/tmp")).not.toThrow();
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
      {
        label: "章节 a 第 0 步",
        chapter: 0,
        step: 0,
        animMs: 3000,
        tA: 0,
        tB: 3000,
        md5A: "md5-first",
        md5B: "md5-last",
        identical: false,
      },
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

// ── 负样本判据口径（M5b T6 修正：有动画的步必须有非恒等对 + 静态步如实计数） ──
//
// 为什么必须修：`--all-steps` 把采样面扩到全 deck 后，采样步里会混进**静态步**（动画窗口 0ms
// → 单帧、本就不成对），聚合式判据（"至少一对不同"）会被稀释——`--all-steps` 下只要全 deck
// 还剩一对不同就绿，某一步的帧流没画动画不再能被看见。逐对判 + 如实计数才是"判据有牙"的形态。

describe("judgeNegativeSamples（有动画的步逐对必判；静态步/单帧步如实计数）", () => {
  /** 五步 fixture（≥4 步：默认采样的 `min(3, 步数)` 在这张表上只够得着 3 步）。 */
  const fiveSteps = makeTimeline([
    { chapterId: "a", step: 0, stepMs: 3400, frameCount: 91, animMs: 3000, holdMs: 400 },
    { chapterId: "a", step: 1, stepMs: 2350, frameCount: 1 },
    { chapterId: "a", step: 2, stepMs: 1900, frameCount: 1 },
    { chapterId: "b", step: 0, stepMs: 2400, frameCount: 61, animMs: 2000, holdMs: 400, chapter: 1 },
    { chapterId: "b", step: 1, stepMs: 1900, frameCount: 1, chapter: 1 },
  ]);

  const pairOf = (
    step: TimelineStep,
    identical: boolean,
  ): ReturnType<typeof determinismPairs>[number] => ({
    label: `章节 ${step.chapterId} 第 ${step.step} 步`,
    chapter: step.chapter,
    step: step.step,
    animMs: step.animMs,
    tA: 0,
    tB: step.animMs,
    md5A: `md5-${step.chapterId}-${step.step}`,
    md5B: identical ? `md5-${step.chapterId}-${step.step}` : `md5b-${step.chapterId}-${step.step}`,
    identical,
  });

  it("每个有动画的对都不同 → 零失败；行里给出「不是空转」的读数", () => {
    const pairs = [pairOf(fiveSteps.steps[0], false), pairOf(fiveSteps.steps[3], false)];
    const r = judgeNegativeSamples(pairs, fiveSteps.steps);
    expect(r.failures).toEqual([]);
    expect(r.lines.join("\n")).toContain("逐字节比对不是空转");
  });

  it("**判别力**：一步的动画没画出来（同一步两端帧相同），另一动画步不同 → 点名失牙的那一步（旧口径会放行）", () => {
    const pairs = [pairOf(fiveSteps.steps[0], false), pairOf(fiveSteps.steps[3], true)];
    const r = judgeNegativeSamples(pairs, fiveSteps.steps);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("章节 b 第 0 步");
    expect(r.failures[0]).toContain("animMs=2000ms");
    expect(r.failures[0]).toContain("失牙");
    // 另一对（正常的那个）不因它连坐
    expect(r.failures.join("\n")).not.toContain("章节 a 第 0 步");
  });

  it("静态步如实计数（不判负、列出坐标）——`--all-steps` 全 deck 采样下它们必然混进来", () => {
    const pairs = [pairOf(fiveSteps.steps[0], false), pairOf(fiveSteps.steps[3], false)];
    const r = judgeNegativeSamples(pairs, fiveSteps.steps);
    expect(r.lines.join("\n")).toContain("3 个静态步");
    expect(r.lines.join("\n")).toContain("章节 a 第 1 步");
    expect(r.lines.join("\n")).toContain("章节 b 第 1 步");
    expect(r.failures).toEqual([]);
  });

  it("判据面为空（全静态 / 全单帧）→ 报红，不静默全绿", () => {
    const r = judgeNegativeSamples([], fiveSteps.steps);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("判据面为空");
  });

  it("有动画但只落单帧（窗口短于采样间隔）→ 如实计数（不判负），且不冒充'静态步'", () => {
    const shortAnim = makeTimeline([{ chapterId: "a", step: 0, stepMs: 1400, frameCount: 1, animMs: 30, holdMs: 0 }]);
    const r = judgeNegativeSamples([], shortAnim.steps);
    expect(r.lines.join("\n")).toContain("只落单帧");
    expect(r.lines.join("\n")).not.toContain("个静态步");
    expect(r.failures).toHaveLength(1); // 判据面仍为空（这一条是"没有可判对"的报红，不是这一步判负）
  });
});

// ── 编排（注入式 deps：不启浏览器、不起 Vite、不跑 ffmpeg） ──

interface Recorded {
  calls: string[];
  mock?: { chapters: readonly RenderChapter[]; repoRoot: string; profile?: MockAudioProfile };
  /** 窗口预扫的入参（`--no-subs` 归一的四个消费者之一——终审 I-1） */
  scan?: { url: string; chapters: readonly { steps: number }[] };
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
    synthesizeMockAudio: async (opts) => {
      rec.calls.push("mock");
      rec.mock = opts;
      return { files: [], durationsFile: "public/audio-durations.json", durations: {}, staleFiles: [] };
    },
    startServe: async () => {
      rec.calls.push("serve");
      return { url: "http://localhost:5174/", stop: async () => void rec.calls.push("serve:stop") };
    },
    scanAnimationWindows: async (opts) => {
      rec.calls.push("scan");
      rec.scan = opts;
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
      { outDir: path.join(repo, "render"), mockAudio: true, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
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
    // 修复轮 1（Minor 3）：headless 在 **CLI 层显式归一**（不是靠 openSession 内部补）——日志里打的
    // 就是这个串，必须与页面实际吃到的一致；两个归一函数都幂等，重复调用无副作用。
    expect(rec.capture?.opts.url).toContain("render=1");
    expect(rec.capture?.opts.url).toContain("headless=1");
    // 每步一行进度（成片口径的读数）
    expect(lines.filter((l) => l.startsWith("[render] 章节"))).toEqual([
      "[render] 章节 example 第 0 步 · 91 帧 · 3400ms · 音频 1750ms",
      "[render] 章节 example 第 1 步 · 1 帧 · 2350ms · 音频 1750ms",
      "[render] 章节 example 第 2 步 · 1 帧 · 1900ms · 无声过场",
    ]);
  });

  it("mock 音轨的档案：--realistic-audio → MOCK_AUDIO_REALISTIC；缺省 → MOCK_AUDIO_DEFAULT（M5b T1）", async () => {
    const repo = tmpRepo("profile");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    await runRender(
      { outDir: path.join(repo, "render"), mockAudio: true, realisticAudio: true, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec),
      io,
    );
    expect(rec.mock?.profile).toEqual(MOCK_AUDIO_REALISTIC);
    expect(rec.mock?.chapters).toEqual(CHAPTERS);
    expect(rec.mock?.repoRoot).toBe(repo);

    const rec2: Recorded = { calls: [] };
    await runRender(
      { outDir: path.join(repo, "render"), mockAudio: true, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec2),
      makeIo().io,
    );
    expect(rec2.mock?.profile).toEqual(MOCK_AUDIO_DEFAULT);
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
      { outDir: path.join(repo, "render"), mockAudio: false, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
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
      { outDir: path.join(repo, "render"), mockAudio: false, realisticAudio: false, concurrency: 2, only: [0], verifyDeterminism: false, help: false },
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
      { outDir: path.join(repo, "render"), mockAudio: false, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
      makeDeps(repo, rec),
      io,
    );
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("未合成音频，按估时出片（无声）"))).toBe(true);
    expect(rec.encode?.segments.map((s) => s.mp3)).toEqual([null, null, null]);
  });

  // M5b T4：缺省下"自校验失败"改走实时捕获降级（出 .realtime.mp4、退出码 0），故本条要的是
  // **严格模式**（`--no-fallback`）下的读数；降级路径本身在 realtime.test.ts 的接线用例里钉。
  it("warnings 整串打到 stderr（R7 泄漏告警的出口）；--no-fallback 下自校验失败 → 退出码 1", async () => {
    const repo = tmpRepo("warn");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io, errors, lines } = makeIo();
    const code = await runRender(
      { outDir: path.join(repo, "render"), mockAudio: false, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, noFallback: true, help: false },
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
      realisticAudio: false,
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

  it("--no-subs 的归一喂**四个**消费者，且四处 URL **逐字相同**（终审 I-1：管线本身要有牙）", async () => {
    const repo = tmpRepo("nosubs-url");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    // CLI 面到编排面：`--no-subs` 的解析 + 那行归一（`withNoSubs(baseUrl)`）。
    // **`--out` 必须显式给**（终审复审 F）：`parseArgs` 的缺省 outDir 是模块锚定的**真**
    // `<模板根>/render` ⇒ 漏了它，这条用例的 `runRender` 会把 SRT（encodeVideo 是替身、
    // 只有 SRT 真写盘）写进**待审输出目录**，静默改写 `render/presentation.srt`
    // （`golden/README.md` 的落库步骤正是 `cp` 它）。同级用例一律显式传 `path.join(repo,"render")`。
    const args = parseArgs(["--no-subs", "--verify-determinism", "--out", path.join(repo, "render")], repo);
    expect(args.noSubs).toBe(true);
    // **先把锚定钉住、再跑管线**：这一条断言必须在 runRender **之前**——`--out` 哪天被删掉时，
    // 它在写盘前就红（而不是"跑完把待审 SRT 改掉了，然后才报"）
    expect(args.outDir).toBe(path.join(repo, "render"));
    const code = await runRender(
      { ...args },
      makeDeps(repo, rec),
      io,
    );
    expect(code).toBe(0);

    // 四处消费者：窗口预扫 / 帧流捕捉 / 自校验的跨会话重采 / 确定性终验。
    // 漏归一任何一处 ⇒ 重采那侧带着字幕层重拍 ⇒ 与无字幕产物帧 md5 不符 ⇒ 对**正确产物**假红
    //（成片无字幕、重采有字幕）；四处**逐字相同**才是"同一个 URL"的强口径。
    const urls = [rec.scan?.url, rec.capture?.opts.url, rec.verify?.url, rec.determinism?.url];
    for (const url of urls) {
      expect(url, "四个消费者都要拿到归一的 URL").toBeDefined();
      expect(url).toContain("no-subs=1");
      expect(url).toContain("render=1");
      expect(url).toContain("headless=1");
    }
    expect(new Set(urls).size).toBe(1);
  });

  it("--all-steps 把采样面开关透到两个消费者（自校验重采 + 确定性终验）；缺省 = false（老采样面）", async () => {
    const repo = tmpRepo("allsteps");
    seedRepo(repo, {
      durations: { example: [1750, 1750] },
      files: ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"],
    });
    const base: RenderArgs = {
      outDir: path.join(repo, "render"),
      mockAudio: false,
      realisticAudio: false,
      concurrency: 2,
      only: undefined,
      verifyDeterminism: true,
      help: false,
    };
    // 缺省：显式给 false（下游永远拿到布尔，不用各自判 undefined）
    const recOff: Recorded = { calls: [] };
    await runRender(base, makeDeps(repo, recOff), makeIo().io);
    expect(recOff.verify?.allSteps).toBe(false);
    expect(recOff.determinism?.allSteps).toBe(false);

    const recOn: Recorded = { calls: [] };
    await runRender({ ...base, allSteps: true }, makeDeps(repo, recOn), makeIo().io);
    expect(recOn.verify?.allSteps).toBe(true);
    expect(recOn.determinism?.allSteps).toBe(true);
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
      { outDir: path.join(repo, "render"), mockAudio: false, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: true, help: false },
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
        { outDir: path.join(repo, "render"), mockAudio: false, realisticAudio: false, concurrency: 2, only: undefined, verifyDeterminism: false, help: false },
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

  // 修复轮 1（Minor 4）：npm 11 会把 `npm run render --mock-audio` 的 flag 当**自己的配置项**
  // 吞掉（只在 stderr 留一条 Unknown cli config 警告），脚本根本收不到 —— 用户照抄即踩。
  // 用法文案必须把 `--` 这个坑写在明面上（同一条事实在 render.ts 的 RENDER_USAGE 里）。
  it("用法文案点名 npm 的 `--` 转发陷阱（用户照抄即踩的那条）", () => {
    expect(RENDER_USAGE).toContain("npm run render -- --mock-audio");
    expect(RENDER_USAGE).toMatch(/必须加 --/);
  });
});

describe("displayPath（日志路径：库内相对、库外绝对）", () => {
  const CWD = "/repo/narration-video/templates";

  it("cwd 之内 → 相对路径（短、可点）", () => {
    expect(displayPath(path.join(CWD, "render/presentation.mp4"), CWD)).toBe("render/presentation.mp4");
  });

  it("cwd 之外（--out 指到仓库外）→ 绝对路径（`../..` 串只是噪音，还得自己数层数）", () => {
    expect(displayPath("/tmp/out/presentation.mp4", CWD)).toBe("/tmp/out/presentation.mp4");
    expect(displayPath("/repo/other", CWD)).toBe("/repo/other");
  });

  it("就是 cwd 本身 → 绝对路径（空串会被 `||` 兜成别的，宁可直接给绝对）", () => {
    expect(displayPath(CWD, CWD)).toBe(CWD);
  });
});

// ── 进度上报（M5b T5：onProgress 的真实生产者） ──
//
// 为什么生产者要长这样：步级并行在 `captureFrames` **内部**（一次调用渲完所有步），编排层拿不到
// 逐步回调；它能观测到的"某一步完成了"只有一个：该步的产物帧在盘上**落齐**（且是**本次**写的）。
// 故进度来自产物本身（不是猜的）：`frameStepsDone` 数落齐的步数，`watchFrameProgress` 在捕捉
// 期间按拍上报，捕捉返回后再由编排层补一次 `(total,total)` 把契约钉死。

describe("frameStepsDone（帧流进度的唯一读数：数「本次落齐」的步）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 写真帧并摆 mtime（seconds 口径由 Date 兜）；mtimeMs 是"本次写的"判据。 */
  function writeFrames(workDir: string, step: number, count: number, mtimeMs: number): void {
    const dir = path.join(workDir, frameDir("example", step));
    fs.mkdirSync(dir, { recursive: true });
    const paths = framePaths(frameDir("example", step), count);
    for (const rel of paths) {
      const file = path.join(workDir, rel);
      fs.writeFileSync(file, "png");
      const when = new Date(mtimeMs);
      fs.utimesSync(file, when, when);
    }
  }

  it("落齐且是本次写的 → 数；陈旧帧（上一轮残留）/ 缺帧 / 空步都不算", () => {
    const workDir = tmpRepo("frames-done");
    const steps = [
      { chapterId: "example", step: 0, frameCount: 2 },
      { chapterId: "example", step: 1, frameCount: 1 },
      { chapterId: "example", step: 2, frameCount: 2 },
    ];
    const startedAtMs = 1_000_000;

    writeFrames(workDir, 0, 2, startedAtMs); // 本次落齐
    writeFrames(workDir, 1, 1, startedAtMs - 5_000); // 上一轮的残留（陈旧）
    writeFrames(workDir, 2, 1, startedAtMs); // 缺末帧（frameCount 2，只落了 1）

    expect(frameStepsDone({ workDir, steps, startedAtMs })).toBe(1);

    writeFrames(workDir, 1, 1, startedAtMs + 1); // 本轮补上
    expect(frameStepsDone({ workDir, steps, startedAtMs })).toBe(2);

    writeFrames(workDir, 2, 2, startedAtMs + 2); // 末帧补齐
    expect(frameStepsDone({ workDir, steps, startedAtMs })).toBe(3);

    expect(frameStepsDone({ workDir, steps: [], startedAtMs })).toBe(0);
  });
});

describe("watchFrameProgress（捕捉期间按拍上报：每落齐一步报一次，同一读数不重复报）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("逐步上报；无新落齐不报；stop 后不再报", async () => {
    vi.useFakeTimers();
    const workDir = tmpRepo("watch-progress");
    const startedAtMs = 2_000_000;
    const steps = [0, 1, 2, 3].map((step) => ({ chapterId: "example", step, frameCount: 1 }));
    const reports: string[] = [];
    const watch = watchFrameProgress({
      workDir,
      steps,
      startedAtMs,
      report: (done, total) => reports.push(`${done}/${total}`),
    });

    /** 一拍：放行计时器 + 让 async 循环跑到下一次等待。 */
    const tick = async (): Promise<void> => {
      await vi.advanceTimersByTimeAsync(FRAME_PROGRESS_POLL_MS);
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    const write = (step: number, mtimeMs: number): void => {
      const rel = framePaths(frameDir("example", step), 1)[0];
      const file = path.join(workDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "png");
      const when = new Date(mtimeMs);
      fs.utimesSync(file, when, when);
    };

    await tick(); // 一步都没落齐：不制造假读数
    expect(reports).toEqual([]);

    write(0, startedAtMs + 10);
    await tick();
    expect(reports).toEqual(["1/4"]);

    await tick(); // 没有新落齐的步
    expect(reports).toEqual(["1/4"]);

    write(1, startedAtMs + 20);
    write(2, startedAtMs + 30); // worker 乱序完成也照样数
    await tick();
    expect(reports).toEqual(["1/4", "3/4"]);

    await watch.stop();
    write(3, startedAtMs + 99); // stop 之后落齐的步不再产生读数（循环已退出）
    await tick();
    expect(reports).toEqual(["1/4", "3/4"]);
  });
});

// ── 交付物挑选（T5 修复轮 1 · 评审 M-2：把 vite.config.ts 里的分支提成可测纯函数） ──
//
// 为什么需要这条规则：确定性成片与降级产物（T4）**可能同时在盘上**——降级时那份 `<slug>.mp4`
// 是**未通过自校验**的（编码早于自校验），T4 明写"别让下游（导出服务/人）把它当交付物"。

describe("pickDeliverable（本次跑的交付物：降级产物 vs 确定性成片）", () => {
  function seed(outDir: string, slug: string, mtimes: { mp4?: number; realtime?: number }): void {
    fs.mkdirSync(outDir, { recursive: true });
    if (mtimes.mp4 !== undefined) {
      const f = path.join(outDir, `${slug}.mp4`);
      fs.writeFileSync(f, "deterministic");
      const when = new Date(mtimes.mp4);
      fs.utimesSync(f, when, when);
    }
    if (mtimes.realtime !== undefined) {
      const f = path.join(outDir, `${slug}${REALTIME_SUFFIX}.mp4`);
      fs.writeFileSync(f, "realtime");
      const when = new Date(mtimes.realtime);
      fs.utimesSync(f, when, when);
    }
  }

  it("没有降级产物 → 确定性成片（`<outDir>/<slug>.mp4`）", () => {
    const outDir = tmpRepo("pick-deterministic");
    seed(outDir, "presentation", { mp4: 1_000_000 });
    expect(pickDeliverable({ outDir, slug: "presentation", startedAtMs: 999_000 })).toBe(
      path.join(outDir, "presentation.mp4"),
    );
  });

  it("本次跑降级了（`.realtime.mp4` 是本次写的）→ 交付降级产物", () => {
    const outDir = tmpRepo("pick-realtime");
    const startedAtMs = 2_000_000;
    // 两份都在盘上（编码早于自校验 ⇒ 那份 mp4 未通过校验，不是交付物）
    seed(outDir, "presentation", { mp4: startedAtMs + 10, realtime: startedAtMs + 500 });
    expect(pickDeliverable({ outDir, slug: "presentation", startedAtMs })).toBe(
      path.join(outDir, `presentation${REALTIME_SUFFIX}.mp4`),
    );
  });

  it("上一轮残留的降级产物（mtime < 本次起点）→ 仍交付本次的确定性成片", () => {
    const outDir = tmpRepo("pick-stale-realtime");
    const startedAtMs = 3_000_000;
    seed(outDir, "presentation", { mp4: startedAtMs + 10, realtime: startedAtMs - 60_000 });
    expect(pickDeliverable({ outDir, slug: "presentation", startedAtMs })).toBe(
      path.join(outDir, "presentation.mp4"),
    );
  });
});

describe("runRender · 进度注入（onProgress 接的是帧流阶段的真实落盘）", () => {
  it("首报 (0,total) → 帧流期间逐步递增 → 末报 (total,total)（单调、终值等于总步数）", async () => {
    const repo = tmpRepo("progress");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const seen: Array<{ done: number; total: number }> = [];
    const outDir = path.join(repo, "render");
    const workDir = path.join(outDir, "presentation");

    // 假帧流：**真落盘**（逐步、带间隔）——进度观测面读的就是产物本身，不是替身的私有信号
    const fakeCapture = async (
      specs: readonly FrameSpec[],
      opts: CaptureFramesOptions,
    ): Promise<CapturedStep[]> => {
      for (const spec of specs) {
        const step = opts.timeline.steps.find(
          (s) => s.chapter === spec.chapter && s.step === spec.step,
        )!;
        const rel = framePaths(frameDir(spec.chapterId, spec.step), step.frameCount);
        const dir = path.join(workDir, frameDir(spec.chapterId, spec.step));
        fs.mkdirSync(dir, { recursive: true });
        for (const frame of rel) fs.writeFileSync(path.join(workDir, frame), "png");
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return specs.map((spec): CapturedStep => {
        const step = opts.timeline.steps.find(
          (s) => s.chapter === spec.chapter && s.step === spec.step,
        )!;
        return {
          ...spec,
          dir: frameDir(spec.chapterId, spec.step),
          frameCount: step.frameCount,
          animMs: step.animMs,
          holdMs: step.holdMs,
          warnings: [],
        };
      });
    };

    const code = await runRender(
      {
        outDir,
        mockAudio: false,
        realisticAudio: false,
        concurrency: 2,
        only: undefined,
        verifyDeterminism: false,
        help: false,
      },
      makeDeps(repo, rec, {
        captureFrames: fakeCapture,
        onProgress: (done, total) => seen.push({ done, total }),
      }),
      io,
    );

    expect(code).toBe(0);
    expect(seen[0]).toEqual({ done: 0, total: 3 });
    expect(seen[seen.length - 1]).toEqual({ done: 3, total: 3 });
    // 单调不减（页面的进度条只许往前走），且 total 一直是同一条子时间轴的步数
    expect(seen.every((s) => s.total === 3)).toBe(true);
    expect(seen.every((s, i) => i === 0 || s.done >= seen[i - 1].done)).toBe(true);
    // 帧流期间至少有一次中间读数（"0 → 3 一步跳完"会退化成假进度）
    expect(seen.length).toBeGreaterThan(2);
  }, 30_000);
});
