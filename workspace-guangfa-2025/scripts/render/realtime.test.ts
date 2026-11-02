// M5b Task 4 单测：实时捕获降级（§8 step 4 的逃生舱）的**纯函数面 + 接线面**。
//
// 两条已实测钉死的死因（质检 #2 C1#1/C1#2，本文件用测试钉住"不得再犯"）：
//   ① `openSession` 恒加 `headless=1`，而页面守卫 `if (renderMode || params.has("headless")) return;`
//      直接摘掉自驱推进链 ⇒ 录到的是**冻在第 0 步的静止画面**。故 captureRealtime **自开会话**
//      （chromium.launch + newContext），URL 也必须是**裸 `?auto=1`**（assertRealtimeUrl 挡两条）。
//   ② 裸 `?auto=1` 下 Chromium 的自动播放策略会拒 `audio.play()`（NotAllowedError）⇒ 没有
//      `--autoplay-policy=no-user-gesture-required` 就是全程静止（REALTIME_LAUNCH_ARGS 钉住）。
//
// 本文件不启浏览器（真机臂在 realtime.browser.test.ts）：这里钉的是取名/时长口径/URL 归一/
// ffmpeg 命令行形状，以及 runRender 的失败路径接线（verify 红或 seek 断言抛错 → 降级；
// `--no-fallback` 关）。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EncodeAudioOptions, EncodeOptions, EncodeResult } from "./encode";
import type { CapturedStep, FrameSpec } from "./frames";
import { buildTimeline, type Timeline, type TimelineStep } from "./timeline";
import type { VerifyOptions } from "./verify";
import {
  REALTIME_LAUNCH_ARGS,
  REALTIME_MIN_JUDGE_MS,
  REALTIME_TAIL_MS,
  assertRealtimeUrl,
  buildRealtimeFfmpegArgs,
  judgeTrace,
  realtimeDeclaredMs,
  realtimeOutputPath,
  realtimeRecordMs,
  realtimeUrl,
  type RealtimeOptions,
  type RealtimeResult,
} from "./realtime";
import { parseArgs, runRender, type RenderArgs, type RenderChapter, type RenderDeps, type RenderIo } from "../render";
import { stageConfig } from "../../src/engine/runtime-config";

// ── 夹具（与 render.test.ts 同一条算例：3400 / 2350 / 1900，总 7650） ──

const CHAPTERS: RenderChapter[] = [
  { id: "example", folder: "01-example", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] },
];

const TIMINGS = { example: { dwell: { "1": 600 } } };
const WINDOW_TABLE = [[3000, 0, 0]];

const tmpDirs: string[] = [];

