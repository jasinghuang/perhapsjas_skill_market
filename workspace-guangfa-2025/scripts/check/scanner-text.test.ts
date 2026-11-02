/**
 * scanner-text 测试：narrations 文本扫描（M3a 静态门禁，§11.1 #1/#11 + §12b V3）。
 *
 * 覆盖任务规格三块：
 *   - 非空护栏：空数组 throw
 *   - 负样本：#1 steps 与 narrations.length 不符（手工构造坏 ChapterDef）、
 *             #11 AI 句式（十词全 + 变体「归根到底」+ 单句多词合并）、
 *             V3 结尾句号/逗号/书名号/省略号（尾部空白不掩标点）
 *   - false-positive：正常口播句（无 AI 味、结尾 ？！ 合法、空串、无结尾标点）
 */

import { describe, expect, it } from "vitest";
import type { ChapterDef } from "../../src/chapters/manifest";
import { scanNarrations } from "./scanner-text";

const NOOP = (() => null) as unknown as ChapterDef["Component"];

/** 手工构造 ChapterDef（steps 可覆写，模拟 manifest 导入数据被破坏的坏状态）。 */
function chapter(id: string, narrations: string[], steps?: number): ChapterDef {
  return {
    id,
    folder: "00-test",
    steps: steps ?? narrations.length,
    narrations,
    Component: NOOP,
  };
}

describe("narrations 文本扫描器", () => {
  it("非空护栏：chapters 空数组报错", () => {
    expect(() => scanNarrations([])).toThrow();
  });

  it("负样本：#1 steps 与 narrations.length 不符 → blocker（双向：多报/少报）", () => {
    const r = scanNarrations([
      chapter("steps-more", ["第一句", "第二句"], 3),
      chapter("steps-less", ["第一句", "第二句"], 1),
    ]);
    const blockers = r.filter((f) => f.rule === "manifest一致性");
    expect(blockers).toHaveLength(2);
    expect(blockers.every((f) => f.severity === "blocker")).toBe(true);
    expect(blockers.map((f) => f.location)).toEqual(["steps-more", "steps-less"]);
    expect(blockers[0].message).toContain("3");
    expect(blockers[0].message).toContain("2");
  });

  it("负样本：#11 十条 AI 句式各命中 → warning（定位 chapter.id + 索引）", () => {
    const r = scanNarrations([
      chapter("ai", [
        "说白了这就是工具",
        "本质上它是渲染器",
        "恰恰相反，越简单越好",
        "反而更快了",
        "正是因为太简单",
        "归根结底是成本",
        "我必须认真说一句",
        "不得不说一句实话",
        "众所周知的事情",
        "毋庸置疑是对的",
      ]),
    ]);
    const hits = r.filter((f) => f.rule === "文案反AI味");
    expect(hits).toHaveLength(10);
    expect(hits.every((f) => f.severity === "warning")).toBe(true);
    expect(hits.map((f) => f.location)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ai:narrations[${i}]`),
    );
  });

  it("负样本：#11 变体「归根到底」命中；单句多词合并一条并列出全部词", () => {
    const r = scanNarrations([
      chapter("variant", ["归根到底，还是得靠人", "说白了，本质上这就是结论"]),
    ]);
    const hits = r.filter((f) => f.rule === "文案反AI味");
    expect(hits).toHaveLength(2);
    expect(hits[0].location).toBe("variant:narrations[0]");
    expect(hits[0].message).toContain("归根到底");
    expect(hits[1].message).toContain("说白了");
    expect(hits[1].message).toContain("本质上");
  });

  it("负样本：V3 结尾句号/逗号/书名号/省略号各命中 → warning", () => {
    const r = scanNarrations([
      chapter("punct", ["这是句号。", "这是逗号，", "这是书名号》", "这是省略号……", "干净的结尾"]),
    ]);
    const hits = r.filter((f) => f.rule === "字幕结尾标点");
    expect(hits).toHaveLength(4);
    expect(hits.every((f) => f.severity === "warning")).toBe(true);
    expect(hits.map((f) => f.location)).toEqual([
      "punct:narrations[0]",
      "punct:narrations[1]",
      "punct:narrations[2]",
      "punct:narrations[3]",
    ]);
  });

  it("负样本：V3 结尾标点前有尾随空白仍命中（空白不掩标点）", () => {
    const r = scanNarrations([chapter("ws", ["这是句号。 "])]);
    expect(r.some((f) => f.rule === "字幕结尾标点")).toBe(true);
  });

  it("false-positive：正常口播句无 AI 味、结尾 ？！ 合法、空串与无标点全通过", () => {
    const r = scanNarrations([
      chapter("ok", [
        "这个工具用起来很快",
        "它为什么这么快？",
        "动手试试看！",
        "先看数据，再动手",
        "",
      ]),
    ]);
    expect(r).toEqual([]);
  });

  it("章间隔离：好章节零 finding，坏章节的定位只指向自己", () => {
    const r = scanNarrations([
      chapter("clean", ["第一句", "第二句"]),
      chapter("dirty", ["说白了这是坏数据", "结尾句号。"]),
    ]);
    expect(r.some((f) => f.rule === "文案反AI味")).toBe(true);
    expect(r.some((f) => f.rule === "字幕结尾标点")).toBe(true);
    expect(r.every((f) => f.location.startsWith("dirty:"))).toBe(true);
  });
});
