// M5a Task 4：帧流的**纯函数面** + **开浏览器之前的护栏**。
//
// 真机面（真 Chromium + 真模板应用 + 真落盘 PNG）在 frames.browser.test.ts——本文件不碰浏览器。
// 四块判据：
//   1. 帧流的三段算术：帧路径清单（framePaths）/ 帧时刻表（frameTimes）/ 分片（partition）；
//   2. **同源断言（assertWindowMatch）的负臂**——"窗口预扫 / 帧流采集两趟各说各话"是整条链最
//      贵的静默失效，故它的爆炸路径必须单独钉一条；
//   3. **泄漏告警（leakWarnings，Ruling R7）**：四张审计形状 → 告警 / 不告警。判据复用的是
//      门禁（scripts/check/headless.ts）的 `animationEscapeVerdict`——同一 predicate，门禁升级
//      为 blocker、渲染期只记 warning（不阻断出片）。**本 describe 同时是那条复用的行程开关**：
//      门禁侧改了判据，这里必红；
//   4. captureFrames 的全部护栏都在 openSession **之前**——url 一律指 `127.0.0.1:1`：
//      真开了浏览器只会得到"连不上"，错误文案对不上就说明护栏漏了（与 window-scan.test.ts
//      的非空护栏同款证法）。
//
// 为什么帧数不在这里自己算（`ceil(animMs×fps/1000)`）：硬约束——帧数只认 `timeline.frameCount`，
// frameTimes/framePaths 只做"把 frameCount 拆成窗口拍 + 静置拍"与"生成 frameCount 条路径"。

import * as fs from "node:fs";
import * as os from "node:os";
import { describe, expect, it } from "vitest";
import type { AnimationAudit } from "../../src/engine/cursorBridge";
import { withRenderMode } from "../check/headless";
import {
  assertFrameCountOnDisk,
  assertWindowMatch,
  captureFrames,
  frameDir,
  framePaths,
  frameTimes,
  isRenderMode,
  leakWarnings,
  partition,
  type FrameSpec,
} from "./frames";
import type { Timeline, TimelineStep } from "./timeline";

/** 帧流的输出去向与基址：url 指向一个**必然连不上**的端口（护栏若漏在 openSession 之后，
 *  错误会变成"连不上"，与断言里的定位文案对不上 → 用例红）。 */
const DEAD_URL = "http://127.0.0.1:1/";

const RENDER_URL = withRenderMode(DEAD_URL);

function stepOf(over: Partial<TimelineStep> = {}): TimelineStep {
  return {
    chapter: 0,
    step: 0,
    chapterId: "example",
    startMs: 0,
    audioMs: null,
    animMs: 3000,
    dwellMs: 400,
    stepMs: 3400,
    frameCount: 91,
    holdMs: 400,
    ...over,
  };
}

function timelineOf(steps: TimelineStep[]): Timeline {
  return { fps: 30, totalMs: steps.reduce((n, s) => n + s.stepMs, 0), steps };
}

const specOf = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  chapter: 0,
  step: 0,
  chapterId: "example",
  ...over,
});

/** 真 example 三步 deck 的时间轴投影（读数见 frames.browser.test.ts / window-scan）。 */
const EXAMPLE_TIMELINE = timelineOf([
  stepOf(),
  stepOf({ step: 1, startMs: 3400, stepMs: 2350, animMs: 0, dwellMs: 600, frameCount: 1, holdMs: 2350 }),
  stepOf({ step: 2, startMs: 5750, stepMs: 1900, animMs: 0, frameCount: 1, holdMs: 1900 }),
]);

const EXAMPLE_SPECS: FrameSpec[] = [
  { chapter: 0, step: 0, chapterId: "example" },
  { chapter: 0, step: 1, chapterId: "example" },
  { chapter: 0, step: 2, chapterId: "example" },
];

