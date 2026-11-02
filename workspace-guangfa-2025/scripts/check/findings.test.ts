import { describe, expect, it } from "vitest";
import { FindingBag } from "./findings";

describe("findings 模型", () => {
  it("blocker 决定 exit code 1，否则 0", () => {
    const a = new FindingBag();
    expect(a.exitCode()).toBe(0);
    a.add({ rule: "r", severity: "warning", location: "f.ts:1", message: "m" });
    expect(a.exitCode()).toBe(0);
    a.add({ rule: "r2", severity: "blocker", location: "f.ts:2", message: "m2" });
    expect(a.exitCode()).toBe(1);
    expect(a.hasBlockers()).toBe(true);
  });

  it("render 输出分级清单（含计数与非空护栏语义）", () => {
    const a = new FindingBag();
    a.add({ rule: "禁硬编码色", severity: "blocker", location: "chapters/01/x.css:3", message: "裸色值 #f00" });
    a.add({ rule: "字阶校验", severity: "warning", location: "chapters/01/x.css:7", message: "字号 20px 低于最小字号 24px" });
    const out = a.render();
    expect(out).toContain("[blocker]");
    expect(out).toContain("[warning]");
    expect(out).toContain("禁硬编码色");
    expect(out).toContain("chapters/01/x.css:3");
  });
});

describe("findings 追加面（M3b Task 7：addAll / merge / render(title)）", () => {
  it("render(title)：自定义标题；默认标题逐字不变；空袋分支同样带标题", () => {
    // 默认值不变——既有消费方（check:fast CLI）的报告首行逐字不动
    expect(new FindingBag().render()).toBe("静态门禁报告：0 项（blocker 0，warning 0）");
    // 空袋分支不是"没有标题"的特例：换标题也要换
    expect(new FindingBag().render("门禁报告（fast + 无头）")).toBe(
      "门禁报告（fast + 无头）：0 项（blocker 0，warning 0）",
    );
    // 非空袋同标题
    const a = new FindingBag();
    a.add({ rule: "r", severity: "warning", location: "l", message: "m" });
    expect(a.render("门禁报告（fast + 无头）")).toContain("门禁报告（fast + 无头）：共 1 项");
    expect(a.render()).toContain("静态门禁报告：共 1 项");
  });

  it("addAll：按数组序追加；空数组不改变任何结果（双护栏）", () => {
    const a = new FindingBag();
    a.addAll([]);
    // 空数组：三项读数全不变（数量 / 退出码 / 报告逐字）
    expect(a.exitCode()).toBe(0);
    expect(a.hasBlockers()).toBe(false);
    expect(a.render()).toBe("静态门禁报告：0 项（blocker 0，warning 0）");
    a.addAll([
      { rule: "r1", severity: "warning", location: "l1", message: "m1" },
      { rule: "r2", severity: "warning", location: "l2", message: "m2" },
    ]);
    // 顺序 = 数组序（报告按插入序输出，同 severity 内不得被重排）
    const lines = a.render().split("\n");
    expect(lines[1]).toContain("l1");
    expect(lines[2]).toContain("l2");
  });

  it("merge：other 的全部 findings 并入（含 blocker → exit code 1）；空袋合并不改变结果", () => {
    const a = new FindingBag();
    const b = new FindingBag();
    a.add({ rule: "fast", severity: "warning", location: "fast:1", message: "m" });
    b.add({ rule: "headless", severity: "warning", location: "render:0:0", message: "m" });
    b.add({ rule: "被画布截断", severity: "blocker", location: "render:0:1", message: "m" });
    expect(a.exitCode()).toBe(0);

    a.merge(b);
    // 并入后：总数 3（既有 render 语义不变——先 blocker 组后 warning 组，组内保持插入序；
    // 故 fast:1 与 render:0:0 两条 warning 的相对次序 = 插入序：a 的在前、b 的在后）
    const lines = a.render().split("\n");
    expect(lines[0]).toContain("共 3 项（blocker 1，warning 2）");
    expect(lines[1]).toContain("render:0:1");
    const warningAt = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(warningAt("fast:1")).toBeGreaterThan(1);
    expect(warningAt("render:0:0")).toBeGreaterThan(warningAt("fast:1"));
    expect(a.exitCode()).toBe(1);
    expect(a.hasBlockers()).toBe(true);

    // 合并空袋：三个读数都不动（双护栏）
    const before = a.render();
    a.merge(new FindingBag());
    expect(a.render()).toBe(before);
    expect(a.exitCode()).toBe(1);
  });
});

describe("findings info 通道（M3b Task 7：#16/Task 8 的「计数但不判级」条目）", () => {
  it("addNote：报告末尾成段列出；无 note 时报告逐字不变（既有消费方不受影响）", () => {
    const a = new FindingBag();
    expect(a.render()).toBe("静态门禁报告：0 项（blocker 0，warning 0）");
    a.addNote("浏览器 Log：Third-party cookie", "info");
    expect(a.notes()).toEqual(["浏览器 Log：Third-party cookie"]);
    const out = a.render();
    expect(out).toContain("info 1 条（不进退出码）");
    expect(out).toContain("Third-party cookie");
    // info 不进退出码（哪怕只有 note 没有 finding）
    expect(a.exitCode()).toBe(0);
    expect(a.hasBlockers()).toBe(false);
  });

  it("修复轮 M1：`info N 条` 只计 info finding；诊断读数单列、不混装（T8 的 #14/#18 要往同一通道塞 info）", () => {
    const a = new FindingBag();
    a.addNote("#16 无头 pass 基址：http://localhost:5175/?render=1&headless=1（进程内自起）", "readout");
    a.addNote("#16 采集读数：已跑 3 步；元素检查面累计 examined 10", "readout");
    a.addNote("章节 0 第 1 步 · [info] 浏览器 Log：deprecation warning", "info");

    expect(a.notes("info")).toEqual(["章节 0 第 1 步 · [info] 浏览器 Log：deprecation warning"]);
    expect(a.notes("readout")).toHaveLength(2);

    const out = a.render();
    // info 段只数真 info finding（诊断读数不得把它撑成 3 条）
    expect(out).toContain("info 1 条（不进退出码）");
    expect(out).not.toContain("info 3 条");
    expect(out).toContain("诊断读数");
    expect(out).toContain("元素检查面累计 examined 10");
  });

  it("修复轮 M3：notes() 返回副本——外部拿到的是快照，改不动内部状态", () => {
    const a = new FindingBag();
    a.addNote("x", "readout");
    const snapshot = a.notes("readout") as string[];
    snapshot.push("被外部塞进来的");
    expect(a.notes("readout")).toEqual(["x"]);
    expect(a.render()).toContain("诊断读数");
  });

  it("merge 连两类 notes 一并并入（fast 层与无头层的 notes 不得在合并时丢失/串档）", () => {
    const a = new FindingBag();
    const b = new FindingBag();
    a.addNote("fast readout", "readout");
    b.addNote("headless info", "info");
    b.addNote("headless readout", "readout");
    a.merge(b);
    expect(a.notes("info")).toEqual(["headless info"]);
    expect(a.notes("readout")).toEqual(["fast readout", "headless readout"]);
    const out = a.render();
    expect(out).toContain("info 1 条");
    expect(out).toContain("fast readout");
  });
});
