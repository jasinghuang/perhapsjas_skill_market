/**
 * fixtures.test.ts：门禁夹具自检——"检查的检查"（M3a 静态门禁的回归保障）。
 *
 * 夹具目录（__fixtures__ 双下划线——工具约定目录，不参与 src 构建）：
 *   bad/  —— 负样本集：每类 blocker 至少一个违规样例，文件内注释标注违反哪条规则。
 *            逐文件断言"至少一条 blocker + 预期规则全命中 + 定位含夹具文件路径"。
 *   good/ —— false-positive 集：已知豁免场景（list-reveal 派生写法、token 化
 *            色/渐变/字体/时长、合法字阶间距、/* pink *\/ 注释、正常口播句、
 *            ？！结尾、合法相对链接），对应扫描器零 finding。
 *
 * 夹具注入方式（决策记录）：
 *   - CSS/TSX/MD 夹具经 fs 读取字符串注入扫描器（path 传夹具相对模板根的路径——
 *     与真实章节文件同型定位，且不在 src/ 下故 TSX 目录豁免全部不生效）。
 *   - 夹具一律 .txt/.css/.md 自然文本扩展名（含 TSX 源码的 bad-tsx.txt /
 *     good-chapter.txt 用 .txt 规避 tsc 编译）：tsconfig include scripts/**
 *     完全不触碰 __fixtures__ 内容——夹具内门禁违规与类型检查解耦
 *     （"门禁违规 ≠ 类型错误"），npx tsc --noEmit 全程绿灯（见 task-7-report）。
 *   - bad-assets（#12/#13/#14）+ #15 死链在测试内以 fs.mkdtemp 临时目录构造最小
 *     项目结构（repoRoot 可注入即夹具），bad-link.md 内容复制进 references/——
 *     定位保留夹具文件名（references/bad-link.md:N）。
 *   - narrations 夹具（bad-text.txt / good-narrations.txt）解析约定：# 开头为
 *     注释行（标注违反/豁免哪条规则），其余非空行逐行 = 一条 narration。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ChapterDef } from "../../src/chapters/manifest";
import { scanAssets } from "./scanner-assets";
import { scanChapterCss } from "./scanner-css";
import { scanNarrations } from "./scanner-text";
import { scanChapterTsx } from "./scanner-tsx";

// ── 夹具路径 ──

/** 夹具相对模板根的路径（扫描器定位用——与真实章节文件同型的相对路径形态）。 */
function fixtureRel(file: string): string {
  return `scripts/check/__fixtures__/${file}`;
}

/** 夹具绝对根（jsdom 全局 URL 对 file: 解析不稳——fileURLToPath + path 双环境皆稳）。 */
const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function readText(file: string): string {
  return fs.readFileSync(path.join(FIXTURES_ROOT, file), "utf8");
}

function readFixture(file: string): { path: string; text: string } {
  return { path: fixtureRel(file), text: readText(file) };
}

