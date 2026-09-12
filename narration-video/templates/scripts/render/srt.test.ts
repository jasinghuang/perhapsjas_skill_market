// M5b Task 2 单测：SRT 副产物（**纯派生**——narrations × 时间轴表，不含任何画面/音频依赖）。
//
// 钉住三件事：
//   1. **空 narration 的判据与引擎同源**：喂 `hasAudio`（`scripts/storyboard/data.ts` 的 trim 口径）
//      —— 空白串（"   "）不出条目；App 的**裸真值**口径会把它当"有稿"（本表不出，见用例）。
//   2. **时间码来自时间轴表的 `startMs` / `stepMs`**，不来自音频实测（也不来自 verify 的
//      `expectedMs`——那是"音频内容起点"的锚，比真内容起点早 ≤5ms，两回事）。
//   3. **文本面**：序号 1..n、`-->` 时间行、空行分隔、末尾换行；空表 → 空文本（非空护栏，不抛）。
//
// 编排面（`--no-srt` 开关、`<outDir>/<slug>.srt` 的落盘与"与成片同一张子时间轴"）在文件下半部：
// 那里用的是 render.test.ts 同款的**注入式假依赖**（不启浏览器、不起 Vite、不跑 ffmpeg）。

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stageConfig } from "../../src/engine/runtime-config";
import type { EncodeOptions, EncodeResult } from "./encode";
import type { CaptureFramesOptions, CapturedStep, FrameSpec } from "./frames";
import type { VerifyOptions } from "./verify";
import { buildTimeline, type Timeline, type TimelineStep } from "./timeline";
import { hasAudio } from "../storyboard/data";
import {
  RENDER_USAGE,
  parseArgs,
  runRender,
  type RenderArgs,
  type RenderChapter,
  type RenderDeps,
  type RenderIo,
} from "../render";
import { buildSrtCues, formatSrtTime, renderSrt } from "./srt";

// ── 夹具 ──

/** 合成时间轴（纯函数面用：不碰 fs/网络；口径与 render.test.ts 的 makeTimeline 同款）。 */
function makeTimeline(
  steps: Array<Partial<TimelineStep> & { chapterId: string; step: number }>,
): Timeline {
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

// ── 时间码 ──

describe("formatSrtTime（SRT 时间码：HH:MM:SS,mmm）", () => {
  it("简报三条：0 → 00:00:00,000；1234 → 00:00:01,234；3661001 → 01:01:01,001", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(1234)).toBe("00:00:01,234");
    expect(formatSrtTime(3661001)).toBe("01:01:01,001");
  });

  it("非整毫秒四舍五入（音频实测时长是浮点，时间轴的 startMs 就可能是小数）；进位不出 60", () => {
    expect(formatSrtTime(1234.4)).toBe("00:00:01,234");
    expect(formatSrtTime(1234.6)).toBe("00:00:01,235");
    // 进位连锁：59.9995s → 下一秒，而不是 "00:00:59,1000" / "00:00:60,000"
    expect(formatSrtTime(59999.6)).toBe("00:01:00,000");
    expect(formatSrtTime(3599999.6)).toBe("01:00:00,000");
  });

  it("负数 / 非有限 → throw（SRT 无负时间码；静默出 00:00:00,000 会把坏时间轴藏起来）", () => {
    expect(() => formatSrtTime(-1)).toThrow(/负/);
    expect(() => formatSrtTime(Number.NaN)).toThrow(/有限/);
    expect(() => formatSrtTime(Number.POSITIVE_INFINITY)).toThrow(/有限/);
  });
});

// ── 条目（narrations × 时间轴表） ──

