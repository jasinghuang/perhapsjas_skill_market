// 样式词典页（M2b 验收工具；dev-only，不入章节层）。
// ?styleguide=1 渲染：creative-mode 主题全部设计 token 的视觉表达 + 30 组件全变体目录。
// 页面壳：深色 shell 底（var(--shell)）、1920 居中；每区段 mono 区段头（cream，编号 + 标题）
// + 全幅 cream 内容面板（4px 墨框、水平内衬 96px——与安全框规格一致）。
// 布局纪律：区段内容水平 ≥96px 内；无横向溢出；组件格容器只允许 inline 布局属性，
// 颜色零裸色（一律 token 化）；组件格内 --shadow-card 覆写 none（目录密度优先，
// 硬阴影语义见 05 区段 Card 行）；网格单元零阴影（展示页铁律同款）。
// token 标注一律运行时读 :root 计算值（getComputedStyle(documentElement)），与 tokens.css 同源。
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { waapi } from "./engine/animationRuntime";
import {
  BarGrow,
  BodyCopy,
  Breathe,
  Card,
  Counter,
  DecorBar,
  DecorDot,
  DecorRing,
  DonutMeter,
  Figure,
  Grid,
  HeroNumber,
  HeroTitle,
  KenBurns,
  Kicker,
  NumberPill,
  PathDraw,
  ProgressDots,
  QuoteBlock,
  RevealList,
  RevealText,
  Rule,
  SeededParticles,
  StackedBlocks,
  StagePad,
  StatCard,
  StepSequence,
  Table,
  TimelineTrack,
  TypedTerminal,
} from "./components";

/** 局部 token 覆写：向子树注入 CSS 自定义属性（dev 页合法手段，不改组件本体） */
const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

/** 含中文的 mono 文案字体栈：拉丁走 JetBrains Mono，CJK 落 Noto Sans SC（避免 generic monospace 抢先命中） */
const MONO_CN = '"JetBrains Mono", "Noto Sans SC", "SF Mono", monospace';

/** 组件格内 token 覆写：字阶压缩到目录尺寸 + 硬阴影关（变体对照只读形态，不读投影） */
const CELL_SCOPE: Record<string, string> = {
  "--shadow-card": "none",
  "--shadow-card-sm": "none",
  "--t-display-1": "56px",
  "--t-display-2": "40px",
  "--t-h1": "32px",
  "--t-h2": "28px",
  "--t-h3": "24px",
  "--t-body": "20px",
  "--t-label": "18px",
  "--space-4": "24px",
  "--space-5": "32px",
};

/* ── 基础家具 ── */

/** 运行时读取 :root token 计算值（与 tokens.css 同源，页面自证） */
function TokenValue({ token }: { token: string }) {
  const [value, setValue] = useState("…");
  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    setValue(v || "—");
  }, [token]);
  return <>{value}</>;
}

/** 区段壳：mono 区段头（cream，编号 + 标题）+ 全幅 cream 内容面板（4px 墨框、96px 水平内衬） */
function Section({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section data-testid={`section-${index}`} style={{ width: 1920, flexShrink: 0 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 28,
          lineHeight: 1,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--surface)",
          padding: "0 96px var(--space-3)",
          whiteSpace: "nowrap",
        }}
      >
        {index} · {title}
      </div>
      <div
        style={{
          background: "var(--surface)",
          border: "4px solid var(--text)",
          boxSizing: "border-box",
          padding: "var(--space-5) 96px",
          color: "var(--text)", // 颜色链给继承型变体（Kicker plain 等）——十三轮一致性
        }}
      >
        {children}
      </div>
    </section>
  );
}

