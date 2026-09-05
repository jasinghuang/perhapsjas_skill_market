// 主题效果页（M2b 验收用；dev-only，不入章节层）。
// ?showcase=1 渲染：5 屏 1920×1080 slide deck——每屏带统一 chrome frame
// （topbar 48px/64px + meta footer 40px/64px + 内容带 96px gutter、垂直 y 112–992）。
// 构图纪律（用户反馈终审）：屏 2-5 严格复刻 creative-mode 参考构图——
// S2 = 参考 s3 数据屏（2×2 满幅零阴影网格）；S3 = 参考 s6 流程屏（4 步卡 + dashed 线，箭头已按用户拍板删除）；
// S4 = 参考 s7 对比屏（彩色列表格，徽章已按用户拍板删除）；S5 = 参考 s8 收尾屏（绿底 + stamp 标题 + 印章）。
// 安全框规格（用户终审裁定）：① chrome 元素水平距边缘 ≥64px；② 内容元素落在内容带内
// （24px 阴影落点亦算占位，不越界）；③ 氛围背景层豁免。
// ?showcase=1&guides=1 叠加安全框参考线（96 内容带 + 64 chrome 带，pointerEvents none）。
// 严守用色纪律（每屏 2-3 个强调色）；舞台尺寸 / chrome frame / 印章等 dev 工具页家具用 inline style；
// 场景内构图与配色走组件 + token，需要局部配色时用 scope() 注入 CSS 自定义属性（token 覆写，不改组件本体）。
import type { CSSProperties, ReactNode } from "react";
import {
  BarGrow,
  BodyCopy,
  Card,
  Counter,
  DecorBar,
  DecorDot,
  DonutMeter,
  Grid,
  HeroNumber,
  HeroTitle,
  Kicker,
  ProgressDots,
  QuoteBlock,
  Rule,
  SeededParticles,
  StagePad,
  Table,
  TimelineTrack,
} from "./components";

/** 局部 token 覆写：向子树注入 CSS 自定义属性（dev 页合法手段，不改组件本体） */
const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

/** 含中文的 mono 文案字体栈：拉丁走 JetBrains Mono，CJK 落 Noto Sans SC（避免 generic monospace 抢先命中） */
const MONO_CN = '"JetBrains Mono", "Noto Sans SC", "SF Mono", monospace';

/** 24px 双层硬阴影（featured 专用；offset 色按屏纪律选） */
const SHADOW_ORANGE = "24px 24px 0 var(--accent-3), 24px 24px 0 4px var(--surface-3)";
const SHADOW_PINK = "24px 24px 0 var(--accent-2), 24px 24px 0 4px var(--surface-3)";

/** dev 页结构性微调（零颜色，仅尺寸）；自含 <style>，不入组件 CSS */
const SHOWCASE_TWEAKS = `
.sg-compare-table { height: 100%; }
.sg-compare-table thead th { height: 96px; }
.sg-compare-table thead th:first-child, .sg-compare-table tbody td:first-child { width: 30%; }
.sg-compare-table tbody td:first-child { background: var(--surface); font-weight: 700; }
`;

/* ── 安全框可视化（?showcase=1&guides=1 dev-only） ── */

/** 模块加载时读一次查询参数（与 main.tsx 的 showcase 短路同级，dev 页专用） */
const GUIDES_ON = new URLSearchParams(window.location.search).has("guides");

/**
 * 安全框参考线：96px 内容带（x 96/1824 · y 112/992）+ 64px chrome 带（x 64/1856 · topbar 48 / meta 40）。
 * 纯视觉叠加层：pointerEvents none，不参与布局、不遮挡交互。
 */
function SafetyGuides({ color }: { color: string }) {
  if (!GUIDES_ON) return null;
  const line: CSSProperties = { position: "absolute", pointerEvents: "none" };
  const label: CSSProperties = {
    position: "absolute",
    fontFamily: "var(--font-mono)",
    fontSize: 16,
    lineHeight: 1,
    color,
    pointerEvents: "none",
    whiteSpace: "nowrap",
  };
  return (
    <div data-testid="safety-guides" style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}>
      {/* chrome 带 64：两侧竖线 + topbar/meta 上下线 */}
      <div style={{ ...line, top: 0, bottom: 0, left: 64, borderLeft: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 0, bottom: 0, right: 64, borderRight: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 48, left: 64, right: 64, borderTop: `2px dashed ${color}` }} />
      <div style={{ ...line, bottom: 40, left: 64, right: 64, borderTop: `2px dashed ${color}` }} />
      {/* 内容带 96：两侧竖线 + 顶 112 / 底 992 限位线 */}
      <div style={{ ...line, top: 0, bottom: 0, left: 96, borderLeft: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 0, bottom: 0, right: 96, borderRight: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 112, left: 96, right: 96, borderTop: `2px dashed ${color}` }} />
      <div style={{ ...line, bottom: 80, left: 96, right: 96, borderTop: `2px dashed ${color}` }} />
      {/* mono 小标注 */}
      <span style={{ ...label, top: 8, left: 68 }}>CHROME 64</span>
      <span style={{ ...label, top: 8, left: 252 }}>CONTENT 96</span>
      <span style={{ ...label, top: 8, right: 68 }}>64</span>
      <span style={{ ...label, top: 8, right: 100 }}>96</span>
      <span style={{ ...label, top: 96, left: 100 }}>112</span>
      <span style={{ ...label, bottom: 62, left: 100 }}>992</span>
    </div>
  );
}

