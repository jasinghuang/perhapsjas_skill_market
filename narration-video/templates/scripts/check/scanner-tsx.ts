/**
 * scanner-tsx：章节层 TSX/AST 扫描器（M3a 静态门禁，§11.1）。
 *
 * 规则（Finding.rule → severity）：
 *   禁硬编码色   blocker  #2      style 属性（对象/字符串/模板串）内 hex/rgb()/hsl()/命名色裸值
 *                                （全量 CSS 命名色表，终审 M-1）；white/black 豁免（命名 + hex 形式）、
 *                                var(--x)/url() 豁免
 *   SVG属性色值  blocker  #2      fill=/stroke= 属性（JSX 属性或表达式内字符串）裸色值；
 *                                none/white/black 豁免、var(--x) 豁免
 *   禁硬编码字体 blocker  #3      style 对象 fontFamily / SVG fontFamily=/font-family= 属性
 *                                裸字体（终审 I-2；var(--font-*) 豁免）
 *   禁裸动画时长 blocker  #4      style 对象 transition/animation（含 *Duration 变体）值内
 *                                含 ms/s（终审 I-2；var() 豁免）
 *   最小字号     warning  V4      style 对象 fontSize / SVG fontSize=/font-size= 裸 px <24
 *                                （终审 I-2）
 *   字阶成员     warning  #5      style 对象 fontSize / SVG fontSize=/font-size= 裸 px ∉
 *                                tokens.css 字阶集合（终审 I-2）
 *   确定性黑名单 blocker  #7      setTimeout/setInterval/Math.random/Date.now/performance.now/
 *                                requestAnimationFrame/new Date() 调用——engine/ 目录豁免
 *                                （P4-7：组件同为库代码不豁免，同样要确定性）
 *   无限循环动画 blocker  #8      iterations: Infinity / -1 / -Infinity 字面量（WAAPI 负 iterations = 无限）
 *   禁裸缓动     blocker  终审    字符串/模板串内 cubic-bezier( 裸值（须走 var(--ease-*) token）——
 *                                engine/ 与 components/ 目录豁免（P4-7）
 *   ECharts option 裸色/裸字体 blocker P4.5-T3 <EChart option={{...}}> 对象字面量内 color:/textStyle.fontFamily
 *                                裸值（hex/rgb/命名色、非 var(--font-*) 字体串——white/black 豁免口径同 #2，
 *                                数组色板与嵌套 itemStyle/textStyle 一并遍历）；components/ 目录豁免
 *                                （组件库代码，showcase 消费 EChart）
 *
 * 实现取舍（任务要求报告）：typescript compiler API AST 遍历，非正则。理由：
 *   1. 属性名精确匹配——fillOpacity/strokeWidth 等前缀属性零误报，正则做不到（startsWith 必炸）；
 *   2. CallExpression 结构匹配——window.setTimeout/globalThis.requestAnimationFrame 等别名零漏检，
 *      字符串字面量 "setTimeout"（stubGlobal 参数）零误报；注释天然不进 AST（剥离状态机都不需要）；
 *   3. 语法错误可检测——parseDiagnostics 非空即 throw（宁炸不假绿，终审 C1 教训）。
 * 代价：坏语法文件整文件抛错（无法局部扫描）；跨行/拼接色值模板串按静态段判（静态段无完整色值即豁免）。
 *
 * 纯 TS、无 DOM 依赖——tsx（node）与 vitest 双环境消费。
 */

import ts from "typescript";
import type { Finding } from "./findings";
import { NAMED_COLOR_RE } from "./named-colors";
import { MIN_FONT_PX, TYPE_SCALE, TYPE_SCALE_LABEL } from "./token-scale";

// ── 目录豁免 ──

/**
 * 豁免锚定（评审 Finding 2）：最后一个 `src` 段之后的下一段必须是 dir（相对路径契约
 * src/<dir>/... 才豁免）。全路径任意段 includes 会把祖辈路径段叫 engine/components 的
 * 任意文件（scaffold 到用户目录后）静默豁免全项目——锚定后 /home/user/engine/x.tsx、
 * src/chapters/engine-foo/x.tsx 均不豁免。
 */
function isSrcSubdir(path: string, dir: string): boolean {
  const segs = path.replace(/\\/g, "/").split("/");
  const srcIdx = segs.lastIndexOf("src");
  return srcIdx >= 0 && segs[srcIdx + 1] === dir;
}

// ── 色值判定（与 scanner-css / contract-lint 同型正则） ──