function tmpRepo(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `realtime-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function seedRepo(repo: string): void {
  const dir = path.join(repo, "src", "chapters", "01-example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(TIMINGS.example));
  fs.mkdirSync(path.join(repo, "public"), { recursive: true });
  fs.writeFileSync(path.join(repo, "public", "audio-durations.json"), JSON.stringify({ example: [1750, 1750] }));
  for (const rel of ["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"]) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "not-a-real-mp3");
  }
}

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
      holdFrameMs: s.holdFrameMs ?? ((s.holdMs ?? stepMs) > 0 ? [s.animMs ?? 0] : []),
    };
    startMs += stepMs;
    return out;
  });
  return { steps: full, totalMs: startMs, fps: 30 };
}

// ── 纯函数面 ──

describe("实时捕获：启动参数（两条死因之一：自动播放策略）", () => {
  it("REALTIME_LAUNCH_ARGS 含 --autoplay-policy=no-user-gesture-required（照 SOFTWARE_GL_ARGS 款）", () => {
    expect(REALTIME_LAUNCH_ARGS).toContain("--autoplay-policy=no-user-gesture-required");
    // 逐词钉住（不是"含 policy 字样就算"）：flag 写成两个参数（`--autoplay-policy` + 值）
    // Chromium 不认那条，录制会静默退回"一帧死画面"
    for (const arg of REALTIME_LAUNCH_ARGS) expect(arg.startsWith("--")).toBe(true);
    expect(REALTIME_LAUNCH_ARGS.some((a) => a.includes(" "))).toBe(false);
  });
});

describe("实时捕获：URL 归一（另一条死因：自驱推进链被摘掉）", () => {
  it("realtimeUrl：**裸** ?auto=1——清掉既有 query（render/headless/no-subs 都不带）", () => {
    expect(realtimeUrl("http://localhost:5174/")).toBe("http://localhost:5174/?auto=1");
    // headless/render 是两条"摘掉推进链"的守卫参数，绝不能从基址漏进来
    expect(realtimeUrl("http://localhost:5174/?render=1&headless=1")).toBe("http://localhost:5174/?auto=1");
    expect(realtimeUrl("http://localhost:5174/deck?t=123")).toBe("http://localhost:5174/deck?auto=1");
    // 幂等
    expect(realtimeUrl(realtimeUrl("http://localhost:5174/"))).toBe("http://localhost:5174/?auto=1");
  });

  it("assertRealtimeUrl：带 headless 或 render 即 throw（两条死因的入口拦截）", () => {
    expect(() => assertRealtimeUrl("http://localhost:5174/?auto=1")).not.toThrow();
    expect(() => assertRealtimeUrl("http://localhost:5174/?auto=1&headless=1")).toThrow(/headless/);
    expect(() => assertRealtimeUrl("http://localhost:5174/?auto=1&render=1")).toThrow(/render/);
    expect(() => assertRealtimeUrl("http://localhost:5174/")).toThrow(/auto/); // 没有 auto 也不会自驱
  });
});

describe("实时捕获：产物命名与时长口径", () => {
  it("产物命名：<slug>.realtime.mp4（降级必须看得见，日志之外还有名字）", () => {
    expect(realtimeOutputPath("/out", "presentation")).toBe(path.join("/out", "presentation.realtime.mp4"));
    expect(realtimeOutputPath("/out/", "presentation")).toBe(path.join("/out", "presentation.realtime.mp4"));
  });

  it("声明时长 = timeline.totalMs（时间轴口径，不是墙钟/录制窗口）", () => {
    const timeline = makeTimeline([
      { chapterId: "a", step: 0, stepMs: 3400 },
      { chapterId: "a", step: 1, stepMs: 1900 },
    ]);
    expect(realtimeDeclaredMs(timeline)).toBe(5300);
    expect(realtimeDeclaredMs(timeline)).toBe(timeline.totalMs);
  });

  it("录制窗口 = totalMs + 尾部余量（页面装载/步间抖动；产物随后被 -shortest 收到音轨长度）", () => {
    const timeline = makeTimeline([{ chapterId: "a", step: 0, stepMs: 2000 }]);
    expect(realtimeRecordMs(timeline)).toBe(2000 + REALTIME_TAIL_MS);
    expect(REALTIME_TAIL_MS).toBeGreaterThan(0);
  });
});

describe("实时捕获：ffmpeg 命令行形状（webm/VP8/25fps → mp4/30fps + 音轨 mux）", () => {
  it("有音轨：两路输入 + 显式 map + 30fps/CFR + yuv420p + aac + -shortest + -t 声明时长", () => {
    const args = buildRealtimeFfmpegArgs({
      video: "/tmp/in.webm",
      audioTrack: "/tmp/audio.m4a",
      output: "/out/presentation.realtime.mp4",
      durationMs: 7650,
    });
    expect(args).toContain("/tmp/in.webm");
    expect(args).toContain("/tmp/audio.m4a");
    expect(args.join(" ")).toContain("-map 0:v:0");
    expect(args.join(" ")).toContain("-map 1:a:0");
    // recordVideo 出的是 25fps 的 webm：不重采样到 30fps 就跟确定性成片的帧率口径对不上
    expect(args.join(" ")).toContain("-r 30");
    expect(args.join(" ")).toContain("-fps_mode cfr");
    expect(args.join(" ")).toContain("-c:v libx264");
    expect(args.join(" ")).toContain("-pix_fmt yuv420p");
    expect(args.join(" ")).toContain("-c:a aac");
    expect(args).toContain("-shortest"); // 视频录得比音轨长：收在音轨那侧
    expect(args.join(" ")).toContain("-t 7.650"); // 声明时长是产物的上界
    expect(args[args.length - 2]).toBe("/out/presentation.realtime.mp4");
    expect(args[args.length - 1]).toBe("-y");
  });

  it("无音轨（audioTrack=null）：单路输入、不 mux、不 -shortest，但**仍顶 -t**（无声片不得超长）", () => {
    const args = buildRealtimeFfmpegArgs({
      video: "/tmp/in.webm",
      audioTrack: null,
      output: "/out/presentation.realtime.mp4",
      durationMs: 5870,
    });
    const joined = args.join(" ");
    expect(joined).not.toContain("-shortest");
    expect(joined).not.toContain("-c:a");
    expect(joined).not.toContain("-i /tmp/audio.m4a");
    expect(joined).toContain("-c:v libx264");
    expect(joined).toContain("-r 30");
    // 无音轨时 `-shortest` 无从收口：录制窗口 = 声明 + 尾部 + 装载，唯一的界就是它
    expect(joined).toContain("-t 5.870");
    expect(args[args.length - 1]).toBe("-y");
  });
});

describe("定格判据（judgeTrace）：有牙，但不误伤'窗口太短'", () => {
  const THREE_STEP = makeTimeline([
    { chapterId: "a", step: 0, stepMs: 3400 },
    { chapterId: "a", step: 1, stepMs: 2350 },
    { chapterId: "a", step: 2, stepMs: 1900 },
  ]);
  const moved = [
    { chapter: 0, step: 0 },
    { chapter: 0, step: 1 },
    { chapter: 0, step: 2 },
  ];

  it("推进正常 → 不告警不拦（ok 是缺省态，不产噪音）", () => {
    const v = judgeTrace(moved, realtimeRecordMs(THREE_STEP), THREE_STEP);
    expect(v.fatal).toBeUndefined();
    expect(v.warn).toBeUndefined();
  });

  it("多步 deck 上一步都没动（窗口够长）→ **fatal**（定格假绿的现场拦截）", () => {
    const v = judgeTrace([{ chapter: 0, step: 0 }], realtimeRecordMs(THREE_STEP), THREE_STEP);
    expect(v.fatal).toContain("一步都没动");
    // 文案必须带现场读数，否则排查者只能猜（评审 M1：子表首步 / 观测窗口 / 观测次数）
    expect(v.fatal).toContain("子表首步 章节 0 第 0 步（3400ms）");
    expect(v.fatal).toContain(`观测窗口 ${realtimeRecordMs(THREE_STEP)}ms`);
    expect(v.fatal).toContain("观测 1 次");
  });

  it("观测窗口短于判定下限 → 只告警不拦（'没动'与'还停在第 0 步'不可区分，别把健康页面判死）", () => {
    const short = makeTimeline([
      { chapterId: "a", step: 0, stepMs: 300 },
      { chapterId: "a", step: 1, stepMs: 300 },
    ]);
    expect(realtimeRecordMs(short)).toBeLessThan(REALTIME_MIN_JUDGE_MS); // 夹具确实落在短窗口一侧
    const v = judgeTrace([{ chapter: 0, step: 0 }], realtimeRecordMs(short), short);
    expect(v.fatal).toBeUndefined();
    expect(v.warn).toContain("短于定格判据的下限");
  });

  it("一次观测都没有（桥不可用）→ 只告警不拦（观测面缺失 ≠ 画面是死的）", () => {
    const v = judgeTrace([], realtimeRecordMs(THREE_STEP), THREE_STEP);
    expect(v.fatal).toBeUndefined();
    expect(v.warn).toContain("没有任何游标观测");
  });

  it("单步 deck：没有第二步可观测，不做判据（也不为'没动'告警）", () => {
    const one = makeTimeline([{ chapterId: "a", step: 0, stepMs: 3400 }]);
    const v = judgeTrace([{ chapter: 0, step: 0 }], realtimeRecordMs(one), one);
    expect(v.fatal).toBeUndefined();
    expect(v.warn).toBeUndefined();
  });
});

// ── 接线面（runRender 的失败路径；注入式 deps：不启浏览器、不起 Vite、不跑 ffmpeg） ──

interface Recorded {
  calls: string[];
  realtime?: RealtimeOptions;
  verify?: VerifyOptions;
  encode?: EncodeOptions;
  /** C-1：编码前失败时自建音轨的入参（段与 fps 必须与确定性路径同一份） */
  audio?: EncodeAudioOptions;
}

function makeIo(): { io: RenderIo; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { io: { log: (l) => void lines.push(l), error: (l) => void errors.push(l) }, lines, errors };
}

const OK_RESULT: RealtimeResult = {
  file: "/out/presentation.realtime.mp4",
  declaredMs: 7650,
  durationMs: 7700,
  cursorTrace: [{ chapter: 0, step: 0 }],
};

function makeDeps(repo: string, rec: Recorded, over: Partial<RenderDeps> = {}): RenderDeps {
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
      return { animMsByStep: WINDOW_TABLE, frameCountByStep: [[1, 0, 0]] };
    },
    captureFrames: async (specs: readonly FrameSpec[], opts) => {
      rec.calls.push("capture");
      return specs.map((spec): CapturedStep => {
        const step = opts.timeline.steps.find((s) => s.chapter === spec.chapter && s.step === spec.step)!;
        return {
          ...spec,
          dir: `frames/${spec.chapterId}/${spec.step}`,
          frameCount: step.frameCount,
          animMs: step.animMs,
          holdMs: step.holdMs,
          holdFrameMs: step.holdFrameMs,
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
    realtimeCapture: async (opts) => {
      rec.calls.push("realtime");
      rec.realtime = opts;
      return OK_RESULT;
    },
    ...over,
  };
}

function baseArgs(repo: string, over: Partial<RenderArgs> = {}): RenderArgs {
  return {
    outDir: path.join(repo, "render"),
    mockAudio: false,
    realisticAudio: false,
    concurrency: 2,
    only: undefined,
    verifyDeterminism: false,
    help: false,
    ...over,
  };
}

describe("--no-fallback（降级逃生舱的关断开关）", () => {
  it("parseArgs：缺省不开（可选字段，既有 args 字面量一行未动）；显式 --no-fallback 才 true", () => {
    expect(parseArgs([], "/tmp").noFallback).toBeUndefined();
    expect(parseArgs(["--no-fallback"], "/tmp").noFallback).toBe(true);
  });
});

describe("runRender 失败路径接线：确定性链路失败 → 实时捕获降级", () => {
  it("自校验未过 → 降级出片（同一张子时间轴 + 同一份确定性音轨 + 裸 ?auto=1）；退出码 0", async () => {
    const repo = tmpRepo("verify-red");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io, lines, errors } = makeIo();
    const code = await runRender(
      baseArgs(repo),
      makeDeps(repo, rec, {
        verifyRender: async (opts) => {
          rec.calls.push("verify");
          rec.verify = opts;
          return { ok: false, lines: ["成片时长不符"], failures: ["[失败] 成片时长不符"] };
        },
      }),
      io,
    );

    expect(code).toBe(0);
    expect(rec.calls).toEqual(["serve", "scan", "capture", "encode", "verify", "realtime", "serve:stop"]);
    // 降级吃的是**同一张子时间轴**（时长/步边界同源）与**同一份确定性音轨**（降级不得失声）
    expect(rec.realtime?.timeline).toBe(rec.verify?.timeline);
    expect(rec.realtime?.audioTrack).toBe(path.join(repo, "render", stageConfig.slug, "audio.m4a"));
    expect(rec.realtime?.outDir).toBe(path.join(repo, "render"));
    expect(rec.realtime?.slug).toBe(stageConfig.slug);
    expect(rec.realtime?.viewport).toEqual({ width: 1920, height: 1080 });
    // URL 是**裸 ?auto=1**（render/headless 都在摘掉自驱推进链的那一列）
    expect(rec.realtime?.url).toContain("auto=1");
    expect(rec.realtime?.url).not.toContain("headless");
    expect(rec.realtime?.url).not.toContain("render=1");
    expect(rec.realtime?.url).not.toContain("no-subs"); // 没要无字幕版就别加
    // 响亮：日志明写降级与原因（不静默改口径）
    expect(lines.join("\n")).toContain("已降级为实时捕获（确定性链路失败：");
    expect(lines.join("\n")).toContain("成片时长不符");
    expect(lines.join("\n")).toContain(".realtime.mp4");
    expect(errors.join("\n")).toContain("成片时长不符");
  });

  it("`--no-subs` 在降级路径同样生效：URL 带 no-subs=1（但仍不含 headless/render）", async () => {
    const repo = tmpRepo("no-subs");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const code = await runRender(
      baseArgs(repo, { noSubs: true }),
      makeDeps(repo, rec, {
        verifyRender: async () => {
          rec.calls.push("verify");
          return { ok: false, lines: [], failures: ["[失败] 成片时长不符"] };
        },
      }),
      io,
    );

    expect(code).toBe(0);
    // 字幕是**像素**（Stage 的框架级闸门）：请求了无字幕版就得一路带到降级产物，
    // 否则用户拿到的是"我要的就是无字幕版"之外的另一种片子，且没有任何一行日志说明
    expect(rec.realtime?.url).toContain("no-subs=1");
    expect(rec.realtime?.url).toContain("auto=1");
    expect(rec.realtime?.url).not.toContain("headless");
    expect(rec.realtime?.url).not.toContain("render=1");
  });

  it("seek 断言抛错（captureFrames throw，**编码前失败**）→ 降级仍**自建音轨**（C-1：降级不得失声）", async () => {
    const repo = tmpRepo("seek-throw");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io, lines, errors } = makeIo();
    const code = await runRender(
      baseArgs(repo),
      makeDeps(repo, rec, {
        captureFrames: async () => {
          rec.calls.push("capture");
          throw new Error("seek 断言失败：窗口内动画未归位");
        },
        encodeAudioTrack: async (opts) => {
          rec.calls.push("audio");
          rec.audio = opts;
          return path.join(opts.outDir, "audio.m4a");
        },
      }),
      io,
    );

    expect(code).toBe(0);
    // encode 没跑过 ⇒ 没有编码产物可复用 ⇒ 降级路径**自建**音轨（旧口径在这条路上交无声片：
    // §8 步骤 4 的主触发恰好在 encode 之前，评审真机实测产物只有 video 流）
    expect(rec.calls).toEqual(["serve", "scan", "capture", "audio", "realtime", "serve:stop"]);
    expect(rec.realtime?.audioTrack).toBe(path.join(repo, "render", stageConfig.slug, "audio.m4a"));
    // 音源与确定性路径**同一份**：segments（public/audio/<folder>/<step>.mp3 + 时间轴 stepMs）+ fps
    expect(rec.audio?.fps).toBe(30);
    expect(rec.audio?.segments.map((s) => s.stepMs)).toEqual(
      rec.realtime?.timeline.steps.map((s) => s.stepMs),
    );
    expect(rec.audio?.outDir).toBe(path.join(repo, "render", stageConfig.slug));
    expect(lines.join("\n")).toContain("自建音轨");
    expect(lines.join("\n")).toContain(
      "已降级为实时捕获（确定性链路失败：seek 断言失败：窗口内动画未归位）",
    );
    // 不再出现"无声"的降级标注（那时有声）；注意别把步骤行里的"无声过场（无音频）"读成它
    expect(lines.join("\n") + errors.join("\n")).not.toContain("降级产物**无声**");
    expect(errors.join("\n")).not.toContain("自建音轨失败");
  });

  it("编码前失败 **且**自建音轨也失败 → 照旧出片，但响亮标注**无声**（残余路径，不许静默）", async () => {
    const repo = tmpRepo("audio-throw");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io, errors } = makeIo();
    const code = await runRender(
      baseArgs(repo),
      makeDeps(repo, rec, {
        captureFrames: async () => {
          rec.calls.push("capture");
          throw new Error("seek 断言失败");
        },
        encodeAudioTrack: async () => {
          rec.calls.push("audio");
          throw new Error("ffmpeg 不可用");
        },
      }),
      io,
    );

    expect(code).toBe(0); // 逃生舱的意义是"仍能交给用户一条片子"
    expect(rec.calls).toEqual(["serve", "scan", "capture", "audio", "realtime", "serve:stop"]);
    expect(rec.realtime?.audioTrack).toBeNull();
    expect(errors.join("\n")).toContain("自建音轨失败");
    expect(errors.join("\n")).toContain("无声");
  });

  it("自校验自身抛错（verifyRender throw，如跨会话重采的 seek 断言）→ 降级", async () => {
    const repo = tmpRepo("verify-throw");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const code = await runRender(
      baseArgs(repo),
      makeDeps(repo, rec, {
        verifyRender: async () => {
          rec.calls.push("verify");
          throw new Error("重采游标回读不符");
        },
      }),
      io,
    );

    expect(code).toBe(0);
    expect(rec.calls).toEqual(["serve", "scan", "capture", "encode", "verify", "realtime", "serve:stop"]);
    expect(rec.realtime?.audioTrack).toBe(path.join(repo, "render", stageConfig.slug, "audio.m4a"));
  });

  it("--no-fallback：确定性链路失败照旧抛/报红，不碰实时捕获（严格模式）", async () => {
    const repo = tmpRepo("no-fallback");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const code = await runRender(
      baseArgs(repo, { noFallback: true }),
      makeDeps(repo, rec, {
        verifyRender: async () => {
          rec.calls.push("verify");
          return { ok: false, lines: [], failures: ["[失败] 成片时长不符"] };
        },
      }),
      io,
    );
    expect(code).toBe(1);
    expect(rec.calls).not.toContain("realtime");

    const rec2: Recorded = { calls: [] };
    await expect(
      runRender(
        baseArgs(repo, { noFallback: true }),
        makeDeps(repo, rec2, {
          captureFrames: async () => {
            throw new Error("seek 断言失败");
          },
        }),
        makeIo().io,
      ),
    ).rejects.toThrow(/seek 断言失败/);
    expect(rec2.calls).not.toContain("realtime");
  });

  it("正常路径（自校验全绿）不降级——逃生舱只在失败时开", async () => {
    const repo = tmpRepo("green");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const code = await runRender(baseArgs(repo), makeDeps(repo, rec), io);
    expect(code).toBe(0);
    expect(rec.calls).toEqual(["serve", "scan", "capture", "encode", "verify", "serve:stop"]);
  });

  it("降级自己失败 → 错误里同时带上两侧原因（不吞真因）", async () => {
    const repo = tmpRepo("fallback-fail");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    await expect(
      runRender(
        baseArgs(repo),
        makeDeps(repo, rec, {
          captureFrames: async () => {
            throw new Error("seek 断言失败：窗口内动画未归位");
          },
          realtimeCapture: async () => {
            throw new Error("未找到 Chromium 浏览器");
          },
        }),
        io,
      ),
    ).rejects.toThrow(/seek 断言失败：窗口内动画未归位[\s\S]*未找到 Chromium 浏览器/);
  });
});

describe("接线面：时间轴口径与降级产物同源", () => {
  it("降级的 timeline 就是 verify 那张（含 --only 的子表）——不是全表、也不是另建一张", async () => {
    const repo = tmpRepo("only");
    seedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();
    const code = await runRender(
      baseArgs(repo, { only: [0] }),
      makeDeps(repo, rec, {
        verifyRender: async (opts) => {
          rec.calls.push("verify");
          rec.verify = opts;
          return { ok: false, lines: [], failures: ["[失败] 帧数不符"] };
        },
      }),
      io,
    );
    expect(code).toBe(0);
    expect(rec.realtime?.timeline.totalMs).toBe(3400);
    expect(rec.realtime?.timeline).toBe(rec.verify?.timeline);
    expect(rec.realtime?.timeline.steps.map((s) => s.step)).toEqual([0]);
  });
});

describe("时间轴表（降级窗口的来源）", () => {
  it("buildTimeline 的实际读数：totalMs 与逐步 stepMs 一致（声明时长的唯一出处）", () => {
    const timeline = buildTimeline({
      chapters: CHAPTERS,
      durations: { example: [1750, 1750] },
      timings: TIMINGS,
      animMsByStep: WINDOW_TABLE,
    });
    expect(timeline.steps.map((s) => s.stepMs)).toEqual([3400, 2350, 1900]);
    expect(realtimeDeclaredMs(timeline)).toBe(7650);
  });
});
