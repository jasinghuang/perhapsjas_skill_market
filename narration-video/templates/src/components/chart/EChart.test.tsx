// EChart 受控组件测试：测试面 = 生命周期与主题接线（echarts 内部由其自身测试覆盖）。
// jsdom 无 SVG 布局能力，vi.mock stub 掉 echarts 四个入口模块是标准做法
// （Plan 4.5 预检扫描 T2 自洽结论）——init 记录 renderer/theme 参数并返回
// {setOption, resize, dispose} 记录对象；use/registerTheme 可调用。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import tokensCss from "../../theme/tokens.css?raw";
import { BarChart, LineChart, PieChart, RadarChart } from "echarts/charts";
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { buildEchartsTheme, EChartsTheme } from "./echarts-theme";
import { EChart } from "./";

const echartsMock = vi.hoisted(() => {
  const instance = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
  return { init: vi.fn(), use: vi.fn(), registerTheme: vi.fn(), instance };
});

vi.mock("echarts/core", () => ({
  init: echartsMock.init,
  use: echartsMock.use,
  registerTheme: echartsMock.registerTheme,
}));
vi.mock("echarts/charts", () => ({
  BarChart: { kind: "BarChart" },
  LineChart: { kind: "LineChart" },
  PieChart: { kind: "PieChart" },
  RadarChart: { kind: "RadarChart" },
}));
vi.mock("echarts/components", () => ({
  GridComponent: { kind: "GridComponent" },
  TooltipComponent: { kind: "TooltipComponent" },
  LegendComponent: { kind: "LegendComponent" },
  RadarComponent: { kind: "RadarComponent" },
}));
vi.mock("echarts/renderers", () => ({ SVGRenderer: { kind: "SVGRenderer" } }));

// 模块级一次注册发生在 EChart 模块 import 时——快照捕获（beforeEach 的
// clearAllMocks 不能抹掉这个只发生一次的事实，快照不受清理影响）。
const themeCalls = echartsMock.registerTheme.mock.calls.map(
  (c) => ({ name: c[0] as string, theme: c[1] as EChartsTheme }),
);
const useCalls = echartsMock.use.mock.calls.map((c) => c[0] as unknown[]);

/** jsdom 无 ResizeObserver：可手动触发的 stub（记录观察目标/disconnect）。 */
class FakeResizeObserver {
  static created: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.created.push(this);
  }
  observe(el: Element) { this.observed.push(el); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  trigger() { this.callback([], this as unknown as ResizeObserver); }
}

const baseOption = {
  xAxis: { type: "category", data: ["A", "B"] },
  yAxis: { type: "value" },
  series: [{ type: "bar", data: [1, 2] }],
};

const nextOption = {
  xAxis: { type: "category", data: ["A", "B", "C"] },
  yAxis: { type: "value" },
  series: [{ type: "line", data: [3, 2, 1] }],
};

beforeEach(() => {
  setRenderMode(false);
  vi.clearAllMocks();
  echartsMock.init.mockReturnValue(echartsMock.instance);
  FakeResizeObserver.created = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  setRenderMode(false);
  vi.unstubAllGlobals();
});

