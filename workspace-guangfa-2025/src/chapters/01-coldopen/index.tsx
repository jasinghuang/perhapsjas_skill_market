// 广发证券 2025 年报 · 第 1 章 coldopen（Phase 3 静态终态版——零动画；词汇见 timing.json）
// 构图按 LIBRARY 构图模板册：s0=S1 封面 / s1=S16 指标带 / s2=S6 流程三步 / s3=S18 墨底大字。
import type { CSSProperties } from "react";
import { BodyCopy, DecorBar, DecorDot, Grid, HeroNumber, HeroTitle, Kicker, MarkerBlock, QuoteBlock, StatCell, StepCard } from "../../components";
import { stageConfig } from "../../engine/runtime-config";
import timing from "./timing.json";

export { coldopenNarrations } from "./narrations.generated";
export const coldopenTiming = timing;

/** 局部 CSS 变量注入（与 showcase 同款手法——组件消费的基础层 token 局部换值，不写裸色） */
const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

const SAFE = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

/** 满高帧的绝对锚定框（height:100% + 外边距会把底缘顶出画布——用 inset 锚定不吃外边距） */
const ANCHOR_BOX = {
  position: "absolute",
  top: stageConfig.safeArea.top,
  left: stageConfig.safeArea.content,
  right: stageConfig.safeArea.content,
  bottom: 0,
} as const;

/** 墨底帧的根层（S18 型：全屏 surface-3 + 组件文字回归 cream） */
const INK_ROOT = {
  position: "absolute",
  inset: 0,
  background: "var(--surface-3)",
} as const;

const STACK = { marginTop: "var(--space-6)" } as const;

export function ColdopenChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="coldopen-scene-0" style={{ position: "relative", height: "100%" }}>
        <div style={{ ...ANCHOR_BOX, display: "flex", flexDirection: "column" }}>
          <Kicker variant="block">广发证券 2025 · 年报解读</Kicker>
          <div style={{ ...STACK, marginTop: "var(--space-5)" }}>
            <MarkerBlock variant="invert">
              <HeroTitle size="display-1" latin="GF SECURITIES" cn="利润新高 现金失血" />
            </MarkerBlock>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "auto" }}>
            <DecorBar variant="accent" style={{ background: "var(--accent-2)" }} />
            <DecorDot variant="glow" style={{ background: "var(--accent-2)", boxShadow: "0 0 var(--space-4) var(--accent-2)" }} />
            <DecorBar variant="solid" />
          </div>
          <div style={{ ...STACK, ...scope({ "--accent-1": "var(--accent-2)" }) }}>
            <QuoteBlock variant="rule">归母净利润 137 亿，涨 42.2%；经营现金流，净流出 556 亿。</QuoteBlock>
          </div>
        </div>
        {/* 印章（S1 同款：pink 方块 -6deg + cream 圆环 + mono 年份） */}
        <div
          data-testid="coldopen-stamp"
          style={{
            position: "absolute",
            right: "calc(var(--space-5) + 48px)",
            bottom: "calc(var(--space-5) + 48px)",
            width: 340,
            height: 340,
            background: "var(--accent-2)",
            border: "4px solid var(--surface-3)",
            transform: "rotate(-6deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "68%",
              height: "68%",
              border: "4px solid var(--surface)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 40, letterSpacing: "0.08em", color: "var(--surface-3)" }}>
              2025
            </span>
          </div>
        </div>
      </div>
    );

  if (step === 1)
    return (
      <div data-testid="coldopen-scene-1" style={SAFE}>
        <Kicker variant="pill">556 亿是什么概念</Kicker>
        <div style={STACK}>
          <HeroNumber value="556 亿" />
          <div style={STACK}>
            <Kicker>一年经营净流出的钱</Kicker>
          </div>
        </div>
        <div style={STACK}>
          <StatCell
            index="/02"
            value="274 亿"
            label="现金及现金等价物 · 2025 年末"
            desc="一年净流出 ≈ 账上现金的 2.03 倍（555.82 ÷ 274.29，自算）"
            deltaTone="down"
            descStyle="plain"
          />
        </div>
      </div>
    );

  if (step === 2)
    return (
      <div data-testid="coldopen-scene-2" style={SAFE}>
        <Kicker variant="pill">券商报表里，利润和现金不是一回事</Kicker>
        <div style={STACK}>
          <Grid variant="even" columns={3}>
            <StepCard index="01" title="利润是账" desc="137 亿按应计口径入账——赚没赚，看账面" tone="cream" />
            <StepCard index="02" title="现金是口袋" desc="556 亿按实收实付流出——钱进出，看现金" tone="green" />
            <StepCard index="03" title="中间隔着仓位" desc="钱没消失，长在了持仓里" tone="pink" />
          </Grid>
        </div>
      </div>
    );

  return (
    <div data-testid="coldopen-scene-3" style={INK_ROOT}>
      <div style={{ ...ANCHOR_BOX, display: "flex", flexDirection: "column", justifyContent: "center", ...scope({ "--text": "var(--surface)", "--text-2": "var(--surface)" }) }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <DecorBar variant="accent" style={{ background: "var(--accent-3)", width: 96, height: 24 }} />
          <HeroTitle size="display-1" style={{ lineHeight: 0.95 }}>
            五分钟，拆开这对反着走的数字
          </HeroTitle>
        </div>
        <BodyCopy style={{ marginTop: "var(--space-4)", fontSize: "var(--t-h3)", lineHeight: 1.4, maxWidth: 980, color: "var(--surface)" }}>
          137 亿怎么赚的 → 556 亿去哪了 → 利润落到谁口袋
        </BodyCopy>
      </div>
    </div>
  );
}
