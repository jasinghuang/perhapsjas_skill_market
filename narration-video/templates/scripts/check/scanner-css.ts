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
 * 预处理管线（M3b 门禁可信度收紧——行级预处理 → 声明级状态机，K-10 / K-12）：
 *   1) tokenizeCss 单遍状态机（`inComment` / `inString`（`\` 转义）/ `urlDepth`（`url(` 裸
 *      内容，见 2b）/ `parenDepth`）把源码
 *      切成声明段：`/*` 仅在非字符串非注释时开注释、`*\/` 仅注释态闭合——字符串内的 `/*`
 *      （K-12）不再把后续声明吞进注释态；注释内容整体丢弃。字符串内的裸换行即终止字符串
 *      （CSS bad-string：字符串不得含有裸换行）——未闭合引号的抑制面从"文件余下全部"收窄到
 *      "下一个 token 边界之前"：坏字符串里的 `;` 不构成边界 ⇒ 该范围**可跨行**，紧随的物理行
 *      仍可能被吞（残余面见下），但不再整文件漏检。字符串外的 `\` 同样转义（被转义字符不参与
 *      结构判定：`.foo\(` 不改变括号深度）。
 *   2) token 边界：`{` `}` **无条件**（并复位 parenDepth——"深度永不为 0"会让后续边界全部
 *      失效，是与 K-12 同型的静默漏检面，评审 I-1）；`;` 仍需 parenDepth === 0 门控
 *      （url(data:…;base64,…) 的 `;` 不是边界）。每个 token 段的文本 + 起始行 = 一条声明候选；
 *      行号在扫描时逐字符跟随（首个非空白字符入段时的当前行——注释内换行同样计数），
 *      不做"文本内换行重数"：注释字符整体丢弃，重数会把注释里的换行漏掉、把声明误标到
 *      注释行上。跨行声明值（K-10）整体参与判定，违规落声明起始行而非续行（stylelint 同款）。
 *   2b) URL 态（评审修复轮 1b）：`url(`（词界起、大小写不敏感）后到 URL 内配对深度归零的
 *      `)` 之前，`{` `}` `;` `(` `)` 一律不作 token 边界——裸内容里的字面括号（内联 SVG
 *      data URI `<style>.x{fill:red}</style>`）不得把段切断：切断后碎片既不在 url() 内
 *      （URL_RE 剥不掉）又含裸色名 ⇒ blocker 级假阳性，而门禁的假 blocker 会教作者绕门禁。
 *   3) 前导剥离（等价现网 lastBrace 切片）：段终止于 `{` 即规则头/At 规则前导——
 *      "丢弃最后一个顶层 `{` 之前的文本"整段丢弃（不产出声明），判定式即
 *      `顶层 : 的下标 > 该段最后一个顶层 { 的下标`。单行规则 `.x { color: #f00; }`
 *      不漏检，`.purple-card {` 不误报。
 *   4) 非声明段跳过（等价现网 includes(":") 弱门，但由分词器判定）：段内顶层 `:`
 *      （括号/字符串外）不存在 → 不产出声明——`@media (min-width: 900px)` 的冒号在
 *      括号内，选择器/At 规则头因此不参与结构化判定（named-colors 147 词表含
 *      purple/pink/orange/gold，规则头一旦进入判定即误报）。
 *   5) 结构化判定前剥离字符串字面量（内容保留在声明文本里但不参与判定）、var() 引用
 *      （token 化豁免）与 url() 内容（防 pink.png 类资源名误报）。
 * emoji 检查不走分词管线——原文行上判（注释内 emoji 仍计，负样本钉死）。
 *
 * 残余面（已核可构造、未归零——均为非法 CSS 或极端形态，取舍见 task-1-report「修复轮 1/1b」）：
 *   a) 坏字符串（未闭合引号）跨行吞并：坏字符串里的 `;` 不是边界 ⇒ 与紧随声明并入同一段，
 *      声明级字符串剥离（按对到段尾容错）把该段 `"` 之后整段剥掉 ⇒ 紧随声明的裸色不报。
 *   b) **未闭合的 `url(`**（无配对 `)`）：URL 态不退出 ⇒ 其后内容并入同一段，URL_RE 因缺
 *      `)` 剥不掉 ⇒ 段内一切裸色名/hex 照报（`url(…<style>.x{fill:red}` 会误报）——方向是
 *      **响**不是漏。合法闭合的 url（含字面 `{` `}` `;` 的内联 SVG data URI）已由 URL 态保护，
 *      实测零 finding；base64 形态 `url(data:image/png;base64,AAA=)` 同样零 finding。
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
// 字符串字面量（含未闭合到行尾/文件尾的容错形态）——内容保留在声明文本里但不参与结构化判定
const STRING_LITERAL_RE = /"(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$)/g;
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

// ── 声明级分词器（M3b：K-10 跨行值 / K-12 字符串内 `/*`） ──

/** 一条声明段：text = 注释已整体丢弃、跨行折叠为空格、首尾修剪的声明文本。 */
export interface CssDeclaration {
  text: string;
  /** 声明起始行（1 起；该声明首个非空白字符所在行）——Finding.location 的 `:N` 取此行。 */
  line: number;
}

/**
 * 段内顶层标记（顶层 = 非字符串、括号外）：最后一个 `{` 与首个 `:` 的下标（-1 = 无）。
 * 前导剥离判定的依据（等价现网 `lastBrace` 切片）：字符串/括号内的 `{` 不参与
 * （防 `content: "{"` 被误切），`@media (min-width: 900px)` 的冒号在括号内亦不计。
 */
function topLevelMarkers(seg: string): { brace: number; colon: number } {
  let brace = -1;
  let colon = -1;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "\\") {
      // 转义：跳过被转义字符——字符串外同样成立（与 tokenizeCss 同款，评审 I-1①）。
      // 防御性：在「`{` `}` 为无条件边界 + 字符串外转义」两者齐备的当下，这里是**无判别
      // 向量**的（转义括号只出现在选择器里，而选择器段已被 `{` 边界整段丢弃）；保留的理由
      // 是将来若再改边界规则，转义选择器这条泄漏不会重新打开，且它只可能把极端非法输入
      // 推向"报"而非"漏"。
      i++;
      continue;
    }
    if (quote !== "") {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      if (ch === "{") brace = i;
      else if (ch === ":" && colon === -1) colon = i;
    }
  }
  return { brace, colon };
}

