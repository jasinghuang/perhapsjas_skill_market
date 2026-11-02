// 广发证券 2025 年报 · 第 6 章 shareholder（Phase 3 静态终态版——零动画；词汇见 timing.json）
// 构图按 LIBRARY 构图模板册：s0=三卡（合计=墨底主角）/ s1=单卡 + S17 对比 / s2=清单逐项 / s3=S18 墨底结论。
import type { CSSProperties } from "react";
import { BodyCopy, DataItemRow, DecorBar, Grid, HeroTitle, Kicker, SplitCompare, StatCell } from "../../components";
import { stageConfig } from "../../engine/runtime-config";
import timing from "./timing.json";

export { shareholderNarrations } from "./narrations.generated";
export const shareholderTiming = timing;

const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

const SAFE = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

const INK_ROOT = {
  position: "absolute",
  inset: 0,
  background: "var(--surface-3)",
} as const;

/** 满高帧的绝对锚定框（height:100% + 外边距会把底缘顶出画布） */
const ANCHOR_BOX = {
  position: "absolute",
  top: stageConfig.safeArea.top,
  left: stageConfig.safeArea.content,
  right: stageConfig.safeArea.content,
  bottom: 0,
} as const;

const STACK = { marginTop: "var(--space-6)" } as const;

/** 墨底填充（#18 实测：奶油字在墨底 15:1 安全；橙/粉底 2.34~2.93:1 不过线） */
const FILL_INK = scope({ "--accent-1": "var(--surface-3)" });

export function ShareholderChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="shareholder-scene-0" style={SAFE}>
        <Kicker variant="pill">2025 年 · 分了两次红</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={3}>
            <StatCell index="/01" value="1 元" label="中期 · 每 10 股" desc="2025-10-22 实施，共 7.61 亿" descStyle="plain" />
            <StatCell index="/02" value="5 元" label="末期预案 · 每 10 股" desc="共 39.12 亿（含税）" descStyle="plain" />
            <div style={FILL_INK}>
              <StatCell index="/03" value="6 元" label="全年合计 · 每 10 股" desc="中期 + 末期（自算）" />
            </div>
          </Grid>
        </div>
      </div>
    );

  if (step === 1)
    return (
      <div data-testid="shareholder-scene-1" style={SAFE}>
        <Kicker variant="pill">分红力度</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={2}>
            <div style={FILL_INK}>
              <StatCell
                index="/01"
                value="39.1 亿"
                label="末期分红总额"
                desc="占归母净利润 28.6%——两次合计 46.7 亿"
                delta="占净利 28.6%"
                deltaTone="up"
              />
            </div>
            <SplitCompare
              align="center"
              beforeTitle="2024 年度"
              afterTitle="2025 年度"
              before={["每 10 股 4 元"]}
              after={["每 10 股 6 元"]}
            />
          </Grid>
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div data-testid="shareholder-scene-2" style={SAFE}>
        <Kicker variant="pill">还做了两件事</Kicker>
        <div style={STACK}>
          <DataItemRow
            index="01"
            title="首次回购注销"
            desc="2025 年 2 月完成——公司上市以来首次"
          />
        </div>
        <div style={STACK}>
          <DataItemRow
            index="02"
            title="纳入 MSCI 中国指数"
            desc="成份股——市值显著增长（董事长致辞）"
          />
        </div>
      </div>
    );

  return (
    <div data-testid="shareholder-scene-3" style={INK_ROOT}>
      <div style={{ ...ANCHOR_BOX, display: "flex", flexDirection: "column", justifyContent: "center", ...scope({ "--text": "var(--surface)", "--text-2": "var(--surface)" }) }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <DecorBar variant="accent" style={{ background: "var(--accent-3)", width: 96, height: 24 }} />
          <HeroTitle size="display-1" style={{ lineHeight: 0.95 }}>
            自营仓位 × 市场成交
          </HeroTitle>
        </div>
        <BodyCopy style={{ marginTop: "var(--space-4)", fontSize: "var(--t-h3)", lineHeight: 1.4, maxWidth: 980, color: "var(--surface)" }}>
          明年盯两个数就够了。成交冷下来，利润和仓位会一起退潮——这就是 2025 年的广发。
        </BodyCopy>
      </div>
    </div>
  );
}