/** mono 小标注（token 名 / 组件名 / 变体名） */
function MonoLabel({ children, color = "var(--text-mute)", size = 14, style }: {
  children: ReactNode;
  color?: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        lineHeight: 1.3,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** 变体块：mono 小字标变体名 + 变体渲染 */
function Variant({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", maxWidth: "100%" }}>
      <MonoLabel color="var(--text-faint)" size={12}>{label}</MonoLabel>
      {children}
    </div>
  );
}

/* ── 01 · 色板 PALETTE ── */

interface SwatchDef {
  token: string;
  /** true = 墨字（亮底），false = cream 字（墨底）——对比度纪律的展示 */
  ink: boolean;
}

const SWATCH_GROUPS: { label: string; tokens: SwatchDef[] }[] = [
  {
    label: "表面色 SURFACE",
    tokens: [
      { token: "--surface", ink: true },
      { token: "--surface-2", ink: true },
      { token: "--surface-3", ink: false },
    ],
  },
  {
    label: "文字色 TEXT",
    tokens: [
      { token: "--text", ink: false },
      { token: "--text-2", ink: false },
      { token: "--text-mute", ink: false },
      { token: "--text-faint", ink: true },
    ],
  },
  {
    label: "强调色 ACCENT · 四色 + dark",
    tokens: [
      { token: "--accent-1", ink: false },
      { token: "--accent-1-dark", ink: false },
      { token: "--accent-2", ink: true },
      { token: "--accent-2-dark", ink: false },
      { token: "--accent-3", ink: false },
      { token: "--accent-4", ink: true },
    ],
  },
  {
    label: "其他 OTHERS",
    tokens: [
      { token: "--rule", ink: false },
      { token: "--shell", ink: false },
      { token: "--caption-bg", ink: true },
      { token: "--caption-stroke", ink: false },
    ],
  },
];

function Swatch({ token, ink }: SwatchDef) {
  return (
    <div
      data-testid={`swatch-${token}`}
      style={{
        width: 160,
        height: 96,
        boxSizing: "border-box",
        background: `var(${token})`,
        border: "4px solid var(--text)",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        color: ink ? "var(--text)" : "var(--surface)",
      }}
    >
      <MonoLabel color={ink ? "var(--text)" : "var(--surface)"} size={14} style={{ whiteSpace: "normal" }}>
        {token}
      </MonoLabel>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.3,
          letterSpacing: 0,
          wordBreak: "break-all",
        }}
      >
        <TokenValue token={token} />
      </span>
    </div>
  );
}

function PaletteSection() {
  return (
    <Section index="01" title="色板 PALETTE">
      {SWATCH_GROUPS.map((group, gi) => (
        <div key={group.label} style={{ marginBottom: gi === SWATCH_GROUPS.length - 1 ? 0 : "var(--space-5)" }}>
          <MonoLabel style={{ display: "block", marginBottom: "var(--space-2)" }}>{group.label}</MonoLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
            {group.tokens.map((t) => (
              <Swatch key={t.token} token={t.token} ink={t.ink} />
            ))}
          </div>
        </div>
      ))}
      <MonoLabel style={{ display: "block", marginTop: "var(--space-3)" }}>
        对比度纪律：yellow / cream 底配墨字 · 墨底配 cream 字
      </MonoLabel>
    </Section>
  );
}

/* ── 02 · 字阶 TYPOGRAPHY ── */

/** display 档 = Noto Sans SC 900（display-1/2 行高 0.92 紧凑感）；body 档 = Space Grotesk/Noto Sans SC */
const TYPE_TIERS: { token: string; family: "display" | "body"; lh: number }[] = [
  { token: "--t-display-1", family: "display", lh: 0.92 },
  { token: "--t-display-2", family: "display", lh: 0.92 },
  { token: "--t-h1", family: "display", lh: 1 },
  { token: "--t-h2", family: "display", lh: 1 },
  { token: "--t-h3", family: "display", lh: 1 },
  { token: "--t-body", family: "body", lh: 1.5 },
  { token: "--t-label", family: "body", lh: 1.3 }, // 全局最小字号（五轮 F1：micro 档已删除）
];

function TypographySection() {
  return (
    <Section index="02" title="字阶 TYPOGRAPHY">
      {TYPE_TIERS.map((tier) => (
        <div
          key={tier.token}
          data-testid={`type-row-${tier.token}`}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "var(--space-5)",
            marginBottom: "var(--space-3)",
          }}
        >
          <span style={{ width: 340, display: "flex", flexDirection: "column", gap: 4 }}>
            <MonoLabel color="var(--text-mute)" style={{ whiteSpace: "normal" }}>
              {tier.token}
            </MonoLabel>
            <MonoLabel color="var(--text-faint)" size={12}>
              <TokenValue token={tier.token} /> · lh {tier.lh}
              {tier.family === "display" ? " · Noto Sans SC 900" : " · Space Grotesk / Noto Sans SC"}
            </MonoLabel>
          </span>
          <span
            style={{
              fontFamily: tier.family === "display" ? "var(--font-display-cn)" : "var(--font-body)",
              fontWeight: tier.family === "display" ? 900 : 400,
              fontSize: `var(${tier.token})`,
              lineHeight: tier.lh,
              color: "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            口播视频
          </span>
        </div>
      ))}
    </Section>
  );
}

/* ── 03 · 间距阶 SPACING ── */

const SPACE_BARS: { token: string; note?: string }[] = [
  { token: "--space-1" },
  { token: "--space-2" },
  { token: "--space-3" },
  { token: "--space-4" },
  { token: "--space-5" },
  { token: "--space-6" },
  { token: "--stage-pad-x", note: "水平留白" },
  { token: "--stage-pad-y", note: "垂直留白" },
];