function auditOf(over: Partial<AnimationAudit> = {}): AnimationAudit {
  return {
    waapi: 0,
    owned: 0,
    unowned: 0,
    unownedRunning: 0,
    unownedHints: [],
    running: 0,
    registry: 1,
    windowMs: 3000,
    ...over,
  };
}

describe("frameDir：帧目录名（相对 outDir；T5 清单里的相对引用形态）", () => {
  it("frames/<chapterId>/<step>（'/' 手拼，与 session.shotPath 同款）", () => {
    expect(frameDir("example", 0)).toBe("frames/example/0");
    expect(frameDir("01-intro", 12)).toBe("frames/01-intro/12");
  });

  it("chapterId 白名单（路径逃逸面：这个目录也是**写前清目录**的目标）→ throw", () => {
    for (const bad of ["", "..", ".", "a/b", "../evil", "a\\b"]) {
      expect(() => frameDir(bad, 0), bad).toThrow(/非法/);
    }
  });

  it("step 非法（负 / 非整数）→ throw", () => {
    expect(() => frameDir("example", -1)).toThrow(/非法/);
    expect(() => frameDir("example", 1.5)).toThrow(/非法/);
  });
});

describe("framePaths：帧路径清单与计数一致", () => {
  it("frameCount=91 → 91 条，首 0001 末 0091（1 起编，4 位补零）", () => {
    const paths = framePaths("frames/example/0", 91);
    expect(paths).toHaveLength(91);
    expect(paths[0]).toBe("frames/example/0/0001.png");
    expect(paths[90]).toBe("frames/example/0/0091.png");
    // 严格递增、无重名（清单即落盘计划：重名 = 少一帧而张数看着还对）
    expect(new Set(paths).size).toBe(91);
    expect(paths[45]).toBe("frames/example/0/0046.png"); // t=1500ms 那一拍（30fps）
  });

  it("目录尾斜杠不造成双斜杠（拼接与 session.shotPath 同款：'/' 手拼）", () => {
    expect(framePaths("frames/example/0/", 1)).toEqual(["frames/example/0/0001.png"]);
  });

  it("非空护栏：0 / 负 / 非整数 frameCount → throw（空清单 = 该步在成片里凭空消失）", () => {
    expect(() => framePaths("frames/example/0", 0)).toThrow(/frameCount 0 非法/);
    expect(() => framePaths("frames/example/0", -3)).toThrow(/frameCount -3 非法/);
    expect(() => framePaths("frames/example/0", 2.5)).toThrow(/frameCount 2.5 非法/);
    expect(() => framePaths("frames/example/0", Number.NaN)).toThrow(/非法/);
  });
});

describe("frameTimes：窗口拍 + 静置拍（帧数只认 frameCount）", () => {
  it("example step 0（91 帧 / 3000ms 窗口 / 30fps）：前 90 拍走 k·1000/fps，第 91 拍落在 animMs", () => {
    const times = frameTimes(91, 3000, 30, 400);
    expect(times).toHaveLength(91);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeCloseTo(1000 / 30, 10);
    expect(times[45]).toBe(1500); // k·1000/fps 在整拍上精确（45·1000/30）
    expect(times[89]).toBeCloseTo((89 * 1000) / 30, 10);
    expect(times[90]).toBe(3000); // 静置拍 = animMs（时间轴已把它算进 frameCount）
  });

  it("holdMs=0（窗口盖满整步）→ 不发静置拍：张数 = frameCount，末拍 = (frameCount−1)·1000/fps", () => {
    const times = frameTimes(90, 3000, 30, 0);
    expect(times).toHaveLength(90);
    expect(times[89]).toBeCloseTo(2966.6666666666665, 6);
    expect(times).not.toContain(3000);
  });

  it("静态步（animMs=0 / 1 帧 / holdMs>0）→ 只有一拍 t=0（静置段复用同一张图）", () => {
    expect(frameTimes(1, 0, 30, 1900)).toEqual([0]);
  });

  it("张数恒等于 frameCount（不自己重算 ⌈animMs×fps/1000⌉——那条式子只在 timeline 里有一份）", () => {
    for (const [frameCount, animMs, holdMs] of [
      [91, 3000, 400],
      [90, 3000, 0],
      [1, 0, 1900],
      [1, 1, 100],
      [7, 200, 100],
    ] as const) {
      expect(frameTimes(frameCount, animMs, 30, holdMs)).toHaveLength(frameCount);
    }
  });

  it("坏输入（frameCount<1 / fps≤0 / 负 animMs / 负 holdMs / NaN）→ throw", () => {
    expect(() => frameTimes(0, 3000, 30, 400)).toThrow(/frameCount 0 非法/);
    expect(() => frameTimes(1.5, 3000, 30, 400)).toThrow(/frameCount 1.5 非法/);
    expect(() => frameTimes(91, 3000, 0, 400)).toThrow(/fps 0 非法/);
    expect(() => frameTimes(91, -1, 30, 400)).toThrow(/animMs -1 非法/);
    expect(() => frameTimes(91, 3000, 30, -1)).toThrow(/holdMs -1 非法/);
    expect(() => frameTimes(91, Number.NaN, 30, 400)).toThrow(/非法/);
  });
});

