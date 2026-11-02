/**
 * check.test.ts（M3b Task 7）：全量入口的**纯判据面**单测 + 无头 pass 的消费契约。
 *
 * 边界（诚实标注）：真浏览器驱动（自起 Vite / openSession / page.evaluate）不在本文件里测
 * ——本文件用注入式 deps 钉住编排语义（标题 / 合并 / 退出码 / 标志位），用纯函数钉住
 * #16 三断言的判据（console 归因 / 溢出归 Finding / 动画逃逸分级）。真机正反样本见
 * 实现报告（Task 7 Step 5）。
 *
 * 修复轮 1（I1）：`openSession` 的导航前钩子 `beforeGoto` 的两条测试（调用顺序替身 + 真机两臂）
 * 放在 `scripts/shot/session.test.ts`——它们测的是 session 的契约，且真机臂不能被本文件的
 * playwright 替身（vi.mock 是文件级）截胡。
 */

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { AnimationAudit } from "../../src/engine/cursorBridge";
import type { ChapterDef } from "../../src/chapters/manifest";
import { ExampleChapter } from "../../src/chapters/01-example";
import { SAFE_AREA_BASE } from "../../src/engine/safe-area";
import { FindingBag } from "./findings";
import {
  CHECK_REPORT_TITLE,
  CHECK_FAST_ONLY_TITLE,
  parseArgs,
  reportTitle,
  runCheck,
  runCheckCli,
} from "./check";
import {
  ConsoleWindow,
  animationEscapeVerdict,
  collectorExaminedGuard,
  examinedGuard,
  fontsVerdict,
  frameLocation,
  isPageScriptLocation,
  judgeStep,
  triageConsoleEvents,
  withRenderMode,
  type RawConsoleEvent,
} from "./headless";
import {
  CONTRAST_RULE,
  FONT_RULE,
  SAFE_MARGIN_RULE,
  STAGE_SELECTOR,
  unionFamilies,
  type CollectorResult,
} from "./collectors";

// ── URL 归一 ──

describe("withRenderMode：render=1 幂等归一", () => {
  it("无 query → 追加 ?render=1；既有 query 保留", () => {
    expect(withRenderMode("http://localhost:5174")).toBe("http://localhost:5174/?render=1");
    expect(withRenderMode("http://localhost:5174/?auto=1")).toBe(
      "http://localhost:5174/?auto=1&render=1",
    );
  });

  it("已含 render → 原样（幂等，不翻倍；与 withHeadless 同款语义）", () => {
    expect(withRenderMode("http://localhost:5174/?render=1")).toBe("http://localhost:5174/?render=1");
    expect(withRenderMode(withRenderMode("http://a:1/?headless=1"))).toBe(
      "http://a:1/?headless=1&render=1",
    );
  });
});

// ── #16 ① console 归因 ──