function SpacingSection() {
  return (
    <Section index="03" title="间距阶 SPACING">
      {SPACE_BARS.map((bar) => (
        <div
          key={bar.token}
          data-testid={`space-row-${bar.token}`}
          style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", marginBottom: "var(--space-3)" }}
        >
          <span style={{ width: 340, display: "flex", flexDirection: "column", gap: 4 }}>
            <MonoLabel>{bar.token}</MonoLabel>
            <MonoLabel color="var(--text-faint)" size={12}>
              <TokenValue token={bar.token} />
              {bar.note ? ` · ${bar.note}` : ""}
            </MonoLabel>
          </span>
          <div
            style={{ height: 24, width: `var(${bar.token})`, background: "var(--surface-3)", flexShrink: 0 }}
          />
        </div>
      ))}
      {/* grid-gutter：两个色块间隙示意（间隙宽 = --grid-gutter） */}
      <div
        data-testid="space-row---grid-gutter"
        style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}
      >
        <span style={{ width: 340, display: "flex", flexDirection: "column", gap: 4 }}>
          <MonoLabel>--grid-gutter</MonoLabel>
          <MonoLabel color="var(--text-faint)" size={12}>
            <TokenValue token="--grid-gutter" /> · 两色块间隙
          </MonoLabel>
        </span>
        <div style={{ display: "flex", gap: "var(--grid-gutter)" }}>
          <div style={{ width: 96, height: 48, background: "var(--accent-2)", border: "4px solid var(--text)", boxSizing: "border-box" }} />
          <div style={{ width: 96, height: 48, background: "var(--accent-1)", border: "4px solid var(--text)", boxSizing: "border-box" }} />
        </div>
      </div>
    </Section>
  );
}

/* ── 04 · 动效 MOTION ── */

const DUR_TIERS = [
  { tier: "FAST", token: "--dur-fast", duration: "fast" as const },
  { tier: "MID", token: "--dur-mid", duration: "mid" as const },
  { tier: "SLOW", token: "--dur-slow", duration: "slow" as const },
];