const WHITE_BLACK_HEX_RE = /#(?:fff|ffffff|000|000000)\b/gi; // white/black 豁免（hex 形式）
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RGB_RE = /rgba?\(/;
const HSL_RE = /hsla?\(/;
// 全量命名色表见 named-colors（终审 M-1）：white/black 豁免在表外，transparent 禁止。
const VAR_OR_URL_RE = /(?:var|url)\([^)]*\)/g; // 剥离 var()/url() 段——token 化与资源名豁免

function containsBareColor(text: string): boolean {
  const stripped = text.replace(VAR_OR_URL_RE, "").replace(WHITE_BLACK_HEX_RE, "");
  return (
    HEX_RE.test(stripped) ||
    RGB_RE.test(stripped) ||
    HSL_RE.test(stripped) ||
    NAMED_COLOR_RE.test(stripped)
  );
}

// ── 字体 / 字号 / 动画时长（终审 I-2：inline style 对象与 SVG 属性共用） ──

const FONT_FAMILY_KEYS = new Set(["fontFamily", "font-family"]);
const FONT_SIZE_KEYS = new Set(["fontSize", "font-size"]);
const DURATION_KEYS = new Set(["transition", "animation", "transitionDuration", "animationDuration"]);

// 时长值判定：(?<![\w.-]) 防 "spin2s" / "fade-2s" 类名称内数字+单位误报（与 scanner-css 同型）
const BARE_TIME_RE = /(?<![\w.-])[\d.]+(?:ms|s)\b/;

/** fontFamily/font-family 裸字体判定：token 化（var(--font-*)）豁免，其余字面量报 blocker。 */
function isBareFontFamily(text: string): boolean {
  const t = text.trim();
  return t !== "" && !t.startsWith("var(");
}

/** fontSize 裸 px 解析："18" / "18px" → 18；"var(...)"/em/rem/calc 等 → undefined（不查）。 */
function pxFontSize(text: string): number | undefined {
  const t = text.trim();
  if (t.includes("var(")) return undefined;
  const px = /^([\d.]+)px$/.exec(t);
  if (px !== null) return parseFloat(px[1]);
  return /^[\d.]+$/.test(t) ? parseFloat(t) : undefined;
}

/** fontSize 字阶维度：< MIN_FONT_PX → 最小字号 warning；∉ 字阶集合 → 字阶成员 warning。 */
function fontSizeFindings(ctx: ScanCtx, value: number, node: ts.Node): void {
  if (value < MIN_FONT_PX) {
    pushFinding(
      ctx,
      "最小字号",
      node,
      `字号 ${value}px 低于最小字号 ${MIN_FONT_PX}px（V4）`,
      "warning",
    );
  } else if (!TYPE_SCALE.has(value)) {
    pushFinding(ctx, "字阶成员", node, `字号 ${value}px 不在字阶集合（${TYPE_SCALE_LABEL}）`, "warning");
  }
}

// ── 缓动 / 黑名单 ──

const CUBIC_BEZIER_RE = /cubic-bezier\s*\(/;
const BLACKLIST_PLAIN = new Set(["setTimeout", "setInterval", "requestAnimationFrame"]);
const BLACKLIST_DOTTED = new Set(["Math.random", "Date.now", "performance.now"]);

/** 表达式点分全名：setTimeout / window.setTimeout / Math.random / performance.now。 */
function dottedName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const base = dottedName(node.expression);
    return base === undefined ? undefined : `${base}.${node.name.text}`;
  }
  return undefined;
}

/** 黑名单命中返回 API 名（消息用），否则 undefined。 */
function determinismHit(node: ts.CallExpression | ts.NewExpression): string | undefined {
  const name = dottedName(node.expression);
  if (name === undefined) return undefined;
  const parts = name.split(".");
  const bare = parts[parts.length - 1];
  if (ts.isNewExpression(node)) {
    return bare === "Date" ? "new Date()" : undefined; // new Date() / new window.Date()
  }
  // window.setTimeout / globalThis.requestAnimationFrame 等别名（末段对照）
  if (BLACKLIST_PLAIN.has(bare)) return name;
  // window.Math.random / globalThis.Date.now 等点分成员别名（评审 Finding 1：
  // 末两段对照点分集合——只测末段会让 window.Math.random 等真实浏览器别名全部逃逸）
  if (parts.length >= 2) {
    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (BLACKLIST_DOTTED.has(lastTwo)) return name;
  }
  return undefined;
}

// ── 字符串/模板串静态段 ──

type Stringish = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

