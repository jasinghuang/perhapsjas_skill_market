/**
 * encode.test.ts（M5a Task 5）：编码层的**纯函数面**——视频 concat 清单与音轨 filter_complex。
 *
 * 为什么这两个字符串值得逐字钉死：它们是"音画同步构造保证"的**唯一落点**。帧流（T4）与音轨
 * 各自都对、而清单少 1/fps / 音轨段长错一点，产物就是"看起来对"的错片子——下游自校验（T6）
 * 只看总量，步内错位它看不见。
 *
 * ## 清单形状的三条实测结论（R2 矩阵，真 deck 形状 91/1/1；读数见 task-5-report.md）
 *
 * 1. **`duration` 绑定的是它前面那条 `file`**（concatdec：`file->user_duration`），不是后面那条；
 * 2. **末条 `file` 的 duration 会被丢弃**（后面没有任何条目来消费它）：最小复现——单图 +
 *    `duration 5` 出片 0.033333s（1 帧），同一清单末尾再加一条重复行 → 5.033333s。
 *    末步的静置（真 deck 里 step2 的 1.9s）就靠这条"末尾重复行"存活；
 * 3. **重复行只能出现在清单最后一行**：把它放在中段 → 该重复条目没有 `duration` →
 *    后续条目的起点算出 `AV_NOPTS_VALUE`（实测步 1 的包 pts = -9.2e12），整条时间线错位。
 *    故"每步一条重复行"（计划式）实测出片 9.133333s（期望 7.65）——不可用。
 * 4. **末帧时长直接用 R3 原式** `max(0, stepMs/1000 − (frameCount−1)/fps)`，`stepMs` 由调用方
 *    **逐字传入**（`stepMsByStep`，T7 手里就是 `timeline.steps.map(s => s.stepMs)`）。为什么不
 *    从 `CapturedStep` 反推：T4 的接口没有 `stepMs`，反推只能拿 `frameCount/fps`（= 窗口帧数
 *    向上取整的时长）当它——`stepMs < 窗口帧时长`（`dwell ≤ slack`，`slack ∈ [0, 1/fps)`）时
 *    每步多出 slack 并**逐步累加**（修复轮 1 的 F1：dwell:0 的三步实测 6600ms 声明 vs 6540ms
 *    时间轴）。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CapturedStep } from "./frames";
import { buildTimeline } from "./timeline";
import {
  buildAudioFilterComplex,
  buildVideoConcatList,
  buildVideoLoopArgs,
  encodeVideo,
  splitInputSpecs,
  type AudioSegment,
} from "./encode";

/** 测试产物临时目录（afterAll 清掉）。 */
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** 造一个 CapturedStep（只填本层消费的字段）。 */
function step(s: {
  dir: string;
  frameCount: number;
  holdMs: number;
  animMs: number;
  holdFrameMs?: readonly number[];
  chapter?: number;
  stepIndex?: number;
}): CapturedStep {
  const stepIndex = s.stepIndex ?? Number(s.dir.split("/").pop());
  const chapterId = s.dir.split("/")[1];
  return {
    chapter: s.chapter ?? 0,
    step: stepIndex,
    chapterId,
    dir: s.dir,
    frameCount: s.frameCount,
    animMs: s.animMs,
    holdMs: s.holdMs,
    holdFrameMs: s.holdFrameMs ?? (s.holdMs > 0 ? [s.animMs] : []),
    warnings: [],
  };
}

/** 真 deck 形状（T1/T2/T4 实测：91 帧窗口步 + 两个单帧静置步）。 */
const REAL_DECK: CapturedStep[] = [
  step({ dir: "frames/example/0", frameCount: 91, holdMs: 400, animMs: 3000 }),
  step({ dir: "frames/example/1", frameCount: 1, holdMs: 2350, animMs: 0 }),
  step({ dir: "frames/example/2", frameCount: 1, holdMs: 1900, animMs: 0 }),
];
/** 与 REAL_DECK 同序的真 stepMs（时间轴表的读数：3400/2350/1900，总 7650）。 */
const REAL_STEP_MS = [3400, 2350, 1900];

