// M5a Task 6：渲染产物自校验的**纯函数面**单测（真机面见 verify.browser.test.ts）。
//
// 夹具一律**合成章节**（不碰真 example——它的 timing.json 有 dwell{"1":600} 会打乱期望），
// 与 timeline.test.ts 同一张表：动画窗口 3000ms + 7 字口播 + 400ms 垫 → 步长 3400/2150/1900，
// totalMs 7450，frameCount 91/1/1。所有容差都来自 task-5-report.md §六的**实测**口径，
// 本文件的用例就是那些口径的行程开关（改了容差数字，这里会红）。

import { describe, expect, it } from "vitest";
import type { AudioSegment } from "./encode";
import { buildTimeline, type BuildTimelineInput, type Timeline } from "./timeline";
import {
  AUDIO_BOUNDARY_TOLERANCE_MS,
  BOUNDARY_MIN_RATIO,
  MP4_FRAME_TOLERANCE,
  VIDEO_BOUNDARY_TOLERANCE_FRAMES,
  audioBoundaryReadings,
  checkBoundaries,
  checkProbe,
  expectedMp4Frames,
  expectedPngTotal,
  findBoundaryFrame,
  frameDiffSeries,
  measureAudioAlignment,
  parseProbeJson,
  sampledFrames,
  videoBoundaryReadings,
  verifyRender,
  type FfprobeSummary,
} from "./verify";

const SYNTH: BuildTimelineInput = {
  chapters: [
    { id: "s", folder: "01-s", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] },
  ],
  durations: null,
  timings: {},
  animMsByStep: [[3000, 0, 0]],
};

const tl = buildTimeline(SYNTH); // 步长 3400/2150/1900，totalMs 7450，frameCount 91/1/1
const EMPTY: Timeline = { steps: [], totalMs: 0, fps: 30 };

const SAMPLE_RATE = 48000;

// ── ffprobe 读数夹具 ──

interface ProbeOverrides {
  durationSec?: number;
  nbFrames?: number;
  rFrameRate?: string;
  audioDurationSec?: number;
  sampleRate?: number;
  channels?: number;
  /** true = 成片没有音轨流（mux 失败的一种） */
  noAudio?: boolean;
  /** true = 成片没有视频流 */
  noVideo?: boolean;
}

/** 逐字命中时间轴的"好读数"；各用例只篡改一项。 */
function probeOf(table: Timeline, fps: number, over: ProbeOverrides = {}): FfprobeSummary {
  const video = {
    codec: "h264",
    nbFrames: over.nbFrames ?? Math.round((table.totalMs * fps) / 1000),
    rFrameRate: over.rFrameRate ?? `${fps}/1`,
  };
  const audio =
    over.noAudio === true
      ? null
      : {
          codec: "aac",
          durationSec: over.audioDurationSec ?? table.totalMs / 1000,
          sampleRate: over.sampleRate ?? 48000,
          channels: over.channels ?? 2,
        };
  return {
    durationSec: over.durationSec ?? table.totalMs / 1000,
    video: over.noVideo === true ? null : video,
    audio,
  };
}

describe("两条口径分开：PNG 总数 = Σ frameCount；mp4 帧数 = round(totalMs×fps/1000)", () => {
  it("expectedPngTotal = 93（91+1+1）；expectedMp4Frames(30) = 224（223.5 → 224）", () => {
    expect(expectedPngTotal(tl)).toBe(93);
    expect(expectedMp4Frames(tl, 30)).toBe(224);
    // 两条口径**从来不相等**（CFR 把静置帧复制成多帧）：写成一个数就是错的口径
    expect(expectedPngTotal(tl)).not.toBe(expectedMp4Frames(tl, 30));
  });

  it("非空护栏：空 timeline → throw（0 帧/0 PNG 是坏数据，不是缺省态）", () => {
    expect(() => expectedPngTotal(EMPTY)).toThrow(/空/);
    expect(() => expectedMp4Frames(EMPTY, 30)).toThrow(/空/);
  });
});

