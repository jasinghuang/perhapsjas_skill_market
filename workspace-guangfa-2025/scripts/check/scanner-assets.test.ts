/**
 * scanner-assets 测试：资源类检查（M3a 静态门禁，§11.1 #12/#13/#14/#15）。
 *
 * 夹具：fs.mkdtemp 临时目录构造最小项目结构（src/chapters 章节文件 + src/theme 主题
 * 契约 + public/audio 音频产物 + SKILL.md/references 文档），repoRoot 可注入即夹具。
 *
 * 覆盖任务规格四块：
 *   - 护栏：repoRoot 不存在 throw、chapters 空数组 throw、src/chapters 缺失/零文件 throw
 *   - #12 负样本：章节层 tsx 与 css 外链 URL 各一 → blocker；
 *     false-positive：localhost 豁免、注释中的 URL（行注释/单行块注释/跨行块注释/行尾注释）
 *   - #13 负样本：部分 mp3 数量不一致 → blocker、零 mp3 但有 audio-durations.json → blocker；
 *     false-positive：零 mp3 无 durations → warning（P4-3 合法未合成态）、
 *     空串 narration 不计入期望、数量一致零 finding
 *   - #14 负样本：声明字体缺 @import → blocker、fonts.css 缺失全报、theme.json 缺失 throw、
 *     缺 fonts.declared throw；false-positive：声明字体全部加载（多 weight 同 slug）
 *   - #15 负样本：文档死链（](path) 与 <path> 角括号）→ warning（references 子目录同扫）；
 *     false-positive：合法链接/锚点/外链/目录目标/代码块/行内代码/HTML 标签
 *   - 整体干净项目 → 空 findings
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChapterDef } from "../../src/chapters/manifest";
import { scanAssets } from "./scanner-assets";

const NOOP = (() => null) as unknown as ChapterDef["Component"];

function chapter(id: string, folder: string, narrations: string[]): ChapterDef {
  return { id, folder, steps: narrations.length, narrations, Component: NOOP };
}

// ── 夹具 ──

interface Fixture {
  root: string;
  /** 相对 root 写文件（自动建目录）。 */
  write(rel: string, content: string): void;
  cleanup(): void;
}

const fixtures: Fixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()!.cleanup();
});

function makeRepo(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scan-assets-"));
  const fix: Fixture = {
    root,
    write(rel: string, content: string): void {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    },
    cleanup(): void {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  fixtures.push(fix);
  return fix;
}

// 干净的章节 tsx：注释外链 + localhost + 相对路径素材——零 #12 finding 的基线
const CLEAN_TSX = [
  "// 注释行外链：https://cdn.example.com/comment.png",
  'export default function One() {',
  '  const dev = "http://localhost:5173/logo.svg";',
  "  /* 单行块注释：https://cdn.example.com/block.png */",
  '  const x = 1; // 行尾注释：https://cdn.example.com/trailing.png',
  '  return <img src="./local-hero.png" alt="本地素材" />;',
  "}",
  "/*",
  "跨行块注释：https://cdn.example.com/multi.png",
  "*/",
].join("\n");

const CLEAN_CSS = ".chapter-hero { background-image: url(./local-bg.png); }\n";

const ONE_FAMILY_THEME = JSON.stringify({
  fonts: {
    declared: [{ family: "Archivo Black", source: "@fontsource/archivo-black" }],
  },
});

const ONE_FAMILY_FONTS_CSS = '@import "@fontsource/archivo-black/index.css";\n';

/** 写最小干净基线：#12 一章文件 + #14 主题契约（#13/#15 无产物无文档 → 零 finding）。 */
function writeBase(fix: Fixture): void {
  fix.write("src/chapters/01-one/index.tsx", CLEAN_TSX);
  fix.write("src/chapters/01-one/style.css", CLEAN_CSS);
  fix.write("src/theme/theme.json", ONE_FAMILY_THEME);
  fix.write("src/theme/fonts.css", ONE_FAMILY_FONTS_CSS);
}

// ── 护栏 ──

describe("护栏（宁炸不假绿）", () => {
  it("repoRoot 不存在 → throw", () => {
    expect(() => scanAssets("/nonexistent-scan-assets-root-xyz", [chapter("a", "01-a", [])])).toThrow();
  });

  it("chapters 空数组 → throw（非空护栏）", () => {
    const fix = makeRepo();
    writeBase(fix);
    expect(() => scanAssets(fix.root, [])).toThrow();
  });

  it("src/chapters 目录不存在 → throw（章节层无法扫描）", () => {
    const fix = makeRepo();
    fix.write("src/theme/theme.json", ONE_FAMILY_THEME);
    fix.write("src/theme/fonts.css", ONE_FAMILY_FONTS_CSS);
    expect(() => scanAssets(fix.root, [chapter("a", "01-a", [])])).toThrow();
  });

  it("src/chapters 零 tsx/css 文件 → throw（空输入不扫描）", () => {
    const fix = makeRepo();
    fix.write("src/chapters/01-one/README.md", "# 不是章节文件\n");
    fix.write("src/theme/theme.json", ONE_FAMILY_THEME);
    fix.write("src/theme/fonts.css", ONE_FAMILY_FONTS_CSS);
    expect(() => scanAssets(fix.root, [chapter("a", "01-a", [])])).toThrow();
  });
});

// ── #12 禁外部网络资源 ──

describe("#12 禁外部网络资源（blocker）", () => {
  it("负样本：章节层 tsx 与 css 外链 URL 各一 → blocker（定位 file:line）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write(
      "src/chapters/01-one/index.tsx",
      [
        "// 注释行外链：https://cdn.example.com/comment.png",
        "export default function One() {",
        "  return (",
        '    <img src="https://cdn.example.com/hero.png" alt="demo" />',
        "  );",
        "}",
      ].join("\n"),
    );
    fix.write(
      "src/chapters/01-one/style.css",
      [
        ".chapter-hero {",
        "  background-image: url(https://cdn.example.com/bg.jpg);",
        "}",
      ].join("\n"),
    );
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    const hits = r.filter((f) => f.rule === "禁外部网络资源");
    expect(hits).toHaveLength(2);
    expect(hits.every((f) => f.severity === "blocker")).toBe(true);
    expect(hits.map((f) => f.location)).toEqual([
      "src/chapters/01-one/index.tsx:4",
      "src/chapters/01-one/style.css:2",
    ]);
    expect(hits[0].message).toContain("https://cdn.example.com/hero.png");
    expect(hits[1].message).toContain("https://cdn.example.com/bg.jpg");
  });

  it("false-positive：localhost 豁免、注释中的 URL 全部不报", () => {
    const fix = makeRepo();
    writeBase(fix); // CLEAN_TSX 内含 localhost + 四种注释 URL
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    expect(r.filter((f) => f.rule === "禁外部网络资源")).toHaveLength(0);
  });

  it("false-positive：*.test.* 测试文件豁免（mock URL 不报，终审 I-3 与 check-fast 入口口径一致）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write(
      "src/chapters/01-one/index.test.tsx",
      [
        "// 测试文件的 mock 外链 URL：与 check-fast 文件收集口径一致豁免",
        'const mock = "https://cdn.example.com/mock.png";',
        "export default mock;",
      ].join("\n"),
    );
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    expect(r.filter((f) => f.rule === "禁外部网络资源")).toHaveLength(0);
  });
});

