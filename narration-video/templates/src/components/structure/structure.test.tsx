import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { Card, Rule, Grid, StagePad, Table } from "./";

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
});