/**
 * tokenizeCss：单遍状态机把 CSS 源码切成声明段（M3b）。
 *
 * 状态：`inComment` / `inString`（`"` `'`，`\` 转义；裸换行即终止 = CSS bad-string）/
 * `urlDepth`（`url(` 裸内容，内部无边界）/ `parenDepth`；`/*` 仅在非字符串非注释非 URL 时
 * 开注释，`*\/` 仅注释态生效；`\` 在字符串外同样转义（被转义字符不参与结构判定）。
 * token 边界：`{` `}` 无条件（并复位 parenDepth —— 未闭合 `(` 不得让后续边界永久失效），
 * `;` 需 parenDepth === 0。每段产出一条声明的条件（等价现网"前导剥离 + includes(':')
 * 弱门"两条语义）：
 *   ① 段终止于 `{` 者（规则头/At 规则前导）被前导剥离整段丢弃（补入的 `{` 是该段
 *      最后一个顶层 `{`，顶层 `:` 必在它之前 ⇒ 判定式 `colon > brace` 不成立）；
 *   ② 段内顶层 `:` 不存在 → 非声明段，跳过一切结构化判定。
 * 行号 = 该声明首个非空白字符所在行（跨行值归属声明起始行，stylelint 同款）：扫描时
 * 逐字符跟随（注释内换行计数），不在段文本上重数换行——注释字符已丢弃，重数会漏计。
 */
