/**
 * scanner-assets：资源类检查（M3a 静态门禁，§11.1 #12/#13/#14/#15）。
 *
 * 规则（Finding.rule → severity）：
 *   禁外部网络资源  blocker  #12  章节层文件（src/chapters/ 下 tsx/css）含 http(s)://
 *                                 URL（图片/字体/样式外链）→ blocker；注释不查、
 *                                 localhost 豁免（dev 场景）。URL 提取正则
 *                                 https?://[^\s"'`]+，简单行扫描（fs 读文件）+
 *                                 注释状态机（块注释跨行 / 行注释 (?<!:)// 启发——
 *                                 http:// 的 // 前是冒号不算注释起）。
 *   音频完整性      blocker  #13  每章非空 narrations 条数 vs public/audio/<folder>/
 *                                 *.mp3 文件数。Ruling P4-3：项目零 mp3 且无
 *                                 public/audio-durations.json → 降级 warning
 *                                 （脚手架未合成音频 = 合法状态）；存在部分 mp3
 *                                 时数量不一致 = blocker。
 *   字体声明未加载  blocker  #14  静态部分：theme.json fonts.declared 每个 family
 *                                 的 source 必须在 src/theme/fonts.css 的 @import
 *                                 中出现（import 路径 === source 或以 source/ 为
 *                                 前缀——@fontsource/<slug>/<weight>.css 形态）。
 *   文档死链        warning  #15  SKILL.md / references 目录下 .md 中 ](path) 相对链接
 *                                 与 <path> 角括号路径，目标不存在 → warning
 *                                 （v1 只查路径存在性，不查节标题；锚点/绝对路径/
 *                                 协议链接豁免；代码块与行内代码不查）。
 *
 * 与 scanner-css / scanner-tsx / scanner-text 同构：纯 TS、无 DOM 依赖——tsx（node）
 * 与 vitest 双环境消费。repoRoot 可注入（测试用临时目录构造夹具）。
 *
 * 已知边界（v1 取舍）：
 *   - #12 协议相对 URL（//cdn.example.com）不在规格正则内，不查；
 *   - #12 行注释启发式：非注释字符串内的 //（如 "x//y"）会误截断后续行——漏报方向；
 *   - #15 角括号候选需含 . 与 /（路径形态）——<br/>/<div> 等 HTML 标签零误报；
 *   - #15 无扩展名角括号路径（<references/foo>）漏检，链接形态 ](references/foo) 不受影响。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ChapterDef } from "../../src/chapters/manifest";
import type { Finding } from "./findings";

// ── 通用 ──

/** 递归收集目录下所有文件（排序保证 finding 顺序确定）。 */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) out.push(p);
    }
  }
  return out.sort();
}

// ── #12 禁外部网络资源 ──

/** 规格正则：https?:// + 非空白/引号/反引号串（URL 提取）。 */
const EXTERNAL_URL_RE = /https?:\/\/[^\s"'`]+/g;

/** 行内块注释剥除 + 跨行状态机；返回该行的代码区段（注释已剥离）。 */
function codeSegments(line: string, inBlock: { value: boolean }): string[] {
  let rest = line;
  if (inBlock.value) {
    const end = rest.indexOf("*/");
    if (end === -1) return []; // 整行仍在块注释内
    rest = rest.slice(end + 2);
    inBlock.value = false;
  }
  let out = "";
  while (rest.length > 0) {
    const start = rest.indexOf("/*");
    if (start === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, start);
    const end = rest.indexOf("*/", start + 2);
    if (end === -1) {
      inBlock.value = true;
      rest = "";
      break;
    }
    rest = rest.slice(end + 2);
  }
  // 行注释：首个非 :// 的 // 起截断（http:// 的 // 前是冒号不算注释起）。
  let i = 0;
  while (i < out.length - 1) {
    if (out[i] === "/" && out[i + 1] === "/") {
      if (i > 0 && out[i - 1] === ":") {
        i += 2;
        continue;
      }
      out = out.slice(0, i);
      break;
    }
    i += 1;
  }
  return out.trim() === "" ? [] : [out];
}

/** 剥 URL 尾随标点（括号/逗号/分号等），消息更干净；尾斜杠保留（合法 URL 组成）。 */
function cleanUrl(url: string): string {
  return url.replace(/[)\]}>.,;:!?]+$/g, "");
}

/** localhost 豁免：协议后的主机（去端口）为 localhost。 */
function isLocalhost(url: string): boolean {
  const host = url.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
  return host.split(":")[0] === "localhost";
}

