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
