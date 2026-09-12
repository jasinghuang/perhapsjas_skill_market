// M5a Task 1：停留垫解析器（引擎侧**唯一**源头）单测。
//
// 契约：① 三级优先 timing.json 的 dwell["<step>"] > 档案（RuntimeConfig.holdMs）> 引擎默认 400ms；
//       ② **永不抛**（宽松）——预览路径拿到坏 timing.json 必须退回默认值，不能白屏。
//       ③ 非法值 = "没写"：退回**下一级**（档案 → 默认），而不是直接跳默认（否则档案节奏被一步坏数据废掉）。
//
// 严格校验（throw）是**分镜侧**的契约，不在这里：见 scripts/storyboard.test.ts:188 与
// scripts/storyboard/data.ts 的 readDwellMs（薄校验包装：先 assert 再委托本解析器）。

import { describe, expect, it } from "vitest";
import { DEFAULT_HOLD_MS } from "./constants";
import { resolveHoldMs, type TimingFile } from "./hold";

/** 手写 JSON 的现实：类型说 number，运行期可能是任何东西——用这个口子喂坏值。 */
const bad = (v: unknown) => v as unknown as TimingFile;

describe("resolveHoldMs：停留垫三级解析（引擎侧唯一源头，宽松不抛）", () => {
  it("三级优先：timing.json 覆盖 > 档案 > 引擎默认", () => {
    expect(resolveHoldMs({ dwell: { "1": 600 } }, 1)).toBe(600); // ① 逐帧覆盖
    expect(resolveHoldMs({ dwell: { "1": 600 } }, 0)).toBe(DEFAULT_HOLD_MS); // 该步没覆盖 → ③
    expect(resolveHoldMs({ dwell: { "1": 600 } }, 1, 250)).toBe(600); // ① > ②
    expect(resolveHoldMs({ dwell: { "0": 600 } }, 1, 250)).toBe(250); // 无覆盖 → ②
    expect(resolveHoldMs(undefined, 0, 250)).toBe(250); // ② > ③
    expect(resolveHoldMs(undefined, 0)).toBe(DEFAULT_HOLD_MS); // ③
    expect(DEFAULT_HOLD_MS).toBe(400); // 设计 §3.1 已定的引擎默认（防本文件与常量漂移）
  });

  it("非法值 = 没写 → 退回**下一级**（档案在则用档案），不抛", () => {
    expect(resolveHoldMs({ dwell: { "0": -5 } }, 0)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs({ dwell: { "0": -5 } }, 0, 250)).toBe(250); // 预览不白屏，且档案节奏不被废
    expect(resolveHoldMs({ dwell: { "0": Number.NaN } }, 0, 250)).toBe(250);
    expect(resolveHoldMs({ dwell: { "0": Number.POSITIVE_INFINITY } }, 0, 250)).toBe(250);
    // 档案层自己非法 → 默认（档案是 scaffold 写的，也不可全信）
    expect(resolveHoldMs(undefined, 0, -1)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(undefined, 0, Number.NaN)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(undefined, 0, Number.POSITIVE_INFINITY)).toBe(DEFAULT_HOLD_MS);
  });

  it("坏形态（字符串 / null / 数组 / 数字表 / 非对象 timing）一律当没写，不抛", () => {
    expect(resolveHoldMs(bad({ dwell: { "0": "600" } }), 0)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(bad({ dwell: { "0": null } }), 0)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(bad({ dwell: [] }), 0)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(bad({ dwell: 5 }), 0)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(bad({ dwell: null }), 0)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs(bad({}), 0)).toBe(DEFAULT_HOLD_MS); // 合法空配置 = 全默认
    expect(resolveHoldMs(bad(null), 0)).toBe(DEFAULT_HOLD_MS); // JSON.parse("null")
    expect(resolveHoldMs(bad([]), 0)).toBe(DEFAULT_HOLD_MS); // 顶层数组
    expect(resolveHoldMs(bad("nope"), 0)).toBe(DEFAULT_HOLD_MS); // 顶层字符串
    expect(resolveHoldMs(undefined, 0)).toBe(DEFAULT_HOLD_MS); // 没有 timing.json（合法）
  });

  it("0 合法（该步不留垫）；只有该 step 的键生效（键是字符串序号，不串位）", () => {
    expect(resolveHoldMs({ dwell: { "0": 0 } }, 0)).toBe(0);
    expect(resolveHoldMs({ dwell: { "0": 0 } }, 1)).toBe(DEFAULT_HOLD_MS);
    expect(resolveHoldMs({ dwell: { "1": 600 } }, 10)).toBe(DEFAULT_HOLD_MS); // "10" ≠ "1"
    expect(resolveHoldMs({ dwell: { "0": 0 } }, 0, 250)).toBe(0); // 覆盖 0 也是"写了"，不再落档案
  });
});