function isStringish(node: ts.Node): node is Stringish {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

/** 模板串按静态段切（`` `#f${x}00` `` → ["#f", "00"]）——段内无完整色值即豁免。 */
function literalTexts(node: Stringish): string[] {
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  return [node.text];
}

// ── 扫描上下文 ──

interface ScanCtx {
  sf: ts.SourceFile;
  path: string;
  findings: Finding[];
  seen: Set<string>; // `${rule}|${line}` 去重——单行同规则最多一条（与 scanner-css 粒度一致）
  exemptDeterminism: boolean; // P4-7：仅 src/engine/（组件同为库代码不豁免）
  exemptEasing: boolean; // P4-7：src/engine/ 或 src/components/（P4.5-T3 EChart option 规则同用——组件库代码豁免）
}

function pushFinding(
  ctx: ScanCtx,
  rule: string,
  node: ts.Node,
  message: string,
  severity: "blocker" | "warning" = "blocker",
): void {
  const line = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf)).line + 1;
  const key = `${rule}|${line}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.findings.push({ rule, severity, location: `${ctx.path}:${line}`, message });
}

// ── 各规则检查 ──

/** #2 旁路：style 属性（对象/字符串/模板串）内裸色值。 */
function checkStyleAttribute(ctx: ScanCtx, attr: ts.JsxAttribute): void {
  const init = attr.initializer;
  if (init === undefined) return; // <div style />
  if (ts.isStringLiteral(init)) {
    if (containsBareColor(init.text)) {
      pushFinding(ctx, "禁硬编码色", init, "inline style 裸色值（须走 var(--*) token，white/black 豁免）");
    }
    return;
  }
  if (!ts.isJsxExpression(init) || init.expression === undefined) return;
  const expr = init.expression;
  if (isStringish(expr)) {
    for (const text of literalTexts(expr)) {
      if (containsBareColor(text)) {
        pushFinding(ctx, "禁硬编码色", expr, "inline style 裸色值（须走 var(--*) token，white/black 豁免）");
      }
    }
  } else if (ts.isObjectLiteralExpression(expr)) {
    checkStyleObject(ctx, expr);
  }
}

/** 裸字体文本检查：token 化（var(--font-*)）豁免，其余字面量 blocker（消息由调用方语境提供）。 */
function checkBareFontFamily(ctx: ScanCtx, text: string, node: ts.Node, message: string): void {
  if (isBareFontFamily(text)) pushFinding(ctx, "禁硬编码字体", node, message);
}

/** 时长文本检查：var()/url() 剥离后仍含 ms/s → blocker 禁裸动画时长（终审 I-2）。 */
function checkBareDuration(ctx: ScanCtx, text: string, node: ts.Node, message: string): void {
  const stripped = text.replace(VAR_OR_URL_RE, "");
  if (BARE_TIME_RE.test(stripped)) pushFinding(ctx, "禁裸动画时长", node, message);
}

/** 字号文本检查：裸 px 值 → 最小字号/字阶成员 warning（var() 与 em/rem 不查）。 */
function checkBareFontSize(ctx: ScanCtx, text: string, node: ts.Node): void {
  const v = pxFontSize(text);
  if (v !== undefined) fontSizeFindings(ctx, v, node);
}

/** style 对象逐属性值检查（终审 I-2：色/字体/字号/动画时长；嵌套对象递归）。 */
function checkStyleObject(ctx: ScanCtx, obj: ts.ObjectLiteralExpression): void {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";
    const v = p.initializer;
    if (isStringish(v)) {
      for (const text of literalTexts(v)) {
        if (containsBareColor(text)) {
          pushFinding(ctx, "禁硬编码色", v, "inline style 裸色值（须走 var(--*) token，white/black 豁免）");
        }
        if (FONT_FAMILY_KEYS.has(key)) {
          checkBareFontFamily(ctx, text, v, "inline style 裸 font-family（须走 var(--font-*)）");
        }
        if (DURATION_KEYS.has(key)) {
          checkBareDuration(ctx, text, v, "inline style 裸动画时长（须走 var(--dur-*)）");
        }
        if (FONT_SIZE_KEYS.has(key)) checkBareFontSize(ctx, text, v);
      }
    } else if (ts.isNumericLiteral(v) && FONT_SIZE_KEYS.has(key)) {
      fontSizeFindings(ctx, parseFloat(v.text), v);
    } else if (ts.isObjectLiteralExpression(v)) {
      checkStyleObject(ctx, v);
    }
  }
}

/** #2 旁路：fill=/stroke= 属性裸色值（none/white/black/var() 豁免）。 */
function checkSvgColorAttribute(ctx: ScanCtx, attr: ts.JsxAttribute, attrName: string): void {
  const init = attr.initializer;
  if (init === undefined) return;
  if (ts.isStringLiteral(init)) {
    checkSvgColorText(ctx, init.text, init, attrName);
    return;
  }
  if (!ts.isJsxExpression(init) || init.expression === undefined) return;
  const expr = init.expression;
  if (isStringish(expr)) {
    for (const text of literalTexts(expr)) checkSvgColorText(ctx, text, expr, attrName);
  }
}

function checkSvgColorText(ctx: ScanCtx, text: string, node: ts.Node, attrName: string): void {
  if (text.trim() === "none") return; // fill="none" 豁免
  if (containsBareColor(text)) {
    pushFinding(ctx, "SVG属性色值", node, `${attrName} 裸色值（须走 var(--*) token；none/white/black 豁免）`);
  }
}

/** #3 旁路（终审 I-2）：SVG fontFamily=/font-family= 属性裸字体（var(--font-*) 豁免）。 */
function checkSvgFontFamilyAttribute(ctx: ScanCtx, attr: ts.JsxAttribute): void {
  const init = attr.initializer;
  if (init === undefined) return;
  if (ts.isStringLiteral(init)) {
    checkBareFontFamily(ctx, init.text, init, "SVG fontFamily 裸字体（须走 var(--font-*)）");
    return;
  }
  if (!ts.isJsxExpression(init) || init.expression === undefined) return;
  const expr = init.expression;
  if (isStringish(expr)) {
    for (const text of literalTexts(expr)) {
      checkBareFontFamily(ctx, text, expr, "SVG fontFamily 裸字体（须走 var(--font-*)）");
    }
  }
}

/** 字号维度旁路（终审 I-2）：SVG fontSize=/font-size= 属性（字符串/数字表达式）。 */
function checkSvgFontSizeAttribute(ctx: ScanCtx, attr: ts.JsxAttribute): void {
  const init = attr.initializer;
  if (init === undefined) return;
  if (ts.isStringLiteral(init)) {
    checkBareFontSize(ctx, init.text, init);
    return;
  }
  if (!ts.isJsxExpression(init) || init.expression === undefined) return;
  const expr = init.expression;
  if (isStringish(expr)) {
    for (const text of literalTexts(expr)) checkBareFontSize(ctx, text, expr);
  } else if (ts.isNumericLiteral(expr)) {
    fontSizeFindings(ctx, parseFloat(expr.text), expr);
  }
}

// ── Plan 4.5：EChart option 裸色/裸字体 ──

/** option 内 textStyle 对象：fontFamily 裸字体（var(--font-*) 豁免）→ blocker。 */
function checkEChartTextStyle(ctx: ScanCtx, obj: ts.ObjectLiteralExpression): void {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";
    if (key !== "fontFamily") continue;
    const v = p.initializer;
    if (isStringish(v)) {
      for (const text of literalTexts(v)) {
        if (isBareFontFamily(text)) {
          pushFinding(
            ctx,
            "ECharts option 裸色/裸字体",
            v,
            "EChart option 裸 fontFamily（须走 var(--font-*)）",
          );
        }
      }
    }
  }
}

/** option 对象字面量递归：color 键裸色值（含数组色板/嵌套 itemStyle/textStyle）→ blocker。 */
function checkEChartOptionObject(ctx: ScanCtx, obj: ts.ObjectLiteralExpression): void {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "";
    const v = p.initializer;
    if (key === "color") {
      const texts: string[] = [];
      if (isStringish(v)) {
        texts.push(...literalTexts(v));
      } else if (ts.isArrayLiteralExpression(v)) {
        for (const el of v.elements) {
          if (isStringish(el)) texts.push(...literalTexts(el));
        }
      }
      for (const text of texts) {
        if (containsBareColor(text)) {
          pushFinding(
            ctx,
            "ECharts option 裸色/裸字体",
            v,
            "EChart option color 裸值（色须走注册主题，white/black 豁免）",
          );
        }
      }
    } else if (key === "textStyle" && ts.isObjectLiteralExpression(v)) {
      checkEChartTextStyle(ctx, v);
    }
    // 嵌套遍历：对象值递归（itemStyle/label 等）、数组元素为对象时递归（series/colorStops）
    if (ts.isObjectLiteralExpression(v)) {
      checkEChartOptionObject(ctx, v);
    } else if (ts.isArrayLiteralExpression(v)) {
      for (const el of v.elements) {
        if (ts.isObjectLiteralExpression(el)) checkEChartOptionObject(ctx, el);
      }
    }
  }
}

/** <EChart option={{...}}>：对象字面量 → 裸色/裸字体检查（components/ 目录豁免——与 easing 同旗标）。 */
function checkEChartOpening(ctx: ScanCtx, node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): void {
  if (!ts.isIdentifier(node.tagName) || node.tagName.text !== "EChart") return;
  for (const a of node.attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText(ctx.sf) !== "option") continue;
    const init = a.initializer;
    if (init === undefined || !ts.isJsxExpression(init) || init.expression === undefined) continue;
    if (ts.isObjectLiteralExpression(init.expression)) checkEChartOptionObject(ctx, init.expression);
  }
}

// ── 遍历 ──

function walk(ctx: ScanCtx, node: ts.Node): void {
  if (ts.isJsxAttribute(node)) {
    const name = node.name.getText(ctx.sf);
    if (name === "style") checkStyleAttribute(ctx, node);
    else if (name === "fill" || name === "stroke") checkSvgColorAttribute(ctx, node, name);
    else if (name === "fontFamily" || name === "font-family") checkSvgFontFamilyAttribute(ctx, node);
    else if (name === "fontSize" || name === "font-size") checkSvgFontSizeAttribute(ctx, node);
  } else if (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    !ctx.exemptEasing
  ) {
    checkEChartOpening(ctx, node);
  } else if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && !ctx.exemptDeterminism) {
    const hit = determinismHit(node);
    if (hit !== undefined) {
      pushFinding(
        ctx,
        "确定性黑名单",
        node,
        `${hit} 调用（章节层确定性：计时走引擎虚拟时钟、随机走 SeededRandom）`,
      );
    }
  } else if (ts.isPropertyAssignment(node) && isInfiniteIterations(node)) {
    pushFinding(ctx, "无限循环动画", node, "iterations 无限迭代（渲染确定性；氛围组件用有限周期版）");
  } else if (!ctx.exemptEasing && isStringish(node)) {
    for (const text of literalTexts(node)) {
      if (CUBIC_BEZIER_RE.test(text)) {
        pushFinding(ctx, "禁裸缓动", node, "cubic-bezier( 裸值（缓动须走 var(--ease-*) token）");
      }
    }
  }
  ts.forEachChild(node, (child) => walk(ctx, child));
}

/** #8：iterations: Infinity / iterations: -1 / -Infinity（WAAPI 负迭代 = 无限；负数字面量一并计）。 */
function isInfiniteIterations(node: ts.PropertyAssignment): boolean {
  const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
  if (name !== "iterations") return false;
  const v = node.initializer;
  if (ts.isIdentifier(v)) return v.text === "Infinity";
  return (
    ts.isPrefixUnaryExpression(v) &&
    v.operator === ts.SyntaxKind.MinusToken &&
    (ts.isNumericLiteral(v.operand) || (ts.isIdentifier(v.operand) && v.operand.text === "Infinity"))
  );
}

// ── 解析 ──

/** 建 TSX SourceFile；parseDiagnostics 缺失或非空均 throw（坏语法文件无法 AST 扫描，宁炸不假绿）。 */
function parseSource(path: string, source: string): ts.SourceFile {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // TS 5.x 内部属性（类型未公开）。缺失即 throw（评审 Minor 4）：TS 6 移除该内部属性时
  // 门禁会响亮失败而非 `?? []` 静默假绿——与门禁"宁炸不假绿"哲学一致。
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diags === undefined) {
    throw new Error(
      `scanChapterTsx：${path} 无法读取 parseDiagnostics（typescript 内部属性缺失，疑似 TS 版本不兼容）——宁炸不假绿`,
    );
  }
  if (diags.length > 0) {
    const d = diags[0];
    const where =
      d.file !== undefined && d.start !== undefined
        ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
        : path;
    throw new Error(
      `scanChapterTsx：${where} 解析失败（${ts.flattenDiagnosticMessageText(d.messageText, " ")}）`,
    );
  }
  return sf;
}

// ── 入口 ──

export function scanChapterTsx(files: Array<{ path: string; source: string }>): Finding[] {
  if (files.length === 0) {
    throw new Error("scanChapterTsx：files 数组为空（非空护栏，空输入不扫描）");
  }
  const findings: Finding[] = [];
  for (const { path, source } of files) {
    const sf = parseSource(path, source);
    const ctx: ScanCtx = {
      sf,
      path,
      findings,
      seen: new Set<string>(),
      exemptDeterminism: isSrcSubdir(path, "engine"),
      exemptEasing: isSrcSubdir(path, "engine") || isSrcSubdir(path, "components"),
    };
    walk(ctx, sf);
  }
  return findings;
}
