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
 *   textStyle.color     = --text（默认文字墨色——饼图 label 等未显式设色文本
 *     吃全局默认，真渲染实测 echarts 默认 #333 穿透）
 *   categoryAxis / valueAxis（P45T4-fix：轴主题必须嵌套轴类型键——echarts 轴模型
 *     只读 theme[axisType + "Axis"]，顶层 axisLine/splitLine 是死键，真渲染
 *     会静默穿透 echarts 默认色）：
 *     axisLine.lineStyle  = --rule（墨）
 *     axisTick.lineStyle  = --rule（墨）
 *     axisLabel.color     = --text-mute（与 S21 手绘轴刻度同色语言）
 *     splitLine.lineStyle = --surface-2
 *   legend.textStyle    = --text-2
 *   itemStyle.borderRadius = 0（主题零圆角语言）
 *   radar（P4.5-radar：雷达网格同源——真渲染实测 radar 默认 splitLine #E0E6F1 /
 *     灰蓝 splitArea 带穿透，与 P45T4 同类死键问题）：
 *     axisLine.lineStyle   = --rule（墨辐条）
 *     axisName.color/textStyle.color = --text-mute（指标名）
 *     splitLine.lineStyle  = --surface-2（环线与 valueAxis 同色语言）
 *     splitArea.show = false（交替色带关闭——cream 底直接透出）
 *   pie.label.color = --text（扇区标签墨色——attached 文本不读全局 textStyle，
 *     真渲染实测 echarts 默认 #333 穿透）
 *
 * 解析顺序：剥离 /* *​/ 注释（防注释内色值污染）→ 收集 --name: value 映射 →
 * var() 间接引用递归解包（循环/缺失/过深 → throw）。
 */

/** 轴主题段（categoryAxis / valueAxis 共用结构）。 */
export interface EChartsAxisTheme {
  axisLine: { lineStyle: { color: string } };
  axisTick: { lineStyle: { color: string } };
  axisLabel: { color: string };
  splitLine: { lineStyle: { color: string } };
}

/** 雷达主题段（P4.5-radar：radar 模型只读 theme.radar——轴段嵌套是同一机制）。 */
export interface EChartsRadarTheme {
  axisLine: { lineStyle: { color: string } };
  axisName: { color: string; textStyle: { color: string } };
  splitLine: { lineStyle: { color: string } };
  splitArea: { show: boolean };
}

export interface EChartsTheme {
  color: string[];
  backgroundColor: string;
  textStyle: { fontFamily: string; color: string };
  categoryAxis: EChartsAxisTheme;
  valueAxis: EChartsAxisTheme;
  legend: { textStyle: { color: string } };
  itemStyle: { borderRadius: number };
  radar: EChartsRadarTheme;
  pie: { label: { color: string } };
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
  // P45T4-fix：轴主题嵌套 categoryAxis/valueAxis（echarts 轴模型只读
  // theme[axisType + "Axis"]——axisModelCreator mergeDefaultAndTheme 实测）
  const axisTheme = (): EChartsAxisTheme => ({
    axisLine: { lineStyle: { color: token("--rule") } },
    axisTick: { lineStyle: { color: token("--rule") } },
    axisLabel: { color: token("--text-mute") },
    splitLine: { lineStyle: { color: token("--surface-2") } },
  });
  return {
    color: [
      token("--accent-1"),
      token("--accent-2"),
      token("--accent-3"),
      token("--accent-4"),
    ],
    backgroundColor: "transparent",
    textStyle: {
      fontFamily: stripQuotes(token("--font-body")),
      color: token("--text"),
    },
    categoryAxis: axisTheme(),
    valueAxis: axisTheme(),
    legend: { textStyle: { color: token("--text-2") } },
    itemStyle: { borderRadius: 0 },
    radar: {
      axisLine: { lineStyle: { color: token("--rule") } },
      axisName: {
        color: token("--text-mute"),
        textStyle: { color: token("--text-mute") },
      },
      splitLine: { lineStyle: { color: token("--surface-2") } },
      splitArea: { show: false },
    },
    pie: { label: { color: token("--text") } },
  };
}
