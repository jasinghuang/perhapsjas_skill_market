/**
 * scanner-css：章节层 CSS 扫描器（M3a 静态门禁，§11.1 / §12b V4）。
 *
 * 规则（Finding.rule → severity）：
 *   禁硬编码色   blocker  #2    hex/rgb()/hsl()/命名色裸值（全量 CSS 命名色表，终审 M-1）；
 *                               white/black 豁免（命名 + hex 形式）
 *   禁硬编码字体 blocker  #3    裸 font-family（须走 var(--font-*)）
 *   禁裸动画时长 blocker  #4    animation-duration/transition-duration 裸值 +
 *                               animation:/transition: 缩写值内时长（终审 I-1，须走 var(--dur-*)）
 *   禁无限循环动画 blocker #8   animation: 缩写值含 infinite / animation-iteration-count:
 *                               infinite（终审 I-1——与 scanner-tsx #8 同规则名）
 *   禁裸紫粉渐变 warning  #6    手写 gradient() 内含紫粉色相（hue ∈ [250°, 350°)）裸色；token 化渐变豁免
 *   禁emoji      warning  #6b   Unicode Extended_Pictographic 范围（注释内同样计——原文上判，不剥离注释）
 *   字阶成员     warning  #5    font-size 裸 px ≥24 且 ∉ tokens.css 字阶集合
 *   最小字号     warning  V4    font-size 裸 px <24（低于 --t-label 24px 档）
 *   间距成员     warning  #5b   margin/padding/gap 裸 px ∉ tokens.css --space 集合（0 豁免）
 *
 * 行预处理管线（评审修复）：
 *   1) 注释剥离状态机（/*…*\/ 跨行追踪）——注释内 pink/font-family/font-size 不误报；
 *   2) 声明区切片只取最后一个 `{` 之后——单行规则 `.x { color: #f00; }` 不漏检，
 *      `.purple-card {`（无声明）→ 空串安全；
 *   3) 色值判定前再剥离 var() 引用与 url() 内容；无冒号行（选择器/注释/At 规则头）跳过色值判定。
 * emoji 检查单独用原文行（brief 负样本钉死注释内 emoji 仍报）。
 *
 * 字阶/间距集合从 src/theme/tokens.css 解析（Ruling P4-1——与主题同源，主题改档门禁
 * 自动跟随）。Ruling P4-6（T6 落地）：弃 `?raw` 改 node:fs 读取——tsx（node 环境）
 * 不能解析 Vite 的 `?raw` 后缀；脚本所在项目即被检项目，模块相对路径天然指向
 * 同项目 tokens.css。色/字体/时长基查与 contract-lint 的 lintCssText 同型正则；
 * 本层自实现核心的取舍（结构化 Finding 输出、white/black 豁免、防误伤紫色主题）见 task-2-report。
 *
 * 纯 TS、无 DOM 依赖——tsx（node）与 vitest 双环境消费。
 */

import type { Finding } from "./findings";
import { NAMED_COLOR_RE } from "./named-colors";
import { MIN_FONT_PX, SPACE_SCALE, SPACE_SCALE_LABEL, TYPE_SCALE, TYPE_SCALE_LABEL } from "./token-scale";

// ── 规则正则（色/字体/时长与 contract-lint lintCssText 同型） ──

const VAR_RE = /var\([^)]*\)/g; // 剥离 var() 引用段——token 化豁免
const URL_RE = /url\([^)]*\)/g; // 剥离 url() 内容——防 pink.png 类资源名误报
const COMMENT_RE = /\/\*[\s\S]*?(?:\*\/|$)/g; // 行内注释剥离（未闭合 `/*` 剥到行尾）

/** 注释剥离状态机：`/*…*\/` 跨行追踪，注释行整体返回空串（emoji 检查不走此管线）。 */
interface CommentState {
  on: boolean;
}