describe("console 归因：blocker 只认 pageerror 与 console.error（本页脚本）", () => {
  const PAGE = "http://localhost:5174/?render=1&headless=1";

  it("isPageScriptLocation：本页脚本 vs 浏览器 Log 类", () => {
    expect(isPageScriptLocation("http://localhost:5174/src/App.tsx?t=1", PAGE)).toBe(true);
    expect(isPageScriptLocation("http://localhost:5174/node_modules/.vite/deps/react.js?v=x", PAGE)).toBe(true);
    // 浏览器 Log 类（弃用告警 / CSP / 非 passive 监听器）：无来源或非脚本 URL
    expect(isPageScriptLocation("", PAGE)).toBe(false);
    expect(isPageScriptLocation(PAGE, PAGE)).toBe(false); // 文档自身 URL = 内联/浏览器上报
    expect(isPageScriptLocation("http://localhost:5174/", PAGE)).toBe(false);
    expect(isPageScriptLocation("https://other.example/x.js", PAGE)).toBe(false);
    expect(isPageScriptLocation("data:text/javascript,void 0", PAGE)).toBe(false);
  });

  it("pageerror → blocker；本页 console.error → blocker；浏览器 Log 类 → info（不报 warning）", () => {
    const events: RawConsoleEvent[] = [
      { kind: "pageerror", level: "error", text: "Uncaught TypeError: boom", locationUrl: "" },
      {
        kind: "console",
        level: "error",
        text: "Warning: Each child in a list should have a unique key",
        locationUrl: "http://localhost:5174/src/chapters/01-example/index.tsx",
      },
      {
        kind: "console",
        level: "warning",
        text: "Third-party cookie will be blocked.",
        locationUrl: "",
      },
      { kind: "console", level: "log", text: "[vite] connected.", locationUrl: "" },
    ];
    const triage = triageConsoleEvents(events, PAGE);
    expect(triage.blockers).toHaveLength(2);
    expect(triage.infos).toHaveLength(1); // 浏览器 Log 类 → info 并计数
    expect(triage.blockers.map((e) => e.text).join()).toContain("boom");
    expect(triage.infos[0].text).toContain("Third-party cookie");
  });

  it("本页 console.warn 计 info（不判级）——#16 只认 error", () => {
    const triage = triageConsoleEvents(
      [
        {
          kind: "console",
          level: "warning",
          text: "自绘警告",
          locationUrl: "http://localhost:5174/src/App.tsx",
        },
      ],
      PAGE,
    );
    expect(triage.blockers).toEqual([]);
    expect(triage.infos).toHaveLength(1);
  });
});

// ── #16 ② / ③ + 归 Finding ──

const CHAPTER_A: ChapterDef = {
  id: "example",
  folder: "01-example",
  steps: 2,
  narrations: ["a", "b"],
  Component: () => null,
};

function auditOf(over: Partial<AnimationAudit> = {}): AnimationAudit {
  return {
    waapi: 0,
    owned: 0,
    unowned: 0,
    unownedRunning: 0,
    unownedHints: [],
    running: 0,
    registry: 1,
    windowMs: 8000,
    ...over,
  };
}

function overflowOf(over: Partial<CollectorResult> = {}): CollectorResult {
  return { findings: [], examined: 3, ...over };
}

describe("#16 ② 溢出收集结果 → Finding（定位到步）", () => {
  it("收集器 blocker 带步定位与元素描述；warning/info 也原样归位", () => {
    const verdict = judgeStep(
      {
        spec: { chapter: 0, step: 1 },
        chapterId: "example",
        consoleEvents: [],
        overflow: overflowOf({
          findings: [
            {
              rule: "被画布截断",
              severity: "blocker",
              location: "div#probe",
              message: "元素越出画布（左 200px）",
            },
          ],
        }),
        audit: auditOf(),
      },
      { pageUrl: "http://localhost:5174/?render=1&headless=1", renderMode: true },
    );
    expect(verdict.findings).toHaveLength(1);
    const f = verdict.findings[0];
    expect(f.severity).toBe("blocker");
    expect(f.rule).toBe("被画布截断");
    expect(f.location).toContain("章节 0 第 1 步");
    expect(f.location).toContain("example");
    expect(f.location).toContain("div#probe");
  });

  it("收集器 info → note（计数，不进退出码）", () => {
    const verdict = judgeStep(
      {
        spec: { chapter: 0, step: 0 },
        chapterId: "example",
        consoleEvents: [],
        overflow: overflowOf({
          findings: [{ rule: "不可判定", severity: "info", location: "x", message: "渐变背景" }],
        }),
        audit: auditOf(),
      },
      { pageUrl: "http://localhost:5174/", renderMode: true },
    );
    expect(verdict.findings).toEqual([]);
    expect(verdict.notes.join()).toContain("渐变背景");
  });
});

// ── 修复轮 1（I3）：Task 8 新增判级面的单测 ──
//
// 为什么补在这里：`headless.ts` 的 Task 8 判级面（#14 的 fontsVerdict / 收集器级护栏的新
// label / judgeStep 的两个新面）此前**零单测**——它们只在真机 pass 里跑到，回归时没人拦。
// 本文件是 headless 判据的既有测试位（不做浏览器驱动，纯判据）。

