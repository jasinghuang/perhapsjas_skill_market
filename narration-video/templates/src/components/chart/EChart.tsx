// EChart 受控组件（Plan 4.5 Task 2）：
// 生命周期：mount init（SVGRenderer + 主题 "cm"）→ setOption(option, {notMerge:true})
// → ResizeObserver resize → unmount dispose；reveal 用 motion.revealAnim 自接
// （引擎注册表 + dispose 纪律）。
//
// 主题注册模块级一次：tokens.css `?raw` 导入（Vite 浏览器侧可行，与 contract-lint
// 同模式；组件内 fs 不可用）→ buildEchartsTheme → registerTheme("cm", …)。
// tokens 改档 → ECharts 主题自动跟随（换主题零手工同步）。
//
// 动效策略（§12c ④）：ECharts 本体永远 animation: false——图表动效由引擎入场
// 动画提供（确定性/成片同源/seek 兼容），组件在 setOption 时强制覆盖。
import { useEffect, useRef } from "react";
import { init, registerTheme, use } from "echarts/core";
import type { EChartsType } from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import tokensCss from "../../theme/tokens.css?raw";
import { MotionDuration, RevealPreset, revealAnim } from "../motion";
import { buildEchartsTheme } from "./echarts-theme";

// 按需注册（模块级一次）：3 图表 + 3 组件 + SVGRenderer（Ruling P4.5-1）。
use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  SVGRenderer,
]);

// 主题注册（模块级一次）：tokens 同源——真实 tokens.css 驱动，非测试夹具。
registerTheme("cm", buildEchartsTheme(tokensCss));

export interface EChartProps {
  option: object;
  reveal?: RevealPreset;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

const THEME_NAME = "cm";

/** 非空护栏：option 必须为对象——非对象宁炸不假绿（假值会静默渲染空图）。 */
function assertOption(option: object): void {
  if (typeof option !== "object" || option === null || Array.isArray(option)) {
    const got = option === null ? "null" : Array.isArray(option) ? "array" : typeof option;
    throw new Error(`EChart：option 必须为非空对象，收到 ${got}——宁炸不假绿`);
  }
}

export function EChart({
  option,
  reveal,
  duration = "mid",
  className = "",
  ...rest
}: EChartProps) {
  assertOption(option);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  // 仅挂载时初始化：init → reveal（引擎注册表）→ ResizeObserver。
  // 卸载清理三连：reveal dispose + RO disconnect + echarts dispose。
  // option 变化走下方独立 effect（受控更新，不复初始化）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el, THEME_NAME, { renderer: "svg" });
    chartRef.current = chart;
    const handle = reveal ? revealAnim(el, reveal, duration, 0) : null;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => chart.resize());
      ro.observe(el);
    }
    return () => {
      handle?.dispose();
      ro?.disconnect();
      chartRef.current = null;
      chart.dispose();
    };
    // 挂载期一次性初始化（reveal 是入场动画，不随 option 重演）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 受控更新：option 变化 → setOption(notMerge: true)。本体动画恒 false（§12c ④），
  // 展开复制不突变调用方 option。
  useEffect(() => {
    chartRef.current?.setOption({ ...option, animation: false }, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      className={`cdp-echart ${className}`}
      data-testid={rest["data-testid"]}
    />
  );
}
