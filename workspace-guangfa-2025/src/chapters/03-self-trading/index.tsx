// 广发证券 2025 年报 · 第 3 章 self-trading（Phase 3 静态终态版——零动画；词汇见 timing.json）
// 构图按 LIBRARY 构图模板册：s0=三卡语义填色 / s1=S17 对比屏 / s2=双卡语义填色 / s3=S3 数据墙（对角同色）。
// 本章 4 步：Checkpoint C 用户反馈把原"成本端"密帧拆成两帧（s1 对比 + s2 双卡）。
import type { CSSProperties } from "react";
import { Grid, Kicker, SplitCompare, StatCell } from "../../components";
import { stageConfig } from "../../engine/runtime-config";
import timing from "./timing.json";

export { selfTradingNarrations } from "./narrations.generated";
export const selfTradingTiming = timing;

const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

const SAFE = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

const STACK = { marginTop: "var(--space-6)" } as const;

/** 填色（模板册 + #18 实测）：涨卡=墨底（surface-3，奶油字 15:1 安全填充——橙底 2.93:1 不过线且与涨橙语义打架）、
     跌卡=绿（accent-1 默认 block）；涨跌语义色全在 delta 标签 */
const FILL_INK = scope({ "--accent-1": "var(--surface-3)" });

export function SelfTradingChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="self-trading-scene-0" style={SAFE}>
        <Kicker variant="pill">投资收益净额 127.8 亿 · 拆开看</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={3}>
            <div style={FILL_INK}>
              <StatCell
                index="/01"
                value="136 亿"
                label="卖持仓落袋"
                desc="处置已实现收益——上年 16.49 亿"
                delta="+724%"
                deltaTone="up"
              />
            </div>
            <StatCell
              index="/02"
              value="135 亿"
              label="对冲用的衍生品"
              desc="衍生工具已实现损失——上年 8.27 亿"
              delta="亏 135 亿"
              deltaTone="down"
            />
            <div style={FILL_INK}>
              <StatCell
                index="/03"
                value="58 亿"
                label="持仓浮盈"
                desc="未实现公允价值变动——上年仅 0.23 亿"
                delta="+58 亿"
                deltaTone="up"
              />
            </div>
          </Grid>
        </div>
      </div>
    );

  if (step === 1)
    return (
      <div data-testid="self-trading-scene-1" style={SAFE}>
        <Kicker variant="pill">更关键的是成本端</Kicker>
        <div style={STACK}>
          <SplitCompare
            align="center"
            beforeTitle="收入增速"
            afterTitle="支出增速"
            before={["+21.7%", "445.13 亿"]}
            after={["+9.5%", "279.30 亿"]}
          />
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div data-testid="self-trading-scene-2" style={SAFE}>
        <Kicker variant="pill">支出端 · 两块</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={2}>
            <div style={FILL_INK}>
              <StatCell
                index="/01"
                value="105.5 亿"
                label="雇员成本"
                desc="计提薪金、奖金及津贴增加"
                delta="+10.2%"
                deltaTone="up"
              />
            </div>
            <StatCell
              index="/02"
              value="100.3 亿"
              label="利息支出"
              desc="债务成本基本持平"
              delta="−1.9%"
              deltaTone="down"
            />
          </Grid>
        </div>
      </div>
    );

  return (
    <div data-testid="self-trading-scene-3" style={SAFE}>
      <Kicker variant="pill">利润放大 · 增速是收入的两倍</Kicker>
      <div style={STACK}>
        <Grid variant="even" columns={2}>
          <div style={FILL_INK}>
            <StatCell
              index="/01"
              value="179.7 亿"
              label="所得税前利润"
              desc="同比"
              delta="+51.6%"
              deltaTone="up"
            />
          </div>
          <StatCell
            index="/02"
            value="137 亿"
            label="归母净利润"
            desc="同比"
            delta="+42.2%"
            deltaTone="up"
            descStyle="plain"
          />
          <StatCell
            index="/03"
            value="1.68 元"
            label="基本每股收益"
            desc="同比"
            delta="+46.1%"
            deltaTone="up"
            descStyle="plain"
          />
          <div style={FILL_INK}>
            <StatCell
              index="/04"
              value="10.16%"
              label="加权平均净资产收益率"
              desc="重回两位数"
              delta="+2.72pp"
              deltaTone="up"
            />
          </div>
        </Grid>
      </div>
    </div>
  );
}
