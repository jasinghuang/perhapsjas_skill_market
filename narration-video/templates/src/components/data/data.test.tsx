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

  it("StatCell descStyle 四档类名：默认 block 加档类、pill/pillFilled 加档类、plain 无档类（二十八轮 F3 默认改 block）", () => {
    const { getByTestId } = render(
      <div>
        <StatCell index="/01" value="42%" label="参与度提升" desc="默认 block 档。" data-testid="s-default" />
        <StatCell index="/02" value="27,930" label="营业收入" desc="绿底无框。" descStyle="block" data-testid="s-block" />
        <StatCell index="/03" value="9,637" label="归母净利" desc="4px 墨框药丸。" descStyle="pill" data-testid="s-pill" />
        <StatCell index="/04" value="975,484" label="总资产" desc="绿填充药丸。" descStyle="pillFilled" data-testid="s-pill-filled" />
        <StatCell index="/05" value="9,637" label="归母净利" desc="无底无框。" descStyle="plain" data-testid="s-plain" />
      </div>,
    );
    const desc = (id: string) => getByTestId(id).querySelector(".cdp-stat-cell-desc");
    // 二十八轮 F3：默认档 = block（用户选定方案）
    expect(desc("s-default")!.className).toBe("cdp-stat-cell-desc cdp-stat-cell-desc-block");
    expect(desc("s-block")!.className).toContain("cdp-stat-cell-desc-block");
    expect(desc("s-block")!.className).not.toContain("cdp-stat-cell-desc-pill");
    expect(desc("s-pill")!.className).toContain("cdp-stat-cell-desc-pill");
    expect(desc("s-pill")!.className).not.toContain("cdp-stat-cell-desc-block");
    expect(desc("s-pill")!.className).not.toContain("-filled");
    // pillFilled 映射 kebab 类名（descStyle camelCase 与 CSS 命名解耦）
    expect(desc("s-pill-filled")!.className).toBe("cdp-stat-cell-desc cdp-stat-cell-desc-pill-filled");
    // plain 显式指定仍可用（组件能力保留）
    expect(desc("s-plain")!.className).toBe("cdp-stat-cell-desc cdp-stat-cell-desc-plain");
  });
});