describe("修复轮 1（I3）：收集器级非空护栏的 label / hint", () => {
  it("#20 / #18 各自的文案带自己的检查名（三条检查不共用同一句措辞）", () => {
    const margins = collectorExaminedGuard(SAFE_MARGIN_RULE, 0, "文本元素")!;
    expect(margins.severity).toBe("blocker");
    expect(margins.location).toBe(STAGE_SELECTOR);
    expect(margins.message).toContain(SAFE_MARGIN_RULE);
    expect(margins.message).toContain("文本元素");

    const contrast = collectorExaminedGuard(CONTRAST_RULE, 0, "文本元素")!;
    expect(contrast.message).toContain(CONTRAST_RULE);
    expect(contrast.message).not.toContain(SAFE_MARGIN_RULE); // 两条检查的面不得互相冒充
    expect(contrast.message).toContain("文本元素");
  });

  it("> 0 → null（护栏只在什么都没查时报）", () => {
    expect(collectorExaminedGuard(SAFE_MARGIN_RULE, 4, "文本元素")).toBeNull();
    expect(collectorExaminedGuard(CONTRAST_RULE, 1, "文本元素")).toBeNull();
    // 旧面（溢出）文案逐字不变（T7 面不动）
    expect(examinedGuard(0)!.message).toContain("溢出收集器");
    expect(examinedGuard(0)!.message).toContain("元素");
  });
});

describe("修复轮 1（I3）：judgeStep 的 #20 / #18 存在臂与缺省臂", () => {
  const PAGE = "http://localhost:5174/?render=1&headless=1";
  const marginsFinding = {
    rule: SAFE_MARGIN_RULE,
    severity: "warning" as const,
    location: "div#scene-0",
    message: "文本元素越出内容带（左 16px）",
  };
  const contrastInfo = {
    rule: CONTRAST_RULE,
    severity: "info" as const,
    location: "div#grad",
    message: "渐变背景不可判定",
  };

  it("存在臂：两面的 finding 都归位到该步（warning 进袋、info 进 note）", () => {
    const verdict = judgeStep(
      {
        spec: { chapter: 0, step: 0 },
        chapterId: "example",
        consoleEvents: [],
        overflow: overflowOf(),
        safeMargins: { findings: [marginsFinding], examined: 2 },
        contrast: { findings: [contrastInfo], examined: 2 },
        audit: auditOf(),
      },
      { pageUrl: PAGE, renderMode: true },
    );
    const marginFinding = verdict.findings.find((f) => f.rule === SAFE_MARGIN_RULE);
    expect(marginFinding).toBeDefined();
    expect(marginFinding!.severity).toBe("warning");
    expect(marginFinding!.location).toContain("章节 0 第 0 步");
    expect(marginFinding!.location).toContain("div#scene-0");
    expect(verdict.findings.some((f) => f.rule === CONTRAST_RULE)).toBe(false); // info 不判级
    expect(verdict.notes.join()).toContain("渐变背景不可判定");
  });

  it("缺省臂：未采（字段缺省）→ **不产出该面 finding**（防「漏接采集却静默通过」）", () => {
    const verdict = judgeStep(
      {
        spec: { chapter: 0, step: 0 },
        chapterId: "example",
        consoleEvents: [],
        overflow: overflowOf(),
        audit: auditOf(),
      },
      { pageUrl: PAGE, renderMode: true },
    );
    expect(verdict.findings).toEqual([]);
    expect(verdict.notes).toEqual([]);
  });
});