describe("checkProbe：时长差 / 帧数差 / 帧率错 → 逐条失败项", () => {
  it("好读数（逐字命中时间轴 + 成片规格）→ 无失败项", () => {
    expect(checkProbe(probeOf(tl, 30), tl, 30)).toEqual([]);
  });

  it("总时长 ±1 帧（33.3ms @30fps）：+40ms 红、+30ms 过", () => {
    expect(checkProbe(probeOf(tl, 30, { durationSec: 7.48 }), tl, 30)).toEqual([]); // +30ms
    const bad = checkProbe(probeOf(tl, 30, { durationSec: 7.49 }), tl, 30); // +40ms
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/时长/);
    expect(bad[0]).toContain("7.49");
    // 短的那一侧也红（T5 实测：清单末尾少那条重复行 → 成片 6.100000 vs 7.650000）
    expect(checkProbe(probeOf(tl, 30, { durationSec: 6.1 }), tl, 30)[0]).toMatch(/时长/);
  });

  it("时长容差取 max(1/fps, 0.022)：fps 60 下 20ms 过、30ms 红（AAC 帧对齐那一侧）", () => {
    // 60fps：1 帧 = 16.7ms < 21.3ms（1024/48000）→ 容差 22ms
    expect(checkProbe(probeOf(tl, 60, { durationSec: 7.47 }), tl, 60)).toEqual([]); // +20ms
    expect(checkProbe(probeOf(tl, 60, { durationSec: 7.48 }), tl, 60)[0]).toMatch(/时长/); // +30ms
  });

  it("mp4 帧数 ±3 帧（T5 实测 −2.1 帧：-shortest 在音轨末端丢 1~2 个视频包）", () => {
    expect(MP4_FRAME_TOLERANCE).toBe(3); // T5 实测 −2.1 帧：±1 那条口径会红
    expect(checkProbe(probeOf(tl, 30, { nbFrames: 221 }), tl, 30)).toEqual([]); // −3
    expect(checkProbe(probeOf(tl, 30, { nbFrames: 227 }), tl, 30)).toEqual([]); // +3
    // ±1 那条口径会红（T5 实测 −2.1），所以这里是 3 不是 1
    const bad = checkProbe(probeOf(tl, 30, { nbFrames: 228 }), tl, 30);
    expect(bad[0]).toMatch(/帧数/);
  });

  it("帧率必须逐字 30/1（缺 -fps_mode cfr 时输出 VFR，这一条会红）", () => {
    const bad = checkProbe(probeOf(tl, 30, { rFrameRate: "30000/1001" }), tl, 30);
    expect(bad[0]).toMatch(/帧率/);
    expect(bad[0]).toContain("30/1");
  });

  it("音轨总长 ±2 个 AAC 帧（42.7ms）：+40ms 过、+50ms 红", () => {
    expect(checkProbe(probeOf(tl, 30, { audioDurationSec: 7.49 }), tl, 30)).toEqual([]); // +40ms
    const bad = checkProbe(probeOf(tl, 30, { audioDurationSec: 7.5 }), tl, 30); // +50ms
    expect(bad[0]).toMatch(/音轨/);
  });

  it("成片规格（追加两条）：48000Hz / 2ch；没有音轨流 → 红", () => {
    expect(checkProbe(probeOf(tl, 30, { sampleRate: 44100 }), tl, 30)[0]).toMatch(/采样率/);
    expect(checkProbe(probeOf(tl, 30, { channels: 1 }), tl, 30)[0]).toMatch(/声道/);
    expect(checkProbe(probeOf(tl, 30, { noAudio: true }), tl, 30)[0]).toMatch(/音轨/);
  });
});

describe("parseProbeJson：ffprobe JSON → 摘要（缺字段即 throw，宁炸不猜）", () => {
  const json = JSON.stringify({
    format: { duration: "7.650000" },
    streams: [
      { codec_type: "video", codec_name: "h264", nb_frames: "226", r_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "aac", duration: "7.658667", sample_rate: "48000", channels: 2 },
    ],
  });

  it("真形状（nb_frames 是字符串）→ 数值化", () => {
    expect(parseProbeJson(json, "w")).toEqual({
      durationSec: 7.65,
      video: { codec: "h264", nbFrames: 226, rFrameRate: "30/1" },
      audio: { codec: "aac", durationSec: 7.658667, sampleRate: 48000, channels: 2 },
    });
  });

  it("没有音轨流 → audio: null（不 throw：成片缺音轨是要**报红**的一条，不是解析失败）", () => {
    const noAudio = JSON.stringify({
      format: { duration: "7.65" },
      streams: [{ codec_type: "video", codec_name: "h264", nb_frames: "226", r_frame_rate: "30/1" }],
    });
    expect(parseProbeJson(noAudio, "w").audio).toBeNull();
  });

  it("坏输入 → throw 且带定位", () => {
    expect(() => parseProbeJson("not json", "定位")).toThrow(/定位/);
    expect(() => parseProbeJson("{}", "定位")).toThrow(/定位/);
    // 有音轨没视频流 = 成片没有画面：解析不了（不是"报红"能救的）
    const noVideo = JSON.stringify({
      format: { duration: "7.65" },
      streams: [{ codec_type: "audio", codec_name: "aac", duration: "7.65", sample_rate: "48000", channels: 2 }],
    });
    expect(() => parseProbeJson(noVideo, "定位")).toThrow(/定位/);
  });
});