/** 清单 → 行数组（去掉空行）。 */
function lines(list: string): string[] {
  return list.trimEnd().split("\n");
}

/** 清单里的 file 路径序列。 */
function filePaths(list: string): string[] {
  return lines(list)
    .filter((l) => l.startsWith("file "))
    .map((l) => l.slice("file ".length).replace(/^'|'$/g, ""));
}

describe("buildVideoConcatList：帧清单", () => {
  it("每步 frameCount 条 file + duration；末帧用 R3 统一式（不是计划式的 holdMs/1000 − 1/fps）", () => {
    const list = buildVideoConcatList(REAL_DECK, 30, REAL_STEP_MS);
    const ls = lines(list);
    // 每帧两条（file + duration），外加清单末尾一条重复行
    expect(ls.filter((l) => l.startsWith("file ")).length).toBe(91 + 1 + 1 + 1);
    expect(ls.filter((l) => l.startsWith("duration ")).length).toBe(91 + 1 + 1);
    // 常规帧 = 1/fps
    expect(ls.filter((l) => l === "duration 0.033333").length).toBe(90);
    // 末帧（F3 口径）：step0 = 3.4 − 90/30 = 0.4；step1 = 2.35；step2 = 1.9
    expect(ls[ls.indexOf("file 'frames/example/0/0091.png'") + 1]).toBe("duration 0.400000");
    expect(ls[ls.indexOf("file 'frames/example/1/0001.png'") + 1]).toBe("duration 2.350000");
    expect(ls[ls.indexOf("file 'frames/example/2/0001.png'") + 1]).toBe("duration 1.900000");
    // 计划式（holdMs/1000 − 1/fps = 0.366667 / 2.316667 / 1.866667）在本构造下每步少 1/fps：
    // 因清单只留"末尾一条重复行"（中段重复行会产出 NOPTS 包），没有逐帧 1/fps 来补这 33ms。
    expect(list).not.toContain("duration 0.366667");
    expect(list).not.toContain("duration 2.316667");
  });

  it("重复行只在清单最后一行（中段重复行 = 后续包 AV_NOPTS_VALUE，实测 9.133333 事故）", () => {
    const list = buildVideoConcatList(REAL_DECK, 30, REAL_STEP_MS);
    const paths = filePaths(list);
    const last = paths[paths.length - 1];
    expect(last).toBe("frames/example/2/0001.png");
    // 重复行 = 末帧文件再来一次（内容相同，位置相邻）
    expect(paths[paths.length - 2]).toBe(last);
    // 且整份清单里只有这一处相邻重复
    const dups = paths.filter((p, i) => i > 0 && p === paths[i - 1]);
    expect(dups).toEqual([last]);
    // 末尾那条重复行没有 duration（它自己不需要被"时长化"——它的存在是为了让**前一条**的
    // duration 生效：后面的条目消费前面声明的时长）
    expect(lines(list)[lines(list).length - 1]).toBe("file 'frames/example/2/0001.png'");
    expect(lines(list)[lines(list).length - 2]).toBe("duration 1.900000");
  });

  it("holdMs=0 的步：末帧 duration = 1/fps（部分帧，不为 0——R3 的由来）", () => {
    // 窗口 2 帧盖满整步（stepMs = 2/30 s），无静置帧 → frameCount 已扣掉静置帧
    const list = buildVideoConcatList(
      [step({ dir: "frames/example/0", frameCount: 2, holdMs: 0, animMs: 66.6667 })],
      30,
      [2000 / 30], // 真 stepMs：窗口 2 帧盖满整步（2×1000/30 = 66.667ms）
    );
    const ls = lines(list);
    expect(ls.filter((l) => l.startsWith("file ")).length).toBe(3); // 2 帧 + 末尾重复
    expect(ls.filter((l) => l === "duration 0.033333").length).toBe(2);
    // M6 新模型（静置帧 = holdFrameMs 列表）：holdMs=0 即无静置帧 → 时间轴保证 stepMs
    // 恰为窗口网格时长（F1 的"部分帧"情形改由静置帧路径承担，见下两条）
    expect(list).not.toContain("duration 0.000000");
  });

  it("M6 字幕切块：静置帧按 holdFrameMs 分段（部分帧 = 块边界差；窗口网格 slack 由首段吃下）", () => {
    // 窗口 2 帧（网格 66.667ms）+ 两块静置 [66.667, 80]，stepMs=90：
    // 首段 13.333ms、尾段 10ms——末段是**部分帧**（10ms < 1/fps），F1 的"补整帧会漂"在新模型
    // 由块边界差天然规避
    const multi = buildVideoConcatList(
      [step({ dir: "frames/example/0", frameCount: 4, holdMs: 400, animMs: 66.6667, holdFrameMs: [66.6667, 80] })],
      30,
      [90],
    );
    expect(multi).toContain("duration 0.013333");
    expect(multi).toContain("duration 0.010000");
    expect(multi).not.toContain("duration 0.000000");

    // slack 情形：animMs=60 不落帧网格（网格 66.667），slack 6.667ms 由首段静置帧吃下——
    // 总时长仍逐字 === stepMs
    const slack = buildVideoConcatList(
      [step({ dir: "frames/example/0", frameCount: 3, holdMs: 400, animMs: 60, holdFrameMs: [60] })],
      30,
      [70],
    );
    expect(slack).toContain("duration 0.003333"); // (70−60)/1000 − 6.667/1000
    const declared = lines(slack)
      .filter((l) => l.startsWith("duration "))
      .map((l) => Number.parseFloat(l.slice(9)))
      .reduce((n, d) => n + d, 0);
    expect(declared).toBeCloseTo(0.07, 5); // Σ === stepMs（1ms 容差；6 位小数的 0.33µs 截断）
  });

  it("清单路径相对 <outDir> 根（T4 的 dir 就是相对形），单引号包裹", () => {
    const list = buildVideoConcatList(REAL_DECK, 30, REAL_STEP_MS);
    expect(lines(list)[0]).toBe("file 'frames/example/0/0001.png'");
    expect(lines(list)[1]).toBe("duration 0.033333");
  });

  it("非空护栏：空 captured / 非法 fps / 非法 frameCount / 负 holdMs / 引号路径 → throw", () => {
    const one = [step({ dir: "frames/example/0", frameCount: 3, holdMs: 400, animMs: 66.7 })];
    expect(() => buildVideoConcatList([], 30, [])).toThrow(/空/);
    expect(() => buildVideoConcatList(REAL_DECK, 0, REAL_STEP_MS)).toThrow(/fps/);
    expect(() => buildVideoConcatList(REAL_DECK, Number.NaN, REAL_STEP_MS)).toThrow(/fps/);
    // stepMsByStep 与 captured 同序同长：长度不符 = 某一步拿的是别的步的时长（逐步错位）
    expect(() => buildVideoConcatList(REAL_DECK, 30, [3400, 2350])).toThrow(/stepMsByStep|长度/);
    expect(() => buildVideoConcatList(one, 30, [0])).toThrow(/stepMs/);
    expect(() => buildVideoConcatList(one, 30, [Number.NaN])).toThrow(/stepMs/);
    expect(() =>
      buildVideoConcatList([step({ dir: "frames/example/0", frameCount: 0, holdMs: 0, animMs: 0 })], 30, [1500]),
    ).toThrow(/frameCount/);
    expect(() =>
      buildVideoConcatList([step({ dir: "frames/example/0", frameCount: 3, holdMs: -5, animMs: 66.7 })], 30, [1500]),
    ).toThrow(/holdMs/);
    expect(() =>
      buildVideoConcatList([step({ dir: "frames/example/it's", frameCount: 1, holdMs: 400, animMs: 0 })], 30, [400]),
    ).toThrow(/单引号|引号/);
  });
});

