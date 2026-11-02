// 广发证券 2025 年报 · 第 5 章 leverage-risk（Phase 3 静态终态版——零动画；词汇见 timing.json）
// 构图按 LIBRARY 构图模板册：s0=S17 对比屏 + 单卡 / s1=三卡语义填色 / s2=清单勾选 / s3=S13 便签墙。
import type { CSSProperties } from "react";
import { Card, Grid, JisCheck, Kicker, PostIt, SplitCompare, StatCell } from "../../components";
import { stageConfig } from "../../engine/runtime-config";
import timing from "./timing.json";

export { leverageRiskNarrations } from "./narrations.generated";
export const leverageRiskTiming = timing;

const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

const SAFE = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

const STACK = { marginTop: "var(--space-6)" } as const;
const CHECK_ROW = { display: "flex", alignItems: "center", gap: "var(--space-4)" } as const;

const FILL_INK = scope({ "--accent-1": "var(--surface-3)" });

export function LeverageRiskChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="leverage-risk-scene-0" style={SAFE}>
        <Kicker variant="pill">加了杠杆，就要看安全垫</Kicker>
        <div style={STACK}>
          <SplitCompare
            align="center"
            beforeTitle="总资产"
            afterTitle="股东权益"
            before={["9,755 亿", "一年 +28.6%"]}
            after={["1,561 亿", "一年 +5.8%"]}
          />
        </div>
        <div style={STACK}>
          <div style={FILL_INK}>
            <StatCell
              index="/01"
              value="78.3%"
              label="资产负债率"
              desc="扣客户资金口径——2024 年 73.76%"
              delta="+4.5pp"
              deltaTone="up"
            />
          </div>
        </div>
      </div>
    );

  if (step === 1)
    return (
      <div data-testid="leverage-risk-scene-1" style={SAFE}>
        <Kicker variant="pill">风险指标 · 母公司口径</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={3}>
            <StatCell
              index="/01"
              value="231.6%"
              label="风险覆盖率"
              desc="监管底线 100%，仍有两倍余量"
              delta="−44.6pp"
              deltaTone="down"
            />
            <div style={FILL_INK}>
              <StatCell
                index="/02"
                value="185.7%"
                label="流动性覆盖率"
                desc="短期兑付能力略升"
                delta="+2.6pp"
                deltaTone="up"
              />
            </div>
            <StatCell
              index="/03"
              value="145.3%"
              label="净稳定资金率"
              desc="长期稳定资金覆盖回落"
              delta="−7.9pp"
              deltaTone="down"
            />
          </Grid>
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div data-testid="leverage-risk-scene-2" style={SAFE}>
        <Kicker variant="pill">报表本身也没有红灯</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={2}>
            <Card variant="plain">
              <div style={CHECK_ROW}>
                <JisCheck checked />
                <Kicker>安永出具标准无保留意见</Kicker>
              </div>
            </Card>
            <Card variant="plain">
              <div style={CHECK_ROW}>
                <JisCheck checked />
                <Kicker>无到期未偿还债务</Kicker>
              </div>
            </Card>
          </Grid>
        </div>
      </div>
    );

  return (
    <div data-testid="leverage-risk-scene-3" style={SAFE}>
      <Kicker variant="pill">但有一件事要想清楚</Kicker>
      <div style={STACK}>
        <PostIt
          label="年底时点 · 快照"
          text="风险指标都是年底的快照——行情给的利润，市场掉头时也会收回去"
          tone="yellow"
          emphasis
        />
      </div>
    </div>
  );
}
