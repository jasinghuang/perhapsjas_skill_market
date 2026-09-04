import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { setRenderMode } from "../engine/animationRuntime";
import {
  HeroTitle, Kicker, BodyCopy, QuoteBlock,
  HeroNumber, Counter, BarGrow, DonutMeter, StatCard,
  Card, Rule, Grid, StagePad, Table,
} from "./index";

const STAGE_SIZES = [
  { width: 1920, height: 1080 }, // 16:9
  { width: 1080, height: 1440 }, // 3:4
];

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("双画布冒烟（§11.2 组件契约测试）", () => {
  for (const dims of STAGE_SIZES) {
    it(`全部组件在 ${dims.width}×${dims.height} 画布渲染无异常`, () => {
      const { container } = render(
        <div style={{ width: dims.width, height: dims.height }}>
          <StagePad>
            <Kicker>CHAPTER 01</Kicker>
            <HeroTitle reveal="fade">测试标题</HeroTitle>
            <BodyCopy variant="lede">导语</BodyCopy>
            <QuoteBlock>引用</QuoteBlock>
            <Grid variant="half">
              <StatCard number="47" label="增长" variant="accent" />
              <Card variant="invert">卡片</Card>
            </Grid>
            <HeroNumber value="+47%" />
            <Counter to={47} />
            <BarGrow value={0.7} />
            <DonutMeter value={0.42} label="转化率" />
            <Rule />
            <Table header={["A", "B"]} rows={[["1", "2"]]} variant="zebra" />
          </StagePad>
        </div>,
      );
      expect(container.querySelector(".cdp")).not.toBeNull();
    });
  }
});
