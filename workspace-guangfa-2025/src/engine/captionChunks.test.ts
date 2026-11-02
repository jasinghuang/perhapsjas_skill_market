import { describe, expect, it } from "vitest";
import {
  captionChunkDurations,
  captionChunkIndex,
  MAX_CAPTION_CHARS,
  splitCaptionChunks,
} from "./captionChunks";

describe("splitCaptionChunks", () => {
  it("短文本（≤ 上限）零切分", () => {
    expect(splitCaptionChunks("这是第一句口播")).toEqual(["这是第一句口播"]);
    expect(splitCaptionChunks("")).toEqual([]);
  });

  it("按句读切分，每块 ≤ 上限", () => {
    const chunks = splitCaptionChunks(
      "先说这份年报里最扎眼的一对数字。归母净利润 137 亿，同比涨 42.2%，近五年新高。",
    );
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_CAPTION_CHARS);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("术语/数字粘连片段不被拆开（+42.2% 前后不断）", () => {
    const chunks = splitCaptionChunks("归母净利润 137 亿，同比涨 42.2%，近五年新高。经营现金流净流出 556 亿");
    // 42.2% 必须完整出现在某一块里（粘连保护：数字前后不做断点）
    expect(chunks.some((c) => /同比涨\s*42\.2%/.test(c))).toBe(true);
  });

  it("超长无句读串硬切不超上限", () => {
    const chunks = splitCaptionChunks("以公允价值计量且其变动计入当期损益的金融资产产生的现金净流出增加");
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_CAPTION_CHARS);
  });
});

describe("captionChunkDurations", () => {
  it("Σ 块时长 === stepMs（尾块吃剩余）", () => {
    const text = "先说这份年报里最扎眼的一对数字。归母净利润 137 亿，同比涨 42.2%，近五年新高。";
    for (const stepMs of [17750, 12000, 5000]) {
      const durs = captionChunkDurations(text, stepMs);
      expect(durs.reduce((n, d) => n + d, 0)).toBe(stepMs);
      expect(durs.length).toBe(splitCaptionChunks(text).length);
    }
  });

  it("单块文本 = 整个 stepMs", () => {
    expect(captionChunkDurations("短句", 3000)).toEqual([3000]);
  });
});

describe("captionChunkIndex", () => {
  const text = "先说这份年报里最扎眼的一对数字。归母净利润 137 亿，同比涨 42.2%，近五年新高。";

  it("t=0 → 第 0 块；t 越过末块边界 → 恒末块（确定性）", () => {
    expect(captionChunkIndex(text, 17750, 0)).toBe(0);
    expect(captionChunkIndex(text, 17750, 17750 - 1)).toBe(splitCaptionChunks(text).length - 1);
    expect(captionChunkIndex(text, 17750, 999999)).toBe(splitCaptionChunks(text).length - 1);
  });

  it("同一 t 恒同一块（渲染确定性判据）", () => {
    expect(captionChunkIndex(text, 17750, 4200)).toBe(captionChunkIndex(text, 17750, 4200));
  });
});
