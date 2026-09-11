import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { setRenderMode } from "../engine/animationRuntime";
import { COMPONENTS } from "./manifest";
import {
  HeroTitle, Kicker, BodyCopy, QuoteBlock, NumberPill, DeltaText,
  HeroNumber, Counter, BarGrow, DonutMeter, StatCard, StatCell, StatInline, YearBarGroup, DataItemRow,
  Card, Rule, Grid, StagePad, Table, SplitCompare, JisCheck, StepCard, MotionCell,
  RevealText, RevealList, StepSequence, StaggerRow,
  DecorDot, DecorBar, DecorRing, StackedBlocks, MarkerBlock, StepStairs, PostIt,
  Figure, TypedTerminal, PathDraw,
  SeededParticles, Breathe, KenBurns,
  TimelineTrack, ProgressDots,
  EChart,
} from "./index";

// EChart 在 jsdom 无 SVG 布局能力（T2 预检自洽结论）：与 EChart.test.tsx 同型的
// vi.mock stub 四个 echarts 入口模块——init 返回记录对象，模块级 registerTheme/use
// 安全可调。冒烟只验证 presence，echarts 内部由其自身测试覆盖。
const echartsMock = vi.hoisted(() => {
  const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
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

// 终审 M3：逐组件 presence 断言——统一出口每个组件必须在画布真实渲染，
// 只查 ".cdp" 根类会漏掉「组件已导出但从未渲染」的假绿。
// 全部 44 组件（36 + 三十四轮 M2b 收编 8 内部件）——清单由 manifest.ts 派生
// （单一注册表；class 序 = 既有清单逐条不变，渲染树与遍历序均不变）。
const ALL_NAMES = COMPONENTS.map((c) => c.class);

const STAGE_SIZES = [
  { width: 1920, height: 1080 }, // 16:9
  { width: 1080, height: 1440 }, // 3:4
];

beforeEach(() => {
  setRenderMode(false);
  // jsdom 无 canvas 实现：getContext 原版会打印 "Not implemented" 噪音。
  // 返回 null——SeededParticles 有 `if (!ctx) return` 空安全护栏，
  // 绘制行为由 ambient.test.tsx 的 FakeCtx2d 覆盖，冒烟只验证 presence。
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // EChart stub：init 返回记录对象（echarts 模块级 vi.mock 见文件头）
  echartsMock.init.mockReturnValue(echartsMock.instance);
});
afterEach(() => {
  setRenderMode(false);
  vi.restoreAllMocks();
});

describe("双画布冒烟（§11.2 组件契约测试）", () => {
  for (const dims of STAGE_SIZES) {
    it(`全部 ${COMPONENTS.length} 组件在 ${dims.width}×${dims.height} 画布渲染且逐组件 presence`, () => {
      const { container } = render(
        <div style={{ width: dims.width, height: dims.height }}>
          <StagePad>
            <Kicker>CHAPTER 01</Kicker>
            <HeroTitle reveal="fade">测试标题</HeroTitle>
            <RevealText text="逐词 揭示 测试" />
            <RevealList items={["一", "二"]} activeCount={1} />
            <StepSequence steps={[{ title: "一" }, { title: "二" }]} currentStep={0} />
            <DecorDot /> <DecorBar /> <DecorRing /> <StackedBlocks />
            <StepStairs items={[{ value: "42%", note: "参与度提升" }, { value: "2.7×" }]} />
            <MarkerBlock>主角</MarkerBlock>
            <SplitCompare before={["散落"]} after={["清晰"]} />
            <NumberPill number="01" />
            <Figure caption="图" />
            <TypedTerminal lines={["line"]} />
            <PathDraw d="M0 0 L50 50" />
            <SeededParticles seed={1} count={3} />
            <Breathe cycles={1} />
            <KenBurns />
            <TimelineTrack points={["A", "B"]} activeIndex={0} />
            <ProgressDots total={3} current={1} />
            <Grid variant="half"><StatCard number="47" label="增长" /><Card>卡</Card></Grid>
            <StatCell index="/01" value="+47%" label="增长" desc="一句描述。" delta="▲ +9.52%" deltaTone="up" />
            <StatInline value="42%" label="参与度提升" desc="一句描述。" />
            <HeroNumber value="+47%" /><Counter to={47} /><BarGrow value={0.7} />
            <DonutMeter value={0.42} label="转化率" /><Rule />
            <Table header={["A", "B"]} rows={[["1", "2"]]} />
            <BodyCopy>正文</BodyCopy><QuoteBlock>引用</QuoteBlock>
            {/* 三十四轮 M2b 收编 8 内部件（presence + 根类） */}
            <DeltaText text="增长 +9.52%" />
            <YearBarGroup max={100} bars={[{ value: 62, tone: "muted" }, { value: 88, tone: "accent" }]} />
            <DataItemRow index="01" title="营收 27,930 百万" desc="主营业务收入。" pillTestid="smoke-data-item-pill" />
            <JisCheck checked />
            <StepCard index="01" title="写稿" desc="口播稿定节奏。" tone="cream" style={{ height: 320 }} />
            <MotionCell label="MOTION"><DecorDot /></MotionCell>
            <StaggerRow stagger reveal="rise" duration="mid"><span>一</span><span>二</span></StaggerRow>
            <PostIt label="NOTE 01" text="先把想法贴墙" tone="pink" />
            <div style={{ width: 320, height: 200 }}>
              <EChart option={{ series: [{ type: "bar", data: [1, 2, 3] }] }} data-testid="smoke-echart" />
            </div>
          </StagePad>
        </div>,
      );
      expect(container.querySelector(".cdp")).not.toBeNull();
      for (const n of ALL_NAMES) {
        expect(container.querySelector(`.cdp-${n}`), `组件缺失：.cdp-${n}`).not.toBeNull();
      }
    });
  }
});
