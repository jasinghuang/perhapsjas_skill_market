// 主题效果页（M2b 验收用；dev-only，不入章节层）。
// ?showcase=1 渲染：4 屏 1920×1080 slide deck——每屏带统一 chrome frame
// （topbar 48px/64px + meta footer 40px/64px + 96px 内容 gutter），
// 严守用色纪律（每屏 2-3 个强调色、硬阴影只给 featured 单元素），28 组件全部出场且各有构图角色。
// 舞台尺寸 / chrome frame / 印章等 dev 工具页家具用 inline style；场景内构图与配色走组件 + token，
// 需要局部配色时用 scope() 注入 CSS 自定义属性（token 覆写，不改组件本体）。
import type { CSSProperties, ReactNode } from "react";
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
  PathDraw,
  ProgressDots,
  QuoteBlock,
  RevealList,
  RevealText,
  Rule,
  SeededParticles,
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

/** 24px 双层硬阴影（featured 专用；offset 色按屏纪律选） */
const SHADOW_ORANGE = "24px 24px 0 var(--accent-3), 24px 24px 0 4px var(--surface-3)";
const SHADOW_GREEN = "24px 24px 0 var(--accent-1), 24px 24px 0 4px var(--surface-3)";
const SHADOW_PINK = "24px 24px 0 var(--accent-2), 24px 24px 0 4px var(--surface-3)";

/* ── chrome frame（每屏必有） ── */
interface SlideShellProps {
  index: string; // "01".."04"
  topbar: ReactNode;
  pill: string;
  meta: ReactNode;
  bg?: string; // 屏底色（默认 cream；S4 绿底）
  shadow?: string; // 舞台浮起硬阴影（offset 色按屏纪律）
  invert?: boolean; // 绿底屏 chrome 反色（cream 字 + cream 框 pill）
  children: ReactNode;
}

function SlideShell({
  index,
  topbar,
  pill,
  meta,
  bg = "var(--surface)",
  shadow = SHADOW_ORANGE,
  invert = false,
  children,
}: SlideShellProps) {
  const chrome = invert ? "var(--surface)" : "var(--surface-3)";
  return (
    <section
      data-testid={`slide-${index}`}
      style={{
        ...scope({ "--font-mono": MONO_CN }),
        position: "relative",
        width: 1920,
        height: 1080,
        flexShrink: 0,
        boxSizing: "border-box",
        background: bg,
        border: "4px solid var(--surface-3)",
        boxShadow: shadow,
        overflow: "hidden",
      }}
    >
      {/* topbar：48px top / 64px 两侧；左 mono 标签（0.08em 字距）+ 右 pill（2px 墨框 999 圆角） */}
      <div
        data-testid="chrome-topbar"
        style={{
          position: "absolute",
          top: 48,
          left: 64,
          right: 64,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: MONO_CN,
            fontSize: 24,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: chrome,
            whiteSpace: "nowrap",
          }}
        >
          {topbar}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: chrome,
            border: `2px solid ${chrome}`,
            borderRadius: 999,
            padding: "6px 14px",
            whiteSpace: "nowrap",
          }}
        >
          {pill}
        </span>
      </div>
      {/* 内容层：StagePad（96px 内容 gutter）+ 高度减让（为 meta 带留净空，内容底 ≤ 996） */}
      <StagePad>
        <div
          style={{
            height: "calc(100% - var(--space-5))",
            display: "flex",
            flexDirection: "column",
            paddingTop: "var(--space-4)",
            paddingBottom: "var(--space-3)",
          }}
        >
          {children}
        </div>
      </StagePad>
      {/* meta footer：40px bottom / 64px 两侧；左描述 + 右 "0N · 04"（10px 墨点分隔） */}
      <div
        data-testid="chrome-meta"
        style={{
          position: "absolute",
          bottom: 40,
          left: 64,
          right: 64,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: MONO_CN,
            fontSize: 24,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: chrome,
            whiteSpace: "nowrap",
          }}
        >
          {meta}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            letterSpacing: "0.06em",
            color: chrome,
          }}
        >
          <span>{index}</span>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: chrome }} />
          <span>04</span>
        </span>
      </div>
    </section>
  );
}