describe("EChart 受控组件", () => {
  it("init 用 SVGRenderer（Ruling P4.5-1）+ 主题 \"cm\"，挂到容器元素上", () => {
    const { container } = render(<EChart option={baseOption} />);
    const el = container.querySelector(".cdp-echart");
    expect(echartsMock.init).toHaveBeenCalledTimes(1);
    expect(echartsMock.init).toHaveBeenCalledWith(el, "cm", { renderer: "svg" });
  });

  it("主题接线（模块级一次）：registerTheme 收到 tokens.css 生成的 \"cm\" 主题", () => {
    expect(themeCalls).toHaveLength(1);
    expect(themeCalls[0].name).toBe("cm");
    // 深度相等：注册进 echarts 的主题 === 主题生成器对真实 tokens.css 的输出
    expect(themeCalls[0].theme).toEqual(buildEchartsTheme(tokensCss));
  });

  it("按需注册（模块级一次）：use 传入 4 图表 + 4 组件 + SVGRenderer", () => {
    expect(useCalls).toHaveLength(1);
    const installed = useCalls[0];
    expect(installed).toHaveLength(9);
    expect(installed).toEqual(
      expect.arrayContaining([
        BarChart, LineChart, PieChart, RadarChart,
        GridComponent, TooltipComponent, LegendComponent, RadarComponent,
        SVGRenderer,
      ]),
    );
  });

  it("setOption 收到 option 且 notMerge: true", () => {
    render(<EChart option={baseOption} />);
    expect(echartsMock.instance.setOption).toHaveBeenCalledTimes(1);
    expect(echartsMock.instance.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ series: baseOption.series, xAxis: baseOption.xAxis }),
      { notMerge: true },
    );
  });

  it("option 变化 → 再 setOption（受控更新），init 只挂载一次", () => {
    const { rerender } = render(<EChart option={baseOption} />);
    rerender(<EChart option={nextOption} />);
    expect(echartsMock.init).toHaveBeenCalledTimes(1);
    expect(echartsMock.instance.setOption).toHaveBeenCalledTimes(2);
    expect(echartsMock.instance.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({ series: nextOption.series }),
      { notMerge: true },
    );
  });

  it("动效策略（§12c ④）：本体 animation 恒 false，调用方传入 true 也被覆盖且原 option 不被突变", () => {
    const callerOption = { ...baseOption, animation: true as const };
    render(<EChart option={callerOption} />);
    expect(echartsMock.instance.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ animation: false }),
      { notMerge: true },
    );
    expect(callerOption.animation).toBe(true);
  });

  // P45T2-fix（Ruling）：series 级 animation: true 会穿透全局 false——§12c ④ 被静默破坏。
  // T4 落地深度强制：setOption 收到的 series 对象 animation === false 且调用方不被突变。
  it("P45T2-fix 深度强制：series 级 animation: true 被覆盖为 false，调用方对象不被突变", () => {
    const callerOption = {
      xAxis: { type: "category", data: ["A", "B"] },
      yAxis: { type: "value" },
      series: [{ type: "bar", animation: true, data: [1, 2] }],
    };
    render(<EChart option={callerOption} />);
    const received = echartsMock.instance.setOption.mock.calls[0][0] as {
      series: Array<{ animation: boolean }>;
    };
    expect(received.series[0].animation).toBe(false);
    expect(callerOption.series[0].animation).toBe(true);
  });

  it("P45T2-fix 深度强制：animation* 前缀键（duration/easing/delay）一律 false，嵌套数组内对象同样覆盖", () => {
    const callerOption = {
      xAxis: { type: "category", data: ["A", "B"] },
      series: [
        {
          type: "bar",
          animationDuration: 500,
          animationEasing: "easeInOut",
          animationDelay: 120,
          data: [{ value: 1, animationDuration: 300 }],
        },
      ],
    };
    render(<EChart option={callerOption} />);
    const received = echartsMock.instance.setOption.mock.calls[0][0] as {
      series: Array<{
        animationDuration: boolean;
        animationEasing: boolean;
        animationDelay: boolean;
        data: Array<{ animationDuration: boolean }>;
      }>;
    };
    expect(received.series[0].animationDuration).toBe(false);
    expect(received.series[0].animationEasing).toBe(false);
    expect(received.series[0].animationDelay).toBe(false);
    expect(received.series[0].data[0].animationDuration).toBe(false);
    // 调用方原对象保持原值（不突变）
    expect(callerOption.series[0].animationDuration).toBe(500);
    expect(callerOption.series[0].data[0].animationDuration).toBe(300);
  });

  it("unmount → dispose，且 ResizeObserver disconnect", () => {
    const { unmount } = render(<EChart option={baseOption} />);
    expect(echartsMock.instance.dispose).not.toHaveBeenCalled();
    unmount();
    expect(echartsMock.instance.dispose).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.created[0].disconnected).toBe(true);
  });

  it("容器尺寸变化 → ResizeObserver 回调 → resize（观察目标即图表容器）", () => {
    const { container } = render(<EChart option={baseOption} />);
    const ro = FakeResizeObserver.created[0];
    expect(ro).toBeDefined();
    expect(ro.observed).toHaveLength(1);
    expect(ro.observed[0]).toBe(container.querySelector(".cdp-echart"));
    expect(echartsMock.instance.resize).not.toHaveBeenCalled();
    ro.trigger();
    expect(echartsMock.instance.resize).toHaveBeenCalledTimes(1);
  });

  it("reveal 走引擎注册表：mount 注册，unmount dispose 归零", () => {
    const { unmount } = render(<EChart option={baseOption} reveal="rise" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("无 reveal → 引擎注册表零注册", () => {
    render(<EChart option={baseOption} />);
    expect(registrySize()).toBe(0);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["字符串", "xAxis"],
    ["数组", [1, 2]],
    ["数字", 42],
  ])("非空护栏：option 为 %s → render throw（宁炸不假绿）", (_label, bad) => {
    // 预期 throw 会产生 React "The above error occurred" 噪音，静音只限本用例
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(<EChart option={bad as unknown as object} />),
      ).toThrow(/option 必须为非空对象/);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("data-testid 透传且 className 合并（cdp-echart 根类保留）", () => {
    const { getByTestId } = render(
      <EChart option={baseOption} className="my-chart" data-testid="echart-1" />,
    );
    expect(getByTestId("echart-1")).toHaveClass("cdp-echart", "my-chart");
  });
});
