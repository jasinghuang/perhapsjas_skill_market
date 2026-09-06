import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { setRenderMode } from "../engine/animationRuntime";
import {
  HeroTitle, Kicker, BodyCopy, QuoteBlock, NumberPill,
  HeroNumber, Counter, BarGrow, DonutMeter, StatCard,
  Card, Rule, Grid, StagePad, Table,
  RevealText, RevealList, StepSequence,
  DecorDot, DecorBar, DecorRing, StackedBlocks,
  Figure, TypedTerminal, PathDraw,
  SeededParticles, Breathe, KenBurns,
  TimelineTrack, ProgressDots,
} from "./index";

// 终审 M3：逐组件 presence 断言——统一出口每个组件必须在画布真实渲染，
// 只查 ".cdp" 根类会漏掉「组件已导出但从未渲染」的假绿。
// 全部 30 组件（28 + 十轮 F3/F4 收编 StackedBlocks / NumberPill）。
const ALL_NAMES = [
  "stage-pad",
  "hero-title", "kicker", "body-copy", "quote-block", "number-pill",
  "hero-number", "counter", "bar-grow", "donut", "stat-card",
  "card", "rule", "grid", "table",
  "reveal-text", "reveal-list", "step-seq",
  "decor-dot", "decor-bar", "decor-ring", "stacked-blocks",
  "figure", "terminal", "path-draw",
  "particles", "breathe", "kenburns",
  "timeline", "progress-dots",
];

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
});
afterEach(() => {
  setRenderMode(false);
  vi.restoreAllMocks();
});

describe("双画布冒烟（§11.2 组件契约测试）", () => {
  for (const dims of STAGE_SIZES) {
    it(`全部 30 组件在 ${dims.width}×${dims.height} 画布渲染且逐组件 presence`, () => {
      const { container } = render(
        <div style={{ width: dims.width, height: dims.height }}>
          <StagePad>
            <Kicker>CHAPTER 01</Kicker>
            <HeroTitle reveal="fade">测试标题</HeroTitle>
            <RevealText text="逐词 揭示 测试" />
            <RevealList items={["一", "二"]} activeCount={1} />
            <StepSequence steps={[{ title: "一" }, { title: "二" }]} currentStep={0} />
            <DecorDot /> <DecorBar /> <DecorRing /> <StackedBlocks />
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
            <HeroNumber value="+47%" /><Counter to={47} /><BarGrow value={0.7} />
            <DonutMeter value={0.42} label="转化率" /><Rule />
            <Table header={["A", "B"]} rows={[["1", "2"]]} />
            <BodyCopy>正文</BodyCopy><QuoteBlock>引用</QuoteBlock>
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
