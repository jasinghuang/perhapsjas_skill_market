import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { Card, Rule, Grid, StagePad, Table, SplitCompare } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("结构组组件", () => {
  it("五个组件默认渲染 + 类名约定", () => {
    const { getByTestId } = render(
      <StagePad data-testid="pad">
        <Card data-testid="c">卡片</Card>
        <Rule data-testid="r" />
        <Grid data-testid="g"><div>1</div><div>2</div></Grid>
        <Table data-testid="tb" header={["A", "B"]} rows={[["1", "2"]]} />
      </StagePad>,
    );
    expect(getByTestId("c").className).toContain("cdp-card");
    expect(getByTestId("r").className).toContain("cdp-rule");
    expect(getByTestId("g").className).toContain("cdp-grid");
    expect(getByTestId("tb").className).toContain("cdp-table");
  });

  it("Table 渲染表头与斑马纹变体", () => {
    const { getByTestId } = render(
      <Table
        variant="zebra"
        header={["名称", "值"]}
        rows={[["a", "1"], ["b", "2"]]}
        data-testid="tb"
      />,
    );
    expect(getByTestId("tb").querySelectorAll("thead th")).toHaveLength(2);
    expect(getByTestId("tb").querySelectorAll("tbody tr")).toHaveLength(2);
    expect(getByTestId("tb").className).toContain("cdp-table-zebra");
  });

  it("Table columns 变体类名渲染（彩色列）", () => {
    const { getByTestId } = render(
      <Table
        variant="columns"
        header={["属性", "A", "B", "C"]}
        rows={[["速度", "快", "更快", "最快"]]}
        data-testid="tb"
      />,
    );
    expect(getByTestId("tb").className).toContain("cdp-table-columns");
    expect(getByTestId("tb").querySelectorAll("tbody td")).toHaveLength(4);
  });

  it("Card reveal 走引擎、卸载 dispose", () => {
    const { unmount } = render(<Card reveal="fade">x</Card>);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("SplitCompare 单一面板 + 两半标题/条目 + VS 圆章（十九轮 F4）", () => {
    const { getByTestId } = render(
      <SplitCompare
        before={["散落的文档", "模糊的归属"]}
        after={["一份稿子驱动", "角色清晰"]}
        data-testid="sc"
      />,
    );
    const panel = getByTestId("sc");
    expect(panel.className).toContain("cdp-split-compare");
    // 单一面板：两半为内部子结构，非独立卡片
    expect(panel.querySelectorAll(".cdp-split-compare-half")).toHaveLength(2);
    expect(panel.querySelector(".cdp-split-compare-before .cdp-split-compare-title")).toHaveTextContent("BEFORE");
    expect(panel.querySelector(".cdp-split-compare-after .cdp-split-compare-title")).toHaveTextContent("AFTER");
    expect(panel.querySelectorAll(".cdp-split-compare-before .cdp-split-compare-list li")).toHaveLength(2);
    expect(panel.querySelectorAll(".cdp-split-compare-after .cdp-split-compare-list li")).toHaveLength(2);
    const seal = panel.querySelector(".cdp-split-compare-seal");
    expect(seal).not.toBeNull();
    expect(seal).toHaveTextContent("VS");
  });

  it("SplitCompare 自定义标题透传", () => {
    const { getByTestId } = render(
      <SplitCompare before={["甲"]} after={["乙"]} beforeTitle="之前" afterTitle="之后" data-testid="sc2" />,
    );
    expect(getByTestId("sc2").querySelector(".cdp-split-compare-before .cdp-split-compare-title")).toHaveTextContent("之前");
    expect(getByTestId("sc2").querySelector(".cdp-split-compare-after .cdp-split-compare-title")).toHaveTextContent("之后");
  });

  it("SplitCompare 对齐模式类名（二十二轮 F4：默认 split 无 center 类；align=center 加类）", () => {
    const { getByTestId } = render(
      <div>
        <SplitCompare before={["甲"]} after={["乙"]} data-testid="sc-split" />
        <SplitCompare before={["甲"]} after={["乙"]} align="center" data-testid="sc-center" />
      </div>,
    );
    expect(getByTestId("sc-split").className).toContain("cdp-split-compare");
    expect(getByTestId("sc-split").className).not.toContain("cdp-split-compare-center");
    expect(getByTestId("sc-center").className).toContain("cdp-split-compare-center");
  });
});