/** 缓动对比小球：waapi 引擎注册表（铁律 1），easing 运行时读 :root 动效 token；iterations 有限（2 轮） */
function EaseBall({ token, name, color }: { token: string; name: string; color: string }) {
  const dotRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dot = dotRef.current;
    if (!dot) return;
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue(token).trim() || "linear";
    const h = waapi(
      dot,
      [{ transform: "translateX(0px)" }, { transform: "translateX(336px)" }],
      { duration: 1400, iterations: 2, easing, fill: "both" },
    );
    return () => h.dispose();
  }, [token]);
  return (
    <div
      data-testid={`motion-ease-${name}`}
      style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}
    >
      <span style={{ width: 340, display: "flex", flexDirection: "column", gap: 4 }}>
        <MonoLabel>{token}</MonoLabel>
        <MonoLabel color="var(--text-faint)" size={12} style={{ whiteSpace: "normal" }}>
          <TokenValue token={token} />
        </MonoLabel>
      </span>
      <div style={{ width: 360, height: 32, position: "relative", flexShrink: 0 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 24,
            top: "50%",
            height: 4,
            marginTop: -2,
            background: "var(--surface-3)",
          }}
        />
        <div
          ref={dotRef}
          style={{
            position: "absolute",
            left: 0,
            top: 4,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: color,
            border: "4px solid var(--text)",
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}

function MotionSection() {
  return (
    <Section index="04" title="动效 MOTION">
      {/* ① 时长三档 */}
      <MonoLabel style={{ display: "block", marginBottom: "var(--space-3)" }}>① DURATION · 时长三档</MonoLabel>
      {DUR_TIERS.map((d) => (
        <div
          key={d.tier}
          data-testid={`motion-dur-${d.tier.toLowerCase()}`}
          style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", marginBottom: "var(--space-3)" }}
        >
          <span style={{ width: 340, display: "flex", flexDirection: "column", gap: 4 }}>
            <MonoLabel>{d.tier} · {d.token}</MonoLabel>
            <MonoLabel color="var(--text-faint)" size={12}>
              <TokenValue token={d.token} /> · BarGrow value 0.7
            </MonoLabel>
          </span>
          <div style={{ flex: 1 }}>
            <BarGrow value={0.7} duration={d.duration} data-testid={`motion-dur-${d.tier.toLowerCase()}-bar`} />
          </div>
        </div>
      ))}
      {/* ② 缓动三档 */}
      <MonoLabel style={{ display: "block", margin: "var(--space-5) 0 var(--space-3)" }}>② EASING · 缓动三档</MonoLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <EaseBall token="--ease-in" name="in" color="var(--accent-1)" />
        <EaseBall token="--ease-out" name="out" color="var(--accent-2)" />
        <EaseBall token="--ease-emph" name="emph" color="var(--accent-3)" />
      </div>
      {/* ③ stagger 演示 */}
      <div data-testid="motion-stagger" style={{ marginTop: "var(--space-5)" }}>
        <MonoLabel style={{ display: "block", marginBottom: "var(--space-3)" }}>
          ③ STAGGER · 逐条错峰（--stagger <TokenValue token="--stagger" />，RevealList activeCount 全量）
        </MonoLabel>
        <RevealList
          items={["第一条 · 错峰 0ms", "第二条 · 错峰 +120ms", "第三条 · 错峰 +240ms"]}
          activeCount={3}
          data-testid="motion-stagger-list"
        />
      </div>
      {/* ④ 氛围微动组 */}
      <div data-testid="motion-ambient" style={{ marginTop: "var(--space-5)" }}>
        <MonoLabel style={{ display: "block", marginBottom: "var(--space-3)" }}>
          ④ AMBIENT · 氛围微动组 · 有限周期确定性（可 seek）
        </MonoLabel>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
          <Variant label="BREATHE · cycles 3">
            <Breathe cycles={3} data-testid="motion-ambient-breathe" />
          </Variant>
          <Variant label="SEEDED PARTICLES · seed 7">
            <SeededParticles seed={7} count={30} data-testid="motion-ambient-particles" />
          </Variant>
          <Variant label="KENBURNS · slow">
            <div style={{ width: 320, height: 180 }}>
              <KenBurns duration="slow" data-testid="motion-ambient-kenburns" />
            </div>
          </Variant>
        </div>
      </div>
    </Section>
  );
}

/* ── 05 · 语义组件 SEMANTIC ── */

/** 语义区条目：mono 组件名标注 + 内容 */
function SemItem({ label, children, testid, style }: {
  label: string;
  children: ReactNode;
  testid?: string;
  style?: CSSProperties;
}) {
  return (
    <div data-testid={testid} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", ...style }}>
      <MonoLabel color="var(--text-faint)" size={12}>{label}</MonoLabel>
      {children}
    </div>
  );
}

/** 反色卡内容 token 覆写：BodyCopy 文字落 surface-2（showcase 同款手法） */
const INVERT_TEXT = scope({ "--text": "var(--surface)", "--text-2": "var(--surface-2)" });

function SemanticSection() {
  const cardRowStyle: CSSProperties = { width: 300, display: "flex", flexDirection: "column", gap: "var(--space-2)" };
  return (
    <Section index="05" title="语义组件 SEMANTIC">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <SemItem label="CARD · 三变体（plain 保留 12px 硬阴影语义；featured 24px 档归 marker/数据主角；展示页网格内零阴影/配色覆写属构图级例外）" testid="semantic-card">
          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap" }}>
            <Card variant="plain" style={cardRowStyle}>
              <MonoLabel size={12}>PLAIN</MonoLabel>
              <BodyCopy>奶油底 · 墨框 · 12px 硬阴影</BodyCopy>
            </Card>
            <div style={INVERT_TEXT}>
              <Card variant="invert" style={cardRowStyle}>
                <MonoLabel size={12} color="var(--surface)">INVERT</MonoLabel>
                <BodyCopy>墨底 · 奶油字</BodyCopy>
              </Card>
            </div>
            <div style={INVERT_TEXT}>
              <Card variant="accent" style={cardRowStyle}>
                <MonoLabel size={12} color="var(--surface)">ACCENT</MonoLabel>
                <BodyCopy>绿底 · 奶油字</BodyCopy>
              </Card>
            </div>
          </div>
        </SemItem>
        <SemItem label="TABLE · 三变体（同数据 3 行；columns = 彩色列：pink 墨字 / green cream 字 / orange cream 字；展示页 S4 的表头高 96px/首列 30%/标签列 cream 底为参考 slide 7 构图级例外）" testid="semantic-table">
          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ width: 420 }}>
              <Table
                variant="bordered"
                header={["组件", "变体", "状态"]}
                rows={[["Card", "plain", "✓"], ["Table", "bordered", "✓"], ["Rule", "dashed", "✓"]]}
                data-testid="semantic-table-bordered"
              />
            </div>
            <div style={{ width: 420 }}>
              <Table
                variant="zebra"
                header={["组件", "变体", "状态"]}
                rows={[["Card", "plain", "✓"], ["Table", "zebra", "✓"], ["Rule", "dashed", "✓"]]}
                data-testid="semantic-table-zebra"
              />
            </div>
            <div style={{ width: 760 }}>
              <Table
                variant="columns"
                header={["属性", "方案 A", "方案 B", "方案 C"]}
                rows={[["速度", "快", "更快", "最快"], ["足迹", "轻", "中", "重"], ["投入", "低", "中", "高"]]}
                data-testid="semantic-table-columns"
              />
            </div>
          </div>
        </SemItem>
        <SemItem label="RULE · 两变体" testid="semantic-rule">
          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ width: 320 }}>
              <Rule variant="solid" data-testid="semantic-rule-solid" />
            </div>
            <div style={{ width: 320 }}>
              <Rule variant="dashed" data-testid="semantic-rule-dashed" />
            </div>
          </div>
        </SemItem>
        <SemItem label="KICKER · 两变体" testid="semantic-kicker">
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
            <Kicker variant="block" data-testid="semantic-kicker-block">CHAPTER 01 · 主题</Kicker>
            <Kicker variant="pill" data-testid="semantic-kicker-pill">CHAPTER 01 · 主题</Kicker>
          </div>
        </SemItem>
        <SemItem label="HERO NUMBER · 两变体（countUp=false）" testid="semantic-hero-number">
          <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap", alignItems: "center" }}>
            <HeroNumber value="+47%" variant="plain" data-testid="semantic-hero-number-plain" />
            <HeroNumber value="+47%" variant="accent" data-testid="semantic-hero-number-accent" />
          </div>
        </SemItem>
        <SemItem label="STAT CARD · 三变体" testid="semantic-stat-card">
          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", ...scope({ "--shadow-card": "none" }) }}>
            <StatCard number="+47%" label="打开率" variant="plain" data-testid="semantic-stat-card-plain" />
            <StatCard number="+47%" label="打开率" variant="invert" data-testid="semantic-stat-card-invert" />
            <StatCard number="+47%" label="打开率" variant="accent" data-testid="semantic-stat-card-accent" />
          </div>
        </SemItem>
        <SemItem label="DECOR DOT / BAR / RING · 各变体" testid="semantic-decor">
          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <DecorDot variant="plain" data-testid="semantic-decor-dot-plain" />
              <DecorDot variant="glow" data-testid="semantic-decor-dot-glow" />
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <DecorBar variant="solid" data-testid="semantic-decor-bar-solid" />
              <DecorBar variant="accent" data-testid="semantic-decor-bar-accent" />
            </div>
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <DecorRing variant="outline" data-testid="semantic-decor-ring-outline" />
              <DecorRing variant="filled" data-testid="semantic-decor-ring-filled" />
            </div>
          </div>
        </SemItem>
        <SemItem label="FIGURE · frame / bare / plain（placeholder；frame 保留 24px 硬阴影自然态——展示页 S8 同款；06 格内为目录密度压缩）" testid="semantic-figure">
          <div style={{ display: "flex", gap: "var(--space-6)", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ width: 240 }}>
              <Figure variant="frame" data-testid="semantic-figure-frame" />
            </div>
            <div style={{ width: 240 }}>
              <Figure variant="bare" data-testid="semantic-figure-bare" />
            </div>
            <div style={{ width: 240 }}>
              <Figure variant="plain" data-testid="semantic-figure-plain" />
            </div>
          </div>
        </SemItem>
        <SemItem label="字幕样式 · 字幕 token：--caption-bg / --caption-stroke / --caption-text / --caption-radius / --caption-size（白底 + 4px 粗描边）" testid="semantic-caption">
          <div
            style={{
              display: "inline-block",
              background: "var(--caption-bg)",
              border: "var(--border-w) solid var(--caption-stroke)",
              color: "var(--caption-text)",
              borderRadius: "var(--caption-radius)",
              fontSize: "var(--caption-size)",
              fontFamily: "var(--font-body)",
              padding: "var(--space-2) var(--space-3)",
              lineHeight: 1.3,
              textAlign: "center",
            }}
          >
            字幕样式 · caption tokens
          </div>
        </SemItem>
      </div>
    </Section>
  );
}