describe("buildVideoConcatList：stepMs 的来源（修复轮 1 / F1）", () => {
  /** 真 `buildTimeline` 造 `dwell: 0` 的三步（评审向量：窗口比音频长，slack 落在末帧上）。 */
  function tightTimeline() {
    return buildTimeline({
      chapters: [{ id: "h", folder: "01-h", steps: 3, narrations: ["一", "二", "三"] }],
      durations: { h: [2990, 1500, 2000] },
      timings: { h: { dwell: { "0": 0, "1": 0, "2": 0 } } },
      animMsByStep: [[3020, 1510, 2010]],
    });
  }

  function toCaptured(tl: ReturnType<typeof tightTimeline>): CapturedStep[] {
    return tl.steps.map((s) => ({
      chapter: s.chapter,
      step: s.step,
      chapterId: s.chapterId,
      dir: `frames/${s.chapterId}/${s.step}`,
      frameCount: s.frameCount,
      animMs: s.animMs,
      holdMs: s.holdMs,
      holdFrameMs: s.holdFrameMs ?? (s.holdMs > 0 ? [s.animMs] : []),
      warnings: [],
    }));
  }

  /** 清单里声明的总时长（ms）= Σ 所有 duration。 */
  function declaredMs(list: string): number {
    return (
      list
        .split("\n")
        .filter((l) => l.startsWith("duration "))
        .reduce((n, l) => n + Number.parseFloat(l.slice("duration ".length)) * 1000, 0)
    );
  }

  it("清单声明的总时长 === 时间轴总时长（dwell:0 的反推会多出 slack 并逐步累加）", () => {
    const tl = tightTimeline();
    // 向量本身：三步都是"窗口 > 音频 + dwell 0"，窗口帧时长 > stepMs ⇒ slack ∈ (0, 1/fps)
    expect(tl.steps.map((s) => s.stepMs)).toEqual([3020, 1510, 2010]);
    expect(tl.steps.map((s) => s.frameCount)).toEqual([91, 46, 61]);
    expect(tl.steps.map((s) => s.holdMs)).toEqual([0, 0, 0]);
    expect(tl.totalMs).toBe(6540);

    const captured = toCaptured(tl);
    const list = buildVideoConcatList(captured, 30, tl.steps.map((s) => s.stepMs));
    // 1ms 容差：duration 只写到小数点后 6 位（1/30 = 0.0333333… 的截断，每帧 0.33µs）
    expect(Math.abs(declaredMs(list) - tl.totalMs)).toBeLessThan(1);
    // 回归钉：拿 `frameCount/fps` 反推 stepMs（修复前的写法）会得 6600 = 6540 + 三步各 ~20ms 的 slack
    expect(declaredMs(list)).toBeLessThan(6550);
  });

  it("末帧时长 == max(0, stepMs/1000 − (frameCount−1)/fps)（R3 原式，逐步逐字）", () => {
    const tl = tightTimeline();
    const list = buildVideoConcatList(toCaptured(tl), 30, tl.steps.map((s) => s.stepMs));
    const ls = lines(list);
    tl.steps.forEach((s) => {
      const want = Math.max(0, s.stepMs / 1000 - (s.frameCount - 1) / 30);
      const lastFile = `file 'frames/${s.chapterId}/${s.step}/${String(s.frameCount).padStart(4, "0")}.png'`;
      expect(ls[ls.indexOf(lastFile) + 1]).toBe(`duration ${want.toFixed(6)}`);
    });
    // 部分帧：3.02 − 90/30 = 0.020000 / 1.51 − 45/30 = 0.010000 / 2.01 − 60/30 = 0.010000
    expect(ls).toContain("duration 0.020000");
    expect(ls.filter((l) => l === "duration 0.010000").length).toBe(2);
  });
});