/* ── Slide 1 · 封面（强调色：pink + orange） ── */
function CoverSlide() {
  return (
    <SlideShell
      index="01"
      topbar="CREATIVE MODE · 创意模式"
      pill="SHOWCASE / M2B"
      meta="主题效果页 · 首套主题"
    >
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "var(--space-5)",
        }}
      >
        <Kicker variant="block">CHAPTER 01 · 主题</Kicker>
        {/* 主标题区（featured）：marker-block 式——pink 底 + 24px 双层硬阴影（orange 偏移 + 4px ink 描边） */}
        <div
          data-testid="featured-title"
          style={{
            background: "var(--accent-2)",
            border: "4px solid var(--surface-3)",
            padding: "40px 56px",
            boxShadow: SHADOW_ORANGE,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display-en)",
              fontSize: 160,
              lineHeight: 0.92,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              color: "var(--surface-3)",
            }}
          >
            CREATIVE
          </div>
          <div
            style={{
              fontFamily: "var(--font-display-cn)",
              fontWeight: 900,
              fontSize: 160,
              lineHeight: 1,
              color: "var(--surface-3)",
              marginTop: 12,
            }}
          >
            创意模式
          </div>
        </div>
        {/* 装饰行：accent 色条 + glow 圆点 + solid 色条 */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "auto" }}>
          <DecorBar variant="accent" style={{ background: "var(--accent-2)" }} />
          <DecorDot variant="glow" style={{ background: "var(--accent-2)", boxShadow: "0 0 var(--space-4) var(--accent-2)" }} />
          <DecorBar variant="solid" />
        </div>
        {/* 宣言（pink 底墨字） */}
        <QuoteBlock variant="block" style={{ background: "var(--accent-2)", color: "var(--surface-3)" }}>
          把口播稿，做成会动的网页。
        </QuoteBlock>
        {/* 印章（右下角）：pink 方块 -6deg + cream 圆环 + 40px mono 小字 */}
        <div
          data-testid="stamp"
          style={{
            position: "absolute",
            right: 24,
            bottom: 16,
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
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 40,
                letterSpacing: "0.08em",
                color: "var(--surface-3)",
              }}
            >
              M2B
            </span>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 2 · 数据冲击（强调色：pink + yellow + green，orange 不出场） ── */