describe("buildSrtCues（条目 = 非空 narration 步；trim 口径与引擎 hasAudio 同源）", () => {
  const chapters = [{ narrations: ["第一句", "   ", "第三句"] }];

  it("空白串（\"   \"）不出条目——判据是 hasAudio 的 trim 口径，不是 App 的裸真值口径", () => {
    // 同源取证：本文件用的判据就是引擎那份（`hasAudio("   ") === false` 是**引擎**说的）
    expect(hasAudio("   ")).toBe(false);
    const cues = buildSrtCues(
      makeTimeline([
        { chapterId: "example", step: 0, stepMs: 1000 },
        { chapterId: "example", step: 1, stepMs: 2000 },
        { chapterId: "example", step: 2, stepMs: 3000 },
      ]),
      chapters,
    );
    // 中间那条是空白串 ⇒ 只剩 0 / 2 两步；且**序号连续 1..n**（不是 step 下标——跳号会被读出"缺一条"）
    expect(cues.map((c) => [c.index, c.startMs, c.endMs])).toEqual([
      [1, 0, 1000],
      [2, 3000, 6000],
    ]);
  });

  it("判据与 hasAudio 逐例一致（\"\" / 空白 / 制表符 / 换行都算空；前后空白不改变判空）", () => {
    for (const blank of ["", " ", "   ", "\t", "\n", " \t\n "]) {
      expect(hasAudio(blank)).toBe(false);
      expect(buildSrtCues(makeTimeline([{ chapterId: "example", step: 0 }]), [
        { narrations: [blank] },
      ])).toEqual([]);
    }
    expect(hasAudio("  有稿  ")).toBe(true);
  });

  it("条目 = [startMs, startMs + stepMs)；不依赖音频是否存在（audioMs=null 的未合成步照样出）", () => {
    const timeline = makeTimeline([
      { chapterId: "example", step: 0, stepMs: 3400, audioMs: 1750 },
      { chapterId: "example", step: 1, stepMs: 2350, audioMs: null },
    ]);
    const cues = buildSrtCues(timeline, [{ narrations: ["有实测音频", "未合成（估时兜底）"] }]);
    expect(cues).toEqual([
      { index: 1, startMs: 0, endMs: 3400, text: "有实测音频" },
      { index: 2, startMs: 3400, endMs: 5750, text: "未合成（估时兜底）" },
    ]);
  });

  it("文本走 trim（前后空白在字幕里只会变成视觉偏移）；内部空白原样保留", () => {
    const cues = buildSrtCues(makeTimeline([{ chapterId: "example", step: 0 }]), [
      { narrations: ["  前后有空白  "] },
    ]);
    expect(cues[0].text).toBe("前后有空白");
  });

  it("真实时间轴（buildTimeline）× 章节 narrations：时间码 = 前缀和，空步跳过（同一条链的端到端口径）", () => {
    const built = buildTimeline({
      chapters: [
        { id: "example", folder: "01-example", steps: 4, narrations: ["第一句", "", "   ", "第四句"] },
      ],
      durations: { example: [1750, 1750] },
      timings: { example: { dwell: { "1": 600 } } },
      animMsByStep: [[3000, 0, 0, 0]],
      profileHoldMs: 400,
    });
    const cues = buildSrtCues(built, [
      { narrations: ["第一句", "", "   ", "第四句"] },
    ]);
    // 0: max(1750,3000)+400 = 3400；1: 1500(估时,空稿)+600(dwell) = 2100；2: 1500+400 = 1900；
    // 3: 1750(第二条实测时长，按非空句顺序对位)+400 = 2150
    expect(cues).toEqual([
      { index: 1, startMs: 0, endMs: 3400, text: "第一句" },
      { index: 2, startMs: 3400 + 2100 + 1900, endMs: 3400 + 2100 + 1900 + 2150, text: "第四句" },
    ]);
    // 末条时间码的终点 == 成片总长（SRT 与成片同一条时间轴）
    expect(cues[cues.length - 1].endMs).toBe(built.totalMs);
  });

  it("章节下标 / 步序越界 → throw（静默少一条 = 有声无字；拿错章节的稿顶替更糟）", () => {
    const timeline = makeTimeline([{ chapterId: "example", step: 0, chapter: 3 }]);
    expect(() => buildSrtCues(timeline, [{ narrations: ["第一句"] }])).toThrow(/章节下标 3/);
    const short = makeTimeline([{ chapterId: "example", step: 5 }]);
    expect(() => buildSrtCues(short, [{ narrations: ["第一句"] }])).toThrow(/第 5 步/);
  });

  it("非空护栏：空时间轴 → 空数组（不抛）", () => {
    expect(buildSrtCues({ steps: [], totalMs: 0, fps: 30 }, [{ narrations: ["有稿"] }])).toEqual([]);
  });
});

// ── 文本面 ──

