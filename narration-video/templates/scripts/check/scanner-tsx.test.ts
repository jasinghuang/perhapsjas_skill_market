import { describe, expect, it, vi } from "vitest";
import { scanChapterTsx } from "./scanner-tsx";

const CH = "src/chapters/01-bad/index.tsx";

describe("章节层 TSX 扫描器", () => {
  it("非空护栏：输入 files 数组非空才扫描，空数组报错", () => {
    expect(() => scanChapterTsx([])).toThrow();
  });

  it("负样本：inline style 色/SVG fill 裸色/黑名单/无限迭代/裸缓动各命中对应规则名（全 blocker）", () => {
    const r = scanChapterTsx([
      {
        path: CH,
        source: `
export function Bad({ step }: { step: number }) {
  return (
    <div style={{ color: "#f00", backgroundColor: "rgb(1,2,3)", border: "1px solid tomato" }}>
      <svg>
        <rect fill="#00ff00" stroke="rgba(255,0,0,0.5)" />
      </svg>
      <div style="color: #f0f">字符串 style 属性</div>
    </div>
  );
}
export const timers = () => {
  setTimeout(() => {}, 1000);
  setInterval(() => {}, 500);
};
export const rnd = () => {
  const a = Math.random();
  const b = performance.now();
  requestAnimationFrame(() => {});
  const d = new Date();
  return [a, b, d];
};
export const loops = () => ({
  a: { iterations: Infinity },
  b: { iterations: -1 },
});
export const easing = { transition: "cubic-bezier(0.16,1,0.3,1)" };
`,
      },
    ]);
    const rules = new Set(r.map((f) => f.rule));
    expect(rules).toEqual(
      new Set(["禁硬编码色", "SVG属性色值", "确定性黑名单", "无限循环动画", "禁裸缓动"]),
    );
    expect(r.every((f) => f.severity === "blocker")).toBe(true);
    // 定位格式：path:line（与 scanner-css 一致）
    expect(r.every((f) => /^src\/chapters\/01-bad\/index\.tsx:\d+$/.test(f.location))).toBe(true);
  });

  it("false-positive：engine 黑名单+easing 豁免、组件 easing 豁免、var()/none/white-black 全通过", () => {
    const engine = scanChapterTsx([
      {
        path: "src/engine/clock.ts",
        source: `
export const tick = () => {
  setTimeout(() => {}, 100);
  setInterval(() => {}, 100);
  requestAnimationFrame(() => {});
  const a = Math.random();
  const b = performance.now();
  const c = Date.now();
  const d = new Date(2026);
  return [a, b, c, d];
};
export const EASE = "cubic-bezier(0,0,0.2,1)";
`,
      },
    ]);
    expect(engine).toEqual([]);

    const componentsEasing = scanChapterTsx([
      {
        path: "src/components/reveal/MaskReveal.tsx",
        source: `export const EASE = "cubic-bezier(0,0,0.2,1)";`,
      },
    ]);
    expect(componentsEasing).toEqual([]);

    // P4-7：组件同为库代码，黑名单只豁免 engine/——组件内 setTimeout 仍报
    const componentsTimer = scanChapterTsx([
      {
        path: "src/components/reveal/MaskReveal.tsx",
        source: `export const warmup = () => setTimeout(() => {}, 0);`,
      },
    ]);
    expect(componentsTimer.some((f) => f.rule === "确定性黑名单" && f.severity === "blocker")).toBe(true);

    const legal = scanChapterTsx([
      {
        path: CH,
        source: `
export function Legal() {
  return (
    <div
      style={{
        color: "var(--text)",
        backgroundColor: "white",
        borderColor: "#fff",
        outlineColor: "black",
        textDecorationColor: "#000",
      }}
    >
      <svg>
        <rect fill="none" stroke="none" />
        <rect fill="var(--accent-1)" stroke="var(--ink)" />
        <rect fill="white" fillOpacity={0.5} strokeWidth="2" />
      </svg>
    </div>
  );
}
export const finite = { iterations: 3, iterations2: Infinity };
`,
      },
    ]);
    expect(legal).toEqual([]);
  });

  it("解析失败文件 throw（宁炸不假绿——语法错误文件无法 AST 扫描）", () => {
    expect(() =>
      scanChapterTsx([{ path: CH, source: "export const broken = const;" }]),
    ).toThrow(/解析失败/);
  });
});