function checkExternalUrls(repoRoot: string, findings: Finding[]): void {
  const chaptersDir = path.join(repoRoot, "src", "chapters");
  if (!fs.existsSync(chaptersDir)) {
    throw new Error(
      `scanAssets：src/chapters 目录不存在（${chaptersDir}）——章节层无法扫描，宁炸不假绿`,
    );
  }
  const files = walkFiles(chaptersDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".css"));
  if (files.length === 0) {
    throw new Error(
      "scanAssets：src/chapters 下零 tsx/css 文件（非空护栏，空输入不扫描）",
    );
  }
  const seen = new Set<string>();
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const inBlock = { value: false };
    lines.forEach((line, i) => {
      for (const seg of codeSegments(line, inBlock)) {
        const urls = [...seg.matchAll(EXTERNAL_URL_RE)]
          .map((m) => cleanUrl(m[0]))
          .filter((u) => !isLocalhost(u));
        if (urls.length === 0) continue;
        const loc = `${path.relative(repoRoot, file)}:${i + 1}`;
        const key = `${loc}`;
        if (seen.has(key)) continue; // 单行最多一条（与 scanner-tsx 粒度一致）
        seen.add(key);
        findings.push({
          rule: "禁外部网络资源",
          severity: "blocker",
          location: loc,
          message:
            `外链 URL ${urls.join("、")}` +
            "（#12 章节层禁外部网络资源：确定性 + 大陆可达；localhost 豁免）",
        });
      }
    });
  }
}

// ── #13 音频完整性 ──

/** public/audio/<folder>/ 下平铺 *.mp3 计数（目录缺失 = 0）。 */
function mp3Count(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mp3")).length;
}

function checkAudioIntegrity(repoRoot: string, chapters: ChapterDef[], findings: Finding[]): void {
  const audioRoot = path.join(repoRoot, "public", "audio");
  const durationsPath = path.join(repoRoot, "public", "audio-durations.json");
  // Ruling P4-3：项目零 mp3 且无 durations → 未合成音频合法态（warning）；
  // 有部分 mp3 或已有 durations 时数量不一致 = blocker。
  const zeroState =
    !fs.existsSync(durationsPath) &&
    (fs.existsSync(audioRoot) ? walkFiles(audioRoot).filter((f) => f.endsWith(".mp3")).length : 0) ===
      0;
  for (const ch of chapters) {
    const expected = ch.narrations.filter((n) => n.trim() !== "").length;
    const actual = mp3Count(path.join(audioRoot, ch.folder));
    if (expected === actual) continue;
    findings.push({
      rule: "音频完整性",
      severity: zeroState ? "warning" : "blocker",
      location: ch.id,
      message: zeroState
        ? `narrations ${expected} 条 vs 0 个 mp3（public/audio/${ch.folder}/）——` +
          "#13 未合成音频（项目零 mp3 且无 audio-durations.json）：脚手架合法状态，Phase 2 合成后回正"
        : `narrations ${expected} 条 vs ${actual} 个 mp3（public/audio/${ch.folder}/）——` +
          "#13 音频完整性：已合成状态数量必须一致",
    });
  }
}

// ── #14 字体声明=加载（静态部分） ──