describe("buildAudioFilterComplex：音轨", () => {
  it("有声步 apad+atrim 到步长；无声步用 anullsrc 输入；单次 concat 收口", () => {
    const segs: AudioSegment[] = [
      { mp3: "/tmp/audio/a.mp3", stepMs: 3400 },
      { mp3: null, stepMs: 1900 },
    ];
    const { inputs, filter } = buildAudioFilterComplex(segs, 30);
    // 每段一条输入声明（有声 = 文件；无声 = lavfi 静音源）
    expect(inputs.length).toBe(2);
    expect(inputs[0]).toContain("-i '/tmp/audio/a.mp3'");
    expect(inputs[1]).toContain("anullsrc=r=48000:cl=stereo");
    expect(inputs[1]).toContain("-f lavfi");
    // 音轨段长 = 时间轴的 stepMs（逐 µs），不要吸附到帧网格
    expect(filter).toContain("[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=0:3.400000[a0]");
    expect(filter).toContain("[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:1.900000[a1]");
    expect(filter).toContain("[a0][a1]concat=n=2:v=0:a=1[out]");
    // 静音段不该有 apad（它本来就是无限静音，pad 无意义）
    expect(filter.split(";")[1]).not.toContain("apad");
  });

  it("三段（真 deck 形状）：concat=n=3、段序与 segments 同序", () => {
    const segs: AudioSegment[] = [
      { mp3: "/tmp/audio/0.mp3", stepMs: 3400 },
      { mp3: "/tmp/audio/1.mp3", stepMs: 2350 },
      { mp3: null, stepMs: 1900 },
    ];
    const { inputs, filter } = buildAudioFilterComplex(segs, 30);
    expect(inputs.length).toBe(3);
    expect(inputs[0]).toContain("0.mp3");
    expect(inputs[1]).toContain("1.mp3");
    expect(inputs[2]).toContain("anullsrc");
    expect(filter).toContain("[a0][a1][a2]concat=n=3:v=0:a=1[out]");
    expect(filter.indexOf("[0:a]")).toBeLessThan(filter.indexOf("[1:a]"));
    expect(filter.indexOf("[1:a]")).toBeLessThan(filter.indexOf("[2:a]"));
  });

  it("非空护栏：空段列表 / 非法 stepMs / 非法 fps / 路径含单引号 → throw", () => {
    expect(() => buildAudioFilterComplex([], 30)).toThrow(/空/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: 0 }], 30)).toThrow(/stepMs/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: -1 }], 30)).toThrow(/stepMs/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: Number.NaN }], 30)).toThrow(/stepMs/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: 1900 }], 0)).toThrow(/fps/);
    // 撇号路径（如 `…/John's Deck/…`）：`-i '…'` 的引号会被 splitInputSpecs 切裂 →
    // 报出来的是难归因的 "No such file"。与 concatFileLine 的单引号守卫对称（修复轮 1 / F8）。
    expect(() =>
      buildAudioFilterComplex([{ mp3: "/Users/x/John's Deck/a.mp3", stepMs: 1900 }], 30),
    ).toThrow(/单引号/);
    // 纯声明面：单引号只对**有声段**有害（无声段的输入里没有路径）
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: 1900 }], 30)).not.toThrow();
  });
});