describe("renderSrt（序号 + `-->` 时间行 + 空行分隔 + 末尾换行）", () => {
  it("两条的逐字文本（空行分隔、末尾一个换行）", () => {
    const cues = [
      { index: 1, startMs: 0, endMs: 3400, text: "这是第一句口播" },
      { index: 2, startMs: 3400, endMs: 5750, text: "这是第二句口播" },
    ];
    expect(renderSrt(cues)).toBe(
      "1\n" +
        "00:00:00,000 --> 00:00:03,400\n" +
        "这是第一句口播\n" +
        "\n" +
        "2\n" +
        "00:00:03,400 --> 00:00:05,750\n" +
        "这是第二句口播\n",
    );
  });

  it("空 cues → 空文本（非空护栏：不抛、也不吐一个孤零零的换行）", () => {
    expect(renderSrt([])).toBe("");
    expect(renderSrt(buildSrtCues({ steps: [], totalMs: 0, fps: 30 }, []))).toBe("");
  });

  it("与 buildSrtCues 串起来：序号 1..n、条数 = 非空步数", () => {
    const cues = buildSrtCues(
      makeTimeline([
        { chapterId: "example", step: 0, stepMs: 1000 },
        { chapterId: "example", step: 1, stepMs: 1000 },
        { chapterId: "example", step: 2, stepMs: 1000 },
      ]),
      [{ narrations: ["第一句", "   ", "第三句"] }],
    );
    const text = renderSrt(cues);
    expect(text.match(/-->/g)).toHaveLength(2);
    expect(text.match(/^\d+$/gm)).toEqual(["1", "2"]);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

// ── CLI 开关（`--no-srt`） ──

describe("parseArgs / RENDER_USAGE：--no-srt", () => {
  it("--no-srt → 关掉；缺省 → 不设（默认写——SRT 是文本副产物，与画面开关无关）", () => {
    expect(parseArgs(["--no-srt"], "/tmp").noSrt).toBe(true);
    expect(parseArgs([], "/tmp").noSrt).toBeUndefined();
    // 拼错的兄弟 flag 不得被当成 --no-srt（解析器只认逐字相等）
    expect(() => parseArgs(["--no-srts"], "/tmp")).toThrow(/未知参数/);
  });

  it("用法文案点名 --no-srt（用户照 --help 抄得到的才是真开关）", () => {
    expect(RENDER_USAGE).toContain("--no-srt");
    // 未知 flag 的文案里也列出（USAGE_FLAGS 与解析器同源；漏了它等于"支持的标志"缺一项）
    expect(() => parseArgs(["--nope"], "/tmp")).toThrow(/--no-srt/);
  });
});

// ── 编排面（默认写 <outDir>/<slug>.srt；--no-srt 关） ──

/** 模板 example 章节的实况（与 render.test.ts 同一条算例：3400 / 2350 / 1900，总 7650）。 */
const CHAPTERS: RenderChapter[] = [
  { id: "example", folder: "01-example", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] },
];
const TIMINGS = { example: { dwell: { "1": 600 } } };
const WINDOW_TABLE = [[3000, 0, 0]];

/** 成片的字幕（两条：第 2 步空稿不出条目；时间码 = 前缀和，末条终点 = 7650 = 成片总长）。 */
const EXPECTED_SRT =
  "1\n" +
  "00:00:00,000 --> 00:00:03,400\n" +
  "这是第一句口播\n" +
  "\n" +
  "2\n" +
  "00:00:03,400 --> 00:00:05,750\n" +
  "这是第二句口播\n";

const tmpDirs: string[] = [];

function tmpRepo(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `srt-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

// 本文件自建 tmp 仓库（render.test.ts 的 seedRepo 款）；跑完清掉——它们只服务这一轮断言。
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** 铺开最小可渲仓库（render.test.ts 的 seedRepo 同款；本文件只用得到 durations + mp3 占位）。 */
function seedRepo(repo: string, durations: unknown, files: string[]): void {
  const dir = path.join(repo, "src", "chapters", "01-example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(TIMINGS.example));
  fs.mkdirSync(path.join(repo, "public"), { recursive: true });
  fs.writeFileSync(path.join(repo, "public", "audio-durations.json"), JSON.stringify(durations));
  for (const rel of files) {
    const abs = path.join(repo, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "not-a-real-mp3");
  }
}

interface Recorded {
  calls: string[];
  capture?: { specs: readonly FrameSpec[]; opts: CaptureFramesOptions };
  encode?: EncodeOptions;
  verify?: VerifyOptions;
}

function makeDeps(repo: string, rec: Recorded, over: Partial<RenderDeps> = {}): RenderDeps {
  return {
    repoRoot: repo,
    loadChapters: async () => CHAPTERS,
    startServe: async () => {
      rec.calls.push("serve");
      return { url: "http://localhost:5174/", stop: async () => void rec.calls.push("serve:stop") };
    },
    scanAnimationWindows: async () => {
      rec.calls.push("scan");
      return { animMsByStep: WINDOW_TABLE, frameCountByStep: [[1, 0, 0]] };
    },
    captureFrames: async (specs, opts) => {
      rec.calls.push("capture");
      rec.capture = { specs, opts };
      return specs.map((spec): CapturedStep => {
        const step = opts.timeline.steps.find(
          (s) => s.chapter === spec.chapter && s.step === spec.step,
        )!;
        return {
          ...spec,
          dir: `frames/${spec.chapterId}/${spec.step}`,
          frameCount: step.frameCount,
          animMs: step.animMs,
          holdMs: step.holdMs,
          warnings: [],
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
    ...over,
  };
}

function makeIo(): { io: RenderIo; lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { io: { log: (l) => void lines.push(l), error: (l) => void errors.push(l) }, lines, errors };
}

function argsOf(repo: string, over: Partial<RenderArgs> = {}): RenderArgs {
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

/** 两条 mp3 占位 + 对应的实测时长（第 2 步是空稿，不吃条目也不吃文件）。 */
function seedRenderedRepo(repo: string): void {
  seedRepo(repo, { example: [1750, 1750] }, [
    "public/audio/01-example/0.mp3",
    "public/audio/01-example/1.mp3",
  ]);
}

describe("runRender 编排：SRT 副产物（纯派生自同一张子时间轴）", () => {
  it("默认写 <outDir>/<slug>.srt：逐字内容与成片同源（时间码 = 时间轴的 startMs/stepMs）", async () => {
    const repo = tmpRepo("default");
    seedRenderedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io, lines } = makeIo();

    const code = await runRender(argsOf(repo), makeDeps(repo, rec), io);

    expect(code).toBe(0);
    const srtFile = path.join(repo, "render", `${stageConfig.slug}.srt`);
    expect(fs.readFileSync(srtFile, "utf8")).toBe(EXPECTED_SRT);
    // 与成片同源：同一张子时间轴（verify/encode 拿的就是它）+ 与 verify 那次同一个产物目录
    const cues = buildSrtCues(rec.verify!.timeline, CHAPTERS);
    expect(fs.readFileSync(srtFile, "utf8")).toBe(renderSrt(cues));
    expect(rec.verify!.output).toBe(path.join(repo, "render", `${stageConfig.slug}.mp4`));
    // 日志点名产物（库内相对、库外绝对——tmp 仓库在 cwd 之外，故这里是绝对路径，与 displayPath 同款）
    expect(lines.some((l) => l.includes("[render] 字幕副产物：") && l.includes(srtFile))).toBe(true);
  });

  it("--no-srt → 不写（其余产物/编排照旧；明示一行，不静默）", async () => {
    const repo = tmpRepo("no-srt");
    seedRenderedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io, lines } = makeIo();

    const code = await runRender(argsOf(repo, { noSrt: true }), makeDeps(repo, rec), io);

    expect(code).toBe(0);
    expect(fs.existsSync(path.join(repo, "render", `${stageConfig.slug}.srt`))).toBe(false);
    // 画面链一步不少（SRT 是纯文本副产物，关它不该动任何渲染步骤）
    expect(rec.calls).toEqual(["serve", "scan", "capture", "encode", "verify", "serve:stop"]);
    expect(lines.some((l) => l.includes("--no-srt"))).toBe(true);
  });

  it("--only 0 → 只含被渲的步，时间码按**子时间轴**从 0 起（与子成片同源，不是全表前缀和）", async () => {
    const repo = tmpRepo("only");
    seedRenderedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();

    const code = await runRender(argsOf(repo, { only: [0] }), makeDeps(repo, rec), io);

    expect(code).toBe(0);
    const text = fs.readFileSync(path.join(repo, "render", `${stageConfig.slug}.srt`), "utf8");
    expect(text).toBe("1\n00:00:00,000 --> 00:00:03,400\n这是第一句口播\n");
  });

  // M5b T4：缺省下"自校验红"改走实时捕获降级（退出码 0 + .realtime.mp4），故本条取严格模式
  // （`--no-fallback`）——它钉的是"SRT 的写法与自校验成败无关"，不是降级行为本身。
  it("自校验红（退出码 1）也照写：字幕跟着**产物**走，不跟着门禁走（成片在，字幕就该在）", async () => {
    const repo = tmpRepo("verify-red");
    seedRenderedRepo(repo);
    const rec: Recorded = { calls: [] };
    const { io } = makeIo();

    const code = await runRender(
      argsOf(repo, { noFallback: true }),
      makeDeps(repo, rec, {
        verifyRender: async () => ({ ok: false, lines: [], failures: ["[失败] 时长差 999ms"] }),
      }),
      io,
    );

    expect(code).toBe(1);
    expect(fs.readFileSync(path.join(repo, "render", `${stageConfig.slug}.srt`), "utf8")).toBe(EXPECTED_SRT);
  });
});
