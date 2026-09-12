// M5a Task 1：时间轴表（渲染链地基）纯函数单测。
//
// 夹具一律**合成章节**——真 example 的 timing.json 有 dwell{"1":600} 会打乱期望
// （真 example 的读数另有一条独立断言，见文件末 describe）。

import { describe, expect, it } from "vitest";
import { DEFAULT_HOLD_MS, EMPTY_NARRATION_MIN_MS } from "../../src/engine/constants";
import { chapters } from "../../src/chapters/manifest";
import {
  RENDER_FPS,
  buildTimeline,
  estimateMsFromNarration,
  type BuildTimelineInput,
} from "./timeline";

/** 三步合成章节：7 字口播 ×2 + 空 narration（无声过场）；step 0 带 3000ms 动画窗口。 */
const SYNTH: BuildTimelineInput = {
  chapters: [
    { id: "s", folder: "01-s", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] },
  ],
  durations: null,
  timings: {},
  animMsByStep: [[3000, 0, 0]],
};

function build(over: Partial<BuildTimelineInput> = {}) {
  return buildTimeline({ ...SYNTH, ...over });
}

describe("buildTimeline：步长 / 帧数 / 停留垫", () => {
  it("步长 = max(音频, 动画窗口) + 垫；无音频步用与运行时同一条估时公式", () => {
    const tl = build();
    // max(1750,3000)+400 / max(1750,0)+400 / max(1500,0)+400
    expect(tl.steps.map((s) => s.stepMs)).toEqual([3400, 2150, 1900]);
    expect(tl.totalMs).toBe(7450);
    // 估时公式与 useAudioPlayer.estimateMs 同一条（常量同一份）：7 字 × 250 = 1750；空步 → 1500
    expect(estimateMsFromNarration("这是第一句口播")).toBe(1750);
    expect(estimateMsFromNarration("")).toBe(EMPTY_NARRATION_MIN_MS);
    expect(estimateMsFromNarration("甲")).toBe(EMPTY_NARRATION_MIN_MS); // 1 字 × 250 < 下限
    // durations 缺失 = 未合成：audioMs 只陈述实测（null），不拿估时冒充实测
    expect(tl.steps.map((s) => s.audioMs)).toEqual([null, null, null]);
    expect(tl.steps.map((s) => s.chapterId)).toEqual(["s", "s", "s"]);
    expect(tl.steps.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(tl.steps.map((s) => s.chapter)).toEqual([0, 0, 0]);
    expect(tl.steps.map((s) => s.animMs)).toEqual([3000, 0, 0]);
  });

  it("startMs 是步长的前缀和（末步 + 步长 = totalMs）", () => {
    const tl = build();
    expect(tl.steps.map((s) => s.startMs)).toEqual([0, 3400, 5550]);
    const last = tl.steps[tl.steps.length - 1];
    expect(last.startMs + last.stepMs).toBe(tl.totalMs);
  });

  it("帧数用乘法式且 holdMs=0 时不发静置帧", () => {
    const tl = build();
    // animMs=3000 → ceil(3000×30/1000)+1 = 91；animMs=0 → 1（纯静置，整步一张静态图）
    expect(tl.steps[0].frameCount).toBe(91);
    expect(tl.steps[0].holdMs).toBe(400);
    expect(tl.steps[1].frameCount).toBe(1);
    expect(tl.steps[2].frameCount).toBe(1);
    // 整秒窗口（乘法式的意义：1000/fps 不可精确表示，除法式在整秒窗口上会差帧）
    expect(build({ animMsByStep: [[2000, 0, 0]] }).steps[0].frameCount).toBe(61);
    expect(build({ animMsByStep: [[1000, 0, 0]] }).steps[0].frameCount).toBe(31);

    // holdMs=0：动画窗口盖住整步（animMs ≥ stepMs − 垫）→ 没有静置期可覆盖 → 不发静置帧
    const noHold = build({ timings: { s: { dwell: { "0": 0 } } } });
    expect(noHold.steps[0].stepMs).toBe(3000);
    expect(noHold.steps[0].holdMs).toBe(0);
    expect(noHold.steps[0].frameCount).toBe(Math.ceil((3000 * RENDER_FPS) / 1000)); // 90

    // 非整帧窗口（1750ms → ceil 到 53 帧 = 1766.67ms > 步长）→ holdMs 夹到 0，不为负
    const oddWindow = build({ timings: { s: { dwell: { "0": 0 } } }, animMsByStep: [[1750, 0, 0]] });
    expect(oddWindow.steps[0].stepMs).toBe(1750);
    expect(oddWindow.steps[0].holdMs).toBe(0);
    expect(oddWindow.steps[0].frameCount).toBe(53);
  });

  it("holdMs = 末帧要盖住的“窗口之后”时长（静置 + 垫）；音频长于窗口时远大于 dwellMs", () => {
    const tl = build();
    expect(tl.steps.map((s) => s.holdMs)).toEqual([400, 2150, 1900]);
    expect(tl.steps.map((s) => s.dwellMs)).toEqual([400, 400, 400]);
    // 不变式（编解码的根据）：窗口帧时长 + holdMs === stepMs
    // → ffmpeg concat 清单末帧 duration = holdMs/1000 − 1/fps 时，每步总时长精确 stepMs
    for (const s of tl.steps) {
      const windowMs = (Math.ceil((s.animMs * tl.fps) / 1000) * 1000) / tl.fps;
      expect(windowMs + s.holdMs).toBeCloseTo(s.stepMs, 6);
    }
  });

  it("dwell 三级优先级在时间轴上贯通：timing.json > 档案 > 引擎默认（非法值宽松落下一级）", () => {
    expect(build().steps[0].dwellMs).toBe(DEFAULT_HOLD_MS);
    expect(build({ timings: { s: { dwell: { "0": 600 } } } }).steps[0].dwellMs).toBe(600);
    expect(build({ profileHoldMs: 250 }).steps[0].dwellMs).toBe(250);
    expect(
      build({ timings: { s: { dwell: { "0": 600 } } }, profileHoldMs: 250 }).steps[0].dwellMs,
    ).toBe(600);
    // 非法值 = 没写 → 落到档案层（不抛：预览/渲染都不能因一条坏数据停摆）
    expect(
      build({ timings: { s: { dwell: { "0": -5 } } }, profileHoldMs: 250 }).steps[0].dwellMs,
    ).toBe(250);
    // 垫进步长
    expect(build({ timings: { s: { dwell: { "0": 600 } } } }).steps[0].stepMs).toBe(3600);
  });

  it("实测音频优先于估时：durations 条目按非空 narration 顺序对位（空 step 不吃条目）", () => {
    const tl = build({ durations: { s: [1234, 2345] } });
    expect(tl.steps.map((s) => s.audioMs)).toEqual([1234, 2345, null]);
    // max(1234,3000)+400 / max(2345,0)+400 / max(1500,0)+400
    expect(tl.steps.map((s) => s.stepMs)).toEqual([3400, 2745, 1900]);
    expect(tl.totalMs).toBe(8045);
  });

  it("fps 可覆盖：默认 RENDER_FPS，帧数随 fps 变（步长与 fps 无关）", () => {
    expect(RENDER_FPS).toBe(30);
    expect(build().fps).toBe(RENDER_FPS);
    const tl60 = build({ fps: 60 });
    expect(tl60.fps).toBe(60);
    expect(tl60.steps[0].frameCount).toBe(Math.ceil((3000 * 60) / 1000) + 1); // 181
    expect(tl60.totalMs).toBe(7450);
  });

  it("非空护栏：空 chapters → 空表（不抛）", () => {
    const tl = buildTimeline({ chapters: [], durations: null, timings: {}, animMsByStep: [] });
    expect(tl.steps).toEqual([]);
    expect(tl.totalMs).toBe(0);
    expect(tl.fps).toBe(RENDER_FPS);
  });
});

// ── 真 example 的独立读数（合成夹具之外的一条实况断言） ──

describe("实况读数：真 example manifest + 真 timing.json", () => {
  it("三步 3400 / 2350（dwell 600）/ 1900；91+1+1 帧；总 7650ms", () => {
    const tl = buildTimeline({
      chapters,
      durations: null, // 模板无 public/audio-durations.json（未合成，合法态）
      timings: { example: chapters[0].timing }, // 章节声明挂的 timing.json（静态 import）
      animMsByStep: [[3000, 0, 0]], // 窗口预扫实测口径（KenBurns fast ×10 = 3000ms）
    });
    expect(tl.steps.map((s) => s.stepMs)).toEqual([3400, 2350, 1900]);
    expect(tl.steps.map((s) => s.dwellMs)).toEqual([DEFAULT_HOLD_MS, 600, DEFAULT_HOLD_MS]);
    expect(tl.steps.map((s) => s.frameCount)).toEqual([91, 1, 1]);
    expect(tl.totalMs).toBe(7650);
  });
});