/* ── chrome frame（每屏必有） ── */
interface SlideShellProps {
  index: string; // "01".."05"
  topbar: ReactNode;
  pill: string;
  meta: ReactNode;
  bg?: string; // 屏底色（默认 cream；S5 绿底）
  invert?: boolean; // 绿底屏 chrome 反色（cream 字 + cream 框 pill）
  children: ReactNode;
}

function SlideShell({
  index,
  topbar,
  pill,
  meta,
  bg = "var(--surface)",
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
        border: "4px solid var(--surface-3)", // 画布边框（非投影；画布无彩色投影——F2 裁定）
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
            lineHeight: "24px",
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
            lineHeight: "24px",
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
      {/* 内容层：StagePad（96px gutter）+ 安全框内容带（topbar 底 88 + 24 = 顶 112；
          meta 顶 1016 − 24 = 底 992） */}
      <StagePad>
        <div
          style={{
            height: "calc(100% - var(--stage-pad-y))",
            display: "flex",
            flexDirection: "column",
            paddingTop: "var(--space-5)",
            paddingBottom: "var(--space-3)",
          }}
        >
          {children}
        </div>
      </StagePad>
      {/* meta footer：40px bottom / 64px 两侧；左描述 + 右 "0N · 05"（10px 墨点分隔） */}
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
            lineHeight: "24px",
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
            lineHeight: "24px",
            letterSpacing: "0.06em",
            color: chrome,
          }}
        >
          <span>{index}</span>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: chrome }} />
          <span>05</span>
        </span>
      </div>
      {/* 安全框可视化（?showcase=1&guides=1） */}
      <SafetyGuides color={chrome} />
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
        {/* 印章（右下角）：pink 方块 -6deg + cream 圆环 + 40px mono 小字；内移 32px 使旋转 bbox 落回内容带 */}
        <div
          data-testid="stamp"
          style={{
            position: "absolute",
            right: "var(--space-4)",
            bottom: "var(--space-4)",
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

/* ── Slide 2 · 数据冲击 = 参考 s3（强调色：green + pink + orange；yellow 不出场） ── */

/** 数据格（参考 s3 cell）：mono 角标 /0N（右上）+ 大数字 + mono 标签 + 一句描述；
    bg 按参考序列 green → pink → cream → orange；亮底配墨字、green/orange 底配 cream 字 */
function StatCell({
  corner,
  value,
  label,
  desc,
  bg,
  ink = true,
  testid,
}: {
  corner: string;
  value: string;
  label: string;
  desc: string;
  bg: string;
  ink?: boolean;
  testid?: string;
}) {
  const textScope = ink ? {} : scope({ "--text": "var(--surface)", "--text-2": "var(--surface)" });
  return (
    <div style={{ display: "flex", ...textScope }}>
      <Card
        variant="plain"
        data-testid={testid}
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "24px 32px",
          background: bg,
        }}
      >
        <Kicker
          style={{
            position: "absolute",
            top: 24,
            right: 28,
            background: "none",
            color: "inherit",
            padding: 0,
            fontSize: 24,
            letterSpacing: "0.1em",
          }}
        >
          {corner}
        </Kicker>
        <div style={{ paddingTop: 24 }}>
          <HeroNumber value={value} />
        </div>
        <div>
          <Kicker
            style={{ background: "none", color: "inherit", padding: 0, fontSize: 24, letterSpacing: "0.12em" }}
          >
            {label}
          </Kicker>
          <BodyCopy style={{ fontSize: 24, lineHeight: 1.3, marginTop: 6, maxWidth: 520 }}>{desc}</BodyCopy>
        </div>
      </Card>
    </div>
  );
}