describe("修复轮 1（C1）：#14 fontsVerdict 的三条判据（使用面 = 全 deck 并集）", () => {
  it("并集覆盖加载面 → 无 finding 也无 info（真实 deck 的常态）", () => {
    const v = fontsVerdict({
      loadedFamilies: ["JetBrains Mono"],
      usedFamilies: unionFamilies([["Times", "JetBrains Mono"], ["Times"]]),
      fontFaceCount: 317,
      familyCount: 5,
      examined: 6,
    });
    expect(v.findings).toEqual([]);
    expect(v.notes).toEqual([]);
  });

  it("加载面多出使用面 → blocker 带家族名清单（真「加载了没人用」，不因改成并集而消失）", () => {
    const v = fontsVerdict({
      loadedFamilies: ["Archivo Black"],
      usedFamilies: ["Times"],
      fontFaceCount: 317,
      familyCount: 5,
      examined: 3,
    });
    const blocker = v.findings.find((f) => f.severity === "blocker")!;
    expect(blocker.rule).toBe(FONT_RULE);
    expect(blocker.message).toContain("Archivo Black");
    // 采样面看不到的加载来源要给出诊断方向（伪元素 / canvas 绘制 / 隐藏节点）
    expect(blocker.message).toContain("伪元素");
  });

  it("加载面为空 → info（不是 blocker）：全 deck 没有任何主题字体被加载", () => {
    const v = fontsVerdict({
      loadedFamilies: [],
      usedFamilies: ["Times"],
      fontFaceCount: 0,
      familyCount: 0,
      examined: 6,
    });
    expect(v.findings).toEqual([]);
    expect(v.notes).toHaveLength(1);
    expect(v.notes[0]).toContain(FONT_RULE);
    expect(v.notes[0]).toContain("没有任何主题字体");
  });
});

describe("修复轮 1（I2）：示例章节（门禁标杆）的文字落在安全框内", () => {
  it("三个 scene div 都带安全边距（margin 而非 padding——#20 查 border box）", () => {
    for (const step of [0, 1, 2]) {
      // 本文件是 .ts（不是 .tsx）：JSX 不可用 → 用 createElement 等价的调用形式
      const { container, unmount } = render(createElement(ExampleChapter, { step }));
      const scene = container.querySelector(`[data-testid="scene-${step}"]`)!;
      const st = getComputedStyle(scene);
      // 数字来自 §12b V1 的基准档案（SAFE_AREA_BASE）——与章节侧派生所用的单一源互为独立表述
      expect(st.marginTop, `step ${step} 顶边距`).toBe(`${SAFE_AREA_BASE.top}px`);
      expect(st.marginLeft, `step ${step} 左边距`).toBe(`${SAFE_AREA_BASE.content}px`);
      expect(st.marginRight, `step ${step} 右边距`).toBe(`${SAFE_AREA_BASE.content}px`);
      expect(scene.className).not.toContain("padding-"); // 别把修法换回 padding（实测无效）
      unmount();
    }
  });

  it("标杆非空：安全框数字是真约束（不是 0——否则上一条恒真）", () => {
    expect(SAFE_AREA_BASE.top).toBeGreaterThan(0);
    expect(SAFE_AREA_BASE.content).toBeGreaterThan(0);
  });
});

describe("#16 ③ 动画逃逸分级", () => {
  it("unownedRunning > 0 → blocker（附 hints）", () => {
    const v = animationEscapeVerdict(
      auditOf({ unowned: 2, unownedRunning: 1, unownedHints: ["body > div.wave"], running: 1 }),
      { renderMode: true },
    );
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0].severity).toBe("blocker");
    expect(v.findings[0].rule).toBe("动画逃逸");
    expect(v.findings[0].message).toContain("body > div.wave");
  });

  it("render 下 audit.running > 0 → blocker（引擎动画在 render 模式恒 paused）", () => {
    const v = animationEscapeVerdict(auditOf({ waapi: 1, owned: 1, running: 1 }), {
      renderMode: true,
    });
    expect(v.findings.map((f) => f.severity)).toEqual(["blocker"]);
    expect(v.findings[0].message).toContain("render");
  });

  it("unowned > 0 但未在跑（CSS transition 残影）→ warning（列 hints），不判 blocker", () => {
    const v = animationEscapeVerdict(
      auditOf({ unowned: 1, unownedRunning: 0, unownedHints: ["div.fade"] }),
      { renderMode: true },
    );
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0].severity).toBe("warning");
    expect(v.findings[0].message).toContain("div.fade");
  });

  it("全 0（模板常态：注册表 1 / WAAPI 0）→ 无 finding 无 note", () => {
    const v = animationEscapeVerdict(auditOf(), { renderMode: true });
    expect(v.findings).toEqual([]);
    expect(v.notes).toEqual([]);
  });

  it("非 render 下 running 不判 blocker（判定条件里 render 是显式的）", () => {
    const v = animationEscapeVerdict(auditOf({ waapi: 1, owned: 1, running: 1 }), {
      renderMode: false,
    });
    expect(v.findings).toEqual([]);
  });
});