export function tokenizeCss(css: string): CssDeclaration[] {
  const decls: CssDeclaration[] = [];
  let text = ""; // 当前 token 段（注释已丢弃；字符串内容保留）
  let line = 1; // 当前扫描位置所在行
  let firstLine = 0; // 当前段首个非空白字符所在行（0 = 段内尚无非空白字符）
  let inComment = false;
  let quote = ""; // 非空 = 字符串态（值为当前引号）
  let parenDepth = 0;
  let urlDepth = 0; // > 0 = URL 态（`url(` 裸内容内；`{` `}` `;` `(` `)` 均不作边界）

  /** 入段：记录首个非空白字符的行（声明归属行的唯一真相源），再追加字符。 */
  const put = (ch: string): void => {
    if (firstLine === 0 && !/\s/.test(ch)) firstLine = line;
    text += ch;
  };

  const flush = (terminator: string): void => {
    // 前导剥离：`{` 是 token 边界，段终止于 `{` 即规则头/At 规则前导——把段终止符一并
    // 计入"最后一个顶层 `{`"，该段整体丢弃（等价现网 lastBrace 切片）。
    const seg = terminator === "{" ? `${text}{` : text;
    const { brace, colon } = topLevelMarkers(seg);
    // 非声明段跳过：段内无顶层 `:`（或冒号落在被丢弃的前导内）→ 不产出声明。
    // 产出声明时必有 brace === -1（分词器保证顶层 `{` 一律是边界）⇒ 声明文本即整段文本。
    if (colon > brace && firstLine > 0) {
      decls.push({ text: text.replace(/\s+/g, " ").trim(), line: firstLine });
    }
    text = "";
    firstLine = 0;
  };

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inComment) {
      if (ch === "*" && css[i + 1] === "/") {
        inComment = false;
        i++;
      } else if (ch === "\n") line++;
      continue; // 注释内容整体丢弃
    }
    if (quote !== "") {
      put(ch); // 字符串内容保留在声明文本里（结构化判定前剥离）
      if (ch === "\\" && css[i + 1] !== undefined) {
        if (css[i + 1] === "\n") line++;
        put(css[i + 1]); // 转义序列整体入文本（`\` + 换行 = 续行，字符串态保持）
        i++;
      } else if (ch === quote) {
        quote = "";
      } else if (ch === "\n") {
        // CSS 字符串不得含裸换行（bad-string）：未闭合引号在行末终止——抑制面从
        // "文件余下全部"收窄到"下一个 token 边界之前"（坏字符串里的 `;` 不是边界，
        // 故该范围可跨行，紧随的物理行仍可能被吞），不再整文件漏检。
        line++;
        quote = "";
      }
      continue;
    }
    if (urlDepth > 0) {
      // URL 态：`url(` 的裸内容——`{` `}` `;` `(` `)` 一律不作 token 边界，`)` 仅在 URL 内
      // 配对深度归零时退出。理由：裸内容里的字面括号（内联 SVG data URI，如
      // `url(data:…,<style>.x{fill:red}</style>)`）被 `{` 切断后，碎片既不在 url() 内
      // （URL_RE 剥不掉）又含裸色名 ⇒ blocker 级假阳性（门禁假 blocker 会教作者绕门禁）。
      put(ch);
      if (ch === "\\" && css[i + 1] !== undefined) {
        if (css[i + 1] === "\n") line++;
        put(css[i + 1]); // URL 内转义同样整体入文本
        i++;
      } else if (ch === '"' || ch === "'") {
        quote = ch; // URL 内的引号串走公共字符串态（串内 `/*` 不置注释、`)` 不算配对）
      } else if (ch === "(") {
        urlDepth++;
      } else if (ch === ")") {
        urlDepth--;
      } else if (ch === "\n") {
        line++;
      }
      continue;
    }
    if (
      (ch === "u" || ch === "U") &&
      css.slice(i, i + 4).toLowerCase() === "url(" &&
      (i === 0 || !/[-\w]/.test(css[i - 1])) // 词界守卫：`myurl(` / `--url(` 不算 url 函数
    ) {
      put(css.slice(i, i + 4)); // `url(` 原样入段（内容随段保留，判定前由 URL_RE 剥离）
      urlDepth = 1;
      i += 3;
      continue;
    }
    if (ch === "\\" && css[i + 1] !== undefined) {
      // CSS 转义在字符串外同样成立：`\` + 下一字符整体入文本，被转义字符不参与结构判定
      // ——`\(` `\{` `\;` 不改变括号深度、不产生边界（选择器 `.foo\(` 是合法 CSS；
      // 不跳过会把深度顶成 1 且永不复位 ⇒ 后续全部边界失效 = 静默漏检面，评审 I-1①）。
      put(ch);
      if (css[i + 1] === "\n") line++;
      put(css[i + 1]);
      i++;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      inComment = true; // 仅在非字符串非注释态开注释（K-12）
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      put(ch);
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      put(ch);
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      put(ch);
      continue;
    }
    if (ch === "{" || ch === "}") {
      // 结构 token（`{` `}`）**无条件**作边界，并复位括号深度——原因是"深度永不为 0"会
      // 让后续所有边界一并失效（K-12 同型的静默漏检面，评审 I-1②）：
      //   合法 CSS 的值内不存在裸 `{` `}`（字符串/注释内的已由各自状态处理；url() 裸内容
      //   见文件头「残余面」），故 `{` `}` 是比 `(` 更可靠的重锚点：typo 少一个 `)` 时，
      //   下一个 `{`/`}` 即把深度归零、解析重新对齐（`.a { color: #f00; }` 不再被吞）。
      flush(ch);
      parenDepth = 0;
      continue;
    }
    if (parenDepth === 0 && ch === ";") {
      flush(ch); // token 边界：`;` 仍需深度门控（url(data:…;base64,…) 的 `;` 不是边界）
      continue;
    }
    if (ch === "\n") line++;
    put(ch);
  }
  flush(""); // 文件尾残余段
  return decls;
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

