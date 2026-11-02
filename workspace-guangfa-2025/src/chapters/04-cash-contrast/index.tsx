// 广发证券 2025 年报 · 第 4 章 cash-contrast（Phase 3 静态终态版——零动画；词汇见 timing.json）
// 构图按 LIBRARY 构图模板册：s0=年报原文（主角块=QuoteBlock）/ s1=S6 流程三步 / s2=双卡语义填色 / s3=S16 指标带。
import type { CSSProperties } from "react";
import { BodyCopy, Grid, HeroNumber, Kicker, QuoteBlock, StatCell, StepCard } from "../../components";
import { stageConfig } from "../../engine/runtime-config";
import timing from "./timing.json";

export { cashContrastNarrations } from "./narrations.generated";
export const cashContrastTiming = timing;

const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

const SAFE = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

const STACK = { marginTop: "var(--space-6)" } as const;

const FILL_INK = scope({ "--accent-1": "var(--surface-3)" });

export function CashContrastChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="cash-contrast-scene-0" style={SAFE}>
        <Kicker variant="pill">经营现金流净额 · 2025 年</Kicker>
        <div style={STACK}>
          <HeroNumber value="−556 亿" />
          <div style={STACK}>
            <Kicker>比上一年多流出 82%——人话就是：买股票、买债券，买得更多了</Kicker>
          </div>
        </div>
        <div style={STACK}>
          <QuoteBlock variant="rule">
            <BodyCopy>
              变动主要归因于以公允价值计量且其变动计入当期损益的金融资产产生的现金净流出增加
              <br />
              ——年报自己的解释 · 第 78 页
            </BodyCopy>
          </QuoteBlock>
        </div>
      </div>
    );

  if (step === 1)
    return (
      <div data-testid="cash-contrast-scene-1" style={SAFE}>
        <Kicker variant="pill">这不是坏事，是券商报表的结构</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={3}>
            <StepCard index="01" title="买入持仓" desc="现金流表里记流出" tone="cream" />
            <StepCard index="02" title="持仓浮盈" desc="进利润，不进现金" tone="pink" />
            <StepCard index="03" title="想多赚" desc="就要多持仓，现金往出流" tone="green" />
          </Grid>
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div data-testid="cash-contrast-scene-2" style={SAFE}>
        <Kicker variant="pill">数据对得上</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={2}>
            <div style={FILL_INK}>
              <StatCell
                index="/01"
                value="3,529 亿"
                label="交易性金融资产 · 2025 年末"
                desc="一年加仓 1,189.41 亿——2024 年末 2,339.77 亿"
                delta="+50.8%"
                deltaTone="up"
              />
            </div>
            <div style={FILL_INK}>
              <StatCell
                index="/02"
                value="44.1%"
                label="自营权益仓位 · 占净资本"
                desc="2024 年 31.55%"
                delta="+12.6pp"
                deltaTone="up"
              />
            </div>
          </Grid>
        </div>
      </div>
    );

  return (
    <div data-testid="cash-contrast-scene-3" style={SAFE}>
      <Kicker variant="pill">加仓的钱哪来的？借的</Kicker>
      <div style={STACK}>
        <HeroNumber value="416 亿" />
        <div style={STACK}>
          <Kicker>筹资活动净流入 · 上年 157.17 亿</Kicker>
        </div>
      </div>
      <div style={STACK}>
        <Grid variant="even" columns={3}>
          <StatCell index="/01" value="16 只" label="短期公司债" desc="2025 年发行" descStyle="plain" />
          <StatCell index="/02" value="12 只" label="公司债" desc="2025 年发行" descStyle="plain" />
          <StatCell index="/03" value="8 只" label="次级债" desc="2025 年发行" descStyle="plain" />
        </Grid>
      </div>
    </div>
  );
}
