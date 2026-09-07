/**
 * echarts-theme：tokens.css → ECharts theme 主题生成器（Plan 4.5 收编 Task 1）。
 *
 * tokens 注入式可测（纯字符串 → theme 对象，不依赖 echarts 运行时/不读盘）。
 * 与 token-scale.ts 同哲学：解析失败/缺失 token 宁炸不假绿——主题改档时
 * 门禁自动跟随，ECharts 主题与页面 tokens 永不漂移。
 *
 * 映射契约：
 *   color               = [--accent-1, --accent-2, --accent-3, --accent-4]
 *   backgroundColor     = 'transparent'（容器背景由主题 CSS 承担）
 *   textStyle.fontFamily= --font-body（去引号）
 *   axisLine.lineStyle  = --rule（墨）
 *   splitLine.lineStyle = --surface-2
 *   legend.textStyle    = --text-2
 *   itemStyle.borderRadius = 0（主题零圆角语言）
 *
 * 解析顺序：剥离 /* *​/ 注释（防注释内色值污染）→ 收集 --name: value 映射 →
 * var() 间接引用递归解包（循环/缺失/过深 → throw）。
 */

export interface EChartsTheme {
  color: string[];
  backgroundColor: string;
  textStyle: { fontFamily: string };
  axisLine: { lineStyle: { color: string } };
  splitLine: { lineStyle: { color: string } };
  legend: { textStyle: { color: string } };
  itemStyle: { borderRadius: number };
}

/** var() 递归解包深度上限（防循环/恶意嵌套）。 */
const VAR_RESOLVE_DEPTH_LIMIT = 8;

/** 剥离 CSS 块注释——注释内色值/token 声明不得参与解析（false-positive 护栏）。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 收集 --name: value 映射。名称贪心匹配，--accent-1 不会误吞 --accent-1-dark。 */
function parseTokenMap(css: string): Map<string, string> {
  const map = new Map<string, string>();
  // value 贪心捕获到 ;/{/} 为止（字体栈含逗号、阴影含空格与括号，均不截断；
  // 不可 lazy + ;?——可选终止符会让捕获停在首字符，产出 "#" 假值）
  const re = /--([\w-]+)\s*:\s*([^;{}]+)/g;
  for (const m of css.matchAll(re)) {
    map.set(`--${m[1]}`, m[2].trim());
  }
  return map;
}

/** 解包 var() 间接引用（含单级 fallback），循环/缺失/过深 → throw。 */
function resolveToken(
  map: Map<string, string>,
  name: string,
  seen: string[],
): string {
  if (seen.length > VAR_RESOLVE_DEPTH_LIMIT) {
    throw new Error(
      `echarts-theme：var() 解析过深（${seen.join(" → ")}）——宁炸不假绿`,
    );
  }
  if (seen.includes(name)) {
    throw new Error(
      `echarts-theme：var() 循环引用（${[...seen, name].join(" → ")}）——宁炸不假绿`,
    );
  }
  const raw = map.get(name);
  if (raw === undefined) {
    throw new Error(`echarts-theme：tokens.css 缺失 ${name}——宁炸不假绿`);
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error(`echarts-theme：${name} 值为空——宁炸不假绿`);
  }
  const varMatch = value.match(/^var\((--[\w-]+)(?:,\s*([^)]*))?\)$/);
  if (!varMatch) return value;
  const ref = varMatch[1];
  if (map.has(ref)) return resolveToken(map, ref, [...seen, name]);
  const fallback = varMatch[2]?.trim();
  if (fallback !== undefined && fallback.length > 0) return fallback;
  throw new Error(
    `echarts-theme：${name} 引用的 ${ref} 缺失且无 fallback——宁炸不假绿`,
  );
}

/** 去引号（--font-body 字体栈为 ECharts 兼容的裸 font-family 串）。 */
function stripQuotes(value: string): string {
  return value.replace(/["']/g, "");
}

export function buildEchartsTheme(tokensCss: string): EChartsTheme {
  if (typeof tokensCss !== "string" || tokensCss.trim().length === 0) {
    throw new Error(
      "echarts-theme：tokensCss 为空串/非字符串——宁炸不假绿（主题必须来自真实 tokens）",
    );
  }
  const map = parseTokenMap(stripCssComments(tokensCss));
  const token = (name: string): string => resolveToken(map, name, []);
  return {
    color: [
      token("--accent-1"),
      token("--accent-2"),
      token("--accent-3"),
      token("--accent-4"),
    ],
    backgroundColor: "transparent",
    textStyle: { fontFamily: stripQuotes(token("--font-body")) },
    axisLine: { lineStyle: { color: token("--rule") } },
    splitLine: { lineStyle: { color: token("--surface-2") } },
    legend: { textStyle: { color: token("--text-2") } },
    itemStyle: { borderRadius: 0 },
  };
}