describe("partition：分片覆盖全部步且不重叠", () => {
  it("partition([0..8], 3)：三片、并集 = 全部、无重复（轮转分片，负载匀）", () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const groups = partition(items, 3);
    expect(groups).toHaveLength(3);
    const flat = groups.flat();
    expect([...flat].sort((a, b) => a - b)).toEqual(items);
    expect(new Set(flat).size).toBe(items.length);
    // 轮转：第 i 片拿 i, i+3, i+6
    expect(groups[0]).toEqual([0, 3, 6]);
    expect(groups[1]).toEqual([1, 4, 7]);
    expect(groups[2]).toEqual([2, 5, 8]);
  });

  it("分片数多于条目 → 多出来的片是空的（消费方跳过空片，不为它开浏览器）", () => {
    expect(partition([1, 2], 4)).toEqual([[1], [2], [], []]);
    expect(partition([], 3)).toEqual([[], [], []]);
  });

  it("分片数非法（0 / 负 / 非整数）→ throw（0 片 = 一步都不渲的静默空跑）", () => {
    expect(() => partition([1, 2, 3], 0)).toThrow(/groups 0 非法/);
    expect(() => partition([1, 2, 3], -1)).toThrow(/groups -1 非法/);
    expect(() => partition([1, 2, 3], 1.5)).toThrow(/groups 1.5 非法/);
  });

  it("不改动入参（分片是纯切分，帧顺序由调用方按 index 装回）", () => {
    const items = [1, 2, 3, 4, 5];
    const snapshot = [...items];
    partition(items, 2);
    expect(items).toEqual(snapshot);
  });
});

describe("assertWindowMatch：同源断言（Ruling R7 的对偶：窗口两趟各说各话的唯一防线）", () => {
  it("相等 → 静默通过（同源：捕捉期读数就是时间轴里的那个值）", () => {
    expect(() => assertWindowMatch(3000, 3000, "章节 0 第 0 步")).not.toThrow();
    expect(() => assertWindowMatch(0, 0, "章节 0 第 1 步")).not.toThrow();
  });

  it("负臂：不等 → throw，且带双方数值与定位（预扫说了 3000，捕捉期读到 2000）", () => {
    expect(() => assertWindowMatch(3000, 2000, "章节 0 第 0 步")).toThrow(/章节 0 第 0 步/);
    expect(() => assertWindowMatch(3000, 2000, "章节 0 第 0 步")).toThrow(/2000/);
    expect(() => assertWindowMatch(3000, 2000, "章节 0 第 0 步")).toThrow(/3000/);
    expect(() => assertWindowMatch(3000, 2000, "章节 0 第 0 步")).toThrow(/两趟各说各话/);
    // 方向无关：多算窗口同样炸
    expect(() => assertWindowMatch(0, 33, "章节 0 第 1 步")).toThrow(/两趟各说各话/);
  });
});