describe("#16 归因窗口（ConsoleWindow）", () => {
  const ev = (text: string): RawConsoleEvent => ({
    kind: "console",
    level: "error",
    text,
    locationUrl: "http://localhost:5174/src/App.tsx",
  });

  it("drain 取走并清空（每步只对「自上次取走以来」的消息负责——跨步不累积、不迁移）", () => {
    const w = new ConsoleWindow();
    w.push(ev("a"));
    expect(w.drain().map((e) => e.text)).toEqual(["a"]);
    expect(w.drain()).toEqual([]);
    expect(w.size()).toBe(0);
    w.push(ev("b"));
    w.push(ev("c"));
    expect(w.drain()).toHaveLength(2);
  });

  // 用例名随窗口语义更正（T7 复审 nit）：修复轮 1 / I1 后已无"开场/框架期"专属窗口——装载期
  // 消息归首步（(0,0)），故 clear 的消费面只剩**中止路径**。
  it("clear 丢弃（中止路径：这些消息不得计入任何一步）", () => {
    const w = new ConsoleWindow();
    w.push(ev("boot"));
    w.clear();
    expect(w.drain()).toEqual([]);
  });
});

describe("#16 归因窗口与步定位", () => {
  it("frameLocation：章节/步/chapterId 三者齐备", () => {
    expect(frameLocation({ chapter: 1, step: 2 }, "ch-b")).toBe("章节 1 第 2 步（ch-b）");
  });

  it("pageerror 也按步定位（消息文本原样带出）", () => {
    const verdict = judgeStep(
      {
        spec: { chapter: 0, step: 0 },
        chapterId: "example",
        consoleEvents: [
          { kind: "pageerror", level: "error", text: "Uncaught ReferenceError: x", locationUrl: "" },
        ],
        overflow: overflowOf(),
        audit: auditOf(),
      },
      { pageUrl: "http://localhost:5174/", renderMode: true },
    );
    expect(verdict.findings[0].rule).toBe("运行期报错");
    expect(verdict.findings[0].location).toContain("章节 0 第 0 步");
    expect(verdict.findings[0].message).toContain("Uncaught ReferenceError");
  });
});

describe("非空护栏（收集器级）：全 deck examined === 0 → blocker", () => {
  it("累计 0 → blocker；> 0 → 无 finding", () => {
    expect(examinedGuard(0)?.severity).toBe("blocker");
    expect(examinedGuard(0)?.message).toContain(STAGE_SELECTOR);
    expect(examinedGuard(3)).toBeNull();
  });
});

// ── CLI 标志位 ──

describe("parseArgs：--url / --no-headless / --help", () => {
  it("缺省：无 url（自起）、跑无头", () => {
    expect(parseArgs([])).toEqual({ headless: true });
  });

  it("--url 两种写法（空格 / =）与 --no-headless", () => {
    expect(parseArgs(["--url", "http://localhost:5174"])).toEqual({
      headless: true,
      url: "http://localhost:5174",
    });
    expect(parseArgs(["--url=http://a:1", "--no-headless"])).toEqual({
      headless: false,
      url: "http://a:1",
    });
  });

  it("未知标志 / --url 缺值 → throw（打错字的标志不得静默改变门禁面）", () => {
    expect(() => parseArgs(["--urll", "http://a:1"])).toThrow(/未知参数/);
    expect(() => parseArgs(["--url"])).toThrow(/--url/);
  });
});