describe("视频内容边界：逐帧差信号 → 步起点（窗口内 argmax）", () => {
  it("frameDiffSeries：d[0] = 0，其余是相邻帧的平均绝对差", () => {
    const a = new Uint8Array([0, 0, 10, 10]);
    const b = new Uint8Array([0, 0, 10, 10]);
    const c = new Uint8Array([255, 255, 255, 255]);
    const d = frameDiffSeries([a, b, c]);
    // |255−0|+|255−0|+|255−10|+|255−10| = 1000 → /4 = 250
    expect(Array.from(d)).toEqual([0, 0, 250]);
  });

  it("findBoundaryFrame：窗口内 argmax + 峰值/中位比（显著性判据）", () => {
    const diffs = new Float64Array(224).fill(1);
    diffs[102] = 50;
    const b = findBoundaryFrame(diffs, 100, 15);
    expect(b.index).toBe(102);
    expect(b.peak).toBe(50);
    expect(b.ratio).toBeGreaterThanOrEqual(BOUNDARY_MIN_RATIO);
    // 窗口外的不看（步 2 的边界在该窗口之外）
    expect(findBoundaryFrame(diffs, 160, 15).index).toBeGreaterThanOrEqual(145);
  });

  it("videoBoundaryReadings：步 1/2 的边界 → 实测帧换成 ms；起点（步 0）不设边界", () => {
    const diffs = new Float64Array(224).fill(1);
    diffs[102] = 50; // 步 1 起点 @3400ms → 102 帧
    diffs[167] = 60; // 步 2 起点 @5550ms → round(166.5) = 167 帧
    const readings = videoBoundaryReadings(diffs, tl, 30);
    expect(readings).toHaveLength(2); // n−1 条：步 0 的起点没有"变化"可言
    expect(readings.map((r) => r.expectedMs)).toEqual([3400, 5550]);
    expect(readings[0].actualMs).toBeCloseTo(3400, 6);
    expect(readings[1].actualMs).toBeCloseTo(5566.666, 2);
    expect(readings[0].detail).toContain("102");
  });

  it("跳变不显著（相邻两步画面相同 / 整条是死图）→ actualMs null（跳过，不误报成偏移）", () => {
    const diffs = new Float64Array(224).fill(10);
    diffs[102] = 11; // 比中位高 1.1 倍 << 阈值
    const readings = videoBoundaryReadings(diffs, tl, 30);
    expect(readings[0].actualMs).toBeNull();
    expect(readings[0].detail).toMatch(/跳变/);
  });

  it("VIDEO_BOUNDARY_TOLERANCE_FRAMES = 4（T5 实测上界 89.3ms ≈ 2.7 帧 + 余量）", () => {
    expect(VIDEO_BOUNDARY_TOLERANCE_FRAMES).toBe(4);
  });
});