function scanDeclaration(path: string, decl: CssDeclaration, findings: Finding[]): void {
  const loc = `${path}:${decl.line}`;

  // 声明段文本：分词器已保证段内有顶层 `:` 且无规则头（非声明段不进入本函数）。
  const declPart = decl.text;
  // 结构化判定前剥离字符串字面量（内容保留在声明文本里但不参与判定）、var() 引用
  // （token 化豁免）与 url() 内容（防 pink.png 类资源名误报）
  const structPart = declPart.replace(STRING_LITERAL_RE, "");
  const colorLine = structPart.replace(VAR_RE, "").replace(URL_RE, "");

  // #2 禁硬编码色（white/black 豁免：命名 + hex 形式）。
  // 无冒号段 = 非声明段（注释/选择器/At 规则头），已由 tokenizeCss 挡在门外——
  // 防 .purple-card / #gold 误报（评审修复语义等价保留）。
  const noWhiteBlack = colorLine.replace(WHITE_BLACK_HEX_RE, "");
  if (
    noWhiteBlack.match(HEX_RE_G) !== null ||
    RGB_RE.test(colorLine) ||
    HSL_RE.test(colorLine) ||
    NAMED_COLOR_RE.test(colorLine)
  ) {
    pushFinding(findings, "禁硬编码色", "blocker", loc, "裸色值（须走 var(--*) token，white/black 豁免）");
  }

  // #3 禁硬编码字体
  if (FONT_RE.test(structPart)) {
    pushFinding(findings, "禁硬编码字体", "blocker", loc, "裸 font-family（须走 var(--font-*)）");
  }

  // #4 禁裸动画时长（CSS 部分）：长属性 + animation:/transition: 缩写值内时长（终审 I-1）
  if (DUR_RE.test(structPart) || TRANSITION_DUR_RE.test(structPart)) {
    pushFinding(findings, "禁裸动画时长", "blocker", loc, "裸动画时长（须走 var(--dur-*)）");
  }
  // 缩写值内时长：var() 引用剥离后仍含时间即报（token 化时长豁免）
  const noVarDecl = structPart.replace(VAR_RE, "");
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
  if (GRADIENT_RE.test(structPart)) {
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

  // #6b 禁 emoji 不在此函数——不走分词管线，原文行上判（见 scanChapterCss）

  // #5 字阶成员 + V4 最小字号（合并判断：<24 → 最小字号；≥24 且 ∉ 字阶 → 字阶成员）
  for (const m of structPart.matchAll(FONT_SIZE_RE)) {
    const v = parseFloat(m[1]);
    if (v < MIN_FONT_PX) {
      pushFinding(findings, "最小字号", "warning", loc, `字号 ${v}px 低于最小字号 ${MIN_FONT_PX}px（V4）`);
    } else if (!TYPE_SCALE.has(v)) {
      pushFinding(findings, "字阶成员", "warning", loc, `字号 ${v}px 不在字阶集合（${TYPE_SCALE_LABEL}）`);
    }
  }

  // #5b 间距成员（margin/padding/gap 裸 px 须 ∈ --space 集合；0 豁免）
  for (const m of structPart.matchAll(SPACING_DECL_RE)) {
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
    // 声明级状态机：注释/字符串/括号三态 + token 边界切段（K-10 / K-12）
    for (const decl of tokenizeCss(css)) scanDeclaration(path, decl, findings);
    // #6b 禁 emoji（Unicode Extended_Pictographic 范围）：不走分词管线——原文行上判，
    // 注释内 emoji 仍计、定位落 emoji 所在行（既有负样本钉死，M3b 保持不变）。
    css.split("\n").forEach((rawLine, i) => {
      if (EMOJI_RE.test(rawLine)) {
        pushFinding(
          findings,
          "禁emoji",
          "warning",
          `${path}:${i + 1}`,
          "出现 emoji 字符（Unicode Extended_Pictographic）",
        );
      }
    });
  }
  return findings;
}
