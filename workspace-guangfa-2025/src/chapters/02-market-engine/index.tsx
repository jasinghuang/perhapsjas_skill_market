// 广发证券 2025 年报 · 第 2 章 market-engine（Phase 3 静态终态版——零动画；词汇见 timing.json）
// 构图按 LIBRARY 构图模板册：两帧都是 S3 数据墙（2×2 满幅零阴影网格 + 对角同色填充）。
import type { CSSProperties } from "react";
import { Grid, Kicker, StatCell } from "../../components";
import { stageConfig } from "../../engine/runtime-config";
import timing from "./timing.json";

export { marketEngineNarrations } from "./narrations.generated";
export const marketEngineTiming = timing;

/** 局部 CSS 变量注入（showcase 同款：组件消费的 --accent-1 局部换值，不写裸色） */
const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

const SAFE = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

const STACK = { marginTop: "var(--space-6)" } as const;

/** 对角同色（模板册铁律 2）：(1,4) 墨底对角、(2,3) 奶油对角——涨跌语义色全在 delta 标签
     （粉/橙底填充实测 2.34~2.93:1 低于 3:1 底线，且与涨橙跌绿打架；墨底 15:1 是主题内安全填充） */
const DIAG_INK = scope({ "--accent-1": "var(--surface-3)" });

export function MarketEngineChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="market-engine-scene-0" style={SAFE}>
        <Kicker variant="pill">2025 · 券商大年</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={2}>
            <div style={DIAG_INK}>
              <StatCell
                index="/01"
                value="+18.4%"
                label="上证指数"
                desc="沪深主要指数全线收涨"
                delta="+18.4%"
                deltaTone="up"
              />
            </div>
            <StatCell
              index="/02"
              value="+49.6%"
              label="创业板指"
              desc="涨幅领跑主要指数"
              delta="+49.6%"
              deltaTone="up"
              descStyle="plain"
            />
            <StatCell
              index="/03"
              value="505 万亿"
              label="全市场股票基金成交"
              desc="双边统计口径"
              delta="+70.9%"
              deltaTone="up"
              descStyle="plain"
            />
            <div style={DIAG_INK}>
              <StatCell
                index="/04"
                value="40.4 万亿"
                label="广发自身沪深成交"
                desc="双边统计口径"
                delta="+68.6%"
                deltaTone="up"
              />
            </div>
          </Grid>
        </div>
      </div>
    );

  return (
    <div data-testid="market-engine-scene-1" style={SAFE}>
      <Kicker variant="pill">收入 445.13 亿 · 四块</Kicker>
      <div style={STACK}>
        <Grid variant="even" columns={2}>
          <div style={DIAG_INK}>
            <StatCell
              index="/01"
              value="91.3 亿"
              label="证券经纪佣金"
              desc="客户交易量放大"
              delta="+45.9%"
              deltaTone="up"
            />
          </div>
          <StatCell
            index="/02"
            value="77.0 亿"
            label="资管及基金管理费"
            desc="保有规模增长带动"
            delta="+11.9%"
            deltaTone="up"
            descStyle="plain"
          />
          <div>
            <StatCell
              index="/03"
              value="122.6 亿"
              label="利息收入"
              desc="融资融券利息 +14.4% 部分抵销"
              delta="−2.5%"
              deltaTone="down"
            />
          </div>
          <div style={DIAG_INK}>
            <StatCell
              index="/04"
              value="127.8 亿"
              label="投资收益净额"
              desc="自营与做市贡献"
              delta="+64.2%"
              deltaTone="up"
            />
          </div>
        </Grid>
      </div>
    </div>
  );
}