function DataSlide() {
  return (
    <SlideShell index="02" topbar="BY THE NUMBERS" pill="SHOWCASE / M2B" meta="METRICS OVERVIEW">
      {/* 氛围层（豁免安全框）：种子粒子尘，低透明度铺满整屏 */}
      <div
        data-testid="particles-layer"
        style={{ position: "absolute", inset: 0, opacity: 0.18, pointerEvents: "none" }}
      >
        <SeededParticles seed={42} count={40} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {/* headline 单行（视觉终审二轮 F1：右侧空间足够，display-2 96px 单行放下 9 字 + 2 标点） */}
        <HeroTitle style={{ fontSize: "var(--t-display-2)", lineHeight: 0.95 }}>
          四个数字，一个故事。
        </HeroTitle>
        {/* 2×2 满幅网格：零阴影（--shadow-card-sm none）、格间隙 var(--grid-gutter) 28px */}
        <Grid
          variant="even"
          columns={2}
          data-testid="stat-grid"
          style={{ flex: 1, gridTemplateRows: "1fr 1fr", ...scope({ "--shadow-card-sm": "none" }) }}
        >
          <StatCell
            corner="/01"
            value="42%"
            label="参与度提升"
            desc="参与度相对基线提升 42 个百分点。"
            bg="var(--accent-1)"
            ink={false}
            testid="stat-cell-1"
          />
          <StatCell
            corner="/02"
            value="2.7×"
            label="吞吐倍数"
            desc="同一份口播稿的产出吞吐提升 2.7 倍。"
            bg="var(--accent-2)"
            testid="stat-cell-2"
          />
          <StatCell
            corner="/03"
            value="118"
            label="活跃占位"
            desc="活跃占位组件 118 个，随稿迭代。"
            bg="var(--surface)"
            testid="stat-cell-3"
          />
          <StatCell
            corner="/04"
            value="$9.4M"
            label="样本总值"
            desc="样本数据总值 940 万美元。"
            bg="var(--accent-3)"
            ink={false}
            testid="stat-cell-4"
          />
        </Grid>
        {/* 底部一行（宽松 gap 48，只放 3 个）：动效完成度条 + 帧计数器 + 转化率环 */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 48,
            marginBottom: "var(--space-3)", // 12px 卡片阴影落点收在内容带内
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Kicker variant="block" style={{ alignSelf: "flex-start" }}>
              70% · 动效完成度
            </Kicker>
            <BarGrow value={0.7} variant="accent" />
          </div>
          <div style={scope({ "--t-display-2": "48px" })}>
            <Card
              variant="plain"
              data-testid="frames-card"
              style={{
                padding: "var(--space-3)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <Kicker variant="block">FRAMES</Kicker>
              <Counter to={47} />
            </Card>
          </div>
          <DonutMeter value={0.42} label="转化率" />
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 3 · 流程 = 参考 s6（强调色：cream + pink + yellow + green 收尾） ── */

interface StepDef {
  n: string;
  title: string;
  desc: string;
  tone: "cream" | "pink" | "yellow" | "green";
}

const STEP_DEFS: StepDef[] = [
  { n: "01", title: "写稿", desc: "口播稿定节奏，一句一拍，每句拆成独立一步。", tone: "cream" },
  { n: "02", title: "构图", desc: "为每一步选组件，套用主题 token 与配色纪律。", tone: "pink" },
  { n: "03", title: "动画", desc: "引擎驱动全部动效，可暂停、可快进、可复演。", tone: "yellow" },
  { n: "04", title: "成片", desc: "录屏导出成片，一张网页承载完整表达。", tone: "green" },
];

/** 流程步骤卡：大 mono 序号（display-2 96px 档）+ Kicker 标题 + 描述两句。
    配色序列 cream → pink（墨字）→ yellow（墨字）→ green（cream 字）收尾；零阴影（参考构图无投影）。
    视觉终审三轮 F1：步骤卡间三角箭头已删除（用户拍板），卡片间距保持 Grid gutter 28px */
function StepCard({ def }: { def: StepDef }) {
  const variant = def.tone === "green" ? "accent" : "plain";
  const bg =
    def.tone === "pink" ? "var(--accent-2)" : def.tone === "yellow" ? "var(--accent-4)" : undefined;
  const creamText = def.tone === "green";
  return (
    <Card
      variant={variant}
      data-testid={`step-card-${def.tone}`}
      style={{
        position: "relative",
        height: 320,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: 28,
        ...(bg ? { background: bg } : {}),
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--t-display-2)",
          lineHeight: 0.85,
          color: creamText ? "var(--surface)" : "var(--text)",
        }}
      >
        {def.n}
      </span>
      <Kicker
        style={{
          background: "none",
          color: creamText ? "var(--surface)" : "var(--text)",
          padding: 0,
          fontSize: 34,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {def.title}
      </Kicker>
      <BodyCopy style={{ fontSize: 24, lineHeight: 1.4, color: creamText ? "var(--surface)" : "var(--text-2)" }}>
        {def.desc}
      </BodyCopy>
    </Card>
  );
}

function FlowSlide() {
  return (
    <SlideShell index="03" topbar="HOW IT WORKS" pill="FOUR STEPS" meta="METHOD FLOW">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <HeroTitle style={{ fontSize: "var(--t-display-2)", lineHeight: 0.95 }}>一个四步流程。</HeroTitle>
        {/* 流程 slide 的 signature：3px dashed 墨线分隔（参考 s6 header-line） */}
        <Rule variant="dashed" data-testid="flow-rule" style={scope({ "--rule-w": "3px", margin: "0 0 var(--space-4)" })} />
        <Grid variant="even" columns={4} data-testid="step-cards" style={scope({ "--shadow-card-sm": "none" })}>
          {STEP_DEFS.map((def) => (
            <StepCard key={def.n} def={def} />
          ))}
        </Grid>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-6)", marginTop: "auto" }}>
          <div style={{ flex: 1 }}>
            <TimelineTrack points={["稿", "镜", "画", "声", "片"]} activeIndex={3} data-testid="flow-timeline" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <ProgressDots total={5} current={4} data-testid="flow-progress" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--t-label)", // F2：与 TimelineTrack 标签同升 24px（mono 注册表档）
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
    </SlideShell>
  );
}

/* ── Slide 4 · 对比 = 参考 s7（强调色：yellow 徽章 + pink/green/orange 彩色列） ── */

const COMPARE_ROWS = [
  ["速度", "快", "更快", "最快"],
  ["足迹", "轻", "中", "重"],
  ["投入", "低", "中", "高"],
  ["结果", "样例", "样例", "样例"],
];

function CompareSlide() {
  return (
    <SlideShell index="04" topbar="SIDE BY SIDE" pill="COMPARISON" meta="OPTIONS MATRIX">
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <HeroTitle style={{ fontSize: "var(--t-h1)", lineHeight: 0.95, maxWidth: 1100 }}>
          三个选项，逐项对比。
        </HeroTitle>
        {/* 视觉终审三轮 F2：-4deg "选一个" 徽章已删除（用户拍板），headline 与表格保持现有布局 */}
        {/* 大表格（Table columns 变体）：cream-2 底 4px 墨框 + 彩色数据列（pink 墨字 / green cream 字 / orange cream 字） */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            background: "var(--surface-2)",
            border: "4px solid var(--surface-3)",
          }}
        >
          <Table
            variant="columns"
            className="sg-compare-table"
            header={["属性", "方案 A", "方案 B", "方案 C"]}
            rows={COMPARE_ROWS}
            data-testid="compare-table"
          />
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 5 · 收尾 = 参考 s8（整屏绿底；强调色：pink 印章） ── */

function ClosingSlide() {
  return (
    <SlideShell
      index="05"
      topbar="END OF DECK"
      pill="FIN."
      meta="CLOSING CARD"
      bg="var(--accent-1)"
      invert
    >
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* 主标题（featured）：stamp 变体（墨底 cream 字）+ 24px pink 硬阴影——本屏 featured 独一份 */}
        <HeroTitle
          variant="stamp"
          style={{
            fontSize: "var(--t-display-1)",
            lineHeight: 1,
            alignSelf: "flex-start",
            marginTop: "var(--space-5)",
            boxShadow: SHADOW_PINK,
          }}
        >
          谢谢观看。
        </HeroTitle>
        {/* strap 一句（cream 字，三轮 F3：与 headline 拉开 48px 呼吸间距——参考 s8 段落感） */}
        <BodyCopy
          style={{
            marginTop: "var(--space-5)",
            maxWidth: 1000,
            fontSize: 32,
            lineHeight: 1.4,
            color: "var(--surface)",
          }}
        >
          把口播稿，做成会动的网页。这是 creative-mode 主题的完整视觉表达。
        </BodyCopy>
        {/* 印章（参考 s8 stamp）：pink 方块 -6deg + cream 圆环内框 + mono "05/05" + "M2B"；
            内移 32px 使旋转 bbox 落回内容带 */}
        <div
          data-testid="closing-seal"
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "var(--space-4)",
            bottom: "var(--space-4)",
            width: 340,
            height: 340,
            background: "var(--accent-2)",
            border: "4px solid var(--surface)",
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
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 48,
                lineHeight: 1,
                letterSpacing: "0.04em",
                color: "var(--surface)",
              }}
            >
              05/05
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                letterSpacing: "0.12em",
                color: "var(--surface)",
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

/** 主题效果页（?showcase=1 dev-only 验收工具，与 FontPreview 同级） */
export function ThemeShowcase() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shell)", paddingTop: 64, paddingBottom: 120 }}>
      <style>{SHOWCASE_TWEAKS}</style>
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
          creative-mode · 主题效果页 · 5 屏 slide deck · 构图复刻 reference s1/s3/s6/s7/s8
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
          DEV-ONLY · ?showcase=1&guides=1
        </span>
      </header>
      <main style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 96 }}>
        <CoverSlide />
        <DataSlide />
        <FlowSlide />
        <CompareSlide />
        <ClosingSlide />
      </main>
    </div>
  );
}
