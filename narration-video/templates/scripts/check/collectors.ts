/**
 * collectors：无头门禁的**页面侧收集器**（M3b Task 7 建面，Task 8 追加三个）。
 *
 * ## 为什么收集器是"源码字符串"而不是真函数（本计划的硬约束，不是风格偏好）
 *
 * tsx 用 esbuild 且**硬编码 `keepNames: true`**（`node_modules/tsx/dist/*.mjs`，CLI 无开关可关）：
 * 函数体内的**具名函数表达式 / 赋给 const 的箭头**会被改写成 `__name(…)` 调用。若把这样一个
 * 真函数交给 `page.evaluate(fn, args)`，Playwright 用 `fn.toString()` 把源码序列化进浏览器——
 * 而浏览器里没有 `__name` → **`ReferenceError: __name is not defined`，`npm run check` 真机必崩**。
 * 而 **vitest 不做 keepNames**，进程内单测全绿也发现不了（"测试通过、交付件必崩"的陷阱）。
 *
 * 故本模块把收集器做成 `String.raw` 模板里的**源码文本**：esbuild 看不见它的内容，注入物无从产生；
 * 调用侧一律 `page.evaluate("(" + SRC + ")(" + JSON.stringify(args) + ")")`。
 *   · 推论一：源码串内**不得出现反引号与 `${`**（否则 String.raw 模板被截断/插值）——
 *     串内一律用字符串拼接，不写模板字面量（collectors.test.ts 钉死）。
 *   · 推论二：Node 侧用 `fromSrc`（`new Function("return (" + src + ")")()`）取**同一份文本**
 *     的实现做单测——两侧跑同一文本，不存在"测的是一份、跑的是另一份"。
 *
 * ## 本任务落的收集器（#16 第②条：被画布截断 → blocker）
 *
 * `COLLECT_OVERFLOW_SRC`：页面级溢出（documentElement 滚动面 > 视口）+ 元素级被画布截断。
 * **元素级的完整口径归 Task 8**（更细的排除面），本任务只落"能跑通 + 非空护栏"的最小面，
 * 但最小面也必须有判别力：真机负样本（`left:-200` 的含文本元素）必须报出来
 * （Step 5 真机正反样本逐条取证）。
 *
 * 关键取舍：
 *  1. **画布根 = `[data-testid="stage-frame"]`**（Stage.tsx 的稳定钩子；1920×1080 舞台，其
 *     `overflow:hidden` 就是"截断者"本体）。找不到画布根 → `examined === 0` + blocker
 *     ——收集器没有任何可检查的面（非空护栏）；**步级零元素是合法态**（该步没有子元素不报）。
 *  2. **裁剪祖先内的越界不报**（反向护栏）：`overflow:hidden` 祖先（KenBurns 放大内层、
 *     自绘图表裁切）里的元素越出画布是**设计**，不是内容被截断——不排除它，任何 scale 动画
 *     都会变成假 blocker。
 *  3. **可见性先于几何**：零矩形（display:none / 空盒子）与 `visibility:hidden` 的元素不作为
 *     截断候选（不可见的内容谈不上"被裁掉"）。
 *  4. **容差 `tolerancePx`（默认 1）**：布局取整的亚像素差不得制造假 blocker。
 *  5. **量化输出**（Global Constraints）：每条 finding 带 px 数值，报告可直接对照修改。
 *
 * ## Task 8 追加的三条（§11.1 #20 / #18 / #14 的无头半边）
 *
 * `COLLECT_SAFE_MARGINS_SRC`（#20 warning）/ `COLLECT_CONTRAST_SRC`（#18 warning）/
 * `COLLECT_FONTS_SRC`（#14 blocker）。三者的口径见各常量上方注释，共同的取舍：
 *
 *  · **文本检查面**（`TEXT_SURFACE_SRC` 一份文本注入到三个收集器）= 含**直接可见文本**的元素：
 *    直接子节点里有非空白文本节点（`<svg><text>` 天然满足，无需特判）+ 自身可见 +
 *    矩形非退化。**纯 padding 容器（无直接文本）天然不入检查面**——检查的是"文字落在哪"，
 *    不是"容器有多宽"：一个只有 padding 的壳子越界与否与读者能否看见文字无关。
 *  · **检查的是元素盒**（`getBoundingClientRect` 的 border box），不是字形墨迹框：
 *    §12b V1 的实测锚点（"内容盒实测底缘 = 934.000"）量的是内容盒。
 *  · **两处排除**（各有理由，别混为一谈）：
 *      - `.caption-layer` 子树（#20/#18 排除）：框架级字幕带（§9/V2），它的底边位置由框架
 *        自己守（captionTop 958 之上），章节层不该为它背越界；对比度同理（框架组件）。
 *      - #14 **不排除**字幕：`document.fonts` 是**文档级**事实源，采样面必须与它同域，
 *        否则框架层 chrome 用的字体加载会被判成"加载了没人用"的假 blocker（见下）。
 *  · **亚像素容差 0.5px**（#20）：T4 评审 Important-1 的裁定——内容盒底缘实测恰为 934.000
 *    （零余量），判据必须是 `≤ 934 + 容差`；零容差/严格 `<` 会让合规版式恒报越界。
 *
 * ### 纯判据的"两侧同一文本"（本文件的第三条推论）
 *
 * `contrastRatio` / `outOfBandPx` / `diffFamilies` 是**纯函数**（无 DOM），但浏览器侧也要用
 * 同一套判据（收集器在页面里判，不在 Node 侧重算一遍）。故它们的实现也是 `String.raw` 源码串，
 * 由三处消费：
 *   · 拼接进对应收集器的 SRC（页面里跑）；
 *   · Node 侧 `fromSrc(...)` 取出可调用实现，包成同名 TS 函数导出（单测/报告里跑）；
 *   · 子进程护栏（collectors.test.ts）验真 tsx 路径。
 * 两侧跑的是**同一份文本**，不存在"测的是一份、跑的是另一份"（与 T7 的 `fromSrc` 同款论证）。
 */

