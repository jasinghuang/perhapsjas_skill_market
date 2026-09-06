/**
 * scanner-tsx：章节层 TSX/AST 扫描器（M3a 静态门禁，§11.1）。
 *
 * 规则（Finding.rule → severity，全部 blocker）：
 *   禁硬编码色   blocker  #2      style 属性（对象/字符串/模板串）内 hex/rgb()/hsl()/命名色裸值；
 *                                white/black 豁免（命名 + hex 形式）、var(--x)/url() 豁免
 *   SVG属性色值  blocker  #2      fill=/stroke= 属性（JSX 属性或表达式内字符串）裸色值；
 *                                none/white/black 豁免、var(--x) 豁免
 *   确定性黑名单 blocker  #7      setTimeout/setInterval/Math.random/Date.now/performance.now/
 *                                requestAnimationFrame/new Date() 调用——engine/ 与 components/
 *                                目录路径豁免（引擎虚拟时钟/SeededRandom 层合法）
 *   无限循环动画 blocker  #8      iterations: Infinity / -1 / -Infinity 字面量（WAAPI 负 iterations = 无限）
 *   禁裸缓动     blocker  终审    字符串/模板串内 cubic-bezier( 裸值（须走 var(--ease-*) token）——
 *                                components/ 目录豁免（组件层 contract-lint 已管 token 纯度）
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

// ── 目录豁免 ──

function hasDirSegment(path: string, dir: string): boolean {
  return path.replace(/\\/g, "/").split("/").includes(dir);
}

// ── 色值判定（与 scanner-css / contract-lint 同型正则） ──

const WHITE_BLACK_HEX_RE = /#(?:fff|ffffff|000|000000)\b/gi; // white/black 豁免（hex 形式）
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RGB_RE = /rgba?\(/;
const HSL_RE = /hsla?\(/;
// white/black 豁免（§11.1 #2）；transparent 按设计稿同样禁止；
// (?<!-) 防 --purple-* 类 token 引用误报（与 scanner-css 同型）。
const NAMED_COLOR_RE =
  /(?<!-)\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|tomato|gold|silver|transparent)\b/;
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
  if (ts.isNewExpression(node)) {
    return name === "Date" || name.endsWith(".Date") ? "new Date()" : undefined;
  }
  if (BLACKLIST_PLAIN.has(name)) return name;
  if (BLACKLIST_DOTTED.has(name)) return name;
  // window.setTimeout / globalThis.requestAnimationFrame 等别名
  const bare = name.slice(name.lastIndexOf(".") + 1);
  return BLACKLIST_PLAIN.has(bare) ? name : undefined;
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
  exemptDeterminism: boolean; // engine/ 或 components/ 目录
  exemptEasing: boolean; // components/ 目录
}

function pushFinding(ctx: ScanCtx, rule: string, node: ts.Node, message: string): void {
  const line = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf)).line + 1;
  const key = `${rule}|${line}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  ctx.findings.push({ rule, severity: "blocker", location: `${ctx.path}:${line}`, message });
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

/** style 对象逐属性值查色（嵌套对象递归；动态表达式/数字/布尔跳过）。 */
function checkStyleObject(ctx: ScanCtx, obj: ts.ObjectLiteralExpression): void {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const v = p.initializer;
    if (isStringish(v)) {
      for (const text of literalTexts(v)) {
        if (containsBareColor(text)) {
          pushFinding(ctx, "禁硬编码色", v, "inline style 裸色值（须走 var(--*) token，white/black 豁免）");
        }
      }
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

// ── 遍历 ──

function walk(ctx: ScanCtx, node: ts.Node): void {
  if (ts.isJsxAttribute(node)) {
    const name = node.name.getText(ctx.sf);
    if (name === "style") checkStyleAttribute(ctx, node);
    else if (name === "fill" || name === "stroke") checkSvgColorAttribute(ctx, node, name);
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

/** 建 TSX SourceFile；parseDiagnostics 非空即 throw（坏语法文件无法 AST 扫描，宁炸不假绿）。 */
function parseSource(path: string, source: string): ts.SourceFile {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // TS 5.x 内部属性（类型未公开，防御式读取）；TS 6 移除后需换 program.getSyntacticDiagnostics
  const diags =
    (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
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
      exemptDeterminism: hasDirSegment(path, "engine") || hasDirSegment(path, "components"),
      exemptEasing: hasDirSegment(path, "components"),
    };
    walk(ctx, sf);
  }
  return findings;
}
