/**
 * tempo.test.ts（M3b Task 9）：节奏检查的**纯判据面**单测——#17（动画窗口 vs 音频时长）
 * 与 #19（音频段 ≥15s）。
 *
 * 边界（诚实标注）：#17 的 `windowMs` 在真机由 `audit()` 供给（真浏览器驱动在
 * `check.ts`/无头 pass 的编排面，见 check.test.ts 的同款边界声明与任务报告的真机读数）；
 * 本文件钉住的是**判据本身**（阈值方向、差值、定位、合法态不报）与 **resolveAudioMs 外提后
 * 语义不变**（与 storyboard.test.ts 的既有钉死值同源——行为不变的硬证据）。
 */

import { describe, expect, it } from "vitest";
import { normalizeDurations, resolveAudioMs, type StoryboardChapter } from "../storyboard/data";
import {
  ANIMATION_WINDOW_RULE,
  AUDIO_TEMPO_RULE,
  MAX_SEGMENT_MS,
  audioTempoStats,
  checkAnimationWindow,
  checkAudioTempo,
  frameKey,
} from "./tempo";

// ── 夹具（与 storyboard.test.ts 同款：step 0/1 有口播、step 2 无声过场 + 一个双步章） ──

const CHAPTERS: StoryboardChapter[] = [
  { id: "example", folder: "01-example", steps: 3, narrations: ["这是第一句口播", "这是第二句口播", ""] },
  { id: "demo", folder: "02-demo", steps: 2, narrations: ["甲", "乙"] },
];

const frame = (chapter: number, step: number, chapterId: string) => ({ chapter, step, chapterId });

// ── #17 动画窗口 vs 音频时长 ──

describe("#17 动画窗口 vs 音频时长（warning；声明面比较）", () => {
  it("窗口 > 音频 → warning 含差值 ms（3000 vs 2000 → 超出人声 1000ms）", () => {
    const findings = checkAnimationWindow(
      [frame(0, 0, "example")],
      new Map([[frameKey(0, 0), 3000]]),
      [[2000, null, null], [null, null]],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(ANIMATION_WINDOW_RULE);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].location).toBe("章节 0 第 0 步（example） · #17");
    expect(findings[0].message).toContain("超出人声 1000ms");
    expect(findings[0].message).toContain("3000ms");
    expect(findings[0].message).toContain("2000ms");
  });

  it("无音频（null）不报（未合成是合法态）；窗口 0（无注册动画）与未采集的帧同样不报", () => {
    // 无音频：未跑 TTS / 无声过场
    expect(
      checkAnimationWindow([frame(0, 2, "example")], new Map([[frameKey(0, 2), 3000]]), [
        [1000, 2000, null],
        [null, null],
      ]),
    ).toEqual([]);
    // 窗口 0 = 该步没有注册动画 → 没有窗口可比
    expect(
      checkAnimationWindow([frame(0, 0, "example")], new Map([[frameKey(0, 0), 0]]), [
        [1000, 2000, null],
        [null, null],
      ]),
    ).toEqual([]);
    // 未采集（pass 中止 / 未跑到）：不是数据问题，不得凭空判
    expect(
      checkAnimationWindow([frame(0, 0, "example")], new Map(), [[1000, 2000, null], [null, null]]),
    ).toEqual([]);
    // 音频对位表缺该章（越界读）→ 等价于无音频，不抛
    expect(
      checkAnimationWindow([frame(1, 0, "demo")], new Map([[frameKey(1, 0), 9000]]), []),
    ).toEqual([]);
  });

  it("窗口 <= 音频不报（含相等——差值 0 不是「超出」）", () => {
    expect(
      checkAnimationWindow(
        [frame(0, 0, "example"), frame(0, 1, "example")],
        new Map([
          [frameKey(0, 0), 1000], // 相等（音频 1000ms）
          [frameKey(0, 1), 1500], // 小于（音频 2000ms）
        ]),
        [[1000, 2000, null], [null, null]],
      ),
    ).toEqual([]);
  });

  it("多帧各自定位（逐帧判，不合并）", () => {
    const findings = checkAnimationWindow(
      [frame(0, 0, "example"), frame(0, 1, "example"), frame(1, 0, "demo")],
      new Map([
        [frameKey(0, 0), 3000],
        [frameKey(0, 1), 5000],
        [frameKey(1, 0), 20000],
      ]),
      [[1000, 2000, null], [25000, null]],
    );
    expect(findings.map((f) => f.location)).toEqual([
      "章节 0 第 0 步（example） · #17",
      "章节 0 第 1 步（example） · #17",
    ]);
  });
});