/** 收集器 finding 的分级（比 FindingBag 多一档 info：不可判定/环境噪音，计数但不进退出码）。 */
export type CollectorSeverity = "blocker" | "warning" | "info";

/** 收集器的 finding（结构对齐 src 侧 Finding，多一档 info；severity 的取舍见 headless.ts）。 */
export interface CollectorFinding {
  rule: string;
  severity: CollectorSeverity;
  location: string;
  message: string;
}

/** 收集器返回值：findings + examined（非空护栏的计数面——收集器级 `examined === 0` → blocker）。 */
export interface CollectorResult {
  findings: CollectorFinding[];
  examined: number;
}

/** 画布根选择器（Stage.tsx 的 stage-frame；`stageConfig.dims` 就是它的尺寸）。 */
export const STAGE_SELECTOR = '[data-testid="stage-frame"]';

/** 元素级截断的规则名（§11.1 #16 第②条：被画布截断 → blocker）。 */
export const OVERFLOW_RULE = "被画布截断";

/** 页面级溢出的规则名（documentElement 滚动面 > 视口）。 */
export const PAGE_OVERFLOW_RULE = "页面溢出";

/**
 * 页面侧收集器（`function (args) { … }` 源码文本）——参数/返回：
 *   args = { canvasSelector?: string; tolerancePx?: number }
 *   → { findings: CollectorFinding[]; examined: number }
 * 串内不写模板字面量（见文件头推论一）。
 */
export const COLLECT_OVERFLOW_SRC = String.raw`function (args) {
  var opts = args || {};
  var canvasSelector =
    typeof opts.canvasSelector === "string" && opts.canvasSelector !== ""
      ? opts.canvasSelector
      : '[data-testid="stage-frame"]';
  var tolerancePx = typeof opts.tolerancePx === "number" ? opts.tolerancePx : 1;
  var findings = [];
  var examined = 0;

  function push(rule, severity, location, message) {
    findings.push({ rule: rule, severity: severity, location: location, message: message });
  }

  function describe(el) {
    var out = el.tagName ? el.tagName.toLowerCase() : "?";
    if (el.id) out += "#" + el.id;
    var testid = el.getAttribute ? el.getAttribute("data-testid") : null;
    if (testid) out += "[data-testid=" + testid + "]";
    if (!el.id && !testid && el.classList && el.classList.length > 0) {
      out += "." + el.classList[0];
    }
    return out;
  }

  function isClipValue(v) {
    return v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
  }

  function clips(el) {
    var st = getComputedStyle(el);
    return isClipValue(st.overflow) || isClipValue(st.overflowX) || isClipValue(st.overflowY);
  }

  function isInvisible(el) {
    var st = getComputedStyle(el);
    return st.visibility === "hidden" || st.visibility === "collapse" || st.display === "none";
  }

  var canvas = document.querySelector(canvasSelector);
  if (!canvas) {
    // 非空护栏：没有画布根 = 收集器什么都没检查（页面未挂载 / 选择器与页面失配）。
    push(
      "被画布截断",
      "blocker",
      canvasSelector,
      "未找到画布根（" + canvasSelector + "）——收集器没有可检查的面（非空护栏）：" +
        "页面未挂载、?render=1 下 Stage 未渲染，或选择器与页面结构失配"
    );
    return { findings: findings, examined: examined };
  }

  // ① 页面级溢出：文档滚动面超出视口（右/下向的溢出才会长大 scrollWidth/Height）
  var de = document.documentElement;
  if (de) {
    var overX = de.scrollWidth - window.innerWidth;
    var overY = de.scrollHeight - window.innerHeight;
    if (overX > tolerancePx || overY > tolerancePx) {
      push(
        "页面溢出",
        "blocker",
        "documentElement",
        "文档滚动面超出视口：横向 " + Math.round(overX) + "px（scrollWidth " + de.scrollWidth +
          " > 视口 " + window.innerWidth + "）、纵向 " + Math.round(overY) + "px（scrollHeight " +
          de.scrollHeight + " > 视口 " + window.innerHeight + "）——页面级溢出：必有内容落在画布之外"
      );
    }
  }

  // ② 元素级：越出画布且**没有被裁剪祖先承接**的可见元素 = 内容被画布裁掉
  var canvasRect = canvas.getBoundingClientRect();
  var nodes = canvas.querySelectorAll("*");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    examined++;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // 未布局/空盒子
    var dl = canvasRect.left - r.left;
    var dr = r.right - canvasRect.right;
    var dt = canvasRect.top - r.top;
    var db = r.bottom - canvasRect.bottom;
    var over = Math.max(dl, dr, dt, db);
    if (!(over > tolerancePx)) continue; // 含 NaN 兜底：NaN 比较为 false → 视为不越界
    if (isInvisible(el)) continue;
    var clipped = false;
    for (var p = el.parentElement; p && p !== canvas; p = p.parentElement) {
      if (clips(p)) {
        clipped = true;
        break;
      }
    }
    if (clipped) continue; // 裁剪祖先已显式承接：越出画布是设计（如放大内层）
    var edges = [];
    if (dl > tolerancePx) edges.push("左 " + Math.round(dl) + "px");
    if (dr > tolerancePx) edges.push("右 " + Math.round(dr) + "px");
    if (dt > tolerancePx) edges.push("上 " + Math.round(dt) + "px");
    if (db > tolerancePx) edges.push("下 " + Math.round(db) + "px");
    push(
      "被画布截断",
      "blocker",
      describe(el),
      "元素越出画布（" + edges.join("、") + "，画布 " + Math.round(canvasRect.width) + "×" +
        Math.round(canvasRect.height) + "）——画布的 overflow:hidden 会把落在框外的内容裁掉，" +
        "观众看不到；请把元素移回画布内（或让最近的定位祖先显式裁剪承接）"
    );
  }

  return { findings: findings, examined: examined };
}`;