function DataSlide() {
  return (
    <SlideShell
      index="02"
      topbar="DATA · 数据冲击"
      pill="STAT CELLS"
      meta="配色序列 · 以绿收尾"
      shadow={SHADOW_GREEN}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <HeroTitle reveal="rise" style={{ fontSize: "var(--t-h1)", lineHeight: 1 }}>
          数据冲击
        </HeroTitle>
        {/* stat cells 一行 4 格：网格单元零阴影（设计铁律）；序列 pink → yellow → cream → green 以绿收尾 */}
        <Grid
          variant="even"
          columns={4}
          data-testid="stat-grid"
          style={scope({ "--shadow-card": "none", "--text-mute": "var(--text)" })}
        >
          <div style={scope({ "--card-bg": "var(--accent-2)" })}>
            <StatCard number="+47%" label="打开率" variant="plain" />
          </div>
          <div style={scope({ "--card-bg": "var(--accent-4)" })}>
            <StatCard number="12x" label="产出" variant="plain" />
          </div>
          <StatCard number="3.2s" label="首屏" variant="plain" />
          <StatCard number="98%" label="贴合" variant="accent" />
        </Grid>
        {/* 数据行：动效完成度条 + 帧计数器 + 转化率环 + featured 大数字（本行唯一硬阴影；marginBottom 让阴影收在 meta 带之上） */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)", marginTop: "auto", marginBottom: "var(--space-4)" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Kicker variant="block" style={{ alignSelf: "flex-start" }}>
              70% · 动效完成度
            </Kicker>
            <BarGrow value={0.7} variant="accent" />
          </div>
          <Card variant="plain" style={{ boxShadow: "none" }}>
            <Kicker variant="block">FRAMES</Kicker>
            <Counter to={47} />
          </Card>
          <DonutMeter value={0.42} label="转化率" />
          <div
            data-testid="featured-hero"
            style={{
              background: "var(--surface)",
              border: "4px solid var(--surface-3)",
              padding: "var(--space-4)",
              boxShadow: SHADOW_GREEN,
            }}
          >
            <HeroNumber value="+47%" variant="accent" countUp />
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 3 · 流程（强调色：orange + green） ── */

/** 流程步骤卡（cream → ink → green 收尾；current = 本屏 featured 硬阴影 + -4deg NOW 徽章） */
function StepCard({
  index,
  title,
  desc,
  tone,
  current = false,
}: {
  index: string;
  title: string;
  desc: string;
  tone: "cream" | "ink" | "green";
  current?: boolean;
}) {
  const variant = tone === "cream" ? "plain" : tone === "ink" ? "invert" : "accent";
  const muted = tone === "cream" ? "var(--text-mute)" : "var(--surface-2)";
  return (
    <Card
      variant={variant}
      data-testid={`step-card-${tone}`}
      style={{
        boxShadow: current ? SHADOW_ORANGE : "none",
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
      }}
    >
      {current ? (
        <span
          style={{
            position: "absolute",
            top: -20,
            right: 20,
            background: "var(--accent-3)",
            color: "var(--surface)",
            border: "4px solid var(--surface-3)",
            padding: "4px 12px",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: "0.1em",
            transform: "rotate(-4deg)",
          }}
        >
          NOW
        </span>
      ) : null}
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em", color: muted }}>
        {index}
      </span>
      <div style={{ fontFamily: "var(--font-display-cn)", fontWeight: 900, fontSize: 40, lineHeight: 1 }}>
        {title}
      </div>
      <BodyCopy style={tone === "cream" ? undefined : { color: "var(--surface-2)" }}>{desc}</BodyCopy>
    </Card>
  );
}

/** 步骤箭头（step-arrow：border 三角） */
function StepArrow() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 0,
        height: 0,
        borderTop: "18px solid transparent",
        borderBottom: "18px solid transparent",
        borderLeft: "24px solid var(--surface-3)",
        alignSelf: "center",
        flexShrink: 0,
      }}
    />
  );
}

function FlowSlide() {
  return (
    <SlideShell index="03" topbar="FLOW · 流程" pill="THREE STEPS" meta="三步管线 · 组件流程">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <HeroTitle reveal="rise" style={{ fontSize: "var(--t-h1)", lineHeight: 1 }}>
          从稿子到成片
        </HeroTitle>
        {/* 流程 slide 的 signature：3px dashed 墨线分隔 */}
        <Rule variant="dashed" data-testid="flow-rule" style={scope({ "--rule-w": "3px", margin: "0 0 var(--space-1)" })} />
        <div data-testid="step-cards" style={{ display: "flex", alignItems: "stretch", gap: "var(--space-3)" }}>
          <StepCard index="01" title="稿子" desc="口播稿定节奏" tone="cream" />
          <StepArrow />
          <StepCard index="02" title="分镜" desc="每句一步视觉" tone="ink" current />
          <StepArrow />
          <StepCard index="03" title="成片" desc="录制导出成片" tone="green" />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-6)", marginTop: "auto" }}>
          <div style={{ flex: 1 }}>
            <RevealList
              items={["口播稿 → 步进节奏", "组件构图 → 主题 token", "动画 → 引擎驱动"]}
              activeCount={3}
              variant="numbered"
            />
          </div>
          <div style={{ width: 680, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {/* orange 角色：时间轴与进度点（token 覆写 --accent-1 → orange） */}
            <div data-testid="timeline-orange" style={scope({ "--accent-1": "var(--accent-3)" })}>
              <TimelineTrack points={["稿", "镜", "画", "声", "片"]} activeIndex={3} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <div style={scope({ "--accent-1": "var(--accent-3)" })}>
                <ProgressDots total={5} current={4} />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 18,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-mute)",
                }}
              >
                PIPELINE · 五节点
              </span>
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 4 · 工具箱（绿底 slide；强调色：pink 点缀） ── */