// ── #13 音频完整性 ──

describe("#13 音频完整性", () => {
  it("负样本：部分 mp3 且数量不一致 → blocker（narrations 2 vs 1 个 mp3）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("public/audio/01-a/01-01.mp3", "MP3");
    const r = scanAssets(fix.root, [
      chapter("ch-a", "01-a", ["第一句", "第二句"]),
      chapter("ch-b", "01-b", ["就一句"]),
    ]);
    const hits = r.filter((f) => f.rule === "音频完整性");
    expect(hits).toHaveLength(2);
    expect(hits.every((f) => f.severity === "blocker")).toBe(true);
    expect(hits.map((f) => f.location)).toEqual(["ch-a", "ch-b"]);
    expect(hits[0].message).toContain("2");
    expect(hits[0].message).toContain("1");
  });

  it("负样本：零 mp3 但有 audio-durations.json → blocker（合成过但产物缺失）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("public/audio-durations.json", "{}");
    const r = scanAssets(fix.root, [chapter("one", "01-one", ["第一句", "第二句"])]);
    const hits = r.filter((f) => f.rule === "音频完整性");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("blocker");
    expect(hits[0].location).toBe("one");
  });

  it("false-positive：零 mp3 且无 durations → warning 降级（P4-3 未合成音频合法态）", () => {
    const fix = makeRepo();
    writeBase(fix);
    const r = scanAssets(fix.root, [
      chapter("one", "01-one", ["第一句", "第二句"]),
      chapter("empty", "02-empty", []), // 零非空 narration → 期望 0 = 实际 0，不报
    ]);
    const hits = r.filter((f) => f.rule === "音频完整性");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("warning");
    expect(hits[0].location).toBe("one");
    expect(hits[0].message).toContain("未合成");
  });

  it("false-positive：mp3 数与非空 narrations 一致（空串不计入期望）→ 零 finding", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("public/audio/01-one/01-01.mp3", "MP3");
    const r = scanAssets(fix.root, [chapter("one", "01-one", ["第一句", ""])]);
    expect(r.filter((f) => f.rule === "音频完整性")).toHaveLength(0);
  });
});

// ── #14 字体声明=加载 ──