/**
 * 源码串 → 可调用实现（Node 侧单测用；与浏览器侧**同一份文本**）。
 * 说明：这里刻意不用模板字面量拼串——保持与页面侧调用同型（`"(" + src + ")"`）。
 */
export function fromSrc<T>(src: string): T {
  return new Function("return (" + src + ")")() as T;
}

// ══════════════════════════════════════════════════════════════════════════
// Task 8：#20 文字安全边距 / #18 对比度 / #14 字体加载（无头半边）
// ══════════════════════════════════════════════════════════════════════════

/** #20 的规则名（§11.1 #20「文字安全边距」）。 */
export const SAFE_MARGIN_RULE = "文字安全边距";
/** #18 的规则名（§11.1 #18「对比度检查」的短名）。 */
export const CONTRAST_RULE = "对比度";
/** #14 的规则名（§11.1 #14「字体加载校验」的短名）。 */
export const FONT_RULE = "字体加载";

/**
 * chrome 带标记（`data-safe-band="chrome"`）——**作者约定**，全仓当前无生产者：
 * topbar 在 showcase 是内联结构、章节层没有框架级 chrome。默认**从严**：未标记的顶栏文字
 * 会被报成内容带越界（误报消息里附"若为 chrome 带元素请加 `data-safe-band="chrome"`"的指引）。
 * 随 CHAPTER-CRAFT 在 M7 成文；已登记 KNOWN-ISSUES。
 */
export const CHROME_BAND_SELECTOR = '[data-safe-band="chrome"]';

/** 字幕层选择器（框架级字幕带：§9/V2；#20/#18 排除它，理由见文件头"两处排除"）。 */
export const CAPTION_LAYER_SELECTOR = ".caption-layer";

/**
 * 安全边距的亚像素容差（T4 评审 Important-1 的裁定）：
 * 内容盒底缘实测**恰好 = 934.000**（零余量）→ 判据必须是 `≤ 934 + 容差`；
 * 零容差/严格 `<` 会把合规版式判成越界。
 */
export const SAFE_MARGIN_TOLERANCE_PX = 0.5;

// ── 纯判据的类型面（Node 与页面两侧共用） ──

