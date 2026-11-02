// M5a Task 2：窗口预扫的**纯函数面**（形状与 chapters 对位校验）。
//
// 真机面（真 Chromium + 真模板应用）在 window-scan.browser.test.ts——本文件不碰浏览器：
// 判据全部在 `flattenWindowScan` 上，它是"页面读数 → 窗口表"之间唯一的校验点。
//
// 为什么校验必须严格（throw）而不是像 timeline.ts 的 readAnimMs 那样宽松兜 0：
//   · timeline.ts 是**消费面**（手写的输入也得能渲染），宽松是对的；
//   · 本模块是**生产面**（唯一的 animMs 生产者），读数错位的后果是整条渲染链的时长
//     静默错掉（成片退化成静态帧流或与音轨错位），没有下游能发现——故宁炸不静默。

import { describe, expect, it } from "vitest";
import { flattenWindowScan, scanAnimationWindows, type WindowReading } from "./window-scan";

const reading = (
  chapter: number,
  step: number,
  windowMs: number,
  frameCount: number,
): WindowReading => ({ chapter, step, windowMs, frameCount });

describe("flattenWindowScan：窗口表形状与 chapters 对位", () => {
  it("按规范序折叠：animMsByStep / frameCountByStep 同序、逐章与 chapters.steps 等长", () => {
    const out = flattenWindowScan(
      [
        reading(0, 0, 3000, 1),
        reading(0, 1, 0, 0),
        reading(0, 2, 0, 0),
        reading(1, 0, 700, 2),
        reading(1, 1, 0, 0),
      ],
      [{ steps: 3 }, { steps: 2 }],
    );
    expect(out.animMsByStep).toEqual([[3000, 0, 0], [700, 0]]);
    expect(out.frameCountByStep).toEqual([[1, 0, 0], [2, 0]]);
    // 长度对位（与 chapters 逐章一致）——下游 buildTimeline 按 [chapterIndex][step] 取值
    out.animMsByStep.forEach((row, ci) => {
      expect(row).toHaveLength([3, 2][ci]);
    });
  });

  it("非空护栏：0 章 → throw（空表 = animMs 全缺 = 整条渲染链静默退化的入口）", () => {
    expect(() => flattenWindowScan([], [])).toThrow(/chapters 为空/);
  });

  it("读数条数与 manifest 不符 → throw（少了 / 多了都给数，不静默少帧）", () => {
    expect(() => flattenWindowScan([reading(0, 0, 3000, 1)], [{ steps: 3 }])).toThrow(
      /读数条数 1 ≠ 总步数 3/,
    );
    expect(() =>
      flattenWindowScan([reading(0, 0, 1, 1), reading(0, 1, 1, 1)], [{ steps: 1 }]),
    ).toThrow(/读数条数 2 ≠ 总步数 1/);
  });

  it("读数错位（chapter/step 与规范序不符）→ throw：顺序即对位，错了就是测错帧", () => {
    // 第 2 条跳过了 (0,1) 直接给 (0,2)
    expect(() =>
      flattenWindowScan(
        [reading(0, 0, 1, 1), reading(0, 2, 1, 1), reading(0, 1, 1, 1)],
        [{ steps: 3 }],
      ),
    ).toThrow(/第 1 条读数坐标 章节 0 第 2 步 ≠ 规范序的 章节 0 第 1 步/);
  });

  it("chapters.steps 非法 → throw（复用 expandSpecs 的游标校验，不另写一套）", () => {
    expect(() => flattenWindowScan([], [{ steps: -1 }])).toThrow(/steps -1 非法/);
    expect(() => flattenWindowScan([reading(0, 0, 1, 1)], [{ steps: 1.5 }])).toThrow(/steps 1.5 非法/);
  });

  it("坏读数（NaN / Infinity / 负数 / 非整数帧数）→ throw：页面来的数字也是不可信输入", () => {
    const chapters = [{ steps: 2 }];
    const one = (over: Partial<WindowReading>): WindowReading[] => [
      { ...reading(0, 0, 3000, 1), ...over },
      reading(0, 1, 0, 0),
    ];
    expect(() => flattenWindowScan(one({ windowMs: Number.NaN }), chapters)).toThrow(
      /windowMs NaN 非法/,
    );
    expect(() => flattenWindowScan(one({ windowMs: Number.POSITIVE_INFINITY }), chapters)).toThrow(
      /windowMs Infinity 非法/,
    );
    expect(() => flattenWindowScan(one({ windowMs: -1 }), chapters)).toThrow(/windowMs -1 非法/);
    expect(() => flattenWindowScan(one({ frameCount: 1.5 }), chapters)).toThrow(
      /frameCount 1.5 非法/,
    );
  });
});

describe("scanAnimationWindows：非空护栏在开浏览器之前", () => {
  it("0 章 → reject（不白起一个会话——护栏必须早于 openSession）", async () => {
    await expect(scanAnimationWindows({ url: "http://127.0.0.1:1/", chapters: [] })).rejects.toThrow(
      /chapters 为空/,
    );
  });
});