describe("splitInputSpecs：argv 切分（路径带空格不许被切开）", () => {
  it("带引号路径 / lavfi 片段混排", () => {
    expect(
      splitInputSpecs(["-i '/Users/x/My Deck/public/audio/01/0.mp3'", "-f lavfi -i anullsrc=r=48000:cl=stereo"]),
    ).toEqual(["-i", "/Users/x/My Deck/public/audio/01/0.mp3", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]);
  });

  it("未加引号的朴素路径也切得对", () => {
    expect(splitInputSpecs(["-i /tmp/a.mp3"])).toEqual(["-i", "/tmp/a.mp3"]);
  });
});

describe("encodeVideo：入参护栏（不开进程、不落盘就炸）", () => {
  const segs: AudioSegment[] = REAL_DECK.map((s, i) => ({ mp3: null, stepMs: REAL_STEP_MS[i] }));

  /** 每次一个新临时目录（产物式断言不往工作区写东西）。 */
  function tmpDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "encode-test-"));
    tmpDirs.push(d);
    return d;
  }

  it("captured/segments 长度不一致 → throw（帧流与音轨对不上）", async () => {
    const dir = tmpDir();
    await expect(
      encodeVideo({ outDir: dir, output: `${dir}/o.mp4`, captured: REAL_DECK, segments: segs.slice(1), fps: 30, stepMsByStep: REAL_STEP_MS }),
    ).rejects.toThrow(/段数|长度/);
    expect(fs.readdirSync(dir)).toEqual([]); // 护栏早于落盘
  });

  it("captured 为空 → throw", async () => {
    const dir = tmpDir();
    await expect(
      encodeVideo({ outDir: dir, output: `${dir}/o.mp4`, captured: [], segments: [], fps: 30, stepMsByStep: [] }),
    ).rejects.toThrow(/空/);
  });

  it("stepMs 双源不一致 → throw（视频声明 vs 音轨段长必须同源；长度护栏只挡长度不挡取值）", async () => {
    const dir = tmpDir();
    // 潜伏已久的第二类分叉：两个数组长度相同、取值不同 ⇒ 视频步长与音轨步长静默分叉
    const drifted = segs.map((s, i) => (i === 1 ? { ...s, stepMs: s.stepMs + 40 } : s));
    const err = await encodeVideo({
      outDir: dir,
      output: `${dir}/o.mp4`,
      captured: REAL_DECK,
      segments: drifted,
      fps: 30,
      stepMsByStep: REAL_STEP_MS,
    }).then(
      () => "(没炸——不该发生)",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(err).toMatch(/stepMs/);
    expect(err).toMatch(/第 1 步|\[1\]/); // 定位到具体那一步
    expect(fs.readdirSync(dir)).toEqual([]); // 护栏早于落盘（与其余入参护栏同批）
  });

  it("ffmpeg 缺失 → 错误文案带 brew install ffmpeg 指引（用不存在的可执行名取证）", async () => {
    const dir = tmpDir();
    await expect(
      encodeVideo({
        outDir: dir,
        output: `${dir}/o.mp4`,
        captured: REAL_DECK,
        segments: segs,
        fps: 30,
        stepMsByStep: REAL_STEP_MS,
        ffmpegPath: "/nonexistent-ffmpeg-for-test",
      }),
    ).rejects.toThrow(/brew install ffmpeg/);
  });
});