/** sRGB 颜色（0-255；`a` 缺省 = 1）。 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** 画布相对坐标的矩形（DOMRect 的四缘；画布左上角 = 0,0）。 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 安全带：允许区域在**画布 px** 里的四缘（不是"距边距离"——那样每处调用都要再换算一次）。 */
export interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 四边的越界量（0 = 带内；> 0 = 越界原始 px）。 */
export interface EdgeOverage {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 画布尺寸（`stageConfig.dims`；把 DOM 视觉坐标换算回画布 px 的分母）。 */
export interface Size {
  width: number;
  height: number;
}

/** 安全框的**结构面**（`src/engine/safe-area.ts` 的 `SafeArea` 去掉 captionTop 后的投影）。 */
export interface SafeAreaLike {
  chrome: number;
  content: number;
  top: number;
  contentBottom: number;
}

// ── 纯判据的源码串（浏览器侧与 Node 侧同一份文本，见文件头"两侧同一文本"） ──
//
// 形态约定：判据一律写成**定义组**（一串 `function x() {}` 声明 + 不使用模板字面量），
// 两种消费方式都从这一份文本派生：
//   · `*_DEFS` 直接拼进收集器函数体内（页面里跑）；
//   · `wrapJudge(DEFS, "name")` 包成 IIFE（`(function () { <defs> return <name>; })()`）交给
//     `fromSrc` 取回可调用实现（Node 侧跑）。
// **不能**直接把定义组交给 `fromSrc`：`new Function("return (" + defs + ")")` 里
// `(function a(){} function b(){})` 是语法错误（括号里放不下多条声明）。

/** 相对亮度比（WCAG 2.x）：先按 sRGB 转线性，再取 (L_hi + 0.05) / (L_lo + 0.05)。 */
const CONTRAST_RATIO_DEFS = String.raw`
function channelLum(v) {
  var s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLum(c) {
  return 0.2126 * channelLum(c.r) + 0.7152 * channelLum(c.g) + 0.0722 * channelLum(c.b);
}

function composite(fg, bg) {
  var a = typeof fg.a === "number" ? fg.a : 1;
  if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1
  };
}

// 说明：bg 必须是**已收敛（不透明）**的有效背景——半透明背景由收集器先合成再传进来
// （合成器 over 在收集器体内：它要保留 α 用于判"背景是否收敛"，本判据只吃收敛值）。
function contrastRatio(fg, bg) {
  var f = composite(fg, bg);
  var b = { r: bg.r, g: bg.g, b: bg.b, a: 1 };
  var l1 = relativeLum(f);
  var l2 = relativeLum(b);
  var hi = Math.max(l1, l2);
  var lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
`;

/** 安全边距越界量化：`> tolerancePx` 才算越界，且报**原始量**（不扣容差）。 */
const OUT_OF_BAND_DEFS = String.raw`
function outOfBandPx(rect, band, tolerancePx) {
  var out = { left: 0, right: 0, top: 0, bottom: 0 };
  var l = band.left - rect.left;
  var r = rect.right - band.right;
  var t = band.top - rect.top;
  var b = rect.bottom - band.bottom;
  if (l > tolerancePx) out.left = l;
  if (r > tolerancePx) out.right = r;
  if (t > tolerancePx) out.top = t;
  if (b > tolerancePx) out.bottom = b;
  return out;
}
`;

/** 家族名规整 + 拆列表（CSS 家族名不区分大小写、可带引号），`diffFamilies` 的依赖。 */
const FAMILIES_DEFS = String.raw`
function cleanFamily(v) {
  var s = String(v === null || v === undefined ? "" : v);
  s = s.replace(/["']/g, "");
  s = s.replace(/^\s+/, "");
  s = s.replace(/\s+$/, "");
  return s;
}

function splitFamilies(v) {
  var raw = String(v === null || v === undefined ? "" : v);
  var parts = raw.split(",");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var fam = cleanFamily(parts[i]);
    if (fam !== "") out.push(fam);
  }
  return out;
}
`;

/** #14 的差集：`loaded ⊄ used` → 返回**已加载但没有任何渲染文本在用**的家族（保序、去重）。 */
const DIFF_FAMILIES_DEFS = String.raw`
function diffFamilies(loaded, used) {
  var usedKeys = [];
  for (var i = 0; i < used.length; i++) {
    var uk = cleanFamily(used[i]).toLowerCase();
    if (uk !== "" && usedKeys.indexOf(uk) === -1) usedKeys.push(uk);
  }
  var out = [];
  var seen = [];
  for (var j = 0; j < loaded.length; j++) {
    var fam = cleanFamily(loaded[j]);
    var key = fam.toLowerCase();
    if (fam === "") continue;
    if (usedKeys.indexOf(key) !== -1) continue;
    if (seen.indexOf(key) !== -1) continue;
    seen.push(key);
    out.push(fam);
  }
  return out;
}
`;

/** 家族面 + 差集（字体收集器与 Node 侧 `diffFamilies` 共用，顺序不可调换：差集依赖 cleanFamily）。 */
const FAMILY_DIFF_DEFS = FAMILIES_DEFS + DIFF_FAMILIES_DEFS;

/** 定义组 → 可调用形态（Node 侧专用；页面侧用的是 `*_DEFS` 原文，两侧同一份文本）。 */
function wrapJudge(defs: string, name: string): string {
  return "(function () {" + defs + "\nreturn " + name + ";\n})()";
}

/**
 * 文本检查面的共同定义（一份文本注入到三个收集器各自的函数作用域）：
 *   · `skipTag`：非渲染文本（script/style/title/desc/…）与元数据节点不入面；
 *   · `hasDirectText`：**直接子节点**里有非空白文本节点（`<svg><text>` 天然满足）；
 *   · `isVisible`：display:none / visibility:hidden|collapse 不入面；
 *   · `describe`：finding 的定位串（与 #16 的溢出收集器同款）。
 */
const TEXT_SURFACE_SRC = String.raw`
function skipTag(el) {
  var tag = el.tagName;
  if (!tag) return true;
  return (
    tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TITLE" ||
    tag === "DESC" || tag === "META" || tag === "LINK" || tag === "HEAD"
  );
}

function hasDirectText(el) {
  var kids = el.childNodes;
  for (var i = 0; i < kids.length; i++) {
    var n = kids[i];
    if (n.nodeType !== 3 || n.nodeValue === null) continue;
    if (n.nodeValue.replace(/\s+/g, "") !== "") return true;
  }
  return false;
}

function isVisible(el) {
  var st = getComputedStyle(el);
  if (st.display === "none") return false;
  if (st.visibility === "hidden" || st.visibility === "collapse") return false;
  return true;
}

function describe(el) {
  if (!el) return "?"; // 祖先链走空时 from 可能为 null：定位串降级为 "?"，不抛（收集器不因定位信息炸）
  var out = el.tagName ? el.tagName.toLowerCase() : "?";
  if (el.id) out += "#" + el.id;
  var testid = el.getAttribute ? el.getAttribute("data-testid") : null;
  if (testid) out += "[data-testid=" + testid + "]";
  if (!el.id && !testid && el.classList && el.classList.length > 0) out += "." + el.classList[0];
  return out;
}
`;

// ── #20 文字安全边距收集器 ──

/** #20 收集器参数（`safeMarginArgs` 产出；安全带数字一律来自 `src/engine/safe-area.ts`）。 */
export interface SafeMarginArgs {
  canvasSelector: string;
  captionSelector: string;
  /** **必传**（不是可选）：由 headless.ts 显式传 `[data-safe-band="chrome"]` */
  chromeSelector: string;
  canvasSize: Size;
  /** 内容带（左/右 96、顶 112、底 934 的折算结果），画布 px 四缘 */
  contentBand: Band;
  /** chrome 带（左/右 64），画布 px 四缘；垂直不设限 */
  chromeBand: Band;
  tolerancePx: number;
}

/**
 * 页面侧收集器（#20）：舞台框内含**直接可见文本**的元素越出安全带 → warning，量化"越界 Xpx"。
 * `args = SafeMarginArgs` → `{ findings, examined }`。
 * 找不到画布根 / 安全带参数缺失 → blocker（非空护栏：拒绝把"什么都没查"当"没有问题"）。
 */
export const COLLECT_SAFE_MARGINS_SRC =
  String.raw`function (args) {` +
  TEXT_SURFACE_SRC +
  OUT_OF_BAND_DEFS +
  String.raw`
  var opts = args || {};
  var canvasSelector =
    typeof opts.canvasSelector === "string" && opts.canvasSelector !== ""
      ? opts.canvasSelector
      : '[data-testid="stage-frame"]';
  var captionSelector =
    typeof opts.captionSelector === "string" ? opts.captionSelector : ".caption-layer";
  var chromeSelector =
    typeof opts.chromeSelector === "string" ? opts.chromeSelector : '[data-safe-band="chrome"]';
  var tolerancePx = typeof opts.tolerancePx === "number" ? opts.tolerancePx : 0.5;
  var findings = [];
  var examined = 0;

  function pxText(v) {
    return String(Math.round(v * 10) / 10);
  }

  function inSubtree(el, selector) {
    if (selector === "") return false;
    if (typeof el.closest !== "function") return false;
    return el.closest(selector) !== null;
  }

  var canvas = document.querySelector(canvasSelector);
  if (!canvas) {
    findings.push({
      rule: "文字安全边距",
      severity: "blocker",
      location: canvasSelector,
      message:
        "未找到画布根（" + canvasSelector + "）——收集器没有可检查的面（非空护栏）：" +
        "页面未挂载、?render=1 下 Stage 未渲染，或选择器与页面结构失配"
    });
    return { findings: findings, examined: examined };
  }
  if (!opts.canvasSize || !opts.contentBand || !opts.chromeBand) {
    findings.push({
      rule: "文字安全边距",
      severity: "blocker",
      location: canvasSelector,
      message:
        "安全带参数缺失（canvasSize / contentBand / chromeBand 必传）——安全框数字的单一源是 " +
        "src/engine/safe-area.ts，收集器不内置 96/112/934 的副本；缺参数时宁炸不静默缩小检查面"
    });
    return { findings: findings, examined: examined };
  }

  var canvasRect = canvas.getBoundingClientRect();
  var size = opts.canvasSize;
  var sx = canvasRect.width > 0 && size.width > 0 ? canvasRect.width / size.width : 1;
  var sy = canvasRect.height > 0 && size.height > 0 ? canvasRect.height / size.height : 1;
  var contentBand = opts.contentBand;
  var chromeBand = opts.chromeBand;

  var nodes = canvas.querySelectorAll("*");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (skipTag(el)) continue;
    if (inSubtree(el, captionSelector)) continue;
    if (!hasDirectText(el)) continue;
    if (!isVisible(el)) continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    examined++;
    var rect = {
      left: (r.left - canvasRect.left) / sx,
      top: (r.top - canvasRect.top) / sy,
      right: (r.right - canvasRect.left) / sx,
      bottom: (r.bottom - canvasRect.top) / sy
    };
    var isChrome = inSubtree(el, chromeSelector);
    var band = isChrome ? chromeBand : contentBand;
    var over = outOfBandPx(rect, band, tolerancePx);
    var edges = [];
    if (over.left > 0) edges.push("左 " + pxText(over.left) + "px");
    if (over.right > 0) edges.push("右 " + pxText(over.right) + "px");
    if (over.top > 0) edges.push("上 " + pxText(over.top) + "px");
    if (over.bottom > 0) edges.push("下 " + pxText(over.bottom) + "px");
    if (edges.length === 0) continue;
    var where = isChrome ? "chrome 带" : "内容带";
    var hint = isChrome ? "" : "；若为 chrome 带元素请加 data-safe-band=\"chrome\"";
    findings.push({
      rule: "文字安全边距",
      severity: "warning",
      location: describe(el),
      message:
        "文本元素越出" + where + "（" + edges.join("、") + "，画布 " + size.width + "×" + size.height + "）" +
        "——§12b V1 安全框：内容元素左右 ≥" + contentBand.left + "px、顶 ≥" + contentBand.top +
        "px、底 ≤" + contentBand.bottom + "px；chrome 带元素水平 ≥" + chromeBand.left + "px。" +
        "贴边文字在平台常驻 UI / 裁切下会丢" + hint,
    });
  }

  return { findings: findings, examined: examined };
}`;

// ── #18 对比度收集器 ──

/** #18 收集器参数（`CONTRAST_ARGS` 产出）。 */
export interface ContrastArgs {
  canvasSelector: string;
  captionSelector: string;
  /** 大字档下限（px）：本主题最小字号 --t-label 24px（§12b V4）→ ≥24 视作 WCAG 大字 */
  largePx: number;
  /** 大字底线 */
  largeRatio: number;
  /** 小字底线 */
  smallRatio: number;
}

/**
 * #18 的阈值与采样参数。`largePx = 24` 对齐 §12b V4 的最小字号（--t-label: 24px = WCAG 18pt
 * 的"大字"门槛）；底线 3:1 / 4.5:1 是 WCAG AA。数值改动要同时改本注释与 §11.1 #18。
 */
export const CONTRAST_ARGS: ContrastArgs = {
  canvasSelector: STAGE_SELECTOR,
  captionSelector: CAPTION_LAYER_SELECTOR,
  largePx: 24,
  largeRatio: 3,
  smallRatio: 4.5,
};

/**
 * 页面侧收集器（#18）：文字色 vs **有效背景**的对比度 → 低于底线 warning，量化实际比值。
 *
 * 背景取法（本仓实测定下的口径，别改成"先隐藏自身再 hit-test"）：
 *   ① **元素自身 `backgroundColor`（α>0）优先**——本仓大量组件自绘底色（badge/pill/marker/
 *      card/表头/Kicker/PostIt/MarkerBlock invert 墨底）。先隐藏自身再 hit-test 会让比值
 *      系统性偏乐观（实测 5.25:1 被算成 7.185:1，偏 37%），或把深底浅字卡判成"浅底浅字"的假 warning；
 *   ② 仅当自身透明（或半透明未收敛）才隐藏自身 + `elementFromPoint`，再沿**命中的祖先链**逐层合成；
 *   ③ 背景为 img/canvas/video / 渐变 / background-image / 祖先链不收敛 → **info**（不可判定）并计数。
 * `args = ContrastArgs` → `{ findings, examined }`。
 */
export const COLLECT_CONTRAST_SRC =
  String.raw`function (args) {` +
  TEXT_SURFACE_SRC +
  CONTRAST_RATIO_DEFS +
  String.raw`
  var opts = args || {};
  var canvasSelector =
    typeof opts.canvasSelector === "string" && opts.canvasSelector !== ""
      ? opts.canvasSelector
      : '[data-testid="stage-frame"]';
  var captionSelector =
    typeof opts.captionSelector === "string" ? opts.captionSelector : ".caption-layer";
  var largePx = typeof opts.largePx === "number" ? opts.largePx : 24;
  var largeRatio = typeof opts.largeRatio === "number" ? opts.largeRatio : 3;
  var smallRatio = typeof opts.smallRatio === "number" ? opts.smallRatio : 4.5;
  var findings = [];
  var examined = 0;

  function push(severity, location, message) {
    findings.push({ rule: "对比度", severity: severity, location: location, message: message });
  }

  function pushInfo(location, message) {
    push("info", location, message);
  }

  function inSubtree(el, selector) {
    if (selector === "") return false;
    if (typeof el.closest !== "function") return false;
    return el.closest(selector) !== null;
  }

  function rgbText(c) {
    return "rgb(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + ")";
  }

  function parseColor(v) {
    var m = /^rgba?\(([^)]+)\)$/.exec(String(v === null || v === undefined ? "" : v));
    if (!m) return null;
    var parts = m[1].split(",");
    if (parts.length < 3) return null;
    var r = parseFloat(parts[0]);
    var g = parseFloat(parts[1]);
    var b = parseFloat(parts[2]);
    var a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    if (isNaN(a)) a = 1;
    return { r: r, g: g, b: b, a: a };
  }

  function isPixelLayer(el) {
    var tag = el.tagName;
    return tag === "IMG" || tag === "CANVAS" || tag === "VIDEO";
  }

  // 层层合成（**保留 α**）：contrastRatio 里的 composite 是"前景压在**不透明**背景上"
  // （结果 α 恒 1），拿它当累加器会把半透明背景悄悄当成不透明——那样"背景不收敛 → info"
  // 这条判据永远走不到，且会把 rgba(255,255,255,.5) 硬算成纯白。
  function over(acc, c) {
    var ca = typeof c.a === "number" ? c.a : 1;
    var aa = typeof acc.a === "number" ? acc.a : 0;
    var outA = aa + ca * (1 - aa);
    if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (acc.r * aa + c.r * ca * (1 - aa)) / outA,
      g: (acc.g * aa + c.g * ca * (1 - aa)) / outA,
      b: (acc.b * aa + c.b * ca * (1 - aa)) / outA,
      a: outA
    };
  }

  // 文本的**字形盒**中心（不是元素盒中心：全宽容器里的文字靠左时，元素盒中心会落在文字之外）
  function textPoint(el) {
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType !== 3 || n.nodeValue === null) continue;
      if (n.nodeValue.replace(/\s+/g, "") === "") continue;
      var range = document.createRange();
      range.selectNodeContents(n);
      var tr = range.getBoundingClientRect();
      if (tr.width > 0 || tr.height > 0) {
        return { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
      }
    }
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function hitBehind(el, pt) {
    var prev = el.style.visibility;
    el.style.visibility = "hidden";
    var hit = null;
    try {
      hit = document.elementFromPoint(pt.x, pt.y);
    } finally {
      el.style.visibility = prev;
    }
    return hit;
  }

  // 有效背景：自身底色优先；transparent 才 hit-test + 祖先链逐层合成
  function backdropOf(el, pt, ownColor, ownImage) {
    if (ownImage) return { kind: "image", from: el };
    var acc = { r: 0, g: 0, b: 0, a: 0 };
    var from = null;
    if (ownColor === null) return { kind: "unknown", from: el };
    if (ownColor.a > 0) {
      acc = ownColor;
      from = el;
      if (acc.a >= 1) return { kind: "color", color: acc, from: el };
    }
    var hit = hitBehind(el, pt);
    var node = hit;
    if (!node || node === el) node = el.parentElement;
    else if (el.contains && el.contains(node)) node = el.parentElement;
    while (node && node.nodeType === 1) {
      if (isPixelLayer(node)) return { kind: "image", from: node };
      var st = getComputedStyle(node);
      if (st.backgroundImage !== "none") return { kind: "image", from: node };
      var c = parseColor(st.backgroundColor);
      if (c === null) return { kind: "unknown", from: node };
      if (c.a > 0) {
        acc = over(acc, c);
        from = node;
        if (acc.a >= 1) return { kind: "color", color: acc, from: node };
      }
      node = node.parentElement;
    }
    if (acc.a > 0) return { kind: "partial", color: acc, from: from };
    return { kind: "unknown", from: from };
  }

  var canvas = document.querySelector(canvasSelector);
  if (!canvas) {
    push(
      "blocker",
      canvasSelector,
      "未找到画布根（" + canvasSelector + "）——收集器没有可检查的面（非空护栏）：" +
        "页面未挂载、?render=1 下 Stage 未渲染，或选择器与页面结构失配"
    );
    return { findings: findings, examined: examined };
  }

  var nodes = canvas.querySelectorAll("*");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (skipTag(el)) continue;
    if (inSubtree(el, captionSelector)) continue;
    if (!hasDirectText(el)) continue;
    if (!isVisible(el)) continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    examined++;
    var st = getComputedStyle(el);
    var where = describe(el);
    var ownImage = st.backgroundImage !== "none";
    var bg = backdropOf(el, textPoint(el), parseColor(st.backgroundColor), ownImage);
    if (bg.kind === "image") {
      pushInfo(
        where,
        "文字背景命中图片/画布/渐变（" + describe(bg.from) + "）——像素内容不可由色值判定，" +
          "跳过对比度计算（#18 info 档，计入 info 条数）"
      );
      continue;
    }
    if (bg.kind !== "color") {
      pushInfo(
        where,
        "文字背景不收敛（祖先链上没有不透明底色；" + describe(bg.from) + "）——不可判定，" +
          "跳过对比度计算（#18 info 档，计入 info 条数）"
      );
      continue;
    }
    var fg = parseColor(st.color);
    if (fg === null) {
      pushInfo(where, "文字色无法解析（" + st.color + "）——不可判定，跳过对比度计算（#18 info 档）");
      continue;
    }
    var ratio = contrastRatio(fg, bg.color);
    var fontPx = parseFloat(st.fontSize);
    if (isNaN(fontPx)) fontPx = 0;
    var isLarge = fontPx >= largePx;
    var need = isLarge ? largeRatio : smallRatio;
    if (ratio >= need) continue;
    push(
      "warning",
      where,
      "文字对比度 " + String(Math.round(ratio * 100) / 100) + ":1 低于" +
        (isLarge ? "大字" : "小字") + "底线 " + need + ":1（前景 " + rgbText(fg) + " / 背景 " +
        rgbText(bg.color) + "，字号 " + fontPx + "px，大字档 ≥" + largePx + "px）" +
        "——§11.1 #18：低对比文字在投影/录屏/移动端读不出"
    );
  }

  return { findings: findings, examined: examined };
}`;

// ── #14 字体加载收集器 ──

/** #14 收集器的返回：比通用面多两张家族清单（报告要贴"loaded / used"两张清单）。 */
export interface FontsCollectorResult extends CollectorResult {
  /** `document.fonts` 的**全部** FontFace 条数（噪音面：同一家族的子集/字重各算一条） */
  fontFaceCount: number;
  /** 去重后的家族数（不过滤 status 时的那张脸） */
  familyCount: number;
  /** `status === "loaded"` 的家族（去重、保序）——判据的"加载面" */
  loadedFamilies: string[];
  /** 渲染文本 computed font-family 里出现过的家族（去重、保序）——判据的"使用面" */
  usedFamilies: string[];
}

/**
 * 页面侧收集器（#14 无头半边）：`document.fonts` 里 **`status === "loaded"`** 的家族必须被
 * 渲染文本实际用到（`loaded ⊄ used` → blocker 带家族名清单）。
 *
 * 三处口径（都是实测定的，不是推理）：
 *   · **必须按 `status === "loaded"` 过滤**：实测 317 条 FontFace / 去重 5 家族 / 按 loaded
 *     过滤只剩 1——不过滤 status 等于拿"声明面"比"声明面"（左右同源的同义反复，抓不到原版 #8）；
 *   · **使用面 = 整页渲染文本**（不是画布子树、也不排除字幕）：`document.fonts` 是**文档级**
 *     事实源，采样面必须与它同域——否则框架层 chrome / 字幕消费的字体加载会被判成
 *     "加载了没人用"的假 blocker；
 *   · **`examined` = 用了主题字体（loaded 家族）的文本元素数**：全 deck 无主题字体文本
 *     （示例章节正文走 UA 默认字体）→ `examined === 0` → **info**（不是 blocker）——
 *     这不是缺陷态，是"没有可判定的使用面"。
 * `args = { rootSelector?: string }` → `FontsCollectorResult`。
 */
export const COLLECT_FONTS_SRC =
  String.raw`function (args) {` +
  TEXT_SURFACE_SRC +
  FAMILY_DIFF_DEFS +
  String.raw`
  var opts = args || {};
  var rootSelector =
    typeof opts.rootSelector === "string" && opts.rootSelector !== "" ? opts.rootSelector : "body";
  var findings = [];
  var examined = 0;

  function push(severity, location, message) {
    findings.push({ rule: "字体加载", severity: severity, location: location, message: message });
  }

  var faces = [];
  if (document.fonts && typeof document.fonts.forEach === "function") {
    document.fonts.forEach(function (f) {
      faces.push(f);
    });
  }
  var familyKeys = [];
  var loaded = [];
  var loadedKeys = [];
  for (var i = 0; i < faces.length; i++) {
    var face = faces[i];
    if (!face) continue;
    var fam = cleanFamily(face.family);
    if (fam === "") continue;
    var key = fam.toLowerCase();
    if (familyKeys.indexOf(key) === -1) familyKeys.push(key);
    if (face.status !== "loaded") continue;
    if (loadedKeys.indexOf(key) === -1) {
      loadedKeys.push(key);
      loaded.push(fam);
    }
  }

  var root = document.querySelector(rootSelector) || document.body || document.documentElement;
  var nodes = root ? root.querySelectorAll("*") : [];
  var used = [];
  var usedKeys = [];
  for (var j = 0; j < nodes.length; j++) {
    var el = nodes[j];
    if (skipTag(el)) continue;
    if (!hasDirectText(el)) continue;
    if (!isVisible(el)) continue;
    var fams = splitFamilies(getComputedStyle(el).fontFamily);
    var usesTheme = false;
    for (var k = 0; k < fams.length; k++) {
      var fk = fams[k].toLowerCase();
      if (usedKeys.indexOf(fk) === -1) {
        usedKeys.push(fk);
        used.push(fams[k]);
      }
      if (loadedKeys.indexOf(fk) !== -1) usesTheme = true;
    }
    if (usesTheme) examined++;
  }

  if (examined === 0) {
    push(
      "info",
      "document.fonts",
      "全 deck 无主题字体文本（status === \"loaded\" 的家族 " + loaded.length + " 个：" +
        (loaded.length === 0 ? "无" : loaded.join("、")) + "）——渲染文本全走系统/UA 字体，" +
        "#14 的\"加载面 ⊆ 使用面\"没有可判定的使用面（info 而非 blocker：这不是缺陷态，是读数为零）"
    );
  } else {
    var missing = diffFamilies(loaded, used);
    if (missing.length > 0) {
      push(
        "blocker",
        "document.fonts",
        "字体已加载但全 deck 无文本使用：" + missing.join("、") + "——status === \"loaded\" 的家族" +
          "必须被渲染文本实际用到（否则主题声明、字体加载面与真实排版已经漂移）；" +
          "已加载 " + loaded.length + " 个：" + loaded.join("、")
      );
    }
  }

  return {
    findings: findings,
    examined: examined,
    fontFaceCount: faces.length,
    familyCount: familyKeys.length,
    loadedFamilies: loaded,
    usedFamilies: used
  };
}`;

// ── Node 侧：同一份文本取出的纯判据实现（浏览器侧与这里跑的是同一文本） ──

const contrastRatioImpl = fromSrc<(fg: Rgb, bg: Rgb) => number>(
  wrapJudge(CONTRAST_RATIO_DEFS, "contrastRatio"),
);
const outOfBandImpl = fromSrc<(rect: Rect, band: Band, tolerancePx: number) => EdgeOverage>(
  wrapJudge(OUT_OF_BAND_DEFS, "outOfBandPx"),
);
const diffFamiliesImpl = fromSrc<(loaded: readonly string[], used: readonly string[]) => string[]>(
  wrapJudge(FAMILY_DIFF_DEFS, "diffFamilies"),
);

/** 相对亮度比（WCAG 2.x；半透明前景先与背景合成）。浏览器侧跑的是同一份源码文本。 */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  return contrastRatioImpl(fg, bg);
}