// ── #19 音频段 ≥15s ──

describe("#19 音频段 ≥15s（warning）", () => {
  it("音频段 ≥ 15000ms → warning 含实际值；<15000 不报", () => {
    const findings = checkAudioTempo(CHAPTERS, [[12000, 20000, null], [15000, 9000]], {
      maxSegmentMs: MAX_SEGMENT_MS,
    });
    expect(findings.map((f) => f.location)).toEqual([
      "章节 0 第 1 步（example） · #19",
      "章节 1 第 0 步（demo） · #19",
    ]);
    expect(findings[0].rule).toBe(AUDIO_TEMPO_RULE);
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("20000ms");
    expect(findings[0].message).toContain("≥ 上限");
    expect(findings[1].message).toContain("15000ms");
    // 短段（12000 / 9000）不进报告
    expect(findings.every((f) => !f.message.includes("12000ms"))).toBe(true);
    expect(findings.every((f) => !f.message.includes("9000ms"))).toBe(true);
  });

  it("null（未合成 / 无声过场）不报；对位表缺章不抛", () => {
    expect(checkAudioTempo(CHAPTERS, [[null, null, null], [null, null]], { maxSegmentMs: MAX_SEGMENT_MS })).toEqual([]);
    expect(checkAudioTempo(CHAPTERS, [], { maxSegmentMs: MAX_SEGMENT_MS })).toEqual([]);
  });

  it("#19 读数：扫描段数 + 极值（无段可扫 → null）", () => {
    expect(audioTempoStats([[12000, 20000, null], [15000, 9000]])).toEqual({
      segments: 4,
      minMs: 9000,
      maxMs: 20000,
    });
    expect(audioTempoStats([[null, null], []])).toBeNull();
    expect(audioTempoStats([])).toBeNull();
  });
});

// ── resolveAudioMs 外提后语义不变（分镜页与门禁同源） ──

describe("resolveAudioMs 外提（scripts/storyboard/data.ts 导出）", () => {
  it("空 narration 步不吃条目（扁平形态按非空句顺序消费）", () => {
    const warnings: string[] = [];
    // 与 storyboard.test.ts 的既有钉死值同源：两章共 4 个非空 narration，[1000, 2000] 只够第一章
    const flat = resolveAudioMs(CHAPTERS, normalizeDurations([1000, 2000]), warnings);
    expect(flat).toEqual([
      [1000, 2000, null],
      [null, null],
    ]);
    expect(warnings.join("\n")).toContain("条目数 2 ≠ 总非空 narrations 4");
  });

  it("对象形态：条目数对不上 / 缺章节键两类警示仍产出，取不到者按未合成降级", () => {
    const w1: string[] = [];
    const byChapter = resolveAudioMs(
      CHAPTERS,
      normalizeDurations({ example: [1000], demo: [500, 700] }),
      w1,
    );
    expect(byChapter).toEqual([
      [1000, null, null],
      [500, 700],
    ]);
    expect(w1.join("\n")).toContain("example");

    const w2: string[] = [];
    const missing = resolveAudioMs(CHAPTERS, normalizeDurations({ demo: [500, 700] }), w2);
    expect(missing).toEqual([
      [null, null, null],
      [500, 700],
    ]);
    expect(w2.join("\n")).toContain("缺章节键");
  });
});

// ── 非空护栏 ──

describe("非空护栏（收集器级不可用面：空输入不抛、空结果）", () => {
  it("chapters 空数组 → 空结果不抛（两条判据 + 读数）", () => {
    expect(checkAudioTempo([], [], { maxSegmentMs: MAX_SEGMENT_MS })).toEqual([]);
    expect(checkAnimationWindow([], new Map(), [])).toEqual([]);
    expect(audioTempoStats([])).toBeNull();
  });
});