/** 工具箱网格单元：cream 反色 mono 标注 + 内容 */
function ToolCell({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", ...style }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          lineHeight: 1,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--surface)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function ToolkitSlide() {
  return (
    <SlideShell
      index="04"
      topbar="TOOLKIT · 工具箱"
      pill="28 COMPONENTS"
      meta="28 组件 · 各归其位"
      bg="var(--accent-1)"
      shadow={SHADOW_PINK}
      invert
    >
      {/* 整屏粒子尘：canvas 绘制色读 :root --accent-1（绿），绿底不可见——
          dev 页 filter invert 转粉系尘点（S4 强调色纪律内），等比拉伸不变形 */}
      <div
        data-testid="particles-layer"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: 1440,
          opacity: 0.25,
          pointerEvents: "none",
          filter: "invert(1)",
        }}
      >
        <SeededParticles seed={42} count={40} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {/* headline：HeroTitle stamp 变体（墨底 cream 字——绿底上的对比组合；pink 硬阴影 = 本屏 featured） */}
        <HeroTitle
          variant="stamp"
          reveal="rise"
          style={{ fontSize: 72, lineHeight: 1, padding: "16px 24px", boxShadow: SHADOW_PINK }}
        >
          组件工具箱
        </HeroTitle>
        <Grid variant="even" columns={3} data-testid="toolkit-grid">
          <ToolCell label="FIGURE · 素材占位" style={{ gridRow: "span 2" }}>
            <div style={scope({ "--shadow-card": "none" })}>
              <Figure variant="frame" />
            </div>
          </ToolCell>
          <ToolCell label="TERMINAL · 打字机">
            <TypedTerminal lines={["creative-mode --showcase", "28 components · toolkit"]} />
          </ToolCell>
          <ToolCell label="PATH · 折线自绘">
            <div style={{ width: 180, ...scope({ "--accent-1": "var(--accent-2)" }) }}>
              <PathDraw d="M 8 88 L 30 20 L 55 60 L 92 12" />
            </div>
          </ToolCell>
          <ToolCell label="TABLE · 表格">
            <div style={{ background: "var(--surface-2)", border: "4px solid var(--surface-3)" }}>
              <Table header={["组件", "角色", "状态"]} rows={[["Table", "数据表", "bordered"]]} variant="bordered" />
            </div>
          </ToolCell>
          <ToolCell label="QUOTE · 引用块">
            <QuoteBlock
              variant="block"
              style={{ background: "var(--accent-2)", color: "var(--surface-3)", fontSize: 36 }}
            >
              粉色点缀 · 一处就好
            </QuoteBlock>
          </ToolCell>
          <ToolCell label="STEPS · 步骤序列">
            <div style={scope({ "--accent-1": "var(--surface)", "--t-h3": "32px", "--space-3": "16px" })}>
              <StepSequence variant="plain" currentStep={1} steps={[{ title: "进场" }, { title: "节奏" }, { title: "收束" }]} />
            </div>
          </ToolCell>
          <ToolCell label="REVEAL · 逐词揭示">
            <div style={scope({ "--text": "var(--surface)" })}>
              <RevealText text="逐词 揭示 测试" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <div style={scope({ "--accent-1": "var(--accent-2)" })}>
                <Breathe cycles={3} />
              </div>
              <DecorRing variant="outline" />
            </div>
          </ToolCell>
          <ToolCell label="KENBURNS · 缓推">
            <div style={{ width: 480, height: 270 }}>
              <KenBurns duration="slow" />
            </div>
          </ToolCell>
        </Grid>
      </div>
    </SlideShell>
  );
}

/** 主题效果页（?showcase=1 dev-only 验收工具，与 FontPreview 同级） */
export function ThemeShowcase() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shell)", paddingTop: 64, paddingBottom: 120 }}>
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
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--surface)",
          }}
        >
          creative-mode · 主题效果页 · 4 屏 slide deck
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--surface)",
            border: "2px solid var(--surface)",
            borderRadius: 999,
            padding: "6px 14px",
          }}
        >
          DEV-ONLY · ?showcase=1
        </span>
      </header>
      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 96 }}>
        <CoverSlide />
        <DataSlide />
        <FlowSlide />
        <ToolkitSlide />
      </main>
    </div>
  );
}