// ── 编排（注入 deps：不启浏览器） ──

describe("runCheck：fast + 无头合并、标题与退出码", () => {
  const fastBag = () => {
    const b = new FindingBag();
    b.add({ rule: "静态", severity: "warning", location: "a.css:1", message: "m" });
    return b;
  };
  const headlessBag = () => {
    const b = new FindingBag();
    b.add({ rule: "被画布截断", severity: "blocker", location: "章节 0 第 1 步（example）", message: "m" });
    b.addNote("#16 采集读数：已跑 2 步；元素检查面累计 examined 6", "readout");
    return b;
  };

  it("两层都跑 → 合并报告（自定义标题）+ blocker 决定 exit 1；无头 notes 带出", async () => {
    const bag = await runCheck(
      { chapters: [CHAPTER_A] },
      {
        runFast: async () => fastBag(),
        runHeadless: async () => headlessBag(),
      },
    );
    const out = bag.render(CHECK_REPORT_TITLE);
    expect(out).toContain(CHECK_REPORT_TITLE);
    expect(out).toContain("共 2 项（blocker 1，warning 1）");
    expect(out).toContain("元素检查面累计 examined 6");
    expect(bag.exitCode()).toBe(1);
  });

  it("--no-headless → 只跑 fast（标题不同，无头不启动）", async () => {
    let headlessCalls = 0;
    const bag = await runCheck(
      { headless: false, chapters: [CHAPTER_A] },
      {
        runFast: async () => fastBag(),
        runHeadless: async () => {
          headlessCalls++;
          return new FindingBag();
        },
      },
    );
    expect(headlessCalls).toBe(0);
    expect(bag.exitCode()).toBe(0);
    expect(bag.render(CHECK_FAST_ONLY_TITLE)).toContain(CHECK_FAST_ONLY_TITLE);
  });

  it("reportTitle 如实反映这一轮查了什么（全量 vs 无头已跳过）", () => {
    expect(reportTitle({ headless: true })).toBe(CHECK_REPORT_TITLE);
    expect(reportTitle({ headless: false })).toBe(CHECK_FAST_ONLY_TITLE);
  });

  it("runCheckCli：打印报告 + 返回退出码；--help 不跑任何一层", async () => {
    const printed: string[] = [];
    const io = { log: (t: string) => printed.push(t), error: (t: string) => printed.push(t) };
    const code = await runCheckCli([], {
      deps: { runFast: async () => fastBag(), runHeadless: async () => headlessBag() },
      io,
    });
    expect(code).toBe(1);
    expect(printed.join("\n")).toContain(CHECK_REPORT_TITLE);

    printed.length = 0;
    const helpCode = await runCheckCli(["--help"], {
      deps: {
        runFast: async () => {
          throw new Error("--help 不该跑 fast 层");
        },
      },
      io,
    });
    expect(helpCode).toBe(0);
    expect(printed.join("\n")).toContain("--no-headless");
  });

  it("chapters 注入透传给两层（调用方给什么就用什么）", async () => {
    const seen: Array<readonly ChapterDef[]> = [];
    await runCheck(
      { chapters: [CHAPTER_A] },
      {
        runFast: async (o) => {
          seen.push(o.chapters ?? []);
          return new FindingBag();
        },
        runHeadless: async (o) => {
          seen.push(o.chapters);
          return new FindingBag();
        },
      },
    );
    expect(seen.every((c) => c[0]?.id === "example")).toBe(true);
  });

  it("--url 透传给无头层（显式复用外部服务）", async () => {
    let seenUrl: string | undefined;
    await runCheck(
      { url: "http://localhost:5174", chapters: [CHAPTER_A] },
      {
        runFast: async () => new FindingBag(),
        runHeadless: async (o) => {
          seenUrl = o.url;
          return new FindingBag();
        },
      },
    );
    expect(seenUrl).toBe("http://localhost:5174");
  });
});