/* ── 06 · 组件全览 COMPONENTS（30 组件 × 全变体） ── */

/** 组件格：cream 底 + 4px 墨框 + 字阶压缩 scope；容器仅 inline 布局属性（零裸色） */
function CompCell({ name, extraScope, children }: {
  name: string;
  extraScope?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`comp-cell-${name}`}
      style={{
        ...scope(CELL_SCOPE),
        ...scope(extraScope ?? {}),
        background: "var(--surface)",
        border: "4px solid var(--text)",
        boxSizing: "border-box",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          lineHeight: 1,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text)",
          paddingBottom: "var(--space-2)",
          borderBottom: "2px solid var(--surface-2)",
        }}
      >
        {name}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "flex-start" }}>
        {children}
      </div>
    </div>
  );
}

function CompGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--space-5)" }}>
      <MonoLabel color="var(--text-mute)" style={{ display: "block", marginBottom: "var(--space-3)" }}>
        {label}
      </MonoLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "var(--space-3)",
          alignItems: "stretch",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ComponentsSection() {
  const tableData = { header: ["组件", "变体"], rows: [["Card", "plain"], ["Table", "zebra"]] };
  const stepData = [{ title: "进场" }, { title: "节奏" }, { title: "收束" }];
  return (
    <Section index="06" title="组件全览 COMPONENTS">
      <CompGroup label="TEXT · 文字（5）">
        <CompCell name="hero-title">
          <Variant label="plain"><HeroTitle data-testid="variant-hero-title-plain" style={{ fontSize: 56, lineHeight: 0.92 }}>口播视频</HeroTitle></Variant>
          <Variant label="stamp"><HeroTitle variant="stamp" data-testid="variant-hero-title-stamp" style={{ fontSize: 28, lineHeight: 1, padding: "8px 14px" }}>口播视频</HeroTitle></Variant>
          <MonoLabel color="var(--text-faint)" size={12}>构图级例外：展示页 stamp 阴影色按 featured 纪律覆写（每屏 2-3 强调色）</MonoLabel>
        </CompCell>
        <CompCell name="kicker">
          <Variant label="plain"><Kicker variant="plain" data-testid="variant-kicker-plain">CHAPTER 01</Kicker></Variant>
          <Variant label="block"><Kicker variant="block" data-testid="variant-kicker-block">CHAPTER 01</Kicker></Variant>
          <Variant label="pill"><Kicker variant="pill" data-testid="variant-kicker-pill">CHAPTER 01</Kicker></Variant>
        </CompCell>
        <CompCell name="body-copy">
          <Variant label="plain"><BodyCopy data-testid="variant-body-copy-plain">口播视频的节奏，由稿子决定。</BodyCopy></Variant>
          <Variant label="lede"><BodyCopy variant="lede" data-testid="variant-body-copy-lede">口播视频的节奏，由稿子决定。</BodyCopy></Variant>
        </CompCell>
        <CompCell name="quote-block">
          <Variant label="rule"><QuoteBlock variant="rule" data-testid="variant-quote-block-rule">把口播稿做成会动的网页</QuoteBlock></Variant>
          <Variant label="block"><QuoteBlock variant="block" data-testid="variant-quote-block-block">把口播稿做成会动的网页</QuoteBlock></Variant>
        </CompCell>
        <CompCell name="number-pill">
          <Variant label="plain"><NumberPill number="01" data-testid="variant-number-pill-plain" /></Variant>
          <Variant label="accent"><NumberPill number="02" variant="accent" data-testid="variant-number-pill-accent" /></Variant>
          <Variant label="invert"><NumberPill number="03" variant="invert" data-testid="variant-number-pill-invert" /></Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="DATA · 数据（5）">
        <CompCell name="hero-number">
          <Variant label="plain"><HeroNumber value="+47%" variant="plain" data-testid="variant-hero-number-plain" /></Variant>
          <Variant label="accent"><HeroNumber value="+47%" variant="accent" data-testid="variant-hero-number-accent" /></Variant>
        </CompCell>
        <CompCell name="counter">
          <Variant label="default · 挂载滚动 0→47"><Counter to={47} data-testid="variant-counter-default" /></Variant>
          <MonoLabel color="var(--text-faint)" size={12}>构图级例外：展示页 S3 底部小卡 --t-display-2 48px 档（密度裁量）</MonoLabel>
        </CompCell>
        <CompCell name="bar-grow">
          <Variant label="solid"><div style={{ width: 240 }}><BarGrow value={0.7} variant="solid" data-testid="variant-bar-grow-solid" /></div></Variant>
          <Variant label="accent"><div style={{ width: 240 }}><BarGrow value={0.7} variant="accent" data-testid="variant-bar-grow-accent" /></div></Variant>
          <MonoLabel color="var(--text-faint)" size={12}>构图级例外：展示页 S5 柱状图行高 56px（图表密度 dev 微调），组件原生 24px</MonoLabel>
        </CompCell>
        <CompCell name="donut-meter">
          <Variant label="default · value 0.42"><DonutMeter value={0.42} label="转化率" data-testid="variant-donut-meter-default" /></Variant>
        </CompCell>
        <CompCell name="stat-card" extraScope={{ "--t-display-2": "32px" }}>
          <Variant label="plain"><StatCard number="+47%" label="打开率" variant="plain" data-testid="variant-stat-card-plain" /></Variant>
          <Variant label="invert"><StatCard number="+47%" label="打开率" variant="invert" data-testid="variant-stat-card-invert" /></Variant>
          <Variant label="accent"><StatCard number="+47%" label="打开率" variant="accent" data-testid="variant-stat-card-accent" /></Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="STRUCTURE · 结构（5）">
        <CompCell name="card">
          <Variant label="plain"><Card variant="plain" data-testid="variant-card-plain" style={{ width: 150, padding: 16 }}><BodyCopy>奶油底</BodyCopy></Card></Variant>
          <Variant label="invert"><div style={INVERT_TEXT}><Card variant="invert" data-testid="variant-card-invert" style={{ width: 150, padding: 16 }}><BodyCopy>墨底</BodyCopy></Card></div></Variant>
          <Variant label="accent"><div style={INVERT_TEXT}><Card variant="accent" data-testid="variant-card-accent" style={{ width: 150, padding: 16 }}><BodyCopy>绿底</BodyCopy></Card></div></Variant>
        </CompCell>
        <CompCell name="rule">
          <Variant label="solid"><div style={{ width: 240 }}><Rule variant="solid" data-testid="variant-rule-solid" /></div></Variant>
          <Variant label="dashed"><div style={{ width: 240 }}><Rule variant="dashed" data-testid="variant-rule-dashed" /></div></Variant>
        </CompCell>
        <CompCell name="grid">
          <Variant label="even · columns 3">
            <Grid variant="even" columns={3} data-testid="variant-grid-even" style={{ width: 280 }}>
              <div style={{ height: 40, background: "var(--accent-2)" }} />
              <div style={{ height: 40, background: "var(--accent-4)" }} />
              <div style={{ height: 40, background: "var(--accent-1)" }} />
            </Grid>
          </Variant>
          <Variant label="half">
            <Grid variant="half" data-testid="variant-grid-half" style={{ width: 280 }}>
              <div style={{ height: 40, background: "var(--accent-4)" }} />
              <div style={{ height: 40, background: "var(--accent-1)" }} />
            </Grid>
          </Variant>
        </CompCell>
        <CompCell name="stage-pad">
          <Variant label="default · 96/64 消费端（格内覆写 16px）">
            <div
              style={{
                position: "relative",
                width: 240,
                height: 120,
                border: "2px dashed var(--surface-3)",
                boxSizing: "border-box",
                ...scope({ "--stage-pad-x": "16px", "--stage-pad-y": "16px" }),
              }}
            >
              <StagePad data-testid="variant-stage-pad-default">
                <DecorBar variant="accent" />
              </StagePad>
            </div>
          </Variant>
        </CompCell>
        <CompCell name="table">
          <Variant label="bordered"><Table variant="bordered" {...tableData} data-testid="variant-table-bordered" /></Variant>
          <Variant label="zebra"><Table variant="zebra" {...tableData} data-testid="variant-table-zebra" /></Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="REVEAL · 揭示（3）">
        <CompCell name="reveal-text">
          <Variant label="words"><RevealText text="逐词 揭示 测试" variant="words" data-testid="variant-reveal-text-words" /></Variant>
          <Variant label="mask"><RevealText text="逐词 揭示 测试" variant="mask" data-testid="variant-reveal-text-mask" /></Variant>
        </CompCell>
        <CompCell name="reveal-list">
          <Variant label="plain">
            <RevealList items={["口播稿 → 步进节奏", "组件构图 → 主题 token", "动画 → 引擎驱动"]} activeCount={3} variant="plain" data-testid="variant-reveal-list-plain" />
          </Variant>
          <Variant label="numbered">
            <RevealList items={["口播稿 → 步进节奏", "组件构图 → 主题 token", "动画 → 引擎驱动"]} activeCount={3} variant="numbered" data-testid="variant-reveal-list-numbered" />
          </Variant>
        </CompCell>
        <CompCell name="step-sequence">
          <Variant label="plain"><StepSequence steps={stepData} currentStep={1} variant="plain" data-testid="variant-step-sequence-plain" /></Variant>
          <Variant label="cards"><StepSequence steps={stepData} currentStep={1} variant="cards" data-testid="variant-step-sequence-cards" /></Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="DECOR · 装饰（4）">
        <CompCell name="decor-dot">
          <Variant label="plain"><DecorDot variant="plain" data-testid="variant-decor-dot-plain" /></Variant>
          <Variant label="glow"><DecorDot variant="glow" data-testid="variant-decor-dot-glow" /></Variant>
        </CompCell>
        <CompCell name="decor-bar">
          <Variant label="solid"><DecorBar variant="solid" data-testid="variant-decor-bar-solid" /></Variant>
          <Variant label="accent"><DecorBar variant="accent" data-testid="variant-decor-bar-accent" /></Variant>
        </CompCell>
        <CompCell name="decor-ring">
          <Variant label="outline"><DecorRing variant="outline" data-testid="variant-decor-ring-outline" /></Variant>
          <Variant label="filled"><DecorRing variant="filled" data-testid="variant-decor-ring-filled" /></Variant>
        </CompCell>
        <CompCell name="stacked-blocks">
          <Variant label="default · 4×160 错位叠放"><StackedBlocks data-testid="variant-stacked-blocks-default" /></Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="MEDIA · 素材（3）">
        <CompCell name="figure">
          <Variant label="frame"><div style={{ width: 220 }}><Figure variant="frame" className="sg-figure-short" data-testid="variant-figure-frame" /></div></Variant>
          <Variant label="bare"><div style={{ width: 220 }}><Figure variant="bare" className="sg-figure-short" data-testid="variant-figure-bare" /></div></Variant>
          <Variant label="plain"><div style={{ width: 220 }}><Figure variant="plain" className="sg-figure-short" data-testid="variant-figure-plain" /></div></Variant>
          <Variant label="ratio 3 / 4（组件级 aspect）"><div style={{ width: 140 }}><Figure variant="frame" ratio="3 / 4" data-testid="variant-figure-ratio" /></div></Variant>
        </CompCell>
        <CompCell name="typed-terminal">
          <Variant label="default · 打字挂载即播">
            <TypedTerminal lines={["styleguide --mode creative", "28 components · variants"]} data-testid="variant-typed-terminal-default" />
          </Variant>
        </CompCell>
        <CompCell name="path-draw">
          <Variant label="stroke"><div style={{ width: 180 }}><PathDraw d="M 8 88 L 30 20 L 55 60 L 92 12" variant="stroke" data-testid="variant-path-draw-stroke" /></div></Variant>
          <Variant label="filled"><div style={{ width: 180 }}><PathDraw d="M 8 88 L 30 20 L 55 60 L 92 12" variant="filled" data-testid="variant-path-draw-filled" /></div></Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="AMBIENT · 氛围（3）">
        <CompCell name="seeded-particles">
          <Variant label="drift"><SeededParticles seed={7} count={30} variant="drift" className="sg-particles-scaled" data-testid="variant-seeded-particles-drift" /></Variant>
          <Variant label="static"><SeededParticles seed={7} count={30} variant="static" className="sg-particles-scaled" data-testid="variant-seeded-particles-static" /></Variant>
        </CompCell>
        <CompCell name="breathe">
          <Variant label="pulse"><Breathe cycles={3} variant="pulse" data-testid="variant-breathe-pulse" /></Variant>
          <Variant label="glow"><Breathe cycles={3} variant="glow" data-testid="variant-breathe-glow" /></Variant>
        </CompCell>
        <CompCell name="ken-burns">
          <Variant label="default · 缓推">
            <div style={{ width: 240, height: 135 }}>
              <KenBurns duration="mid" data-testid="variant-ken-burns-default" />
            </div>
          </Variant>
          <Variant label="framed · 4px 墨框无阴影（十五轮 F1）">
            <div style={{ width: 240, height: 135 }}>
              <KenBurns duration="mid" variant="framed" data-testid="variant-ken-burns-framed" />
            </div>
          </Variant>
        </CompCell>
      </CompGroup>
      <CompGroup label="FUNCTION · 功能（2）">
        <CompCell name="timeline-track">
          <Variant label="line"><TimelineTrack points={["稿", "镜", "画", "声", "片"]} activeIndex={2} variant="line" data-testid="variant-timeline-track-line" /></Variant>
          <Variant label="nodes"><TimelineTrack points={["稿", "镜", "画", "声", "片"]} activeIndex={2} variant="nodes" data-testid="variant-timeline-track-nodes" /></Variant>
        </CompCell>
        <CompCell name="progress-dots">
          <Variant label="dots"><ProgressDots total={5} current={2} variant="dots" data-testid="variant-progress-dots-dots" /></Variant>
          <Variant label="bars"><ProgressDots total={5} current={2} variant="bars" data-testid="variant-progress-dots-bars" /></Variant>
        </CompCell>
      </CompGroup>
    </Section>
  );
}