function stripCommentLine(line: string, state: CommentState): string {
  let s = line;
  if (state.on) {
    const end = s.indexOf("*/");
    if (end === -1) return ""; // 整行仍在注释中（状态保持 on）
    s = s.slice(end + 2);
    state.on = false;
  }
  const stripped = s.replace(COMMENT_RE, "");
  const openers = (s.match(/\/\*/g) ?? []).length;
  const closers = (s.match(/\*\//g) ?? []).length;
  if (openers > closers) state.on = true;
  return stripped;
}
const WHITE_BLACK_HEX_RE = /#(?:fff|ffffff|000|000000)\b/gi; // white/black 豁免（hex 形式）
const HEX_RE_G = /#[0-9a-fA-F]{3,8}\b/g; // match/matchAll 用（全局）
const RGB_RE = /rgba?\(/;
const HSL_RE = /hsla?\(/;
// 全量命名色表见 named-colors（终审 M-1）：white/black 豁免在表外，transparent 禁止。
// 负向前瞻必须写成 (?!\s*var\() 形式——写成 \s*(?!var\() 可回溯成零宽，
// 导致 `font-family: var(--font-body)` 类合规声明被误报（contract-lint 注释钉出的坑）。
const FONT_RE = /font-family\s*:(?!\s*var\()/;
const DUR_RE = /animation-duration\s*:(?!\s*var\()/;
const TRANSITION_DUR_RE = /transition-duration\s*:(?!\s*var\()/;
// 终审 I-1：animation:/transition: 缩写值内的时长提取（长属性由 DUR_RE 覆盖）。
// (?<![\w.-]) 防 spin2 / fade-2s 类 keyframe 名内数字+单位误报（前邻词字符/点/连字符不报）。
const SHORTHAND_ANIM_RE = /(?:animation|transition)\s*:\s*([^;{}]+)/g;
const SHORTHAND_TIME_RE = /(?<![\w.-])[\d.]+(?:ms|s)\b/;
// 终审 I-1：CSS 侧无限循环动画（#8 补全）——animation: 缩写值含 infinite 或
// animation-iteration-count: infinite。var() 先剥离（防 var(--spin-infinite) token 名误报）。
const CSS_INFINITE_RE =
  /(?:\banimation\s*:\s*[^;{}]*\binfinite\b|animation-iteration-count\s*:\s*[^;{}]*\binfinite\b)/;
const GRADIENT_RE = /(?:linear|radial|conic)-gradient\s*\(/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const FONT_SIZE_RE = /font-size\s*:\s*([\d.]+)px/g;
const SPACING_DECL_RE = /(margin|padding|gap)(?:-[a-z]+)?\s*:\s*([^;{}]+)/g;
const PX_VALUE_RE = /(-?[\d.]+)px/g;

const PURPLE_PINK_HUE_MIN = 250; // 紫（270）— 品红（300）— 粉（333，主题 --accent-2）窗口
const PURPLE_PINK_HUE_MAX = 350; // 不含上界；纯蓝 240、纯红 0 均在窗外

// ── 色相检测（§11.1 #6 "色相检测"） ──

function hueFromRgb(r: number, g: number, b: number): number | undefined {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return undefined; // 灰阶无色相
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueFromHex(hex: string): number | undefined {
  const h = hex.slice(1);
  const full =
    h.length >= 6 ? h.slice(0, 6) : h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return hueFromRgb(
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  );
}

/** 在已剥离 var() 的行上收集紫粉色相（hex/rgb()/hsl() 三种裸值）。 */
function purplePinkHuesOnLine(line: string): number[] {
  const hues: number[] = [];
  for (const m of line.matchAll(HEX_RE_G)) {
    const h = hueFromHex(m[0]);
    if (h !== undefined && !Number.isNaN(h)) hues.push(h);
  }
  for (const m of line.matchAll(/rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/g)) {
    const h = hueFromRgb(Number(m[1]), Number(m[2]), Number(m[3]));
    if (h !== undefined) hues.push(h);
  }
  for (const m of line.matchAll(/hsla?\(\s*([\d.]+)/g)) hues.push(parseFloat(m[1]) % 360);
  return hues.filter(
    (h) => !Number.isNaN(h) && h >= PURPLE_PINK_HUE_MIN && h < PURPLE_PINK_HUE_MAX,
  );
}

// ── 扫描 ──

function pushFinding(
  findings: Finding[],
  rule: string,
  severity: "blocker" | "warning",
  location: string,
  message: string,
): void {
  findings.push({ rule, severity, location, message });
}

function scanLine(
  path: string,
  lineNo: number,
  rawLine: string,
  declLine: string,
  findings: Finding[],
): void {
  const loc = `${path}:${lineNo}`;

  // 声明区切片（评审修复）：只取最后一个 `{` 之后——单行规则 `.x { color: #f00; }`
  // 的声明不能被 `}` 切掉；`.purple-card {`（无声明）→ 空串安全。
  const lastBrace = declLine.lastIndexOf("{");
  const declPart = lastBrace >= 0 ? declLine.slice(lastBrace + 1) : declLine;
  // 剥离 var() 引用（token 化豁免）与 url() 内容（防 pink.png 类资源名误报）
  const colorLine = declPart.replace(VAR_RE, "").replace(URL_RE, "");

  // #2 禁硬编码色（white/black 豁免：命名 + hex 形式）。
  // 无冒号行 = 非声明行（注释/选择器/At 规则头），跳过——防 .purple-card / #gold 误报（评审修复）。
  const noWhiteBlack = colorLine.replace(WHITE_BLACK_HEX_RE, "");
  if (
    colorLine.includes(":") &&
    (noWhiteBlack.match(HEX_RE_G) !== null ||
      RGB_RE.test(colorLine) ||
      HSL_RE.test(colorLine) ||
      NAMED_COLOR_RE.test(colorLine))
  ) {
    pushFinding(findings, "禁硬编码色", "blocker", loc, "裸色值（须走 var(--*) token，white/black 豁免）");
  }

  // #3 禁硬编码字体
  if (FONT_RE.test(declPart)) {
    pushFinding(findings, "禁硬编码字体", "blocker", loc, "裸 font-family（须走 var(--font-*)）");
  }

  // #4 禁裸动画时长（CSS 部分）：长属性 + animation:/transition: 缩写值内时长（终审 I-1）
  if (DUR_RE.test(declPart) || TRANSITION_DUR_RE.test(declPart)) {
    pushFinding(findings, "禁裸动画时长", "blocker", loc, "裸动画时长（须走 var(--dur-*)）");
  }
  // 缩写值内时长：var() 引用剥离后仍含时间即报（token 化时长豁免）
  const noVarDecl = declPart.replace(VAR_RE, "");
  for (const m of noVarDecl.matchAll(SHORTHAND_ANIM_RE)) {
    if (SHORTHAND_TIME_RE.test(m[1])) {
      pushFinding(findings, "禁裸动画时长", "blocker", loc, "裸动画时长（须走 var(--dur-*)）");
    }
  }

  // #8 无限循环动画（CSS 部分，终审 I-1）：animation: 缩写值含 infinite /
  // animation-iteration-count: infinite → blocker（与 scanner-tsx #8 同规则名）
  if (CSS_INFINITE_RE.test(noVarDecl)) {
    pushFinding(
      findings,
      "禁无限循环动画",
      "blocker",
      loc,
      "infinite 无限循环动画（渲染确定性：动画须有限周期，氛围循环走引擎时钟）",
    );
  }

  // #6 禁裸紫粉渐变（token 化渐变豁免：var() 已剥离，手写渐变仅对裸色做色相检测）
  if (GRADIENT_RE.test(declPart)) {
    const hues = purplePinkHuesOnLine(colorLine);
    if (hues.length > 0) {
      pushFinding(
        findings,
        "禁裸紫粉渐变",
        "warning",
        loc,
        `手写渐变含紫粉色相（hue ${hues.map((h) => Math.round(h)).join("/")}）——渐变须走 var(--gradient-*) token`,
      );
    }
  }

  // #6b 禁 emoji（Unicode Extended_Pictographic 范围；判原文——注释内 emoji 仍计，负样本钉死）
  if (EMOJI_RE.test(rawLine)) {
    pushFinding(findings, "禁emoji", "warning", loc, "出现 emoji 字符（Unicode Extended_Pictographic）");
  }

  // #5 字阶成员 + V4 最小字号（合并判断：<24 → 最小字号；≥24 且 ∉ 字阶 → 字阶成员）
  for (const m of declPart.matchAll(FONT_SIZE_RE)) {
    const v = parseFloat(m[1]);
    if (v < MIN_FONT_PX) {
      pushFinding(findings, "最小字号", "warning", loc, `字号 ${v}px 低于最小字号 ${MIN_FONT_PX}px（V4）`);
    } else if (!TYPE_SCALE.has(v)) {
      pushFinding(findings, "字阶成员", "warning", loc, `字号 ${v}px 不在字阶集合（${TYPE_SCALE_LABEL}）`);
    }
  }

  // #5b 间距成员（margin/padding/gap 裸 px 须 ∈ --space 集合；0 豁免）
  for (const m of declPart.matchAll(SPACING_DECL_RE)) {
    for (const p of m[2].matchAll(PX_VALUE_RE)) {
      const v = Math.abs(parseFloat(p[1]));
      if (v === 0) continue;
      if (!SPACE_SCALE.has(v)) {
        pushFinding(
          findings,
          "间距成员",
          "warning",
          loc,
          `间距 ${p[1]}px 不在 --space 集合（${SPACE_SCALE_LABEL}）`,
        );
      }
    }
  }
}

export function scanChapterCss(cssFiles: Array<{ path: string; css: string }>): Finding[] {
  if (cssFiles.length === 0) {
    throw new Error("scanChapterCss：css 数组为空（非空护栏，空输入不扫描）");
  }
  const findings: Finding[] = [];
  for (const { path, css } of cssFiles) {
    const commentState: CommentState = { on: false };
    const lines = css.split("\n");
    lines.forEach((line, i) => {
      scanLine(path, i + 1, line, stripCommentLine(line, commentState), findings);
    });
  }
  return findings;
}