describe("音轨边界：与理想 PCM 的窗口对齐（样本级）", () => {
  /** 一段单频正弦 PCM。 */
  function tone(samples: number, hz: number, amp = 12000): Int16Array {
    const out = new Int16Array(samples);
    for (let i = 0; i < samples; i++) {
      out[i] = Math.round(amp * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
    }
    return out;
  }

  /** 真 deck 形状的理想音轨：步 0 = 440Hz（3400ms）、步 1 = 550Hz（2150ms）、步 2 = 静音。 */
  function idealDeck(): Int16Array {
    const seg = (ms: number, hz: number | null) => {
      const n = Math.round((ms * SAMPLE_RATE) / 1000);
      return hz === null ? new Int16Array(n) : tone(n, hz);
    };
    return concatPcm([seg(3400, 440), seg(2150, 550), seg(1900, null)]);
  }

  it("measureAudioAlignment：零偏移 → aligned（容差内代价不比全局最优差），相关性 1", () => {
    const ideal = idealDeck();
    const at = Math.round((3400 * SAMPLE_RATE) / 1000);
    const r = measureAudioAlignment({
      ideal,
      product: ideal.slice(),
      atSample: at,
      halfWindowSamples: SAMPLE_RATE / 20, // ±50ms
      searchSamples: Math.round(0.15 * SAMPLE_RATE),
      toleranceSamples: Math.round(0.01 * SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
    });
    expect(r.aligned).toBe(true);
    expect(r.driftMs).toBeCloseTo(0, 3);
    expect(r.correlation).toBeGreaterThan(0.99);
  });

  it("measureAudioAlignment：产物整体晚 100ms → aligned=false 且定位到正漂移（= 晚）", () => {
    const ideal = idealDeck();
    const at = Math.round((3400 * SAMPLE_RATE) / 1000);
    const product = concatPcm([new Int16Array(Math.round(0.1 * SAMPLE_RATE)), ideal]);
    const r = measureAudioAlignment({
      ideal,
      product,
      atSample: at,
      halfWindowSamples: SAMPLE_RATE / 20,
      searchSamples: Math.round(0.15 * SAMPLE_RATE),
      toleranceSamples: Math.round(0.01 * SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
    });
    expect(r.aligned).toBe(false);
    expect(r.driftMs).toBeGreaterThan(AUDIO_BOUNDARY_TOLERANCE_MS);
  });

  it("audioBoundaryReadings：每步起点一条；整体晚 100ms → 错位；内容不符 → failure", () => {
    const ideal = idealDeck();
    // 产物 = 理想（逐字相同）→ 三条全部参与判定且对齐
    const aligned = audioBoundaryReadings(ideal, ideal.slice(), tl, SAMPLE_RATE);
    expect(aligned).toHaveLength(3);
    expect(aligned.map((r) => r.expectedMs)).toEqual([0, 3400, 5550]);
    expect(aligned.map((r) => r.actualMs === null)).toEqual([false, false, false]);
    expect(aligned[1].actualMs).toBeCloseTo(3400, 1);
    expect(aligned[1].detail).toContain("相关性");

    // 产物 = 理想整体晚 100ms（首段前补 100ms 静音）：
    //  · 步 0 的窗口在产物里是静音（内容还没来）→ 内容判据红（相关性 0）
    //  · 步 1 的窗口跨 440→550 的跳变 → 偏移判据红：定位到正漂移，远超 ±10ms
    const shifted = concatPcm([new Int16Array(Math.round(0.1 * SAMPLE_RATE)), ideal]);
    const late = audioBoundaryReadings(ideal, shifted, tl, SAMPLE_RATE);
    expect(late[0].failure).toMatch(/不符|相关/);
    expect(late[1].failure).toBeUndefined();
    expect(late[1].actualMs! - late[1].expectedMs).toBeGreaterThan(AUDIO_BOUNDARY_TOLERANCE_MS);

    // 内容不符：步 1 段换成另一个频率 → 该边界 failure（不是跳过、也不是"没测到"）
    const wrong = concatPcm([tone(Math.round(3.4 * SAMPLE_RATE), 440), tone(Math.round(2.15 * SAMPLE_RATE), 880), new Int16Array(Math.round(1.9 * SAMPLE_RATE))]);
    const mismatch = audioBoundaryReadings(ideal, wrong, tl, SAMPLE_RATE);
    expect(mismatch[1].failure).toMatch(/不符|相关/);
  });

  it("整条静音（未合成音频）→ 三条全跳过（不误报成「一条都没测到」）", () => {
    const silent = new Int16Array(Math.round(7.45 * SAMPLE_RATE));
    const readings = audioBoundaryReadings(silent, silent.slice(), tl, SAMPLE_RATE);
    expect(readings.every((r) => r.actualMs === null && r.failure === undefined)).toBe(true);
  });

  it("AUDIO_BOUNDARY_TOLERANCE_MS = 10（紧口径：实测样本级对齐 0~3ms；4 帧那套会真过松）", () => {
    expect(AUDIO_BOUNDARY_TOLERANCE_MS).toBe(10);
  });
});

describe("checkBoundaries：偏移判定 + 跳过通道（逐条成行）", () => {
  const readings = [
    { label: "a", expectedMs: 3400, actualMs: 3433.33, detail: "x" }, // +33.3ms ≤ 133.3ms
    { label: "b", expectedMs: 5550, actualMs: 5750, detail: "x" }, // +200ms > 133.3ms
    { label: "c", expectedMs: 7400, actualMs: null, detail: "无显著跳变" },
  ];

  it("容差内的过、超容差的失败、null 的跳过（不是失败）", () => {
    const r = checkBoundaries(readings, 1000 / 30, "视频边界");
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("视频边界");
    expect(r.judged).toBe(2); // 只有两条参与判定
    expect(r.lines).toHaveLength(3);
    expect(r.lines.filter((l) => l.includes("[跳过]"))).toHaveLength(1);
  });

  it("failure 字段（非偏移类的确定失败，如音轨内容不符）优先成失败项", () => {
    const r = checkBoundaries(
      [{ label: "d", expectedMs: 3400, actualMs: null, detail: "相关性 0.31", failure: "内容与时间轴不符" }],
      10,
      "音轨边界",
    );
    expect(r.failures[0]).toContain("内容与时间轴不符");
    expect(r.judged).toBe(0);
  });
});

describe("跨会话采样点：min(3, 步数) 个步（必含首末步），每步首帧 + 末帧", () => {
  it("三步表：步 0/1/2；步 0 取首帧与静置末帧（t=animMs），单帧步只取一张", () => {
    const pts = sampledFrames(tl);
    expect(pts.map((p) => [p.chapter, p.step, p.index])).toEqual([
      [0, 0, 0],
      [0, 0, 90],
      [0, 1, 0],
      [0, 2, 0],
    ]);
    expect(pts[1].tMs).toBe(3000); // 静置帧落在 animMs（frameTimes 的同一份口径）
    expect(pts[0].tMs).toBe(0);
    expect(pts.map((p) => p.chapterId)).toEqual(["s", "s", "s", "s"]);
  });

  it("30 步表：采样步数 = min(3, 30) = 3，含首步与末步", () => {
    const many = buildTimeline({
      chapters: [
        {
          id: "s",
          folder: "01-s",
          steps: 30,
          narrations: Array.from({ length: 30 }, () => "这是第一句口播"),
        },
      ],
      durations: null,
      timings: {},
      animMsByStep: [Array.from({ length: 30 }, () => 0)],
    });
    const steps = [...new Set(sampledFrames(many).map((p) => p.step))];
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(29);
  });
});

// ── 终审修复波（I2）：`segments` 的**数值**一致性护栏 ──
//
// 计划（接口约定 6 的执行期更正块）承诺"长度/数值不符即 throw"，但此前只查了**长度**——
// `segments[i].stepMs` 全程没被读过（理想波形走 `timeline.steps[i].stepMs`），是**假承诺**；
// M5b 会直接消费这个接口（SRT 时间码 / 导出服务），故补上并钉死。
// 两条用例都**不需要产物、不需要 ffmpeg、不需要浏览器**：护栏在 `existsSync(产物)` 之前。
describe("verifyRender 护栏（I2）：segments[i].stepMs 必须 === timeline.steps[i].stepMs", () => {
  const segs = (t: Timeline): AudioSegment[] => t.steps.map((s) => ({ mp3: null, stepMs: s.stepMs }));

  it("数值逐条相等 → 数值护栏放行（先撞上的是「产物不存在」，证明它没被数值问题拦住）", async () => {
    await expect(
      verifyRender({
        output: "/nonexistent/never-rendered.mp4",
        outDir: "/tmp",
        timeline: tl,
        url: "http://localhost:5174/?render=1",
        segments: segs(tl),
      }),
    ).rejects.toThrow(/产物不存在/);
  });

  it("改坏一个数值 → 抛（带下标 + 步定位 + 双方数值；与 encode 的 G2 同款「宁炸不静默」）", async () => {
    const broken = segs(tl);
    broken[1] = { mp3: null, stepMs: broken[1]!.stepMs + 100 }; // 2150 → 2250
    await expect(
      verifyRender({
        output: "/nonexistent/never-rendered.mp4",
        outDir: "/tmp",
        timeline: tl,
        url: "http://localhost:5174/?render=1",
        segments: broken,
      }),
    ).rejects.toThrow(/segments\[1\]\.stepMs 2250 ≠ 时间轴第 1 步/);
  });
});

/** Int16 PCM 顺序拼接（音轨理想波形的构造，与 ffmpeg 侧无关）。 */
function concatPcm(parts: readonly Int16Array[]): Int16Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Int16Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