describe("章节层 TSX 扫描器 · 规则细节", () => {
  it("黑名单：window./globalThis. 前缀别名、Date.now 同样命中", () => {
    const r = scanChapterTsx([
      {
        path: CH,
        source: `
export const a = () => window.setTimeout(() => {}, 1);
export const b = () => globalThis.requestAnimationFrame(() => {});
export const c = Date.now();
`,
      },
    ]);
    expect(r.filter((f) => f.rule === "确定性黑名单")).toHaveLength(3);
  });

  it("黑名单点分成员别名不逃逸：window.Math.random/window.performance.now/globalThis.Date.now/new window.Date() 全命中（Finding 1）", () => {
    const r = scanChapterTsx([
      {
        path: CH,
        source: `
export const a = window.Math.random();
export const b = window.performance.now();
export const c = globalThis.Date.now();
export const d = new window.Date();
`,
      },
    ]);
    expect(r.filter((f) => f.rule === "确定性黑名单")).toHaveLength(4);
  });

  it("豁免锚定：src 直下 engine/components 才豁免，祖辈/伪前缀路径不豁免（Finding 2）", () => {
    const home = scanChapterTsx([
      { path: "/home/user/engine/x.tsx", source: "export const t = setTimeout(() => {}, 1);" },
    ]);
    expect(home.some((f) => f.rule === "确定性黑名单")).toBe(true);
    const engineFoo = scanChapterTsx([
      { path: "src/chapters/engine-foo/x.tsx", source: "export const t = setTimeout(() => {}, 1);" },
    ]);
    expect(engineFoo.some((f) => f.rule === "确定性黑名单")).toBe(true);
    const componentsFoo = scanChapterTsx([
      { path: "src/chapters/components-foo/x.tsx", source: `export const e = "cubic-bezier(0,0,0.2,1)";` },
    ]);
    expect(componentsFoo.some((f) => f.rule === "禁裸缓动")).toBe(true);
  });

  it("parseDiagnostics 内部属性缺失即 throw（Minor 4，宁炸不假绿）", async () => {
    // typescript 是冻结 ESM namespace（vi.spyOn 不可用），用 doMock + 重导入注入缺失场景
    vi.resetModules();
    vi.doMock("typescript", () => ({
      default: {
        createSourceFile: () => ({}),
        ScriptTarget: { Latest: 99 },
        ScriptKind: { TSX: 4 },
      },
    }));
    try {
      const mod = await import("./scanner-tsx");
      expect(() => mod.scanChapterTsx([{ path: CH, source: "export const x = 1;" }])).toThrow(
        /parseDiagnostics/,
      );
    } finally {
      vi.doUnmock("typescript");
      vi.resetModules();
    }
  });

  it("new Date() 章节层命中、engine 路径豁免（含 new Date(2026)）", () => {
    const chapter = scanChapterTsx([{ path: CH, source: "export const d = new Date(2026);" }]);
    expect(chapter.some((f) => f.rule === "确定性黑名单" && f.severity === "blocker")).toBe(true);
    const engine = scanChapterTsx([
      { path: "src/engine/clock.ts", source: "export const d = new Date(2026);" },
    ]);
    expect(engine).toEqual([]);
  });

  it("无限循环动画：iterations: Infinity/-1/-Infinity 命中、有限值通过", () => {
    const r = scanChapterTsx([
      {
        path: CH,
        source: `
export const cfg = () => ({
  a: { iterations: Infinity },
  b: { iterations: -1 },
  d: { iterations: -Infinity },
  c: { iterations: 3 },
});
`,
      },
    ]);
    expect(r.filter((f) => f.rule === "无限循环动画")).toHaveLength(3);
  });

  it("SVG 色值：fill/stroke 表达式形式命中、fillOpacity/strokeWidth 不受影响", () => {
    const r = scanChapterTsx([
      {
        path: CH,
        source: `
export function Svg() {
  return (
    <svg>
      <rect fill={"#f00"} stroke={undefined} />
      <rect fillOpacity={0.5} strokeWidth="2" />
    </svg>
  );
}
`,
      },
    ]);
    expect(r.filter((f) => f.rule === "SVG属性色值")).toHaveLength(1);
  });

  it("禁裸缓动：章节层模板串同样命中；模板串带表达式不误报（静态段无完整色值）", () => {
    const r = scanChapterTsx([
      {
        path: CH,
        source: `
export const e = \`ease: cubic-bezier(0.16,1,0.3,1)\`;
export const dyn = \`color: #f\${"0"}0\`;
`,
      },
    ]);
    expect(r.filter((f) => f.rule === "禁裸缓动")).toHaveLength(1);
    expect(r.filter((f) => f.rule === "禁硬编码色")).toHaveLength(0);
  });
});