describe("buildVideoLoopArgs（M6 编码面）", () => {
  it("每帧一个 -loop 输入，-t = 段时长（步末段取整到整帧）；concat filter 收口", () => {
    const captured = [
      {
        chapter: 0, step: 0, chapterId: "s",
        dir: "frames/s/0", frameCount: 3, animMs: 0, holdMs: 400,
        holdFrameMs: [0, 6200], warnings: [],
      },
    ];
    // stepMs = 9000：末段 = 9000 − 6200 = 2800ms = 84 帧（整帧，取整不变）
    const args = buildVideoLoopArgs(captured, 30, [9000], "/tmp/out");
    expect(args.filter((a) => a === "-loop").length).toBe(3);
    expect(args.filter((a) => a === "-i").length).toBe(3);
    // 窗口帧 -t = 1/fps；首静置段 = 6.2 − slack(1/30) = 6.166667；末段取整 = 2.8s 整帧
    const tFlags = args.map((a, i) => (a === "-t" ? i : -1)).filter((i) => i >= 0);
    expect(args[tFlags[0] + 1]).toBe("0.033333");
    expect(args[tFlags[1] + 1]).toBe("6.166667");
    expect(args[tFlags[2] + 1]).toBe("2.800000");
    // 非整帧末段取整：stepMs = 9100 → 末段 2900ms = 87 帧（整帧）；9101 → 2901ms = 87.03 帧 → 87 帧
    const args2 = buildVideoLoopArgs(captured, 30, [9101], "/tmp/out");
    expect(args2[args2.lastIndexOf("-t") + 1]).toBe("2.900000"); // round(87.03)=87 帧 = 2.9s
    // concat filter 输入数 === 帧数
    expect(args2.join(" ")).toContain("concat=n=3:v=1:a=0");
  });

  it("清单面不受编码面取整影响：同一帧数据，清单 Σ 精确、-loop 末段取整", () => {
    const captured = [
      {
        chapter: 0, step: 0, chapterId: "s",
        dir: "frames/s/0", frameCount: 1, animMs: 0, holdMs: 400,
        holdFrameMs: [0], warnings: [],
      },
    ];
    const list = buildVideoConcatList(captured, 30, [2350]);
    expect(list).toContain("duration 2.350000"); // 清单面精确（R3）
    const args = buildVideoLoopArgs(captured, 30, [2350], "/tmp/out");
    expect(args[args.lastIndexOf("-t") + 1]).toBe("2.366667"); // 编码面取整（71 帧）
  });
});
