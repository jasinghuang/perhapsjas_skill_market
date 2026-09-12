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
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CapturedStep } from "./frames";
import {
  buildAudioFilterComplex,
  buildVideoConcatList,
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
    warnings: [],
  };
}

/** 真 deck 形状（T1/T2/T4 实测：91 帧窗口步 + 两个单帧静置步）。 */
const REAL_DECK: CapturedStep[] = [
  step({ dir: "frames/example/0", frameCount: 91, holdMs: 400, animMs: 3000 }),
  step({ dir: "frames/example/1", frameCount: 1, holdMs: 2350, animMs: 0 }),
  step({ dir: "frames/example/2", frameCount: 1, holdMs: 1900, animMs: 0 }),
];

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
    const list = buildVideoConcatList(REAL_DECK, 30);
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
    const list = buildVideoConcatList(REAL_DECK, 30);
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
    );
    const ls = lines(list);
    expect(ls.filter((l) => l.startsWith("file ")).length).toBe(3); // 2 帧 + 末尾重复
    expect(ls.filter((l) => l === "duration 0.033333").length).toBe(2);
    // 计划式会给 0（max(0, 0 − 1/30)）——零时长条目等于该帧没有时长，而 frameCount 已扣静置帧，
    // 成片那句就少半帧、逐步累积（R3 要修的就是它）。
    expect(list).not.toContain("duration 0.000000");
  });

  it("清单路径相对 <outDir> 根（T4 的 dir 就是相对形），单引号包裹", () => {
    const list = buildVideoConcatList(REAL_DECK, 30);
    expect(lines(list)[0]).toBe("file 'frames/example/0/0001.png'");
    expect(lines(list)[1]).toBe("duration 0.033333");
  });

  it("非空护栏：空 captured / 非法 fps / 非法 frameCount / 负 holdMs / 引号路径 → throw", () => {
    expect(() => buildVideoConcatList([], 30)).toThrow(/空/);
    expect(() => buildVideoConcatList(REAL_DECK, 0)).toThrow(/fps/);
    expect(() => buildVideoConcatList(REAL_DECK, Number.NaN)).toThrow(/fps/);
    expect(() =>
      buildVideoConcatList([step({ dir: "frames/example/0", frameCount: 0, holdMs: 0, animMs: 0 })], 30),
    ).toThrow(/frameCount/);
    expect(() =>
      buildVideoConcatList([step({ dir: "frames/example/0", frameCount: 3, holdMs: -5, animMs: 66.7 })], 30),
    ).toThrow(/holdMs/);
    expect(() =>
      buildVideoConcatList([step({ dir: "frames/example/it's", frameCount: 1, holdMs: 400, animMs: 0 })], 30),
    ).toThrow(/单引号|引号/);
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

  it("非空护栏：空段列表 / 非法 stepMs / 非法 fps → throw", () => {
    expect(() => buildAudioFilterComplex([], 30)).toThrow(/空/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: 0 }], 30)).toThrow(/stepMs/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: -1 }], 30)).toThrow(/stepMs/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: Number.NaN }], 30)).toThrow(/stepMs/);
    expect(() => buildAudioFilterComplex([{ mp3: null, stepMs: 1900 }], 0)).toThrow(/fps/);
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
  const segs: AudioSegment[] = REAL_DECK.map((s) => ({ mp3: null, stepMs: s.holdMs + 3000 }));

  /** 每次一个新临时目录（产物式断言不往工作区写东西）。 */
  function tmpDir(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "encode-test-"));
    tmpDirs.push(d);
    return d;
  }

  it("captured/segments 长度不一致 → throw（帧流与音轨对不上）", async () => {
    const dir = tmpDir();
    await expect(
      encodeVideo({ outDir: dir, output: `${dir}/o.mp4`, captured: REAL_DECK, segments: segs.slice(1), fps: 30 }),
    ).rejects.toThrow(/段数|长度/);
    expect(fs.readdirSync(dir)).toEqual([]); // 护栏早于落盘
  });

  it("captured 为空 → throw", async () => {
    const dir = tmpDir();
    await expect(
      encodeVideo({ outDir: dir, output: `${dir}/o.mp4`, captured: [], segments: [], fps: 30 }),
    ).rejects.toThrow(/空/);
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
        ffmpegPath: "/nonexistent-ffmpeg-for-test",
      }),
    ).rejects.toThrow(/brew install ffmpeg/);
  });
});
