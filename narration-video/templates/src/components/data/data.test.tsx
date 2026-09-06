import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { HeroNumber, Counter, BarGrow, DonutMeter, StatCard, StatCell } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("数据组组件", () => {
  it("HeroNumber 渲染数值 + 变体", () => {
    const { getByTestId } = render(
      <HeroNumber value="47%" variant="accent" data-testid="n" />,
    );
    expect(getByTestId("n")).toHaveTextContent("47%");
    expect(getByTestId("n").className).toContain("cdp-hero-number-accent");
  });

  it("Counter countUp 走帧函数逃生舱（canvasAnim 注册）", () => {
    const { unmount } = render(<Counter to={47} duration="fast" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("BarGrow 动画注册（waapi 生长）", () => {
    const { unmount } = render(<BarGrow value={0.7} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("DonutMeter 渲染 label + 动画注册", () => {
    const { getByTestId, unmount } = render(
      <DonutMeter value={0.42} label="转化率" data-testid="d" />,
    );
    expect(getByTestId("d")).toHaveTextContent("转化率");
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("StatCard 组合渲染数字与标签 + 三个变体", () => {
    const { getByTestId } = render(
      <StatCard number="+47%" label="增长" variant="invert" data-testid="s" />,
    );
    expect(getByTestId("s")).toHaveTextContent("+47%");
    expect(getByTestId("s")).toHaveTextContent("增长");
    expect(getByTestId("s").className).toContain("cdp-stat-card-invert");
  });

  it("StatCell 结构件渲染（角标/大数字/标签/描述）+ delta 右置类名 + tone 类名（二十五轮 F5）", () => {
    const { getByTestId } = render(
      <div>
        <StatCell
          index="/01"
          value="27,930"
          label="营业收入 · 百万元"
          desc="收入规模稳步抬升，再上台阶。"
          delta="▲ +9.52%"
          deltaTone="up"
          data-testid="up"
        />
        <StatCell index="/02" value="42%" label="参与度提升" desc="参与度相对基线提升。" data-testid="plain" />
      </div>,
    );
    const up = getByTestId("up");
    expect(up.className).toContain("cdp-stat-cell");
    // 四件套结构件逐一在格内
    expect(up.querySelector(".cdp-stat-cell-index")).toHaveTextContent("/01");
    expect(up.querySelector(".cdp-hero-number-value")).toHaveTextContent("27,930");
    expect(up.querySelector(".cdp-stat-cell .cdp-kicker")).toHaveTextContent("营业收入 · 百万元");
    expect(up.querySelector(".cdp-stat-cell-desc")).toHaveTextContent("收入规模稳步抬升，再上台阶。");
    // delta 右置类名 + up tone 类名
    const delta = up.querySelector(".cdp-stat-cell-delta");
    expect(delta).not.toBeNull();
    expect(delta!.className).toContain("cdp-stat-cell-delta");
    expect(delta!.className).toContain("cdp-stat-cell-delta-up");
    // 无 delta 的格不渲染 delta 件
    expect(getByTestId("plain").querySelector(".cdp-stat-cell-delta")).toBeNull();
  });

  it("StatCell deltaTone down → 跌绿类名 cdp-stat-cell-delta-down（A股涨跌语义）", () => {
    const { getByTestId } = render(
      <StatCell index="/01" value="9,637" label="归母净利" desc="回调一档。" delta="▼ -3.20%" deltaTone="down" data-testid="d" />,
    );
    expect(getByTestId("d").querySelector(".cdp-stat-cell-delta")!.className).toContain("cdp-stat-cell-delta-down");
  });
});