/** 组件格结构性微调（零颜色，仅尺寸/裁切）；dev 页自含 <style>，不入组件 CSS */
const CELL_TWEAKS = `
.sg-figure-short .cdp-figure-placeholder { min-height: 140px; }
.sg-particles-scaled canvas { width: 240px; height: 180px; }
`;

/** 样式词典页（?styleguide=1 dev-only 验收工具，与 ThemeShowcase / FontPreview 同级） */
export function StyleGuide() {
  return (
    <div
      style={{
        ...scope({ "--font-mono": MONO_CN }),
        minHeight: "100vh",
        background: "var(--shell)",
        padding: "64px 0 120px",
      }}
    >
      <style>{CELL_TWEAKS}</style>
      <header
        style={{
          width: 1920,
          margin: "0 auto 72px",
          padding: "0 96px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            lineHeight: 1,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--surface)",
          }}
        >
          creative-mode · 样式词典 · 全部 token 视觉表达 + 30 组件目录
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            lineHeight: 1,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--surface)",
            border: "2px solid var(--surface)",
            borderRadius: 999,
            padding: "6px 14px",
          }}
        >
          DEV-ONLY · ?styleguide=1
        </span>
      </header>
      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-6)" }}>
        <PaletteSection />
        <TypographySection />
        <SpacingSection />
        <MotionSection />
        <SemanticSection />
        <ComponentsSection />
      </main>
    </div>
  );
}