function checkFontContract(repoRoot: string, findings: Finding[]): void {
  const themePath = path.join(repoRoot, "src", "theme", "theme.json");
  if (!fs.existsSync(themePath)) {
    throw new Error(`scanAssets：src/theme/theme.json 不存在——主题契约缺失，宁炸不假绿`);
  }
  let theme: unknown;
  try {
    theme = JSON.parse(fs.readFileSync(themePath, "utf8"));
  } catch (e) {
    throw new Error(
      `scanAssets：src/theme/theme.json 解析失败（${e instanceof Error ? e.message : String(e)}）——宁炸不假绿`,
    );
  }
  const declared = (theme as { fonts?: { declared?: unknown } })?.fonts?.declared;
  if (!Array.isArray(declared)) {
    throw new Error("scanAssets：theme.json 缺 fonts.declared 数组——契约破坏，宁炸不假绿");
  }
  const fontsCssPath = path.join(repoRoot, "src", "theme", "fonts.css");
  // @import 路径集合（先剥 CSS 注释，防注释掉的 @import 假绿）
  const importPaths = fs.existsSync(fontsCssPath)
    ? [
        ...fs
          .readFileSync(fontsCssPath, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .matchAll(/@import\s+["']([^"']+)["']/g),
      ].map((m) => m[1])
    : [];
  for (const f of declared as Array<{ family?: unknown; source?: unknown }>) {
    const family = typeof f?.family === "string" ? f.family : "?";
    const source = typeof f?.source === "string" ? f.source : "";
    if (source === "") {
      findings.push({
        rule: "字体声明未加载",
        severity: "blocker",
        location: "src/theme/theme.json",
        message: `声明的字体「${family}」缺 source 字段（#14 声明=加载契约）`,
      });
      continue;
    }
    const loaded = importPaths.some((p) => p === source || p.startsWith(source + "/"));
    if (!loaded) {
      findings.push({
        rule: "字体声明未加载",
        severity: "blocker",
        location: "src/theme/theme.json",
        message:
          `声明的字体「${family}」（${source}）在 src/theme/fonts.css 的 @import 中无对应加载` +
          "（#14 声明=加载契约）",
      });
    }
  }
}

// ── #15 文档完整性 lint ──

const LINK_RE = /\]\(([^)\s]+)\)/g; // [text](target)
const ANGLE_RE = /<([^<>\s]+)>/g; // <path>
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i; // http:/mailto: 等协议前缀

/** 目标合法性：相对路径 + 锚点剥离 + 存在性。返回 null = 合法，否则目标串（消息用）。 */
function checkTarget(mdDir: string, target: string): string | null {
  const t = target.split("#")[0].split("?")[0];
  if (t === "" || t.startsWith("/") || SCHEME_RE.test(t)) return null; // 纯锚点/绝对/协议
  const resolved = path.resolve(mdDir, t);
  return fs.existsSync(resolved) ? null : target;
}

function checkDocLinks(repoRoot: string, findings: Finding[]): void {
  const mdFiles: string[] = [];
  const skillMd = path.join(repoRoot, "SKILL.md");
  if (fs.existsSync(skillMd)) mdFiles.push(skillMd);
  const refsDir = path.join(repoRoot, "references");
  if (fs.existsSync(refsDir)) {
    mdFiles.push(...walkFiles(refsDir).filter((f) => f.endsWith(".md")));
  }
  for (const md of mdFiles) {
    const lines = fs.readFileSync(md, "utf8").split("\n");
    const mdDir = path.dirname(md);
    const rel = path.relative(repoRoot, md);
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```+|~~~+)/.test(line)) {
        inFence = !inFence; // 围栏切换（代码块示例不查）
        return;
      }
      if (inFence) return;
      const noInline = line.replace(/`[^`]*`/g, ""); // 行内代码示例不查
      for (const m of noInline.matchAll(LINK_RE)) {
        const dead = checkTarget(mdDir, m[1]);
        if (dead !== null) {
          findings.push({
            rule: "文档死链",
            severity: "warning",
            location: `${rel}:${i + 1}`,
            message: `引用路径不存在：${dead}（#15 文档完整性 lint，v1 只查路径存在性）`,
          });
        }
      }
      for (const m of noInline.matchAll(ANGLE_RE)) {
        const cand = m[1];
        // 路径形态过滤：需含 / 与 .——<br/>/<div>/<https://…> 等标签与协议零误报
        if (!cand.includes("/") || !cand.includes(".")) continue;
        if (cand.startsWith("/") || cand.startsWith("#") || SCHEME_RE.test(cand)) continue;
        const dead = checkTarget(mdDir, cand);
        if (dead !== null) {
          findings.push({
            rule: "文档死链",
            severity: "warning",
            location: `${rel}:${i + 1}`,
            message: `引用路径不存在：${dead}（#15 文档完整性 lint，v1 只查路径存在性）`,
          });
        }
      }
    });
  }
}

// ── 入口 ──

export function scanAssets(repoRoot: string, chapters: ChapterDef[]): Finding[] {
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory()) {
    throw new Error(`scanAssets：repoRoot 不存在或非目录：${repoRoot}（防假绿，宁炸不假绿）`);
  }
  if (chapters.length === 0) {
    throw new Error("scanAssets：chapters 数组为空（非空护栏，空输入不扫描）");
  }
  const findings: Finding[] = [];
  checkExternalUrls(repoRoot, findings);
  checkAudioIntegrity(repoRoot, chapters, findings);
  checkFontContract(repoRoot, findings);
  checkDocLinks(repoRoot, findings);
  return findings;
}