/** narrations 夹具解析约定：# 开头为注释行（标注违反/豁免哪条规则），其余非空行逐行 = 一条。 */
function narrationsFrom(file: string): string[] {
  return readText(file)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

const NOOP = (() => null) as unknown as ChapterDef["Component"];

function chapter(id: string, folder: string, narrations: string[]): ChapterDef {
  return { id, folder, steps: narrations.length, narrations, Component: NOOP };
}

// ── tmp 仓库夹具（bad-assets / good-docs 用，与 scanner-assets.test 同型） ──

interface RepoFixture {
  root: string;
  write(rel: string, content: string): void;
  cleanup(): void;
}

const repos: RepoFixture[] = [];
afterEach(() => {
  while (repos.length > 0) repos.pop()!.cleanup();
});

function makeRepo(prefix: string): RepoFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fix: RepoFixture = {
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
  repos.push(fix);
  return fix;
}

const CLEAN_CHAPTER_TSX = [
  'export default function One() { return <img src="./local-hero.png" alt="本地素材" />; }',
].join("\n");

const CLEAN_THEME = JSON.stringify({
  fonts: {
    declared: [{ family: "Archivo Black", source: "@fontsource/archivo-black" }],
  },
});

const CLEAN_FONTS_CSS = '@import "@fontsource/archivo-black/index.css";\n';

/** 最小干净基线：一章 tsx + 主题契约（scanAssets 四个检查的公共前提）。 */
function writeCleanBase(fix: RepoFixture): void {
  fix.write("src/chapters/01-one/index.tsx", CLEAN_CHAPTER_TSX);
  fix.write("src/theme/theme.json", CLEAN_THEME);
  fix.write("src/theme/fonts.css", CLEAN_FONTS_CSS);
}

// ── bad/ 负样本（逐文件 ≥1 blocker + 预期规则全命中 + 定位含夹具路径） ──

describe("bad/ 负样本：逐文件至少一条 blocker", () => {
  const BAD_CSS: Array<{ file: string; rules: string[] }> = [
    // #2 裸色 + #3 裸字体 + #4 裸动画时长（文件内注释标注规则）
    { file: "bad/bad-color.css", rules: ["禁硬编码色", "禁硬编码字体", "禁裸动画时长"] },
    // #6 裸紫粉渐变（warning）+ #2 裸色（blocker——同文件必中 blocker 的构造）
    { file: "bad/bad-gradient.css", rules: ["禁硬编码色", "禁裸紫粉渐变"] },
  ];

  for (const { file, rules } of BAD_CSS) {
    it(`${file} → 预期规则全命中且至少一条 blocker`, () => {
      const f = readFixture(file);
      const r = scanChapterCss([{ path: f.path, css: f.text }]);
      for (const rule of rules) {
        expect(
          r.some((x) => x.rule === rule),
          `缺规则「${rule}」——夹具失效或扫描器漏抓`,
        ).toBe(true);
      }
      expect(r.filter((x) => x.severity === "blocker").length).toBeGreaterThanOrEqual(1);
      // 定位正确性抽查：每条 finding 定位均含夹具文件路径
      expect(r.every((x) => x.location.startsWith(`${f.path}:`))).toBe(true);
    });
  }

  it("bad/bad-gradient.css → 禁裸紫粉渐变 severity 为 warning（规则档位钉死）", () => {
    const f = readFixture("bad/bad-gradient.css");
    const r = scanChapterCss([{ path: f.path, css: f.text }]);
    const gradient = r.filter((x) => x.rule === "禁裸紫粉渐变");
    expect(gradient.length).toBeGreaterThanOrEqual(1);
    expect(gradient.every((x) => x.severity === "warning")).toBe(true);
    expect(gradient[0].message).toContain("hue");
  });

  it("bad/bad-tsx.txt → setTimeout + inline style 色 + 无限迭代 → 三条 blocker 规则命中", () => {
    const f = readFixture("bad/bad-tsx.txt");
    const r = scanChapterTsx([{ path: f.path, source: f.text }]);
    expect(new Set(r.map((x) => x.rule))).toEqual(
      new Set(["禁硬编码色", "确定性黑名单", "无限循环动画"]),
    );
    expect(r.every((x) => x.severity === "blocker")).toBe(true);
    // 定位正确性抽查：每条 finding 定位均含夹具文件路径
    expect(r.every((x) => x.location.startsWith(`${f.path}:`))).toBe(true);
  });

  it("bad/bad-echart-option.txt → EChart option 裸色 + 裸字体 → 同规则两条 blocker（色/字体各一）", () => {
    const f = readFixture("bad/bad-echart-option.txt");
    const r = scanChapterTsx([{ path: f.path, source: f.text }]);
    expect(new Set(r.map((x) => x.rule))).toEqual(new Set(["ECharts option 裸色/裸字体"]));
    const hits = r.filter((x) => x.rule === "ECharts option 裸色/裸字体");
    expect(hits).toHaveLength(2); // color "#f00" 一条 + textStyle fontFamily "Arial" 一条
    expect(hits.every((x) => x.severity === "blocker")).toBe(true);
    expect(hits.every((x) => x.location.startsWith(`${f.path}:`))).toBe(true);
    // 双维度消息钉死（防实现只查色或只查字体仍过数）
    expect(hits.some((x) => x.message.includes("color"))).toBe(true);
    expect(hits.some((x) => x.message.includes("fontFamily"))).toBe(true);
  });

  it("bad/bad-text.txt → manifest 一致性 blocker（steps 错配）+ 反 AI 味 + 结尾标点 warning", () => {
    // #1 导入坏数据状态：steps 故意 ≠ narrations.length
    const narrations = narrationsFrom("bad/bad-text.txt");
    const badSteps = narrations.length + 1;
    const r = scanNarrations([
      { id: "bad-text", folder: "99-bad-text", steps: badSteps, narrations, Component: NOOP },
    ]);
    expect(new Set(r.map((x) => x.rule))).toEqual(
      new Set(["manifest一致性", "文案反AI味", "字幕结尾标点"]),
    );
    const consistency = r.find((x) => x.rule === "manifest一致性")!;
    expect(consistency.severity).toBe("blocker");
    expect(consistency.location).toBe("bad-text");
    expect(consistency.message).toContain(`steps=${badSteps}`);
    expect(r.filter((x) => x.rule !== "manifest一致性").every((x) => x.severity === "warning")).toBe(true);
    // 定位正确性抽查：AI 味/标点定位含夹具章节 id（bad-text 与夹具同名）
    expect(
      r.filter((x) => x.rule !== "manifest一致性").every((x) => x.location.startsWith("bad-text:narrations[")),
    ).toBe(true);
  });
});

// ── bad/ 资源类负样本（tmp 仓库运行时构造） ──

describe("bad/ 资源类负样本（tmp 目录运行时构造）", () => {
  it("bad-assets：#13 音频数量不一致 → 音频完整性 blocker（narrations 2 vs mp3 1）", () => {
    const fix = makeRepo("fixtures-bad-assets-");
    writeCleanBase(fix);
    // 部分 mp3 存在 → 非零态，数量不一致 = blocker（零 mp3 无 durations 才降级 warning）
    fix.write("public/audio/01-bad-audio/01-01.mp3", "MP3");
    const r = scanAssets(fix.root, [chapter("bad-audio", "01-bad-audio", ["第一句", "第二句"])]);
    const hits = r.filter((x) => x.rule === "音频完整性");
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe("blocker");
    expect(hits[0].location).toBe("bad-audio");
    expect(hits[0].message).toContain("2");
    expect(hits[0].message).toContain("1");
  });

  it("#12 外链 + #14 字体声明未加载 + #15 死链（bad-link.md）一次 scanAssets 各命中", () => {
    const fix = makeRepo("fixtures-bad-link-");
    writeCleanBase(fix);
    // #12：章节层 tsx 外链 URL（注释里的外链不查——对照）
    fix.write(
      "src/chapters/01-bad-audio/index.tsx",
      [
        "export default function BadChapter() {",
        "  // 注释里的外链不查：https://cdn.example.com/comment.png",
        '  return <img src="https://cdn.example.com/hero.png" alt="demo" />;',
        "}",
      ].join("\n"),
    );
    // #14：声明字体无 @import 加载（fonts.css 只有无关 slug）
    fix.write(
      "src/theme/theme.json",
      JSON.stringify({
        fonts: { declared: [{ family: "幽灵字体", source: "@fontsource/ghost-font" }] },
      }),
    );
    // #15：夹具 docs/ 子结构的死链文档复制进 references/（定位保留夹具文件名）
    fix.write("references/bad-link.md", readText("bad/docs/bad-link.md"));

    const r = scanAssets(fix.root, [chapter("bad-audio", "01-bad-audio", [])]);
    expect(new Set(r.map((x) => x.rule))).toEqual(
      new Set(["禁外部网络资源", "字体声明未加载", "文档死链"]),
    );
    expect(r.filter((x) => x.rule !== "文档死链").every((x) => x.severity === "blocker")).toBe(true);

    // 定位正确性抽查（各规则）
    const external = r.find((x) => x.rule === "禁外部网络资源")!;
    expect(external.location).toBe("src/chapters/01-bad-audio/index.tsx:3");
    expect(external.message).toContain("https://cdn.example.com/hero.png");
    const font = r.find((x) => x.rule === "字体声明未加载")!;
    expect(font.location).toBe("src/theme/theme.json");
    expect(font.message).toContain("@fontsource/ghost-font");
    const dead = r.filter((x) => x.rule === "文档死链");
    expect(dead.every((x) => x.severity === "warning")).toBe(true);
    expect(dead.map((x) => x.location)).toEqual(["references/bad-link.md:6", "references/bad-link.md:9"]);
    expect(dead[0].message).toContain("missing-target.md");
  });
});

// ── good/ false-positive 集（对应扫描器零 finding） ──

describe("good/ false-positive 集：零 finding 护栏", () => {
  it("good/good-chapter.txt → list-reveal 派生写法 + var() style + fill=none 零 finding", () => {
    const f = readFixture("good/good-chapter.txt");
    expect(scanChapterTsx([{ path: f.path, source: f.text }])).toEqual([]);
  });

  it("good/good-echart-option.txt → var() 色板 + var(--font-body) 字体 + white 豁免零 finding", () => {
    const f = readFixture("good/good-echart-option.txt");
    expect(scanChapterTsx([{ path: f.path, source: f.text }])).toEqual([]);
  });

  it("good/good-chapter.css → token 化色/渐变/字体/时长 + 合法字阶间距 + /* pink */ 注释零 finding", () => {
    const f = readFixture("good/good-chapter.css");
    expect(scanChapterCss([{ path: f.path, css: f.text }])).toEqual([]);
  });

  it("good/good-narrations.txt → 正常口播句 + ？！结尾（V3 豁免）零 finding", () => {
    const narrations = narrationsFrom("good/good-narrations.txt");
    expect(
      scanNarrations([
        { id: "good-narrations", folder: "01-good", steps: narrations.length, narrations, Component: NOOP },
      ]),
    ).toEqual([]);
  });

  it("good/docs/good-docs.md → 合法相对链接零死链（干净仓库整体零 finding）", () => {
    const fix = makeRepo("fixtures-good-docs-");
    writeCleanBase(fix);
    // 链接目标真实存在（相对 references/ 解析；目录目标/锚点/协议链接豁免）
    fix.write("references/real-target.md", "# 真实目标\n");
    fix.write("references/sub/README.md", "# 子目录\n");
    fix.write("references/good-docs.md", readText("good/docs/good-docs.md"));
    // 音频数量一致（2 narrations vs 2 mp3）——整体断言 scanAssets 零 finding 的前提
    fix.write("public/audio/01-good/01-01.mp3", "MP3");
    fix.write("public/audio/01-good/01-02.mp3", "MP3");
    const r = scanAssets(fix.root, [chapter("good", "01-good", ["第一句", "第二句"])]);
    expect(r).toEqual([]);
  });
});

// ── 夹具清单同步护栏：目录内夹具文件必须被本测试覆盖（新增夹具不补断言 → 红） ──

describe("夹具清单同步护栏", () => {
  function listFiles(rel: string, ext: string): string[] {
    const root = path.join(FIXTURES_ROOT, rel);
    const out: string[] = [];
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith(ext)) out.push(ent.name);
    }
    return out.sort();
  }

  it("bad/ 夹具文件与本测试预期清单一致（防新增夹具漏断言）", () => {
    expect(listFiles("bad", ".css")).toEqual(["bad-color.css", "bad-gradient.css"]);
    expect(listFiles("bad", ".txt")).toEqual([
      "bad-echart-option.txt",
      "bad-text.txt",
      "bad-tsx.txt",
    ]);
    expect(listFiles("bad/docs", ".md")).toEqual(["bad-link.md"]);
  });

  it("good/ 夹具文件与本测试预期清单一致（防新增夹具漏断言）", () => {
    expect(listFiles("good", ".css")).toEqual(["good-chapter.css"]);
    expect(listFiles("good", ".txt")).toEqual([
      "good-chapter.txt",
      "good-echart-option.txt",
      "good-narrations.txt",
    ]);
    expect(listFiles("good/docs", ".md")).toEqual(["good-docs.md"]);
  });
});