describe("#14 字体声明=加载（静态部分）", () => {
  const TWO_FAMILY_THEME = JSON.stringify({
    fonts: {
      declared: [
        { family: "Archivo Black", source: "@fontsource/archivo-black" },
        { family: "Space Grotesk", source: "@fontsource/space-grotesk", weights: [400, 600] },
      ],
    },
  });

  it("负样本：声明的字体在 fonts.css 无 @import → blocker", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("src/theme/theme.json", TWO_FAMILY_THEME);
    // fonts.css 只有 archivo-black，缺 space-grotesk
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    const hits = r.filter((f) => f.rule === "字体声明未加载");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("blocker");
    expect(hits[0].location).toBe("src/theme/theme.json");
    expect(hits[0].message).toContain("Space Grotesk");
    expect(hits[0].message).toContain("@fontsource/space-grotesk");
  });

  it("负样本：fonts.css 缺失 → 全部声明字体 blocker", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("src/theme/theme.json", TWO_FAMILY_THEME);
    fs.rmSync(path.join(fix.root, "src/theme/fonts.css"));
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    const hits = r.filter((f) => f.rule === "字体声明未加载");
    expect(hits).toHaveLength(2);
    expect(hits.every((f) => f.severity === "blocker")).toBe(true);
  });

  it("负样本：theme.json 缺失 → throw（主题契约缺失宁炸不假绿）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fs.rmSync(path.join(fix.root, "src/theme/theme.json"));
    expect(() => scanAssets(fix.root, [chapter("one", "01-one", [])])).toThrow();
  });

  it("负样本：theme.json 缺 fonts.declared 数组 → throw（契约破坏）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("src/theme/theme.json", JSON.stringify({ fonts: {} }));
    expect(() => scanAssets(fix.root, [chapter("one", "01-one", [])])).toThrow();
  });

  it("false-positive：声明字体全部加载（多 weight 同 slug 合并）→ 零 finding", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("src/theme/theme.json", TWO_FAMILY_THEME);
    fix.write(
      "src/theme/fonts.css",
      [
        '@import "@fontsource/archivo-black/index.css";',
        '@import "@fontsource/space-grotesk/400.css";',
        '@import "@fontsource/space-grotesk/600.css";',
      ].join("\n"),
    );
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    expect(r.filter((f) => f.rule === "字体声明未加载")).toHaveLength(0);
  });
});

// ── #15 文档完整性 lint ──

describe("#15 文档完整性 lint（warning）", () => {
  it("负样本：](path) 相对链接与 <path> 角括号死链各一 → warning（定位 md:line）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("references/REAL.md", "# 真实存在\n");
    fix.write(
      "SKILL.md",
      [
        "# 手册",
        "",
        "[死链](references/ghost.md) 不存在。",
        "",
        "角括号 <references/ghost.md> 也不存在。",
        "[真实](references/REAL.md) 存在不报。",
      ].join("\n"),
    );
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    const hits = r.filter((f) => f.rule === "文档死链");
    expect(hits).toHaveLength(2);
    expect(hits.every((f) => f.severity === "warning")).toBe(true);
    expect(hits.map((f) => f.location)).toEqual(["SKILL.md:3", "SKILL.md:5"]);
    expect(hits[0].message).toContain("references/ghost.md");
  });

  it("负样本：references 子目录 .md 同样扫描（相对目标按 md 所在目录解析）", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("references/sub/EXTRA.md", "[兄弟目录死链](../ghost.md)\n");
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    const hits = r.filter((f) => f.rule === "文档死链");
    expect(hits).toHaveLength(1);
    expect(hits[0].location).toBe("references/sub/EXTRA.md:1");
    expect(hits[0].message).toContain("../ghost.md");
  });

  it("false-positive：合法链接/目录/锚点/外链/代码块/行内代码/HTML 标签全部不报", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("references/REAL.md", "# 真实存在\n");
    fix.write(
      "SKILL.md",
      [
        "# 使用手册",
        "",
        "看 [真实文件](references/REAL.md) 与 [目录](references) 都没问题。",
        "锚点 [锚](#section) 与外链 [官网](https://example.com/docs) 不查。",
        "自动链接 <references/REAL.md> 合法；HTML 标签 <br/> 与 <div> 不查。",
        "",
        "```text",
        "代码块内的 [死链](references/ghost.md) 与 <references/ghost.md> 不查。",
        "```",
        "",
        "行内代码 `[死链](references/ghost.md)` 也不查。",
      ].join("\n"),
    );
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    expect(r.filter((f) => f.rule === "文档死链")).toHaveLength(0);
  });
});

// ── 整体 ──

describe("整体干净项目", () => {
  it("零 finding：干净章节文件 + 完整契约 + 合法文档", () => {
    const fix = makeRepo();
    writeBase(fix);
    fix.write("references/REAL.md", "# 真实存在\n");
    fix.write("SKILL.md", "# 手册\n\n看 [真实](references/REAL.md)。\n");
    const r = scanAssets(fix.root, [chapter("one", "01-one", [])]);
    expect(r).toEqual([]);
  });
});