describe("leakWarnings：R7 泄漏告警（门禁 blocker × 渲染 warning）", () => {
  const where = "章节 0 第 0 步（example）";

  it("干净步（全 0）→ 无告警", () => {
    expect(leakWarnings(auditOf(), { renderMode: true, where })).toEqual([]);
  });

  it("unowned > 0（未在跑，CSS transition 残影一类）→ 1 条 warning 且**列出 unownedHints**", () => {
    const out = leakWarnings(
      auditOf({ waapi: 2, unowned: 2, unownedHints: [".leak-a", ".leak-b"] }),
      { renderMode: true, where },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(where); // 定位前缀（T7 直接打这一串）
    expect(out[0]).toContain(".leak-a");
    expect(out[0]).toContain(".leak-b");
  });

  it("render 下 running > 0 → 1 条 warning（render 模式创建即冻结，任何 running 都是异常）", () => {
    const out = leakWarnings(auditOf({ waapi: 1, owned: 1, running: 1 }), { renderMode: true, where });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("running");
  });

  it("非 render 下 running > 0（引擎自播是正常态）→ 无告警——判据带 render 限定词", () => {
    expect(leakWarnings(auditOf({ waapi: 1, owned: 1, running: 1 }), { renderMode: false, where })).toEqual([]);
  });

  it("unownedRunning > 0（泄漏且真在跑：纯章节层动画那口活井）→ 也有告警", () => {
    const out = leakWarnings(
      auditOf({ waapi: 1, unowned: 1, unownedRunning: 1, running: 1, unownedHints: [".leak-run"] }),
      { renderMode: true, where },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(".leak-run");
  });
});

describe("isRenderMode：渲染态判据（与 withRenderMode 同款 has 语义）", () => {
  it("无 render 参数 → false；withRenderMode 拼过 → true", () => {
    expect(isRenderMode("http://127.0.0.1:1/")).toBe(false);
    expect(isRenderMode("http://127.0.0.1:1/?auto=1")).toBe(false);
    expect(isRenderMode(withRenderMode("http://127.0.0.1:1/"))).toBe(true);
    expect(isRenderMode(withRenderMode("http://127.0.0.1:1/?auto=1"))).toBe(true);
  });

  it("has 语义（不是取值）：render=0 也算渲染态——与 App.tsx 的 params.has('render') 逐字一致", () => {
    expect(isRenderMode("http://127.0.0.1:1/?render=0")).toBe(true);
  });
});

describe("captureFrames：护栏全部在开浏览器之前（fail fast）", () => {
  const opts = (over: Partial<Parameters<typeof captureFrames>[1]> = {}) => ({
    url: RENDER_URL,
    outDir: "/tmp/frames-guard-never-used",
    timeline: EXAMPLE_TIMELINE,
    ...over,
  });

  it("specs 为空 → reject（零帧是静默降级：成片没有一段来自本 deck）", async () => {
    await expect(captureFrames([], opts())).rejects.toThrow(/specs 为空/);
  });

  it("非渲染态 URL → reject（动画自主播放时 seek 后截图是移动靶）", async () => {
    await expect(captureFrames(EXAMPLE_SPECS, opts({ url: DEAD_URL }))).rejects.toThrow(
      /渲染态|withRenderMode/,
    );
  });

  it("重复的 (chapter, step) → reject（同一帧目录被渲两遍 = 成片里那一步重复）", async () => {
    await expect(
      captureFrames([specOf(), specOf()], opts()),
    ).rejects.toThrow(/重复/);
  });

  it("时间轴里没有对应的步 → reject（渲的不是这张表里的帧）", async () => {
    await expect(
      captureFrames([specOf({ step: 2 })], opts({ timeline: timelineOf([stepOf()]) })),
    ).rejects.toThrow(/时间轴表里没有/);
  });

  it("spec.chapterId 与时间轴不符 → reject（帧目录名会对不上成片引用）", async () => {
    await expect(captureFrames([specOf({ chapterId: "other" })], opts())).rejects.toThrow(
      /chapterId/,
    );
  });

  it("chapterId 非法（路径逃逸面）→ reject", async () => {
    await expect(captureFrames([specOf({ chapterId: "../evil" })], opts())).rejects.toThrow(
      /非法/,
    );
  });

  it("concurrency 非法（0 / 非整数）→ reject（0 是空跑，CLI 层应归 1）", async () => {
    await expect(captureFrames(EXAMPLE_SPECS, opts({ concurrency: 0 }))).rejects.toThrow(
      /concurrency 0 非法/,
    );
    await expect(captureFrames(EXAMPLE_SPECS, opts({ concurrency: 2.5 }))).rejects.toThrow(
      /concurrency 2.5 非法/,
    );
  });

  it("only 越界 / 为空 → reject（调试开关静默渲零步是最坏的调试体验）", async () => {
    await expect(captureFrames(EXAMPLE_SPECS, opts({ only: [3] }))).rejects.toThrow(/only/);
    await expect(captureFrames(EXAMPLE_SPECS, opts({ only: [-1] }))).rejects.toThrow(/only/);
    await expect(captureFrames(EXAMPLE_SPECS, opts({ only: [] }))).rejects.toThrow(/only/);
  });

  it("frameCount 非法的步（时间轴被手改坏）→ reject", async () => {
    await expect(
      captureFrames([specOf()], opts({ timeline: timelineOf([stepOf({ frameCount: 0 })]) })),
    ).rejects.toThrow(/frameCount 0 非法/);
  });
});

describe("assertFrameCountOnDisk：落盘回读（'落盘张数 === frameCount' 是查出来的）", () => {
  function tempDir(): string {
    return fs.mkdtempSync(`${os.tmpdir()}/frames-on-disk-`);
  }

  it("张数与名单一致 → 静默通过", () => {
    const dir = tempDir();
    fs.writeFileSync(`${dir}/0001.png`, "a");
    fs.writeFileSync(`${dir}/0002.png`, "b");
    expect(() => assertFrameCountOnDisk(dir, framePaths(dir, 2), "章节 0 第 0 步")).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("少一张（截图中途失败 / 被覆盖）→ throw，给双方张数", () => {
    const dir = tempDir();
    fs.writeFileSync(`${dir}/0001.png`, "a");
    expect(() => assertFrameCountOnDisk(dir, framePaths(dir, 2), "章节 0 第 0 步")).toThrow(
      /落盘帧数/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("多一张（上一次渲的残留：帧数变小的步）→ throw——写前清目录是这条成立的前提", () => {
    const dir = tempDir();
    for (const n of ["0001", "0002", "0003"]) fs.writeFileSync(`${dir}/${n}.png`, "x");
    expect(() => assertFrameCountOnDisk(dir, framePaths(dir, 2), "章节 0 第 0 步")).toThrow(
      /落盘帧数/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("名字不对（编号错位 / 不是 PNG）→ throw（张数对不代表是同一批帧）", () => {
    const dir = tempDir();
    fs.writeFileSync(`${dir}/0002.png`, "a");
    expect(() => assertFrameCountOnDisk(dir, framePaths(dir, 1), "章节 0 第 0 步")).toThrow(
      /落盘帧数/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("非 PNG 杂物不参与计数（.DS_Store 不该让下一次渲染失败）", () => {
    const dir = tempDir();
    fs.writeFileSync(`${dir}/0001.png`, "a");
    fs.writeFileSync(`${dir}/.DS_Store`, "x");
    expect(() => assertFrameCountOnDisk(dir, framePaths(dir, 1), "章节 0 第 0 步")).not.toThrow();
    // 但杂物**不能替代**帧：一张都没有时照样炸
    const empty = tempDir();
    fs.writeFileSync(`${empty}/.DS_Store`, "x");
    expect(() => assertFrameCountOnDisk(empty, framePaths(empty, 1), "章节 0 第 0 步")).toThrow(
      /落盘帧数/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