/** 四边越界量（0 = 带内；`> tolerancePx` 才算越界，报原始量）。浏览器侧跑的是同一份源码文本。 */
export function outOfBandPx(
  rect: Rect,
  band: Band,
  tolerancePx: number = SAFE_MARGIN_TOLERANCE_PX,
): EdgeOverage {
  return outOfBandImpl(rect, band, tolerancePx);
}

/** `loaded ⊄ used` 的差集（家族名不区分大小写/引号；保序去重）。浏览器侧跑的是同一份源码文本。 */
export function diffFamilies(loaded: readonly string[], used: readonly string[]): string[] {
  return diffFamiliesImpl(loaded, used);
}

// ── 安全带的构造（数字单一源：src/engine/safe-area.ts；本文件只做坐标换算） ──

/**
 * 安全带 → 画布 px 四缘。`kind = "content"` 用 content/top/contentBottom；
 * `kind = "chrome"` 用 chrome（左右），**垂直不设限**——chrome（topbar/页眉）本来就住在内容带
 * 之上（V1 只规定"chrome 元素水平 ≥64px"），给它垂直约束会把 topbar 自己判成越界。
 */
export function safeBand(safeArea: SafeAreaLike, dims: Size, kind: "content" | "chrome"): Band {
  if (kind === "chrome") {
    return {
      left: safeArea.chrome,
      right: dims.width - safeArea.chrome,
      top: 0,
      bottom: dims.height,
    };
  }
  return {
    left: safeArea.content,
    right: dims.width - safeArea.content,
    top: safeArea.top,
    bottom: safeArea.contentBottom,
  };
}

/** #20 的收集器参数（headless.ts 调用；`chromeSelector` 在这里显式落地——不是可选项）。 */
export function safeMarginArgs(safeArea: SafeAreaLike, dims: Size): SafeMarginArgs {
  return {
    canvasSelector: STAGE_SELECTOR,
    captionSelector: CAPTION_LAYER_SELECTOR,
    chromeSelector: CHROME_BAND_SELECTOR,
    canvasSize: { width: dims.width, height: dims.height },
    contentBand: safeBand(safeArea, dims, "content"),
    chromeBand: safeBand(safeArea, dims, "chrome"),
    tolerancePx: SAFE_MARGIN_TOLERANCE_PX,
  };
}
