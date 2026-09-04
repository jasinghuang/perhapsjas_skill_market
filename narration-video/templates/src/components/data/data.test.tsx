import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { HeroNumber, Counter, BarGrow, DonutMeter, StatCard } from "./";

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
});
